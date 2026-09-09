/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The one place that knows how a discipline item is opened.
 *
 * A render prop rather than a fixed control, because the ribbon wants a large
 * labelled button and the classic strip wants a menu row — but what the
 * control DOES (which panel it toggles, when it is latched, when it is greyed
 * out) must be the same in both, or the two toolbar styles drift apart, which
 * is exactly what the parity guard exists to catch.
 *
 * Dialog items are the exception: the rendered control is handed to the
 * dialog as its trigger, and the dialog owns the click from there.
 */

import type { ReactElement } from 'react';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { useMayAuthor } from '@/hooks/useMayAuthor';
import { usePanelControls } from '@/hooks/usePanelControls';
import { useWorkspacePanelControls } from '../toolbar/useWorkspacePanelControls';
import type { DisciplineItem } from './definitions';

export interface DisciplineItemState {
  /** Latched: the panel is open, the tool is running, the toggle is on. */
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}

interface DisciplineItemButtonProps {
  item: DisciplineItem;
  render: (state: DisciplineItemState) => ReactElement;
}

const noop = (): void => {};

export function DisciplineItemButton({ item, render }: DisciplineItemButtonProps): ReactElement {
  const { ifcDataStore } = useIfc();
  const hasModel = ifcDataStore !== null && ifcDataStore !== undefined;
  // Collab role: tools that write are reserved for editor/admin; a null role
  // is the single-user case and always editable. Same rule as the Author tab.
  const collabRole = useViewerStore((s) => s.collabRole);
  const canEditInSession = collabRole === null || collabRole === 'editor' || collabRole === 'admin';
  // The ROLE's answer, separate from the session's — a Viewer role may not
  // author even where a shared session would allow it.
  const mayAuthor = useMayAuthor();
  // An item's own extra condition, read through the store so the control
  // re-renders when the answer changes.
  const extraEnabled = useViewerStore((s) => item.enabled?.(s) ?? true);
  const { isOpen, toggle } = usePanelControls();
  const { activeWorkspacePanels, handleToggleRightPanel } = useWorkspacePanelControls();
  // Toggles and actions read the store through their own selector, so the
  // control re-renders when that state changes and nothing else.
  const latched = useViewerStore((s) => {
    if (item.kind === 'toggle') return item.read(s);
    if (item.kind === 'action') return item.isActive?.(s) ?? false;
    return false;
  });

  const modelMissing = (item.needsModel ?? false) && !hasModel;
  const authorBlocked = (item.needsAuthor ?? false) && (!canEditInSession || !mayAuthor.allowed);
  const blocked = modelMissing || !extraEnabled || authorBlocked;

  switch (item.kind) {
    case 'panel':
      return render({
        active: isOpen(item.panel),
        disabled: blocked,
        onClick: () => toggle(item.panel),
      });
    case 'tool':
      return render({
        active: activeWorkspacePanels.has(item.tool),
        disabled: blocked || !canEditInSession,
        onClick: () => handleToggleRightPanel(item.tool),
      });
    case 'toggle':
      return render({
        active: latched,
        disabled: blocked,
        onClick: () => item.write(useViewerStore.getState(), !latched),
      });
    case 'action':
      return render({
        active: latched,
        disabled: blocked,
        onClick: () => item.run(useViewerStore.getState()),
      });
    case 'dialog': {
      const Dialog = item.Dialog;
      return <Dialog trigger={render({ active: false, disabled: blocked, onClick: noop })} />;
    }
  }
}
