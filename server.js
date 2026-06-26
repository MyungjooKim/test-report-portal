const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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
    cb(null, `${id}.html`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.html') {
      cb(null, true);
    } else {
      cb(new Error('HTML 파일만 업로드 가능합니다.'));
    }
  }
});

// 정적 파일
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(REPORTS_DIR));
app.use(express.json());

// ──────────── API ────────────

// 프로젝트 목록
app.get('/api/projects', (req, res) => {
  const db = loadDB();
  // 각 프로젝트에 리포트 수, 최근 날짜 등 부가 정보 첨부
  const projects = db.projects.map(p => {
    const reports = db.reports.filter(r => r.projectId === p.id);
    const dates = [...new Set(reports.map(r => r.date))].sort().reverse();
    return {
      ...p,
      reportCount: reports.length,
      dates,
      latestDate: dates[0] || null
    };
  });
  res.json(projects);
});

// 프로젝트 생성
app.post('/api/projects', (req, res) => {
  const db = loadDB();
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '프로젝트명을 입력하세요.' });

  const project = {
    id: uuidv4(),
    name: name.trim(),
    createdAt: new Date().toISOString()
  };
  db.projects.push(project);
  saveDB(db);
  res.json(project);
});

// 프로젝트 삭제
app.delete('/api/projects/:id', (req, res) => {
  const db = loadDB();
  const project = db.projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: '프로젝트를 찾을 수 없습니다.' });

  // 관련 리포트 파일 삭제
  const reports = db.reports.filter(r => r.projectId === req.params.id);
  for (const r of reports) {
    const filePath = path.join(REPORTS_DIR, r.fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.projects = db.projects.filter(p => p.id !== req.params.id);
  db.reports = db.reports.filter(r => r.projectId !== req.params.id);
  saveDB(db);
  res.json({ success: true });
});

// 특정 프로젝트의 리포트 목록 (날짜별 그룹)
app.get('/api/projects/:id/reports', (req, res) => {
  const db = loadDB();
  const reports = db.reports
    .filter(r => r.projectId === req.params.id)
    .sort((a, b) => b.date.localeCompare(a.date) || new Date(b.uploadedAt) - new Date(a.uploadedAt));

  // 날짜별 그룹핑
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
    const report = {
      id: uuidv4(),
      projectId: req.params.id,
      originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      fileName: file.filename,
      date,
      uploadedBy,
      uploadedAt: new Date().toISOString(),
      memo: ''
    };
    db.reports.push(report);
    newReports.push(report);
  }

  saveDB(db);
  res.json({ success: true, reports: newReports });
});

// 리포트 삭제
app.delete('/api/reports/:id', (req, res) => {
  const db = loadDB();
  const report = db.reports.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });

  const filePath = path.join(REPORTS_DIR, report.fileName);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

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
