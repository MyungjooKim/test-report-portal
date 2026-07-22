#!/usr/bin/env node
// 결과 취합 데모 시드 — Playwright 리포트 폴더들을 결과형 프로젝트로 채운다.
// 로컬에서 UI를 바로 확인하기 위한 용도(어댑터를 직접 호출, ZIP 업로드 불필요).
// 원본 파일(813MB)은 복제하지 않음 — 메타데이터만 저장(§사용자 확정), ↗ 원본열기는 미노출.
//
// 사용법:
//   node scripts/seed-demo.js [PW_REPORT_ROOT]
//   PW_REPORT_ROOT 미지정 시 아래 기본 경로 사용.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const pw = require('../lib/adapters/playwright');

const DEFAULT_ROOT = '/Users/myungjookim/_claude26/git-projects/QA_automation_results/2607_bingxbn/pw-report';
const ROOT = process.argv[2] || process.env.PW_REPORT_ROOT || DEFAULT_ROOT;
const SNAPSHOT = path.basename(path.dirname(ROOT)); // 예: 2607_bingxbn
const PROJECT_NAME = `[데모] Playwright 자동화 취합 (${SNAPSHOT})`;

// 기본은 로컬 data/db.json. 컨테이너 볼륨 DB에 병합하려면 DB_FILE 로 사본 경로 지정.
const DATA_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'db.json');

if (!fs.existsSync(ROOT)) {
  console.error(`❌ 리포트 루트를 찾을 수 없습니다: ${ROOT}`);
  console.error(`   사용법: node scripts/seed-demo.js [PW_REPORT_ROOT]`);
  process.exit(1);
}

// DB 로드 (없으면 생성)
let db = { projects: [], reports: [], sources: [], records: [] };
if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
db.sources = db.sources || [];
db.records = db.records || [];
db.reports = db.reports || [];

// 기존 데모 프로젝트 있으면 재사용 + 파생 데이터 초기화 (반복 실행 안전)
let project = db.projects.find(p => p.name === PROJECT_NAME);
if (project) {
  db.sources = db.sources.filter(s => s.projectId !== project.id);
  db.records = db.records.filter(r => r.projectId !== project.id);
  console.log(`↻ 기존 데모 프로젝트 재사용 (${project.id}) — 소스/레코드 초기화`);
} else {
  project = {
    id: uuidv4(), name: PROJECT_NAME, parentId: null,
    visibility: 'public', type: 'result',
    ownerId: 'local@dev', createdAt: new Date().toISOString(),
  };
  db.projects.push(project);
  console.log(`＋ 데모 프로젝트 생성 (${project.id})`);
}

// 리포트 폴더 파싱 → 소스 + 레코드 적재 (server.js /sources 라우트와 동일 로직)
const parsed = pw.parseFolders(ROOT, { snapshot: SNAPSHOT });
let totalRows = 0;
for (const rep of parsed.reports) {
  const dir = path.join(ROOT, rep.folder);
  const { rows, detected } = pw.parse(dir, { snapshot: SNAPSHOT, source: 'automation' });
  const sourceId = uuidv4();
  db.sources.push({
    id: sourceId, projectId: project.id,
    filename: rep.folder, format: 'playwright', sourceRole: 'automation',
    snapshot: detected.snapshot || SNAPSHOT, exchange: detected.exchange || null,
    folderId: null, indexPath: '', // 원본 미복제 → 메타데이터만
    stats: detected.stats || null, rowCount: rows.length,
    importedAt: new Date().toISOString(), importedBy: 'seed',
  });
  for (const row of rows) {
    db.records.push({ id: uuidv4(), sourceId, projectId: project.id, reportDirRel: null, ...row });
  }
  totalRows += rows.length;
}

fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));

console.log(`✅ 시드 완료 — 소스 ${parsed.reports.length}건, 정규화 레코드 ${totalRows}행`);
console.log(`   프로젝트: ${PROJECT_NAME}`);
console.log(`   실행:  npm run dev:local  →  http://localhost:3000`);
