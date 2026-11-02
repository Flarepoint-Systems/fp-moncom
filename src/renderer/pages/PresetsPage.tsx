import React, { useEffect, useRef, useState } from 'react';
import { Play, Trash2, Clock, Layers, Bookmark, Pencil, Upload, Download, Copy } from 'lucide-react';
import type { AppSettings, ImportPresetPreview, Preset } from '../../shared/types';
import type { Page } from '../App';
import { formatApplyResult } from '../applyResultMessage';
import { HotkeyField } from '../components/HotkeyField';
import { ImportPresetDialog } from '../components/ImportPresetDialog';

interface PresetsPageProps {
  onNavigate: (page: Page) => void;
  onEditPreset: (preset: Preset) => void;
}

export function PresetsPage({ onNavigate, onEditPreset }: PresetsPageProps) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const [importPreview, setImportPreview] = useState<Extract<ImportPresetPreview, { ok: true }> | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Enter or Escape ends the rename before the input's blur fires, so blur must not save again.
  const renameTarget = useRef<string | null>(null);

  useEffect(() => {
    window.moncom?.getPresets().then(setPresets);
    window.moncom?.getSettings().then(setSettings);
    // Surface any shortcuts that couldn't bind (taken by Windows or another app).
    window.moncom?.registerHotkeys().then((report) =>
      setConflicts(new Set((report?.failed || []).map((f) => f.presetId))),
    );
  }, []);

  const handleSetHotkey = async (presetId: string, accelerator: string | null) => {
    if (!settings) return;
    const hotkeys = { ...settings.hotkeys };
    if (accelerator) {
      // An accelerator maps to exactly one preset: drop it from any other binding.
      for (const id of Object.keys(hotkeys)) {
        if (hotkeys[id] === accelerator) delete hotkeys[id];
      }
      hotkeys[presetId] = accelerator;
    } else {
      delete hotkeys[presetId];
    }
    const updated = { ...settings, hotkeys };
    setSettings(updated);
    await window.moncom?.saveSettings(updated);
    const report = await window.moncom?.registerHotkeys();
    setConflicts(new Set((report?.failed || []).map((f) => f.presetId)));
  };

  const handleApply = async (preset: Preset) => {
    setApplying(preset.id);
    try {
      const result = await window.moncom?.applyPreset(preset);
      setStatusMessage(formatApplyResult(result));
    } catch (e) {
      console.error('Failed to apply preset:', e);
      setStatusMessage('Failed to apply preset. See logs for details.');
    } finally {
      setApplying(null);
    }
  };

  const handleDelete = async (id: string) => {
    const updated = await window.moncom?.deletePreset(id);
    if (updated) setPresets(updated);
    setConfirmDelete(null);
  };

  const handleImport = async () => {
    const preview = await window.moncom?.importPresetPreview();
    if (!preview) return;
    if (preview.ok) setImportPreview(preview);
    else if (preview.error) setStatusMessage(preview.error);
  };

  const handleImportCommit = async (name: string) => {
    if (!importPreview) return;
    const updated = await window.moncom?.importPresetCommit(importPreview.preset, importPreview.plan, name);
    if (updated) setPresets(updated);
    setImportPreview(null);
  };

  const handleExport = async (id: string) => {
    const result = await window.moncom?.exportPreset(id);
    if (!result) return;
    if (result.ok) setStatusMessage(`Saved to ${result.path}.`);
    else if (result.error) setStatusMessage(result.error);
  };

  const handleDuplicate = async (p: Preset) => {
    const now = new Date().toISOString();
    const updated = await window.moncom?.savePreset({
      ...p,
      id: 'preset-' + Date.now(),
      name: p.name + ' copy',
      layout: { ...p.layout, id: 'layout-preset-' + Date.now() },
      createdAt: now,
      updatedAt: now,
    });
    if (updated) setPresets(updated);
  };

  const startRename = (p: Preset) => {
    renameTarget.current = p.id;
    setRenamingId(p.id);
    setRenameValue(p.name);
  };

  const finishRename = async (save: boolean) => {
    const id = renameTarget.current;
    renameTarget.current = null;
    setRenamingId(null);
    const preset = presets.find((p) => p.id === id);
    const name = renameValue.trim();
    if (!save || !preset || !name || name === preset.name) return;
    const updated = await window.moncom?.savePreset({ ...preset, name });
    if (updated) setPresets(updated);
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-brand text-2xl font-bold text-text-primary tracking-tight">
            Presets
          </h1>
          <p className="text-sm text-text-secondary mt-1.5">
            Saved layouts — launch or switch your whole setup in one click
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleImport}
            className="flex items-center gap-2.5 px-5 py-2.5 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-commander/40 transition-colors text-sm font-medium"
            title="Imports a preset from a file and shows where its zones will land first."
          >
            <Upload className="w-4 h-4" /> Import
          </button>
          <button
            onClick={() => onNavigate('editor')}
            className="flex items-center gap-2.5 px-5 py-2.5 bg-commander text-white rounded-lg hover:bg-commander-core transition-colors text-sm font-medium"
          >
            <Layers className="w-4 h-4" /> New Layout
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="mb-6 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {statusMessage}
        </div>
      )}

      {presets.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="bg-bg-surface border border-border rounded-xl p-6 hover:border-commander/30 transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {renamingId === preset.id ? (
                    <input
                      type="text"
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => renameTarget.current && finishRename(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename(true);
                        else if (e.key === 'Escape') finishRename(false);
                      }}
                      className="w-full px-2 py-0.5 -mx-2 bg-bg-dark border border-border rounded-lg text-base font-semibold text-text-primary focus:outline-none focus:border-commander/60"
                    />
                  ) : (
                    <h3
                      onClick={() => startRename(preset)}
                      className="text-base font-semibold text-text-primary truncate cursor-text"
                      title="Renames this preset."
                    >
                      {preset.name}
                    </h3>
                  )}
                  <div className="flex items-center gap-4 mt-2.5">
                    <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <Layers className="w-3.5 h-3.5 text-text-muted" />
                      {preset.layout.zones.length} zone(s)
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <Clock className="w-3.5 h-3.5 text-text-muted" />
                      {new Date(preset.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleApply(preset)}
                    disabled={applying === preset.id}
                    className="p-2.5 rounded-lg bg-commander/10 text-commander hover:bg-commander/20 transition-colors disabled:opacity-50"
                    title="Apply preset"
                  >
                    <Play className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleExport(preset.id)}
                    className="p-2.5 rounded-lg text-text-muted hover:text-commander hover:bg-commander/10 transition-colors"
                    title="Saves this preset to a file you can import on another machine. Login values are not included."
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDuplicate(preset)}
                    className="p-2.5 rounded-lg text-text-muted hover:text-commander hover:bg-commander/10 transition-colors"
                    title="Creates a copy of this preset."
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onEditPreset(preset)}
                    className="p-2.5 rounded-lg text-text-muted hover:text-commander hover:bg-commander/10 transition-colors"
                    title="Edit preset"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {confirmDelete === preset.id ? (
                    <button
                      onClick={() => handleDelete(preset.id)}
                      className="px-3.5 py-2.5 rounded-lg bg-danger/10 text-danger hover:bg-danger/20 transition-colors text-xs font-semibold"
                    >
                      Confirm
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(preset.id)}
                      className="p-2.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      title="Delete preset"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Zone bar */}
              <div className="flex gap-1 mt-4">
                {preset.layout.zones.map((zone) => (
                  <div
                    key={zone.id}
                    className={`h-1.5 rounded-full flex-1 ${zone.content ? 'bg-commander/40' : 'bg-bg-steel'}`}
                    title={zone.content?.label || 'Empty'}
                  />
                ))}
              </div>

              {/* Global shortcut: apply this preset from anywhere */}
              <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-border">
                <span className="text-xs text-text-secondary">Global shortcut</span>
                <HotkeyField
                  value={settings?.hotkeys?.[preset.id]}
                  conflict={conflicts.has(preset.id)}
                  onChange={(accel) => handleSetHotkey(preset.id, accel)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-bg-surface border border-border rounded-xl p-16 text-center">
          <Bookmark className="w-12 h-12 text-text-muted/50 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-text-primary mb-1.5">No presets yet</h3>
          <p className="text-sm text-text-secondary mb-6 max-w-sm mx-auto">
            Build a layout, drop an app or dashboard into each zone, and save it as a preset — then launch your whole setup in one click, or automatically on boot.
          </p>
          <button
            onClick={() => onNavigate('editor')}
            className="inline-flex items-center gap-2.5 px-6 py-3 bg-commander text-white rounded-lg hover:bg-commander-core transition-colors text-sm font-medium"
          >
            Open Layout Editor
          </button>
        </div>
      )}

      {importPreview && (
        <ImportPresetDialog
          preview={importPreview}
          onCancel={() => setImportPreview(null)}
          onImport={handleImportCommit}
        />
      )}
    </div>
  );
}
