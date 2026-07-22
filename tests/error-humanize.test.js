// 에러 자연어 번역 테스트 — QA 요약 페이지의 실제 번역 패턴 고정
const { test } = require('node:test');
const assert = require('node:assert');
const { humanizeError, elementName } = require('../lib/error-humanize');

test('toBeVisible + Timeout — 사전 요소명으로 번역', () => {
  const err = `Error: expect(locator).toBeVisible() failed

Locator: getByTestId('modal-order-confirm-container')
Expected: visible
Timeout: 5000ms
Error: element(s) not found`;
  assert.equal(humanizeError(err),
    "'모달창 주문 확인 영역' 요소가 화면에 나타나야 했지만, 5000ms 안에 나타나지 않았어요.");
});

test('toHaveText + element not found — 기대 문구 부기', () => {
  const err = `Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('toast-message-0')
Expected string: "Order failed"
Timeout: 5000ms
Error: element(s) not found`;
  assert.equal(humanizeError(err),
    `'알림 message 0' 요소가 화면에 나타나지 않아 텍스트를 확인할 수 없었어요. (기대했던 문구: "Order failed")`);
});

test('toHaveText 값 불일치 — 기대/실제 부기', () => {
  const err = `Error: expect(locator).toHaveText(expected) failed

Locator: getByTestId('order-entry-size-input')
Expected string: "100"
Received string: "0"`;
  assert.equal(humanizeError(err),
    `'주문 entry 수량 입력창' 요소의 텍스트가 기대와 달랐어요. (기대: "100" / 실제: "0")`);
});

test('toEqual — 값 비교 (요소 없음)', () => {
  assert.equal(humanizeError('Error: expect(received).toEqual(expected) failed\n\nExpected: 3\nReceived: 5'),
    '코드에서 계산되거나 확인한 값이 기대와 달랐어요.');
});

test('toBeGreaterThan — 수치 조건', () => {
  const err = `Error: expect(received).toBeGreaterThan(expected) failed

Expected: 0
Received: 0`;
  assert.equal(humanizeError(err),
    '값이 0 보다 커야 했지만, 실제로는 0(으)로 조건을 만족하지 못했어요. (예: 목록이 비어있거나 데이터가 갱신되지 않음)');
});

test('toBeDisabled — 상태 조건', () => {
  const err = `Error: expect(locator).toBeDisabled() failed

Locator: getByTestId('modal-adjust-leverage-confirm-button')`;
  assert.equal(humanizeError(err),
    "'모달창 조정 레버리지 확인 버튼' 요소가 비활성화(눌리지 않는 상태)여야 했지만, 실제로는 눌리는 상태였어요.");
});

test('TimeoutError textContent — 요소 못 찾음', () => {
  assert.equal(humanizeError('TimeoutError: locator.textContent: Timeout 5000ms exceeded.'),
    '해당 요소의 텍스트를 읽어오려 했지만, 제한 시간 안에 요소를 찾지 못했어요.');
});

test('사전에 없는 testid — 원문 폴백', () => {
  const err = `Error: expect(locator).toBeVisible() failed

Locator: getByTestId('brand-new-element')
Timeout: 3000ms`;
  assert.equal(humanizeError(err),
    "'brand-new-element' 요소가 화면에 나타나야 했지만, 3000ms 안에 나타나지 않았어요.");
});

test('미지 패턴 — null (원문만 표시)', () => {
  assert.equal(humanizeError('Error: page.goto: net::ERR_CONNECTION_REFUSED'), null);
  assert.equal(humanizeError(''), null);
  assert.equal(humanizeError(null), null);
});

test('elementName — getByText/getByRole 변형', () => {
  assert.equal(elementName("getByText('주문하기')"), '"주문하기" 텍스트');
  assert.equal(elementName("getByRole('button', { name: 'Confirm' })"), "'Confirm' button");
});
