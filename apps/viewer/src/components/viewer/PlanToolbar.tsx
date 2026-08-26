/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The plan's own tool strip, along the top edge of the viewport.
 *
 * Carries exactly the 2D Section tools that mean something on a floor plan —
 * how the drawing is made, what is overlaid on it, how it is navigated and
 * exported. Everything that belongs to the model rather than to the drawing
 * (lists, lens, add-element, properties) stays in its own ribbon: this strip is
 * not a second home for the application.
 *
 * Deliberately absent:
 * - **Sheets / title block.** Laying a drawing onto paper is a separate act
 *   from working on a floor, and it already has a home.
 * - **DXF alignment.** Aligning an underlay is a job you do once, against the
 *   model, and it has its own picking mode that would fight selection here.
 * - **Scan layer.** Deferred.
 * - **Pin / unpin.** It existed because the panel could be resized and
 *   regenerating re-fitted the view; a full-viewport plan that refits only on a
 *   storey change has nothing for it to do.
 */

import React from 'react';
import {
  Box, Shapes, Tag, Layers, PenTool, FileText, ZoomIn, ZoomOut,
  Maximize2, Download, FileDown, Printer, RefreshCw, Ruler,
  Hexagon,
  LogOut, Type, Cloud, Trash2, FilePlus2, DoorOpen, Radio, Stamp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Annotation2DTool } from '@/store';
import { ViewModeToggle } from './ViewportOverlays';
import { PlanLayersMenu } from './PlanLayersMenu';
import { ViewportToolStrip, ToolStripDivider, ToolStripButton } from './ViewportToolStrip';
import { ASSUMED_LINING_THICKNESS } from '@/lib/plan/doorQuantities';
import { scaleDenominator, formatScaleRatio, STANDARD_SCALES } from '@/lib/plan/planChrome';
import type { PlanAnnotationKind } from '@/lib/plan/planAnnotations';

export interface PlanToolbarProps {
  displayOptions: {
    useSymbolicRepresentations: boolean;
    showIfcAnnotations: boolean;
    showConstructionProjection: boolean;
  };
  onToggleSymbolic: () => void;
  onToggleIfcAnnotations: () => void;
  onToggleConstructionProjection: () => void;

  /** Room names + areas written into the rooms. */
  showRoomLabels: boolean;
  onToggleRoomLabels: () => void;
  showDoorLabels: boolean;
  onToggleDoorLabels: () => void;
  /** The space graph as a diagram — what the door numbers are derived from. */
  showSpaceGraph: boolean;
  onToggleSpaceGraph: () => void;
  showZoneOutlines: boolean;
  onToggleZoneOutlines: () => void;
  zoneOutlineCount: number;
  /** How many rooms the graph found, for the tooltip. */
  graphNodeCount: number;
  /** How many rooms this storey actually has, for the tooltip. */
  roomCount: number;

  /** Derived door swings and window sashes. */
  showOpeningSymbols: boolean;
  onToggleOpeningSymbols: () => void;
  /** How many openings got a symbol on this storey, for the tooltip. */
  openingCount: number;
  /** How many doors got the assumed frame width because the model states none. */
  assumedLinings: number;
  /** How many door frames took their depth from the wall as drawn. */
  wallMeasuredDepths: number;
  /** How many doors got a symbol at all, as the denominator for it. */
  doorsWithSymbol: number;

  /** Small devices drawn as marks rather than at their own invisible size. */
  showDeviceMarks: boolean;
  onToggleDeviceMarks: () => void;
  /** How many devices this storey has, for the tooltip. */
  deviceCount: number;
  /**
   * What the symbol catalogue could NOT supply for the marks on this storey.
   *
   * `null` when there is nothing to say. Otherwise the plan is drawing generic
   * family glyphs where a normative symbol exists or would — and that is a
   * caveat about the drawing, not a switch, which is why it goes in the strip
   * beside the lining assumption rather than into a tooltip nobody opens.
   */
  deviceSymbolGap: {
    catalogSynced: boolean;
    withoutSymbol: number;
    /** Who to name, when a symbol on this sheet is used by permission. */
    attribution?: string | null;
  } | null;

  settingsOpen: boolean;
  onToggleSettings: () => void;
  dxfOpen: boolean;
  onToggleDxf: () => void;

  activeTool: Annotation2DTool;
  onSetTool: (tool: Annotation2DTool) => void;
  hasAnnotations: boolean;
  onClearAnnotations: () => void;
  /** True when a mark is selected and can be written into the model. */
  canCommitAnnotation: boolean;
  onCommitAnnotation: () => void;
  /** How many doors carry a mark — not every opening gets one. */
  doorLabelCount: number;
  /** Write the plan's own writing and graphics into the model. */
  onCommitPlanAnnotations: (kinds: readonly PlanAnnotationKind[]) => void;
  /** Write the drawn escape routes into the model. */
  onCommitEscapeRoutes: () => void;
  /** How many routes are drawn, for the menu entry. */
  escapeRouteCount: number;

  /** Screen pixels per drawing metre, for the scale readout. */
  pixelsPerMetre: number;
  /** Put the plan AT a scale — the denominator of `1:n`. */
  onSetScale: (denominator: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToView: () => void;

  onExportSVG: () => void;
  onExportDXF: () => void;
  onPrint: () => void;
  onRegenerate: () => void;
  busy: boolean;

  /** Storey picker and cut readout, supplied by the plan itself. */
  children?: React.ReactNode;
}

/** The strip's own hairline, shared with the 3D viewport's strip. */
const Divider = ToolStripDivider;
/** Shared with the 3D strip so the two cannot drift apart. */
const ToolButton = ToolStripButton;

export function PlanToolbar(props: PlanToolbarProps): React.ReactElement {
  const {
    displayOptions, onToggleSymbolic, onToggleIfcAnnotations,
    onToggleConstructionProjection, showRoomLabels, onToggleRoomLabels, roomCount,
    showDoorLabels, onToggleDoorLabels,
    showSpaceGraph, onToggleSpaceGraph, graphNodeCount,
    showZoneOutlines, onToggleZoneOutlines, zoneOutlineCount,
    showOpeningSymbols, onToggleOpeningSymbols, openingCount, assumedLinings,
    wallMeasuredDepths, doorsWithSymbol,
    showDeviceMarks, onToggleDeviceMarks, deviceCount, deviceSymbolGap,
    settingsOpen, onToggleSettings, dxfOpen, onToggleDxf,
    activeTool, onSetTool, hasAnnotations, onClearAnnotations,
    canCommitAnnotation, onCommitAnnotation, doorLabelCount, onCommitPlanAnnotations,
    onCommitEscapeRoutes, escapeRouteCount,
    pixelsPerMetre, onSetScale, onZoomIn, onZoomOut, onFitToView,
    onExportSVG, onExportDXF, onPrint, onRegenerate, busy, children,
  } = props;

  const scaleDenom = scaleDenominator(pixelsPerMetre);

  return (
    <ViewportToolStrip testId="plan">
      {/* The way out of the mode comes first — it is the one control whose
          absence strands you, and it sits at the same end of the building's
          strip so switching does not move the switch. */}
      <ViewModeToggle />
      <Divider />

      {children}
      {children ? <Divider /> : null}

      {/* How the drawing is made */}
      <ToolButton
        active={displayOptions.useSymbolicRepresentations}
        onClick={onToggleSymbolic}
        title={
          displayOptions.useSymbolicRepresentations
            ? 'Symbolische Darstellung (Plan) — zurück zum echten Körperschnitt'
            : 'Körperschnitt (Body) — auf die im Modell hinterlegte Plandarstellung wechseln'
        }
      >
        {displayOptions.useSymbolicRepresentations
          ? <Shapes className="h-4 w-4" />
          : <Box className="h-4 w-4" />}
      </ToolButton>
      {/* Everything the plan DRAWS on top of the cut, in one list with an eye
          each. Six pictograms in a row said nothing about what they were until
          each was hovered, and the row grew with every layer the plan learned
          to derive. The assumptions the opening symbols had to make stay
          visible in the strip, because they are a caveat about the drawing,
          not a switch. */}
      <PlanLayersMenu
        layers={[
          {
            id: 'roomLabels',
            label: 'Raumnummer und -name',
            count: roomCount,
            visible: showRoomLabels,
            onToggle: onToggleRoomLabels,
            unavailable: roomCount === 0
              ? 'Auf diesem Geschoss liegen keine Räume (IfcSpace)'
              : undefined,
          },
          {
            id: 'doorLabels',
            label: 'Türnummern',
            count: doorLabelCount,
            visible: showDoorLabels,
            onToggle: onToggleDoorLabels,
            unavailable: doorLabelCount === 0
              ? 'Auf diesem Geschoss liessen sich keine Türnummern ableiten'
              : undefined,
          },
          {
            id: 'openingSymbols',
            label: 'Tür- und Fenstersymbole',
            count: openingCount,
            visible: showOpeningSymbols,
            onToggle: onToggleOpeningSymbols,
            unavailable: openingCount === 0
              ? 'Auf diesem Geschoss liessen sich keine ableiten'
              : undefined,
          },
          {
            id: 'deviceMarks',
            label: 'Gerätesymbole',
            count: deviceCount,
            visible: showDeviceMarks,
            onToggle: onToggleDeviceMarks,
            unavailable: deviceCount === 0
              ? 'Auf diesem Geschoss liegen keine Geräte'
              : undefined,
          },
          {
            id: 'zoneOutlines',
            label: 'Auslösezonen (FKS-Umrandung)',
            count: zoneOutlineCount,
            visible: showZoneOutlines,
            onToggle: onToggleZoneOutlines,
            unavailable: zoneOutlineCount === 0
              ? 'Auf diesem Geschoss liegt keine Auslösezone — unter Author → Zones anlegen'
              : undefined,
          },
          {
            id: 'spaceGraph',
            label: 'SpatialGraph (Fluchtweg-Logik)',
            count: graphNodeCount,
            visible: showSpaceGraph,
            onToggle: onToggleSpaceGraph,
            unavailable: graphNodeCount === 0
              ? 'Auf diesem Geschoss gibt es keine Räume, zwischen denen ein Weg bestehen könnte'
              : undefined,
          },
          {
            id: 'ifcAnnotations',
            label: 'IFC-Beschriftungen aus dem Modell',
            count: null,
            visible: displayOptions.showIfcAnnotations,
            onToggle: onToggleIfcAnnotations,
          },
          {
            id: 'constructionProjection',
            label: 'Projektion unter dem Schnitt',
            count: null,
            visible: displayOptions.showConstructionProjection,
            onToggle: onToggleConstructionProjection,
          },
        ]}
      />

      {showDeviceMarks && deviceCount > 0 && deviceSymbolGap
        && (!deviceSymbolGap.catalogSynced || deviceSymbolGap.withoutSymbol > 0) && (
        // Same rule as the lining assumption below: a plan that silently draws
        // a plain circle where a normative symbol exists is not saying so, and
        // nothing else on screen would ever tell you the catalogue is one
        // click away. Measured: a fully drawable storey showed eighty
        // identical circles for days, with no hint anywhere.
        //
        // Only while the marks are actually shown — a caveat about a layer
        // that is switched off is noise.
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] leading-4 text-amber-700 dark:text-amber-300 tabular-nums">
              {deviceSymbolGap.catalogSynced
                ? `${deviceSymbolGap.withoutSymbol} ohne Symbol`
                : 'Symbole nicht abgeglichen'}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {deviceSymbolGap.catalogSynced
              ? `${deviceSymbolGap.withoutSymbol} von ${deviceCount} Geräten auf diesem Geschoss haben im Symbolkatalog keinen Eintrag für ihre Fachklasse und werden als Familienzeichen gezeichnet (Kreis, Dreieck). Der Eintrag fehlt im Katalog, nicht im Modell.`
              : 'Der Symbolkatalog ist in diesem Browser noch nicht abgeglichen — die Geräte werden als Familienzeichen gezeichnet statt mit ihrem Plansymbol. Unter File → Symbolkatalog abgleichen; dafür müssen externe Anfragen unter File → Datenschutz freigegeben sein.'}
          </TooltipContent>
        </Tooltip>
      )}

      {showDeviceMarks && deviceSymbolGap?.attribution && (
        // Not a warning and not a tooltip: this is the condition the symbols
        // are used under, and a condition nobody sees is not being met. It
        // shows only while such a symbol is actually on the sheet.
        <span className="ml-0.5 text-[10px] leading-4 text-muted-foreground">
          Symbole: {deviceSymbolGap.attribution}
        </span>
      )}

      {showOpeningSymbols && assumedLinings > 0 && (
        // Declared, not hidden in a tooltip. On every model met so far this is
        // the NORMAL case — no door states a lining thickness — and a plan that
        // quietly invents one has door openings a couple of centimetres wrong
        // everywhere without saying so. The number is stated too, because "5 cm"
        // is checkable and "assumed" is not.
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="ml-0.5 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] leading-4 text-amber-700 dark:text-amber-300 tabular-nums">
              Rahmen {Math.round(ASSUMED_LINING_THICKNESS * 100)} cm
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {assumedLinings === openingCount
              ? `Keine Tür auf diesem Geschoss nennt eine Rahmenbreite (IfcDoorLiningProperties). Für alle ${assumedLinings} ist ${Math.round(ASSUMED_LINING_THICKNESS * 100)} cm angenommen — Öffnungsbogen und Durchgangsbreite beruhen darauf.`
              : `${assumedLinings} von ${openingCount} Öffnungen nennen keine Rahmenbreite; für sie ist ${Math.round(ASSUMED_LINING_THICKNESS * 100)} cm angenommen.`}
          </TooltipContent>
        </Tooltip>
      )}
      {showOpeningSymbols && doorsWithSymbol > 0 && (
        // Which source the frame DEPTH came from. Invisible in the drawing —
        // a frame looks equally plausible whether it is the wall or the door
        // reveal talking about itself — and only the wall is the wall.
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`ml-0.5 rounded-sm border px-1 text-[10px] leading-4 tabular-nums ${
              wallMeasuredDepths === doorsWithSymbol
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            }`}>
              Wand {wallMeasuredDepths}/{doorsWithSymbol}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            {wallMeasuredDepths === doorsWithSymbol
              ? `Die Rahmentiefe ist bei allen ${doorsWithSymbol} Türen aus der gezeichneten Wand gemessen — das ist die Wandstärke am Durchgang.`
              : `Nur bei ${wallMeasuredDepths} von ${doorsWithSymbol} Türen ist die Rahmentiefe aus der gezeichneten Wand gemessen. Für die übrigen steht keine Wand im Schnitt zur Verfügung; dort zeigt der Rahmen die Tiefe der Zarge selbst (bzw. LiningDepth, falls das Modell sie nennt) — nicht die Wandstärke.`}
          </TooltipContent>
        </Tooltip>
      )}

      <Divider />

      <ToolButton active={settingsOpen} onClick={onToggleSettings} title="Zeichnungseinstellungen">
        <FileText className="h-4 w-4" />
      </ToolButton>
      <ToolButton active={dxfOpen} onClick={onToggleDxf} title="DXF-Unterlagen">
        <PenTool className="h-4 w-4" />
      </ToolButton>

      <Divider />

      {/* Annotation tools. There is no select/pan button: selecting is the
          resting state and panning is the right mouse button, so it would be a
          control for doing nothing. Clicking an armed tool again disarms it. */}
      <ToolButton
        active={activeTool === 'measure'}
        onClick={() => onSetTool(activeTool === 'measure' ? 'none' : 'measure')}
        title="Strecke messen"
      >
        <Ruler className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={activeTool === 'polygon-area'}
        onClick={() => onSetTool(activeTool === 'polygon-area' ? 'none' : 'polygon-area')}
        title="Fläche messen"
      >
        <Hexagon className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={activeTool === 'escape-route'}
        onClick={() => onSetTool(activeTool === 'escape-route' ? 'none' : 'escape-route')}
        title="Fluchtweg: Start klicken, dann Ziel — der Weg folgt Räumen und Türen"
      >
        <LogOut className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={activeTool === 'text'}
        onClick={() => onSetTool(activeTool === 'text' ? 'none' : 'text')}
        title="Textfeld"
      >
        <Type className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={activeTool === 'cloud'}
        onClick={() => onSetTool(activeTool === 'cloud' ? 'none' : 'cloud')}
        title="Revisionswolke"
      >
        <Cloud className="h-4 w-4" />
      </ToolButton>
      {canCommitAnnotation && (
        // Only offered with a mark selected, because it acts on THAT mark. The
        // wording says what happens to it: the mark stays where it is and the
        // model gains a copy, so this is never a one-way door.
        <ToolButton onClick={onCommitAnnotation} title="Als IfcAnnotation ins Modell übernehmen (Markierung bleibt)">
          <FilePlus2 className="h-4 w-4" />
        </ToolButton>
      )}
      {hasAnnotations && (
        <ToolButton onClick={onClearAnnotations} title="Alle Anmerkungen löschen">
          <Trash2 className="h-4 w-4" />
        </ToolButton>
      )}

      <Divider />

      {/* Committing the plan's OWN writing and graphics — a different act from
          the button above, which commits one selected mark. A menu rather than
          three buttons: it is one decision with three scopes, and none of them
          is the everyday one. Replaces on a second run rather than doubling. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <Stamp className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            Beschriftung und Plangrafik als IfcAnnotation ins Modell übernehmen.
            Die Texthöhe richtet sich nach dem eingestellten Massstab; ein
            zweiter Lauf ersetzt den ersten.
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="center" className="text-xs">
          <DropdownMenuItem
            disabled={roomCount === 0}
            onClick={() => onCommitPlanAnnotations(['roomLabel'])}
          >
            Raumbeschriftung übernehmen{roomCount > 0 ? ` (${roomCount})` : ''}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={doorLabelCount === 0}
            onClick={() => onCommitPlanAnnotations(['doorLabel'])}
          >
            Türbeschriftung übernehmen{doorLabelCount > 0 ? ` (${doorLabelCount})` : ''}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={openingCount === 0}
            onClick={() => onCommitPlanAnnotations(['openingSymbol'])}
          >
            Plangrafik übernehmen{openingCount > 0 ? ` (${openingCount})` : ''}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Its own entry, not folded into "Alles übernehmen": routes carry
              their own markers, and a person committing labels must not have
              their routes rewritten as a side effect. */}
          <DropdownMenuItem
            disabled={escapeRouteCount === 0}
            onClick={onCommitEscapeRoutes}
          >
            Fluchtwege übernehmen{escapeRouteCount > 0 ? ` (${escapeRouteCount})` : ''}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={roomCount + doorLabelCount + openingCount === 0}
            onClick={() => onCommitPlanAnnotations(['roomLabel', 'doorLabel', 'openingSymbol'])}
          >
            Alles übernehmen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      {/* Navigation */}
      <ToolButton onClick={onZoomOut} title="Verkleinern"><ZoomOut className="h-4 w-4" /></ToolButton>
      {/* A SCALE, not a zoom percentage (#50). "142 %" describes the window;
          1:100 describes the drawing, and it is what somebody reading a plan
          asks for. Picking one sets the zoom to match. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm"
                      className="h-6 min-w-[3.5rem] px-1 text-[10px] tabular-nums text-muted-foreground">
                {scaleDenom === null ? '—' : formatScaleRatio(scaleDenom)}
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs text-xs">
            Massstab der Darstellung. Auf dem Bildschirm nur so genau, wie der
            Monitor den CSS-Pixel einhält. SVG-Export und Druck bemassen das
            Blatt in Millimetern — beim Drucken muss die Skalierung im
            Druckdialog auf 100 % stehen, sonst passt der Browser ein.
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="center" className="min-w-0">
          {STANDARD_SCALES.map((d) => (
            <DropdownMenuItem key={d} onClick={() => onSetScale(d)}
                              className="text-xs tabular-nums justify-center">
              {formatScaleRatio(d)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton onClick={onZoomIn} title="Vergrössern"><ZoomIn className="h-4 w-4" /></ToolButton>
      <ToolButton onClick={onFitToView} title="Einpassen"><Maximize2 className="h-4 w-4" /></ToolButton>

      <Divider />

      {/* Output. Grouped in a menu because three formats as three buttons
          reads as three different actions rather than one choice. */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm"><Download className="h-4 w-4" /></Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Herunterladen</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onExportSVG}>
            <Download className="mr-2 h-4 w-4" />SVG
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportDXF}>
            <FileDown className="mr-2 h-4 w-4" />DXF
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onPrint}>
            <Printer className="mr-2 h-4 w-4" />PDF / Drucken
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolButton onClick={onRegenerate} disabled={busy} title="Neu berechnen">
        <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
      </ToolButton>
    </ViewportToolStrip>
  );
}

export default PlanToolbar;
