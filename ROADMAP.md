# MonCOM Roadmap

MonCOM is a **command center for Windows**: you describe a wall of apps and dashboards once, and MonCOM launches every one of them into an exact position on your monitors — logged in, navigated, and ready — in a single click or automatically on boot.

This document tracks where MonCOM is today and what's left before it can call itself **v1.0.0**. It is meant to give a realistic, public-facing picture of the project. It is **not** a promise about timelines.

---

## What MonCOM is — and is not

This is the decision that shapes everything below, so it is stated up front.

**MonCOM is an opinionated tool for one job:** bringing up a repeatable, multi-window workspace — an ops/monitoring wall, a dashboard kiosk, a fixed streaming or trading layout — and keeping it predictable across reboots. The headline capability is **per-window automation**: a window doesn't just open in the right place, it can log itself in, dismiss a startup dialog, and navigate to the right view, unattended.

**MonCOM is not a general window-snapping utility.** It does not try to replace PowerToys FancyZones, DisplayFusion, or AquaSnap for everyday drag-a-window-into-a-zone use. Those tools own that space, they are free or mature, and competing with them on live-snapping UX is a fight with no payoff. MonCOM has just enough layout editing to define a wall, and no more.

If you want to snap your code editor next to a browser as you work, use FancyZones. If you want six screens of dashboards to come up the same way every morning without you touching a thing, that is MonCOM.

### Deliberately out of scope (to keep the identity sharp)
- Live, FancyZones-style window snapping, keyboard-drag, and per-app window rules.
- Linux/macOS builds. The launch path is intentionally deep in Win32; the value proposition is Windows command centers.
- Cloud sync, accounts, or telemetry. Everything stays on the user's machine.
- A general scripting/plugin runtime (revisit only if real demand appears post-1.0).

---

## Where we are: v0.1.1

The core loop works end-to-end. You can detect monitors, split them into zones with one of six templates, assign URLs or applications to zones, save the layout as a preset, and apply it again in one click. The app lives in the system tray, can launch on Windows boot, and can auto-apply a chosen preset on startup. The ambitious pieces exist too: per-zone record/replay automation, elevation-aware launching, per-URL zoom, and the monitor-identify overlay.

What that means: MonCOM is **usable end-to-end for its core job**, but it has not been hardened for distribution. No tests, no signed builds, no release pipeline, and the launch path — the one thing the whole product rests on — is still slower and less predictable than it needs to be. The pre-release banner stays until the major version hits 1.

---

## How to read this roadmap

Phases are ordered by dependency, not by appetite — each builds on the last. Every phase leads with a **Goal** (one sentence) and a **Done when** (a single measurable test). If the "Done when" can't be demonstrated, the phase isn't finished, regardless of how many checkboxes are ticked.

---

### Phase 0 — Name the product

**Goal:** Make the command-center identity legible in 10 seconds to a stranger, and reframe automation from "niche bolt-on" to "the reason this exists."

**Done when:** The README opens with a command-center hero and a looping GIF of a real wall coming up on boot; a stranger reading it can state what MonCOM is for and why they'd pick it over FancyZones without scrolling past the fold.

- [x] Rewrite the README hero around the wall-on-boot story; lead with the automation feature, not the feature table.
- [x] Add a short "Why not just FancyZones?" section that draws the line above honestly.
- [x] Hero animation: a looping render of the video wall reconfiguring across monitors (`assets/moncom-wall.gif`, regenerable via `tools/capture`). _Optional follow-up: a literal empty-desktop → boot → live-wall screen capture._
- [x] Update the in-app tagline/empty states to match (was generic "organize your monitors").

---

### Phase 1 — The wall comes up right, every time

**Goal:** Make launching a preset fast and predictable. This is the product's foundation — everything else is decoration if the wall lands wrong.

**Done when:** Applying a 6-zone preset 10 times in a row lands every window in its correct zone within ±2px, completes in under ~1.5s per window on a typical machine, and any window that fails to position is reported in the UI (not the console).

**Status: largely complete.** The PowerShell window engine has been replaced by a native Win32 layer (koffi FFI, `src/main/win32.ts`) — no per-operation process spawn, positioning measured per-window. In a direct test a window lands at its target with **0px error**. Remaining: the live 6-zone / 10× acceptance run.

- [x] Move the positioning hot path off slow PowerShell title-matching. → Native Win32 via **koffi FFI** (`EnumWindows` / `SetWindowPos` / `DwmGetWindowAttribute`), called directly from the main process. No spawning; `waitForWindow(matcher)` polling is now cheap.
- [x] Measure DWM invisible-border compensation per-window instead of the hard-coded ~7/8px. → Computed from `DWMWA_EXTENDED_FRAME_BOUNDS` per window (verified pixel-exact).
- [x] Single-instance strategy for already-running apps (Spotify / Discord / Teams): reuse and reposition the existing window instead of treating it as "new" or failing.
- [x] Surface per-zone launch failures in the UI — a warning banner **naming the failed targets**, on the Dashboard, Layout Editor, and Presets pages (Presets previously swallowed the result). _Optional follow-up: a red badge on the failed zone in the monitor map._
- [x] `closeAllZones` reports which windows it could not close gracefully (native WM_CLOSE → taskkill fallback), surfaced in the same banner.
- [x] **Stable monitor identity** — monitors are keyed by their **EDID hardware id** (`monitors.ts`, native `EnumDisplayDevices`), not Electron's volatile `display.id` or screen position. Presets now bind to the physical monitor and survive rearrangement, resolution changes, and primary-monitor swaps; identical monitors are told apart by connector UID. _Legacy presets (old id scheme + no stored bounds) can't auto-migrate — recreate them._
- [x] **Acceptance run:** apply a real 6-zone preset 10× and confirm every window lands ±2px in well under the old multi-second timing — the live "Done when" check.

**Profile-ready by design:** window-finding routes through a `WindowMatcher` + a single `resolveTargetWindow` seam (`window-manager.ts`), so the App Profiles step (Phase 2.5) can swap the default "first new window of the launched exe" for a multi-step matcher sequence without touching the rest of the engine.

---

### Phase 2 — Automation that survives the real world

**Goal:** Make record/replay robust and trustworthy enough to be the headline feature. An ops wall that logs itself in unattended is the whole pitch.

**Done when:** You can record an auto-login to a real web dashboard, reboot the machine, and have the wall come up fully logged-in and navigated with zero interaction, reproducibly across 5 consecutive boots.

**Status: largely complete.** Playback moved to a native koffi `SendInput` engine (`src/main/input.ts`) — no PowerShell on the unattended path. Recording extended for modifiers + scroll. The editor gained inline editing, drag-reorder, and test-from-step. Plus the headline robustness win: DOM-driven web login for URL zones. Remaining: end-to-end reboot validation with a real dashboard.

- [x] Playback rewritten on native `SendInput` (`input.ts`) — clean modifier combos + scroll, no per-playback `Add-Type` latency.
- [x] Recording rewritten on native low-level hooks (`recorder-host.ts`), closing the last PowerShell + `Add-Type` path in the app. The hooks live in a child process (MonCOM's own binary under `ELECTRON_RUN_AS_NODE`) because a hook proc must answer within ~300ms or Windows drops the event, so it cannot share a thread with the app's work. Events outside the zone rectangle are now kept rather than discarded, and the recorder reports its state to the UI instead of failing silently.
- [x] Inline editing of recorded delays and click coordinates (Automation panel).
- [x] Reorder actions by drag.
- [x] Modifier combos (Ctrl+T) + scroll — recorder captures modifier state & wheel; player replays them.
- [x] "Test from step N" — per-step play button.
- [x] **DOM-aware web login for URL zones** (`webLogin` steps: `waitFor` / `fill` / `click` via injected JS against CSS selectors) — robust to page layout shifts; the headline auto-login path. Coordinate replay remains for app zones + as a fallback.
- [x] Already-logged-in case: partially handled (a `waitFor` step can gate on a logged-in marker); a full conditional skip overlaps with App Profiles and is deferred to **Phase 2.5**.

---

### Phase 2.5 — App Profiles (stubborn, multi-window apps)

**Goal:** Support apps that don't open cleanly — they throw a warning dialog, pass through an intermediate login window, or spawn the real window late (e.g. a DSS/CCTV client). Make this a **data-driven recipe anyone can author**, not hard-coded per app.

**Done when:** A picky app is brought up unattended by a profile that acks its warning dialog, waits through its auto-login window, and positions the *final* window — and that profile is a JSON file a user created in the UI, with the bundled DSS example shipped as data, not code.

**Status: complete.** Schema + storage + runner + authoring UI are all in and build green; the bundled DSS example loads and matches by exe; exe matching is forgiving (paths/casing/extension all normalized via `normalizeExe`); and the conditional already-logged-in layer landed. The launch path runs a matching profile instead of the default window-finder.

- [x] Profile schema (`AppProfile` / `WindowMatch` / `ProfileStep` / `ProfileAction` in `shared/types.ts`): a window matcher (`exe` / `titleContains` / `className`) + ordered steps (`waitFor` → `do`(click/key/wait) → `waitClose` / `position`). One JSON file per profile.
- [x] Generic profile runner (`profile-runner.ts`) on the Phase 1 `waitForWindow` primitive + native input — replaces `resolveTargetWindow` in `launchAppZone` when `findProfileForExe` matches; default path stays as fallback.
- [x] Profiles load from `userData/moncom-data/profiles/` (user) + a read-only bundled `examples/profiles/` (shipped via `extraResources`). **DSS ships as `examples/profiles/dss-client.json`** — data, not privileged code.
- [x] UI to create / edit a profile — a dedicated **App Profiles** page (sidebar) with a structured step/action editor (match exe, per-step window matcher + flags + `do` actions), bundled "Example" badge, duplicate, delete, and an "open profiles folder" shortcut. _Optional polish: a "this app has a profile" hint in the zone editor._
- [x] Capture *which window* each step targets — a **"Detect open windows"** picker in the step editor fills a step's `exe` + `className` from any live window (the hard part of authoring). _Full input-event recording → synthesized profile is deferred to post-1.0 (it's a poor fit for wait/keypress flows like DSS, and the structured editor + detect-windows already make authoring practical)._
- [x] **Conditional / already-logged-in handling**: web login gained a `skipIfPresent` step — if a logged-in marker selector is already present, it stops (skips when logged in; re-logs-in on session expiry, since web login runs on every launch). App profiles get the same effect from `optional` steps (login window doesn't appear → recipe continues).

---

### Phase 3 — Trust to download

**Goal:** Let a stranger go from "found the repo" to "running my wall" without ever opening a terminal. This is what turns a personal tool into something people actually download.

**Done when:** A tagged release produces a signed (or clearly-explained) installer and portable build; a non-developer downloads it, runs it, and builds a working wall without cloning or building anything.

- [x] GitHub Actions workflow that builds the NSIS installer and portable `.exe` on every tag.
- [x] Proper Windows icon set (`.ico` with 16/24/32/48/64/128/256px) — only a single PNG ships today.
- [x] Code-sign the installer, or at minimum ship documented SmartScreen guidance plus published checksums so the warning has an explanation.
- [x] Auto-updater (`electron-updater`) so patches don't require a manual re-download.
- [x] `CHANGELOG.md` and enforced semver from the first tagged release.

---

### Phase 4 — Control the wall from anywhere

**Goal:** Apply and switch presets without touching the MonCOM window — the difference between a toy and an operator's tool.

**Done when:** A bound global hotkey applies its preset from inside any other app, conflicts with existing shortcuts are detected and surfaced, and `moncom.exe --apply "<preset>"` brings a wall up from the command line.

- [x] Wire `globalShortcut` registration in the main process (the `hotkeys` setting already exists, unused).
- [x] UI to bind a hotkey to a specific preset; persist in `settings.json` and re-register on startup.
- [x] Detect and surface conflicts with already-registered shortcuts.
- [x] CLI flag to apply a preset by name, so MonCOM can be wired into other automation/schedulers.

---

### Phase 5 — Just enough editing to not look broken

**Goal:** Add the minimum layout-editing polish so the editor doesn't look half-baked next to rivals — then stop. Explicitly capped.

**Done when:** A user can drag a zone edge to fine-tune a template, draw a one-off custom split, and save the result as a named template that appears beside the built-ins. No further editing investment until post-1.0.

- [ ] Drag handles on zone edges to fine-tune a template after applying it.
- [ ] One "custom split" mode where the user draws zones on the monitor preview.
- [ ] Save user-made layouts as named templates alongside the six built-ins.
- [ ] Show real preview content in the zone (favicon for URLs, exe icon for apps) instead of just the label.
- [ ] **Stop line:** no live snapping, no keyboard-drag, no window rules. That's FancyZones' job.

---

### Phase 6 — A thin safety net

**Goal:** Cover the logic that, if it breaks, breaks the wall silently — without pretending to need full test coverage.

**Done when:** CI runs lint, typecheck, and unit tests green on every PR, with the zone-bounds math, preset/monitor rematch (`rematchMonitor`/`migratePresets`), and playback-script generation under test.

- [ ] Unit tests for zone-bounds math, the monitor-rematch/migration logic in `preset-store.ts`, and playback script generation.
- [ ] Lint + typecheck in CI on every PR.
- [ ] (Stretch) A headless Electron smoke test asserting the `preload.ts` IPC contract matches what the renderer calls.

---

### Phase 7 — Share and recover a wall

**Goal:** Let a preset move between machines and survive a monitor reshuffle — important when the same wall is deployed on more than one command-center PC.

**Done when:** You can export a preset on machine A, import it on machine B with a different monitor arrangement, and the import previews a sane monitor remap before committing.

- [ ] Export a preset to a `.json` file from the Presets page.
- [ ] Import a preset from a file, with a monitor-mapping preview before committing.
- [ ] Duplicate / rename actions on the preset card.
- [ ] Graceful "monitor IDs changed" handling at apply time — offer a remap instead of silently dropping zones (the `monitorBounds` rematch groundwork already exists).

---

## Post-1.0 — only if the niche pulls for it

Not blockers, and not to be started before v1.0.0 ships. Listed so contributors know they're on the radar but parked:

- **Scenes:** switch presets automatically on a trigger (time of day, monitor count, focused app).
- **Conditional automation:** branch a replay on what's on screen (skip login if already authenticated).
- **Preset templates gallery:** shareable community walls for common ops stacks.
- **Record-to-profile:** record an app's launch flow (clicks + the window each one hit) and synthesize an App Profile automatically. Deferred from Phase 2.5 — the structured editor + "Detect open windows" cover authoring today, and recording fits click-heavy logins better than wait/keypress flows like DSS.

---

## Where to help

The highest-impact, least-glamorous places for a new contributor:

- **Phase 1** — window positioning edge cases (ultrawide, fractional scaling, unusual DPI combos) are best found on other people's hardware. File issues with reproducible steps.
- **Phase 6** — the launch and migration math needs eyes from people who didn't write it.
- **Phase 0 / 3** — screenshots, the demo GIF, and installer testing on clean machines.

The scope here is intentionally narrow. Open an issue before anything larger than a small fix so we can check it fits the command-center identity above — features that pull MonCOM back toward "general window manager" will likely be declined, and that's by design.

---

*This roadmap will be updated as items land or priorities shift. Last meaningful revision: June 2026 — refocused on the command-center identity.*
