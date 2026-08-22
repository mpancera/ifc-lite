/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Meldergruppen — one circuit of detectors per Auslösezone.
 *
 * A derivation, not a drawing tool: the judgement is in the zones, which rooms
 * belong together, and this reads that off and builds the group the fire panel
 * needs. So the panel is a preview and one button, not an editor — the way to
 * change a group is to repaint its zone.
 *
 * # What it shows before it writes
 * How many detectors each zone has, and how many are in NO zone. The second
 * number is the one that matters before a system is handed over: a detector in
 * no group is a detector the panel cannot report.
 */

import { useMemo, useState } from 'react';
import { Radio, RefreshCw, X } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useViewerStore } from '@/store';
import { readZones } from '@/lib/ifcZones/membership';
import { themeOfZone } from '@/lib/ifcZones/themes';
import { authoredEntities } from '@/lib/mutations/authoredEntities';
import { CIRCUIT_OBJECT_TYPE, readCircuits } from '@/lib/detectorGroups/circuits';
import { findDisciplineSystem } from '@/lib/roles/disciplineRoles';

interface DetectorGroupsPanelProps {
  onClose: () => void;
}

export function DetectorGroupsPanel({ onClose }: DetectorGroupsPanelProps) {
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const roleId = useViewerStore((s) => s.activeDisciplineSystemId);
  const buildDetectorCircuits = useViewerStore((s) => s.buildDetectorCircuits);
  const [busy, setBusy] = useState(false);

  const system = findDisciplineSystem(roleId);
  const theme = system?.objectType === 'GasDetection' ? 'gas-trigger' : 'fire-trigger';

  const { zones, circuits } = useMemo(() => {
    const view = activeModelId ? mutationViews.get(activeModelId) : undefined;
    const entities = view ? authoredEntities(view) : [];
    return {
      zones: readZones(entities).filter((z) => themeOfZone(z.objectType)?.id === theme),
      // Meldergruppen only — a Melderkreis is the same IFC class and a
      // different thing; see `readCircuits`.
      circuits: readCircuits(entities, CIRCUIT_OBJECT_TYPE),
    };
    // `mutationVersion` is the dependency that matters — both read the overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModelId, mutationViews, mutationVersion, theme]);

  const membersOf = useMemo(() => {
    const byName = new Map(circuits.map((c) => [c.name, c.memberIds.length]));
    return (name: string) => byName.get(name) ?? 0;
  }, [circuits]);

  const run = () => {
    if (!activeModelId || busy) return;
    setBusy(true);
    try {
      const result = buildDetectorCircuits(activeModelId);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      const groups = result.plan.entries.length;
      const parts = [`${groups} Gruppe${groups === 1 ? '' : 'n'}`];
      if (result.marked > 0) parts.push(`${result.marked} Melder beschriftet`);
      if (result.plan.ungrouped > 0) parts.push(`${result.plan.ungrouped} ohne Zone`);
      toast.success(parts.join(' · '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Radio className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[12px] font-medium">Meldergruppen</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <p className="border-b px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        Je Auslösezone ein <span className="font-mono">IfcDistributionCircuit</span> mit den
        Meldern, die in ihren Räumen stehen. Jeder Melder bekommt sein Kennzeichen
        <span className="font-mono"> Zone.01</span>. Die Gruppen ändert man, indem man die Zone
        umpinselt — nicht hier.
      </p>

      {system === null && (
        <p className="border-b bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          Keine Anlage aktiv. Auf die Rolle der Installation wechseln — für die BMA
          „Branddetektion".
        </p>
      )}

      <ScrollArea className="flex-1">
        {zones.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            Keine Auslösezone im Modell.
            <br />
            Zuerst unter Author → Zones eine Zone mit dem Thema
            „Auslösezone Branddetektion" anlegen und Räume hineinmalen.
          </p>
        ) : (
          <ul className="divide-y">
            {zones.map((zone) => (
              <li key={zone.expressId} className="flex items-center gap-2 px-3 py-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm border"
                  style={{ background: zone.colour ?? 'transparent' }}
                />
                <span className="flex-1 truncate text-[12px]">
                  {zone.name || <span className="text-muted-foreground">ohne Namen</span>}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {zone.memberIds.length} R · {membersOf(zone.name)} M
                </span>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <div className="border-t px-3 py-2">
        <Button
          size="sm"
          className="h-8 w-full bg-emerald-600 text-[11px] hover:bg-emerald-700"
          disabled={!activeModelId || busy || zones.length === 0}
          onClick={run}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
          Meldergruppen bilden
        </Button>
      </div>
    </div>
  );
}

export default DetectorGroupsPanel;
