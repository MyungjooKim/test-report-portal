// Playwright 에러 자연어 번역 — "왜 실패했나요" (QA 요약 페이지 방식 이식, 2026-07-22)
// 규칙 기반: assertion 유형별 문장 틀 + testid→한국어 요소명 사전(lib/data/testid-ko.json,
// QA팀 요약 HTML 에서 역추출). 사전에 없는 요소는 testid 원문을 그대로 따옴표로 표기.
// 매칭 실패 시 null 반환 — 호출측은 원문만 표시하면 된다(오역 없음 원칙).

const TESTID_KO = require('./data/testid-ko.json');

function elementName(locatorLine) {
  if (!locatorLine) return null;
  let m = locatorLine.match(/getByTestId\('([^']+)'\)/);
  if (m) return TESTID_KO[m[1]] || m[1];
  m = locatorLine.match(/getByText\('([^']+)'/);
  if (m) return `"${m[1]}" 텍스트`;
  m = locatorLine.match(/getByRole\('([^']+)'(?:,\s*\{\s*name:\s*'([^']*)')?/);
  if (m) return m[2] ? `'${m[2]}' ${m[1]}` : `${m[1]} 요소`;
  return locatorLine.replace(/^locator\(|\)$/g, '').slice(0, 60);
}

// 에러 본문에서 구조화 필드 추출
function parseError(text) {
  const s = String(text || '');
  const firstLine = s.split('\n')[0].trim();
  const matcher = (firstLine.match(/expect\([^)]*\)\.(\w+)\(/) || [])[1] || null;
  const locator = (s.match(/Locator:\s*(.+)/) || [])[1] || null;
  const timeout = (s.match(/Timeout:\s*(\d+)ms/) || [])[1] || null;
  const expected = (s.match(/Expected(?: string| pattern| value)?:\s*(.+)/) || [])[1] || null;
  const received = (s.match(/Received(?: string| value)?:\s*(.+)/) || [])[1] || null;
  const notFound = /element\(s\) not found/.test(s);
  const timeoutErr = (firstLine.match(/^TimeoutError:\s*(?:locator|page)\.(\w+)/) || [])[1] || null;
  return { firstLine, matcher, locator, timeout, expected, received, notFound, timeoutErr };
}

const trimVal = v => v ? String(v).trim().replace(/^["']|["']$/g, '').slice(0, 60) : null;

function humanizeError(text) {
  if (!text) return null;
  const e = parseError(text);
  const el = elementName(e.locator);
  const q = el ? `'${el}'` : '해당';

  if (e.matcher === 'toBeVisible') {
    return `${q} 요소가 화면에 나타나야 했지만, ${e.timeout ? e.timeout + 'ms 안에 ' : ''}나타나지 않았어요.`;
  }
  if (e.matcher === 'toBeHidden') {
    return `${q} 요소가 사라져야 했지만, ${e.timeout ? e.timeout + 'ms 안에 ' : ''}사라지지 않았어요.`;
  }
  if (e.matcher === 'toHaveText' || e.matcher === 'toContainText') {
    if (e.notFound) {
      const exp = trimVal(e.expected);
      return `${q} 요소가 화면에 나타나지 않아 텍스트를 확인할 수 없었어요.${exp ? ` (기대했던 문구: "${exp}")` : ''}`;
    }
    const exp = trimVal(e.expected), got = trimVal(e.received);
    return `${q} 요소의 텍스트가 기대와 달랐어요.${exp ? ` (기대: "${exp}"${got ? ` / 실제: "${got}"` : ''})` : ''}`;
  }
  if (e.matcher === 'toHaveValue') {
    return `${q} 입력창의 값이 기대와 달랐어요.`;
  }
  if (e.matcher === 'toHaveCount') {
    return `${q} 요소의 개수가 기대와 달랐어요.${e.expected ? ` (기대: ${trimVal(e.expected)}${e.received ? ` / 실제: ${trimVal(e.received)}` : ''})` : ''}`;
  }
  if (e.matcher === 'toBeDisabled') {
    return `${q} 요소가 비활성화(눌리지 않는 상태)여야 했지만, 실제로는 눌리는 상태였어요.`;
  }
  if (e.matcher === 'toBeEnabled') {
    return `${q} 요소가 활성화(누를 수 있는 상태)여야 했지만, 실제로는 눌리지 않는 상태였어요.`;
  }
  if (e.matcher === 'toBeGreaterThan' || e.matcher === 'toBeGreaterThanOrEqual' || e.matcher === 'toBeLessThan') {
    const dir = e.matcher === 'toBeLessThan' ? '작아야' : '커야';
    if (e.expected != null && e.received != null) {
      return `값이 ${trimVal(e.expected)} 보다 ${dir} 했지만, 실제로는 ${trimVal(e.received)}(으)로 조건을 만족하지 못했어요. (예: 목록이 비어있거나 데이터가 갱신되지 않음)`;
    }
    return `값이 크기 조건(${e.matcher})을 만족하지 못했어요.`;
  }
  if (e.matcher === 'toEqual' || e.matcher === 'toBe' || e.matcher === 'toStrictEqual') {
    return '코드에서 계산되거나 확인한 값이 기대와 달랐어요.';
  }
  if (e.matcher === 'toBeChecked') {
    return `${q} 체크박스 상태가 기대와 달랐어요.`;
  }
  if (e.matcher) {
    return el
      ? `'${el}' 요소가 '${e.matcher}' 조건을 만족하지 못했어요.`
      : `확인한 값이 '${e.matcher}' 조건을 만족하지 못했어요.`;
  }
  if (e.timeoutErr === 'textContent' || e.timeoutErr === 'innerText') {
    return '해당 요소의 텍스트를 읽어오려 했지만, 제한 시간 안에 요소를 찾지 못했어요.';
  }
  if (e.timeoutErr) {
    return `제한 시간 안에 '${e.timeoutErr}' 동작을 수행하지 못했어요. (요소를 찾지 못했거나 응답이 없었어요)`;
  }
  return null; // 미지 패턴 — 원문만 표시
}

module.exports = { humanizeError, elementName, parseError, TESTID_KO };
