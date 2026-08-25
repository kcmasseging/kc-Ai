import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync('public/app.js', 'utf8');

describe('Owner Board status reliability contract', () => {
  it('resolves Tasks and capabilities from real API values', () => {
    expect(app).toContain("api('/api/v1/tasks',{signal:request?.controller.signal})");
    expect(app).toContain("data.tasks.length?`${data.tasks.length} total`:'None yet'");
    expect(app).toContain("api('/api/v1/capabilities',{signal:request?.controller.signal})");
    expect(app).toContain("String(available.length)");
  });

  it('settles Verification and KC Browser independently', () => {
    expect(app).toContain('Promise.allSettled');
    expect(app).toContain("verificationResult.value.status==='READY'?'Verified':verificationResult.value.status");
    expect(app).toContain("$('board-browser-status').textContent=configured?'Ready':'Needs setup'");
  });

  it('clears loading states for HTTP errors, malformed data, and timeouts', () => {
    expect(app).toContain("timeoutError.code='TIMEOUT'");
    expect(app).toContain('finally{clearTimeout(timeout)}');
    expect(app).toContain("error.code==='TIMEOUT'?'Retry':'Unavailable'");
    expect(app).toContain("settleOwnerBoard('Retry')");
  });

  it('waits for owner restoration and cancels invalid-session refreshes', () => {
    expect(app).toContain('state.authReady=false');
    expect(app).toContain("await api('/api/v1/owner/secret-bus/status')");
    expect(app).toContain("if(!state.token||!state.authReady)return");
    expect(app).toContain('state.statusRequest?.controller.abort()');
    expect(app).toContain('if(error.status===401){clearOwnerSession();show(\'home\')}');
  });

  it('makes retries start a fresh owner refresh', () => {
    expect(app).toContain("$('owner-retry').onclick=()=>");
    expect(app).toContain('refreshOwnerData()');
    expect(app).toContain('state.statusRequest?.controller.abort()');
  });

  it('prevents stale responses from repainting newer refreshes', () => {
    expect(app).toContain('function isCurrentStatusRequest(request)');
    expect(app).toContain('if(request&&!isCurrentStatusRequest(request))return');
    expect(app).toContain('state.statusRequest=request');
  });
});
