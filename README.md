<h1 align="center">Flarepoint MonCOM | Monitor Commander</h1>

<p align="center">
  <strong>Your multi-monitor command center for Windows.</strong>
</p>

<p align="center">
  <a href="#what-is-moncom">What is MonCOM?</a> •
  <a href="#why-not-just-fancyzones">Why not FancyZones?</a> •
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#building-from-source">Building from Source</a> •
  <a href="#project-structure">Project Structure</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-blue?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/node-%3E%3D20.19-339933?style=flat-square&logo=nodedotjs" alt="Node" />
  <img src="https://img.shields.io/badge/electron-41-47848f?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61dafb?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License" />
</p>

<table>
<tr>
<td valign="middle" width="55%">

**MonCOM brings up your entire multi-monitor workspace in one click.**

Describe once which apps and dashboards go where, across every display, and save it as a preset. MonCOM opens each one, positions it exactly, and can log it in for you. Run it on demand, or automatically when Windows starts.

Built for ops walls, dashboard kiosks, and any setup that's more than a couple of windows.

</td>
<td valign="middle" width="45%">
<img src="assets/moncom-wall.gif" alt="MonCOM reconfiguring a video wall across multiple monitors" width="100%" />
</td>
</tr>
</table>

> **Note:** MonCOM is in pre-release (v0.x). Features may be incomplete or change, and there is no downloadable build yet. Until then, see [Building from Source](#building-from-source).

---

## What is MonCOM?

MonCOM (Monitor Commander) turns a wall of monitors into a single, repeatable command center. You describe your workspace once: which apps and dashboards go where, across every display. Save it as a preset, then bring the whole thing up with one click, or automatically when Windows boots.

It doesn't just open windows in the right place. Each zone can **log itself in, dismiss a startup dialog, and navigate to the right view** by replaying a sequence you record once. A six-screen ops wall, a monitoring kiosk, or a fixed trading layout comes up fully positioned and fully signed in, with no one at the keyboard.

It's built for the set-it-up-once, run-it-daily crowd: NOC and ops walls, dashboard kiosks, streaming rigs, and anyone whose workspace is more than a couple of windows.

---

## Why not just FancyZones?

If you want to drag a window into a zone while you work, use [PowerToys FancyZones](https://learn.microsoft.com/windows/powertoys/fancyzones). It's free, excellent, and MonCOM doesn't try to replace it.

MonCOM solves a different problem. FancyZones helps you place a window **you've already opened**. MonCOM **opens the windows for you**: the right apps and URLs, on the right monitors, in the right zones. Then it drives them past the login screen, on demand or on boot. One is a snapping tool. The other brings up an entire workspace, repeatably, with no clicks.

| | FancyZones / DisplayFusion | MonCOM |
|---|:---:|:---:|
| Snap a window you opened into a zone | ✅ | — |
| Launch the apps & dashboards themselves | — | ✅ |
| Position them across multiple monitors in one action | partial | ✅ |
| Auto-login / click-through, per window | — | ✅ |
| Bring the whole setup up on boot | — | ✅ |

If your workspace is "snap my editor next to my browser," that's FancyZones. If it's "bring up my whole wall, logged in, every morning," that's MonCOM.

---

## Features

### Monitor Detection
MonCOM detects all connected displays and reads their resolution, position, scale factor, and primary status. No manual setup needed.

### Layout Editor
Split any monitor into zones using built-in templates:

| Template | Description |
|----------|-------------|
| **Full Screen** | Entire monitor as a single zone |
| **2 Columns** | Vertical 50/50 split |
| **2 Rows** | Horizontal 50/50 split |
| **2×2 Grid** | Four equal quadrants |
| **3×3 Grid** | Nine equal cells |
| **Main + Side** | 70/30 split for a primary + sidebar workflow |

Each zone can be assigned either:
- **A URL** opens in a frameless browser window, positioned on the zone.
- **An application** launches and moves into position.

### Auto-Login & Action Playback (the headline feature)
This is what sets MonCOM apart from a plain window-snapping tool. After assigning content to a zone, you can record a click and keyboard sequence that MonCOM replays every time that zone launches. The window doesn't just open in position; it arrives logged in and ready. Use it for:
- Logging into a web dashboard
- Clicking through a startup dialog
- Navigating to a specific tab or view
- Typing into search fields or forms

Click **Record** in the zone editor's Automation section. MonCOM closes any open zones, runs a countdown, then launches the zone's content, so the real startup time is captured. Switch to the launched window, perform your actions, then return and click **Stop** (the stop click isn't recorded). Recorded actions cover mouse clicks, keystrokes, scroll, and the timing between steps. Coordinates are stored relative to the zone, so sequences stay valid across resolution changes. You can also add "type text" actions by hand, and set a per-zone launch delay when the content needs more time to load.

### Presets
Save any layout as a named preset. Apply it later with a single click from the dashboard or presets page. MonCOM tracks how many zones each preset has and when it was created.

### Dashboard
A central overview of your monitors and presets with quick-action buttons:
- **New Layout** opens the editor.
- **Close All** closes every launched zone window at once.
- **Refresh Monitors** re-detects displays after you plug in or rearrange them.

### Settings
- **Launch on startup** registers MonCOM to start with Windows.
- **Minimize to tray** keeps MonCOM running in the background.
- **Auto-launch preset** applies a saved preset when MonCOM starts.
- **Run as administrator** lets MonCOM launch apps that need elevated privileges. When it's on, MonCOM asks for administrator permission each time it starts.
- **Skip the permission prompt** (shown under Run as administrator) registers a Windows scheduled task named "MonCOM Elevated Startup". The task starts MonCOM elevated 30 seconds after you log on, and manual launches go through it too, so the permission dialog never appears. This is meant for an unattended wall display that has to come up on its own in the morning. Note that anyone who can start MonCOM on that PC then gets it with administrator rights and no prompt. Turning the switch off removes the task and restores the prompt.

  The account that logs in must be a local administrator, since the task runs with that account's own token. If you move or reinstall MonCOM to a different folder, switch this off and on again so the task points at the new path.

### System Tray Integration
MonCOM lives in your system tray. Double-click the icon or use the context menu to show or hide the main window without closing the app.

---

## Installation

### From a Release

1. Head to the [Releases](../../releases) page.
2. Download the latest build:
   - **MonCOM-Setup-`<version>`.exe** is the installer. Pick this one if you want MonCOM in your Start menu and automatic updates.
   - **MonCOM-Portable-`<version>`.exe** is the portable build. It runs as a single file with no install, but it does not auto-update.
3. Run the installer and follow the prompts, or just run the portable `.exe`.

#### About the SmartScreen warning

MonCOM is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC" the first time you run it. That is expected for an unsigned app, not a sign that anything is wrong. To run it, click **More info**, then **Run anyway**.

A code-signing certificate is on the roadmap; until then, verifying the checksum (below) is the way to confirm your download is genuine.

#### Verifying your download

Every release publishes a `checksums.txt` with the SHA256 hash of each file. To check the file you downloaded matches:

```powershell
Get-FileHash .\MonCOM-Setup-<version>.exe -Algorithm SHA256
```

Compare the printed hash against the matching line in `checksums.txt`. If they match, the download is intact.

### From Source

See [Building from Source](#building-from-source) below.

---

## Getting Started

### 1. Launch MonCOM
Open the app. The **Dashboard** shows every monitor connected to your system along with any presets you've saved.

### 2. Create a Layout
Click **New Layout** (or navigate to the **Layout Editor** from the sidebar).

1. Select a monitor from the monitor map at the top of the editor.
2. Choose a split template (e.g., 2 Columns).
3. Click on a zone to configure it:
   - Pick **URL** and enter a web address, or
   - Pick **App** and browse for an executable.
4. Repeat for additional monitors or zones.

### 3. Test It
Click **Quick Apply** to launch all configured zones immediately. MonCOM positions each window pixel-perfect inside its zone. Use **Close All** to tear everything down.

### 4. Save as a Preset
Give your layout a name and click **Save Preset**. It now appears on the Dashboard and the Presets page for one-click access.

### 5. Record Actions (Optional)
With a zone selected that has content assigned, scroll down to the **Automation** section:

1. Click **Record**. MonCOM closes any open zones and starts a 3-second countdown.
2. After the countdown, the zone's content launches so the real startup delay is captured.
3. Interact with the launched content: click buttons, type text, navigate menus.
4. Return to MonCOM and click **Stop Recording**. The stop click is automatically excluded.
5. Your actions appear in a list. Use **Play** to test them, or **Clear** to start over.
6. You can also manually add "type text" actions for entering text strings.

While recording, the panel shows a live count of what has been captured, so you can tell straight away that your clicks are landing. Clicks outside the zone rectangle are kept too (a login dialog that opens elsewhere still replays correctly), and the panel says how many there were.

Actions are saved with the preset and replay automatically after the zone content launches.

### 6. Automate
In **Settings**, enable **Launch on startup** and pick your preset under **Auto-launch preset**. Your entire workspace is set up automatically every time Windows starts, including action sequences.

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) 20.19+ or 22.12+
- npm (bundled with Node.js)
- Windows 10/11

### Setup

```bash
# Clone the repository
git clone https://github.com/Flarepoint-Systems/fp-moncom.git
cd fp-moncom

# Install dependencies
npm install
```

### Development

```bash
# Start the dev environment (Vite dev server + Electron)
npm run dev
```

This launches the Vite dev server for the renderer on `http://localhost:5173`, builds the main process with esbuild, and opens the Electron window with hot-reload enabled.

### Production Build

```bash
# Build both renderer and main process
npm run build

# Package as a Windows installer (.exe)
npm run pack
```

The installer is output to the `release/` directory.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the full development environment |
| `npm run dev:renderer` | Start the Vite dev server only |
| `npm run dev:main` | Build the main process and launch Electron |
| `npm run build` | Build renderer and main for production |
| `npm run build:renderer` | Build the React renderer with Vite |
| `npm run build:main` | Bundle the main process with esbuild |
| `npm run start` | Build and launch the packaged app |
| `npm run pack` | Package as a Windows NSIS installer |

---

## Project Structure

```
fp-moncom/
├── src/
│   ├── main/                        # Electron main process
│   │   ├── index.ts                 # App init, window & tray management
│   │   ├── preload.ts               # Secure IPC bridge (context isolation)
│   │   ├── window-manager.ts        # Window positioning & zone launching
│   │   └── preset-store.ts          # Preset & settings persistence
│   │
│   ├── renderer/                    # React frontend
│   │   ├── main.tsx                 # React entry point
│   │   ├── App.tsx                  # App shell & page routing
│   │   ├── index.html               # HTML template
│   │   ├── components/
│   │   │   ├── TitleBar.tsx         # Custom frameless window controls
│   │   │   ├── Sidebar.tsx          # Navigation menu
│   │   │   └── Tooltip.tsx          # Reusable tooltip
│   │   ├── pages/
│   │   │   ├── DashboardPage.tsx    # Overview & quick actions
│   │   │   ├── LayoutEditorPage.tsx # Zone configuration UI
│   │   │   ├── PresetsPage.tsx      # Preset management
│   │   │   └── SettingsPage.tsx     # App settings
│   │   └── styles/
│   │       └── globals.css          # Theme tokens & animations
│   │
│   └── shared/
│       └── types.ts                 # Shared TypeScript interfaces
│
├── build/                           # App icons
├── esbuild.main.mjs                 # Main process build config
├── vite.config.ts                   # Renderer build config
├── tsconfig.json                    # TypeScript config
└── package.json                     # Dependencies & scripts
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Desktop Runtime** | Electron 41 |
| **UI** | React 19, TypeScript 5.9, Tailwind CSS 4 |
| **Bundling** | Vite 8 (renderer), esbuild (main process) |
| **Persistence** | electron-store (JSON-based, per-user) |
| **Packaging** | electron-builder (NSIS installer + portable) |
| **Icons** | Lucide React |

---

## Data Storage

MonCOM stores its data in your user application data directory:

```
%APPDATA%\MonCOM\moncom-data\
├── presets.json      # Saved layout presets
└── settings.json     # App settings
```

No cloud services, no telemetry, no accounts. Everything stays on your machine.

---

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m "Add my feature"`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built by <strong>Flarepoint</strong>
</p>
