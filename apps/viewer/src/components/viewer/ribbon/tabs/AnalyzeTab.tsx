/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · Analyze tab — the workspace panels: validation, comparison,
 * data tables, styling rules, and analysis extensions. Buttons latch to
 * mirror each panel's open state; the single-tenant dock rules live in
 * `useWorkspacePanelControls`, shared with the classic toolbar.
 */

import { Issue, List, Compare, Layer, Clash, Check, Script, Schedule, Coloring } from '@/icons';
// No house icon for a schematic yet — the icon set is drawn for the panels that
// predate it. Borrowed from lucide, as the panel registry does for the same
// reason; worth a matching `@/icons` entry if the Graph earns a second home.
import { Workflow, Box as ZoneBox, Waypoints } from 'lucide-react';
import { useViewerStore } from '@/store';
import { useWorkspacePanelControls } from '../../toolbar/useWorkspacePanelControls';
import {
  RibbonGroup,
  RibbonGroupDivider,
  RibbonLargeButton,
  RibbonSmallButton,
  RibbonSmallStack,
} from '../primitives';

/** Chunk dynamic extension entries into ribbon-height stacks of three. */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function AnalyzeTab() {
  const showSpaceGraph = useViewerStore((s) => s.showSpaceGraph);
  const setShowSpaceGraph = useViewerStore((s) => s.setShowSpaceGraph);
  const {
    activeWorkspacePanels,
    handleToggleBottomPanel,
    handleToggleRightPanel,
    handleToggleAnalysisExtension,
    rightAnalysisExtensions,
    bottomAnalysisExtensions,
  } = useWorkspacePanelControls();

  const analysisExtensions = [...rightAnalysisExtensions, ...bottomAnalysisExtensions];

  return (
    <>
      <RibbonGroup label="Validate">
        <RibbonLargeButton
          icon={Issue}
          label="BCF issues"
          active={activeWorkspacePanels.has('bcf')}
          onClick={() => handleToggleRightPanel('bcf')}
        />
        <RibbonLargeButton
          icon={Check}
          label="IDS check"
          tooltip="IDS validation"
          active={activeWorkspacePanels.has('ids')}
          onClick={() => handleToggleRightPanel('ids')}
        />
        <RibbonLargeButton
          icon={Clash}
          label="Clash"
          tooltip="Clash detection"
          active={activeWorkspacePanels.has('clash')}
          onClick={() => handleToggleRightPanel('clash')}
        />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Compare">
        <RibbonLargeButton
          icon={Compare}
          label="Compare"
          tooltip="Compare models"
          active={activeWorkspacePanels.has('compare')}
          onClick={() => handleToggleRightPanel('compare')}
        />
        <RibbonLargeButton
          icon={Layer}
          label="Layers"
          tooltip="Layer stack"
          active={activeWorkspacePanels.has('layers')}
          onClick={() => useViewerStore.getState().toggleWorkspacePanel('layers')}
        />
        {/* The SAME panel Author → Compartments opens, and it said so nowhere:
            one button called it "Zones" and the other "Compartments", which
            reads as two tools that do different things. The panel's own title
            has been Compartments all along — this follows it.

            Both entries stay: this tab is where a compartment gets looked at,
            the Author tab is where one gets drawn. Zones over ROOMS are a
            different thing again and live on Author → Zones (IfcZone). */}
        <RibbonLargeButton
          icon={ZoneBox}
          label="Compartments"
          tooltip="Abschnitte (Bereiche mit eigenem Körper) ansehen und auswerten — dieselben, die unter Author gezeichnet werden"
          active={activeWorkspacePanels.has('zones')}
          onClick={() => useViewerStore.getState().toggleWorkspacePanel('zones')}
        />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Data">
        <RibbonLargeButton
          icon={List}
          label="Lists"
          tooltip="Entity lists"
          active={activeWorkspacePanels.has('lists')}
          onClick={() => handleToggleBottomPanel('lists')}
        />
        <RibbonLargeButton
          icon={Schedule}
          label="Schedule"
          tooltip="Construction schedule (Gantt)"
          active={activeWorkspacePanels.has('gantt')}
          onClick={() => handleToggleBottomPanel('gantt')}
        />
        <RibbonLargeButton
          icon={Workflow}
          label="Graph"
          tooltip="Schema: Elemente nach ihrer Zugehörigkeit statt nach ihrer Lage — hebt im Modell hervor, was gezeichnet ist"
          active={activeWorkspacePanels.has('graph')}
          onClick={() => handleToggleBottomPanel('graph')}
        />
        <RibbonLargeButton
          icon={Script}
          label="Script"
          tooltip="Script editor"
          active={activeWorkspacePanels.has('script')}
          onClick={() => handleToggleBottomPanel('script')}
        />
        {/* Not a panel — an overlay, in whichever view is on screen. It lives
            in Analyze because it answers a question ABOUT the model rather
            than changing it: is the way out the software found the way out. */}
        <RibbonLargeButton
          icon={Waypoints}
          label="SpatialGraph"
          tooltip="Räume als Punkte, Türen als Linien, dazu die Anzahl Türen bis ins Sichere — die Grundlage von Fluchtwegen und Türnummern, sichtbar gemacht"
          active={showSpaceGraph}
          onClick={() => setShowSpaceGraph(!showSpaceGraph)}
        />
      </RibbonGroup>

      <RibbonGroupDivider />

      <RibbonGroup label="Style">
        <RibbonLargeButton
          icon={Coloring}
          label="Lens"
          tooltip="Lens rules"
          active={activeWorkspacePanels.has('lens')}
          onClick={() => handleToggleRightPanel('lens')}
        />
      </RibbonGroup>

      {/* Analysis panels contributed by installed extensions. Only the
          contributed ANALYSIS panels live here — managing extensions and
          flavors themselves is workspace customization (Author tab). */}
      {analysisExtensions.length > 0 && (
        <>
          <RibbonGroupDivider />
          <RibbonGroup label="Apps">
            {chunk(analysisExtensions, 3).map((column, i) => (
              <RibbonSmallStack key={i}>
                {column.map((extension) => (
                  <RibbonSmallButton
                    key={extension.id}
                    icon={extension.icon}
                    label={extension.label}
                    active={activeWorkspacePanels.has(extension.id)}
                    onClick={() => handleToggleAnalysisExtension(extension.id)}
                  />
                ))}
              </RibbonSmallStack>
            ))}
          </RibbonGroup>
        </>
      )}
    </>
  );
}
