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
  Hexagon, Type, Cloud, Trash2, FilePlus2, RotateCw, DoorOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Annotation2DTool } from '@/store';
import { ViewModeToggle } from './ViewportOverlays';

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

  /** Plan rotation, in degrees, for display and direct entry. */
  rotationDeg: number;
  rotationPicking: boolean;
  onToggleRotationPick: () => void;
  onSetRotationDeg: (deg: number) => void;

  zoomPercent: number;
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

function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}

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
    settingsOpen, onToggleSettings, dxfOpen, onToggleDxf,
    activeTool, onSetTool, hasAnnotations, onClearAnnotations,
    canCommitAnnotation, onCommitAnnotation,
    rotationDeg, rotationPicking, onToggleRotationPick, onSetRotationDeg,
    zoomPercent, onZoomIn, onZoomOut, onFitToView,
    onExportSVG, onExportDXF, onPrint, onRegenerate, busy, children,
  } = props;

  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-0.5 rounded-md border bg-background/95 backdrop-blur-sm px-1.5 py-1 shadow-sm">
      {/* The way out of the mode comes first — it is the one control whose
          absence strands you. */}
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
        <DoorOpen className="h-4 w-4" />
      </ToolButton>

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

      {/* Turning the plan. The angle is shown as well as set: a gesture-only
          control leaves the current rotation invisible, and "why is my plan
          crooked" then has no answer on screen. */}
      <ToolButton
        active={rotationPicking}
        onClick={onToggleRotationPick}
        title="Planrotation: eine Linie entlang einem Bauteil ziehen — sie rastet auf die nächste Achse"
      >
        <RotateCw className="h-4 w-4" />
      </ToolButton>
      <input
        type="number"
        step={0.5}
        value={Number.isFinite(rotationDeg) ? Math.round(rotationDeg * 100) / 100 : 0}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value);
          if (Number.isFinite(v)) onSetRotationDeg(v);
        }}
        className="h-6 w-16 rounded-sm border bg-transparent px-1 text-[11px] tabular-nums"
        title="Drehwinkel der Plandarstellung, in Grad"
      />
      <span className="text-[10px] text-muted-foreground">°</span>
      {Math.abs(rotationDeg) > 0.001 && (
        // Labelled, not an icon. A counter-clockwise arrow next to a rotation
        // tool reads as "turn left" — it looks like another way to rotate
        // rather than the way to stop. "0°" says exactly what the button does.
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]"
                    onClick={() => onSetRotationDeg(0)}>
              0°
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Drehung zurücksetzen</TooltipContent>
        </Tooltip>
      )}

      <Divider />

      {/* Navigation */}
      <ToolButton onClick={onZoomOut} title="Verkleinern"><ZoomOut className="h-4 w-4" /></ToolButton>
      <span className="min-w-[3rem] px-1 text-center text-[10px] tabular-nums text-muted-foreground">
        {Math.round(zoomPercent)}%
      </span>
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
    </div>
  );
}

export default PlanToolbar;
