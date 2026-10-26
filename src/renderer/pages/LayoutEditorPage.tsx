import React, { useEffect, useState, useCallback } from 'react';
import { Monitor, Save, Trash2, Play, Globe, AppWindow, Grid2x2, Grid3x3, Columns2, Rows2, Check, FolderOpen, Circle, Square, MousePointerClick, Keyboard, Type, X, GripVertical, MoveVertical, ArrowLeftRight, Unplug } from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
import type { MonitorInfo, Zone, ZoneContent, Preset, AutomationAction, RecordingStatus, WebLoginStep } from '../../shared/types';
import { formatApplyResult } from '../applyResultMessage';

type SplitTemplate = {
  name: string;
  icon: React.ComponentType<any>;
  zones: { x: number; y: number; width: number; height: number }[];
};

const splitTemplates: SplitTemplate[] = [
  { name: 'Full', icon: Monitor, zones: [{ x: 0, y: 0, width: 1, height: 1 }] },
  { name: '2 Columns', icon: Columns2, zones: [
    { x: 0, y: 0, width: 0.5, height: 1 },
    { x: 0.5, y: 0, width: 0.5, height: 1 },
  ]},
  { name: '2 Rows', icon: Rows2, zones: [
    { x: 0, y: 0, width: 1, height: 0.5 },
    { x: 0, y: 0.5, width: 1, height: 0.5 },
  ]},
  { name: '2x2 Grid', icon: Grid2x2, zones: [
    { x: 0, y: 0, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0, width: 0.5, height: 0.5 },
    { x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ]},
  { name: '3x3 Grid', icon: Grid3x3, zones: [
    { x: 0, y: 0, width: 1/3, height: 1/3 },
    { x: 1/3, y: 0, width: 1/3, height: 1/3 },
    { x: 2/3, y: 0, width: 1/3, height: 1/3 },
    { x: 0, y: 1/3, width: 1/3, height: 1/3 },
    { x: 1/3, y: 1/3, width: 1/3, height: 1/3 },
    { x: 2/3, y: 1/3, width: 1/3, height: 1/3 },
    { x: 0, y: 2/3, width: 1/3, height: 1/3 },
    { x: 1/3, y: 2/3, width: 1/3, height: 1/3 },
    { x: 2/3, y: 2/3, width: 1/3, height: 1/3 },
  ]},
  { name: 'Main + Side', icon: Columns2, zones: [
    { x: 0, y: 0, width: 0.7, height: 1 },
    { x: 0.7, y: 0, width: 0.3, height: 0.5 },
    { x: 0.7, y: 0.5, width: 0.3, height: 0.5 },
  ]},
];

let zoneIdCounter = 0;
function makeZoneId() {
  return `zone-${Date.now()}-${zoneIdCounter++}`;
}

import type { Page } from '../App';

interface LayoutEditorPageProps {
  editingPreset?: Preset | null;
  onNavigate?: (page: Page) => void;
}

export function LayoutEditorPage({ editingPreset, onNavigate }: LayoutEditorPageProps) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [presetName, setPresetName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<string | null>(null);
  const [mapDrag, setMapDrag] = useState<{ kind: 'zone' | 'monitor'; id: string } | null>(null);
  const [dropMonitorId, setDropMonitorId] = useState<string | null>(null);
  const [orderDragIndex, setOrderDragIndex] = useState<number | null>(null);
  const [orderDropIndex, setOrderDropIndex] = useState<number | null>(null);

  useEffect(() => {
    window.moncom?.getMonitors().then(setMonitors);
  }, []);

  // Load preset into editor when editing
  useEffect(() => {
    if (editingPreset) {
      setZones(editingPreset.layout.zones);
      setPresetName(editingPreset.name);
      setEditingId(editingPreset.id);
      setSelectedZone(null);
      setSaveStatus('idle');
    } else {
      setEditingId(null);
    }
  }, [editingPreset]);

  const applyTemplate = useCallback((monitor: MonitorInfo, template: SplitTemplate) => {
    setZones(prev => {
      const newZones = template.zones.map(z => ({
        id: makeZoneId(),
        monitorId: monitor.id,
        monitorBounds: { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height },
        x: z.x, y: z.y, width: z.width, height: z.height,
        content: null,
      }));
      // Take the replaced zones' slot in the launch order rather than moving to the end.
      const at = prev.findIndex(z => z.monitorId === monitor.id);
      const others = prev.filter(z => z.monitorId !== monitor.id);
      const insertAt = at === -1 ? others.length : prev.slice(0, at).filter(z => z.monitorId !== monitor.id).length;
      return [...others.slice(0, insertAt), ...newZones, ...others.slice(insertAt)];
    });
    setSelectedZone(null);
  }, []);

  const updateZoneContent = useCallback((zoneId: string, content: ZoneContent | null) => {
    setZones(prev => prev.map(z => z.id === zoneId ? { ...z, content } : z));
  }, []);

  const moveZoneToMonitor = useCallback((zoneId: string, monitorId: string) => {
    setZones(prev => prev.map(z => z.id === zoneId ? { ...z, monitorId } : z));
  }, []);

  const swapMonitors = useCallback((a: string, b: string) => {
    if (a === b) return;
    setZones(prev => prev.map(z =>
      z.monitorId === a ? { ...z, monitorId: b } : z.monitorId === b ? { ...z, monitorId: a } : z,
    ));
  }, []);

  const handleMapDrop = (monitorId: string) => {
    setDropMonitorId(null);
    if (mapDrag?.kind === 'zone') moveZoneToMonitor(mapDrag.id, monitorId);
    else if (mapDrag?.kind === 'monitor') swapMonitors(mapDrag.id, monitorId);
    setMapDrag(null);
  };

  const handleOrderDrop = (to: number) => {
    setOrderDropIndex(null);
    if (orderDragIndex === null || orderDragIndex === to) { setOrderDragIndex(null); return; }
    setZones(prev => {
      const next = [...prev];
      const [moved] = next.splice(orderDragIndex, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setOrderDragIndex(null);
  };

  const removeZone = useCallback((zoneId: string) => {
    setZones(prev => prev.filter(z => z.id !== zoneId));
    if (selectedZone === zoneId) setSelectedZone(null);
  }, [selectedZone]);

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;
    const now = new Date().toISOString();
    // Snapshot the monitor's bounds with each zone so we can rematch the zone
    // if the monitor ID ever shifts (resolution change, monitor rearrangement).
    const zonesWithBounds = zones.map(z => {
      const m = monitors.find(mm => mm.id === z.monitorId);
      return m
        ? { ...z, monitorBounds: { x: m.x, y: m.y, width: m.width, height: m.height } }
        : z;
    });
    const preset: Preset = {
      id: editingId || `preset-${Date.now()}`,
      name: presetName.trim(),
      layout: { id: editingId ? `layout-${editingId}` : `layout-${Date.now()}`, zones: zonesWithBounds },
      createdAt: editingPreset?.createdAt || now,
      updatedAt: now,
    };
    try {
      await window.moncom?.savePreset(preset);
      setEditingId(preset.id);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
    }
  };

  const handleApply = async () => {
    const preset: Preset = {
      id: 'temp', name: 'Quick Apply',
      layout: { id: 'temp', zones },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const result = await window.moncom?.applyPreset(preset);
    if (!result) return;
    setApplyStatus(formatApplyResult(result));
  };

  // Monitor map viewport
  const monitorBounds = monitors.length > 0 ? {
    minX: Math.min(...monitors.map(m => m.x)),
    minY: Math.min(...monitors.map(m => m.y)),
    maxX: Math.max(...monitors.map(m => m.x + m.width)),
    maxY: Math.max(...monitors.map(m => m.y + m.height)),
  } : { minX: 0, minY: 0, maxX: 1920, maxY: 1080 };

  const totalW = monitorBounds.maxX - monitorBounds.minX;
  const totalH = monitorBounds.maxY - monitorBounds.minY;
  const previewScale = Math.min(500 / totalW, 280 / totalH);

  const selectedZoneData = zones.find(z => z.id === selectedZone);
  const configuredCount = zones.filter(z => z.content).length;

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-brand text-2xl font-bold text-text-primary tracking-tight">
            Layout Editor
          </h1>
          <p className="text-sm text-text-secondary mt-1.5">
            Split monitors into zones and assign an app or dashboard to each
          </p>
          {applyStatus && (
            <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {applyStatus}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip text="Opens all configured zones on your monitors now." />
          <button
            onClick={handleApply}
            disabled={configuredCount === 0}
            className="flex items-center gap-2.5 px-5 py-2.5 bg-commander text-white rounded-lg hover:bg-commander-core transition-colors text-sm font-medium disabled:opacity-40"
          >
            <Play className="w-4 h-4" /> Apply Layout
          </button>
        </div>
      </div>

      {/* Two-column layout that stacks on narrow widths */}
      <div className="flex flex-col xl:flex-row gap-6">
        {/* Left: Monitor map + templates */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Monitor map */}
          <div className="bg-bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                Monitor Map
              </h3>
              <Tooltip text="Your connected monitors. Click a zone to select it. Drag a zone onto another monitor to move it, or drag a monitor's name tag onto another monitor to swap their zones." />
            </div>
            <div className="flex items-center justify-center">
              <div
                className="relative"
                style={{ width: totalW * previewScale, height: totalH * previewScale }}
              >
                {monitors.map((m) => {
                  const mx = (m.x - monitorBounds.minX) * previewScale;
                  const my = (m.y - monitorBounds.minY) * previewScale;
                  const mw = m.width * previewScale;
                  const mh = m.height * previewScale;
                  const monitorZones = zones.filter(z => z.monitorId === m.id);

                  return (
                    <div
                      key={m.id}
                      onDragOver={(e) => { if (!mapDrag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropMonitorId(m.id); }}
                      onDrop={() => handleMapDrop(m.id)}
                      className={`absolute border-2 rounded-lg bg-bg-dark overflow-hidden transition-colors ${dropMonitorId === m.id && mapDrag ? 'border-commander' : 'border-border/80'}`}
                      style={{ left: mx, top: my, width: mw, height: mh }}
                    >
                      <span
                        draggable
                        onDragStart={(e) => { setMapDrag({ kind: 'monitor', id: m.id }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', m.id); }}
                        onDragEnd={() => { setMapDrag(null); setDropMonitorId(null); }}
                        className="absolute top-1 left-1 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-surface/90 border border-border text-[9px] text-text-muted hover:text-text-secondary cursor-grab"
                        title="Drag onto another monitor to swap their zones"
                      >
                        <ArrowLeftRight className="w-2.5 h-2.5" /> {m.name.replace(' (Primary)', '')}
                      </span>
                      {monitorZones.length === 0 && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted pointer-events-none">
                          <Monitor className="w-5 h-5 mb-1 opacity-30" />
                          <span className="text-[10px] opacity-50">{m.name}</span>
                        </div>
                      )}
                      {monitorZones.map((zone) => (
                        <div
                          key={zone.id}
                          draggable
                          onDragStart={(e) => { setMapDrag({ kind: 'zone', id: zone.id }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', zone.id); }}
                          onDragEnd={() => { setMapDrag(null); setDropMonitorId(null); }}
                          onClick={() => setSelectedZone(zone.id)}
                          className={`absolute border transition-all cursor-pointer flex items-center justify-center
                            ${selectedZone === zone.id
                              ? 'border-commander bg-commander/20 z-10'
                              : zone.content
                                ? 'border-commander/30 bg-commander/8 hover:border-commander/50'
                                : 'border-border/60 hover:border-text-muted/40 bg-bg-steel/20'
                            }
                          `}
                          style={{
                            left: `${zone.x * 100}%`, top: `${zone.y * 100}%`,
                            width: `${zone.width * 100}%`, height: `${zone.height * 100}%`,
                          }}
                        >
                          <span className="text-[9px] text-text-secondary truncate px-1">
                            {zone.content?.label || 'Empty'}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Launch order */}
          {zones.length > 0 && (
            <div className="bg-bg-surface border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                  Launch Order
                </h3>
                <Tooltip text="Zones launch top to bottom. Drag to reorder. Empty zones are skipped." />
              </div>
              <div className="space-y-1">
                {zones.map((zone, i) => {
                  const monitor = monitors.find(m => m.id === zone.monitorId);
                  return (
                    <div
                      key={zone.id}
                      onDragOver={(e) => { if (orderDragIndex === null) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (orderDragIndex !== i) setOrderDropIndex(i); }}
                      onDrop={() => handleOrderDrop(i)}
                      onClick={() => setSelectedZone(zone.id)}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border-t-2 cursor-pointer
                        ${selectedZone === zone.id ? 'bg-commander/15' : 'bg-bg-dark hover:bg-bg-steel/30'}
                        ${orderDropIndex === i && orderDragIndex !== null && orderDragIndex !== i ? 'border-commander' : 'border-transparent'}
                        ${orderDragIndex === i ? 'opacity-40' : ''}
                        ${zone.content ? '' : 'opacity-50'}`}
                    >
                      <span
                        draggable
                        onDragStart={(e) => { setOrderDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                        onDragEnd={() => { setOrderDragIndex(null); setOrderDropIndex(null); }}
                        className="cursor-grab text-text-muted/40 hover:text-text-muted shrink-0"
                        title="Drag to reorder"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                      <span className="w-4 text-[11px] text-text-muted tabular-nums">{i + 1}</span>
                      <span className="flex-1 min-w-0 text-xs text-text-secondary truncate">
                        {zone.content?.label || 'Empty'}
                      </span>
                      {monitor ? (
                        <span className="text-[10px] text-text-muted shrink-0">{monitor.name.replace(' (Primary)', '')}</span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-warning shrink-0" title={`Saved for ${zone.monitorId}, which isn't connected. Select the zone and pick a monitor.`}>
                          <Unplug className="w-3 h-3" /> Not connected
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Split templates */}
          <div className="bg-bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-5">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                Split Templates
              </h3>
              <Tooltip text="Splits a monitor into zones. Each monitor can use a different template." />
            </div>
            <div className="space-y-5">
              {monitors.map((m) => (
                <div key={m.id}>
                  <p className="text-xs text-text-secondary font-medium mb-3">{m.name}</p>
                  <div className="flex gap-2 flex-wrap">
                    {splitTemplates.map((tmpl) => (
                      <button
                        key={tmpl.name}
                        onClick={() => applyTemplate(m, tmpl)}
                        className="flex items-center gap-2 px-3.5 py-2 bg-bg-dark border border-border rounded-lg text-xs text-text-secondary hover:border-commander/50 hover:text-commander transition-all"
                      >
                        <tmpl.icon className="w-3.5 h-3.5" />
                        {tmpl.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Zone config + save */}
        <div className="w-full xl:w-80 shrink-0 space-y-6">
          {/* Zone Properties */}
          <div className="bg-bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                Zone Properties
              </h3>
              <Tooltip text="Assigns a website or app to the selected zone." />
            </div>
            {selectedZoneData ? (
              <>
              <label className="block mb-4">
                <span className="block text-[11px] text-text-muted mb-1.5">Monitor</span>
                <select
                  value={selectedZoneData.monitorId}
                  onChange={(e) => moveZoneToMonitor(selectedZoneData.id, e.target.value)}
                  className="w-full px-3 py-2 bg-bg-dark border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-commander/60"
                >
                  {!monitors.some(m => m.id === selectedZoneData.monitorId) && (
                    <option value={selectedZoneData.monitorId}>Not connected ({selectedZoneData.monitorId})</option>
                  )}
                  {monitors.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.width}×{m.height})</option>
                  ))}
                </select>
              </label>
              <ZoneEditor
                zone={selectedZoneData}
                monitors={monitors}
                onUpdate={(content) => updateZoneContent(selectedZoneData.id, content)}
                onRemove={() => removeZone(selectedZoneData.id)}
              />
              </>
            ) : (
              <div className="py-8 text-center">
                <Monitor className="w-8 h-8 text-text-muted/30 mx-auto mb-2" />
                <p className="text-xs text-text-muted">
                  Select a zone on the monitor map
                </p>
              </div>
            )}
          </div>

          {/* Save as Preset */}
          <div className="bg-bg-surface border border-border rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-widest">
                {editingId ? 'Update Preset' : 'Save as Preset'}
              </h3>
              <Tooltip text={editingId ? "Saves your changes to this preset." : "Saves this layout as a preset you can apply later."} />
            </div>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset name..."
              className="w-full px-4 py-2.5 bg-bg-dark border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60 transition-colors"
            />
            <button
              onClick={handleSavePreset}
              disabled={!presetName.trim() || zones.length === 0}
              className="w-full mt-3 flex items-center justify-center gap-2.5 px-4 py-2.5 bg-commander text-white rounded-lg hover:bg-commander-core transition-colors text-sm font-medium disabled:opacity-40"
            >
              {saveStatus === 'saved' ? (
                <><Check className="w-4 h-4" /> Saved!</>
              ) : (
                <><Save className="w-4 h-4" /> {editingId ? 'Update Preset' : 'Save Preset'}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── VK Code Display Names ─── */
const VK_NAMES: Record<number, string> = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
  19: 'Pause', 20: 'CapsLock', 27: 'Esc', 32: 'Space', 33: 'PgUp',
  34: 'PgDn', 35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right',
  40: 'Down', 45: 'Ins', 46: 'Del',
  112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6',
  118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
  91: 'Win', 160: 'LShift', 161: 'RShift', 162: 'LCtrl', 163: 'RCtrl',
  164: 'LAlt', 165: 'RAlt', 186: ';', 187: '=', 188: ',', 189: '-',
  190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: "'",
};

function vkName(vk: number): string {
  if (VK_NAMES[vk]) return VK_NAMES[vk];
  if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
  if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
  return `Key(${vk})`;
}

function formatDelay(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ─── Zone Editor ─── */
function ZoneEditor({ zone, monitors, onUpdate, onRemove }: {
  zone: Zone;
  monitors: MonitorInfo[];
  onUpdate: (content: ZoneContent | null) => void;
  onRemove: () => void;
}) {
  const [type, setType] = useState<'url' | 'application'>(zone.content?.type || 'url');
  const [target, setTarget] = useState(zone.content?.target || '');
  const [label, setLabel] = useState(zone.content?.label || '');
  const [actions, setActions] = useState<AutomationAction[]>(zone.content?.actions || []);
  const [webLogin, setWebLogin] = useState<WebLoginStep[]>(zone.content?.webLogin || []);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    setType(zone.content?.type || 'url');
    setTarget(zone.content?.target || '');
    setLabel(zone.content?.label || '');
    setActions(zone.content?.actions || []);
    setWebLogin(zone.content?.webLogin || []);
    setShowAdvanced(!!zone.content?.label);
  }, [zone.id, zone.content]);

  /** Auto-generate a display label from the target */
  const autoLabel = (t: string, contentType: 'url' | 'application') => {
    if (!t) return '';
    if (contentType === 'url') {
      try { return new URL(t).hostname.replace('www.', ''); } catch { return t; }
    }
    const parts = t.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1]?.replace(/\.exe$/i, '') || t;
  };

  const handleApply = () => {
    if (!target.trim()) { onUpdate(null); return; }
    const displayLabel = label.trim() || autoLabel(target.trim(), type);
    onUpdate({
      type, target: target.trim(), label: displayLabel,
      launchDelay: zone.content?.launchDelay,
      actions: actions.length > 0 ? actions : undefined,
      webLogin: type === 'url' && webLogin.length > 0 ? webLogin : undefined,
    });
  };

  const handleWebLoginChange = (next: WebLoginStep[]) => {
    setWebLogin(next);
    if (zone.content) {
      onUpdate({ ...zone.content, webLogin: next.length > 0 ? next : undefined });
    }
  };

  const handleActionsChange = (newActions: AutomationAction[]) => {
    setActions(newActions);
    // Auto-save actions to zone content if content is already assigned
    if (zone.content) {
      onUpdate({ ...zone.content, actions: newActions.length > 0 ? newActions : undefined });
    }
  };

  const handleLaunchDelayChange = (delay: number) => {
    if (zone.content) {
      onUpdate({ ...zone.content, launchDelay: delay > 0 ? delay : undefined });
    }
  };

  return (
    <div className="space-y-4">
      {/* Type toggle */}
      <div className="flex gap-2">
        {(['url', 'application'] as const).map((t) => {
          const isActive = type === t;
          const Icon = t === 'url' ? Globe : AppWindow;
          return (
            <button
              key={t}
              onClick={() => { setType(t); setTarget(''); setLabel(''); setActions([]); setWebLogin([]); }}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-all
                ${isActive
                  ? 'bg-commander/15 text-commander border border-commander/30'
                  : 'bg-bg-dark border border-border text-text-secondary hover:text-text-primary'
                }
              `}
            >
              <Icon className="w-3.5 h-3.5" />
              {t === 'url' ? 'URL' : 'App'}
            </button>
          );
        })}
      </div>

      {type === 'url' ? (
        <FieldInput
          label="URL"
          value={target}
          onChange={setTarget}
          placeholder="https://example.com"
        />
      ) : (
        <div>
          <label className="text-[10px] text-text-muted uppercase tracking-widest font-medium">
            Executable Path
          </label>
          <div className="flex gap-2 mt-1.5">
            <input
              type="text"
              value={target}
              onChange={(e) => { setTarget(e.target.value); setLabel(''); }}
              placeholder="C:\Program Files\..."
              className="flex-1 min-w-0 px-4 py-2.5 bg-bg-dark border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60 transition-colors"
            />
            <button
              onClick={async () => {
                const path = await window.moncom?.pickExecutable();
                if (path) { setTarget(path); setLabel(''); }
              }}
              className="px-3 py-2.5 bg-bg-dark border border-border rounded-lg text-text-muted hover:border-commander/50 hover:text-commander transition-all"
              title="Browse for executable"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Elevation note for app type */}
      {type === 'application' && (
        <p className="text-[11px] text-text-muted leading-relaxed">
          If this app requires administrator privileges, enable <span className="text-text-secondary font-medium">"Run as administrator"</span> in Settings and start MonCOM as administrator.
        </p>
      )}

      {/* Preview auto-label */}
      {target.trim() && !showAdvanced && (
        <p className="text-[11px] text-text-muted">
          Displays as: <span className="text-text-secondary">{autoLabel(target.trim(), type)}</span>
        </p>
      )}

      {/* Advanced: manual title override */}
      {showAdvanced ? (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-[10px] text-text-muted uppercase tracking-widest font-medium">
              Window title hint
            </label>
            <Tooltip text="Optional. If MonCOM can't find the app's window automatically, it looks for one whose title contains this text." />
          </div>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Auto-detected (leave empty)"
            className="w-full px-4 py-2.5 bg-bg-dark border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60 transition-colors"
          />
        </div>
      ) : (
        <button
          onClick={() => setShowAdvanced(true)}
          className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"
        >
          + Advanced options
        </button>
      )}

      <div className="flex gap-2 pt-2">
        <button
          onClick={handleApply}
          className="flex-1 px-4 py-2.5 bg-commander text-white rounded-lg text-xs font-medium hover:bg-commander-core transition-colors"
        >
          Assign Content
        </button>
        <button
          onClick={onRemove}
          className="px-3 py-2.5 bg-bg-dark border border-border text-text-muted rounded-lg hover:border-danger/60 hover:text-danger transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Web auto-login — URL zones only (robust, DOM-driven login) */}
      {zone.content && zone.content.type === 'url' && (
        <WebLoginPanel steps={webLogin} onChange={handleWebLoginChange} />
      )}

      {/* Automation section — only visible when content is assigned */}
      {zone.content && (
        <AutomationPanel
          zone={zone}
          monitors={monitors}
          actions={actions}
          onActionsChange={handleActionsChange}
          onLaunchDelayChange={handleLaunchDelayChange}
        />
      )}
    </div>
  );
}

/* ─── Web Auto-Login Panel (URL zones) ─── */
function WebLoginPanel({ steps, onChange }: { steps: WebLoginStep[]; onChange: (s: WebLoginStep[]) => void }) {
  const [open, setOpen] = useState(false);
  const update = (i: number, patch: Partial<WebLoginStep>) => onChange(steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const remove = (i: number) => onChange(steps.filter((_, idx) => idx !== i));
  const add = () => { onChange([...steps, { action: 'fill', selector: '', value: '', delayMs: 0 }]); setOpen(true); };

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h4 className="text-[10px] text-text-muted uppercase tracking-widest font-medium">Web auto-login</h4>
          <Tooltip text="Logs into a website by targeting page elements. Steps run after the page loads: wait for an element, skip if a logged-in marker is present, fill a field, or click a button." />
        </div>
        {steps.length > 0 && (
          <span className="text-[10px] text-text-secondary">{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {steps.length > 0 && (
        <button onClick={() => setOpen(!open)} className="text-[11px] text-text-muted hover:text-text-secondary transition-colors mb-2">
          {open ? '- Hide steps' : '+ Show steps'}
        </button>
      )}

      {(open || steps.length === 0) && (
        <div className="space-y-1.5">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <select
                value={step.action}
                onChange={(e) => update(i, { action: e.target.value as WebLoginStep['action'] })}
                className="px-1.5 py-1 bg-bg-dark border border-border rounded text-[10px] text-text-secondary focus:outline-none focus:border-commander/60"
              >
                <option value="waitFor">Wait for</option>
                <option value="skipIfPresent">Skip if present</option>
                <option value="fill">Fill</option>
                <option value="click">Click</option>
              </select>
              <input
                type="text"
                value={step.selector}
                onChange={(e) => update(i, { selector: e.target.value })}
                placeholder="#email, .login-btn"
                className="flex-1 min-w-0 px-2 py-1 bg-bg-dark border border-border rounded text-[10px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60"
              />
              {step.action === 'fill' && (
                <input
                  type="text"
                  value={step.value || ''}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder="value"
                  className="w-20 px-2 py-1 bg-bg-dark border border-border rounded text-[10px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60"
                />
              )}
              <input
                type="number" min={0} step={100}
                value={step.delayMs || 0}
                onChange={(e) => update(i, { delayMs: Math.max(0, parseInt(e.target.value) || 0) })}
                className="w-12 px-1 py-1 bg-bg-dark border border-border rounded text-[10px] text-text-secondary text-center focus:outline-none focus:border-commander/60"
                title="Pause after this step (ms)"
              />
              <button onClick={() => remove(i)} className="text-text-muted hover:text-danger transition-all shrink-0" title="Remove">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          <button onClick={add} className="text-[11px] text-commander hover:text-commander-core transition-colors">
            + Add step
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Automation Panel ─── */
function AutomationPanel({ zone, monitors, actions, onActionsChange, onLaunchDelayChange }: {
  zone: Zone;
  monitors: MonitorInfo[];
  actions: AutomationAction[];
  onActionsChange: (actions: AutomationAction[]) => void;
  onLaunchDelayChange: (delay: number) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [recordStatus, setRecordStatus] = useState<RecordingStatus | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showAddType, setShowAddType] = useState(false);
  const [typeText, setTypeText] = useState('');
  const [typeDelay, setTypeDelay] = useState('500');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const [launching, setLaunching] = useState(false);
  const launchDelay = zone.content?.launchDelay ?? 0;

  useEffect(() => {
    // Stay in the recording state on error so Stop can still hand back what was captured.
    return window.moncom?.onRecordingStatus((status) => {
      setRecordStatus(status);
      if (status.error) setStatusMessage(`${status.error} Press Stop to keep what was captured.`);
    });
  }, []);

  const handleStartRecording = async () => {
    if (!zone.content) return;

    // Close any existing zone windows first
    const closeReport = await window.moncom?.closeAllZones();
    if (closeReport && closeReport.appWindowsFailed.length > 0) {
      setStatusMessage(`${closeReport.appWindowsFailed.length} window(s) could not be closed before recording.`);
    } else {
      setStatusMessage(null);
    }

    // Countdown first — gives user time to prepare
    setCountdown(3);
    for (let i = 3; i > 0; i--) {
      setCountdown(i);
      await new Promise(r => setTimeout(r, 1000));
    }
    setCountdown(0);

    // Launch content after countdown — the real startup delay is naturally captured
    setLaunching(true);
    const launchResult = await window.moncom?.launchZone(zone, monitors);
    if (!launchResult?.success) {
      setLaunching(false);
      setStatusMessage(launchResult?.error ?? 'Failed to launch this zone.');
      return;
    }

    // Small configurable buffer for extra startup time
    if (launchDelay > 0) {
      await new Promise(r => setTimeout(r, launchDelay));
    }
    setLaunching(false);

    const started = await window.moncom?.startRecording(zone, monitors);
    if (started?.ok) {
      setRecordStatus({ captured: 0, outsideZone: 0 });
      setRecording(true);
      setStatusMessage(null);
    } else {
      setStatusMessage(started?.error ?? 'The recorder could not be started.');
    }
  };

  const handleStopRecording = async () => {
    const recorded = await window.moncom?.stopRecording();
    setRecording(false);
    setRecordStatus(null);
    if (recorded && recorded.length > 0) {
      onActionsChange([...actions, ...recorded]);
    }
    // Tear down the window we launched to capture actions — it shouldn't linger
    // after recording stops. closeAllZones only touches MonCOM-launched windows.
    const closeReport = await window.moncom?.closeAllZones();
    if (closeReport && closeReport.appWindowsFailed.length > 0) {
      setStatusMessage(`${closeReport.appWindowsFailed.length} window(s) could not be closed after recording.`);
    }
  };

  const handlePlay = async () => {
    if (actions.length === 0) return;
    setPlaying(true);
    try {
      await window.moncom?.playActions(actions, zone, monitors);
    } finally {
      setPlaying(false);
    }
  };

  const handleClear = () => {
    onActionsChange([]);
    setShowActions(false);
  };

  const handleRemoveAction = (index: number) => {
    onActionsChange(actions.filter((_, i) => i !== index));
  };

  const handleUpdateAction = (index: number, patch: Partial<AutomationAction>) => {
    onActionsChange(actions.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  const handleDrop = (to: number) => {
    setDropIndex(null);
    if (dragIndex === null || dragIndex === to) { setDragIndex(null); return; }
    const next = [...actions];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(to, 0, moved);
    onActionsChange(next);
    setDragIndex(null);
  };

  const handlePlayFrom = async (index: number) => {
    if (index >= actions.length) return;
    setPlaying(true);
    try {
      // Replay from this step onward (first step fires immediately).
      await window.moncom?.playActions([{ ...actions[index], delay: 0 }, ...actions.slice(index + 1)], zone, monitors);
    } finally {
      setPlaying(false);
    }
  };

  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
  const MOD_LABEL: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', win: 'Win' };
  const modPrefix = (mods?: string[]) => (mods && mods.length ? mods.map((m) => MOD_LABEL[m] || m).join('+') + '+' : '');

  const handleAddTypeAction = () => {
    if (!typeText.trim()) return;
    const delay = parseInt(typeDelay) || 500;
    onActionsChange([...actions, { type: 'type', text: typeText.trim(), delay }]);
    setTypeText('');
    setShowAddType(false);
  };

  const actionIcon = (action: AutomationAction) => {
    switch (action.type) {
      case 'click':
      case 'right-click':
        return <MousePointerClick className="w-3 h-3 text-commander" />;
      case 'key':
        return <Keyboard className="w-3 h-3 text-warning" />;
      case 'type':
        return <Type className="w-3 h-3 text-success" />;
      case 'scroll':
        return <MoveVertical className="w-3 h-3 text-commander" />;
    }
  };

  const actionLabel = (action: AutomationAction) => {
    switch (action.type) {
      case 'click':
        return `Click (${((action.x || 0) * 100).toFixed(0)}%, ${((action.y || 0) * 100).toFixed(0)}%)`;
      case 'right-click':
        return `Right-click (${((action.x || 0) * 100).toFixed(0)}%, ${((action.y || 0) * 100).toFixed(0)}%)`;
      case 'key':
        return `Key: ${modPrefix(action.modifiers)}${vkName(action.vkCode || 0)}`;
      case 'type':
        return `Type: "${(action.text || '').length > 16 ? (action.text || '').slice(0, 16) + '...' : action.text}"`;
      case 'scroll': {
        const n = action.deltaY || 0;
        return `Scroll ${n >= 0 ? 'up' : 'down'} ${Math.abs(n)}`;
      }
    }
  };

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-[10px] text-text-muted uppercase tracking-widest font-medium">
            Automation
          </h4>
          <Tooltip text="Records clicks and keystrokes, then replays them each time this zone opens. Click Record, do your actions in the window, then click Stop." />
        </div>
        {actions.length > 0 && (
          <span className="text-[10px] text-text-secondary">
            {actions.length} action{actions.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Launch delay setting */}
      <div className="flex items-center gap-2 mb-3">
        <label className="text-[11px] text-text-secondary whitespace-nowrap">Launch delay</label>
        <input
          type="number"
          min={0}
          step={500}
          value={launchDelay}
          onChange={(e) => onLaunchDelayChange(Math.max(0, parseInt(e.target.value) || 0))}
          className="w-20 px-2 py-1 bg-bg-dark border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-commander/60 transition-colors"
        />
        <span className="text-[10px] text-text-muted">ms</span>
        <Tooltip text="Extra wait after the app or page opens before automation runs. Increase it only if the content needs more time to load." />
      </div>

      {/* Launch / countdown overlay */}
      {statusMessage && (
        <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-warning">
          {statusMessage}
        </div>
      )}
      {launching && (
        <div className="flex items-center justify-center gap-2 py-3 mb-3 bg-commander/10 border border-commander/30 rounded-lg">
          <span className="text-sm font-medium text-commander">
            Launching zone content...
          </span>
        </div>
      )}
      {countdown > 0 && (
        <div className="flex items-center justify-center gap-2 py-3 mb-3 bg-danger/10 border border-danger/30 rounded-lg">
          <span className="text-sm font-medium text-danger">
            Recording in {countdown}...
          </span>
        </div>
      )}

      {/* Record / Stop + Play / Clear buttons */}
      <div className="flex gap-2">
        {recording ? (
          <button
            onClick={handleStopRecording}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-danger/15 text-danger border border-danger/30 rounded-lg text-xs font-medium hover:bg-danger/25 transition-all"
          >
            <Square className="w-3 h-3 fill-current" />
            Stop Recording
          </button>
        ) : (
          <button
            onClick={handleStartRecording}
            disabled={countdown > 0 || launching}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-bg-dark border border-border rounded-lg text-xs font-medium text-text-secondary hover:border-danger/50 hover:text-danger transition-all disabled:opacity-40"
          >
            <Circle className="w-3 h-3 text-danger fill-danger" />
            Record
          </button>
        )}
        {actions.length > 0 && !recording && (
          <>
            <button
              onClick={handlePlay}
              disabled={playing}
              className="px-3 py-2 bg-bg-dark border border-border rounded-lg text-text-muted hover:border-success/50 hover:text-success transition-all disabled:opacity-40"
              title="Replay recorded actions"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleClear}
              className="px-3 py-2 bg-bg-dark border border-border rounded-lg text-text-muted hover:border-danger/50 hover:text-danger transition-all"
              title="Clear all actions"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>

      {/* Recording indicator */}
      {recording && (
        <div className="mt-3 py-2 px-3 bg-danger/10 border border-danger/20 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            <span className="text-[11px] text-danger font-medium">
              {recordStatus && recordStatus.captured > 0
                ? `Recording... ${recordStatus.captured} captured`
                : 'Recording... interact with target window, then click Stop'}
            </span>
          </div>
          {recordStatus && recordStatus.captured === 0 && (
            <div className="mt-1 pl-4 text-[10px] text-text-muted">
              Nothing captured yet. Every click and keystroke should show up here as you make it.
            </div>
          )}
          {recordStatus && recordStatus.outsideZone > 0 && (
            <div className="mt-1 pl-4 text-[10px] text-warning">
              {recordStatus.outsideZone} landed outside this zone (kept — they replay at the same spot).
            </div>
          )}
        </div>
      )}

      {/* Action list */}
      {actions.length > 0 && !recording && (
        <div className="mt-3">
          <button
            onClick={() => setShowActions(!showActions)}
            className="text-[11px] text-text-muted hover:text-text-secondary transition-colors mb-2"
          >
            {showActions ? '- Hide actions' : '+ Show actions'}
          </button>

          {showActions && (
            <div className="max-h-56 overflow-y-auto space-y-1 scrollbar-thin">
              {actions.map((action, i) => {
                const positional = action.type === 'click' || action.type === 'right-click' || action.type === 'scroll';
                return (
                  <div
                    key={i}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragIndex !== null && dragIndex !== i) setDropIndex(i); }}
                    onDrop={() => handleDrop(i)}
                    className={`flex items-center gap-1.5 px-2 py-1.5 bg-bg-dark rounded-md border-t-2 ${dropIndex === i && dragIndex !== null && dragIndex !== i ? 'border-commander' : 'border-transparent'} ${dragIndex === i ? 'opacity-40' : ''}`}
                  >
                    <span
                      draggable
                      onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                      onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
                      className="cursor-grab text-text-muted/40 hover:text-text-muted shrink-0"
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-3 h-3" />
                    </span>
                    {actionIcon(action)}
                    <span className="flex-1 min-w-0 text-[11px] text-text-secondary truncate" title={actionLabel(action)}>
                      {actionLabel(action)}
                    </span>
                    {positional && (
                      <>
                        <input
                          type="number" min={0} max={100}
                          value={Math.round((action.x ?? 0) * 100)}
                          onChange={(e) => handleUpdateAction(i, { x: clamp01((parseInt(e.target.value) || 0) / 100) })}
                          className="w-9 px-1 py-0.5 bg-bg-surface border border-border rounded text-[10px] text-text-secondary text-center focus:outline-none focus:border-commander/60"
                          title="X %"
                        />
                        <input
                          type="number" min={0} max={100}
                          value={Math.round((action.y ?? 0) * 100)}
                          onChange={(e) => handleUpdateAction(i, { y: clamp01((parseInt(e.target.value) || 0) / 100) })}
                          className="w-9 px-1 py-0.5 bg-bg-surface border border-border rounded text-[10px] text-text-secondary text-center focus:outline-none focus:border-commander/60"
                          title="Y %"
                        />
                      </>
                    )}
                    <input
                      type="number" min={0} step={100}
                      value={action.delay}
                      onChange={(e) => handleUpdateAction(i, { delay: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-12 px-1 py-0.5 bg-bg-surface border border-border rounded text-[10px] text-text-secondary text-center focus:outline-none focus:border-commander/60"
                      title="Delay before this step (ms)"
                    />
                    <button
                      onClick={() => handlePlayFrom(i)}
                      disabled={playing}
                      className="text-text-muted hover:text-success transition-all disabled:opacity-40 shrink-0"
                      title="Test from this step"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleRemoveAction(i)}
                      className="text-text-muted hover:text-danger transition-all shrink-0"
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Type action manually */}
      {!recording && (
        <div className="mt-2">
          {showAddType ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={typeText}
                  onChange={(e) => setTypeText(e.target.value)}
                  placeholder="Text to type..."
                  className="flex-1 min-w-0 px-3 py-2 bg-bg-dark border border-border rounded-lg text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60 transition-colors"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddTypeAction(); }}
                />
                <input
                  type="number"
                  value={typeDelay}
                  onChange={(e) => setTypeDelay(e.target.value)}
                  className="w-16 px-2 py-2 bg-bg-dark border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-commander/60 transition-colors"
                  title="Delay (ms)"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleAddTypeAction}
                  disabled={!typeText.trim()}
                  className="flex-1 px-3 py-1.5 bg-commander/15 text-commander border border-commander/30 rounded-lg text-[11px] font-medium hover:bg-commander/25 transition-all disabled:opacity-40"
                >
                  Add
                </button>
                <button
                  onClick={() => { setShowAddType(false); setTypeText(''); }}
                  className="px-3 py-1.5 bg-bg-dark border border-border rounded-lg text-[11px] text-text-muted hover:text-text-secondary transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowAddType(true)}
              className="text-[11px] text-text-muted hover:text-text-secondary transition-colors"
            >
              + Add type action
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FieldInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-text-muted uppercase tracking-widest font-medium">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-1.5 px-4 py-2.5 bg-bg-dark border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60 transition-colors"
      />
    </div>
  );
}
