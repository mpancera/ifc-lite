/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "What did we change on the reference model?"
 *
 * With discipline roles the work is additive, so anything that touches the
 * architecture model is an exception. This lists those exceptions — the answer
 * to hand back in coordination, and the check on what a data-harmonisation pass
 * actually altered. Placing elements never appears here; only edits to entities
 * that came from the file do.
 *
 * A `Dialog`, matching `ProductLibraryPanel` / `DataConnector`, so it needs no
 * workspace-panel plumbing.
 */

import { useMemo, useState } from 'react';
import { FileDiff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import {
  collectReferenceOverrides,
  groupOverridesByEntity,
  type OverrideKind,
} from '@/lib/persistence/referenceOverrides';

const KIND_LABEL: Record<OverrideKind, string> = {
  attribute: 'Attribut',
  property: 'Eigenschaft',
  'property-set': 'Eigenschaftsgruppe',
  quantity: 'Menge',
  geometry: 'Geometrie',
  retype: 'IFC-Klasse',
  deletion: 'Gelöscht',
};

interface ReferenceOverridesPanelProps {
  trigger?: React.ReactNode;
}

export function ReferenceOverridesPanel({ trigger }: ReferenceOverridesPanelProps) {
  const [open, setOpen] = useState(false);
  const activeModelId = useViewerStore((s) => s.activeModelId);
  const models = useViewerStore((s) => s.models);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);

  const groups = useMemo(() => {
    if (!activeModelId) return [];
    const store = models.get(activeModelId)?.ifcDataStore;
    if (!store) return [];
    const overrides = collectReferenceOverrides(mutationViews.get(activeModelId), {
      globalIdOf: (id) => store.entities.getGlobalId(id) || '',
      typeNameOf: (id) => store.entities.getTypeName(id) || '',
      nameOf: (id) => store.entities.getName(id) || '',
    });
    return groupOverridesByEntity(overrides);
    // mutationVersion bumps on every committed edit — the signal to re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModelId, models, mutationViews, mutationVersion]);

  const total = groups.reduce((sum, g) => sum + g.overrides.length, 0);

  const select = (expressId: number) => {
    if (!activeModelId) return;
    setSelectedEntityId(toGlobalIdFromModels(models, activeModelId, expressId));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <FileDiff className="h-4 w-4 mr-2" />
            Referenzmodell-Änderungen
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
          <DialogTitle>Änderungen am Referenzmodell</DialogTitle>
          <DialogDescription>
            Was in dieser Sitzung am Architekturmodell geändert wurde. Selbst platzierte Bauteile
            erscheinen hier nicht — sie ergänzen das Modell, sie verändern es nicht.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-hidden">
          {groups.length === 0 ? (
            <p className="text-center text-[12px] font-mono text-zinc-500 dark:text-zinc-400 py-10 px-6">
              Keine Änderungen am Referenzmodell — die Arbeit dieser Sitzung ist rein ergänzend.
            </p>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {groups.map((group) => (
                <div key={group.expressId} className="px-6 py-3">
                  <button
                    type="button"
                    onClick={() => select(group.expressId)}
                    className="text-left group/entity"
                  >
                    <span className="block text-xs font-mono text-zinc-900 dark:text-zinc-100 group-hover/entity:underline">
                      {group.name || group.ifcType}
                    </span>
                    <span className="block text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                      {group.ifcType} · {group.globalId || 'ohne GlobalId'}
                    </span>
                  </button>
                  <div className="mt-2 space-y-1">
                    {group.overrides.map((override, i) => (
                      <div key={i} className="grid grid-cols-[110px_1fr] gap-2 text-[11px] font-mono">
                        <span className="text-zinc-400 dark:text-zinc-600">{KIND_LABEL[override.kind]}</span>
                        <span className="min-w-0 text-zinc-700 dark:text-zinc-300">
                          {override.field && <span className="text-zinc-500">{override.field}: </span>}
                          {override.before !== null && (
                            <span className="line-through text-zinc-400 dark:text-zinc-600">{override.before}</span>
                          )}
                          {override.before !== null && override.after !== null && ' → '}
                          {override.after !== null
                            ? <span className="text-emerald-700 dark:text-emerald-400">{override.after}</span>
                            : override.before === null && <span className="text-red-600 dark:text-red-400">entfernt</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="px-6 py-3 border-t shrink-0 text-[10px] font-mono uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          {groups.length === 0
            ? 'Referenzmodell unverändert'
            : `${groups.length} Bauteil${groups.length === 1 ? '' : 'e'} · ${total} Änderung${total === 1 ? '' : 'en'}`}
        </div>
      </DialogContent>
    </Dialog>
  );
}
