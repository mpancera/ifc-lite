/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Geschoss zuweisen" — pick the elements, then pick the storey.
 *
 * The destination used to be the ACTIVE storey, so the action wrote wherever
 * the tree happened to be pointing and only the toast said where that was.
 * That reads as a trap: the thing you were looking at (the selection) and the
 * thing that decided the outcome (the tree's highlight) were different things,
 * and getting it wrong was one click with no warning. Choosing from a list
 * puts the decision in front of the person making it (Marc, 2026-09-10).
 *
 * A dialog and not a dropdown, although a dropdown is what was asked for: the
 * classic toolbar renders these items INSIDE a menu, and a menu within a menu
 * item is the one shape Radix makes fragile — `DisciplinesMenu` already keeps
 * its menu open by hand so a dialog trigger survives being clicked. The list
 * is what matters, and it is the same list either way.
 *
 * Containment only — see `lib/storeyAssign/plan-storey-move.ts`. Nothing moves
 * in the model; only the filing changes.
 *
 * What moves is the WHOLE, not the part that was clicked: a curtain wall's
 * panes and a stair's flights are located through their aggregate and carry no
 * containment of their own (`lib/storeyAssign/lift-to-whole.ts`). The list
 * below counts what the move will actually touch, for the same reason the
 * destination is chosen here — the number you act on should be the number you
 * were shown.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Check, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { useSelectedEntityRefs } from '@/hooks/useSelectedEntityRefs';
import { storeyRows, type StoreyRow, type StoreySource } from '@/lib/storeyAssign/storey-rows';
import { liftSelectionToWholes } from '@/lib/storeyAssign/whole-of';

/** `IfcBuildingStorey.Name` / `.Elevation`, for a storey authored this session. */
const STOREY_NAME = 2;
const STOREY_ELEVATION = 9;

const metres = (v: number | null): string =>
  v === null ? '' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} m`;

export function StoreyAssignDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);

  const models = useViewerStore((s) => s.models);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const assignElementsToStorey = useViewerStore((s) => s.assignElementsToStorey);

  const picked = useSelectedEntityRefs();

  // Storey express ids are model-local, so a selection spanning two models has
  // no single list to offer. Saying so beats silently refiling one model's half.
  const modelIds = useMemo(() => [...new Set(picked.map((p) => p.modelId))], [picked]);
  const modelId = modelIds.length === 1 ? modelIds[0] : null;

  /**
   * What will actually be refiled: a clicked curtain-wall pane moves its
   * curtain wall, because containment names the whole and not the part. The
   * same resolution the store action performs, so the list below can never
   * count the panes while the move takes the wall.
   */
  const { targets, lifted } = useMemo(() => {
    const dataStore = modelId ? models.get(modelId)?.ifcDataStore : null;
    if (!modelId || !dataStore) return { targets: [] as number[], lifted: [] as { part: number; whole: number }[] };
    return liftSelectionToWholes(
      picked.map((ref) => ref.expressId),
      dataStore.relationships,
      (id) => dataStore.entities?.getTypeName?.(id) ?? null,
    );
  }, [modelId, models, picked]);

  const storeys = useMemo<StoreyRow[]>(() => {
    const dataStore = modelId ? models.get(modelId)?.ifcDataStore : null;
    if (!modelId || !dataStore) return [];

    const elevations = dataStore.spatialHierarchy?.storeyElevations;
    const filedIn = dataStore.spatialHierarchy?.elementToStorey;

    const sources: StoreySource[] = [];
    for (const expressId of dataStore.entityIndex?.byType?.get('IFCBUILDINGSTOREY') ?? []) {
      sources.push({
        expressId,
        name: dataStore.entities?.getName?.(expressId) || `#${expressId}`,
        elevation: elevations?.get(expressId) ?? null,
      });
    }
    // A storey drawn in this session is not in the parse and would otherwise be
    // missing from the very list meant to hold every storey.
    for (const entity of mutationViews.get(modelId)?.getNewEntities?.() ?? []) {
      if (entity.type !== 'IfcBuildingStorey') continue;
      const elevation = entity.attributes?.[STOREY_ELEVATION];
      sources.push({
        expressId: entity.expressId,
        name: String(entity.attributes?.[STOREY_NAME] ?? '') || `#${entity.expressId}`,
        elevation: typeof elevation === 'number' ? elevation : null,
      });
    }
    return storeyRows(sources, targets.map((id) => filedIn?.get(id) ?? null));
    // `mutationVersion` because both the overlay and the live hierarchy are
    // mutated in place: neither map changes identity when this dialog's own
    // last assignment landed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, models, mutationViews, mutationVersion, targets]);

  const assign = (storey: StoreyRow) => {
    if (!modelId) return;
    const result = assignElementsToStorey(modelId, picked.map((p) => p.expressId), storey.expressId);
    if ('error' in result) {
      toast.error(result.error);
      return;
    }
    setOpen(false);
    if (result.moved === 0) {
      toast.info(result.refused > 0
        ? `Nichts umgehängt — ${result.refused} Raum/Geschoss übersprungen.`
        : `Liegt schon auf ${storey.name}.`);
      return;
    }
    const parts = [`${result.moved} Element${result.moved === 1 ? '' : 'e'} auf ${storey.name}`];
    if (result.alreadyThere > 0) parts.push(`${result.alreadyThere} lagen schon dort`);
    if (result.lifted > 0) parts.push(`${result.lifted} über das übergeordnete Bauteil`);
    if (result.wereUnfiled > 0) parts.push(`${result.wereUnfiled} hatten kein Geschoss`);
    if (result.refused > 0) parts.push(`${result.refused} übersprungen (Raum/Geschoss)`);
    if (result.refused > 0) toast.info(parts.join(' · '));
    else toast.success(parts.join(' · '));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Layers className="h-4 w-4 mr-2" />
            Geschoss zuweisen
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Geschoss zuweisen</DialogTitle>
          <DialogDescription>
            {picked.length === 0
              ? 'Nichts ausgewählt — erst Elemente anwählen, dann das Geschoss.'
              : modelId === null
                ? 'Die Auswahl stammt aus mehreren Modellen. Geschosse gelten je Modell — bitte modellweise umhängen.'
                : `${targets.length} Element${targets.length === 1 ? '' : 'e'} umhängen. `
                  + 'Nur die Verortung ändert sich; im Modell bewegt sich nichts.'
                  + (lifted.length > 0
                    ? ` ${lifted.length} angeklickte Teil${lifted.length === 1 ? '' : 'e'} `
                      + 'gehören zu einem übergeordneten Bauteil — das wandert mit.'
                    : '')}
          </DialogDescription>
        </DialogHeader>

        {storeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {modelId === null ? '' : 'Dieses Modell hat kein IfcBuildingStorey.'}
          </p>
        ) : (
          <ScrollArea className="max-h-[50vh] -mx-2 px-2">
            <div className="flex flex-col gap-1">
              {storeys.map((storey) => {
                // Every selected element is already here: the row would be a
                // no-op, so it says so rather than reporting a hollow success.
                const complete = storey.here === targets.length;
                return (
                  <Button
                    key={storey.expressId}
                    variant="ghost"
                    disabled={complete}
                    className="h-9 justify-start gap-2 px-2 font-normal"
                    onClick={() => assign(storey)}
                  >
                    <Check
                      className={`h-4 w-4 shrink-0 ${storey.here > 0 ? 'opacity-100' : 'opacity-0'}`}
                    />
                    <span className="truncate">{storey.name}</span>
                    <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {storey.here > 0 && !complete ? `${storey.here} hier · ` : ''}
                      {metres(storey.elevation)}
                    </span>
                  </Button>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
