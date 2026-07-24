// tr-run-reporter — TR Portal 수행 보드 실시간 리포터 (test-run R2)
// ─────────────────────────────────────────────────────────────────────────
// Playwright 커스텀 리포터 단일 파일. 테스트가 끝날 때마다(onTestEnd) 결과를
// 수행 보드의 자동 🤖 칸으로 push 한다. 의존성 없음(Node 내장 http/https만).
//
// 설치: 이 파일을 프로젝트에 두고 playwright.config.ts 에 한 줄 추가
//
//   reporter: [['list'], ['./tr-run-reporter.js']],
//
// 값 주입은 환경변수 권장 (QA 가 보드의 "자동화 연동"에서 복사해 전달):
//
//   TR_BASE=https://tr.rgrg.im TR_RUN_ID=<보드ID> TR_TOKEN=<업로드토큰> \
//   TR_EXCHANGE=Binance APP_VERSION=v1.2.4 npx playwright test
//
// 또는 리포터 옵션: ['./tr-run-reporter.js', { base, runId, token, exchange, version }]
// (우선순위: 옵션 > 환경변수. 거래소는 TR_EXCHANGE 미지정 시 Playwright project 명의
//  "[Binance] ..." 프리픽스로 서버가 추론한다. 버전은 APP_VERSION → 보드 현재 버전 폴백)
//
// 동작 원칙 — 테스트 실행을 방해하지 않는 fire-and-forget:
//   · 3초 간격 배치 전송(최대 50건), 실패 시 버퍼에 되돌려 재시도 (버퍼 상한 1000건)
//   · 네트워크 오류는 경고 로그만 남기고 테스트는 계속 진행
//   · 실행 종료(onEnd) 시 남은 버퍼를 최대 3회 재시도 후 요약 출력

'use strict';

const ANSI_RE = /\x1b\[[0-9;]*m/g;

class TrRunReporter {
  constructor(options = {}) {
    this.base = String(options.base || process.env.TR_BASE || '').replace(/\/$/, '');
    this.runId = options.runId || process.env.TR_RUN_ID || '';
    this.token = options.token || process.env.TR_TOKEN || '';
    this.exchange = options.exchange || process.env.TR_EXCHANGE || '';
    this.version = options.version || process.env.APP_VERSION || '';
    this.enabled = !!(this.base && this.runId && this.token);
    this.buffer = [];
    this.sent = 0;
    this.failedPushes = 0;
    this.timer = null;
    if (!this.enabled) {
      console.warn('[tr-run-reporter] TR_BASE/TR_RUN_ID/TR_TOKEN 미설정 — 전송 비활성 (테스트는 정상 진행)');
    }
  }

  printsToStdio() { return false; }

  onBegin() {
    if (!this.enabled) return;
    this.timer = setInterval(() => { this._flush().catch(() => {}); }, 3000);
    if (this.timer.unref) this.timer.unref();
  }

  onTestEnd(test, result) {
    if (!this.enabled) return;
    let project = '';
    try { project = (test.parent && test.parent.project() && test.parent.project().name) || ''; } catch (_) { /* 구버전 호환 */ }
    let error = null;
    const errs = result.errors || [];
    for (const e of errs) {
      const msg = ((e && e.message) || String(e || '')).replace(ANSI_RE, '').trim();
      if (msg) { error = msg.split('\n')[0].slice(0, 300); break; }
    }
    if (this.buffer.length >= 1000) this.buffer.shift(); // 상한 — 가장 오래된 것부터 포기
    this.buffer.push({
      title: test.title,
      status: result.status,        // passed | failed | timedOut | interrupted | skipped
      error,
      durationMs: result.duration,
      project,                       // "[Binance] ..." 형태면 서버가 거래소 추론
    });
  }

  async _flush(maxRetry = 0) {
    if (!this.buffer.length) return;
    const batch = this.buffer.splice(0, 50);
    const body = JSON.stringify({
      exchange: this.exchange || undefined,
      version: this.version || undefined,
      results: batch,
    });
    for (let attempt = 0; ; attempt++) {
      try {
        const resp = await this._post(`/api/runs/${this.runId}/auto-results`, body);
        this.sent += batch.length;
        if (resp && resp.untagged) this._untagged = (this._untagged || 0) + resp.untagged;
        return;
      } catch (e) {
        if (attempt >= maxRetry) {
          this.buffer.unshift(...batch); // 되돌려 다음 주기 재시도
          this.failedPushes++;
          if (this.failedPushes <= 3) console.warn(`[tr-run-reporter] 전송 실패(재시도 예정): ${e.message}`);
          return;
        }
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  _post(path, body) {
    return new Promise((resolve, reject) => {
      let url;
      try { url = new URL(this.base + path); } catch (e) { return reject(new Error('TR_BASE URL 형식 오류')); }
      const lib = url.protocol === 'https:' ? require('https') : require('http');
      const req = lib.request({
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': `Bearer ${this.token}`,
        },
        timeout: 10000,
      }, (r) => {
        let data = '';
        r.on('data', (c) => { data += c; });
        r.on('end', () => {
          if (r.statusCode === 200) {
            try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
          } else {
            let msg = `HTTP ${r.statusCode}`;
            try { msg += ` — ${JSON.parse(data).error}`; } catch (_) { /* 본문 없음 */ }
            reject(new Error(msg));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.end(body);
    });
  }

  async onEnd() {
    if (!this.enabled) return;
    if (this.timer) clearInterval(this.timer);
    // 남은 버퍼 최종 전송 — 배치 단위로 최대 3회 재시도
    let guard = 0;
    while (this.buffer.length && guard++ < 40) {
      const before = this.buffer.length;
      await this._flush(3);
      if (this.buffer.length >= before) break; // 진전 없음 — 포기
    }
    const dropped = this.buffer.length;
    const parts = [`전송 ${this.sent}건`];
    if (this._untagged) parts.push(`미태그 ${this._untagged}건(보드 매칭 불가 — 제목에 [SC-…] 태그 필요)`);
    if (dropped) parts.push(`실패 ${dropped}건(서버 연결 확인 필요)`);
    console.log(`[tr-run-reporter] ${parts.join(' · ')} → ${this.base}`);
  }
}

module.exports = TrRunReporter;
