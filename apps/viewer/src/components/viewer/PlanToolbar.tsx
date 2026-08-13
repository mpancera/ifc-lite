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
  Hexagon, Type, Cloud, Trash2, FilePlus2, DoorOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Annotation2DTool } from '@/store';
import { ViewModeToggle } from './ViewportOverlays';
import { ViewportToolStrip, ToolStripDivider } from './ViewportToolStrip';
import { ASSUMED_LINING_THICKNESS } from '@/lib/plan/doorQuantities';
import { scaleDenominator, formatScaleRatio, STANDARD_SCALES } from '@/lib/plan/planChrome';

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
  /** How many rooms this storey actually has, for the tooltip. */
  roomCount: number;

  /** Derived door swings and window sashes. */
  showOpeningSymbols: boolean;
  onToggleOpeningSymbols: () => void;
  /** How many openings got a symbol on this storey, for the tooltip. */
  openingCount: number;
  /** How many doors got the assumed frame width because the model states none. */
  assumedLinings: number;

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

function ToolButton({
  active, onClick, title, children, disabled,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? 'default' : 'ghost'}
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          aria-pressed={active}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
    </Tooltip>
  );
}

export function PlanToolbar(props: PlanToolbarProps): React.ReactElement {
  const {
    displayOptions, onToggleSymbolic, onToggleIfcAnnotations,
    onToggleConstructionProjection, showRoomLabels, onToggleRoomLabels, roomCount,
    showOpeningSymbols, onToggleOpeningSymbols, openingCount, assumedLinings,
    settingsOpen, onToggleSettings, dxfOpen, onToggleDxf,
    activeTool, onSetTool, hasAnnotations, onClearAnnotations,
    canCommitAnnotation, onCommitAnnotation,
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
      <ToolButton
        active={displayOptions.showIfcAnnotations}
        onClick={onToggleIfcAnnotations}
        title="IFC-Beschriftungen aus dem Modell einblenden"
      >
        <Tag className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={displayOptions.showConstructionProjection}
        onClick={onToggleConstructionProjection}
        title="Projektion unter dem Schnitt — der Boden, auf dem der Grundriss steht"
      >
        <Layers className="h-4 w-4" />
      </ToolButton>
      {/* Disabled rather than hidden when the storey has no rooms: a control
          that comes and goes reads as a bug, and "no rooms on this floor" is
          itself the answer somebody is looking for. */}
      <ToolButton
        active={showRoomLabels}
        onClick={onToggleRoomLabels}
        disabled={roomCount === 0}
        title={
          roomCount === 0
            ? 'Raumbeschriftung — auf diesem Geschoss liegen keine Räume (IfcSpace)'
            : `Raumbeschriftung: Name und Fläche in ${roomCount} ${roomCount === 1 ? 'Raum' : 'Räumen'}`
        }
      >
        {/* A "T", because the button puts TEXT on the plan. */}
        <Type className="h-4 w-4" />
      </ToolButton>
      <ToolButton
        active={showOpeningSymbols}
        onClick={onToggleOpeningSymbols}
        disabled={openingCount === 0}
        title={
          openingCount === 0
            ? 'Tür-/Fenstersymbole — auf diesem Geschoss liessen sich keine ableiten'
            : `Tür-/Fenstersymbole für ${openingCount} Öffnung${openingCount === 1 ? '' : 'en'} — abgeleitet, nicht aus dem Modell gezeichnet`
        }
      >
        {/* A door with its swing — the plan graphic this button draws. */}
        <DoorOpen className="h-4 w-4" />
      </ToolButton>
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
            Monitor den CSS-Pixel einhält — im PDF-Druck dagegen exakt.
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
