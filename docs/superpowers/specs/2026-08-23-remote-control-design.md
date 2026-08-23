# MonCOM Remote Control

**Date:** 2026-08-23
**Status:** Approved design, ready for implementation planning

## Problem

A MonCOM instance running a videowall has to be driven from the machine itself, or through a full remote desktop session (VNC). When the operator does not need to see the screens, VNC is heavy and awkward for what is really a small set of commands: apply this preset, close the wall, check what is running.

MonCOM already has a headless command path. `applyPresetFromMain` runs without the renderer, `--apply "<name>"` drives it from the command line, and global hotkeys bind presets. What is missing is a way to reach that path from another machine, and an interface to drive it from.

## Goal

Run the complete MonCOM interface against a remote instance. Every page (Dashboard, Presets, Layout Editor, Profiles, Settings) operates on the remote machine's monitors, presets, profiles and settings, with no separate cut-down remote UI to build or maintain.

## Non-goals

- Screen streaming or any visual feedback from the remote machine. If the operator needs to see the wall, VNC remains the right tool.
- Peer-to-peer networking. See "Transport" below.
- Discovery. Targets are configured by hand.
- Controlling more than one remote target at a time.

## Transport

The wall is already reachable through a Cloudflare tunnel (`cloudflared`) that maps an authenticated hostname to a local port on the wall machine. That removes the entire NAT traversal problem, so there is no WebRTC, no signaling server and no TURN relay in this design.

MonCOM's host server binds to `127.0.0.1` only. It is never exposed on the LAN. The tunnel is the only path in, which means Cloudflare's access controls are the outer perimeter and MonCOM's own token is defence in depth.

The protocol is JSON over HTTP POST. Node's built-in `http` module covers it, so no new runtime dependency is added. Today the runtime dependencies are `electron-store`, `electron-updater` and `koffi`, and this design keeps that list unchanged.

## Architecture

Every MonCOM instance can act as a **host** (accepts remote control) or a **controller** (drives a remote host). Both roles are off by default. The wall runs as host, the operator's desk machine as controller.

```
controller machine                              wall machine
------------------                              ------------
renderer
   |  window.moncom.applyPreset(preset)
preload (unchanged)
   |  ipcRenderer.invoke
local main
   |
   +-- target = local  -> local handler
   |
   +-- target = wall   -> remote-client
                              |  POST /rpc  (bearer token)
                              |  through cloudflared
                              v
                          remote-server (127.0.0.1)
                              |  auth, classify, dispatch
                              v
                          the same handler
```

The renderer and the preload bridge do not change. The routing decision lives entirely in the main process, which is also where the token belongs.

### 1. Method registry

The thirty IPC handlers are currently registered directly against `ipcMain.handle` in five places: `window-manager.ts`, `preset-store.ts`, `profile-store.ts`, `hotkeys.ts` and `index.ts`. Nothing can invoke them except an IPC event, so the host server has no way to reach them.

The first change collects them into a single registry that maps a method name to its handler function, its class (see below), and whether it is long-running. `ipcMain.handle` registration reads from the registry, and so does the host server.

This is behaviour-neutral. It also makes the main-to-renderer contract explicit in one file, where today it is split between `preload.ts` and five separate registration functions.

**New file:** `src/main/method-registry.ts`
**Modified:** `window-manager.ts`, `preset-store.ts`, `profile-store.ts`, `hotkeys.ts`, `index.ts`

### 2. Method classification

Each of the thirty `MonCOMAPI` methods falls into one of three classes.

**Forwarded (21).** Run on the host when a remote target is active.

`getMonitors`, `launchZone`, `moveWindow`, `closeAllZones`, `findWindows`, `getPresets`, `savePreset`, `deletePreset`, `getSettings`, `saveSettings`, `registerHotkeys`, `applyPreset`, `playActions`, `isElevated`, `getElevatedAutoStart`, `setElevatedAutoStart`, `identifyMonitors`, `hasLaunchedWindows`, `getProfiles`, `saveProfile`, `deleteProfile`

**Always local (4).** Never leave the controller.

`windowMinimize`, `windowMaximize`, `windowClose` are the controller's own title bar. `openExternal` opens a link on the machine the operator is sitting at, which is what they mean every time.

**Blocked while remote (5).** These cannot work without someone physically at the host.

| Method | Why |
|---|---|
| `pickExecutable` | Opens a native file dialog on the host's screen, where the operator cannot see or dismiss it. A modal stuck open on a videowall is a failure nobody notices. |
| `startRecording` | Captures real mouse and keyboard input on the host machine. |
| `stopRecording` | Pairs with `startRecording`. |
| `onRecordingStatus` | A main-to-renderer push subscription. HTTP request/response carries no push channel, and with recording blocked there is nothing to push. |
| `openProfilesFolder` | Opens Explorer on the host. |

A blocked method returns a typed `{ unavailable: 'remote' }` result rather than throwing. The UI greys out the corresponding control while a remote target is active and states the reason, so the limitation is visible before the click rather than after it.

Exe paths for remote app zones are typed by hand in v1. A remote file browser is a candidate for a later version.

The zone window channels (`ZONE_ZOOM_STEP`, `ZONE_ZOOM_RESET`, `ZONE_TOGGLE_DEVTOOLS`) are `ipcMain.on` listeners for launched URL windows, not part of `MonCOMAPI`. They are out of scope and stay local to whichever instance owns the zone window.

### 3. Host server

**New file:** `src/main/remote-server.ts`

A `node:http` server bound to `127.0.0.1` on a configurable port, started only when the host role is enabled.

| Endpoint | Purpose |
|---|---|
| `POST /pair` | Exchange a pairing code for a persistent token. |
| `POST /rpc` | `{ id, method, params }`, returns `{ id, ok, result }` or `{ id, ok: false, error }`. |
| `POST /rpc/status` | Poll a long-running job by id. |
| `GET /health` | Instance name, app version, protocol version. Authenticated. |

Every endpoint except `/pair` requires a bearer token. The server rejects any method not in the registry, and rejects the blocked class outright so a hand-rolled client cannot reach past the UI guard.

### 4. Long-running calls

`applyPresetFromMain` launches zones sequentially in an awaited loop. Individual zones can take a long time: a UAC-elevated app launch waits up to 22 seconds for its window, the web-login safety timer runs to 25 seconds, and each app profile step allows 15 seconds. An eight-zone wall can plausibly take one to three minutes, which is longer than a typical HTTP proxy will hold a response open.

So `applyPreset` runs as a job rather than a synchronous call.

1. `POST /rpc` with `method: "applyPreset"` returns `{ ok: true, job: { id } }` immediately.
2. The host runs the apply in the background and records progress per zone.
3. The controller polls `POST /rpc/status` with the job id and gets `{ state, progress: { done, total, current }, result? }`.
4. When `state` is `done`, `result` is the normal `ApplyPresetResult`.

This requires `applyPresetFromMain` to accept an optional progress callback invoked as each zone finishes. That is a small additive change to its signature, and the existing callers pass nothing.

The payoff is more than timeout safety. Polling gives the operator a running readout ("zone 3 of 8: DSS client launched, zone 4 failed: window never appeared"), which is the closest thing to seeing the wall that this design offers.

Jobs are held in memory, capped at the most recent handful, with a ten minute expiry.

`closeAllZones` closes windows in parallel and finishes in roughly a second, so it stays synchronous.

### 5. Authentication

**Pairing.** The host's Settings page has a pairing panel. Opening it generates a six-digit code from `crypto.randomInt`, valid for five minutes, single use, and only while the panel is open. The controller submits the code and a device name to `POST /pair` and receives a token of 32 random bytes. After five failed attempts the code is invalidated and a new one must be generated.

**Tokens.** Compared with `crypto.timingSafeEqual`. The host keeps a list of paired devices (name, token hash, date paired, last seen) shown in Settings, each individually revocable. All authentication failures return a bare 401 with no detail.

**Consent.** Enabling the host role shows what it grants in plain terms: this endpoint launches executables on this machine, and when `runAsAdmin` is enabled it launches them elevated.

### 6. Controller storage

**New file:** `src/main/remote-targets.ts`

Targets are stored as `userData/moncom-data/remote-targets.json`, matching how presets, settings and profiles are already persisted (plain JSON files under `moncom-data`, read and written synchronously).

This store must stay separate from `AppSettings`. `getSettings` and `saveSettings` are forwarded methods, so while a remote target is active they read and write *the host's* settings. That is the desired behaviour for editing the wall's autostart preset, but it means anything stored in `AppSettings` disappears from view the moment the operator switches targets. The target list and the active target are therefore local-only state reached through their own IPC channels, which are never forwarded.

Host-role configuration (enabled, port, paired devices) is likewise local-only, in `userData/moncom-data/remote-host.json`.

### 7. Router

**New file:** `src/main/remote-router.ts`

Wraps registry dispatch. On each call: if no remote target is active, run the local handler. If a target is active, check the method's class and either run it locally (always-local), return `{ unavailable: 'remote' }` (blocked), or POST it to the target (forwarded).

Connection failures surface as a typed error the UI can render as a banner rather than a crash. Switching targets is explicit and never automatic, including after a connection drop.

### 8. Interface

- A target switcher in the sidebar listing Local plus every configured target, with a connection indicator.
- A persistent banner naming the active target, with an accent colour shift, visible on every page while remote.
- A confirmation step on Apply Preset and Close All Zones while a remote target is active. Applying a preset relaunches every window it describes, so doing it against the wrong machine is disruptive and immediate.
- A progress display for a running apply job, driven by the poll results.
- Greyed-out controls with a stated reason for the blocked methods.
- A Remote section in Settings covering both roles: host enable, port, pairing panel, paired device list on one side, and target management on the other.

## Testing

The repository has no test infrastructure today and ROADMAP Phase 6 is unstarted. This work adds a test runner and covers the parts of this subsystem that are pure logic and easy to get wrong, without attempting an Electron harness.

- Protocol envelope encode and decode, including malformed input.
- Method classification: every `MonCOMAPI` method has exactly one class, and the classification table matches the registry.
- Token comparison and pairing code lifecycle: expiry, single use, attempt limit.
- Job lifecycle: creation, progress accumulation, completion, expiry.

End-to-end verification is manual, against the real wall: pair the two machines, apply a preset remotely and confirm it comes up, confirm a blocked method is greyed out, confirm the banner and confirmation steps appear, and confirm revoking a device ends its access.

## Security summary

- Both roles off by default.
- Host binds to loopback only, never to a LAN interface.
- The tunnel's own access control is the outer perimeter, MonCOM's token the inner one.
- Tokens are 32 random bytes, compared in constant time, individually revocable.
- Pairing codes are short-lived, single use and attempt-limited.
- Only registry methods are reachable, and the blocked class is refused at the server, not just hidden in the UI.
- Enabling the host role states plainly that it can launch executables, elevated when `runAsAdmin` is on.

## Files

**New**
- `src/main/method-registry.ts`
- `src/main/remote-server.ts`
- `src/main/remote-client.ts`
- `src/main/remote-router.ts`
- `src/main/remote-targets.ts`
- `src/shared/remote-protocol.ts`

**Modified**
- `src/main/window-manager.ts` (registry, progress callback on `applyPresetFromMain`)
- `src/main/preset-store.ts`, `src/main/profile-store.ts`, `src/main/hotkeys.ts` (registry)
- `src/main/index.ts` (registry, start host server, wire router)
- `src/main/preload.ts`, `src/renderer/types.d.ts` (target management channels only)
- `src/shared/types.ts` (new IPC channel names, remote types)
- `src/renderer/components/Sidebar.tsx`, `src/renderer/pages/SettingsPage.tsx`, `src/renderer/pages/DashboardPage.tsx`
- `esbuild.main.mjs` if any new entry point needs its own bundle (not expected, the new files are imported by `index.ts`)
- `ROADMAP.md` (new phase)

## Open questions

None blocking. A remote file browser to replace `pickExecutable` is deferred. A WebSocket transport is deferred, and the JSON-RPC envelope is shaped so it could ride a socket later without changing the message format.
