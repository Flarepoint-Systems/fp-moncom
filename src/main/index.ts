import { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, dialog } from 'electron';
import * as path from 'path';
import { execSync, spawn, spawnSync } from 'child_process';
import { registerWindowHandlers, applyPresetFromMain } from './window-manager';
import { registerPresetHandlers, loadSettings, loadPresets } from './preset-store';
import { registerProfileHandlers } from './profile-store';
import { getStableMonitors } from './monitors';
import { startRecording, stopRecording, playActions } from './automation-manager';
import { initAutoUpdater } from './updater';
import { registerHotkeys, registerHotkeyHandlers } from './hotkeys';
import type { MonitorInfo } from '../shared/types';
import { IPC } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
// Set once a real quit is underway, so the close handler stops intercepting.
let isQuitting = false;

const isDev = !app.isPackaged;

/**
 * Check if the current process is running with administrator privileges.
 */
function isProcessElevated(): boolean {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}


/**
 * Show identification overlays on all monitors. Click anywhere to dismiss.
 */
let identifyOverlays: BrowserWindow[] = [];

function closeIdentifyOverlays(): void {
  for (const win of identifyOverlays) {
    if (!win.isDestroyed()) win.close();
  }
  identifyOverlays = [];
}

function identifyMonitors(): void {
  // Close any existing overlays first
  closeIdentifyOverlays();

  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();

  for (let i = 0; i < displays.length; i++) {
    const d = displays[i];
    const isPrimary = d.id === primary.id;
    const name = `Monitor ${i + 1}${isPrimary ? ' (Primary)' : ''}`;

    const overlay = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: true,
      resizable: false,
      webPreferences: { contextIsolation: true },
    });

    const html = `
      <html><body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:rgba(14,17,22,0.92);font-family:system-ui,sans-serif;cursor:pointer;user-select:none;" onclick="window.close()">
        <div style="text-align:center;animation:fadeIn 0.2s ease-out">
          <div style="font-size:140px;font-weight:800;color:#2A7FFF;line-height:1">${i + 1}</div>
          <div style="font-size:24px;color:#8B949E;margin-top:16px">${name}</div>
          <div style="font-size:16px;color:#484F58;margin-top:6px">${d.bounds.width} × ${d.bounds.height}</div>
          <div style="font-size:14px;color:#484F58;margin-top:24px">Click anywhere to dismiss</div>
        </div>
        <style>@keyframes fadeIn{from{opacity:0;transform:scale(0.95)}to{opacity:1;transform:scale(1)}}</style>
      </body></html>
    `;

    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // When any overlay is closed, close all of them
    overlay.on('closed', () => {
      closeIdentifyOverlays();
    });

    identifyOverlays.push(overlay);
  }
}

function createWindow(startHidden = false) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0E1116',
    // Launched via `--apply` to bring up a wall: stay in the tray, don't pop the UI.
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '../../build/icon.png'),
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', (e) => {
    // Hide to tray only when the setting is on (and not during a real quit).
    // With "minimize to tray" off, let the close proceed so the app exits.
    if (!isQuitting && loadSettings().minimizeToTray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../build/icon.png'));
  tray = new Tray(icon);
  tray.setToolTip('MonCOM - Monitor Commander');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show MonCOM', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { mainWindow?.destroy(); app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => mainWindow?.show());
}

function getMonitors(): MonitorInfo[] {
  return getStableMonitors(screen);
}

/** Extract the value of `--apply <name>` / `--apply=<name>` from an argv array, if present. */
function getApplyArg(argv: string[]): string | null {
  const idx = argv.findIndex((a) => a === '--apply' || a.startsWith('--apply='));
  if (idx === -1) return null;
  const arg = argv[idx];
  const name = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[idx + 1];
  return name ? name.trim() : null;
}

/** Apply a saved preset by name (case-insensitive). Used by the --apply CLI flag. */
function applyPresetByName(name: string): void {
  const target = name.trim().toLowerCase();
  const preset = loadPresets().find((p) => p.name.trim().toLowerCase() === target);
  if (!preset) {
    console.error(`[MonCOM] --apply: no preset named "${name}"`);
    return;
  }
  applyPresetFromMain(preset, screen).catch((err) =>
    console.error('[MonCOM] --apply failed:', err),
  );
}

/** Run an --apply request from an argv array (startup or a forwarded second instance). */
function handleCliApply(argv: string[]): void {
  const name = getApplyArg(argv);
  if (name) applyPresetByName(name);
}

// Single-instance: only one MonCOM owns the workspace. A second launch (e.g.
// `moncom.exe --apply "Trading Wall"`) hands its argv to the running instance via
// the 'second-instance' event and then exits, instead of stacking a second tray.
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    handleCliApply(argv);
  });
}

app.whenReady().then(() => {
  // A second instance is on its way out; don't build a UI for it.
  if (!gotTheLock) return;

  // Self-elevate at startup when "Run as administrator" is enabled, so apps that
  // require elevation launch directly (inheriting our token) instead of prompting
  // UAC on every launch. Guarded against a relaunch loop: the elevated instance
  // passes isProcessElevated() and skips this. In dev we never elevate.
  if (!isDev) {
    try {
      if (loadSettings().runAsAdmin && !isProcessElevated()) {
        // For a portable build, process.execPath is a temp-extracted copy that the
        // portable wrapper deletes as soon as this process exits — so relaunching it
        // would target a vanished exe. electron-builder exposes the real portable
        // exe via PORTABLE_EXECUTABLE_FILE; relaunch that so it re-extracts elevated.
        const relaunchTarget = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
        // Use spawnSync (not detached spawn + immediate app.exit): a fire-and-forget
        // spawn gets torn down by the hard exit before it can raise the UAC prompt.
        // Blocking here keeps this process alive through the consent dialog. The
        // PowerShell exit code reflects the outcome: 0 = elevated instance launched;
        // non-zero = user declined or it failed, in which case we fall through and
        // open unelevated rather than silently doing nothing.
        // Release the single-instance lock before the relaunch so the elevated
        // instance is guaranteed to find it free (it boots while we're still here).
        app.releaseSingleInstanceLock();
        const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
          `Start-Process -FilePath '${relaunchTarget.replace(/'/g, "''")}' -Verb RunAs`],
          { windowsHide: true });
        if (result.status === 0) {
          app.exit(0);
          return;
        }
        // Declined or failed: re-acquire the lock and continue unelevated.
        app.requestSingleInstanceLock();
        console.error('[MonCOM] Elevation declined or failed, continuing unelevated:', result.error);
      }
    } catch (e) {
      console.error('[MonCOM] Elevation relaunch failed, continuing unelevated:', e);
    }
  }

  createWindow(getApplyArg(process.argv) !== null);
  createTray();
  initAutoUpdater();
  registerHotkeys();

  // Monitor detection
  ipcMain.handle(IPC.GET_MONITORS, () => getMonitors());

  // Window title bar controls
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  // Route through close() so the 'close' handler decides hide-to-tray vs quit
  // based on the minimizeToTray setting, instead of always hiding.
  ipcMain.on('window-close', () => mainWindow?.close());

  // Open external URLs in default browser
  ipcMain.handle('open-external', (_event, url: string) => {
    if (url.startsWith('https://')) return shell.openExternal(url);
  });

  // File picker for selecting executables
  ipcMain.handle('pick-executable', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Application',
      filters: [
        { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'lnk'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
      defaultPath: 'C:\\Program Files',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // Register other IPC handlers
  registerWindowHandlers(ipcMain);
  registerPresetHandlers(ipcMain);
  registerProfileHandlers(ipcMain);
  registerHotkeyHandlers(ipcMain);

  // Automation: recording & playback
  ipcMain.handle(IPC.START_RECORDING, (_event, zone, monitors) => {
    return startRecording(zone, monitors, (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.RECORDING_STATUS, status);
      }
    });
  });
  ipcMain.handle(IPC.STOP_RECORDING, () => {
    return stopRecording();
  });
  ipcMain.handle(IPC.PLAY_ACTIONS, async (_event, actions, zone, monitors) => {
    return playActions(actions, zone, monitors);
  });

  // Elevation check
  ipcMain.handle(IPC.IS_ELEVATED, () => {
    return isProcessElevated();
  });

  // Monitor identification
  ipcMain.handle(IPC.IDENTIFY_MONITOR, () => {
    identifyMonitors();
  });

  // Auto-launch preset on startup
  try {
    const settings = loadSettings();
    if (settings.autoLaunchPreset && settings.autoLaunchPresetId) {
      const presets = loadPresets();
      const preset = presets.find(p => p.id === settings.autoLaunchPresetId);
      if (preset) {
        console.log(`[MonCOM] Auto-launching preset: ${preset.name}`);
        // Small delay to let monitors settle after boot
        setTimeout(() => {
          applyPresetFromMain(preset, screen);
        }, 3000);
      }
    }
  } catch (e) {
    console.error('[MonCOM] Auto-launch failed:', e);
  }

  // Apply a preset if this instance was launched with `--apply "<preset>"`.
  handleCliApply(process.argv);
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
