// CSV 바이트 → 문자열 디코딩 — BOM/UTF-8 검증 후 CP949(EUC-KR) 폴백.
// XLSX.readFile 은 BOM 없는 CSV 를 cp1252 로 읽어 한글이 깨진다(모지바케 ê²°ê³¼).
// 한국 Excel 의 'CSV(쉼표로 분리)' 저장은 CP949 이므로 UTF-8 강제도 답이 아님 → 순차 감지.
function decodeCsvBuffer(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8'); // UTF-8 BOM (Excel 'CSV UTF-8' 저장)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (_) { /* UTF-8 아님 → CP949 시도 */ }
  try {
    // WHATWG 'euc-kr' = windows-949 (확장 한글 포함)
    return new TextDecoder('euc-kr', { fatal: true }).decode(buf);
  } catch (_) { /* CP949 도 아님 → 손실 감수 */ }
  return buf.toString('utf8');
}

module.exports = { decodeCsvBuffer };
