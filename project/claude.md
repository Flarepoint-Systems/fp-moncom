# MonCOM — Context for Claude

MonCOM (Monitor Commander) is a Windows Electron desktop app for splitting monitors into zones, launching apps/URLs into those zones, and managing multi-monitor workspaces via named presets.

## Stack
- Electron 41 + TypeScript 5.9
- React 19 + Tailwind CSS 4 renderer
- Vite 8 (renderer) + esbuild (`esbuild.main.mjs`) for main process
- Node >= 20.19 required (use `nvm use 20`)
- Packaging: electron-builder (NSIS + portable). Icon: `build/icon.png` (+ `build/icon.ico` for installer). `build/icon.png` is bundled via `package.json` → `build.files`.

## Layout
- `src/main/index.ts` — app entry, tray, BrowserWindow, IPC registration, monitor-identify overlays, elevation relaunch, auto-launch preset on startup.
- `src/main/win32.ts` — native Win32 engine via **koffi** FFI (no PowerShell): `enumWindows`, `moveWindowToVisibleRect` (per-window DWM border correction via `DWMWA_EXTENDED_FRAME_BOUNDS`), `postClose`, `isWindow`, the `waitForWindow(matcher)` primitive, and `enumPhysicalMonitors` (EnumDisplayMonitors + EnumDisplayDevices for stable EDID identity). koffi is N-API so the same binary loads under Node (dev scripts) and Electron. Marked `external` in `esbuild.main.mjs`.
- `src/main/monitors.ts` — canonical monitor list with **stable hardware ids** (`getStableMonitors`). Maps each Electron display to a physical monitor (`enumPhysicalMonitors` → `screenToDipPoint` bounds match) and derives an EDID-based id (`stableMonitorId`, e.g. `monitor-aoc2401-…-uid28931`), falling back to position-based `monitorIdFromBounds`. ALL id-generating paths (GET_MONITORS save, preset apply) go through this so saved ids and apply-time ids always agree.
- `src/main/window-manager.ts` — window positioning/closing built on `win32.ts`. Launches apps/URLs, resolves the target window through a `WindowMatcher` + `resolveTargetWindow` seam (default: first new window of the launched exe; App Profiles will swap in a multi-step matcher), positions it, gracefully closes via native WM_CLOSE then `taskkill /F /T` fallback. Tracks `launchedAppWindows: Map<hwnd, pid>`. Exports `applyPresetFromMain` (used by auto-launch).
- `src/main/monitor-rematch.ts`: `resolveZoneMonitors(zones, monitors)`: when a zone's saved `monitorId` is not connected, rematches it by its saved `monitorBounds` to the free monitor nearest the old center. Used by preset apply, auto-launch and import.
- `src/main/preset-store.ts` — JSON persistence under `app.getPath('userData')/moncom-data/`. `SAVE_SETTINGS` also calls `app.setLoginItemSettings` for startup registration.
- `src/main/profile-store.ts` — **App Profiles** (data-driven launch recipes): loads from `userData/moncom-data/profiles/` (user) + bundled `examples/profiles/` (shipped via `extraResources`; resolve dirs like the tray icon — dev `__dirname/../../examples`, packaged `process.resourcesPath/examples`). `findProfileForExe(exe)` attaches a profile by matching the launched exe.
- `src/main/profile-runner.ts` — `runProfile(profile, before)`: steps through `waitFor`(matcher) / `do`(click/key/wait) / `waitClose` / `position` using win32 `waitForWindow`+`focusWindow` + input. `launchAppZone` runs it when a profile matches; default `resolveTargetWindow` stays as fallback. **DSS ships as `examples/profiles/dss-client.json` — an example, NOT privileged code.** Don't hard-code app-specific launch logic; add a profile.
- `src/main/automation-manager.ts` — records user input for a zone via a PowerShell low-level-hook subprocess (kept — global recording needs a message pump); **plays back via native `input.ts`** (no PowerShell on the playback path). `playActions(actions, zone, monitors, startIndex?)` — `startIndex` powers "test from step N".
- `src/main/input.ts` — native `SendInput` via koffi: `setCursorPos`, `mouseButton`, `mouseWheel`, `keyTap(vk, modifiers)`, `typeText`. NB: `typeText` sends one char per `SendInput` — larger batched struct arrays corrupt under koffi's union-array marshalling (tail elements repeat).
- Web auto-login (URL zones): `ZoneContent.webLogin` = `WebLoginStep[]` ({action: waitFor/fill/click, selector, value, delayMs}). `runWebLogin` in `src/main/web-login.ts` runs them through a `ScriptRunner` (in the app, `webContentsRunner` wraps `webContents.executeJavaScript`, tests pass a fake) once after the first `did-finish-load` (uses the native value setter + input/change events so React-controlled fields register). Robust DOM-driven path for the headline web auto-login; coordinate replay (input.ts) stays for app zones + fallback.
- `src/main/secrets.ts` + `src/main/secrets-electron.ts`: sealing of web-login values at rest. `secrets.ts` seals and unseals values, presets and zones through a `SecretCodec`, `secrets-electron.ts` provides the codec backed by Electron `safeStorage`. `src/shared/secrets.ts` holds the `enc:v1:` prefix and `isSealed`, so the renderer can tell a sealed value apart.
- `src/main/preset-transfer.ts`: preset file format (`toPresetFile`, `parsePresetFile`) and import planning (`planImport`, `applyImportPlan`), which remaps each zone to a connected monitor before commit.
- `src/main/preload.ts`: contextBridge exposing `window.moncom`. It is typed as `const api: MonCOMAPI`, so a method missing or mistyped on either side fails `npm run check`.
- `src/shared/types.ts` — shared types + `IPC` channel enum.
- `src/shared/api.ts`: `MonCOMAPI` (the `window.moncom` contract) and `ProfileEntry`, shared by the preload and the renderer.
- `src/shared/zone-geometry.ts`: zone rect math (`zoneToScreenRect`, rounds edges so adjacent zones share an edge) and the `SPLIT_TEMPLATES` used by the layout editor.
- `src/renderer/` — React UI: `App.tsx`, `pages/` (DashboardPage, PresetsPage, LayoutEditorPage, SettingsPage), `components/` (Sidebar, TitleBar, Tooltip, HotkeyField, `ImportPresetDialog.tsx` for the import remap preview).
- `__APP_VERSION__` injected via Vite/esbuild `define` from package.json version.

## Native Win32 engine (win32.ts)
- All window ops go through koffi FFI in `win32.ts` — **do not reintroduce PowerShell** for enumerate/move/close (it was the source of the multi-second launch latency).
- DWM border compensation is **measured per window** (`GetWindowRect` vs `DWMWA_EXTENDED_FRAME_BOUNDS`), not a hard-coded offset. `moveWindowToVisibleRect` lands the *visible* frame exactly on the zone (verified 0px on Notepad).
- Window handles are marshalled as `intptr_t` → plain JS numbers (real HWNDs fit in 2^53). Wide strings: pass a `Buffer`, read with `buf.toString('ucs2', 0, len*2)`.
- `enumWindows()` filters to visible, non-tool-window, non-DWM-cloaked, titled top-level windows; process names resolved via `QueryFullProcessImageNameW` and cached per pid.
- Close flow: native `PostMessageW(WM_CLOSE)` → poll `IsWindow` ~1.2s → `taskkill /PID $pid /F /T` tree-kill fallback (still a `spawn`, rare path).
- UIPI: a non-elevated MonCOM cannot move/close windows of elevated processes — `SetWindowPos` just returns false. Solution is unchanged: the `runAsAdmin` setting self-relaunches elevated on startup. Keep the static elevation note in the editor.
- koffi packaging: it ships a prebuilt `.node`; electron-builder must keep it unpacked from asar (verify in Phase 3).

## Elevation
- `isProcessElevated()` uses `execSync('net session', { stdio: 'ignore' })` — throws when not elevated.
- When `settings.runAsAdmin` is true and not already elevated and not dev, `app.whenReady` relaunches self via `powershell Start-Process -Verb RunAs` then `app.exit(0)`. Only prompts UAC in packaged builds (skipped when `isDev`).
- The layout editor shows a static note for app-type zones advising users to enable the setting if the target needs admin.

## Presets / Zones
- A Preset holds monitor id + array of Zones (rect + optional target: url/application + launchDelay + optional recorded automation).
- Switching presets: `applyPresetFromMain` first calls `closeAllZones()` if any launched windows exist, to avoid leftovers.
- Auto-launch: on startup, if `settings.autoLaunchPreset` and id resolves, waits 3s (monitor settle) then applies.
- Editing a preset: `LayoutEditorPage` accepts `editingPreset` prop; save preserves `id` + `createdAt`, updates `updatedAt`. Button label toggles "Save Preset" / "Update Preset".

## UI conventions
- Dark theme, background `#0E1116`, accent blue `#2A7FFF`, Flarepoint red `#FF2A2A` (used for hover on "by Flarepoint" link → flarepoint.nl).
- Frameless window (`frame: false`, `titleBarStyle: 'hidden'`), custom titlebar buttons via IPC `window-minimize/maximize/close`. Close minimizes to tray (preventDefault + hide). Quit only via tray menu.
- Pre-release banner visible while major version < 1.
- Settings auto-save (no Save button) — `useRef` skips the initial load; subsequent state changes trigger `saveSettings`.
- URLs are normalized: if no protocol, `https://` is prepended before launch.
- **Microcopy / tooltips — agreed house style (descriptive voice):** state what the control does in third person, leading with a verb ("Opens…", "Records…", "Lets MonCOM…"). One sentence; two only when a *why/when* prevents a mistake. No em dashes (use a period or comma). No internal jargon (no "CSS selector", "coordinate replay", "VK code", "normalizes"). Sentence case, end with a period. Don't restate the label. Keep new tooltips consistent with the ones in `LayoutEditorPage`/`SettingsPage`/`ProfilesPage`.

## Known quirks / gotchas
- **Exe matching always goes through `normalizeExe` (`src/shared/exe.ts`)** — basename, strip launcher ext (.exe/.lnk/.bat/…), trim, lowercase. Applied on both sides of every comparison (win32 `getProcessName`, `launchAppZone`, `findProfileForExe`, `runProfile` matcher) and when saving a profile (normalizes `match.exe` + every step's `waitFor.exe`). Never compare raw exe strings; users may paste a path, omit/add `.exe`, or use any casing. Profile UI also has a Browse button + a live "Matches launches of …" hint.
- Monitor ids are **stable hardware (EDID) ids** from `monitors.ts` — never reintroduce per-path id generation; always go through `getStableMonitors`. Presets saved before this scheme (old Electron `display.id`, or position-only ids) that also lack `monitorBounds` can't be rematched, so they must be recreated. New presets store `monitorBounds`, so `resolveZoneMonitors` rematches them by bounds if an id ever drifts.
- **The renderer only ever sees sealed login values, and only `launchZoneContent` unseals.** Presets are sealed on save, import and the at-rest migration in `preset-store.ts`. Never send unsealed values over IPC or write them to disk.
- Don't re-introduce runtime elevation detection per-zone — it was removed by user request; use the static note instead.
- Don't add `overflow: hidden` on scroll containers for webview-based zones — it blocks scrolling. Use `::-webkit-scrollbar { display: none }` + `scrollbar-width: none`.
- When the target field (app/url) changes, clear the label so stale hints don't stick (both text input and Browse button).
- electron-builder symlink extraction fails unless Windows Developer Mode is enabled (winCodeSign cache contains macOS symlinks).
- Tray icon: resolved via `resolveIconPath()` in `index.ts` which tries `__dirname/../../build`, `process.resourcesPath/build`, and `app.getAppPath()/build`. Icon is resized to 16×16 for the tray.

## Commands
- Dev: `npm run dev`
- Build: `npm run build`
- Package (Windows): `npm run pack` → `release/`
