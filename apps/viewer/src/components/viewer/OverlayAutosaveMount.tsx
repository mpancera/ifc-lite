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
import { useSmartPropertySync } from '@/hooks/useSmartPropertySync';
import { RestoreSessionDialog } from './RestoreSessionDialog';

export function OverlayAutosaveMount() {
  const { pendingRestore, acceptUndisputed, acceptAll, discard, dismiss } = useOverlayAutosave();
  // Rule-driven values keep up with the model here rather than in their own
  // mount: both react to the same authoring signal, and running them together
  // means a re-evaluation is captured by the very next autosave.
  useSmartPropertySync();
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
