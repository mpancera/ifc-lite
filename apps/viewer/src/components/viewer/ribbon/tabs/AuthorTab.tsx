/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Author tab — the authoring surface: the global edit-mode
 * switch, undo/redo, element creation tools, and bulk property flows.
 * Everything here honors the same collab role gate as the classic
 * toolbar (viewer/commenter roles cannot unlock authoring).
 */

import { Box, Boxes, Brush, FileDiff, Library, Wand2 } from 'lucide-react';
import { Extension, SpaceSketch, AddElement, EditElement, EditProperty, ImportData, List, Select, Undo, Redo } from '@/icons';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { tourAnchor, toolAnchor } from '@/lib/tours/anchors';
import { BulkPropertyEditor } from '../../BulkPropertyEditor';
import { DataConnector } from '../../DataConnector';
import { ProductLibraryPanel } from '../../catalog/ProductLibraryPanel';
import { ProxyTriagePanel } from '../../ProxyTriagePanel';
import { ReferenceOverridesPanel } from '../../ReferenceOverridesPanel';
import { SmartPropertyPanel } from '../../SmartPropertyPanel';
import { useWorkspacePanelControls } from '../../toolbar/useWorkspacePanelControls';
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
  RibbonSmallStack,
} from '../primitives';

/** Purple latched accent shared by the authoring toggles (matches the
 *  classic toolbar's Edit pill so the mode reads identically). */
const EDIT_ACTIVE_CLASS = 'bg-purple-600/20 text-foreground ring-1 ring-inset ring-purple-600/50';

export function AuthorTab() {
  const { ifcDataStore } = useIfc();
  const activeTool = useViewerStore((state) => state.activeTool);
  const setActiveTool = useViewerStore((state) => state.setActiveTool);
  const editEnabled = useViewerStore((state) => state.editEnabled);
  const toggleEditEnabled = useViewerStore((state) => state.toggleEditEnabled);
  // Collab role: editing is reserved for editor/admin. Derive from the
  // reactive role so the Edit switch enables/disables live when the role
  // changes. null role = single-user, always editable.
  const collabEditRole = useViewerStore((state) => state.collabRole);
  const canEditInSession =
    collabEditRole === null || collabEditRole === 'editor' || collabEditRole === 'admin';

  const activeModelId = useViewerStore((s) => s.activeModelId);
  const undoStacks = useViewerStore((s) => s.undoStacks);
  const redoStacks = useViewerStore((s) => s.redoStacks);
  const undo = useViewerStore((s) => s.undo);
  const redo = useViewerStore((s) => s.redo);
  // Undo/redo replay authoring mutations, so they honour the same collab
  // role gate as edit mode.
  const canUndo = canEditInSession && activeModelId !== null && (undoStacks.get(activeModelId)?.length ?? 0) > 0;
  const canRedo = canEditInSession && activeModelId !== null && (redoStacks.get(activeModelId)?.length ?? 0) > 0;

  const { activeWorkspacePanels, handleToggleRightPanel, handleToggleBottomPanel } = useWorkspacePanelControls();

  return (
    <>
      <RibbonGroup label="Edit">
        {/* The pointer lives here as well as under Home: leaving edit mode to
            pick something up should not cost a tab switch. */}
        <RibbonLargeButton
          icon={Select}
          label="Select"
          shortcut="V"
          active={activeTool === 'select'}
          onClick={() => setActiveTool('select')}
        />
        <RibbonLargeButton
          icon={EditElement}
          label="Edit Mode"
          tooltip={canEditInSession
            ? (editEnabled ? 'Exit edit mode' : 'Enter edit mode')
            : 'Editing requires editor access in this shared session'}
          shortcut="E"
          active={editEnabled}
          activeClassName={EDIT_ACTIVE_CLASS}
          disabled={!canEditInSession}
          onClick={toggleEditEnabled}
        />
        <RibbonSmallStack>
          <RibbonSmallButton
            icon={Undo}
            label="Undo"
            shortcut="⌘Z"
            disabled={!canUndo}
            onClick={() => { if (activeModelId) undo(activeModelId); }}
          />
          <RibbonSmallButton
            icon={Redo}
            label="Redo"
            shortcut="⌘⇧Z"
            disabled={!canRedo}
            onClick={() => { if (activeModelId) redo(activeModelId); }}
          />
        </RibbonSmallStack>
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Create">
        <RibbonLargeButton
          icon={AddElement}
          label="Add Element"
          tooltip="Add element (opens the drawing panel)"
          active={activeWorkspacePanels.has('addElement')}
          activeClassName={EDIT_ACTIVE_CLASS}
          disabled={!canEditInSession}
          onClick={() => handleToggleRightPanel('addElement')}
        />
        {/* Space Sketch bakes IfcSpace entities; picking it flips edit
            mode on via the AUTHORING_TOOLS rule in uiSlice, so it can
            stay visible (not hidden behind edit mode like the classic
            toolbar) — the ribbon has room for stable geography. */}
        <RibbonLargeButton
          icon={SpaceSketch}
          label="Space Sketch"
          active={activeTool === 'spaceSketch'}
          activeClassName={EDIT_ACTIVE_CLASS}
          disabled={!canEditInSession}
          onClick={() => setActiveTool('spaceSketch')}
          {...tourAnchor(toolAnchor('spaceSketch'))}
        />
        {/* Zones group ROOMS, so they belong next to the tools that make rooms
            rather than under Analyze — painting a zone is authoring, and it
            writes IfcZone into the model like anything else here. */}
        <RibbonLargeButton
          icon={Brush}
          label="Zones"
          tooltip="Zonen anlegen und Räume hineinmalen (IfcZone)"
          active={activeWorkspacePanels.has('zonePaint')}
          activeClassName={EDIT_ACTIVE_CLASS}
          disabled={!canEditInSession || !ifcDataStore}
          onClick={() => handleToggleRightPanel('zonePaint')}
        />
        {/* Compartments are the geometric counterpart of Zones: a zone groups
            the architect's rooms, a compartment carries its own body for the
            cases where the zone boundary does not follow room boundaries.
            Side by side, because choosing between them IS the decision. */}
        <RibbonLargeButton
          icon={Box}
          label="Compartments"
          tooltip="Abschnitte zeichnen und Bauteile darin klassifizieren"
          active={activeWorkspacePanels.has('zones')}
          activeClassName={EDIT_ACTIVE_CLASS}
          disabled={!ifcDataStore}
          onClick={() => handleToggleRightPanel('zones')}
        />
        <ProductLibraryPanel
          trigger={
            <RibbonLargeButton
              icon={Library}
              label="Product Library"
              tooltip="Browse the company catalog and see which products are placed in this project"
            />
          }
        />
      </RibbonGroup>

      <RibbonGroupDivider />

      {/* The two ways of authoring property VALUES get the large buttons; the
          two that inspect or import sit in the stack beside them. Four small
          buttons in one column were unreadable and gave no sense of which is
          the everyday tool. */}
      <RibbonGroup label="Properties">
        <SmartPropertyPanel
          trigger={
            <RibbonLargeButton
              icon={Wand2}
              label="Smart Property"
              tooltip="Rules that build a property value from the model around an element"
              disabled={!ifcDataStore}
            />
          }
        />
        <BulkPropertyEditor
          trigger={
            <RibbonLargeButton
              icon={EditProperty}
              label="Bulk Edit"
              tooltip="Bulk property editor — set a property across a query result"
              disabled={!ifcDataStore}
            />
          }
        />
        {/* The same tool as under Analyze, named and iconed identically —
            because it IS the same panel. Whether its cells accept typing
            follows the global Edit Mode, exactly as the properties panel does,
            rather than a second switch that could disagree with it. */}
        <RibbonLargeButton
          icon={List}
          label="List"
          tooltip="Lists & schedules — im Edit Mode direkt in der Tabelle bearbeitbar"
          disabled={!ifcDataStore}
          active={activeWorkspacePanels.has('list')}
          onClick={() => handleToggleBottomPanel('list')}
        />
        {/* Assigning a class is authoring, not analysis — an element's
            Fachklasse is a statement the author makes, so the tool that makes
            it in bulk belongs beside the other bulk authoring tools. */}
        <ProxyTriagePanel
          trigger={
            <RibbonLargeButton
              icon={Boxes}
              label="Proxy-Triage"
              tooltip="Elemente ohne Fachklasse gruppenweise der richtigen Klasse zuweisen"
              disabled={!ifcDataStore}
            />
          }
        />
        <RibbonSmallStack>
          <DataConnector
            trigger={
              <RibbonSmallButton
                icon={ImportData}
                label="Import data (CSV)"
                disabled={!ifcDataStore}
              />
            }
          />
          <ReferenceOverridesPanel
            trigger={
              <RibbonSmallButton
                icon={FileDiff}
                label="Changes to the reference model"
                disabled={!ifcDataStore}
              />
            }
          />
        </RibbonSmallStack>
      </RibbonGroup>

      <RibbonGroupDivider />

      {/* Extensions & flavors manage the workspace itself — installed
          extensions, personal flavors, permissions. Customization, not
          analysis, so it lives here (mirrors the classic Panels menu,
          which files Extensions under its "Author" section). */}
      <RibbonGroup label="Customize">
        <RibbonLargeButton
          icon={Extension}
          label="Extensions"
          tooltip="Extensions & flavors"
          active={activeWorkspacePanels.has('extensions')}
          onClick={() => handleToggleRightPanel('extensions')}
        />
      </RibbonGroup>
    </>
  );
}
