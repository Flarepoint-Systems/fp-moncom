/**
 * Silent elevated startup via a Windows scheduled task.
 *
 * A Run-key entry (what `app.setLoginItemSettings` writes) always starts
 * unelevated, so MonCOM has to self-elevate and the user gets a UAC consent
 * dialog every morning. A scheduled task registered with RunLevel
 * HighestAvailable starts elevated with no prompt, which is the supported
 * Windows mechanism for this. The same task doubles as the relaunch route for
 * manual starts, so no launch prompts.
 *
 * Registering the task needs elevation; when MonCOM isn't elevated we ask for
 * it once, at setup time, rather than on every start.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const TASK_NAME = 'MonCOM Elevated Startup';

/** Logon-to-start delay, giving displays and drivers time to settle before zones are placed. */
const LOGON_DELAY = 'PT30S';

export interface TaskResult {
  ok: boolean;
  error?: string;
}

function currentUserId(): string {
  const domain = process.env.USERDOMAIN || os.hostname();
  const user = process.env.USERNAME || os.userInfo().username;
  return `${domain}\\${user}`;
}

function schtasks(args: string[]): { status: number | null; output: string } {
  const r = spawnSync('schtasks.exe', args, { windowsHide: true, encoding: 'utf8' });
  return { status: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/** True when the task is registered. The OS is the source of truth, not a saved flag. */
export function startupTaskExists(): boolean {
  return schtasks(['/query', '/tn', TASK_NAME]).status === 0;
}

/** Start MonCOM through the task, which elevates without a consent prompt. */
export function runStartupTask(): boolean {
  return schtasks(['/run', '/tn', TASK_NAME]).status === 0;
}

/**
 * Task definition. Written as XML rather than assembled from schtasks flags
 * because the defaults are wrong for a wall display: a task created from the
 * command line is killed after 72 hours and won't start on battery.
 */
function taskXml(exePath: string): string {
  const user = currentUserId();
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Starts MonCOM elevated at logon without a UAC prompt.</Description>
    <Author>MonCOM</Author>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${user}</UserId>
      <Delay>${LOGON_DELAY}</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${user}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>"${exePath}"</Command>
    </Exec>
  </Actions>
</Task>`;
}

/** Run schtasks through a UAC prompt. Args with spaces keep embedded quotes, since PowerShell joins the list. */
function schtasksElevated(args: string[]): TaskResult {
  const list = args.map((a) => (a.includes(' ') ? `'"${a}"'` : `'${a}'`)).join(',');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p = Start-Process -FilePath 'schtasks.exe' -ArgumentList ${list} -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`],
    { windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) {
    return { ok: false, error: 'schtasks failed, or administrator permission was declined.' };
  }
  return { ok: true };
}

/** Register (or replace) the task. `elevated` decides whether we can call schtasks directly. */
export function createStartupTask(exePath: string, elevated: boolean): TaskResult {
  const xmlPath = path.join(os.tmpdir(), `moncom-task-${process.pid}.xml`);
  const args = ['/create', '/tn', TASK_NAME, '/xml', xmlPath, '/f'];
  try {
    // schtasks only accepts UTF-16 task XML, and it must carry the BOM.
    fs.writeFileSync(xmlPath, `﻿${taskXml(exePath)}`, { encoding: 'utf16le' });

    if (!elevated) return schtasksElevated(args);

    const r = schtasks(args);
    if (r.status !== 0) return { ok: false, error: r.output || `schtasks exited with ${r.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    try { fs.unlinkSync(xmlPath); } catch { /* best effort */ }
  }
}

export function removeStartupTask(elevated: boolean): TaskResult {
  if (!startupTaskExists()) return { ok: true };
  const args = ['/delete', '/tn', TASK_NAME, '/f'];

  if (!elevated) return schtasksElevated(args);

  const r = schtasks(args);
  if (r.status !== 0) return { ok: false, error: r.output || `schtasks exited with ${r.status}` };
  return { ok: true };
}
