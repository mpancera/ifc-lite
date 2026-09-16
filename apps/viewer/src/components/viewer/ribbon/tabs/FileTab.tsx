/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · File tab — everything that moves model bytes in or out:
 * open / add / refresh, the exporter fleet, and link-based sharing.
 */

import React from 'react';
import { Trash2 as Discard } from 'lucide-react';
import { AddFile, CloudSources, Loading, OpenFile, Refresh, Share, CollabsRoom } from '@/icons';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { collectChangedModels, totalChangeCount } from '@/lib/export/model-changes';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { isCollabEnabled } from '@/lib/collab/config';
import type { FileCommands } from '../../toolbar/useFileCommands';
import { useWorkspacePanelControls } from '../../toolbar/useWorkspacePanelControls';
import { RibbonExportGroup } from './RibbonExportGroup';
import { RIBBON_EXPORT_ICONS } from './ribbon-export-icons';
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
  RibbonSmallStack,
} from '../primitives';

export function FileTab({ fileCommands }: { fileCommands: FileCommands }) {
  const { handleOpenClick, handleAddModelClick, handleRefresh, canRefresh, hasModelsLoaded, openShareDialog } = fileCommands;
  const { loading, models } = useIfc();

  /**
   * How much would be thrown away, and the throwing.
   *
   * The count is the same one the amber Export Changes button shows, read
   * through the same collector: a Verwerfen that disagreed with it about how
   * much there is would be the worst possible button.
   */
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const changeCount = React.useMemo(
    () => totalChangeCount(collectChangedModels(useViewerStore.getState())),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutationVersion is the edit signal
    [mutationVersion],
  );

  /**
   * Asked in the app's own dialog, not with `window.confirm`.
   *
   * The native one silently returns false once a person has ticked Chrome's
   * "prevent this page from creating additional dialogs", and a page that has
   * shown one dialog can hit that at any time. The button then does nothing at
   * all, with no error and nothing on screen — which is exactly what Marc saw
   * (2026-09-16). A confirmation that can be switched off without telling the
   * caller is not a confirmation.
   */
  const [confirming, setConfirming] = React.useState(false);

  const discardChanges = React.useCallback(() => {
    setConfirming(false);
    const state = useViewerStore.getState();
    for (const modelId of state.models.keys()) state.clearMutations(modelId);
    // The saved session goes with it: `clearMutations` bumps the mutation
    // version, the autosave sees an empty overlay and deletes the snapshot —
    // which is the documented path, not a side effect to rely on quietly.
    toast.success('Änderungen verworfen — Seite neu laden, damit auch die '
      + 'erzeugte Geometrie aus der Ansicht verschwindet');
  }, []);

  // Collaboration: the Share cluster is gated behind the collab feature flag.
  // The ShareDialog itself (and its `ifc-lite:open-share-dialog` listener)
  // lives in useFileCommands so it stays mounted on every tab and while the
  // ribbon is collapsed — this panel only holds the buttons.
  const collabEnabled = React.useMemo(() => isCollabEnabled(), []);
  const collabPeerCount = useViewerStore((s) => s.collabPeers.length);
  const collabRoomId = useViewerStore((s) => s.collabRoomId);
  const collabPanelVisible = useViewerStore((s) => s.collabPanelVisible);

  // Cloud sources (CDE integrations) is a model SOURCE, so it belongs on the
  // tab that moves bytes — not with the analysis panels. Until now the
  // ActivityBar rail was its only entry point, the same gap Location zones
  // had before #2508, and the parity guard cannot see it: both toolbars
  // already reach `toggleWorkspacePanel` for other panels.
  const { activeWorkspacePanels, handleToggleRightPanel } = useWorkspacePanelControls();

  return (
    <>
      <RibbonGroup label="Model">
        <RibbonLargeButton
          icon={loading ? Loading : OpenFile}
          label="Open"
          tooltip="Open model from disk"
          disabled={loading}
          className={loading ? '[&_svg]:animate-spin' : undefined}
          onClick={() => { void handleOpenClick(); }}
        />
        <RibbonLargeButton
          icon={CloudSources}
          label="Cloud sources"
          tooltip="Cloud sources (connected CDEs)"
          active={activeWorkspacePanels.has('sources')}
          onClick={() => handleToggleRightPanel('sources')}
        />
        <RibbonSmallStack>
          <RibbonSmallButton
            icon={AddFile}
            label="Add model"
            tooltip="Add model to scene (multi-select supported)"
            disabled={loading || !hasModelsLoaded}
            onClick={() => { void handleAddModelClick(); }}
          />
          <RibbonSmallButton
            icon={Refresh}
            label="Refresh"
            tooltip={models.size > 1 ? 'Refresh models from disk' : 'Refresh model from disk'}
            disabled={loading || !canRefresh}
            onClick={() => { void handleRefresh(); }}
          />
          {/* The counterpart to Export Changes, and it was missing.
              Reloading the page does NOT discard: a session authored against
              the same bytes is restored without asking, by design — that case
              is a recovered tab, not a decision. So the only way back to the
              file as it is on disk was to undo every step one at a time
              (Marc, 2026-09-16, after a derivation wrote the wrong property
              onto ninety-two rooms). */}
          <RibbonSmallButton
            icon={Discard}
            label="Verwerfen"
            tooltip={`Alle ${changeCount} Änderungen dieser Sitzung verwerfen — `
              + 'auch den gespeicherten Stand. Die Datei auf der Platte bleibt unberührt'}
            disabled={loading || changeCount === 0}
            onClick={() => setConfirming(true)}
          />
        </RibbonSmallStack>
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonExportGroup icons={RIBBON_EXPORT_ICONS} />

      {collabEnabled && (
        <>
          <RibbonGroupDivider />
          <RibbonGroup label="Share">
            <RibbonLargeButton
              icon={Share}
              label="Share"
              tooltip="Share: link-based multiuser collaboration"
              disabled={!hasModelsLoaded}
              onClick={openShareDialog}
              badge={collabPeerCount > 0 ? (
                <span className="absolute right-1 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium text-primary-foreground">
                  {collabPeerCount + 1}
                </span>
              ) : undefined}
            />
            {/* Room panel toggle — live presence + management. Shown whenever
                collab is on, not only inside a room: the classic strip's Panels
                menu, the palette and the rail all offer it unconditionally, and
                gating it here left ribbon users unable to open the panel at all
                before joining. It also contradicted this toolbar's own rule
                that its geography stays put rather than appearing mid-session. */}
            <RibbonLargeButton
              icon={CollabsRoom}
              label="Room"
              tooltip={collabRoomId ? 'Collaboration room' : 'Collaboration room — not in a room yet'}
              active={collabPanelVisible}
              onClick={() => useViewerStore.getState().toggleWorkspacePanel('collab')}
              badge={collabPeerCount > 0 ? (
                <span className="absolute right-1 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-medium text-white">
                  {collabPeerCount + 1}
                </span>
              ) : undefined}
            />
          </RibbonGroup>
        </>
      )}

      {/* Discarding is the only irreversible thing on this tab — every export
          can simply be repeated — so it asks, and it says the number and what
          stays untouched. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Änderungen verwerfen?</DialogTitle>
            <DialogDescription>
              {changeCount} Änderung{changeCount === 1 ? '' : 'en'} dieser Sitzung, samt dem
              gespeicherten Stand. Das lässt sich nicht rückgängig machen.
              <br />
              Die IFC-Datei auf der Platte bleibt unverändert — neu geladen wird sie so,
              wie sie dort steht.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Abbrechen
            </Button>
            <Button variant="destructive" size="sm" onClick={discardChanges}>
              Endgültig verwerfen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
