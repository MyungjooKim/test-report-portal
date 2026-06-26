const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

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
    if (['.html', '.zip'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('HTML 또는 ZIP 파일만 업로드 가능합니다.'));
    }
  },
  limits: { fileSize: 200 * 1024 * 1024 }
});

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(REPORTS_DIR));
app.use(express.json());

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
function buildProjectTree(db, parentId = null) {
  const children = db.projects
    .filter(p => (p.parentId || null) === parentId)
    .map(p => {
      const reports = db.reports.filter(r => r.projectId === p.id);
      const dates = [...new Set(reports.map(r => r.date))].sort().reverse();
      const latestUpload = reports.length > 0
        ? reports.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0].uploadedAt
        : p.createdAt;

      const childNodes = buildProjectTree(db, p.id);
      // 하위 프로젝트의 리포트 수도 합산
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

  // 최신 활동 기준 내림차순
  children.sort((a, b) => new Date(b.latestUpload) - new Date(a.latestUpload));
  return children;
}

// ──────────── API ────────────

// 프로젝트 트리 구조 반환
app.get('/api/projects', (req, res) => {
  const db = loadDB();
  const tree = buildProjectTree(db, null);
  res.json(tree);
});

// 프로젝트 생성 (parentId 선택적)
app.post('/api/projects', (req, res) => {
  const db = loadDB();
  const { name, parentId } = req.body;
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
        memo: ''
      };
      db.reports.push(report);
      newReports.push(report);
    } else {
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
        memo: ''
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

// 리포트 메모 수정
app.patch('/api/reports/:id', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  if (req.body.memo !== undefined) report.memo = req.body.memo;
  saveDB(db);
  res.json({ success: true, report });
});

app.listen(PORT, () => {
  console.log(`\n🧪 테스트 리포트 포털 실행 중`);
  console.log(`   → http://localhost:${PORT}\n`);
});
