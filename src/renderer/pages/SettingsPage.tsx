import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ChevronDown, ShieldAlert } from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
import type { AppSettings, Preset } from '../../shared/types';

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'dark',
    launchOnStartup: false,
    minimizeToTray: true,
    autoLaunchPreset: false,
    autoLaunchPresetId: null,
    runAsAdmin: false,
    hotkeys: {},
  });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saved, setSaved] = useState(false);
  const [elevatedAutoStart, setElevatedAutoStart] = useState(false);
  const [autoStartBusy, setAutoStartBusy] = useState(false);
  const [autoStartError, setAutoStartError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    window.moncom?.getSettings().then((s) => { setSettings(s); loaded.current = true; });
    window.moncom?.getPresets().then(setPresets);
    window.moncom?.getElevatedAutoStart().then(setElevatedAutoStart);
  }, []);

  const toggleElevatedAutoStart = async () => {
    const next = !elevatedAutoStart;
    setAutoStartBusy(true);
    setAutoStartError(null);
    const result = await window.moncom?.setElevatedAutoStart(next);
    setAutoStartBusy(false);
    if (result?.ok) {
      setElevatedAutoStart(next);
    } else {
      setAutoStartError(result?.error ?? 'Could not change the startup task.');
    }
  };

  // Auto-save whenever settings change (skip the initial load)
  const saveSettings = useCallback(async (s: AppSettings) => {
    const toSave = {
      ...s,
      autoLaunchPresetId: s.autoLaunchPreset ? s.autoLaunchPresetId : null,
    };
    await window.moncom?.saveSettings(toSave);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    saveSettings(settings);
  }, [settings, saveSettings]);

  const toggle = (key: 'launchOnStartup' | 'minimizeToTray' | 'autoLaunchPreset' | 'runAsAdmin') => {
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedPresetName = presets.find(p => p.id === settings.autoLaunchPresetId)?.name;

  return (
    <div className="animate-fade-in max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-brand text-2xl font-bold text-text-primary tracking-tight">
          Settings
        </h1>
        <p className="text-sm text-text-secondary mt-1.5">
          Configure MonCOM behavior
        </p>
      </div>

      {/* General */}
      <section className="bg-bg-surface border border-border rounded-xl mb-6">
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">General</h2>
        </div>

        <SettingRow
          title="Launch on startup"
          description={elevatedAutoStart
            ? 'Handled by the elevated startup task, 30 seconds after you log on'
            : 'Start MonCOM automatically when Windows boots'}
          checked={settings.launchOnStartup}
          onChange={() => toggle('launchOnStartup')}
        />

        <SettingRow
          title="Minimize to tray"
          description="Keep MonCOM running in the system tray when the window is closed"
          checked={settings.minimizeToTray}
          onChange={() => toggle('minimizeToTray')}
          last
        />
      </section>

      {/* Elevated Launch */}
      <section className="bg-bg-surface border border-border rounded-xl mb-6">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Administrator Privileges</h2>
          <Tooltip text="Lets MonCOM launch apps that need administrator rights. Asks for permission when MonCOM starts." />
        </div>

        <SettingRow
          title="Run as administrator"
          description="Required only for launching applications that need elevated privileges"
          checked={settings.runAsAdmin}
          onChange={() => toggle('runAsAdmin')}
          last={!settings.runAsAdmin}
        />

        {settings.runAsAdmin && (
          <>
            <SettingRow
              title="Skip the permission prompt"
              description="Register a Windows scheduled task that starts MonCOM elevated, at logon and on every manual launch, without asking"
              checked={elevatedAutoStart}
              onChange={toggleElevatedAutoStart}
              disabled={autoStartBusy}
              last
            />
            <div className="px-6 py-4 border-t border-border flex items-start gap-3 bg-warning/5">
              <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-text-secondary leading-relaxed">
                {elevatedAutoStart
                  ? `MonCOM starts with administrator rights and no prompt, through the scheduled task "MonCOM Elevated Startup". Anyone who can start MonCOM on this PC gets it elevated. Turn this off to go back to the permission prompt.`
                  : 'With this on, MonCOM asks for administrator permission each time it starts. Leave it off unless you need to launch apps that require elevation.'}
              </p>
            </div>
            {autoStartError && (
              <div className="px-6 pb-4 -mt-1 text-xs text-danger">{autoStartError}</div>
            )}
          </>
        )}
      </section>

      {/* Auto-launch */}
      <section className="bg-bg-surface border border-border rounded-xl mb-6">
        <div className="px-6 py-4 border-b border-border flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">Auto-launch Preset</h2>
          <Tooltip text="Applies the chosen preset automatically when MonCOM starts. Pair with Launch on startup to set up your monitors on every boot." />
        </div>

        <SettingRow
          title="Enable auto-launch"
          description="Automatically apply a preset when MonCOM starts"
          checked={settings.autoLaunchPreset}
          onChange={() => toggle('autoLaunchPreset')}
          last={!settings.autoLaunchPreset}
        />

        {settings.autoLaunchPreset && (
          <div className="px-6 py-5 border-t border-border">
            <label className="text-xs text-text-muted uppercase tracking-widest font-medium block mb-2">
              Preset to launch
            </label>
            {presets.length > 0 ? (
              <div className="relative">
                <select
                  value={settings.autoLaunchPresetId || ''}
                  onChange={(e) => setSettings(prev => ({
                    ...prev,
                    autoLaunchPresetId: e.target.value || null,
                  }))}
                  className="w-full appearance-none px-4 py-2.5 pr-10 bg-bg-dark border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-commander/60 transition-colors cursor-pointer"
                >
                  <option value="">Select a preset...</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-text-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                No presets available. Create one in the Layout Editor first.
              </p>
            )}
            {selectedPresetName && (
              <p className="text-xs text-text-secondary mt-2.5">
                <span className="text-commander font-medium">{selectedPresetName}</span> will be applied automatically when MonCOM starts.
              </p>
            )}
          </div>
        )}
      </section>

      {/* Auto-save indicator */}
      <div className={`text-xs text-text-muted transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}>
        Settings saved automatically
      </div>
    </div>
  );
}

function SettingRow({ title, description, checked, onChange, last, disabled }: {
  title: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  last?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`px-6 py-5 flex items-center justify-between gap-6 ${last ? '' : 'border-b border-border'}`}>
      <div>
        <p className="text-sm text-text-primary font-medium">{title}</p>
        <p className="text-xs text-text-secondary mt-1">{description}</p>
      </div>
      <button
        onClick={onChange}
        disabled={disabled}
        className={`w-11 h-6 rounded-full transition-colors relative shrink-0 disabled:opacity-40 ${
          checked ? 'bg-commander' : 'bg-bg-steel'
        }`}
      >
        <div
          className={`w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-all ${
            checked ? 'left-5.5' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

