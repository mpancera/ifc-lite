/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Discipline tabs — where this fork's own tools live.
 *
 * The base application is the modeller; what this fork adds is sorted by the
 * trade that reaches for it, the way a CAD package keeps its core menus and
 * ships an architecture or an electrical toolset on top. The base tabs (File,
 * Home, View, Elements, Analyze, Author) are therefore left exactly as
 * upstream ships them, and every addition sits in one of the tabs below.
 *
 * DATA is not a trade: it holds what every discipline needs — rules for
 * property values, the cleaners, the catalogues, the project binding. The
 * four trade tabs each start with a ROLE group, because picking a role is the
 * first thing a trade planner does (every device placed afterwards joins that
 * role's installation), and then carry the tools that trade actually uses.
 *
 * ONE definition, TWO renderers. The ribbon paints these as groups of large
 * buttons (`DisciplineRibbonTab`); the classic strip paints the same list as
 * one dropdown with a submenu per tab (`DisciplinesMenu`). Both go through
 * `DisciplineItemButton`, which is the only place that knows how an item is
 * opened — so the two toolbar styles cannot drift apart, and moving a tool
 * from one tab to another is a change to this file alone.
 *
 * Store reads in this file are written as `(s) => s.xxx` on purpose: the
 * toolbar-parity guard walks the AST for exactly that shape, which is how it
 * sees that both toolbars reach the same capabilities.
 */

import type { ComponentType, ElementType, ReactNode } from 'react';
import {
  Blocks,
  BookMarked,
  Box,
  Boxes,
  Brush,
  Cable,
  Cctv,
  ClipboardList,
  DoorClosed,
  DoorOpen,
  Droplets,
  Factory,
  FileDiff,
  Flame,
  FolderOpen,
  Footprints,
  HardHat,
  KeyRound,
  Library,
  ListChecks,
  PackageCheck,
  Palette,
  PenLine,
  Radar,
  Radio,
  Ruler,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  Spline,
  Thermometer,
  Wand2,
  Waypoints,
  Wind,
  Workflow,
} from 'lucide-react';
import { AddElement, DemoFlows, IsometricView, TopView } from '@/icons';
import type { RibbonTabId, ViewerState } from '@/store';
import type { WorkspacePanelId } from '@/lib/panels/registry';
import { DISCIPLINE_ROLES, EDITOR_ROLE_ID, type DisciplineSystem } from '@/lib/roles/disciplineRoles';
import { openDemoFlows } from '@/components/screenflow/DemoFlowsLauncher';
import type { ToolPanel } from '../toolbar/useWorkspacePanelControls';
import { ClassCatalogPanel } from '../ClassCatalogPanel';
import { ColorPalettePanel } from '../ColorPalettePanel';
import { DataPrivacyPanel } from '../DataPrivacyPanel';
import { DisciplineRolePanel } from '../DisciplineRolePanel';
import { PlanProductsPanel } from '../PlanProductsPanel';
import { ProjectFolderPanel } from '../ProjectFolderPanel';
import { ReferenceOverridesPanel } from '../ReferenceOverridesPanel';
import { RelationKindsPanel } from '../RelationKindsPanel';
import { SmartPropertyPanel } from '../SmartPropertyPanel';
import { SymbolCatalogPanel } from '../SymbolCatalogPanel';
import { ProductLibraryPanel } from '../catalog/ProductLibraryPanel';

/** The ribbon tab ids this module owns. */
export type DisciplineTabId = Extract<RibbonTabId, 'data' | 'architecture' | 'fire' | 'security' | 'automation'>;

interface ItemBase {
  /** Stable, unique across every tab; keys the rendered controls. */
  id: string;
  /** Visible name. */
  label: string;
  /** The name with soft hyphens (U+00AD) where a large ribbon button may
   *  break it — a 56 px button clips "Branddetektion" otherwise. Menus and
   *  tests use `label`; only the ribbon reads this. */
  ribbonLabel?: string;
  /** What it does, one sentence — shown as the tooltip. */
  tooltip: string;
  icon: ElementType;
  /** Disabled until a model is loaded. Off by default: most settings and
   *  every role work on an empty scene. */
  needsModel?: boolean;
}

/** A dialog that mounts its own trigger: `<Dialog trigger={…} />`. The
 *  trigger is always supplied, so a dialog that requires one fits too. */
export type TriggeredDialog = ComponentType<{ trigger: ReactNode }>;

export type DisciplineItem =
  /** A registry panel (side or bottom), toggled in its home region. */
  | (ItemBase & { kind: 'panel'; panel: WorkspacePanelId })
  /** A right-slot TOOL panel — open while its tool is the active tool. */
  | (ItemBase & { kind: 'tool'; tool: ToolPanel })
  /** A dialog; the rendered control becomes its trigger. */
  | (ItemBase & { kind: 'dialog'; Dialog: TriggeredDialog })
  /** An on/off state in the store. */
  | (ItemBase & { kind: 'toggle'; read: (s: ViewerState) => boolean; write: (s: ViewerState, next: boolean) => void })
  /** A command; latched when `isActive` says so. */
  | (ItemBase & { kind: 'action'; run: (s: ViewerState) => void; isActive?: (s: ViewerState) => boolean });

export interface DisciplineGroup {
  label: string;
  items: DisciplineItem[];
}

export interface DisciplineTab {
  id: DisciplineTabId;
  label: string;
  /** One sentence for the tab, so the list reads without prior knowledge. */
  intro: string;
  groups: DisciplineGroup[];
}

/* ── Shared items ──
   A tool that two trades use is one item rendered twice, not two items: the
   id stays the same so the guard against duplicates below still catches a
   real double, and the label cannot drift between tabs. */

const ADD_ELEMENT: DisciplineItem = {
  id: 'addElement',
  kind: 'tool',
  tool: 'addElement',
  label: 'Add element',
  tooltip: 'Geräte und Bauteile per Klick setzen — mit aktiver Rolle treten sie ihrer Anlage bei',
  icon: AddElement,
};

const PRODUCT_LIBRARY: DisciplineItem = {
  id: 'productLibrary',
  kind: 'dialog',
  Dialog: ProductLibraryPanel,
  label: 'Product Library',
  tooltip: 'Den Firmenkatalog durchsehen und nachschlagen, welche Produkte in diesem Projekt verbaut sind',
  icon: Library,
};

const COMPARTMENTS: DisciplineItem = {
  id: 'compartments',
  kind: 'panel',
  panel: 'zones',
  label: 'Compartments',
  ribbonLabel: 'Compart\u00ADments',
  tooltip: 'Location zones als Abschnitte mit eigenem Körper — Brandabschnitte, Sicherheitszonen — zeichnen und Bauteile darin klassifizieren (IfcSpatialZone)',
  icon: Box,
  needsModel: true,
};

/* ── Roles ──
   Built from the role catalogue rather than listed by hand, so a system added
   to `DISCIPLINE_ROLES` shows up on its tab without a second edit here. Only
   the icon is chosen per system; an unlisted one gets the hard hat. */

const SYSTEM_RIBBON_LABELS: Record<string, string> = {
  'fire.detection': 'Brand\u00ADdetektion',
  'fire.gas': 'Gas\u00ADdetektion',
  'security.access': 'Zutritts\u00ADkontrolle',
  'security.video': 'Video\u00ADsecurity',
  'security.intrusion': 'Intrusion',
  'security.tracking': 'Ortungs\u00ADsysteme',
  'automation.primary': 'Automation Primär\u00ADanlagen',
  'automation.rooms': 'Raum\u00ADautomation',
};

const SYSTEM_ICONS: Record<string, ElementType> = {
  'fire.detection': Flame,
  'fire.gas': Wind,
  'fire.evacuation': Footprints,
  'fire.suppression': Droplets,
  'security.access': KeyRound,
  'security.video': Cctv,
  'security.intrusion': ShieldAlert,
  'security.tracking': Radar,
  'automation.primary': Factory,
  'automation.rooms': Thermometer,
};

function roleItem(system: DisciplineSystem): DisciplineItem {
  return {
    id: `role:${system.id}`,
    kind: 'action',
    label: system.label,
    ribbonLabel: SYSTEM_RIBBON_LABELS[system.id],
    tooltip: `Als ${system.label} arbeiten — jedes ab jetzt platzierte Gerät tritt dieser Anlage bei (IfcDistributionSystem)`,
    icon: SYSTEM_ICONS[system.id] ?? HardHat,
    run: (s) => s.setActiveDisciplineSystemId(system.id),
    isActive: (s) => s.activeDisciplineSystemId === system.id,
  };
}

function roleGroup(roleId: string): DisciplineGroup {
  const role = DISCIPLINE_ROLES.find((r) => r.id === roleId);
  return { label: 'Role', items: (role?.systems ?? []).map(roleItem) };
}

export const DISCIPLINE_TABS: readonly DisciplineTab[] = [
  {
    id: 'data',
    label: 'Data',
    intro: 'Was jede Disziplin braucht: Regeln für Werte, die Aufräumwerkzeuge, die Kataloge und das Projekt.',
    groups: [
      {
        label: 'Properties',
        items: [
          {
            id: 'smartProperty',
            kind: 'dialog',
            Dialog: SmartPropertyPanel,
            label: 'Smart Property',
            tooltip: 'Regeln, die einen Eigenschaftswert aus dem Modell rund um ein Element zusammensetzen',
            icon: Wand2,
            needsModel: true,
          },
          {
            id: 'referenceChanges',
            kind: 'dialog',
            Dialog: ReferenceOverridesPanel,
            label: 'Reference changes',
            tooltip: 'Was am Referenzmodell angefasst wurde: Element, Feld, vorher und nachher',
            icon: FileDiff,
            needsModel: true,
          },
        ],
      },
      {
        label: 'Housekeeping',
        items: [
          {
            id: 'housekeeping',
            kind: 'panel',
            panel: 'housekeeping',
            label: 'Housekeeping',
            ribbonLabel: 'House\u00ADkeeping',
            tooltip: 'Überblick über den Modellzustand — was fehlt, was doppelt ist, was aufgeräumt werden sollte',
            icon: ListChecks,
            needsModel: true,
          },
          {
            id: 'proxyTriage',
            kind: 'panel',
            panel: 'proxyTriage',
            label: 'Clean Proxy',
            tooltip: 'Elemente ohne Fachklasse (IfcBuildingElementProxy) gruppenweise der richtigen Klasse zuweisen',
            icon: Boxes,
            needsModel: true,
          },
          {
            id: 'classTriage',
            kind: 'panel',
            panel: 'classTriage',
            label: 'Clean Classes',
            tooltip: 'Elemente auf einer Zwischen- oder abstrakten Klasse gruppenweise der richtigen Fachklasse zuweisen',
            icon: Blocks,
            needsModel: true,
          },
        ],
      },
      {
        label: 'Catalogs',
        items: [
          PRODUCT_LIBRARY,
          {
            id: 'classCatalog',
            kind: 'dialog',
            Dialog: ClassCatalogPanel,
            label: 'Objektkatalog',
            ribbonLabel: 'Objekt\u00ADkatalog',
            tooltip: 'Die Liste der Fachklassen abgleichen, aus der ein Element seine Klasse bekommt',
            icon: BookMarked,
          },
          {
            id: 'relationKinds',
            kind: 'dialog',
            Dialog: RelationKindsPanel,
            label: 'Beziehungsarten',
            ribbonLabel: 'Beziehungs\u00ADarten',
            tooltip: 'Welche Beziehungsarten der Graph kennt, und mit welcher Linienart jede gezeichnet wird',
            icon: Spline,
          },
          {
            id: 'graph',
            kind: 'panel',
            panel: 'graph',
            label: 'Graph',
            tooltip: 'Schema: Elemente nach ihrer Zugehörigkeit statt nach ihrer Lage — hebt im Modell hervor, was gezeichnet ist',
            icon: Workflow,
            needsModel: true,
          },
        ],
      },
      {
        label: 'Deliverables',
        items: [
          {
            id: 'exportProducts',
            kind: 'panel',
            panel: 'exports',
            label: 'Exportprodukte',
            ribbonLabel: 'Export\u00ADprodukte',
            tooltip: 'Was aus diesem Projekt herausgegeben wird — Pläne, Listen, Graph, Struktur — und der Stapellauf, der es erzeugt',
            icon: PackageCheck,
          },
          {
            id: 'planProducts',
            kind: 'dialog',
            Dialog: PlanProductsPanel,
            label: 'Planprodukte',
            ribbonLabel: 'Plan\u00ADprodukte',
            tooltip: 'Welche Zeichnungen aus diesem Modell entstehen — und was jede zeigt',
            icon: ClipboardList,
          },
        ],
      },
      {
        label: 'Workspace',
        items: [
          {
            id: 'disciplineRole',
            kind: 'dialog',
            Dialog: DisciplineRolePanel,
            label: 'Disziplin',
            tooltip: 'Welcher Anlage neue Bauteile beitreten, und ob das Referenzmodell geändert werden darf',
            icon: HardHat,
          },
          {
            id: 'projectFolder',
            kind: 'dialog',
            Dialog: ProjectFolderPanel,
            label: 'Projekt',
            tooltip: 'Diese Sitzung an einen Projektordner binden — entscheidet, was ein Modellwechsel behält',
            icon: FolderOpen,
          },
          {
            id: 'dataPrivacy',
            kind: 'dialog',
            Dialog: DataPrivacyPanel,
            label: 'Data privacy',
            tooltip: 'Ob die Anwendung fremde Dienste ansprechen darf — ein Schalter vor allen ausgehenden Anfragen',
            icon: ShieldCheck,
          },
          {
            id: 'colorPalette',
            kind: 'dialog',
            Dialog: ColorPalettePanel,
            label: 'Colour palette',
            tooltip: 'Eine Farbpalette laden, oder zur eingebauten zurück',
            icon: Palette,
          },
          {
            id: 'demoFlows',
            kind: 'action',
            label: 'Flows',
            tooltip: 'User Journey — die Demo-Flows vorführen oder aufnehmen',
            icon: DemoFlows,
            run: () => openDemoFlows(),
          },
        ],
      },
    ],
  },

  {
    id: 'architecture',
    label: 'Architecture',
    intro: 'Das Gebäude selbst: der Grundriss als Arbeitsfläche, Räume und Zonen, Geschosse und Höhen.',
    groups: [
      {
        label: 'Role',
        items: [
          {
            id: `role:${EDITOR_ROLE_ID}`,
            kind: 'action',
            label: 'Editor',
            tooltip: 'Das Referenzmodell bearbeiten — Räume, Klassen, Zonen. Voller Zugriff, bewusst gewählt',
            icon: PenLine,
            run: (s) => s.setActiveDisciplineSystemId(EDITOR_ROLE_ID),
            isActive: (s) => s.activeDisciplineSystemId === EDITOR_ROLE_ID,
          },
        ],
      },
      {
        label: 'Plan',
        items: [
          {
            id: 'plan2d',
            kind: 'action',
            label: '2D',
            tooltip: 'Grundriss: ein Geschoss, geschnitten, orthogonal — ergänzt das 2D-Section-Werkzeug, ersetzt es nicht',
            icon: TopView,
            needsModel: true,
            run: (s) => s.setViewMode('2d'),
            isActive: (s) => s.viewMode === '2d',
          },
          {
            id: 'plan3d',
            kind: 'action',
            label: '3D',
            tooltip: 'Das Gebäude als Ganzes',
            icon: IsometricView,
            run: (s) => s.setViewMode('3d'),
            isActive: (s) => s.viewMode === '3d',
          },
        ],
      },
      {
        label: 'Rooms',
        items: [
          {
            id: 'zonePaint',
            kind: 'tool',
            tool: 'zonePaint',
            label: 'Zones',
            tooltip: 'Zonen anlegen und Räume hineinmalen (IfcZone)',
            icon: Brush,
            needsModel: true,
          },
          {
            id: 'roomTriage',
            kind: 'panel',
            panel: 'roomTriage',
            label: 'Clean Rooms',
            tooltip: 'Räume ohne Nummer, ohne Bezeichnung oder doppelt vergeben einzeln nachtragen — oder als Splitter der Wanderkennung verwerfen',
            icon: DoorOpen,
            needsModel: true,
          },
          {
            id: 'doorNumbers',
            kind: 'panel',
            panel: 'doorNumbers',
            label: 'Türnummern',
            tooltip: 'Türen nach dem Raum nummerieren, aus dem man durch sie flüchtet — und sie mit beiden angrenzenden Räumen verknüpfen',
            icon: DoorClosed,
            needsModel: true,
          },
        ],
      },
      {
        label: 'Levels',
        items: [
          {
            id: 'heights',
            kind: 'panel',
            panel: 'heights',
            label: 'Höhen & Lage',
            tooltip: 'Geschosskoten, Stockwerkshöhen und die geltenden Einheiten dieses Projekts',
            icon: Ruler,
          },
        ],
      },
    ],
  },

  {
    id: 'fire',
    label: 'Fire',
    intro: 'Brandschutz: Abschnitte, Fluchtwege, die Brandmeldeanlage und ihre Plansymbole.',
    groups: [
      roleGroup('fire'),
      { label: 'Devices', items: [ADD_ELEMENT, PRODUCT_LIBRARY] },
      { label: 'Compartments', items: [COMPARTMENTS] },
      {
        label: 'Escape',
        items: [
          {
            id: 'spaceGraph',
            kind: 'toggle',
            label: 'SpatialGraph',
            ribbonLabel: 'Spatial\u00ADGraph',
            tooltip: 'Räume als Punkte, Türen als Linien, dazu die Anzahl Türen bis ins Sichere — die Grundlage von Fluchtwegen und Türnummern, sichtbar gemacht',
            icon: Waypoints,
            needsModel: true,
            read: (s) => s.showSpaceGraph,
            write: (s, next) => s.setShowSpaceGraph(next),
          },
        ],
      },
      {
        label: 'Detection',
        items: [
          {
            id: 'wiring',
            kind: 'panel',
            panel: 'wiring',
            label: 'Verkabeln',
            tooltip: 'Melder der Reihe nach anklicken, wie das Kabel läuft — legt Anschlüsse, Verbindungen und den Melderkreis an',
            icon: Cable,
            needsModel: true,
          },
          {
            id: 'detectorGroups',
            kind: 'panel',
            panel: 'detectorGroups',
            label: 'Meldergruppen',
            ribbonLabel: 'Melder\u00ADgruppen',
            tooltip: 'Je Auslösezone einen Melderkreis bilden und die Melder mit ihrem Kennzeichen beschriften',
            icon: Radio,
            needsModel: true,
          },
        ],
      },
      {
        label: 'Symbols',
        items: [
          {
            id: 'symbolCatalog',
            kind: 'dialog',
            Dialog: SymbolCatalogPanel,
            label: 'Symbolkatalog',
            ribbonLabel: 'Symbol\u00ADkatalog',
            tooltip: 'Die Plansymbole abgleichen, die eine Fachklasse auf der Zeichnung bekommt',
            icon: Shapes,
          },
        ],
      },
    ],
  },

  {
    id: 'security',
    label: 'Security',
    intro: 'Sicherheit: Zutritt, Video, Einbruch und Ortung — die Anlage wählen, Geräte setzen, Zonen ziehen.',
    groups: [
      roleGroup('security'),
      { label: 'Devices', items: [ADD_ELEMENT, PRODUCT_LIBRARY] },
      { label: 'Zones', items: [COMPARTMENTS] },
    ],
  },

  {
    id: 'automation',
    label: 'Automation',
    intro: 'Gebäudeautomation: Primäranlagen und Raumautomation — die Anlage wählen und ihre Geräte setzen.',
    groups: [
      roleGroup('automation'),
      { label: 'Devices', items: [ADD_ELEMENT, PRODUCT_LIBRARY] },
    ],
  },
];

/** The tab with this id, or `null` for a base tab. */
export function disciplineTab(id: RibbonTabId): DisciplineTab | null {
  return DISCIPLINE_TABS.find((tab) => tab.id === id) ?? null;
}
