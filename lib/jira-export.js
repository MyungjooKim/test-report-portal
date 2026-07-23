// Jira 등록용 행 생성 — docs/01-plan/features/jira-export.plan.md §Description 생성 규칙
// Playwright 리포트(임베드 report.json)의 스텝·에러·위치를 예시 시트 양식의 4단 틀
// ([Pre-condition]/[Steps]/[Actual Result]/[Expected Result])로 문장화한다.
// 예시 시트 [SC-SETT-002] 로 1:1 재현 검증된 규칙 — 문장 틀 변경 시 plan 문서와 동기화할 것.
const fs = require('fs');
const path = require('path');
const { extractReport } = require('./adapters/playwright');
const { elementName, parseError } = require('./error-humanize');

// ── 리포트 인덱스: 디렉터리 → testId 별 {test, fileName} ────────────────────
// 내보내기 한 번에 같은 리포트를 반복 열지 않도록 호출측에서 캐시를 들고 온다.
function indexReport(dirAbs) {
  const html = fs.readFileSync(path.join(dirAbs, 'index.html'), 'utf-8');
  const { report, readJson } = extractReport(html);
  const byTestId = new Map();
  for (const f of report.files || []) {
    const detail = readJson(`${f.fileId}.json`);
    for (const t of (detail && detail.tests) || []) {
      if (t.testId) byTestId.set(t.testId, { test: t, fileName: (detail && detail.fileName) || f.fileName });
    }
  }
  return byTestId;
}

// ── 스텝 트리 → 사용자 액션 목록 ────────────────────────────────────────────
// After Hooks/Worker Cleanup(실패 후 정리)은 제외, 순서는 DFS 로 보존.
const SKIP_SUBTREE = /^(After Hooks|Worker Cleanup)/;

function collectActions(steps, out = []) {
  for (const s of steps || []) {
    const title = s.title || '';
    if (SKIP_SUBTREE.test(title)) continue;
    let m;
    if ((m = title.match(/^Navigate to "(.*)"/))) out.push({ kind: 'navigate', to: m[1] });
    else if ((m = title.match(/^Click (.+)/))) out.push({ kind: 'click', locator: m[1] });
    else if ((m = title.match(/^(?:Fill|Type) "((?:[^"\\]|\\.)*)" (.+)/))) out.push({ kind: 'fill', value: m[1], locator: m[2] });
    else if ((m = title.match(/^Press "((?:[^"\\]|\\.)*)" (.+)/))) out.push({ kind: 'press', value: m[1], locator: m[2] });
    else if ((m = title.match(/^(Check|Uncheck) (.+)/))) out.push({ kind: m[1].toLowerCase(), locator: m[2] });
    else if ((m = title.match(/^Select(?:Option)? (?:"((?:[^"\\]|\\.)*)" )?(.+)/i))) out.push({ kind: 'select', value: m[1] || '', locator: m[2] });
    else if ((m = title.match(/^(?:Double click|DblClick) (.+)/i))) out.push({ kind: 'dblclick', locator: m[1] });
    else if ((m = title.match(/^Hover (.+)/))) out.push({ kind: 'hover', locator: m[1] });
    collectActions(s.steps, out);
  }
  return out;
}

const elName = loc => elementName(loc) || String(loc || '').slice(0, 60);

function actionSentence(a) {
  const q = `'${elName(a.locator)}'`;
  switch (a.kind) {
    case 'click': return `${q}을(를) 클릭한다`;
    case 'dblclick': return `${q}을(를) 더블 클릭한다`;
    case 'fill': return `${q}에 '${a.value}'(을)를 입력한다`;
    case 'press': return `${q}에서 '${a.value}' 키를 누른다`;
    case 'check': return `${q}을(를) 체크한다`;
    case 'uncheck': return `${q}의 체크를 해제한다`;
    case 'select': return `${q}에서 '${a.value}'(을)를 선택한다`;
    case 'hover': return `${q}에 마우스를 올린다`;
    default: return null;
  }
}

// ── Pre-condition / Steps 분리 ──────────────────────────────────────────────
// 예시 시트 관행: 접속(Navigate) + 최초 메뉴 진입(gnb-*-link 클릭)까지가 사전 조건,
// 그 뒤 사용자 액션이 [Steps]. 잔여 액션이 없으면 고정 문구.
function splitActions(actions) {
  const pre = [];
  let i = 0;
  if (actions[i] && actions[i].kind === 'navigate') { pre.push('웹사이트에 접속한다'); i++; }
  const menuMatch = actions[i] && actions[i].kind === 'click' &&
    String(actions[i].locator).match(/getByTestId\('gnb-([a-z0-9]+)-link'\)/i);
  if (menuMatch) {
    const menu = menuMatch[1].charAt(0).toUpperCase() + menuMatch[1].slice(1);
    pre.push(`${menu} 메뉴를 클릭한다`);
    i++;
  }
  const steps = actions.slice(i).map(actionSentence).filter(Boolean);
  return { pre, steps };
}

// ── Actual / Expected 문장 ─────────────────────────────────────────────────
const trimVal = v => v ? String(v).trim().replace(/^["']|["']$/g, '').slice(0, 120) : null;

function resultSentences(errorText) {
  if (!errorText) return { actual: '', expected: '' };
  // 어댑터가 ANSI 를 이미 제거하지만, 직접 호출 경로 대비 방어적으로 한 번 더
  const e = parseError(String(errorText).replace(/\x1b\[[0-9;]*m/g, ''));
  const el = elementName(e.locator);
  const q = el ? `'${el}'` : '해당';
  const to = e.timeout ? `${e.timeout}ms` : null;
  const exp = trimVal(e.expected), got = trimVal(e.received);

  if (/browserContext\.waitForEvent.*"page"/.test(e.firstLine)) {
    return { actual: '새 탭이 열리지 않았다.', expected: '버튼 클릭 시 새 탭(팝업 창)이 열려야 한다.' };
  }
  switch (e.matcher) {
    case 'toBeVisible':
      return {
        actual: to ? `${to} 안에 화면에 나타나지 않았다.` : '화면에 나타나지 않았다.',
        expected: `${q} 요소가 ${to ? to + ' 안에 ' : ''}화면에 나타나야 한다.`,
      };
    case 'toBeHidden':
      return { actual: '화면에서 사라지지 않았다.', expected: `${q} 요소가 화면에서 사라져야 한다.` };
    case 'toHaveText':
    case 'toContainText':
      if (e.notFound) {
        return {
          actual: `${q} 요소가 화면에 나타나지 않아 텍스트를 확인할 수 없었다.`,
          expected: `${q} 요소가 화면에 나타나${exp ? `고 "${exp}" 문구를 포함해야 한다` : '야 한다'}.`,
        };
      }
      return {
        actual: got ? `"${got}"(으)로 표시되었다.` : '표시된 텍스트가 기대와 달랐다.',
        expected: `${q} 요소에 ${exp ? `"${exp}" 문구가 ` : '기대한 문구가 '}표시되어야 한다.`,
      };
    case 'toHaveValue':
      return {
        actual: got ? `"${got}"(으)로 입력되어 있었다.` : '입력창의 값이 기대와 달랐다.',
        expected: `${q} 입력창의 값이 ${exp ? `"${exp}"` : '기대한 값'}이어야 한다.`,
      };
    case 'toBeDisabled':
      return { actual: '실제로는 눌리는 상태였다.', expected: `${q} 요소가 비활성화(눌리지 않는 상태)여야 한다.` };
    case 'toBeEnabled':
      return { actual: '실제로는 눌리지 않는 상태였다.', expected: `${q} 요소가 활성화(누를 수 있는 상태)여야 한다.` };
    case 'toHaveCount':
      return {
        actual: got ? `${got}개였다.` : '요소 개수가 기대와 달랐다.',
        expected: `${q} 요소가 ${exp ? exp + '개' : '기대한 개수'}여야 한다.`,
      };
    case 'toHaveAttribute':
      return {
        actual: got ? `속성 값이 "${got}"였다.` : '요소의 속성이 기대와 달랐다.',
        expected: `${q} 요소의 속성이 ${exp ? `"${exp}"` : '기대한 값'}이어야 한다.`,
      };
    case 'toBe':
    case 'toEqual':
    case 'toBeGreaterThan':
    case 'toBeLessThan':
    case 'toBeGreaterThanOrEqual':
    case 'toBeLessThanOrEqual':
      if (!e.locator) {
        const num = exp ? exp.replace(/^[><=]+\s*/, '') : null; // "Expected: > 0" → "0"
        const cond = e.matcher === 'toBeGreaterThan' || e.matcher === 'toBeGreaterThanOrEqual'
          ? `값이 ${num}보다 커야 한다.`
          : e.matcher === 'toBeLessThan' || e.matcher === 'toBeLessThanOrEqual'
            ? `값이 ${num}보다 작아야 한다.`
            : `값이 ${num}여야 한다.`;
        return { actual: `값이 ${got ?? '기대와 다르게 확인'}였다(조건 불만족).`, expected: exp ? cond : '' };
      }
      break;
    default:
      break;
  }
  // 미지 패턴 — 에러 원문 첫 줄 폴백 (오역 없음 원칙)
  return { actual: e.firstLine, expected: '' };
}

// ── Description 4단 틀 조립 ─────────────────────────────────────────────────
function buildDescription({ suiteName, testPath, actions, errorText }) {
  const { pre, steps } = splitActions(actions || []);
  const { actual, expected } = resultSentences(errorText);
  const pathStr = (testPath || []).length ? ` (${testPath.join(' / ')})` : '';
  const lines = [];
  lines.push('[Pre-condition]');
  lines.push(`테스트 화면: ${suiteName}${pathStr}`);
  pre.forEach((p, i) => lines.push(`${i + 1}. ${p}`));
  lines.push('');
  lines.push('[Steps]');
  if (steps.length) steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  else lines.push('(사전 조건 상태에서 화면을 그대로 확인)');
  lines.push('');
  lines.push('[Actual Result]');
  lines.push(actual || '');
  lines.push('');
  lines.push('[Expected Result]');
  lines.push(expected || '');
  return lines.join('\n');
}

// ── 레코드 1건 → Jira 행 ───────────────────────────────────────────────────
// indexCache: Map<dirAbs, Map<testId, {test, fileName}>> — 호출측 공유 캐시.
function buildRow(rec, { reportsBaseAbs, publicBase, indexCache, suiteName: suiteOverride }) {
  const dirAbs = path.join(reportsBaseAbs, rec.reportDirRel);
  if (!indexCache.has(dirAbs)) indexCache.set(dirAbs, indexReport(dirAbs));
  const entry = indexCache.get(dirAbs).get(rec.testId);
  if (!entry) throw new Error(`리포트에서 테스트를 찾지 못함 (testId: ${rec.testId})`);
  const { test } = entry;
  const lastResult = (test.results && test.results[test.results.length - 1]) || {};
  const actions = collectActions(lastResult.steps);
  // 스위트 = 소스(리포트 폴더) 이름 — 단일 리포트 ZIP 은 폴더명이 UUID 라 소스명 우선
  const suiteName = suiteOverride || path.basename(rec.reportDirRel);
  const errorText = rec.errorDetail || rec.reasonNote || '';

  const urlPath = p => encodeURI(p).replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/#/g, '%23');
  const screenshots = (rec.attachments || [])
    .filter(a => a.path && /^image\//.test(a.contentType || '') && a.exists !== false)
    .map(a => publicBase + urlPath(`/uploads/${rec.reportDirRel}/${a.path}`));

  return {
    issueType: 'Bug',
    suite: suiteName,
    summary: test.title,
    description: buildDescription({ suiteName, testPath: test.path, actions, errorText }),
    specLoc: test.location ? `${test.location.file}:${test.location.line}` : '',
    screenshot: screenshots.join('\n'),
    jira: '',
    link: '',
  };
}

// ── 매뉴얼 전용 Fail → Jira 행 (P5) ─────────────────────────────────────────
// 매뉴얼 TC 문서의 사전조건/스텝/기대결과 컬럼(어댑터가 수집)을 그대로 4단 틀에 배치.
// Actual Result 는 결과 시트의 사유(특이사항) 텍스트, 없으면 환경별 결과 요약.
function buildManualRow(rec, { suiteName } = {}) {
  const suite = suiteName || rec.sheet || '';
  const envSummary = (rec.envResults || []).map(e => `${e.env}: ${e.result}`).join(', ');
  const lines = [];
  lines.push('[Pre-condition]');
  if (suite) lines.push(`테스트 화면: ${suite}`);
  if (rec.precondition) lines.push(rec.precondition);
  lines.push('');
  lines.push('[Steps]');
  lines.push(rec.steps || '(TC 문서에 스텝 없음)');
  lines.push('');
  lines.push('[Actual Result]');
  lines.push(rec.reasonNote || rec.naReason || (envSummary ? `${envSummary} (매뉴얼 판정)` : 'Fail (매뉴얼 판정)'));
  lines.push('');
  lines.push('[Expected Result]');
  lines.push(rec.expected || '');
  return {
    issueType: 'Bug',
    suite,
    summary: `[${rec.tcId}]${rec.title ? ' ' + rec.title : ''}`,
    description: lines.join('\n'),
    specLoc: rec.sheet ? `시트: ${rec.sheet}` : '',
    screenshot: '',
    jira: '',
    link: '',
  };
}

module.exports = { buildRow, buildManualRow, buildDescription, collectActions, splitActions, resultSentences, indexReport };
