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
  Eye, EyeOff, Box, Shapes, Tag, Layers, PenTool, FileText, ZoomIn, ZoomOut,
  Maximize2, Download, FileDown, Printer, RefreshCw, MousePointer2, Ruler,
  Hexagon, Type, Cloud, Trash2, MoreHorizontal,
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
    show3DOverlay: boolean;
    useSymbolicRepresentations: boolean;
    showIfcAnnotations: boolean;
    showConstructionProjection: boolean;
  };
  onToggle3DOverlay: () => void;
  onToggleSymbolic: () => void;
  onToggleIfcAnnotations: () => void;
  onToggleConstructionProjection: () => void;

  settingsOpen: boolean;
  onToggleSettings: () => void;
  dxfOpen: boolean;
  onToggleDxf: () => void;

  activeTool: Annotation2DTool;
  onSetTool: (tool: Annotation2DTool) => void;
  hasAnnotations: boolean;
  onClearAnnotations: () => void;

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
    displayOptions, onToggle3DOverlay, onToggleSymbolic, onToggleIfcAnnotations,
    onToggleConstructionProjection, settingsOpen, onToggleSettings, dxfOpen, onToggleDxf,
    activeTool, onSetTool, hasAnnotations, onClearAnnotations,
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
        active={displayOptions.show3DOverlay}
        onClick={onToggle3DOverlay}
        title="3D-Overlay: den Grundriss zusätzlich in der 3D-Szene zeigen"
      >
        {displayOptions.show3DOverlay ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </ToolButton>
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

      <Divider />

      <ToolButton active={settingsOpen} onClick={onToggleSettings} title="Zeichnungseinstellungen">
        <FileText className="h-4 w-4" />
      </ToolButton>
      <ToolButton active={dxfOpen} onClick={onToggleDxf} title="DXF-Unterlagen">
        <PenTool className="h-4 w-4" />
      </ToolButton>

      <Divider />

      {/* Annotation tools. Select/Pan is the resting state rather than a
          separate mode, so it is the tool that is active when no other is. */}
      <ToolButton
        active={activeTool === 'none'}
        onClick={() => onSetTool('none')}
        title="Auswählen und Schwenken"
      >
        <MousePointer2 className="h-4 w-4" />
      </ToolButton>
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
      {hasAnnotations && (
        <ToolButton onClick={onClearAnnotations} title="Alle Anmerkungen löschen">
          <Trash2 className="h-4 w-4" />
        </ToolButton>
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
