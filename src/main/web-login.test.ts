import { describe, it, expect, vi } from 'vitest';
import { runWebLogin, waitForSelector, fillScript, type ScriptRunner } from './web-login';

function fakeRunner(answer: (js: string, n: number) => unknown): ScriptRunner & { calls: string[] } {
  const calls: string[] = [];
  return { calls, run: async (js) => { calls.push(js); return answer(js, calls.length); } };
}
const noSleep = { sleep: async () => {}, pollMs: 0 };

describe('runWebLogin', () => {
  it('stops at a present skipIfPresent marker', async () => {
    const r = fakeRunner(() => true);
    const res = await runWebLogin(r, [{ action: 'skipIfPresent', selector: '#home' }, { action: 'click', selector: '#login' }], noSleep);
    expect(res).toEqual({ completed: 0, skipped: true });
    expect(r.calls).toHaveLength(1);
  });
  it('continues past an absent skipIfPresent marker', async () => {
    const r = fakeRunner(() => false);
    const res = await runWebLogin(r, [{ action: 'skipIfPresent', selector: '#home' }, { action: 'click', selector: '#login' }], noSleep);
    expect(res).toEqual({ completed: 2, skipped: false });
  });
  it('continues after a waitFor timeout', async () => {
    const r = fakeRunner(() => false);
    const res = await runWebLogin(r, [{ action: 'waitFor', selector: '#x' }, { action: 'click', selector: '#y' }], { ...noSleep, waitTimeoutMs: 0 });
    expect(res.completed).toBe(2);
  });
  it('continues after a step throws', async () => {
    const r = fakeRunner((_js, n) => { if (n === 1) throw new Error('navigating'); return true; });
    const res = await runWebLogin(r, [{ action: 'click', selector: '#a' }, { action: 'click', selector: '#b' }], noSleep);
    expect(res.completed).toBe(2);
    expect(r.calls).toHaveLength(2);
  });
  it('honours delayMs after a step', async () => {
    const sleep = vi.fn(async () => {});
    const r = fakeRunner(() => true);
    await runWebLogin(r, [{ action: 'click', selector: '#a', delayMs: 500 }], { sleep });
    expect(sleep).toHaveBeenCalledWith(500);
  });
});

describe('scripts', () => {
  it('fill escapes selector and value and fires input and change', () => {
    const js = fillScript('input[name="user"]', 'p"w');
    expect(js).toContain(JSON.stringify('input[name="user"]'));
    expect(js).toContain(JSON.stringify('p"w'));
    expect(js).toContain("new Event('input'");
    expect(js).toContain("new Event('change'");
  });
});

describe('waitForSelector', () => {
  it('resolves true once the selector appears', async () => {
    const r = fakeRunner((_js, n) => n >= 3);
    expect(await waitForSelector(r, '#x', { ...noSleep, waitTimeoutMs: 1000 })).toBe(true);
    expect(r.calls).toHaveLength(3);
  });
});
