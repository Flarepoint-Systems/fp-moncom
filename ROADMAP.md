# MonCOM Roadmap

MonCOM is a **command center for Windows**: you describe a wall of apps and dashboards once, and MonCOM launches every one of them into an exact position on your monitors — logged in, navigated, and ready — in a single click or automatically on boot.

This document tracks where MonCOM is today, what is left before **v1.0.0**, and the Pro tier that follows it. It is meant to give a realistic picture of the project. It is **not** a promise about timelines.

**Free and Pro.** The reason to install stays free forever: detect monitors, build one preset, auto-launch it on boot, logged in. Pro covers what matters once you run a site: several presets, schedules, awkward applications, and managing all walls from one chair. A free or lapsed machine never loses a wall that already works. The full reasoning is in `docs/superpowers/specs/2026-10-31-moncom-pro-direction-design.md`.

---

## What MonCOM is — and is not

This is the decision that shapes everything below, so it is stated up front.

**MonCOM is an opinionated tool for one job:** bringing up a repeatable, multi-window workspace — an ops/monitoring wall, a dashboard kiosk, a fixed streaming or trading layout — and keeping it predictable across reboots. The headline capability is **per-window automation**: a window doesn't just open in the right place, it can log itself in, dismiss a startup dialog, and navigate to the right view, unattended.

**MonCOM is not a general window-snapping utility.** It does not try to replace PowerToys FancyZones, DisplayFusion, or AquaSnap for everyday drag-a-window-into-a-zone use. Those tools own that space, they are free or mature, and competing with them on live-snapping UX is a fight with no payoff. MonCOM has just enough layout editing to define a wall, and no more.

If you want to snap your code editor next to a browser as you work, use FancyZones. If you want six screens of dashboards to come up the same way every morning without you touching a thing, that is MonCOM.

### Deliberately out of scope (to keep the identity sharp)
- Live, FancyZones-style window snapping, keyboard-drag, and per-app window rules.
- Application zones on Linux and macOS. Those platforms get URL-only walls (Phase 9). The native launch path stays Windows.
- Screen streaming or remote viewing. VNC remains the right tool when you need to see the wall.
- Telemetry. The free tier needs no account and sends nothing. Pro walls talk to the Flarepoint service for licences, sync and remote control, and the service never holds readable login secrets.
- A general scripting or plugin runtime, and a community marketplace.

---

## Where we are: v0.4.1

Phases 0 to 4 are complete. The wall comes up fast and pixel-exact through a native Win32 layer, monitors are keyed by stable hardware ids, record and replay runs on native input, URL zones log themselves in through DOM-driven steps, stubborn apps are handled by data-driven App Profiles, releases build on tag with an auto-updater, and presets apply from a global hotkey or the command line. MonCOM runs real walls on a job site every morning.

What is missing is trust and a product around it. There are no tests, login secrets sit in plain text, downloads still depend on GitHub, and there is no way to pay for the features a site needs. Phase 5 closes the first gap and ships 1.0. Phases 6 to 9 build the Pro tier.

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

### Phase 5: Trustworthy 1.0

**Goal:** Make the free app something a stranger can download and rely on, and freeze it as the permanent free tier.

**Done when:** A tagged 1.0 build installs from flarepoint.nl with a checksum and a SmartScreen explanation, auto-updates from there, passes CI with tests on the zone math, monitor rematch and web-login runner, stores login secrets encrypted, and exports and imports a preset with a monitor remap preview.

- [ ] Unit tests and CI for the zone-bounds math, `rematchMonitor` and `migratePresets`, and the web-login step runner. Typecheck on every push.
- [ ] Encrypt web-login values at rest with `safeStorage`. Migrate existing presets on first run.
- [ ] Preset export and import with monitor remap preview, plus duplicate and rename.
- [ ] Move downloads and the update feed to flarepoint.nl. One bridge release on GitHub whose updater points at the new feed, then 60 days, then the repository goes private. Versions from 1.0 onward are proprietary.
- [ ] Published checksums beside each download and a short, honest SmartScreen page the installer links to. Builds stay unsigned for now.
- [ ] Targeted cleanup of the early code with the tests as a safety net. Not a rewrite.
- [ ] Drop the pre-release banner.

---

### Phase 6: Entitlements

**Goal:** The app knows whether a machine is Pro, without ever blocking a launch.

**Done when:** A machine with no entitlement runs the full free tier. A machine with a valid entitlement unlocks Pro surfaces. Cutting the network or expiring the entitlement past its grace period locks the Pro editing surfaces but the scheduled auto-launch still runs the current preset, verified by test.

- [ ] Hosted service v1: organisation accounts with invited members, Stripe billing (quantity based, monthly or annual, no trial), entitlement tokens, wall deactivation.
- [ ] An entitlement module in the main process: load the local token, refresh in the background, expose a single `isPro()` and a reason string. Thirty day grace without contact.
- [ ] One gating pattern in the renderer: a component that wraps a Pro surface, shows the marked state for free users, and never appears on the launch path.
- [ ] Sign-in from the Settings page. No account is required for the free tier.

---

### Phase 7: Pro on one wall

**Goal:** Ship the Pro features that do not need a second machine, so there is something to pay for before the fleet work lands.

**Done when:** On a single Pro wall, two presets exist, one is scheduled to come up on weekday mornings and go down in the evening, the wall sleeps and wakes on that schedule for five consecutive days, and a Dahua DSS zone launches from the library recipe.

- [ ] Multiple presets behind the gate, with the free tier limited to creating one. Presets already on a machine always keep working.
- [ ] Scheduling and power: schedule editor per preset, Windows scheduled tasks with wake, sleep at the down time, close all zones first. Displays-off as a per-wall fallback. Windows sign-in on wake is a documented prerequisite.
- [ ] Profile library distribution from the hosted service, with the authoring page gated. The bundled DSS example moves into the library.

---

### Phase 8: Fleet

**Goal:** Run every wall on a site from one chair.

**Done when:** From a desk machine, each wall on the site appears in a list with its state, a preset edited once is pushed to three walls with a remap preview on each, and a wall is brought up and taken down remotely, without a tunnel being configured by hand.

- [ ] Method registry, classification and job model from the remote-control design.
- [ ] Relay through the hosted service. Walls hold an outbound connection, controllers address a wall by id. Per-wall pairing keys, so the relay only ever sees encrypted blobs plus wall name, version, state and current preset name.
- [ ] Wall registry and a small account dashboard.
- [ ] Encrypted preset sync and push-to-walls.
- [ ] Remote take down closes zones and leaves the machine awake. Remote sleep is a separate, labelled action.

---

### Phase 9: URL walls on Linux and macOS

**Goal:** Reach dashboard-style walls that are not on Windows.

**Done when:** A Linux and a macOS build each bring up a three-monitor URL wall on login, logged in, and appear in the fleet list, with the application zone type hidden and explained.

- [ ] Platform seam for monitor identity and auto-launch registration.
- [ ] Builds and update feeds for both platforms. macOS notarization waits for an Apple Developer account, decided when this phase starts.
- [ ] Hide and explain the Windows-only features (application zones, recorder, profiles).

---

## Parked

Not planned, listed so they are not forgotten: shutdown plus Wake-on-LAN, offline activation by licence file for air-gapped walls, code signing and notarization, invoice or purchase-order payment, scenes that switch presets on a trigger, record-to-profile, application zones on Linux and macOS, a public template gallery.

---

*Last meaningful revision: November 2026. Phases 5 to 9 follow the Pro direction design in `docs/superpowers/specs/2026-10-31-moncom-pro-direction-design.md`.*
