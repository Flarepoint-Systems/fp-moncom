import type { WebLoginStep } from '../shared/types';

export interface ScriptRunner { run(js: string): Promise<unknown> }

export interface WebLoginOptions {
  waitTimeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const presentScript = (selector: string): string =>
  `!!document.querySelector(${JSON.stringify(selector)})`;

export function fillScript(selector: string, value: string): string {
  const sel = JSON.stringify(selector);
  const val = JSON.stringify(value);
  return (
    `(()=>{const el=document.querySelector(${sel});if(!el)return false;el.focus();` +
    `const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;` +
    `const d=Object.getOwnPropertyDescriptor(proto,'value');(d&&d.set?d.set.call(el,${val}):el.value=${val});` +
    `el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`
  );
}

export const clickScript = (selector: string): string =>
  `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return false;el.click();return true;})()`;

export function webContentsRunner(wc: Electron.WebContents): ScriptRunner {
  return { run: (js) => wc.executeJavaScript(js, true) };
}

/** Wait (poll) for a CSS selector to exist in the page. */
export async function waitForSelector(runner: ScriptRunner, selector: string, opts: WebLoginOptions = {}): Promise<boolean> {
  const { waitTimeoutMs = 15000, pollMs = 300, sleep = realSleep } = opts;
  const start = Date.now();
  while (Date.now() - start < waitTimeoutMs) {
    try {
      if (await runner.run(presentScript(selector))) return true;
    } catch { /* page navigating */ }
    await sleep(pollMs);
  }
  return false;
}

/**
 * Run DOM-driven auto-login steps against a URL zone's BrowserWindow. Uses the
 * native value setter + input/change events so React/Vue-controlled inputs
 * register the change (plain `.value =` doesn't trigger their handlers).
 */
export async function runWebLogin(
  runner: ScriptRunner,
  steps: WebLoginStep[],
  opts: WebLoginOptions = {},
): Promise<{ completed: number; skipped: boolean }> {
  const sleep = opts.sleep ?? realSleep;
  let completed = 0;
  for (const step of steps) {
    try {
      if (step.action === 'skipIfPresent') {
        const present = await runner.run(presentScript(step.selector)).catch(() => false);
        if (present) {
          console.log(`[MonCOM] webLogin: logged-in marker present (${step.selector}), skipping remaining steps`);
          return { completed, skipped: true };
        }
      } else if (step.action === 'waitFor') {
        const ok = await waitForSelector(runner, step.selector, opts);
        if (!ok) console.warn(`[MonCOM] webLogin waitFor timed out: ${step.selector}`);
      } else if (step.action === 'fill') {
        await runner.run(fillScript(step.selector, step.value ?? ''));
      } else if (step.action === 'click') {
        await runner.run(clickScript(step.selector));
      }
    } catch (e) {
      console.error('[MonCOM] webLogin step failed:', step.action, step.selector, e);
    }
    completed++;
    if (step.delayMs && step.delayMs > 0) await sleep(step.delayMs);
  }
  console.log(`[MonCOM] webLogin completed (${steps.length} steps)`);
  return { completed, skipped: false };
}
