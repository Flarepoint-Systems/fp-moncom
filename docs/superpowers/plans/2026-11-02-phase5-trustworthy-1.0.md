# Phase 5: Trustworthy 1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the free MonCOM app into a 1.0 a stranger can download from flarepoint.nl and rely on: tested core logic, encrypted login secrets, preset export and import with a monitor remap preview, and an update feed that no longer depends on GitHub.

**Architecture:** The logic that breaks the wall silently (zone geometry, monitor rematch, the web-login runner, secret sealing, preset file handling) is pulled out of the Electron-coupled modules into pure TypeScript modules with no `electron` or `koffi` import, so Vitest can run them on the Linux dev machine and in CI. The Electron modules keep their current shape and call into the pure modules. Secrets are sealed with Electron `safeStorage` on save and unsealed only at launch, so the renderer never holds a stored secret. Distribution moves to a generic electron-updater feed on the Flarepoint CDN, with GitHub releases kept as the build origin that the CDN pulls from.

**Tech Stack:** Electron 41, TypeScript 5.9, React 19, Vite 8, esbuild, Vitest 5, electron-builder (generic publish provider), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-31-moncom-pro-direction-design.md`, section "Phase 5: Trustworthy 1.0", plus the constraints section. Read both before any task.

## Global Constraints

- Runtime dependencies stay exactly `electron-store`, `electron-updater`, `koffi`. Vitest is a devDependency only.
- Node >= 20.19 (use `nvm use 20` locally, the dev machine runs Node 24 which also works).
- Modules under test must not import `electron` or `koffi`, directly or transitively. Tests run on Linux and in CI on `ubuntu-latest`.
- Nothing is added to the launch path between "apply" and "windows placed" except the unseal of login values, which is a pure in-memory transform.
- No PowerShell anywhere on the launch or playback path.
- All exe comparisons go through `normalizeExe` (`src/shared/exe.ts`). All monitor ids come from `getStableMonitors` (`src/main/monitors.ts`).
- Microcopy house style (from `project/claude.md`): descriptive voice, third person, leads with a verb ("Opens…", "Saves…"), one sentence, sentence case, ends with a period, no em dashes, no internal jargon in the UI.
- Prose in docs and commit bodies: no em-dashes, no semicolons.
- Commit messages follow the repo's `type: summary` form (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`).
- The working tree starts with an uncommitted `package-lock.json` change left by an earlier `npm install`. Task 1's `npm install` rewrites the lockfile anyway, so commit the lockfile in Task 1 and nowhere else unless a task installs a package.

## Review Focus

Inputs the spec implies but no existing code handles. Each line has a test pinned to the task that owns it.

1. `safeStorage` unavailable (no OS keyring, DPAPI failure). A preset must still save and launch, values stay plain, one log line. Test in Task 5 (`sealValue leaves plain text when codec unavailable`).
2. A sealed value that cannot be unsealed must never be typed into a login field as ciphertext. Test in Task 5 (`unsealValue returns empty string when codec unavailable`).
3. A preset saved twice without touching its login must not double-seal and must not lose the value. Test in Task 5 (`sealPreset is idempotent`).
4. Importing a file that is not a MonCOM preset, or one from a newer version, must fail with a plain message and save nothing. Test in Task 7 (`parsePresetFile rejects …`).
5. Importing a preset from a wall with different monitors must list every zone as not connected and still allow the import, so the user can re-assign in the editor. Test in Task 7 (`planImport with no matching monitors`).
6. Zone geometry on odd monitor widths (1366, fractional scaling) must leave no 1px gap or overlap between adjacent zones. Test in Task 2 (`3x3 on 1366x768 shares edges`).

---

### Task 1: Test harness and CI

**Files:**
- Create: `vitest.config.ts`
- Create: `src/shared/exe.test.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json` (scripts, devDependencies), `package-lock.json`

**Interfaces:**
- Produces: `npm test` runs `vitest run` over `src/**/*.test.ts` in the `node` environment. Every later task adds tests under that glob.

- [ ] **Step 1: Install Vitest and add the script**

```bash
npm install --save-dev vitest@^5
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write `vitest.config.ts`**

`defineConfig({ test: { include: ['src/**/*.test.ts'], environment: 'node' } })` from `vitest/config`. No globals, tests import from `vitest`.

- [ ] **Step 3: Write the first test**

```ts
// src/shared/exe.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeExe } from './exe';

describe('normalizeExe', () => {
  it('strips path, extension, whitespace and case', () => {
    expect(normalizeExe('C:\\Apps\\DSS Client.exe')).toBe('dss client');
    expect(normalizeExe('DSSClient.EXE')).toBe('dssclient');
    expect(normalizeExe('  Spotify ')).toBe('spotify');
  });
  it('returns empty for empty input', () => {
    expect(normalizeExe('')).toBe('');
  });
});
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npm test && npm run check`
Expected: 2 tests pass, both typechecks clean. Test files import everything from `vitest`, so no global type setup is needed.

- [ ] **Step 5: Write the CI workflow**

`.github/workflows/ci.yml`: on `push` (all branches) and `pull_request`. One job on `ubuntu-latest`: checkout, setup-node 20 with npm cache, `npm ci` with env `ELECTRON_SKIP_BINARY_DOWNLOAD=1`, `npm run check`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/shared/exe.test.ts .github/workflows/ci.yml
git commit -m "test: add vitest and a CI workflow for typecheck and tests"
```

---

### Task 2: Zone geometry module

**Files:**
- Create: `src/shared/zone-geometry.ts`
- Create: `src/shared/zone-geometry.test.ts`
- Modify: `src/main/window-manager.ts:379-382`, `src/main/automation-manager.ts:21-24`, `src/renderer/pages/LayoutEditorPage.tsx:7-45` (template data)

**Interfaces:**
- Produces:
  - `export interface Rect { x: number; y: number; width: number; height: number }`
  - `export type NormalizedRect = Rect` (values 0..1, relative to a monitor)
  - `export function zoneToScreenRect(zone: NormalizedRect, monitor: Rect): Rect`. Pixel edges are computed from the normalized edges: `left = round(mx + zx * mw)`, `right = round(mx + (zx + zw) * mw)`, `width = right - left`, same for y. Adjacent zones therefore share an edge.
  - `export const SPLIT_TEMPLATES: ReadonlyArray<{ name: string; zones: NormalizedRect[] }>` with the six templates and exact names `'Full'`, `'2 Columns'`, `'2 Rows'`, `'2x2 Grid'`, `'3x3 Grid'`, `'Main + Side'` and the normalized rects currently at `LayoutEditorPage.tsx:13-45`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shared/zone-geometry.test.ts
import { describe, it, expect } from 'vitest';
import { zoneToScreenRect, SPLIT_TEMPLATES } from './zone-geometry';

describe('zoneToScreenRect', () => {
  it('maps a full zone onto a monitor left of the primary', () => {
    expect(zoneToScreenRect({ x: 0, y: 0, width: 1, height: 1 }, { x: -1920, y: 0, width: 1920, height: 1080 }))
      .toEqual({ x: -1920, y: 0, width: 1920, height: 1080 });
  });
  it('3x3 on 1366x768 shares edges with no gap or overlap', () => {
    const grid = SPLIT_TEMPLATES.find(t => t.name === '3x3 Grid')!;
    const mon = { x: 0, y: 0, width: 1366, height: 768 };
    const rects = grid.zones.map(z => zoneToScreenRect(z, mon));
    for (let row = 0; row < 3; row++) {
      const cells = rects.slice(row * 3, row * 3 + 3);
      expect(cells[0].x).toBe(0);
      expect(cells[0].x + cells[0].width).toBe(cells[1].x);
      expect(cells[1].x + cells[1].width).toBe(cells[2].x);
      expect(cells[2].x + cells[2].width).toBe(1366);
    }
  });
});

describe('SPLIT_TEMPLATES', () => {
  it('has the six built-in templates in order', () => {
    expect(SPLIT_TEMPLATES.map(t => t.name)).toEqual(['Full', '2 Columns', '2 Rows', '2x2 Grid', '3x3 Grid', 'Main + Side']);
  });
  it('every template covers the monitor exactly once', () => {
    for (const t of SPLIT_TEMPLATES) {
      const area = t.zones.reduce((a, z) => a + z.width * z.height, 0);
      expect(area).toBeCloseTo(1, 9);
      for (let i = 0; i < t.zones.length; i++) for (let j = i + 1; j < t.zones.length; j++) {
        const a = t.zones[i], b = t.zones[j];
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(Math.max(0, ox) * Math.max(0, oy)).toBeCloseTo(0, 9);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/shared/zone-geometry.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/shared/zone-geometry.ts`**

Move the template rects from `LayoutEditorPage.tsx:13-45` (data only, no icons). Implement `zoneToScreenRect` per the Interfaces block.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/shared/zone-geometry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Route the two main-process call sites through the helper**

`window-manager.ts:379-382` and `automation-manager.ts:21-24` both compute the zone rect by hand. Replace both with `zoneToScreenRect(zone, monitor)`. Keep the variable names the surrounding code uses.

- [ ] **Step 6: Route the editor's templates through the shared data**

In `LayoutEditorPage.tsx`, delete the local `splitTemplates` rects and keep a `templateIcons: Record<string, LucideIcon>` map keyed by template name for the six icons already imported. Build the list the page renders from `SPLIT_TEMPLATES` plus the icon map. The `SplitTemplate` type and `applyTemplate` keep their signatures.

- [ ] **Step 7: Typecheck and test**

Run: `npm run check && npm test`
Expected: clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/shared/zone-geometry.ts src/shared/zone-geometry.test.ts src/main/window-manager.ts src/main/automation-manager.ts src/renderer/pages/LayoutEditorPage.tsx
git commit -m "refactor: share zone geometry and split templates, with tests"
```

---

### Task 3: Monitor rematch module

**Files:**
- Create: `src/main/monitor-rematch.ts`
- Create: `src/main/monitor-rematch.test.ts`
- Modify: `src/main/preset-store.ts:8-56` (remove), `src/main/auto-launch.ts:11`, `src/main/window-manager.ts` (import)

**Interfaces:**
- Produces:
  - `export type MonitorRect = { id: string; x: number; y: number; width: number; height: number }`
  - `export function rematchMonitor(zone: Zone, free: MonitorRect[]): MonitorRect | null` (moved verbatim from `preset-store.ts:16-30`, now exported)
  - `export function resolveZoneMonitors(zones: Zone[], monitors: MonitorRect[]): Zone[]` (moved verbatim from `preset-store.ts:39-56`)
- Consumes: `Zone` from `src/shared/types.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/monitor-rematch.test.ts
import { describe, it, expect } from 'vitest';
import { resolveZoneMonitors, rematchMonitor } from './monitor-rematch';
import type { Zone } from '../shared/types';

const mon = (id: string, x: number, y: number) => ({ id, x, y, width: 1920, height: 1080 });
const zone = (id: string, monitorId: string, bounds?: { x: number; y: number }): Zone => ({
  id, monitorId, x: 0, y: 0, width: 1, height: 1, content: null,
  monitorBounds: bounds ? { ...bounds, width: 1920, height: 1080 } : undefined,
});

describe('rematchMonitor', () => {
  it('returns null without saved bounds', () => {
    expect(rematchMonitor(zone('z', 'old'), [mon('a', 0, 0)])).toBeNull();
  });
  it('returns the monitor the saved center falls on', () => {
    expect(rematchMonitor(zone('z', 'old', { x: 1920, y: 0 }), [mon('a', 0, 0), mon('b', 1920, 0)])?.id).toBe('b');
  });
  it('returns null when the nearest monitor does not contain the saved center', () => {
    expect(rematchMonitor(zone('z', 'old', { x: 5000, y: 0 }), [mon('a', 0, 0)])).toBeNull();
  });
});

describe('resolveZoneMonitors', () => {
  it('leaves connected ids alone', () => {
    const z = zone('z', 'a');
    expect(resolveZoneMonitors([z], [mon('a', 0, 0)])[0]).toBe(z);
  });
  it('remaps a stale id by saved bounds', () => {
    const out = resolveZoneMonitors([zone('z', 'old', { x: 1920, y: 0 })], [mon('a', 0, 0), mon('b', 1920, 0)]);
    expect(out[0].monitorId).toBe('b');
  });
  it('maps every zone of one stale monitor to the same new monitor', () => {
    const out = resolveZoneMonitors(
      [zone('z1', 'old', { x: 1920, y: 0 }), zone('z2', 'old', { x: 1920, y: 0 })],
      [mon('a', 0, 0), mon('b', 1920, 0)],
    );
    expect(out.map(z => z.monitorId)).toEqual(['b', 'b']);
  });
  it('never collapses two stale monitors onto one current monitor', () => {
    const out = resolveZoneMonitors(
      [zone('z1', 'old1', { x: 0, y: 0 }), zone('z2', 'old2', { x: 0, y: 0 })],
      [mon('a', 0, 0)],
    );
    expect(out[0].monitorId).toBe('a');
    expect(out[1].monitorId).toBe('old2');
  });
  it('keeps the saved id when nothing matches', () => {
    expect(resolveZoneMonitors([zone('z', 'old', { x: 9000, y: 0 })], [mon('a', 0, 0)])[0].monitorId).toBe('old');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/monitor-rematch.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/main/monitor-rematch.ts` and remove the code from `preset-store.ts`**

Move both functions and the `MonitorRect` type verbatim. Update imports in `auto-launch.ts` and `window-manager.ts` to the new module. `preset-store.ts` no longer exports `resolveZoneMonitors`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm run check && npm test`
Expected: clean, 7 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/monitor-rematch.ts src/main/monitor-rematch.test.ts src/main/preset-store.ts src/main/auto-launch.ts src/main/window-manager.ts
git commit -m "refactor: move monitor rematch into its own module, with tests"
```

---

### Task 4: Web-login runner module

**Files:**
- Create: `src/main/web-login.ts`
- Create: `src/main/web-login.test.ts`
- Modify: `src/main/window-manager.ts:66-115` (remove), `:183-185` (call site)

**Interfaces:**
- Produces:
  - `export interface ScriptRunner { run(js: string): Promise<unknown> }`
  - `export interface WebLoginOptions { waitTimeoutMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> }` with defaults 15000, 300, and a real timer.
  - `export function presentScript(selector: string): string`, `fillScript(selector: string, value: string): string`, `clickScript(selector: string): string`. These return the exact JS strings currently inlined at `window-manager.ts:84-112`, selector and value passed through `JSON.stringify`.
  - `export async function waitForSelector(runner: ScriptRunner, selector: string, opts?: WebLoginOptions): Promise<boolean>`
  - `export async function runWebLogin(runner: ScriptRunner, steps: WebLoginStep[], opts?: WebLoginOptions): Promise<{ completed: number; skipped: boolean }>`. `completed` counts steps that ran (a step that threw still counts). `skipped` is true when a `skipIfPresent` marker stopped the run.
  - `export function webContentsRunner(wc: Electron.WebContents): ScriptRunner` returning `run: js => wc.executeJavaScript(js, true)`. This is the only function that touches Electron and it only uses the type import, so the module stays importable under Node.
- Consumes: `WebLoginStep` from `src/shared/types.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/web-login.test.ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/web-login.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/main/web-login.ts`**

Move `waitForSelector` and `runWebLogin` from `window-manager.ts:66-115`, replacing `wc.executeJavaScript(..., true)` with `runner.run(...)`, the `sleep` import with `opts.sleep`, and the inline JS with the three script builders. Keep the existing `console` log lines.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/main/web-login.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire `window-manager.ts`**

Delete the moved functions. At the call site (`:183-185`) call `runWebLogin(webContentsRunner(win.webContents), webLogin)`.

- [ ] **Step 6: Typecheck and test, then commit**

Run: `npm run check && npm test`
Expected: clean.

```bash
git add src/main/web-login.ts src/main/web-login.test.ts src/main/window-manager.ts
git commit -m "refactor: extract the web-login runner behind a script runner, with tests"
```

---

### Task 5: Secret sealing

**Files:**
- Create: `src/shared/secrets.ts`
- Create: `src/main/secrets.ts`
- Create: `src/main/secrets-electron.ts`
- Create: `src/main/secrets.test.ts`

**Interfaces:**
- Produces, in `src/shared/secrets.ts` (renderer-safe):
  - `export const SECRET_PREFIX = 'enc:v1:'`
  - `export function isSealed(value: string | undefined): boolean`
- Produces, in `src/main/secrets.ts` (pure):
  - `export interface SecretCodec { available(): boolean; encrypt(plain: string): Buffer; decrypt(data: Buffer): string }`
  - `export function sealValue(codec: SecretCodec, plain: string): string`. Returns `plain` unchanged when `!codec.available()` or already sealed, else `SECRET_PREFIX + codec.encrypt(plain).toString('base64')`.
  - `export function unsealValue(codec: SecretCodec, value: string): string`. Returns `value` unchanged when not sealed. When sealed and `!codec.available()` or decrypt throws, logs one `console.warn` and returns `''`.
  - `export function sealPreset(codec: SecretCodec, preset: Preset): { preset: Preset; changed: number }`. Seals the `value` of every `fill` step with a non-empty value in every `webLogin` array. Returns a new object, never mutates. `changed` is the number of values newly sealed.
  - `export function sealPresets(codec: SecretCodec, presets: Preset[]): { presets: Preset[]; changed: number }`
  - `export function unsealZone(codec: SecretCodec, zone: Zone): Zone`. Unseals every `fill` value in `zone.content.webLogin`. New object.
- Produces, in `src/main/secrets-electron.ts`:
  - `export function safeStorageCodec(): SecretCodec` wrapping `safeStorage.isEncryptionAvailable`, `encryptString`, `decryptString`. This is the only file that imports `electron` for secrets.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/secrets.test.ts
import { describe, it, expect } from 'vitest';
import { sealValue, unsealValue, sealPreset, unsealZone, type SecretCodec } from './secrets';
import { isSealed, SECRET_PREFIX } from '../shared/secrets';
import type { Preset } from '../shared/types';

const codec: SecretCodec = {
  available: () => true,
  encrypt: (p) => Buffer.from([...Buffer.from(p, 'utf8')].map(b => b ^ 0x5a)),
  decrypt: (d) => Buffer.from([...d].map(b => b ^ 0x5a)).toString('utf8'),
};
const offline: SecretCodec = { ...codec, available: () => false };

const preset = (): Preset => ({
  id: 'p', name: 'Wall', createdAt: 't', updatedAt: 't',
  layout: { id: 'l', zones: [{
    id: 'z', monitorId: 'm', x: 0, y: 0, width: 1, height: 1,
    content: { type: 'url', target: 'https://x', label: 'X', webLogin: [
      { action: 'waitFor', selector: '#user' },
      { action: 'fill', selector: '#user', value: 'alice' },
      { action: 'fill', selector: '#pass', value: 'hunter2' },
      { action: 'click', selector: '#go' },
    ] },
  }] },
});

describe('sealValue / unsealValue', () => {
  it('round-trips', () => {
    const s = sealValue(codec, 'hunter2');
    expect(s.startsWith(SECRET_PREFIX)).toBe(true);
    expect(isSealed(s)).toBe(true);
    expect(unsealValue(codec, s)).toBe('hunter2');
  });
  it('does not seal twice', () => {
    const once = sealValue(codec, 'x');
    expect(sealValue(codec, once)).toBe(once);
  });
  it('leaves plain text when codec unavailable', () => {
    expect(sealValue(offline, 'x')).toBe('x');
  });
  it('returns empty string when a sealed value cannot be unsealed', () => {
    const s = sealValue(codec, 'x');
    expect(unsealValue(offline, s)).toBe('');
  });
  it('passes plain values through unseal', () => {
    expect(unsealValue(codec, 'plain')).toBe('plain');
  });
});

describe('sealPreset', () => {
  it('seals only fill values and reports the count', () => {
    const { preset: out, changed } = sealPreset(codec, preset());
    const steps = out.layout.zones[0].content!.webLogin!;
    expect(changed).toBe(2);
    expect(isSealed(steps[1].value)).toBe(true);
    expect(isSealed(steps[2].value)).toBe(true);
    expect(steps[0]).toEqual({ action: 'waitFor', selector: '#user' });
    expect(steps[3]).toEqual({ action: 'click', selector: '#go' });
  });
  it('is idempotent', () => {
    const first = sealPreset(codec, preset()).preset;
    const second = sealPreset(codec, first);
    expect(second.changed).toBe(0);
    expect(second.preset).toEqual(first);
  });
  it('does not mutate its input', () => {
    const p = preset();
    sealPreset(codec, p);
    expect(p.layout.zones[0].content!.webLogin![2].value).toBe('hunter2');
  });
  it('reports zero changes when codec unavailable', () => {
    expect(sealPreset(offline, preset()).changed).toBe(0);
  });
});

describe('unsealZone', () => {
  it('restores plain values for launch', () => {
    const sealed = sealPreset(codec, preset()).preset;
    const z = unsealZone(codec, sealed.layout.zones[0]);
    expect(z.content!.webLogin![2].value).toBe('hunter2');
    expect(sealed.layout.zones[0].content!.webLogin![2].value).not.toBe('hunter2');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/secrets.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the three files per the Interfaces block**

- [ ] **Step 4: Run to verify pass, typecheck**

Run: `npx vitest run src/main/secrets.test.ts && npm run check`
Expected: PASS (10 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/shared/secrets.ts src/main/secrets.ts src/main/secrets-electron.ts src/main/secrets.test.ts
git commit -m "feat: seal web-login values with safeStorage, pure core with tests"
```

---

### Task 6: Wire sealing into save, launch, startup and the editor

**Files:**
- Modify: `src/main/preset-store.ts` (SAVE_PRESET handler, new export), `src/main/index.ts:343` (before the auto-launch block), `src/main/window-manager.ts` (`launchZoneContent`), `src/renderer/pages/LayoutEditorPage.tsx:737-744` (fill input)

**Interfaces:**
- Consumes: Task 5's `sealPreset`, `sealPresets`, `unsealZone`, `safeStorageCodec`, `isSealed`.
- Produces: `export function migratePresetsAtRest(codec: SecretCodec): number` in `preset-store.ts`. Loads presets, runs `sealPresets`, saves only when `changed > 0`, returns `changed`.

- [ ] **Step 1: Seal on save**

In the `SAVE_PRESET` handler, replace the incoming `preset` with `sealPreset(safeStorageCodec(), preset).preset` before storing. Create the codec once at module level in `preset-store.ts` via a lazy getter so it is only touched after `app.whenReady`.

- [ ] **Step 2: Migrate on startup**

Add `migratePresetsAtRest` per the Interfaces block. Call it in `index.ts` inside `app.whenReady`, just before the auto-launch block at `:343`, logging `[MonCOM] Sealed N stored login values` when N > 0. Wrap in try/catch, a failure must not stop startup.

- [ ] **Step 3: Unseal at launch**

At the top of `launchZoneContent` in `window-manager.ts`, replace `zone` with `unsealZone(safeStorageCodec(), zone)`. This covers apply, the editor's single-zone launch and the CLI, since all three reach this function.

- [ ] **Step 4: Editor shows sealed values as saved**

In the `fill` input at `LayoutEditorPage.tsx:737-744`: when `isSealed(step.value)`, render the input with `value=""`, `placeholder="Saved"`, `type="password"`, and a title (tooltip) of `Stores this value encrypted on this machine. Type a new value to replace it.` Typing calls `update(i, { value })` as today, which replaces the sealed string. When not sealed, the input behaves as it does now.

- [ ] **Step 5: Manual verification in dev**

Run: `npm run dev`. Create a URL zone with a `fill` step, save the preset, open `moncom-data/presets.json` under the app's userData folder.
Expected: the `value` starts with `enc:v1:`. Reopen the preset in the editor: the field shows `Saved`. Save again without typing: the file still holds one sealed value (no doubling). On Linux dev where `safeStorage` may report unavailable, the value stays plain and the console shows the warning from `sealValue` is absent (plain is the documented fallback).

- [ ] **Step 6: Typecheck, test, commit**

Run: `npm run check && npm test`

```bash
git add src/main/preset-store.ts src/main/index.ts src/main/window-manager.ts src/renderer/pages/LayoutEditorPage.tsx
git commit -m "feat: encrypt stored login values at rest and unseal only at launch"
```

---

### Task 7: Preset file format, parse and import plan

**Files:**
- Create: `src/main/preset-transfer.ts`
- Create: `src/main/preset-transfer.test.ts`

**Interfaces:**
- Produces:
  - `export const PRESET_FILE_FORMAT = 'moncom-preset'`, `export const PRESET_FILE_VERSION = 1`
  - `export interface PresetFile { format: typeof PRESET_FILE_FORMAT; version: number; exportedAt: string; appVersion: string; preset: Preset }`
  - `export function toPresetFile(preset: Preset, appVersion: string, now: Date): PresetFile`. Deep-copies, sets every `fill` step's `value` to `''` (login values never leave the machine, sealed or not).
  - `export type ParseResult = { ok: true; file: PresetFile } | { ok: false; error: string }`
  - `export function parsePresetFile(text: string): ParseResult`. Errors, verbatim: not JSON or wrong `format` → `'This file is not a MonCOM preset.'`; `version > PRESET_FILE_VERSION` → `'This preset was made by a newer MonCOM. Update MonCOM and try again.'`; missing `preset.layout.zones` array or missing `preset.name` → `'This preset file is incomplete.'`
  - In `src/shared/types.ts` (so the renderer can type them in Task 8): `export interface ImportPlanZone { zoneId: string; label: string; savedMonitorId: string; targetMonitorId: string | null }` and `export interface ImportPlan { zones: ImportPlanZone[]; unmatched: number; redactedLogins: number }`. `preset-transfer.ts` imports and re-exports them.
  - `export function planImport(preset: Preset, monitors: MonitorInfo[]): ImportPlan`. Uses `resolveZoneMonitors` (Task 3). `targetMonitorId` is the resolved id when it is connected, else `null`. `label` is `zone.content?.label || 'Empty'`. `redactedLogins` counts `fill` steps with empty `value`.
  - `export function applyImportPlan(preset: Preset, plan: ImportPlan, monitors: MonitorInfo[], newId: string, now: string): Preset`. For matched zones sets `monitorId` and `monitorBounds` from the target monitor. Unmatched zones keep their saved id and bounds. Sets `id = newId`, `layout.id = 'layout-' + newId`, `createdAt = updatedAt = now`. New object.
- Consumes: `resolveZoneMonitors` from Task 3, `MonitorInfo`, `Preset`, `Zone` from shared types.

- [ ] **Step 1: Write the failing tests**

```ts
// src/main/preset-transfer.test.ts
import { describe, it, expect } from 'vitest';
import { toPresetFile, parsePresetFile, planImport, applyImportPlan, PRESET_FILE_VERSION } from './preset-transfer';
import type { Preset, MonitorInfo } from '../shared/types';

const mon = (id: string, x: number): MonitorInfo => ({ id, name: id, x, y: 0, width: 1920, height: 1080, scaleFactor: 1, isPrimary: x === 0 });
const preset = (): Preset => ({
  id: 'p', name: 'Wall', createdAt: 't', updatedAt: 't',
  layout: { id: 'l', zones: [
    { id: 'z1', monitorId: 'old-a', monitorBounds: { x: 0, y: 0, width: 1920, height: 1080 }, x: 0, y: 0, width: 1, height: 1,
      content: { type: 'url', target: 'https://x', label: 'Grafana', webLogin: [{ action: 'fill', selector: '#p', value: 'enc:v1:abc' }] } },
    { id: 'z2', monitorId: 'old-b', monitorBounds: { x: 1920, y: 0, width: 1920, height: 1080 }, x: 0, y: 0, width: 1, height: 1, content: null },
  ] },
});

describe('toPresetFile', () => {
  it('strips login values and keeps selectors', () => {
    const f = toPresetFile(preset(), '1.0.0', new Date('2026-11-02T10:00:00Z'));
    expect(f.format).toBe('moncom-preset');
    expect(f.version).toBe(PRESET_FILE_VERSION);
    expect(f.exportedAt).toBe('2026-11-02T10:00:00.000Z');
    expect(f.preset.layout.zones[0].content!.webLogin![0]).toEqual({ action: 'fill', selector: '#p', value: '' });
  });
});

describe('parsePresetFile', () => {
  it('rejects non-JSON and foreign JSON', () => {
    expect(parsePresetFile('nope')).toEqual({ ok: false, error: 'This file is not a MonCOM preset.' });
    expect(parsePresetFile('{"hello":1}')).toEqual({ ok: false, error: 'This file is not a MonCOM preset.' });
  });
  it('rejects a newer version', () => {
    const f = { ...toPresetFile(preset(), '1.0.0', new Date()), version: PRESET_FILE_VERSION + 1 };
    expect(parsePresetFile(JSON.stringify(f))).toEqual({ ok: false, error: 'This preset was made by a newer MonCOM. Update MonCOM and try again.' });
  });
  it('rejects an incomplete preset', () => {
    const f = toPresetFile(preset(), '1.0.0', new Date()) as any;
    delete f.preset.layout;
    expect(parsePresetFile(JSON.stringify(f))).toEqual({ ok: false, error: 'This preset file is incomplete.' });
  });
  it('round-trips a valid file', () => {
    const f = toPresetFile(preset(), '1.0.0', new Date());
    const r = parsePresetFile(JSON.stringify(f));
    expect(r.ok && r.file.preset.name).toBe('Wall');
  });
});

describe('planImport', () => {
  it('matches by bounds and counts redacted logins', () => {
    const p = toPresetFile(preset(), '1.0.0', new Date()).preset;
    const plan = planImport(p, [mon('new-a', 0), mon('new-b', 1920)]);
    expect(plan.zones.map(z => z.targetMonitorId)).toEqual(['new-a', 'new-b']);
    expect(plan.zones[0].label).toBe('Grafana');
    expect(plan.zones[1].label).toBe('Empty');
    expect(plan.unmatched).toBe(0);
    expect(plan.redactedLogins).toBe(1);
  });
  it('lists every zone as unmatched on a different wall and still plans', () => {
    const plan = planImport(preset(), [mon('solo', 5000)]);
    expect(plan.zones.every(z => z.targetMonitorId === null)).toBe(true);
    expect(plan.unmatched).toBe(2);
  });
});

describe('applyImportPlan', () => {
  it('rewrites matched zones and keeps unmatched ones', () => {
    const mons = [mon('new-a', 0)];
    const plan = planImport(preset(), mons);
    const out = applyImportPlan(preset(), plan, mons, 'preset-9', '2026-11-02T10:00:00.000Z');
    expect(out.id).toBe('preset-9');
    expect(out.layout.id).toBe('layout-preset-9');
    expect(out.createdAt).toBe('2026-11-02T10:00:00.000Z');
    expect(out.layout.zones[0].monitorId).toBe('new-a');
    expect(out.layout.zones[0].monitorBounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(out.layout.zones[1].monitorId).toBe('old-b');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/main/preset-transfer.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/main/preset-transfer.ts` per the Interfaces block**

- [ ] **Step 4: Run to verify pass, typecheck, commit**

Run: `npx vitest run src/main/preset-transfer.test.ts && npm run check`
Expected: PASS (8 tests).

```bash
git add src/main/preset-transfer.ts src/main/preset-transfer.test.ts
git commit -m "feat: preset file format with parse and monitor remap planning, with tests"
```

---

### Task 8: Export, import, duplicate and rename in the app

**Files:**
- Modify: `src/shared/types.ts` (IPC names, result types), `src/main/preset-store.ts` (three handlers), `src/main/preload.ts`, `src/renderer/types.d.ts`, `src/renderer/pages/PresetsPage.tsx`
- Create: `src/renderer/components/ImportPresetDialog.tsx`

**Interfaces:**
- Produces, in `src/shared/types.ts`:
  - `IPC.EXPORT_PRESET = 'export-preset'`, `IPC.IMPORT_PRESET_PREVIEW = 'import-preset-preview'`, `IPC.IMPORT_PRESET_COMMIT = 'import-preset-commit'`
  - `export type ExportPresetResult = { ok: true; path: string } | { ok: false; error?: string }` (cancelled → `{ ok: false }` with no error)
  - `export type ImportPresetPreview = { ok: true; preset: Preset; plan: ImportPlan; monitors: MonitorInfo[] } | { ok: false; error?: string }`
  - `ImportPlan` and `ImportPlanZone` already live in `src/shared/types.ts` (Task 7).
- Produces, in `MonCOMAPI` (`src/renderer/types.d.ts`) and `preload.ts`:
  - `exportPreset(id: string): Promise<ExportPresetResult>`
  - `importPresetPreview(): Promise<ImportPresetPreview>`
  - `importPresetCommit(preset: Preset, plan: ImportPlan, name: string): Promise<Preset[]>`
- Consumes: Task 7 functions, `getStableMonitors(screen)` from `monitors.ts`, `app.getVersion()` for `appVersion`.

- [ ] **Step 1: Add the IPC names and types**

- [ ] **Step 2: Implement the three handlers in `preset-store.ts`**

`EXPORT_PRESET(id)`: find the preset (unknown id → `{ ok: false, error: 'Preset not found.' }`), `dialog.showSaveDialog` with `defaultPath` `<name with non-alphanumerics replaced by '-'>.moncom.json` and filter `{ name: 'MonCOM preset', extensions: ['json'] }`, write `JSON.stringify(toPresetFile(...), null, 2)`.
`IMPORT_PRESET_PREVIEW()`: `dialog.showOpenDialog` (same filter, `openFile`), read, `parsePresetFile`, `planImport` with `getStableMonitors(screen)`, return preset, plan and monitors.
`IMPORT_PRESET_COMMIT(preset, plan, name)`: `applyImportPlan` with `newId = 'preset-' + Date.now()` and `now = new Date().toISOString()`, override `name` with the trimmed argument, push, `savePresets`, return the list.

- [ ] **Step 3: Expose through preload and the API type**

- [ ] **Step 4: Build `ImportPresetDialog`**

Props: `preview: Extract<ImportPresetPreview, { ok: true }>`, `onCancel()`, `onImport(name: string)`. Shows a name field prefilled with the preset name, a table with one row per zone: label, saved monitor id, and either the target monitor's `name` or `Not connected`. When `plan.redactedLogins > 0` show one line: `N login values are not included and need to be entered again after import.` When `plan.unmatched > 0` show one line: `N zones have no matching monitor and can be re-assigned in the Layout Editor.` Buttons `Import` and `Cancel`. Style with the existing surface, border and commander classes used in `PresetsPage.tsx`.

- [ ] **Step 5: Wire `PresetsPage`**

Header: an `Import` button (lucide `Upload`) left of `New Layout`, tooltip `Imports a preset from a file and shows where its zones will land first.` On click: `importPresetPreview()`; if `ok`, open the dialog; if an `error`, show it in the existing `statusMessage` banner; if cancelled, do nothing.
Card actions, before the edit pencil: `Export` (lucide `Download`, tooltip `Saves this preset to a file you can import on another machine. Login values are not included.`), `Duplicate` (lucide `Copy`, tooltip `Creates a copy of this preset.`). Duplicate saves `{ ...p, id: 'preset-' + Date.now(), name: p.name + ' copy', layout: { ...p.layout, id: 'layout-preset-' + Date.now() }, createdAt: now, updatedAt: now }` and refreshes the list.
Rename: clicking the preset name turns it into a text input (tooltip on the name: `Renames this preset.`). Enter or blur saves through `savePreset` with the trimmed name (empty keeps the old name), Escape cancels.
After export success show `Saved to <path>.` in the banner.

- [ ] **Step 6: Manual verification in dev**

Run: `npm run dev`. Export a preset, confirm the file's `fill` values are empty. Import it: the dialog lists the zones with target monitors, importing adds a new card with a new id. Duplicate and rename work and persist after restarting the app.

- [ ] **Step 7: Typecheck, test, commit**

Run: `npm run check && npm test`

```bash
git add src/shared/types.ts src/main/preset-store.ts src/main/preload.ts src/renderer/types.d.ts src/renderer/pages/PresetsPage.tsx src/renderer/components/ImportPresetDialog.tsx src/main/preset-transfer.ts
git commit -m "feat: export, import with remap preview, duplicate and rename presets"
```

---

### Task 9: Update feed and downloads on flarepoint.nl

**Files:**
- Modify: `package.json` (`build.publish`), `.github/workflows/release.yml`, `README.md` (Installation, Data Storage)
- Create: `docs/distribution.md`, `docs/site/smartscreen.md`

**Interfaces:**
- Produces: installed builds read their update feed from `https://cdn.flarepoint.nl/moncom/win/latest.yml`. The CDN path contract in `docs/distribution.md` is what the `fp-cdn` project implements. The feed URL host is the plan writer's assumption and is confirmed by the author before this task runs.

- [ ] **Step 1: Switch the publish provider**

`package.json` → `build.publish: [{ "provider": "generic", "url": "https://cdn.flarepoint.nl/moncom/win" }]`. `updater.ts` needs no change: it reads the generated `app-update.yml`.

- [ ] **Step 2: Make the workflow prove the feed**

In `release.yml`, after the Package step, add a step `Show update feed config` that prints `release/win-unpacked/resources/app-update.yml`. Expected content includes `provider: generic` and the URL above. Keep the draft GitHub release: it remains the build origin the CDN pulls from (bridge release in Task 11, private repo later).

- [ ] **Step 3: Write `docs/distribution.md`**

Cover: the CDN path `/moncom/win/` holding `latest.yml`, `MonCOM-Setup-<v>.exe`, `MonCOM-Setup-<v>.exe.blockmap`, `MonCOM-Portable-<v>.exe`, `checksums.txt`. `latest.yml` must be served with `Cache-Control: no-cache` (an nginx `location = /moncom/win/latest.yml` rule). Publishing order: put the exe and blockmap in place first, `latest.yml` last, because the updater reads the yml and then fetches the file it names. The sync job on the Pi pulls assets of the newest published GitHub release with a fine-grained token (Contents: read). Note that `fp-cdn` bakes files into its image today, so installers belong on a mounted volume rather than in the image. Downloads page lives at `flarepoint.nl/moncom` and links Setup, Portable, checksums and the SmartScreen page.

- [ ] **Step 4: Write `docs/site/smartscreen.md`**

The copy the website shows. Plain language: builds are not code-signed yet to keep the free app free of certificate costs, what the SmartScreen dialog looks like, `More info` then `Run anyway`, how to compare the SHA256 from `checksums.txt` with `Get-FileHash`. Under 250 words.

- [ ] **Step 5: Update the README**

Installation: downloads come from `flarepoint.nl/moncom`, remove the "no downloadable build yet" note, keep the checksum instructions, link the SmartScreen page. Data Storage: login values are stored encrypted with Windows data protection.

- [ ] **Step 6: Verify and commit**

Run: `node -e "console.log(require('./package.json').build.publish)"` → prints the generic provider. Trigger `workflow_dispatch` on the branch and check the `Show update feed config` step output.

```bash
git add package.json .github/workflows/release.yml README.md docs/distribution.md docs/site/smartscreen.md
git commit -m "chore: serve updates from the Flarepoint CDN and document distribution"
```

---

### Task 10: Targeted cleanup and the IPC contract check

**Files:**
- Delete: `src/shared/types.js` (a tracked compiled artifact)
- Create: `src/shared/api.ts`
- Modify: `src/renderer/types.d.ts`, `src/main/preload.ts`, `src/main/window-manager.ts` (`any` params), `project/claude.md`, `README.md` (project structure)

**Interfaces:**
- Produces: `src/shared/api.ts` holds `MonCOMAPI` and `ProfileEntry`, moved from `src/renderer/types.d.ts`. `types.d.ts` imports them and keeps only the `declare global` block. `preload.ts` builds `const api: MonCOMAPI = { ... }` and exposes `api`, so a method missing or mistyped on either side fails `npm run check`. This replaces the Phase 6 stretch item about the IPC contract.

- [ ] **Step 1: Delete `src/shared/types.js`**

```bash
git rm src/shared/types.js
```

- [ ] **Step 2: Move the API type and type the preload**

Replace every `any` in `preload.ts` with the shared types the `MonCOMAPI` signatures use.

- [ ] **Step 3: Type the main-process entry points**

`applyPresetFromMain(preset: Preset, …)`, `launchZoneContent(zone: Zone, monitors: MonitorInfo[])`, the `LAUNCH_ZONE` handler's `monitors: MonitorInfo[]`, and the `monitors.find((m: any) …)` inside. Leave `automation-manager.ts`, `input.ts`, `recorder-host.ts` and `win32.ts` alone: their `any` sits on FFI boundaries and is not in scope.

- [ ] **Step 4: Update the docs that describe the code**

`project/claude.md`: add `zone-geometry.ts`, `monitor-rematch.ts`, `web-login.ts`, `secrets.ts` + `secrets-electron.ts`, `preset-transfer.ts`, `shared/api.ts` to the layout list, drop the `migratePresets` mention, add the rule "the renderer only ever sees sealed login values, and only `launchZoneContent` unseals". `README.md` project structure: same additions.

- [ ] **Step 5: Typecheck, test, commit**

Run: `npm run check && npm test`

```bash
git add src/shared/api.ts src/renderer/types.d.ts src/main/preload.ts src/main/window-manager.ts project/claude.md README.md
git commit -m "refactor: typed preload against a shared API contract and docs cleanup"
```

---

### Task 11: Bridge release 0.5.0

This task is a procedure, not code. It ships the last build that old installs can reach through GitHub, carrying the new feed.

- [ ] **Step 1: Merge the branch into `main`** (fast-forward or merge commit, the release script requires `main` and a clean tree).

- [ ] **Step 2: CDN ready**

Confirm with the author that `https://cdn.flarepoint.nl/moncom/win/` serves a `latest.yml` or will within the day. Updater errors are logged only, so a short gap is harmless, but the bridge build should not sit on an empty feed for long.

- [ ] **Step 3: Cut the release**

```bash
nvm use 20 && npm run release 0.5.0
```

Publish the GitHub draft once the workflow is green and the `Show update feed config` step shows the generic provider.

- [ ] **Step 4: Verify the bridge**

On a Windows machine with 0.4.1 installed, start MonCOM and accept the update. After restart, `resources/app-update.yml` in the install folder names the CDN URL.

- [ ] **Step 5: Start the clock**

Note the publish date. The repository goes private 60 days after it, per the design. Put the date in `docs/distribution.md`.

---

### Task 12: Release 1.0.0

**Files:**
- Modify: `LICENSE`, `package.json` (`license`), `README.md` (badge, License section), `src/renderer/App.tsx` (remove `AlphaBanner` and `isPreRelease`)

- [ ] **Step 1: Licence**

Replace `LICENSE` with a proprietary notice: copyright Flarepoint, all rights reserved, versions before 1.0.0 remain available under the MIT licence they were published with. The author approves the wording before commit. Set `"license": "SEE LICENSE IN LICENSE"` in `package.json`. Update the README badge and License section.

- [ ] **Step 2: Remove the pre-release banner code**

Delete `AlphaBanner`, `isPreRelease` and the `AlertTriangle` import from `App.tsx`.

- [ ] **Step 3: Typecheck, test, commit**

```bash
git add LICENSE package.json README.md src/renderer/App.tsx
git commit -m "chore: proprietary licence from 1.0 and drop the pre-release banner"
```

- [ ] **Step 4: Cut the release**

```bash
nvm use 20 && npm run release 1.0.0
```

Publish the GitHub draft so the CDN sync picks it up. Confirm `https://flarepoint.nl/moncom` offers 1.0.0 with a checksum and the SmartScreen link, and that a 0.5.0 install updates to 1.0.0 from the CDN feed. That is the Phase 5 "done when".
