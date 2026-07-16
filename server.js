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
const sheetStore = require('./lib/sheet-store');
const { evaluateMetric } = require('./lib/metric-eval');
const { computeStatsFromSheetData, collectFailItems } = require('./lib/report-stats');
const { computeDetailStats } = require('./lib/detail-stats');

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

// ──────────── QA 통합 (INTEGRATION_SPEC §5.2) ────────────
// INTEGRATED=1 일 때만 동작 — 미설정 시 기존 자체 로그인 그대로 (배포 회귀 방지)
const INTEGRATED = process.env.INTEGRATED === '1';
// TCGEN_URL: 서버 대 서버 검증용 (Docker 내부에서는 host.docker.internal 등)
// TCGEN_PUBLIC_URL: 브라우저 리다이렉트·런처용 (미설정 시 TCGEN_URL 사용)
const TCGEN_URL = (process.env.TCGEN_URL || 'http://localhost:5001').replace(/\/$/, '');
const TCGEN_PUBLIC_URL = (process.env.TCGEN_PUBLIC_URL || TCGEN_URL).replace(/\/$/, '');

// tcgen API 를 서버 대 서버로 호출 (브라우저 쿠키 포워딩) — 200 + JSON 이면 파싱 결과, 아니면 null
function tcgenGetJson(apiPath, cookieHeader) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(TCGEN_URL + apiPath); } catch { return resolve(null); }
    const lib = url.protocol === 'https:' ? require('https') : require('http');
    const req = lib.request({
      method: 'GET',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      headers: { 'Accept': 'application/json', 'Cookie': cookieHeader || '' },
      timeout: 4000,
    }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => {
        if (r.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(body)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// tcgen /whoami 로 세션 검증
function verifyTcgenSession(cookieHeader) {
  return tcgenGetJson('/whoami', cookieHeader)
    .then((j) => (j && j.authenticated && j.email ? j : null));
}

// tcgen 에서 로그인 사용자의 Google access token 수신 — Sheets 연동용 (INTEGRATION_SPEC §5.3)
function fetchTcgenAccessToken(cookieHeader) {
  return tcgenGetJson('/whoami/token', cookieHeader)
    .then((j) => (j && j.ok && j.access_token ? j : null));
}

// Sheets API 용 OAuth 클라이언트 — 자체 로그인 토큰 우선, 통합 모드면 tcgen 토큰 사용
async function getGoogleAuthForRequest(req) {
  if (req.session.googleTokens) {
    const c = createOAuth2Client();
    c.setCredentials(req.session.googleTokens);
    c.on('tokens', (tokens) => {
      if (tokens.refresh_token) req.session.googleTokens.refresh_token = tokens.refresh_token;
      req.session.googleTokens.access_token = tokens.access_token;
    });
    return c;
  }
  if (INTEGRATED) {
    // 단기 access token 만 사용 — 갱신은 tcgen 이 담당하므로 요청마다 새로 받는다
    const tok = await fetchTcgenAccessToken(req.headers.cookie);
    if (tok) {
      const c = new google.auth.OAuth2();
      c.setCredentials({ access_token: tok.access_token });
      return c;
    }
  }
  return null;
}

// 디렉토리 설정
const REPORTS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');

// 운영 조정 가능한 설정 — 볼륨(data/)에 있어 재배포 없이 수정 가능. 없으면 코드 기본값 사용.
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch (_) {
    return {};
  }
}

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
    if (['.html', '.zip', '.md', '.mmd', '.mermaid'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('HTML, ZIP, MD 또는 MMD/Mermaid 파일만 업로드 가능합니다.'));
    }
  },
  limits: { fileSize: 200 * 1024 * 1024 }
});

// HTML 은 자산 URL(?v=__V__)에 앱 버전을 주입해 서빙 — 배포 시 URL 이 바뀌어
// Cloudflare 엣지·브라우저 캐시(Browser Cache TTL 4h)를 확실히 무효화한다.
const APP_PKG_VERSION = require('./package.json').version;
function sendHtmlWithVersion(res, file) {
  const html = fs.readFileSync(path.join(__dirname, 'public', file), 'utf-8')
    .replace(/__V__/g, APP_PKG_VERSION);
  res.type('html').send(html);
}

// 정적 파일 캐시 정책 — html/css/js 는 no-cache(항상 재검증, ETag 로 미변경 시 304).
// 배포 후 브라우저가 구버전 app.js 를 계속 쓰거나, 시트 새로고침(동일 파일명 덮어쓰기) 후
// 구버전 리포트 HTML 이 보이는 문제 방지.
const STATIC_OPTS = {
  setHeaders: (res, filePath) => {
    if (/\.(html|css|js|svg)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
};

// 정적 파일
app.use('/uploads', express.static(REPORTS_DIR, STATIC_OPTS));
app.use(express.json());

// ──────────── 인증 미들웨어 ────────────

// 로그인 페이지 — 통합 모드면 tcgen 로그인으로 위임
app.get('/login', (req, res) => {
  if (INTEGRATED) return res.redirect(TCGEN_PUBLIC_URL + '/login');
  sendHtmlWithVersion(res, 'login.html');
});

// 로그아웃 — 포털 세션 파기 후 통합 모드면 tcgen 로그아웃까지 연쇄 (양쪽 세션 종료)
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    if (INTEGRATED) return res.redirect(TCGEN_PUBLIC_URL + '/logout');
    res.redirect('/login');
  });
});

// 파비콘 — /favicon.ico 자동 요청(리포트 새 탭 등)도 SVG 로 응답
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml');
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'));
});

// 인증이 필요하지 않은 경로들 — 통합 모드에서는 자체 OAuth 경로를 공개하지 않음
const PUBLIC_PATHS = INTEGRATED
  ? ['/login', '/logout', '/css/', '/js/', '/favicon']
  : ['/auth/google', '/auth/google/callback', '/login', '/logout', '/css/', '/js/', '/favicon'];

// 통합 세션 캐시 재검증 주기 — tcgen 쪽 로그아웃이 포털에 전파되는 최대 지연
const SSO_REVERIFY_MS = 5 * 60 * 1000;

async function requireAuth(req, res, next) {
  // 공개 경로는 통과
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();

  if (req.session.googleUser) {
    // 자체 로그인 세션이거나 비통합 모드면 그대로 신뢰
    if (!INTEGRATED || !req.session.googleUser.integrated) return next();
    // 통합 세션은 주기적으로 tcgen 세션 생존을 재확인 (교차 로그아웃 전파)
    if ((req.session.ssoVerifiedAt || 0) + SSO_REVERIFY_MS > Date.now()) return next();
    const who = await verifyTcgenSession(req.headers.cookie);
    if (who) {
      req.session.ssoVerifiedAt = Date.now();
      return next();
    }
    delete req.session.googleUser; // tcgen 에서 로그아웃됨 → 포털 세션도 무효화
  } else if (INTEGRATED) {
    // 통합 모드: tcgen 세션을 신뢰 (포트 무관 쿠키 공유 / 서브도메인 쿠키)
    const who = await verifyTcgenSession(req.headers.cookie);
    if (who) {
      req.session.googleUser = {
        email: who.email,
        name: who.name || who.email,
        picture: who.picture || '',
        integrated: true,
      };
      req.session.ssoVerifiedAt = Date.now();
      return next();
    }
  }

  // API 요청이면 401 (통합 모드는 need_login 으로 프런트 리다이렉트 유도)
  if (req.path.startsWith('/api/')) {
    return res.status(401).json(
      INTEGRATED
        ? { error: '로그인이 필요합니다.', need_login: true }
        : { error: '로그인이 필요합니다.' }
    );
  }

  // 그 외는 로그인 페이지로
  res.redirect(INTEGRATED ? TCGEN_PUBLIC_URL + '/login' : '/login');
}

app.use(requireAuth);

// 메인 페이지 — 자산 URL 에 버전 주입 (static 대신 이 라우트가 index.html 서빙)
app.get('/', (req, res) => sendHtmlWithVersion(res, 'index.html'));

// 인증된 사용자만 정적 파일 접근
app.use(express.static(path.join(__dirname, 'public'), STATIC_OPTS));

// mermaid 브라우저 번들 — 다이어그램/Markdown 렌더 페이지에서만 로드
app.use('/vendor/mermaid', express.static(path.join(__dirname, 'node_modules', 'mermaid', 'dist'), STATIC_OPTS));

// 현재 사용자 정보 API
app.get('/api/me', (req, res) => {
  res.json(req.session.googleUser || null);
});

// QA 통합 설정 — 프런트 9-dot 런처가 사용 (브라우저용 URL). aiEnabled = AI Q&A 기능 노출 여부
app.get('/api/config', (req, res) => {
  res.json({
    integrated: INTEGRATED,
    tcgenUrl: TCGEN_PUBLIC_URL,
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
  });
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

    if (type === 'diagram') {
      // mermaid 코드에서 텍스트 라인 추출 (%% 주석 제외)
      for (const line of content.split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('%%')) tokens.push(t);
      }
    } else if (type === 'markdown') {
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
  const automation = req.body.automation === '1';
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
        automation,
        memo: '',
        searchIndex
      };
      db.reports.push(report);
      newReports.push(report);
    } else if (ext === '.md' || ext === '.mmd' || ext === '.mermaid') {
      const isDiagram = ext !== '.md';
      const filePath = path.join(REPORTS_DIR, file.filename);
      const searchIndex = extractSearchIndex(filePath, isDiagram ? 'diagram' : 'markdown');

      const report = {
        id: uuidv4(),
        projectId: req.params.id,
        originalName,
        type: isDiagram ? 'diagram' : 'markdown',
        fileName: file.filename,
        indexPath: file.filename,
        date,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
        automation,
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
        automation,
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

// 다이어그램 업로드 — mermaid 코드 붙여넣기 (JSON body, 파일 업로드 없이)
app.post('/api/projects/:id/diagrams', (req, res) => {
  const db = loadDB();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: '다이어그램 코드가 없습니다.' });
  if (content.length > 1024 * 1024) return res.status(400).json({ error: '다이어그램 코드가 너무 큽니다. (최대 1MB)' });

  const name = (typeof req.body.name === 'string' && req.body.name.trim()) || '다이어그램';
  const fileName = `diagram-${uuidv4()}.mmd`;
  fs.writeFileSync(path.join(REPORTS_DIR, fileName), content, 'utf-8');

  const report = {
    id: uuidv4(),
    projectId: req.params.id,
    originalName: name,
    type: 'diagram',
    fileName,
    indexPath: fileName,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    uploadedBy: req.body.uploadedBy || '익명',
    uploadedAt: new Date().toISOString(),
    memo: '',
    searchIndex: extractSearchIndex(path.join(REPORTS_DIR, fileName), 'diagram'),
  };
  db.reports.push(report);
  saveDB(db);
  res.json({ success: true, report });
});

// 리포트 삭제
app.delete('/api/reports/:id', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  deleteReportFiles(report);
  sheetStore.remove(report.id);
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
// 상세 대시보드 통계 — 특징 축(거래소/기기/테스터 등) 자동 감지 + 축별 결과 분포 (gsheet 전용)
app.get('/api/reports/:id/stats/detail', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
  if (report.type !== 'gsheet') return res.status(400).json({ error: '상세 대시보드는 Sheets 리포트만 지원합니다.' });

  const sheetData = sheetStore.load(report.id);
  if (!sheetData || !sheetData.sheets || !sheetData.sheets.length) {
    return res.status(400).json({ error: '시트 데이터가 없습니다. 리포트를 새로고침해 주세요.' });
  }
  res.json(computeDetailStats(sheetData, loadSettings().detail));
});

app.get('/api/reports/:id/stats', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  // gsheet: 원본 rows 기반 계산 (AI Q&A·커스텀 지표와 단일 데이터 소스) —
  // HTML 휴리스틱 파싱의 헤더 미인식/N-T 누락 문제 해결. 구형 리포트는 아래 HTML 파서로 fallback
  if (report.type === 'gsheet') {
    const sheetData = sheetStore.load(report.id);
    if (sheetData && sheetData.sheets && sheetData.sheets.length) {
      try {
        const stats = computeStatsFromSheetData(sheetData);
        // 상세 대시보드 가용성 — 기준(축 수·건수)은 data/settings.json 의 detail 로 조정 가능
        const detail = computeDetailStats(sheetData, loadSettings().detail);
        return res.json({ ...stats, detailAvailable: detail.available, detailAxes: detail.axes.length });
      } catch (e) {
        console.error('rows 기반 통계 실패, HTML 파서로 fallback:', e.message);
      }
    }
  }

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
          if (isResultHeaderText(hText)) {
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
            } else if (cls.includes('cell-skip') || (colsToCheck ? isSkip(text) : isSkipStrict(text))) {
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
        if (isResultHeaderText(hText)) {
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
          } else if (cls.includes('cell-skip') || (colsToCheck ? isSkip(text) : isSkipStrict(text))) {
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

// 결과 컬럼 헤더 판별 — 부분일치('테스트 통과', '테스트 결과' 등), 기대결과 계열은 제외
function isResultHeaderText(t) {
  if (!t || t.length > 20) return false;
  if (['android', 'ios', 'p/f', 'pf', 'pass/fail', 'mobile', 'web'].includes(t)) return true;
  return /(결과|통과|판정|result|status)/.test(t) && !/(기대|예상|expected)/.test(t);
}

// 결과 컬럼 미인식 상태(모든 셀 스캔)에서 쓰는 엄격 skip 매칭 — '-' 는 오탐 위험이 커 제외
function isSkipStrict(text) {
  return /^(skip|skipped|n\/t|nt|n\/a|미수행)$/.test(text);
}

function isSkip(text) {
  return /^(skip|skipped|n\/t|n\/a|미수행|-)$/.test(text);
}

// Google Sheets 리포트 새로고침 (최신 데이터로 갱신)
app.post('/api/reports/:id/refresh', async (req, res) => {
  const oauth2Client = await getGoogleAuthForRequest(req);
  if (!oauth2Client) {
    return res.status(401).json({
      error: INTEGRATED
        ? 'Google 토큰을 가져오지 못했습니다. TC Generator 에서 로그아웃 후 다시 로그인해 주세요.'
        : 'Google 로그인이 필요합니다.',
    });
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

    // AI Q&A / 커스텀 지표용 원본 rows 보존 (report-ai-qa)
    sheetStore.save(report.id, allData);

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

// ──────────── AI Q&A + 커스텀 지표 (report-ai-qa) ────────────

const MAX_CUSTOM_METRICS = 8;       // 리포트당 커스텀 카드 상한
const CHAT_MAX_HISTORY = 10;        // 대화 이력 상한 (최근 N개)
const CHAT_MAX_QUESTION = 1000;     // 질문 길이 상한 (자)
const CTX_MAX_ROWS_PER_SHEET = 1500;
const CTX_MAX_BYTES = 300 * 1024;   // 컨텍스트 직렬화 상한

// 커스텀 지표 목록 — 정의를 시트 데이터로 평가해 계산값과 함께 반환
app.get('/api/reports/:id/metrics', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  const metrics = report.customMetrics || [];
  const sheetData = metrics.length > 0 ? sheetStore.load(report.id) : null;
  const items = metrics.map(m => {
    const result = sheetData ? evaluateMetric(sheetData, m) : { ok: false, error: '시트 데이터 없음 (새로고침 필요)' };
    return {
      id: m.id,
      label: m.label,
      display: result.ok ? result.display : null,
      percent: result.ok ? result.percent : null,
      error: result.ok ? null : result.error,
    };
  });
  res.json({ metrics: items });
});

// 커스텀 지표 추가 — 저장 전에 evaluate 로 정의 검증
app.post('/api/reports/:id/metrics', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  report.customMetrics = report.customMetrics || [];
  if (report.customMetrics.length >= MAX_CUSTOM_METRICS) {
    return res.status(400).json({ error: `커스텀 지표는 리포트당 최대 ${MAX_CUSTOM_METRICS}개입니다.` });
  }

  const def = req.body || {};
  if (typeof def.label !== 'string' || !def.label.trim() || def.label.length > 80) {
    return res.status(400).json({ error: 'label 이 올바르지 않습니다 (1~80자).' });
  }
  const sheetData = sheetStore.load(report.id);
  if (!sheetData) return res.status(400).json({ error: '시트 데이터가 없습니다. 리포트를 새로고침해 주세요.' });

  const result = evaluateMetric(sheetData, def);
  if (!result.ok) return res.status(400).json({ error: `계산 정의가 유효하지 않습니다: ${result.error}` });

  const metric = {
    id: uuidv4(),
    label: def.label.trim(),
    sheet: def.sheet || null,
    filter: def.filter || [],
    agg: def.agg,
    of: def.of || [],
    createdBy: (req.session.googleUser && req.session.googleUser.name) || '익명',
    createdAt: new Date().toISOString(),
  };
  report.customMetrics.push(metric);
  saveDB(db);
  res.json({ success: true, metric: { id: metric.id, label: metric.label, display: result.display, percent: result.percent } });
});

// 커스텀 지표 삭제 (AI 로 추가된 카드 한정 — 기본 통계 카드는 이 목록에 없음)
app.delete('/api/reports/:id/metrics/:mid', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
  const before = (report.customMetrics || []).length;
  report.customMetrics = (report.customMetrics || []).filter(m => m.id !== req.params.mid);
  if (report.customMetrics.length === before) {
    return res.status(404).json({ error: '지표를 찾을 수 없습니다.' });
  }
  saveDB(db);
  res.json({ success: true });
});

// ── Fail 분석 및 결함 후보 (자동 생성 + 지문 캐시) ──
// 대시보드 첫 열람 시 생성, Fail 목록이 바뀌면(refresh 등) 지문 불일치로 자동 재생성.
// 분포 집계는 서버가 결정적으로 계산하고, AI 는 패턴 해석·결함 클러스터링만 담당.

const _failAnalysisInFlight = new Map(); // reportId → Promise (동시 열람 시 중복 생성 방지)

const FAIL_ANALYSIS_RULES = `당신은 QA 결함 분석가다. 테스트 결과서의 Fail 목록과 분포(서버 집계 — 정확함)를 받아 분석한다.

출력 형식 (마크다운, 간결하게):
### 집중 영역
- 2~3줄. 어떤 시트/기능 영역에 Fail 이 집중되어 있는지 — 주어진 분포 수치만 인용.
### 결함 후보 클러스터
- 동일 원인의 결함으로 의심되는 TC 들을 묶고, 묶음마다 "TC ID 목록 — 근거 한 줄".
- 단독 Fail 은 "개별 확인 필요"로 분리.
### 수정 우선 대상
- 1~3개. 영향 범위가 큰 순서로, 이유 한 줄씩.

규칙: 주어진 데이터에 없는 내용을 추측하지 말 것. 수치는 분포 집계만 인용. 전체 200단어 이내.`;

async function generateFailAnalysis(reportId, fails, fingerprint) {
  // 결정적 분포 집계 — 시트별 / 기능(대분류 > 중분류)별
  const bySheet = {};
  const byGroup = {};
  for (const f of fails) {
    bySheet[f.sheet] = (bySheet[f.sheet] || 0) + 1;
    const g = [f.cells[1], f.cells[2]].filter(Boolean).join(' > ') || '(미분류)';
    byGroup[g] = (byGroup[g] || 0) + 1;
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    system: FAIL_ANALYSIS_RULES,
    messages: [{
      role: 'user',
      content: JSON.stringify({
        분포_시트별: bySheet,
        분포_기능별: byGroup,
        fail_목록: fails.map(f => ({ 시트: f.sheet, tc: f.cells[0], 분류: [f.cells[1], f.cells[2]].filter(Boolean).join(' > '), 제목: f.cells[3] })),
      }),
    }],
  });
  const markdown = resp.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
  if (!markdown) throw new Error('빈 분석 결과');

  const analysis = { fingerprint, markdown, generatedAt: new Date().toISOString(), failCount: fails.length };
  const db = loadDB();
  const r = db.reports.find(x => x.id === reportId);
  if (r) { r.failAnalysis = analysis; saveDB(db); }
  return analysis;
}

app.get('/api/reports/:id/fail-analysis', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.json({ disabled: true });
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
  if (report.type !== 'gsheet') return res.json({ disabled: true });
  const sheetData = sheetStore.load(report.id);
  if (!sheetData || !sheetData.sheets.length) return res.json({ disabled: true });

  const fails = collectFailItems(sheetData);
  if (fails.length === 0) {
    if (report.failAnalysis) { delete report.failAnalysis; saveDB(db); }
    return res.json({ none: true });
  }

  const crypto = require('crypto');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(fails)).digest('hex');
  if (req.query.force !== '1' && report.failAnalysis && report.failAnalysis.fingerprint === fingerprint) {
    return res.json({ ok: true, cached: true, ...report.failAnalysis });
  }

  let job = _failAnalysisInFlight.get(report.id);
  if (!job) {
    job = generateFailAnalysis(report.id, fails, fingerprint)
      .finally(() => _failAnalysisInFlight.delete(report.id));
    _failAnalysisInFlight.set(report.id, job);
  }
  try {
    const analysis = await job;
    res.json({ ok: true, cached: false, ...analysis });
  } catch (e) {
    console.error('Fail 분석 생성 오류:', e.message);
    res.status(502).json({ error: 'Fail 분석 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// LLM 컨텍스트용 시트 데이터 직렬화 — 상한 초과 시 요약 모드
function buildSheetContext(report, sheetData) {
  const full = {
    report: report.originalName,
    sheets: sheetData.sheets.map(s => ({
      name: s.name,
      header: s.header,
      rowCount: s.rows.length,
      rows: s.rows.slice(0, CTX_MAX_ROWS_PER_SHEET),
    })),
  };
  const serialized = JSON.stringify(full);
  if (serialized.length <= CTX_MAX_BYTES && sheetData.sheets.every(s => s.rows.length <= CTX_MAX_ROWS_PER_SHEET)) {
    return { text: serialized, summarized: false };
  }
  // 요약 모드: 헤더 + 컬럼별 고유값 상위 50개 + 행 수 (계산은 evaluator 가 전체 데이터로 수행)
  const summary = {
    report: report.originalName,
    note: '행 수가 많아 요약만 제공. 수치는 반드시 define_metric 도구로 계산할 것.',
    sheets: sheetData.sheets.map(s => ({
      name: s.name,
      header: s.header,
      rowCount: s.rows.length,
      columnValues: s.header.map((h, i) => {
        const uniq = [...new Set(s.rows.map(r => String(r[i] == null ? '' : r[i]).trim()).filter(v => v))];
        return { col: h, uniqueCount: uniq.length, samples: uniq.slice(0, 50) };
      }),
    })),
  };
  return { text: JSON.stringify(summary), summarized: true };
}

const METRIC_CONDITION_SCHEMA = {
  type: 'object',
  properties: {
    col: { type: 'string', description: '시트 header 에 있는 컬럼명 그대로' },
    op: { type: 'string', enum: ['eq', 'in', 'contains', 'not_empty'] },
    value: {
      anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }, { type: 'null' }],
      description: 'eq/contains: 문자열, in: 문자열 배열, not_empty: null',
    },
  },
  required: ['col', 'op', 'value'],
  additionalProperties: false,
};

const DEFINE_METRIC_TOOL = {
  name: 'define_metric',
  description: '시트 데이터에 대한 수치 계산 정의. 개수/비율/퍼센트 등 수량 질문에는 반드시 이 도구를 사용한다. 직접 세지 않는다. count=filter 만족 행 수, ratio=(filter∧of 만족 행)/(filter 만족 행). filter 가 빈 배열이면 전체 행이 분모.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: '지표의 짧은 한국어 이름 (예: IMPLEMENTED 중 Pass 비율)' },
      sheet: { type: ['string', 'null'], description: '대상 시트명. null 이면 전체 시트 합산' },
      filter: { type: 'array', items: METRIC_CONDITION_SCHEMA },
      agg: { type: 'string', enum: ['count', 'ratio'] },
      of: { type: 'array', items: METRIC_CONDITION_SCHEMA, description: 'agg=ratio 일 때 분자 조건. count 면 빈 배열' },
    },
    required: ['label', 'sheet', 'filter', 'agg', 'of'],
    additionalProperties: false,
  },
};

const CHAT_SYSTEM_RULES = `당신은 QA 테스트 결과서 분석 도우미다. 아래 리포트 컨텍스트(시트 데이터)만 근거로 답한다.

규칙:
- 개수·비율·퍼센트 등 수량 질문에는 반드시 define_metric 도구를 사용한다. 절대 직접 세거나 어림하지 않는다.
- 도구 결과(display 값)를 그대로 인용해 한국어로 간결하게 답한다.
- 요약·원인 분석 같은 서술형 질문은 도구 없이 데이터를 근거로 답한다.
- 컨텍스트에 없는 내용은 "이 결과서에서 확인할 수 없습니다"라고 답한다.
- 답변은 간결하게. 불필요한 서론 없이 결론부터.`;

function sseSend(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// AI Q&A — SSE 스트리밍 (text / metric / done / error 이벤트)
app.post('/api/reports/:id/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI 기능이 설정되지 않았습니다.' });
  }
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
  const sheetData = sheetStore.load(report.id);
  if (!sheetData || !sheetData.sheets.length) {
    return res.status(400).json({ error: '시트 데이터가 없습니다. 리포트를 새로고침해 주세요.' });
  }

  // 대화 이력 정제 — 최근 N개, 역할/길이 제한
  const history = (Array.isArray(req.body && req.body.messages) ? req.body.messages : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-CHAT_MAX_HISTORY)
    .map(m => ({ role: m.role, content: m.content.slice(0, CHAT_MAX_QUESTION) }));
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ error: '질문이 없습니다.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic();
  const context = buildSheetContext(report, sheetData);
  const system = [
    { type: 'text', text: CHAT_SYSTEM_RULES },
    { type: 'text', text: `리포트 컨텍스트:\n${context.text}`, cache_control: { type: 'ephemeral' } },
  ];
  const messages = history.map(m => ({ role: m.role, content: m.content }));

  try {
    // 도구 루프 — 최대 3회 (define_metric 계산 → 결과 재주입)
    for (let turn = 0; turn < 3; turn++) {
      const stream = client.messages.stream({
        model: 'claude-opus-4-8',
        max_tokens: 4096,
        thinking: { type: 'adaptive' },
        system,
        tools: [DEFINE_METRIC_TOOL],
        messages,
      });
      stream.on('text', (delta) => sseSend(res, 'text', { delta }));
      const final = await stream.finalMessage();

      messages.push({ role: 'assistant', content: final.content });

      if (final.stop_reason !== 'tool_use') break;

      const toolResults = [];
      for (const block of final.content) {
        if (block.type !== 'tool_use') continue;
        const result = evaluateMetric(sheetData, block.input);
        if (result.ok) {
          sseSend(res, 'metric', {
            definition: block.input,
            computed: { display: result.display, percent: result.percent, numerator: result.numerator, denominator: result.denominator },
          });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } else {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.error, is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }
    if (context.summarized) {
      sseSend(res, 'text', { delta: '\n\n(행 수가 많아 요약 컨텍스트로 답변했습니다. 수치는 전체 데이터로 계산됩니다.)' });
    }
    sseSend(res, 'done', {});
  } catch (e) {
    console.error('AI chat error:', e.message);
    sseSend(res, 'error', { message: 'AI 응답 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' });
  }
  res.end();
});

// Markdown / 다이어그램 렌더링 엔드포인트
app.get('/api/reports/:id/render', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
  if (report.type !== 'markdown' && report.type !== 'diagram') {
    return res.status(400).json({ error: '렌더링을 지원하지 않는 리포트 형식입니다.' });
  }

  const filePath = path.join(REPORTS_DIR, report.fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });

  const rawContent = fs.readFileSync(filePath, 'utf-8');
  let htmlContent;
  let hasMermaid = false;

  if (report.type === 'diagram') {
    // .mmd 전체가 mermaid 코드 — textContent 로 읽히므로 HTML 이스케이프가 안전하다
    // 코드 보기/수정 패널: 좌측 사이드(스티키) · 다이어그램 우측 (mermaid.live 스타일)
    htmlContent = `<div class="diagram-toolbar">
    <button id="toggleCodeBtn" class="tb-btn">&lt;/&gt; 코드</button>
    <span id="saveStatus"></span>
  </div>
  <div class="diagram-layout">
    <div id="codePanel" class="code-panel" hidden>
      <textarea id="codeEditor" spellcheck="false">${escapeHtmlServer(rawContent)}</textarea>
      <div class="code-actions">
        <button id="saveCodeBtn" class="tb-btn primary">💾 저장 후 다시 그리기</button>
        <button id="copyCodeBtn" class="tb-btn">📋 복사</button>
      </div>
    </div>
    <div class="diagram-area">
      <pre class="mermaid">${escapeHtmlServer(rawContent)}</pre>
    </div>
  </div>`;
    hasMermaid = true;
  } else {
    // ```mermaid 펜스 → 렌더 블록 치환 후 marked 처리 (pre 는 raw HTML 로 통과)
    const mdContent = rawContent.replace(/```mermaid[ \t]*\r?\n([\s\S]*?)```/g, (_, code) => {
      hasMermaid = true;
      return `<pre class="mermaid">${escapeHtmlServer(code)}</pre>`;
    });
    htmlContent = marked(mdContent);
  }

  const mermaidScripts = hasMermaid
    ? `<script src="/vendor/mermaid/mermaid.min.js?v=${APP_PKG_VERSION}"></script>
  <script>mermaid.initialize({ startOnLoad: true, securityLevel: 'strict' });</script>`
    : '';

  // 다이어그램 코드 보기/수정 스크립트 (diagram 타입 전용)
  const editorScript = report.type !== 'diagram' ? '' : `<script>
  (function () {
    var reportId = ${JSON.stringify(report.id)};
    var panel = document.getElementById('codePanel');
    var status = document.getElementById('saveStatus');
    function setPanel(open) {
      panel.hidden = !open;
      // 저장 → 리로드 후에도 패널 상태 유지 (#code 해시)
      history.replaceState(null, '', location.pathname + location.search + (open ? '#code' : ''));
    }
    if (location.hash === '#code') setPanel(true);
    document.getElementById('toggleCodeBtn').addEventListener('click', function () {
      setPanel(panel.hidden);
    });
    document.getElementById('copyCodeBtn').addEventListener('click', function () {
      navigator.clipboard.writeText(document.getElementById('codeEditor').value).then(function () {
        status.textContent = '복사됨';
        setTimeout(function () { status.textContent = ''; }, 1500);
      });
    });
    document.getElementById('saveCodeBtn').addEventListener('click', function () {
      var content = document.getElementById('codeEditor').value.trim();
      if (!content) { alert('다이어그램 코드가 비어 있습니다.'); return; }
      status.textContent = '저장 중...';
      fetch('/api/reports/' + reportId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.error) { status.textContent = ''; alert(d.error); return; }
        location.reload();
      }).catch(function (e) { status.textContent = ''; alert('저장 실패: ' + e.message); });
    });
  })();
  </script>`;

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
    pre.mermaid { background: transparent; color: inherit; text-align: center; overflow-x: auto; }
    body.diagram-page { max-width: none; }
    .diagram-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .tb-btn {
      font: inherit; font-size: 13px; padding: 6px 12px;
      border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer;
    }
    .tb-btn:hover { background: #f3f4f6; }
    .tb-btn.primary { background: #4f8cff; border-color: #4f8cff; color: #fff; }
    .tb-btn.primary:hover { background: #3b7ae8; }
    .diagram-layout { display: flex; gap: 20px; align-items: flex-start; }
    .code-panel {
      width: 40%; min-width: 320px; max-width: 640px; flex-shrink: 0;
      position: sticky; top: 16px;
      display: flex; flex-direction: column;
    }
    .code-panel textarea {
      width: 100%; height: calc(100vh - 150px); min-height: 260px; box-sizing: border-box; padding: 12px;
      font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; line-height: 1.5;
      border: 1px solid #d1d5db; border-radius: 8px; background: #f8f9fb; color: #1a1d26;
      white-space: pre; resize: vertical;
    }
    .code-actions { display: flex; gap: 8px; margin-top: 8px; }
    .diagram-area { flex: 1; min-width: 0; overflow-x: auto; }
    #saveStatus { font-size: 12px; color: #16a34a; }
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
<body class="${report.type === 'diagram' ? 'diagram-page' : ''}">${htmlContent}${mermaidScripts}${editorScript}</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(fullHtml);
});

// 리포트 메모 수정 · 다이어그램 코드 수정
app.patch('/api/reports/:id', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  if (req.body.memo !== undefined) report.memo = req.body.memo;

  if (req.body.content !== undefined) {
    if (report.type !== 'diagram') {
      return res.status(400).json({ error: '다이어그램 리포트만 코드를 수정할 수 있습니다.' });
    }
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content) return res.status(400).json({ error: '다이어그램 코드가 없습니다.' });
    if (content.length > 1024 * 1024) return res.status(400).json({ error: '다이어그램 코드가 너무 큽니다. (최대 1MB)' });

    const filePath = path.join(REPORTS_DIR, report.fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    report.searchIndex = extractSearchIndex(filePath, 'diagram');
    report.updatedAt = new Date().toISOString();
  }

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
app.get('/api/google/status', async (req, res) => {
  if (req.session.googleTokens && req.session.googleUser) {
    return res.json({ connected: true, user: req.session.googleUser });
  }
  // 통합 모드: tcgen 토큰이 조회되면 연결된 것으로 취급 (별도 연결 절차 불필요)
  if (INTEGRATED && req.session.googleUser) {
    const tok = await fetchTcgenAccessToken(req.headers.cookie);
    if (tok) return res.json({ connected: true, user: req.session.googleUser, integrated: true });
  }
  res.json({ connected: false });
});

// Google 로그아웃
app.post('/api/google/disconnect', (req, res) => {
  delete req.session.googleTokens;
  delete req.session.googleUser;
  res.json({ success: true });
});

// Google Spreadsheet 데이터 가져오기
app.post('/api/google/sheets/import', async (req, res) => {
  const oauth2Client = await getGoogleAuthForRequest(req);
  if (!oauth2Client) {
    return res.status(401).json({
      error: INTEGRATED
        ? 'Google 토큰을 가져오지 못했습니다. TC Generator 에서 로그아웃 후 다시 로그인해 주세요.'
        : 'Google 로그인이 필요합니다.',
    });
  }

  const { url, projectId, date, uploadedBy, automation } = req.body;
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
      automation: automation === true || automation === '1',
      memo: '',
      searchIndex
    };

    db.reports.push(report);
    saveDB(db);

    // AI Q&A / 커스텀 지표용 원본 rows 보존 (report-ai-qa)
    sheetStore.save(report.id, allData);

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
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
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
    /* sticky 헤더: 래퍼가 세로 스크롤 컨테이너여야 동작 (overflow-x 만으로는 무력화됨).
       border-collapse 에서는 sticky th 테두리가 스크롤 시 사라지므로 box-shadow 로 대체 */
    th { background: #f8f9fb; font-weight: 600; position: sticky; top: 0; z-index: 1;
         box-shadow: inset 0 1px 0 #e4e7ec, inset 0 -1px 0 #e4e7ec; }
    tr:hover { background: #f8fafc; }
    .table-wrapper { overflow: auto; max-height: calc(100vh - 160px); }
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
  if (v === 'skip' || v === 'skipped' || v === 'n/t' || v === 'nt' || v === 'n/a' || v === '미수행' || v === '-') return 'cell-skip';
  return '';
}

function escapeHtmlServer(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

app.listen(PORT, () => {
  console.log(`\n🧪 테스트 리포트 포털 실행 중`);
  console.log(`   → http://localhost:${PORT}\n`);
});
