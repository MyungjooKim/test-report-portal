const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { marked } = require('marked');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const { google } = require('googleapis');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 세션 설정 (파일 기반 — 컨테이너 재시작해도 유지)
const SESSION_DIR = path.join(__dirname, 'data', 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

app.use(session({
  store: new FileStore({ path: SESSION_DIR, ttl: 7 * 24 * 60 * 60 }),
  secret: process.env.SESSION_SECRET || 'tr-portal-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// Google OAuth 설정
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

function createOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

// 디렉토리 설정
const REPORTS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');

if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

// DB 초기화
function initDB() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ projects: [], reports: [] }, null, 2));
  }
}
initDB();

function loadDB() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function saveDB(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// Multer 설정
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, REPORTS_DIR),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${id}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.html', '.zip', '.md'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('HTML, ZIP, 또는 MD 파일만 업로드 가능합니다.'));
    }
  },
  limits: { fileSize: 200 * 1024 * 1024 }
});

// 정적 파일
app.use('/uploads', express.static(REPORTS_DIR));
app.use(express.json());

// ──────────── 인증 미들웨어 ────────────

// 로그인 페이지는 인증 없이 접근 가능
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 인증이 필요하지 않은 경로들
const PUBLIC_PATHS = ['/auth/google', '/auth/google/callback', '/login', '/css/', '/js/'];

function requireAuth(req, res, next) {
  // 공개 경로는 통과
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();

  // 로그인 확인
  if (req.session.googleUser) return next();

  // API 요청이면 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  // 그 외는 로그인 페이지로
  res.redirect('/login');
}

app.use(requireAuth);

// 인증된 사용자만 정적 파일 접근
app.use(express.static(path.join(__dirname, 'public')));

// 현재 사용자 정보 API
app.get('/api/me', (req, res) => {
  res.json(req.session.googleUser || null);
});

// ──────────── 헬퍼 ────────────

function extractZip(zipPath) {
  const id = path.basename(zipPath, '.zip');
  const extractDir = path.join(REPORTS_DIR, id);
  fs.mkdirSync(extractDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(extractDir, true);
  fs.unlinkSync(zipPath);

  const indexPath = findIndexHtml(extractDir);
  return { extractDir: id, indexPath };
}

function findIndexHtml(dir, depth = 0) {
  if (depth > 2) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  const htmlFile = entries.find(e => e.isFile() && e.name.toLowerCase() === 'index.html');
  if (htmlFile) {
    return path.relative(path.join(__dirname, 'uploads'), path.join(dir, htmlFile.name));
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const found = findIndexHtml(path.join(dir, entry.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function rmDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

function deleteReportFiles(report) {
  if (report.type === 'folder') {
    rmDir(path.join(REPORTS_DIR, report.folderId));
  } else {
    const filePath = path.join(REPORTS_DIR, report.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

// 검색 인덱스 추출 — HTML에서 제목, 헤딩, 테이블 첫열 추출
function extractSearchIndex(filePath, type) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const tokens = [];

    if (type === 'markdown') {
      // MD에서 헤딩, 텍스트 추출
      const lines = content.split('\n');
      for (const line of lines) {
        const headingMatch = line.match(/^#{1,4}\s+(.+)/);
        if (headingMatch) tokens.push(headingMatch[1].trim());
        // 리스트 아이템
        const listMatch = line.match(/^[-*]\s+(.+)/);
        if (listMatch) tokens.push(listMatch[1].trim());
        // 테이블 셀 (| 로 구분)
        if (line.includes('|') && !line.match(/^[\s|:-]+$/)) {
          const cells = line.split('|').map(c => c.trim()).filter(c => c);
          tokens.push(...cells);
        }
      }
    } else {
      // HTML 파싱
      const $ = cheerio.load(content);
      // title
      const title = $('title').text();
      if (title) tokens.push(title);
      // h1~h4
      $('h1, h2, h3, h4').each((_, el) => {
        const text = $(el).text().trim();
        if (text) tokens.push(text);
      });
      // 테이블 첫 2열 (TC명, 분류명 등)
      $('table tr').each((_, row) => {
        const cells = $(row).find('td, th');
        cells.each((i, cell) => {
          if (i < 3) { // 첫 3열만
            const text = $(cell).text().trim();
            if (text && text.length < 200) tokens.push(text);
          }
        });
      });
      // 주요 텍스트 (p, span 중 짧은 것들)
      $('p, .summary, .header-info, .stat-value, .stat-label').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length < 150) tokens.push(text);
      });
    }

    // 중복 제거, 빈 값 제거, 합쳐서 반환
    const unique = [...new Set(tokens.filter(t => t.length > 0))];
    return unique.join(' | ');
  } catch (e) {
    return '';
  }
}

// 프로젝트의 depth 계산
function getProjectDepth(db, projectId) {
  let depth = 0;
  let current = db.projects.find(p => p.id === projectId);
  while (current && current.parentId) {
    depth++;
    current = db.projects.find(p => p.id === current.parentId);
    if (depth > 10) break; // 무한루프 방지
  }
  return depth;
}

// 프로젝트와 모든 하위 프로젝트/리포트 삭제
function deleteProjectRecursive(db, projectId) {
  // 하위 프로젝트 찾기
  const children = db.projects.filter(p => p.parentId === projectId);
  for (const child of children) {
    deleteProjectRecursive(db, child.id);
  }

  // 이 프로젝트의 리포트 파일 삭제
  const reports = db.reports.filter(r => r.projectId === projectId);
  for (const r of reports) {
    deleteReportFiles(r);
  }

  // DB에서 제거
  db.reports = db.reports.filter(r => r.projectId !== projectId);
  db.projects = db.projects.filter(p => p.id !== projectId);
}

// 프로젝트 트리 구조 생성 (리포트 수 포함)
function buildProjectTree(db, parentId = null, userEmail = null) {
  const children = db.projects
    .filter(p => (p.parentId || null) === parentId)
    // private 프로젝트는 owner만 볼 수 있음
    .filter(p => !p.visibility || p.visibility === 'public' || p.ownerId === userEmail)
    .map(p => {
      const reports = db.reports.filter(r => r.projectId === p.id);
      const dates = [...new Set(reports.map(r => r.date))].sort().reverse();
      const latestUpload = reports.length > 0
        ? reports.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0].uploadedAt
        : p.createdAt;

      const childNodes = buildProjectTree(db, p.id, userEmail);
      const childReportCount = childNodes.reduce((sum, c) => sum + c.totalReportCount, 0);

      return {
        ...p,
        reportCount: reports.length,
        totalReportCount: reports.length + childReportCount,
        dates,
        latestDate: dates[0] || null,
        latestUpload,
        children: childNodes
      };
    });

  // order 필드 기준 정렬 (없으면 생성일 순)
  children.sort((a, b) => {
    const orderA = a.order !== undefined ? a.order : 0;
    const orderB = b.order !== undefined ? b.order : 0;
    return orderA - orderB;
  });
  return children;
}

// ──────────── API ────────────

// 프로젝트 트리 구조 반환
app.get('/api/projects', (req, res) => {
  const db = loadDB();
  const userEmail = req.session.googleUser.email;
  const tree = buildProjectTree(db, null, userEmail);
  res.json(tree);
});

// 프로젝트 생성 (parentId 선택적)
app.post('/api/projects', (req, res) => {
  const db = loadDB();
  const { name, parentId, visibility } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '프로젝트명을 입력하세요.' });

  // depth 체크 (max 3)
  if (parentId) {
    const parentDepth = getProjectDepth(db, parentId);
    if (parentDepth >= 2) {
      return res.status(400).json({ error: '최대 3단계까지만 생성할 수 있습니다.' });
    }
  }

  const project = {
    id: uuidv4(),
    name: name.trim(),
    parentId: parentId || null,
    visibility: visibility || 'public', // 'public' 또는 'private'
    ownerId: req.session.googleUser.email,
    createdAt: new Date().toISOString()
  };
  db.projects.push(project);
  saveDB(db);
  res.json(project);
});

// 프로젝트 이름 수정
app.patch('/api/projects/:id', (req, res) => {
  const db = loadDB();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '프로젝트명을 입력하세요.' });

  project.name = name.trim();
  saveDB(db);
  res.json({ success: true, project });
});

// 프로젝트 순서 변경
app.put('/api/projects/reorder', (req, res) => {
  const db = loadDB();
  const { orders } = req.body; // [{ id, order }]

  if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders 배열이 필요합니다.' });

  for (const item of orders) {
    const project = db.projects.find(p => p.id === item.id);
    if (project) {
      project.order = item.order;
    }
  }

  saveDB(db);
  res.json({ success: true });
});

// 프로젝트 삭제 (하위 포함)
app.delete('/api/projects/:id', (req, res) => {
  const db = loadDB();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  deleteProjectRecursive(db, req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// 특정 프로젝트의 리포트 목록 (날짜별 그룹)
app.get('/api/projects/:id/reports', (req, res) => {
  const db = loadDB();
  const reports = db.reports
    .filter(r => r.projectId === req.params.id)
    .sort((a, b) => b.date.localeCompare(a.date) || new Date(b.uploadedAt) - new Date(a.uploadedAt));

  const grouped = {};
  for (const r of reports) {
    if (!grouped[r.date]) grouped[r.date] = [];
    grouped[r.date].push(r);
  }

  res.json(grouped);
});

// 리포트 업로드
app.post('/api/projects/:id/reports', upload.array('files', 20), (req, res) => {
  const db = loadDB();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const date = req.body.date || new Date().toISOString().slice(0, 10);
  const uploadedBy = req.body.uploadedBy || '익명';
  const newReports = [];

  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase();
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    if (ext === '.zip') {
      const filePath = path.join(REPORTS_DIR, file.filename);
      const { extractDir, indexPath } = extractZip(filePath);

      // ZIP 안의 index.html에서 검색 인덱스 추출
      const indexFilePath = path.join(REPORTS_DIR, indexPath || `${extractDir}/index.html`);
      const searchIndex = fs.existsSync(indexFilePath) ? extractSearchIndex(indexFilePath, 'html') : '';

      const report = {
        id: uuidv4(),
        projectId: req.params.id,
        originalName: originalName.replace('.zip', ''),
        type: 'folder',
        folderId: extractDir,
        indexPath: indexPath || `${extractDir}/index.html`,
        date,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
        memo: '',
        searchIndex
      };
      db.reports.push(report);
      newReports.push(report);
    } else if (ext === '.md') {
      const filePath = path.join(REPORTS_DIR, file.filename);
      const searchIndex = extractSearchIndex(filePath, 'markdown');

      const report = {
        id: uuidv4(),
        projectId: req.params.id,
        originalName,
        type: 'markdown',
        fileName: file.filename,
        indexPath: file.filename,
        date,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
        memo: '',
        searchIndex
      };
      db.reports.push(report);
      newReports.push(report);
    } else {
      const filePath = path.join(REPORTS_DIR, file.filename);
      const searchIndex = extractSearchIndex(filePath, 'html');

      const report = {
        id: uuidv4(),
        projectId: req.params.id,
        originalName,
        type: 'single',
        fileName: file.filename,
        indexPath: file.filename,
        date,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
        memo: '',
        searchIndex
      };
      db.reports.push(report);
      newReports.push(report);
    }
  }

  saveDB(db);
  res.json({ success: true, reports: newReports });
});

// 리포트 삭제
app.delete('/api/reports/:id', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  deleteReportFiles(report);
  db.reports = db.reports.filter(r => r.id !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// 검색 API
app.get('/api/search', (req, res) => {
  const db = loadDB();
  const { q, projectId } = req.query;

  if (!q || !q.trim()) return res.json([]);

  const keywords = q.trim().toLowerCase().split(/\s+/);
  let reports = db.reports;

  // 프로젝트 스코프 제한
  if (projectId) {
    // 해당 프로젝트 + 하위 프로젝트 IDs 수집
    const projectIds = getProjectAndChildrenIds(db, projectId);
    reports = reports.filter(r => projectIds.includes(r.projectId));
  }

  // 검색 수행: 파일명, 업로더, 메모, searchIndex에서 키워드 매칭
  const results = reports
    .map(r => {
      const searchableText = [
        r.originalName,
        r.uploadedBy,
        r.memo || '',
        r.searchIndex || '',
        r.date
      ].join(' ').toLowerCase();

      // 모든 키워드가 포함되어야 매칭
      const matched = keywords.every(kw => searchableText.includes(kw));
      if (!matched) return null;

      // 매칭된 키워드 하이라이트용 스니펫 생성
      const snippets = [];
      const indexParts = (r.searchIndex || '').split(' | ');
      for (const part of indexParts) {
        if (keywords.some(kw => part.toLowerCase().includes(kw))) {
          snippets.push(part);
          if (snippets.length >= 3) break;
        }
      }

      // 프로젝트명 찾기
      const project = db.projects.find(p => p.id === r.projectId);

      return {
        ...r,
        projectName: project ? project.name : '',
        snippets,
        searchIndex: undefined // 응답에서 제외
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .slice(0, 50); // 최대 50개

  res.json(results);
});

// 기존 리포트 재인덱싱 (한번만 실행하면 됨)
app.post('/api/reindex', (req, res) => {
  const db = loadDB();
  let indexed = 0;

  for (const report of db.reports) {
    if (report.searchIndex) continue; // 이미 인덱싱된 건 스킵

    let filePath;
    if (report.type === 'folder') {
      filePath = path.join(REPORTS_DIR, report.indexPath);
    } else {
      filePath = path.join(REPORTS_DIR, report.fileName);
    }

    if (fs.existsSync(filePath)) {
      const type = report.type === 'markdown' ? 'markdown' : 'html';
      report.searchIndex = extractSearchIndex(filePath, type);
      indexed++;
    }
  }

  saveDB(db);
  res.json({ success: true, indexed });
});

// 하위 프로젝트 ID들 수집
function getProjectAndChildrenIds(db, projectId) {
  const ids = [projectId];
  const children = db.projects.filter(p => p.parentId === projectId);
  for (const child of children) {
    ids.push(...getProjectAndChildrenIds(db, child.id));
  }
  return ids;
}

// 리포트 통계 대시보드 API
app.get('/api/reports/:id/stats', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  let filePath;
  if (report.type === 'folder') {
    filePath = path.join(REPORTS_DIR, report.indexPath);
  } else {
    filePath = path.join(REPORTS_DIR, report.fileName);
  }

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const stats = extractReportStats(content, report.type);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: '통계 추출 실패: ' + e.message });
  }
});

// HTML/MD에서 Pass/Fail 통계 추출
function extractReportStats(content, type) {
  const result = {
    total: 0,
    pass: 0,
    fail: 0,
    skip: 0, // N/T, N/A, 미수행, Skip, -
    passRate: 0,
    sheets: [], // 시트/섹션별 통계
    failItems: [] // Fail 항목 목록
  };

  if (type === 'markdown') {
    // MD에서 테이블 파싱
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.includes('|')) continue;
      const cells = line.split('|').map(c => c.trim().toLowerCase());
      for (const cell of cells) {
        if (isPass(cell)) result.pass++;
        else if (isFail(cell)) result.fail++;
        else if (isSkip(cell)) result.skip++;
      }
    }
  } else {
    // HTML 파싱
    const $ = cheerio.load(content);

    // 시트별 탐색 (.sheet-content가 있으면 multi-sheet)
    const sheetContents = $('.sheet-content');
    const sheetTabs = $('.sheet-tab');

    if (sheetContents.length > 0) {
      // Multi-sheet (Google Sheets에서 가져온 경우)
      sheetContents.each((sheetIdx, sheetEl) => {
        const sheetName = sheetTabs.eq(sheetIdx).text() || `Sheet ${sheetIdx + 1}`;
        const sheetStat = { name: sheetName, pass: 0, fail: 0, skip: 0, total: 0 };

        // 헤더에서 결과 컬럼 인덱스 찾기
        const resultColIdxs = [];
        $(sheetEl).find('table thead th, table tr:first-child th').each((idx, th) => {
          const hText = $(th).text().trim().toLowerCase();
          if (['android', 'ios', 'result', '결과', 'pass', 'fail', 'p/f', 'mobile', 'web'].includes(hText)) {
            resultColIdxs.push(idx);
          }
        });

        $(sheetEl).find('table tbody tr, table tr:not(:first-child)').each((rowIdx, row) => {
          const cells = $(row).find('td');
          if (cells.length === 0) return;

          // 결과 컬럼이 식별된 경우 해당 컬럼만 체크
          const colsToCheck = resultColIdxs.length > 0 ? resultColIdxs : null;

          cells.each((cellIdx, cell) => {
            if (colsToCheck && !colsToCheck.includes(cellIdx)) return;

            const text = $(cell).text().trim().toLowerCase();
            const cls = $(cell).attr('class') || '';

            if (cls.includes('cell-pass') || isPass(text)) {
              sheetStat.pass++;
            } else if (cls.includes('cell-fail') || isFail(text)) {
              sheetStat.fail++;
              const rowCells = [];
              cells.each((ci, c) => { if (ci < 4) rowCells.push($(c).text().trim()); });
              result.failItems.push({ sheet: sheetName, cells: rowCells });
            } else if (colsToCheck && (cls.includes('cell-skip') || isSkip(text))) {
              sheetStat.skip++;
            }
          });
        });

        sheetStat.total = sheetStat.pass + sheetStat.fail + sheetStat.skip;
        if (sheetStat.total > 0) result.sheets.push(sheetStat);
      });
    } else {
      // 단일 테이블
      const singleStat = { name: '전체', pass: 0, fail: 0, skip: 0, total: 0 };

      // 헤더에서 결과 컬럼 찾기
      const resultColIdxs = [];
      $('table thead th, table tr:first-child th').each((idx, th) => {
        const hText = $(th).text().trim().toLowerCase();
        if (['android', 'ios', 'result', '결과', 'pass', 'fail', 'p/f', 'mobile', 'web'].includes(hText)) {
          resultColIdxs.push(idx);
        }
      });

      $('table tbody tr, table tr:not(:first-child)').each((rowIdx, row) => {
        const cells = $(row).find('td');
        if (cells.length === 0) return;

        const colsToCheck = resultColIdxs.length > 0 ? resultColIdxs : null;

        cells.each((cellIdx, cell) => {
          if (colsToCheck && !colsToCheck.includes(cellIdx)) return;

          const text = $(cell).text().trim().toLowerCase();
          const cls = $(cell).attr('class') || '';

          if (cls.includes('cell-pass') || isPass(text)) {
            singleStat.pass++;
          } else if (cls.includes('cell-fail') || isFail(text)) {
            singleStat.fail++;
            const rowCells = [];
            cells.each((ci, c) => { if (ci < 4) rowCells.push($(c).text().trim()); });
            result.failItems.push({ sheet: '전체', cells: rowCells });
          } else if (colsToCheck && (cls.includes('cell-skip') || isSkip(text))) {
            singleStat.skip++;
          }
        });
      });

      singleStat.total = singleStat.pass + singleStat.fail + singleStat.skip;
      if (singleStat.total > 0) result.sheets.push(singleStat);
    }
  }

  // 합산
  result.pass = result.sheets.reduce((s, sh) => s + sh.pass, 0);
  result.fail = result.sheets.reduce((s, sh) => s + sh.fail, 0);
  result.skip = result.sheets.reduce((s, sh) => s + sh.skip, 0);
  result.total = result.pass + result.fail + result.skip;
  // Pass Rate는 실행된 것(pass+fail) 기준
  const executed = result.pass + result.fail;
  result.passRate = executed > 0 ? Math.round((result.pass / executed) * 100) : 0;
  result.executed = executed;
  result.executionRate = result.total > 0 ? Math.round((executed / result.total) * 100) : 0;

  // Fail 항목은 최대 20개만
  result.failItems = result.failItems.slice(0, 20);

  return result;
}

function isPass(text) {
  return /^(pass|passed|p|통과)$/.test(text);
}

function isFail(text) {
  return /^(fail|failed|f|실패)$/.test(text);
}

function isSkip(text) {
  return /^(skip|skipped|n\/t|n\/a|미수행|-)$/.test(text);
}

// Google Sheets 리포트 새로고침 (최신 데이터로 갱신)
app.post('/api/reports/:id/refresh', async (req, res) => {
  if (!req.session.googleTokens) {
    return res.status(401).json({ error: 'Google 로그인이 필요합니다.' });
  }

  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
  if (report.type !== 'gsheet') return res.status(400).json({ error: 'Google Sheets 리포트만 새로고침 가능합니다.' });

  const url = report.sourceUrl;
  let spreadsheetId;
  const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetIdMatch) {
    spreadsheetId = sheetIdMatch[1];
  } else if (/^[a-zA-Z0-9-_]+$/.test(url.trim())) {
    spreadsheetId = url.trim();
  } else {
    return res.status(400).json({ error: '저장된 URL이 유효하지 않습니다.' });
  }

  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(req.session.googleTokens);

    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) req.session.googleTokens.refresh_token = tokens.refresh_token;
      req.session.googleTokens.access_token = tokens.access_token;
    });

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const title = meta.data.properties.title;
    const sheetNames = meta.data.sheets.map(s => s.properties.title);

    const allData = {};
    for (const sheetName of sheetNames) {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'`
        });
        allData[sheetName] = response.data.values || [];
      } catch (e) {
        allData[sheetName] = [];
      }
    }

    const htmlContent = generateSheetHtml(title, allData, url);

    // 기존 파일 덮어쓰기
    const filePath = path.join(REPORTS_DIR, report.fileName);
    fs.writeFileSync(filePath, htmlContent, 'utf-8');

    // 메타 갱신
    report.originalName = title;
    report.searchIndex = extractSearchIndex(filePath, 'html');
    report.lastRefreshedAt = new Date().toISOString();

    saveDB(db);
    res.json({ success: true, report });
  } catch (e) {
    console.error('Sheets refresh error:', e.message);
    if (e.code === 403 || e.code === 404) {
      return res.status(403).json({ error: '스프레드시트 접근 권한이 없습니다.' });
    }
    res.status(500).json({ error: '새로고침 실패: ' + e.message });
  }
});

// Markdown 렌더링 엔드포인트
app.get('/api/reports/:id/render', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
  if (report.type !== 'markdown') return res.status(400).json({ error: 'Markdown 리포트가 아닙니다.' });

  const filePath = path.join(REPORTS_DIR, report.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });

  const mdContent = fs.readFileSync(filePath, 'utf-8');
  const htmlContent = marked(mdContent);

  const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${report.originalName}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 900px;
      margin: 0 auto;
      padding: 32px 24px;
      color: #1a1d26;
      line-height: 1.7;
    }
    h1, h2, h3, h4 { margin-top: 1.5em; margin-bottom: 0.5em; }
    h1 { font-size: 2em; border-bottom: 2px solid #e4e7ec; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #e4e7ec; padding-bottom: 0.2em; }
    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
    }
    pre {
      background: #1e2330;
      color: #e2e8f0;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
    }
    pre code { background: transparent; padding: 0; color: inherit; }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #e4e7ec;
      padding: 8px 12px;
      text-align: left;
    }
    th { background: #f8f9fb; font-weight: 600; }
    blockquote {
      border-left: 4px solid #4f8cff;
      margin: 1em 0;
      padding: 8px 16px;
      background: #f0f7ff;
      color: #374151;
    }
    img { max-width: 100%; border-radius: 8px; }
    a { color: #4f8cff; }
    ul, ol { padding-left: 1.5em; }
    li { margin: 0.3em 0; }
    hr { border: none; border-top: 1px solid #e4e7ec; margin: 2em 0; }
  </style>
</head>
<body>${htmlContent}</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(fullHtml);
});

// 리포트 메모 수정
app.patch('/api/reports/:id', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  if (req.body.memo !== undefined) report.memo = req.body.memo;
  saveDB(db);
  res.json({ success: true, report });
});

// ──────────── Google OAuth ────────────

// Google 로그인 시작
app.get('/auth/google', (req, res) => {
  const oauth2Client = createOAuth2Client();
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });
  res.redirect(authUrl);
});

// OAuth 콜백
app.get('/auth/google/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/#auth-error');

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // 사용자 정보 가져오기
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    // 세션에 저장
    req.session.googleTokens = tokens;
    req.session.googleUser = {
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture
    };

    res.redirect('/#google-connected');
  } catch (e) {
    console.error('Google OAuth error:', e.message);
    res.redirect('/#auth-error');
  }
});

// Google 연결 상태 확인
app.get('/api/google/status', (req, res) => {
  if (req.session.googleTokens && req.session.googleUser) {
    res.json({ connected: true, user: req.session.googleUser });
  } else {
    res.json({ connected: false });
  }
});

// Google 로그아웃
app.post('/api/google/disconnect', (req, res) => {
  delete req.session.googleTokens;
  delete req.session.googleUser;
  res.json({ success: true });
});

// Google Spreadsheet 데이터 가져오기
app.post('/api/google/sheets/import', async (req, res) => {
  if (!req.session.googleTokens) {
    return res.status(401).json({ error: 'Google 로그인이 필요합니다.' });
  }

  const { url, projectId, date, uploadedBy } = req.body;
  if (!url || !projectId) {
    return res.status(400).json({ error: 'URL과 프로젝트ID가 필요합니다.' });
  }

  // Spreadsheet ID 추출 — 전체 URL이든 ID만이든 처리
  let spreadsheetId;
  const sheetIdMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetIdMatch) {
    spreadsheetId = sheetIdMatch[1];
  } else if (/^[a-zA-Z0-9-_]+$/.test(url.trim())) {
    // ID만 입력된 경우
    spreadsheetId = url.trim();
  } else {
    return res.status(400).json({ error: '유효한 Google Spreadsheet URL 또는 ID가 아닙니다.' });
  }

  try {
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials(req.session.googleTokens);

    // 토큰 갱신 처리
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        req.session.googleTokens.refresh_token = tokens.refresh_token;
      }
      req.session.googleTokens.access_token = tokens.access_token;
    });

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    // 스프레드시트 메타데이터
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const title = meta.data.properties.title;
    const sheetNames = meta.data.sheets.map(s => s.properties.title);

    // 모든 시트 데이터 가져오기
    const allData = {};
    for (const sheetName of sheetNames) {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetName}'`
        });
        allData[sheetName] = response.data.values || [];
      } catch (e) {
        console.error(`시트 "${sheetName}" 가져오기 실패:`, e.message);
        allData[sheetName] = [];
      }
    }

    // HTML 테이블로 변환
    const htmlContent = generateSheetHtml(title, allData, url);

    // 파일로 저장
    const db = loadDB();
    const project = db.projects.find(p => p.id === projectId);
    if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

    const fileId = uuidv4();
    const fileName = `${fileId}.html`;
    const filePath = path.join(REPORTS_DIR, fileName);
    fs.writeFileSync(filePath, htmlContent, 'utf-8');

    // 검색 인덱스 추출
    const searchIndex = extractSearchIndex(filePath, 'html');

    const report = {
      id: uuidv4(),
      projectId,
      originalName: title,
      type: 'gsheet',
      fileName,
      indexPath: fileName,
      sourceUrl: url,
      date: date || new Date().toISOString().slice(0, 10),
      uploadedBy: uploadedBy || req.session.googleUser.name || '익명',
      uploadedAt: new Date().toISOString(),
      memo: '',
      searchIndex
    };

    db.reports.push(report);
    saveDB(db);

    res.json({ success: true, report });
  } catch (e) {
    console.error('Sheets API error:', e.message);
    if (e.code === 403 || e.code === 404) {
      return res.status(403).json({ error: '해당 스프레드시트에 접근 권한이 없습니다.' });
    }
    res.status(500).json({ error: '스프레드시트를 가져오는데 실패했습니다: ' + e.message });
  }
});

// Google Spreadsheet → HTML 변환
function generateSheetHtml(title, allData, sourceUrl) {
  let tabsHtml = '';
  let contentHtml = '';

  const sheetNames = Object.keys(allData);

  // 탭 네비게이션 (시트가 2개 이상이면)
  if (sheetNames.length > 1) {
    tabsHtml = `<div class="sheet-tabs">${sheetNames.map((name, i) =>
      `<button class="sheet-tab ${i === 0 ? 'active' : ''}" onclick="showSheet(${i})">${name}</button>`
    ).join('')}</div>`;
  }

  // 각 시트를 테이블로 변환
  sheetNames.forEach((name, i) => {
    let rows = allData[name];
    if (rows.length === 0) {
      contentHtml += `<div class="sheet-content ${i === 0 ? 'active' : ''}" id="sheet-${i}"><p>데이터가 없습니다.</p></div>`;
      return;
    }

    // 첫 번째 비어있지 않은 행을 찾아서 헤더로 사용
    let headerRowIdx = 0;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r] || [];
      const hasContent = row.some(cell => (cell || '').trim().length > 0);
      if (hasContent) {
        headerRowIdx = r;
        break;
      }
    }
    rows = rows.slice(headerRowIdx);

    // 컬럼 폭 계산: 헤더명과 실제 데이터 길이를 조합하여 결정
    const header = rows[0] || [];
    const colMaxLengths = header.map((_, colIdx) => {
      let maxLen = 0;
      for (let r = 0; r < Math.min(rows.length, 30); r++) {
        const cell = (rows[r] && rows[r][colIdx]) || '';
        maxLen = Math.max(maxLen, cell.length);
      }
      return maxLen;
    });

    // 헤더명 기반 특수 처리 + 데이터 길이 기반 일반 규칙
    const colWidths = header.map((h, idx) => {
      const name = (h || '').toLowerCase().trim();
      const dataLen = colMaxLengths[idx];

      // Pass/Fail 결과 기록 컬럼 (Android, iOS 등) — 동일 폭 고정
      if (['android', 'ios', 'pass', 'fail', 'result', '결과', 'p/f'].includes(name) ||
          (dataLen <= 6 && /^(pass|fail|n\/t|n\/a|p|f|-|통과|실패|미수행|v[\d.]+)$/i.test(
            ((rows[1] && rows[1][idx]) || '').trim()
          ))) {
        return '60px';
      }

      // ID 계열
      if (name.includes('id') || name === 'no' || name === '#') return '100px';

      // 짧은 분류명 (대분류, 중분류, 소분류)
      if (name.includes('분류') || name === 'category') return '100px';

      // 화면 코드 — 좁게 고정, 줄바꿈으로 처리
      if (name.includes('화면') || name.includes('screen') ||
          name.includes('코드') || name.includes('code')) return '85px';

      // 사전조건, 테스트 스텝, 기대결과 — 동일 폭
      if (name.includes('사전조건') || name.includes('precondition') ||
          name.includes('스텝') || name.includes('step') ||
          name.includes('기대') || name.includes('expected')) return '200px';

      // 버전, SMO 등 짧은 값
      if (name.includes('버전') || name.includes('version') || name === 'smo' ||
          name === 'smoke') return '55px';

      // 데이터 길이 기반 일반 규칙

      // 데이터 길이 기반 일반 규칙
      if (dataLen <= 5) return '55px';
      if (dataLen <= 10) return '85px';
      if (dataLen <= 15) return '110px';
      if (dataLen <= 25) return '150px';
      if (dataLen <= 40) return '180px';
      return '220px';
    });

    let tableHtml = '<div class="table-wrapper"><table><colgroup>';
    for (const w of colWidths) {
      tableHtml += `<col style="width:${w}">`;
    }
    tableHtml += '</colgroup><thead><tr>';
    for (const cell of header) {
      tableHtml += `<th>${escapeHtmlServer(cell || '')}</th>`;
    }
    tableHtml += '</tr></thead><tbody>';

    for (let r = 1; r < rows.length; r++) {
      tableHtml += '<tr>';
      const row = rows[r] || [];
      for (let c = 0; c < header.length; c++) {
        const cell = row[c] || '';
        const cellClass = getCellClass(cell);
        tableHtml += `<td class="${cellClass}">${escapeHtmlServer(cell)}</td>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</tbody></table></div>';

    contentHtml += `<div class="sheet-content ${i === 0 ? 'active' : ''}" id="sheet-${i}">${tableHtml}</div>`;
  });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlServer(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; color: #1a1d26; }
    h1 { font-size: 1.5em; margin-bottom: 4px; }
    .source-link { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
    .source-link a { color: #4f8cff; }
    .sheet-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid #e4e7ec; padding-bottom: 8px; }
    .sheet-tab { padding: 6px 14px; border: none; background: #f1f5f9; border-radius: 6px 6px 0 0; cursor: pointer; font-size: 13px; }
    .sheet-tab.active { background: #4f8cff; color: #fff; }
    .sheet-content { display: none; }
    .sheet-content.active { display: block; }
    table { border-collapse: collapse; width: 100%; font-size: 13px; table-layout: fixed; }
    th, td { border: 1px solid #e4e7ec; padding: 6px 10px; text-align: left; word-wrap: break-word; overflow-wrap: break-word; white-space: normal; vertical-align: top; }
    th { background: #f8f9fb; font-weight: 600; position: sticky; top: 0; }
    tr:hover { background: #f8fafc; }
    .table-wrapper { overflow-x: auto; }
    .cell-pass { background: #dcfce7; color: #166534; font-weight: 600; }
    .cell-fail { background: #fee2e2; color: #991b1b; font-weight: 600; }
    .cell-skip { background: #fef9c3; color: #854d0e; }
  </style>
</head>
<body>
  <h1>${escapeHtmlServer(title)}</h1>
  <div class="source-link">출처: <a href="${sourceUrl}" target="_blank">Google Spreadsheet 원본 열기</a></div>
  ${tabsHtml}
  ${contentHtml}
  <script>
    function showSheet(idx) {
      document.querySelectorAll('.sheet-content').forEach((el, i) => el.classList.toggle('active', i === idx));
      document.querySelectorAll('.sheet-tab').forEach((el, i) => el.classList.toggle('active', i === idx));
    }
  </script>
</body>
</html>`;
}

function getCellClass(value) {
  const v = (value || '').trim().toLowerCase();
  if (v === 'pass' || v === 'passed' || v === '통과' || v === 'p') return 'cell-pass';
  if (v === 'fail' || v === 'failed' || v === '실패' || v === 'f') return 'cell-fail';
  if (v === 'skip' || v === 'skipped' || v === 'n/a' || v === '미수행' || v === '-') return 'cell-skip';
  return '';
}

function escapeHtmlServer(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.listen(PORT, () => {
  console.log(`\n🧪 테스트 리포트 포털 실행 중`);
  console.log(`   → http://localhost:${PORT}\n`);
});
