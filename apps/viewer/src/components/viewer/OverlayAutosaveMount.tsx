/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Runs the authoring autosave and owns the restore prompt it can raise.
 * Mounted once alongside the viewport (same shape as `ZoneAssignmentSyncMount`)
 * so the behaviour is on wherever a model is, not tied to a panel being open.
 */

import { useViewerStore } from '@/store';
import { useOverlayAutosave } from '@/hooks/useOverlayAutosave';
import { RestoreSessionDialog } from './RestoreSessionDialog';

export function OverlayAutosaveMount() {
  const { pendingRestore, acceptUndisputed, acceptAll, discard, dismiss } = useOverlayAutosave();
  const models = useViewerStore((s) => s.models);
  const currentModelName = pendingRestore
    ? models.get(pendingRestore.modelId)?.name ?? ''
    : '';

  return (
    <RestoreSessionDialog
      pending={pendingRestore}
      currentModelName={currentModelName}
      onAcceptUndisputed={acceptUndisputed}
      onAcceptAll={acceptAll}
      onDiscard={discard}
      onDismiss={dismiss}
    />
  );
}
