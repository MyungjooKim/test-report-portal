// jira-export — Description 생성 규칙 테스트 (plan §Description 생성 규칙과 동기화)
const { test } = require('node:test');
const assert = require('node:assert');
const { collectActions, splitActions, resultSentences, buildDescription } = require('../lib/jira-export');

const STEPS = [
  { title: 'Before Hooks', steps: [
    { title: 'beforeEach hook', steps: [
      { title: 'Navigate to "/"' },
      { title: 'Wait for timeout' },
      { title: "Expect \"toBeHidden\" getByTestId('modal-global-loading')" },
      { title: "Click getByTestId('gnb-trade-link')" },
      { title: "Click getByTestId('gnb-login-button')" },
      { title: 'Fill "myname" getByTestId(\'modal-setting-nickname-container\').locator(\'input\')' },
    ] },
  ] },
  { title: "Expect \"toHaveText\" getByTestId('setting-page-container')" },
  { title: 'After Hooks', steps: [{ title: "Click getByTestId('should-not-appear')" }] },
];

test('collectActions — 액션만 DFS 수집, After Hooks 제외', () => {
  const acts = collectActions(STEPS);
  assert.deepStrictEqual(acts.map(a => a.kind), ['navigate', 'click', 'click', 'fill']);
});

test('splitActions — 접속+메뉴 진입은 Pre-condition, 나머지는 Steps', () => {
  const { pre, steps } = splitActions(collectActions(STEPS));
  assert.deepStrictEqual(pre, ['웹사이트에 접속한다', 'Trade 메뉴를 클릭한다']);
  assert.strictEqual(steps.length, 2);
  assert.match(steps[0], /클릭한다$/);
  assert.match(steps[1], /'myname'\(을\)를 입력한다$/);
});

test('splitActions — 잔여 액션 없으면 steps 비움 (고정 문구는 buildDescription 담당)', () => {
  const { pre, steps } = splitActions(collectActions([
    { title: 'Navigate to "/"' },
    { title: "Click getByTestId('gnb-performance-link')" },
  ]));
  assert.deepStrictEqual(pre, ['웹사이트에 접속한다', 'Performance 메뉴를 클릭한다']);
  assert.deepStrictEqual(steps, []);
});

test('resultSentences — toBeVisible 타임아웃', () => {
  const r = resultSentences([
    'Error: expect(locator).toBeVisible() failed',
    '',
    "Locator: getByTestId('setting-page-container')",
    'Expected: visible',
    'Received: <element(s) not found>',
    'Timeout: 5000ms',
  ].join('\n'));
  assert.strictEqual(r.actual, '5000ms 안에 화면에 나타나지 않았다.');
  assert.match(r.expected, /'설정 페이지 영역' 요소가 5000ms 안에 화면에 나타나야 한다\./);
});

test('resultSentences — toHaveText 기대/실제', () => {
  const r = resultSentences([
    'Error: expect(locator).toHaveText(expected) failed',
    '',
    "Locator: getByTestId('setting-page-container')",
    'Expected string: "Account Name"',
    'Received string: "Name"',
  ].join('\n'));
  assert.strictEqual(r.actual, '"Name"(으)로 표시되었다.');
  assert.match(r.expected, /"Account Name" 문구가 표시되어야 한다\./);
});

test('resultSentences — waitForEvent page(새 탭)', () => {
  const r = resultSentences('TimeoutError: browserContext.waitForEvent: Timeout 5000ms exceeded while waiting for event "page"');
  assert.strictEqual(r.actual, '새 탭이 열리지 않았다.');
  assert.match(r.expected, /새 탭\(팝업 창\)이 열려야 한다\./);
});

test('resultSentences — 값 비교(toBeGreaterThan)', () => {
  const r = resultSentences('Error: expect(received).toBeGreaterThan(expected)\n\nExpected: > 0\nReceived: 0');
  assert.strictEqual(r.actual, '값이 0였다(조건 불만족).');
  assert.strictEqual(r.expected, '값이 0보다 커야 한다.');
});

test('resultSentences — 미지 패턴은 원문 첫 줄 폴백', () => {
  const r = resultSentences('Error: strict mode violation: getByRole(\'slider\') resolved to 2 elements');
  assert.match(r.actual, /^Error: strict mode violation/);
  assert.strictEqual(r.expected, '');
});

test('buildDescription — 4단 틀 + 잔여 액션 없으면 고정 문구', () => {
  const d = buildDescription({
    suiteName: '[Binance] exchange-connect',
    testPath: ['[거래소 연동 확인 - Binance]', '[Trading Performance 메뉴]'],
    actions: collectActions([{ title: 'Navigate to "/"' }, { title: "Click getByTestId('gnb-performance-link')" }]),
    errorText: 'Error: expect(locator).toBeVisible() failed\n\nLocator: getByTestId(\'x\')\nTimeout: 5000ms',
  });
  assert.match(d, /\[Pre-condition\]\n테스트 화면: \[Binance\] exchange-connect \(\[거래소 연동 확인 - Binance\] \/ \[Trading Performance 메뉴\]\)/);
  assert.match(d, /\[Steps\]\n\(사전 조건 상태에서 화면을 그대로 확인\)/);
  assert.match(d, /\[Actual Result\]\n5000ms 안에 화면에 나타나지 않았다\./);
  assert.match(d, /\[Expected Result\]\n.*화면에 나타나야 한다\./);
});
