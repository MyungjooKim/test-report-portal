// Playwright HTML 리포트 어댑터
// ─────────────────────────────────────────────────────────────────────────
// 결과 취합 기능(docs/RESULT_CONSOLIDATION_SPEC.md §7 어댑터 계층)의 자동화 소스 파서.
//
// 왜 전용 어댑터인가:
//   Playwright HTML 리포트는 결과 데이터를 <table> 로 두지 않고,
//   index.html 안 <script id="playwrightReportBase64"> 에 report.json(zip)을
//   base64 로 임베드한다. 따라서 스펙이 계획한 cheerio <table> 파싱으로는
//   결과가 0건으로 잡힌다. 이 어댑터가 base64 → unzip → report.json 을 읽어
//   정규화 레코드(§8.1)로 변환한다.
//
// 반환 계약(§7 ResultAdapter):
//   supports(input) -> boolean
//   parse(input, opts) -> { rows: NormalizedRecord[], detected: {...} }
//
// NormalizedRecord (§8.1 long, project_id·imported_at 은 호출측이 채움):
//   { tcId, source:'automation', result, resultRaw, exchange, env, snapshot,
//     reasonNote, durationMs, title, suite, flaky, untagged, coveredByMulti,
//     attachments:[{name, contentType, path, exists}] }

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// ── 결과 매핑 ─────────────────────────────────────────────────────────────
// Playwright outcome → 스펙 표준 결과값(§8.3). flaky 는 최종 Pass 로 보되 플래그 유지.
const OUTCOME_MAP = {
  expected: 'Pass',
  unexpected: 'Fail',
  skipped: 'N/T',
  flaky: 'Pass',
};

function mapOutcome(outcome) {
  return OUTCOME_MAP[outcome] || 'N/T';
}

// ── TC ID 파싱 ────────────────────────────────────────────────────────────
// 제목 예:
//   "[SC-TRD-ORDR-034] 수량 0 입력"                       → [SC-TRD-ORDR-034]
//   "[SC-TRD-ORDR-036 | SC-TRD-ORDR-084] ..."             → 두 ID
//   "[SC-TRD-ORHT-041 ~ SC-TRD-ORHT-052] ..."             → 041..052 범위 전개
//   "[SC-EXCN-BG-011 | SC-EXCN-BG-012] ..."               → 두 ID
//   "AllTest" / "global.setup.ts"                          → TC ID 없음(untagged)
//
// 접두사는 대문자 세그먼트(SC-TRD-ORDR / SC-COMM / SC-EXCN-BG), 마지막은 숫자.
const TC_TOKEN_RE = /([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*?)-(\d+)/g;

// 한 토큰의 prefix + 숫자 폭을 뽑는다.
function scanTokens(text) {
  const out = [];
  let m;
  TC_TOKEN_RE.lastIndex = 0;
  while ((m = TC_TOKEN_RE.exec(text)) !== null) {
    // 마지막 세그먼트가 숫자가 아니면(prefix 안에 숫자 세그먼트) 스킵되지 않도록,
    // 여기서는 "…-<digits>" 로 끝나는 형태만 채택.
    out.push({ id: m[0], prefix: m[1], numStr: m[2], num: parseInt(m[2], 10) });
  }
  return out;
}

// 제목에서 TC ID 목록을 뽑는다. 대괄호 그룹 우선, 없으면 전체 스캔.
// 대괄호 안에 '~' 와 동일 prefix 두 토큰이면 숫자 범위로 전개한다.
function parseTcIds(title) {
  const raw = String(title == null ? '' : title);
  const ids = [];
  const brackets = raw.match(/\[([^\]]+)\]/g);
  const scopes = brackets && brackets.length
    ? brackets.map(b => b.slice(1, -1))
    : [raw];

  for (const scope of scopes) {
    const toks = scanTokens(scope);
    if (toks.length === 0) continue;
    const isRange = /~|∼|～|-\s*(?:to|~)/.test(scope) || scope.includes('~');
    if (isRange && toks.length >= 2 && toks[0].prefix === toks[toks.length - 1].prefix) {
      const a = toks[0], b = toks[toks.length - 1];
      const lo = Math.min(a.num, b.num), hi = Math.max(a.num, b.num);
      const width = Math.max(a.numStr.length, b.numStr.length);
      for (let n = lo; n <= hi; n++) {
        ids.push(`${a.prefix}-${String(n).padStart(width, '0')}`);
      }
    } else {
      for (const t of toks) ids.push(t.id);
    }
  }
  // 중복 제거(순서 유지)
  return [...new Set(ids)];
}

// ── 유틸 ──────────────────────────────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function firstErrorLine(result) {
  const errs = (result && result.errors) || [];
  for (const e of errs) {
    const msg = (e && typeof e === 'object') ? (e.message || '') : String(e || '');
    const clean = msg.replace(ANSI_RE, '').trim();
    if (clean) return clean.split('\n')[0].slice(0, 300);
  }
  return null;
}

// 에러 본문 앞부분 — 자연어 번역(error-humanize)에 필요한 Locator/Expected/Timeout 줄까지 보존
function errorDetailOf(result) {
  const errs = (result && result.errors) || [];
  for (const e of errs) {
    const msg = (e && typeof e === 'object') ? (e.message || '') : String(e || '');
    const clean = msg.replace(ANSI_RE, '').trim();
    if (clean) return clean.slice(0, 800);
  }
  return null;
}

// 폴더명에서 거래소 추출: "[Binance] trade-order" → { exchange:'Binance', suite:'trade-order' }
function parseFolderName(name) {
  const m = String(name || '').match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) return { exchange: m[1].trim(), suite: m[2].trim() || name };
  return { exchange: null, suite: String(name || '') };
}

// ── 입력 해석: dir / index.html / html 문자열 ───────────────────────────────
function resolveInput(input) {
  // { html, dir } 형태
  if (input && typeof input === 'object') {
    return { html: input.html || null, dir: input.dir || null, indexPath: input.indexPath || null };
  }
  const p = String(input);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
    return { html: null, dir: p, indexPath: path.join(p, 'index.html') };
  }
  // 파일 경로(index.html)
  return { html: null, dir: path.dirname(p), indexPath: p };
}

function readHtml(resolved) {
  if (resolved.html) return resolved.html;
  if (resolved.indexPath && fs.existsSync(resolved.indexPath)) {
    return fs.readFileSync(resolved.indexPath, 'utf8');
  }
  return null;
}

const B64_RE = /id=["']playwrightReportBase64["'][^>]*>\s*data:application\/zip;base64,([A-Za-z0-9+/=]+)/;

// ── supports ────────────────────────────────────────────────────────────
function supports(input) {
  try {
    const resolved = resolveInput(input);
    const html = readHtml(resolved);
    if (!html) return false;
    return B64_RE.test(html) || /<title>\s*Playwright Test Report/i.test(html);
  } catch {
    return false;
  }
}

// ── 임베드 report.json 추출 ─────────────────────────────────────────────────
function extractReport(html) {
  const m = html.match(B64_RE);
  if (!m) throw new Error('playwrightReportBase64 스크립트를 찾지 못했습니다. Playwright HTML 리포트가 아닙니다.');
  const buf = Buffer.from(m[1], 'base64');
  const zip = new AdmZip(buf);
  const readJson = (name) => {
    const entry = zip.getEntry(name);
    if (!entry) return null;
    return JSON.parse(zip.readAsText(entry));
  };
  const report = readJson('report.json');
  if (!report) throw new Error('임베드 zip 안에 report.json 이 없습니다.');
  return { report, readJson };
}

// ── parse ─────────────────────────────────────────────────────────────────
// opts: { exchange, snapshot, source } — 미지정 시 폴더명/기본값으로 추론.
function parse(input, opts = {}) {
  const resolved = resolveInput(input);
  const html = readHtml(resolved);
  if (!html) throw new Error(`index.html 을 읽을 수 없습니다: ${resolved.indexPath}`);

  const { report, readJson } = extractReport(html);

  const folderName = resolved.dir ? path.basename(resolved.dir) : '';
  const fromFolder = parseFolderName(folderName);
  const exchange = opts.exchange != null ? opts.exchange : fromFolder.exchange;
  const suite = opts.suite || fromFolder.suite;
  const snapshot = opts.snapshot != null ? opts.snapshot : null;
  const source = opts.source || 'automation';
  const dir = resolved.dir;

  const rows = [];

  for (const f of report.files || []) {
    const detail = readJson(`${f.fileId}.json`);
    const specFile = (detail && detail.fileName) || f.fileName || suite;
    const tests = (detail && detail.tests) || [];
    for (const t of tests) {
      const lastResult = (t.results && t.results[t.results.length - 1]) || {};
      const result = mapOutcome(t.outcome);
      const flaky = t.outcome === 'flaky';
      const reasonNote = t.outcome === 'unexpected' || flaky ? firstErrorLine(lastResult) : null;
      const errorDetail = t.outcome === 'unexpected' || flaky ? errorDetailOf(lastResult) : null;
      const env = t.projectName || null;
      const durationMs = typeof t.duration === 'number' ? t.duration : null;

      // 첨부: 메타데이터만(§ 사용자 확정 — 813MB 원본 미복제, 경로 참조).
      const attachments = [];
      for (const r of (t.results || [])) {
        for (const a of (r.attachments || [])) {
          if (!a || !a.path) continue; // body 인라인(stdout 등)은 첨부 파일 아님 → 제외
          const rel = a.path;
          const abs = dir ? path.join(dir, rel) : null;
          attachments.push({
            name: a.name,
            contentType: a.contentType || null,
            path: rel,
            exists: abs ? fs.existsSync(abs) : null,
          });
        }
      }

      const tcIds = parseTcIds(t.title);
      const base = {
        source, result, resultRaw: t.outcome,
        exchange, env, snapshot,
        reasonNote, durationMs,
        title: t.title, suite: specFile,
        flaky, attachments,
        testId: t.testId || null, // 원본 리포트 딥링크(index.html#?testId=…)용
        errorDetail,              // 자연어 번역용 에러 본문 앞부분
      };

      if (tcIds.length === 0) {
        rows.push({ ...base, tcId: null, untagged: true, coveredByMulti: false });
      } else {
        const multi = tcIds.length > 1;
        for (const tcId of tcIds) {
          rows.push({ ...base, tcId, untagged: false, coveredByMulti: multi });
        }
      }
    }
  }

  const detected = {
    source, exchange, snapshot, suite,
    projectNames: report.projectNames || [],
    startTime: report.startTime || null,
    durationMs: report.duration || null,
    stats: report.stats || null,
  };

  return { rows, detected };
}

// ── 편의: 리포트 폴더들이 모인 루트 디렉토리를 통째로 파싱 ───────────────────
// rootDir 아래 각 하위 폴더(= 리포트 1건)를 parse 해서 합친다.
// 반환: { rows, reports:[{folder, detected, rowCount}] }
function parseFolders(rootDir, opts = {}) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'));
  const allRows = [];
  const reports = [];
  for (const d of entries) {
    const dir = path.join(rootDir, d.name);
    if (!supports(dir)) continue;
    const { rows, detected } = parse(dir, opts);
    allRows.push(...rows);
    reports.push({ folder: d.name, detected, rowCount: rows.length });
  }
  return { rows: allRows, reports };
}

module.exports = {
  supports,
  parse,
  parseFolders,
  parseTcIds,
  mapOutcome,
  parseFolderName,
  OUTCOME_MAP,
};
