import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

/**
 * Wire up background auto-updates for the installed (NSIS) build.
 *
 * Only the installed build can self-update: dev has no update feed, and the
 * portable build runs from a throwaway temp extraction with nothing to patch.
 * Both are skipped. The update feed url comes from app-update.yml, which
 * electron-builder generates from the `publish` config in package.json.
 *
 * Flow: check on startup, download in the background, and once an update is
 * ready, ask whether to restart now. Declining still installs it on the next
 * quit (autoInstallOnAppQuit), so a patch never needs a manual re-download.
 */
export function initAutoUpdater(): void {
  if (!app.isPackaged) return;
  if (process.env.PORTABLE_EXECUTABLE_FILE) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `MonCOM ${info.version} has been downloaded.`,
      detail: 'Restart to finish updating. It will also install the next time you quit.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  // Update failures should never interrupt the app; log and move on.
  autoUpdater.on('error', (err) => {
    console.error('[MonCOM] Auto-update error:', err);
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[MonCOM] Auto-update check failed:', err);
  });
}
