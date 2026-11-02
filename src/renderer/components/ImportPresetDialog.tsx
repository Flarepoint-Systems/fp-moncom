import React, { useState } from 'react';
import type { ImportPresetPreview } from '../../shared/types';

interface ImportPresetDialogProps {
  preview: Extract<ImportPresetPreview, { ok: true }>;
  onCancel: () => void;
  onImport: (name: string) => void;
}

export function ImportPresetDialog({ preview, onCancel, onImport }: ImportPresetDialogProps) {
  const [name, setName] = useState(preview.preset.name);
  const { plan, monitors } = preview;
  const monitorName = (id: string | null) => monitors.find((m) => m.id === id)?.name ?? 'Not connected';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-xl bg-bg-surface border border-border rounded-xl p-6">
        <h2 className="text-base font-semibold text-text-primary mb-4">Import preset</h2>

        <label className="block text-xs text-text-secondary mb-1.5" htmlFor="import-preset-name">
          Name
        </label>
        <input
          id="import-preset-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-2.5 bg-bg-dark border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-commander/60 transition-colors"
        />

        <div className="mt-5 max-h-64 overflow-y-auto border border-border rounded-lg">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-muted border-b border-border">
                <th className="px-3 py-2 font-medium">Zone</th>
                <th className="px-3 py-2 font-medium">Saved monitor</th>
                <th className="px-3 py-2 font-medium">Lands on</th>
              </tr>
            </thead>
            <tbody>
              {plan.zones.map((zone) => (
                <tr key={zone.zoneId} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2 text-text-primary">{zone.label}</td>
                  <td className="px-3 py-2 text-text-secondary font-mono">{zone.savedMonitorId}</td>
                  <td className={`px-3 py-2 ${zone.targetMonitorId ? 'text-text-secondary' : 'text-warning'}`}>
                    {monitorName(zone.targetMonitorId)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(plan.redactedLogins > 0 || plan.unmatched > 0) && (
          <div className="mt-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning space-y-1">
            {plan.redactedLogins > 0 && (
              <p>{plan.redactedLogins} web login values are not included and need to be entered again after import.</p>
            )}
            {plan.unmatched > 0 && (
              <p>{plan.unmatched} zones have no matching monitor and can be re-assigned in the Layout Editor.</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-steel transition-colors text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={() => onImport(name.trim())}
            disabled={!name.trim()}
            className="px-5 py-2.5 bg-commander text-white rounded-lg hover:bg-commander-core transition-colors text-sm font-medium disabled:opacity-40"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
