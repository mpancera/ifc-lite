/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Workspace-panel registry (issues #1200 / #1201 / #1208).
 *
 * Single source of truth for the panels the unified sidebar switches
 * between, floats, and pops out. Each entry carries its id, labels, icon,
 * an activity-bar `group` (for divider clustering) and a `prefersWide`
 * hint (code/table/timeline panels want a wider sidebar + bigger pop-out).
 *
 * The panel switcher, the activity bar, the keyboard shortcuts (Alt+N by
 * array index — DO NOT reorder the first seven, that mapping shipped in
 * #1200), the floating-panel host and the pop-out windows all read this.
 * The actual panel components are mapped from an id by `renderPanelBody`,
 * which keeps this module free of heavy imports.
 */

import {
  Info,
  GitCompareArrows,
  MessageSquare,
  ClipboardCheck,
  ClipboardList,
  Boxes,
  Blocks,
  Palette,
  Crosshair,
  Puzzle,
  Terminal,
  CalendarRange,
  Table2,
  ListTree,
  Users,
  Layers as LayersIcon,
  Box,
  Ruler,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/** Every panel reachable from the unified sidebar rail. `properties` is the
 *  Information panel (the right pane's default fallback). Each panel opens in
 *  its home {@link WorkspacePanelDef.region} — `side` panels in the right pane,
 *  `bottom` panels (Script / Schedule / Lists) in the bottom strip, and the
 *  `left` panel (Hierarchy) in the left navigation slot (#1267). */
export type WorkspacePanelId =
  | 'hierarchy'
  | 'properties'
  | 'compare'
  | 'bcf'
  | 'ids'
  | 'lens'
  | 'clash'
  | 'extensions'
  | 'script'
  | 'gantt'
  | 'lists'
  | 'collab'
  | 'layers'
  | 'zones'
  | 'heights'
  | 'graph'
  | 'housekeeping'
  | 'proxyTriage'
  | 'classTriage';

/** Activity-bar clustering — a divider is drawn whenever the group changes. */
export type PanelGroup = 'navigate' | 'inspect' | 'review' | 'author' | 'work';

/** Where a panel docks when opened from the rail. `left` is the dedicated
 *  hierarchy navigation slot, toggled via `leftPanelCollapsed` (#1267). */
export type PanelRegion = 'side' | 'bottom' | 'left';

export interface WorkspacePanelDef {
  id: WorkspacePanelId;
  /** Full label (tooltip / floating-window title / sidebar header). */
  title: string;
  /** Short label for menus / the switcher dropdown. */
  short: string;
  Icon: LucideIcon;
  /** Activity-bar group used to cluster icons with dividers. */
  group: PanelGroup;
  /** Home dock: the right pane (`side`) or the bottom strip (`bottom`). */
  region: PanelRegion;
  /** Wider default pop-out / float size for content-heavy panels. */
  prefersWide?: boolean;
}

export const WORKSPACE_PANELS: readonly WorkspacePanelDef[] = [
  // Alt+1..9 / Alt+0 — order frozen since #1200 for the first seven.
  { id: 'properties', title: 'Information', short: 'Info', Icon: Info, group: 'inspect', region: 'side' },
  { id: 'compare', title: 'Compare models', short: 'Compare', Icon: GitCompareArrows, group: 'inspect', region: 'side' },
  { id: 'bcf', title: 'BCF issues', short: 'BCF', Icon: MessageSquare, group: 'review', region: 'side' },
  { id: 'ids', title: 'IDS validation', short: 'IDS', Icon: ClipboardCheck, group: 'review', region: 'side' },
  { id: 'lens', title: 'Lens rules', short: 'Lens', Icon: Palette, group: 'review', region: 'side' },
  { id: 'clash', title: 'Clash detection', short: 'Clash', Icon: Crosshair, group: 'review', region: 'side' },
  { id: 'extensions', title: 'Extensions', short: 'Extensions', Icon: Puzzle, group: 'author', region: 'side' },
  // Bottom-strip panels — launched from the rail, open at the bottom by default.
  { id: 'script', title: 'Script editor', short: 'Script', Icon: Terminal, group: 'work', region: 'bottom', prefersWide: true },
  { id: 'gantt', title: 'Construction schedule', short: 'Schedule', Icon: CalendarRange, group: 'work', region: 'bottom', prefersWide: true },
  { id: 'lists', title: 'Entity lists', short: 'Lists', Icon: Table2, group: 'work', region: 'bottom', prefersWide: true },
  // Left-slot nav panel (#1267), APPENDED so the frozen Alt+1..0 mapping above
  // is untouched (it gets no Alt shortcut). Its default *display* position is the
  // top of the rail (see DEFAULT_ORDER in sidebarSlice); the activity bar toggles
  // its left slot via `leftPanelCollapsed` rather than the right-pane flags.
  { id: 'hierarchy', title: 'Hierarchy', short: 'Tree', Icon: ListTree, group: 'navigate', region: 'left' },
  // Collaboration room roster (link-based multiuser). APPENDED so the frozen
  // Alt+1..0 mapping stays intact (no Alt shortcut). The activity bar hides it
  // while the collab feature flag is off (see ActivityBar).
  { id: 'collab', title: 'Collaboration room', short: 'Room', Icon: Users, group: 'review', region: 'side' },
  // IFCX layer stack + per-layer diff (#1717). APPENDED so the frozen
  // Alt+1..0 mapping stays intact (no Alt shortcut). The activity bar only
  // surfaces it while a federated layer stack is loaded.
  { id: 'layers', title: 'Layer stack', short: 'Layers', Icon: LayersIcon, group: 'review', region: 'side' },
  // Compartments — spatial sections with their own geometry: fire
  // compartments, takt areas, construction phases (#1810). APPENDED so the
  // frozen Alt+1..0 mapping stays intact (no Alt shortcut).
  //
  // The id stays `zones` on purpose: it is persisted in the sidebar layout and
  // in exported flavors, so renaming it would silently drop a user's rail
  // order. The LABEL is what changed — "Location zones" said nothing about
  // what the boxes are for, and collided with the IfcZone tool next to it.
  { id: 'zones', title: 'Compartments', short: 'Sections', Icon: Box, group: 'review', region: 'side' },
  // The project's reference height system: storey levels and heights that every
  // discipline model has to agree on. APPENDED so the frozen Alt+1..0 mapping
  // stays intact (no Alt shortcut).
  // Bottom strip, like Lists: it is a verification view — a wide table one
  // consults occasionally, not a tool one works beside. Reached from File ▸
  // Settings rather than an authoring tab, for the same reason.
  { id: 'heights', title: 'Höhen & Lage', short: 'Heights', Icon: Ruler, group: 'review', region: 'bottom' },
  // The schematic view: elements arranged by what they belong to rather than by
  // where they are (PROJECT.md §V35). APPENDED so the frozen Alt+1..0 mapping
  // stays intact (no Alt shortcut).
  //
  // Bottom strip, like Lists, and for the same reason — it is read ALONGSIDE
  // the model, not instead of it. It was briefly a third view mode covering the
  // viewport, which was wrong: the drawing and the building answer each other,
  // and a schematic that hides the thing it describes cannot do that.
  { id: 'graph', title: 'Graph', short: 'Graph', Icon: Workflow, group: 'review', region: 'bottom', prefersWide: true },
  // The model's Prüfplan: every housekeeping check as a row, worked through
  // one at a time. APPENDED so the frozen Alt+1..0 mapping stays intact (no
  // Alt shortcut).
  //
  // Side panel and not bottom: its rows select elements in the model, and a
  // checklist you consult WHILE looking at what it points at has to stand
  // beside the viewport rather than under it.
  { id: 'housekeeping', title: 'Housekeeping', short: 'Prüfplan', Icon: ClipboardList, group: 'review', region: 'side' },
  // The two class-cleaning tools. APPENDED so the frozen Alt+1..0 mapping
  // stays intact (no Alt shortcut).
  //
  // Side panels and not dialogs, which is what they were first: deciding what
  // a group of elements IS means looking at them, and a dialog covers the one
  // thing that would settle the question (Marc, 2026-08-15). As panels they
  // isolate their selection in the viewport and stand beside it.
  { id: 'proxyTriage', title: 'Clean Proxy', short: 'Proxy', Icon: Boxes, group: 'author', region: 'side' },
  { id: 'classTriage', title: 'Clean Classes', short: 'Klassen', Icon: Blocks, group: 'author', region: 'side' },
];

/** The bottom-strip panel ids, mapped to their store visibility flag + setter
 *  names — these stay independent of the single-tenant right pane. */
export type BottomPanelId = Extract<WorkspacePanelId, 'script' | 'gantt' | 'lists' | 'heights' | 'graph'>;

export function isBottomPanel(id: WorkspacePanelId): id is BottomPanelId {
  return id === 'script' || id === 'gantt' || id === 'lists' || id === 'heights' || id === 'graph';
}

/** The left-slot nav panel (Hierarchy, #1267): toggled via `leftPanelCollapsed`,
 *  never floated / popped / docked into the right pane. */
export function isLeftPanel(id: WorkspacePanelId): id is 'hierarchy' {
  return id === 'hierarchy';
}

const PANEL_BY_ID = new Map<WorkspacePanelId, WorkspacePanelDef>(WORKSPACE_PANELS.map((p) => [p.id, p]));

export function getPanelDef(id: WorkspacePanelId): WorkspacePanelDef | undefined {
  return PANEL_BY_ID.get(id);
}

/** Type guard for narrowing arbitrary strings to a known panel id. */
export function isWorkspacePanelId(id: string): id is WorkspacePanelId {
  return PANEL_BY_ID.has(id as WorkspacePanelId);
}

/**
 * Map an Alt+digit shortcut's `KeyboardEvent.code` to the workspace panel it
 * opens (#1200/#1208). Digit/Numpad 1-9 select the first nine panels; 0 selects
 * the tenth. Keyed off `code` (not `key`) so it stays layout-independent — on
 * macOS Alt+1 yields the character "¡" but the code is still "Digit1". Returns
 * undefined for non-digit codes (so other Alt combos fall through) or a digit
 * past the registry length.
 */
export function workspacePanelForShortcutCode(code: string): WorkspacePanelId | undefined {
  const m = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (!m) return undefined;
  const n = Number(m[1]);
  return WORKSPACE_PANELS[n === 0 ? 9 : n - 1]?.id;
}

/** The analysis / tool panels that toggle in the sidebar (everything except
 *  the Information fallback, which shows when no other panel is open). */
export type AnalysisPanelId = Exclude<WorkspacePanelId, 'properties'>;

export function isAnalysisPanel(id: WorkspacePanelId): id is AnalysisPanelId {
  return id !== 'properties';
}

/** Default docked-sidebar width as a % of the viewport, and the wider default
 *  used when a `prefersWide` panel (Script / Gantt / Lists) is active. */
export const SIDEBAR_DEFAULT_WIDTH_PCT = 22;
export const SIDEBAR_WIDE_WIDTH_PCT = 40;
