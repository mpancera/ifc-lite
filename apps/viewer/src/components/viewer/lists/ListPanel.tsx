/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ListPanel - Main container for the Lists feature
 *
 * Shows either:
 * - List builder (when creating/editing a list)
 * - List results table (when a list has been executed)
 * - List library (saved lists + presets)
 */

import React, { useCallback, useState, useMemo } from 'react';
import {
  X,
  Plus,
  Play,
  FileSpreadsheet,
  Trash2,
  Download,
  Upload,
  Loader2,
  Table2,
  Pencil,
  Copy,
  PenLine,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import {
  executeList,
  summariseListRows,
  LIST_PRESETS,
  importListDefinition,
  exportListDefinition,
  createListDataProvider,
} from '@/lib/lists';
import type { ListDefinition, ListResult, ListDataProvider, ListGrouping } from '@/lib/lists';
import { withMutationOverlay } from '@/lib/lists/mutationOverlayProvider';
import { GROUP_ENTITY_TYPES } from '@/components/viewer/hierarchy/treeDataBuilder';
import { mergeResultColumns } from '@/lib/lists/merge-result-columns';
import { extractProjectUnits, ProjectUnits, type IfcDataStore } from '@ifc-lite/parser';
import { ListBuilder } from './ListBuilder';
import { ListResultsTable } from './ListResultsTable';

interface ListPanelProps {
  onClose?: () => void;
}

type PanelView = 'library' | 'builder' | 'results';

/**
 * Authored classes that belong in a list even though they have no storey.
 *
 * The group family (zones, systems) plus `IfcSpatialZone`, which our builder
 * deliberately does NOT aggregate into a storey — a compartment spans them.
 */
const NON_SPATIAL_ROW_TYPES: ReadonlySet<string> = new Set([
  ...GROUP_ENTITY_TYPES,
  'IfcSpatialZone',
]);

export function ListPanel({ onClose }: ListPanelProps) {
  const { ifcDataStore, models } = useIfc();
  const [view, setView] = useState<PanelView>('library');
  const [editingList, setEditingList] = useState<ListDefinition | null>(null);

  const listDefinitions = useViewerStore((s) => s.listDefinitions);
  const activeListId = useViewerStore((s) => s.activeListId);
  // Editability follows the global Edit Mode, the same switch the properties
  // panel obeys — one mode, so the two can never disagree about whether this
  // session is authoring.
  const editEnabled = useViewerStore((s) => s.editEnabled);
  const listResult = useViewerStore((s) => s.listResult);
  const listExecuting = useViewerStore((s) => s.listExecuting);
  const addListDefinition = useViewerStore((s) => s.addListDefinition);
  const updateListDefinition = useViewerStore((s) => s.updateListDefinition);
  const deleteListDefinition = useViewerStore((s) => s.deleteListDefinition);
  const setActiveListId = useViewerStore((s) => s.setActiveListId);
  const setListResult = useViewerStore((s) => s.setListResult);
  const setListExecuting = useViewerStore((s) => s.setListExecuting);
  const pendingListDraft = useViewerStore((s) => s.pendingListDraft);
  const setPendingListDraft = useViewerStore((s) => s.setPendingListDraft);

  // Opening the panel highlights "All Elements" without running it.
  //
  // Deliberately not executed: the preset now targets every element in the
  // model — ~19,500 in a real building — and a table that runs itself the
  // moment a panel opens is a brake, not a convenience. Preselecting it makes
  // the everyday case one click instead of a hunt through the library.
  React.useEffect(() => {
    if (activeListId !== null) return;
    const all = LIST_PRESETS.find((preset) => preset.name === 'All Elements');
    if (all) setActiveListId(all.id);
    // Runs once per session; a later selection is the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A draft handed off from "Create list" (search filter) opens straight into
  // the builder for column configuration, then is cleared so it fires once.
  React.useEffect(() => {
    if (!pendingListDraft) return;
    setEditingList(pendingListDraft);
    setView('builder');
    setPendingListDraft(null);
  }, [pendingListDraft, setPendingListDraft]);

  const importInputRef = React.useRef<HTMLInputElement>(null);

  // Zone assignment (issue #1810) is shared across every model's provider —
  // `zoneAssignments` is already keyed by federated global id, so each
  // model's provider just needs ITS OWN `toGlobalId` closure.
  const zoneSets = useViewerStore((s) => s.zoneSets);
  const zoneAssignments = useViewerStore((s) => s.zoneAssignments);
  const zoneApportionment = useViewerStore((s) => s.zoneApportionment);
  const toGlobalId = useViewerStore((s) => s.toGlobalId);

  // Authoring done this session lives in the mutation overlay, not in the
  // parsed store the list provider reads, so each provider is wrapped to merge
  // it (see `withMutationOverlay`). `mutationVersion` bumps on every edit and
  // is what rebuilds the providers so a list re-run reflects the current state.
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  // Build the {modelId, provider} pairs in a single pass so the two
  // arrays can never drift out of alignment (skipping a model without
  // an ifcDataStore must not shift every later model's provider index).
  // Declared VOLUMEUNIT scale per model, for the zone volume columns (#2508).
  // Memoized on the MODELS alone: the zone context below is rebuilt whenever
  // zones or assignments change, and re-extracting a model's unit assignment on
  // every geometry tick would be real work for a value that cannot have moved.
  const volumeScaleByModelId = useMemo(() => {
    const map = new Map<string, number>();
    const scaleOf = (store: IfcDataStore) => (store.source.length > 0
      ? extractProjectUnits(store.source, store.entityIndex).resolvedForUnitType('VOLUMEUNIT')?.siScale ?? 1
      : 1);
    if (models.size > 0) {
      for (const [modelId, model] of models) {
        if (!model.ifcDataStore) continue;
        map.set(modelId, scaleOf(model.ifcDataStore));
      }
    } else if (ifcDataStore) {
      map.set('default', scaleOf(ifcDataStore));
    }
    return map;
  }, [models, ifcDataStore]);

  const modelProviderPairs = useMemo(() => {
    const pairs: Array<{ modelId: string; provider: ListDataProvider; store: IfcDataStore }> = [];
    // Authoring an element also creates its placement/profile/solid/shape-rep
    // entities. Only the product itself is registered against a storey, so
    // that registry is the row filter — the plumbing must not become rows.
    //
    // On its own, though, it also excludes everything that legitimately has no
    // storey: an IfcZone groups rooms and sits nowhere in space, so a zone
    // authored this session never became a row. The class check restores those
    // without letting the plumbing back in (a cartesian point is not a group).
    const overlayFor = (modelId: string, store: IfcDataStore, provider: ListDataProvider) =>
      withMutationOverlay(provider, mutationViews.get(modelId), {
        isRowEntity: (expressId, ifcType) =>
          (store.spatialHierarchy?.elementToStorey.has(expressId) ?? false)
          || NON_SPATIAL_ROW_TYPES.has(ifcType),
      });
    if (models.size > 0) {
      for (const [modelId, model] of models) {
        // Skip native-metadata models — they don't have a parsed
        // IfcDataStore, so the list provider can't query them.
        if (!model.ifcDataStore) continue;
        const zoneContext = {
          zoneSets, zoneAssignments,
          apportionment: zoneApportionment,
          volumeSiScale: volumeScaleByModelId.get(modelId) ?? 1,
          toGlobalId: (expressId: number) => toGlobalId(modelId, expressId),
        };
        const provider = createListDataProvider(model.ifcDataStore, model.name, zoneContext);
        pairs.push({ modelId, provider: overlayFor(modelId, model.ifcDataStore, provider), store: model.ifcDataStore });
      }
    } else if (ifcDataStore) {
      const zoneContext = {
        zoneSets, zoneAssignments,
        apportionment: zoneApportionment,
        volumeSiScale: volumeScaleByModelId.get('default') ?? 1,
        toGlobalId: (expressId: number) => toGlobalId('default', expressId),
      };
      const provider = createListDataProvider(ifcDataStore, '', zoneContext);
      pairs.push({ modelId: 'default', provider: overlayFor('default', ifcDataStore, provider), store: ifcDataStore });
    }
    return pairs;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutationVersion is the edit signal
  }, [models, ifcDataStore, zoneSets, zoneAssignments, zoneApportionment, volumeScaleByModelId, toGlobalId, mutationViews, mutationVersion]);

  const allProviders = useMemo(() => modelProviderPairs.map((p) => p.provider), [modelProviderPairs]);
  const allStores = useMemo(() => modelProviderPairs.map((p) => p.store), [modelProviderPairs]);

  // Every loaded model's declared units, keyed by the same modelId the rows
  // carry (issue #1573 follow-up) — the single per-model source both the
  // on-screen table and the export resolve quantity/measure columns against
  // (`resolveListColumnUnits`), so a federation of models with different
  // declared units converts each row from ITS OWN model's unit rather than
  // assuming every row shares the first model's units.
  const modelUnits = useMemo(() => {
    const map = new Map<string, ProjectUnits>();
    for (const { modelId, store } of modelProviderPairs) {
      map.set(modelId, store.source.length > 0 ? extractProjectUnits(store.source, store.entityIndex) : ProjectUnits.empty());
    }
    return map;
  }, [modelProviderPairs]);

  const hasData = allProviders.length > 0;

  const handleExecuteList = useCallback((definition: ListDefinition) => {
    if (!hasData) return;

    setListExecuting(true);
    setActiveListId(definition.id);
    setEditingList(definition);

    // Use requestAnimationFrame to avoid blocking UI during execution
    requestAnimationFrame(() => {
      try {
        const resultParts: ListResult[] = [];
        for (const { modelId, provider } of modelProviderPairs) {
          resultParts.push(executeList(definition, provider, modelId));
        }

        const allRows = resultParts.flatMap(r => r.rows);
        const totalTime = resultParts.reduce((sum, r) => sum + r.executionTime, 0);

        // Re-derive groups/summary over the merged rows so grouping works
        // across federated models (and isn't dropped on the merge).
        const { groups, summary } = summariseListRows(definition, allRows);

        // Merge each part's execution-time quantityType/dataType onto the
        // columns (P0 fix, #1573 follow-up): `definition.columns` alone never
        // carries them, which silently killed the export unit conversion.
        const columns = mergeResultColumns(resultParts, definition.columns);

        setListResult({
          columns,
          rows: allRows,
          totalCount: allRows.length,
          executionTime: totalTime,
          groups,
          summary,
        });
        setView('results');
      } catch (err) {
        console.error('[Lists] Execution failed:', err);
      } finally {
        setListExecuting(false);
      }
    });
  }, [hasData, modelProviderPairs, setActiveListId, setListResult, setListExecuting]);

  const handleCreateNew = useCallback(() => {
    setEditingList(null);
    setView('builder');
  }, []);

  const handleEdit = useCallback((definition: ListDefinition) => {
    setEditingList(definition);
    setView('builder');
  }, []);

  const handleDuplicate = useCallback((definition: ListDefinition) => {
    const clone: ListDefinition = {
      ...definition,
      id: crypto.randomUUID(),
      name: `${definition.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    addListDefinition(clone);
  }, [addListDefinition]);

  const handleSaveList = useCallback((definition: ListDefinition) => {
    // Check if updating existing or adding new
    const exists = listDefinitions.some(d => d.id === definition.id);
    if (exists) {
      updateListDefinition(definition.id, definition);
    } else {
      addListDefinition(definition);
    }
    setView('library');
  }, [listDefinitions, addListDefinition, updateListDefinition]);

  const handleDelete = useCallback((id: string) => {
    deleteListDefinition(id);
  }, [deleteListDefinition]);

  const handleEditFromResults = useCallback(() => {
    if (editingList) {
      setView('builder');
    }
  }, [editingList]);

  // Grouping/summing changed directly from the results table: update the
  // executed definition (so Settings reflects it), persist if it's saved, and
  // re-derive groups/summary over the current rows for a consistent result.
  const handleGroupingFromTable = useCallback((grouping: ListGrouping | undefined) => {
    const def = editingList;
    if (!def) return;
    const next: ListDefinition = { ...def, grouping };
    setEditingList(next);
    if (listDefinitions.some((d) => d.id === def.id)) {
      updateListDefinition(def.id, { grouping });
    }
    const current = useViewerStore.getState().listResult;
    if (current) {
      const summ = summariseListRows(next, current.rows);
      setListResult({ ...current, groups: summ.groups, summary: summ.summary });
    }
  }, [editingList, listDefinitions, updateListDefinition, setListResult]);

  const handleImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const definition = await importListDefinition(file);
      addListDefinition(definition);
    } catch (err) {
      console.error('[Lists] Import failed:', err);
    }
    e.target.value = '';
  }, [addListDefinition]);

  /** A per-column change made in the results header — persisted to the saved
   *  definition AND to the executed result, so the table repaints without a
   *  re-run it does not need. */
  const handleColumnChangeFromTable = useCallback((columnId: string, updates: Partial<ListDefinition['columns'][number]>) => {
    const current = editingList;
    if (!current) return;
    const columns = current.columns.map((c) => (c.id === columnId ? { ...c, ...updates } : c));
    const next = { ...current, columns };
    setEditingList(next);
    if (listDefinitions.some((d) => d.id === next.id)) updateListDefinition(next.id, { columns });
    const result = useViewerStore.getState().listResult;
    if (result) {
      setListResult({
        ...result,
        columns: result.columns.map((c) => (c.id === columnId ? { ...c, ...updates } : c)),
      });
    }
  }, [editingList, listDefinitions, updateListDefinition, setListResult]);

  const handleExportDefinition = useCallback((definition: ListDefinition) => {
    exportListDefinition(definition);
  }, []);

  /** Whether the open list is one of the user's own, or a built-in template. */
  const isSavedList = !!editingList && listDefinitions.some((d) => d.id === editingList.id);

  /** Delete from the results view returns to the library — the list the view
   *  was showing no longer exists. */
  const handleDeleteFromResults = useCallback(() => {
    if (!editingList) return;
    deleteListDefinition(editingList.id);
    setEditingList(null);
    setView('library');
  }, [editingList, deleteListDefinition]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Table2 className="h-4 w-4" />
          <span className="font-medium text-sm">
            {view === 'library' && 'Lists'}
            {view === 'builder' && (editingList ? 'Edit List' : 'New List')}
            {/* The list's own name, not "Results" — with several lists in play
                the header was the only thing that could say which one is on
                screen, and it said nothing. */}
            {view === 'results' && (editingList?.name || 'Results')}
          </span>
          {view === 'results' && listResult && (
            <span className="text-xs text-muted-foreground">
              ({listResult.totalCount} rows, {listResult.executionTime.toFixed(0)}ms)
            </span>
          )}
          {/* Same pen the properties panel shows beside Attributes in edit
              mode: one signal for "this surface is writable right now". */}
          {view === 'results' && editEnabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <PenLine className="h-3 w-3 text-purple-500" aria-label="Edit mode — Zellen sind bearbeitbar" />
              </TooltipTrigger>
              <TooltipContent>Edit Mode — Zellen sind bearbeitbar</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* The same five commands the library shows on hover, here shown
              permanently: once a list is open they are what you reach for, and
              hunting back through the library to re-run or duplicate it was a
              detour. Delete and Edit are absent for a preset — a template
              cannot be removed or edited in place, only used as a starting
              point (which is what Duplicate does). */}
          {view === 'results' && editingList && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Run list ${editingList.name}`}
                    disabled={!hasData} onClick={() => handleExecuteList(editingList)}>
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run</TooltipContent>
              </Tooltip>
              {isSavedList && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Edit list ${editingList.name}`}
                      onClick={handleEditFromResults}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Edit</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm"
                    aria-label={isSavedList ? `Duplicate list ${editingList.name}` : `Use ${editingList.name} as template`}
                    onClick={() => handleDuplicate(editingList)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isSavedList ? 'Duplicate' : 'Use as Template'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Export list ${editingList.name}`}
                    onClick={() => handleExportDefinition(editingList)}>
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export</TooltipContent>
              </Tooltip>
              {isSavedList && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete list ${editingList.name}`}
                      onClick={handleDeleteFromResults}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Back to Lists" onClick={() => setView('library')}>
                    <ArrowLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Back to Lists</TooltipContent>
              </Tooltip>
            </>
          )}
          {view === 'builder' && (
            <Button variant="ghost" size="sm" onClick={() => setView('library')} className="text-xs h-7">
              Cancel
            </Button>
          )}
          {onClose && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close Lists" onClick={onClose}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Close Lists</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Content */}
      {view === 'library' && (
        <ListLibrary
          definitions={listDefinitions}
          activeListId={activeListId}
          executing={listExecuting}
          hasData={hasData}
          onExecute={handleExecuteList}
          onCreateNew={handleCreateNew}
          onEdit={handleEdit}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          onExport={handleExportDefinition}
          onImport={() => importInputRef.current?.click()}
        />
      )}

      {view === 'builder' && hasData && (
        <ListBuilder
          providers={allProviders}
          stores={allStores}
          initial={editingList}
          onSave={handleSaveList}
          onCancel={() => setView('library')}
          onExecute={handleExecuteList}
        />
      )}

      {view === 'results' && listResult && (
        <ListResultsTable
          result={listResult}
          listName={editingList?.name}
          grouping={editingList?.grouping}
          onGroupingChange={handleGroupingFromTable}
          modelUnits={modelUnits}
          editable={editEnabled}
          onColumnChange={handleColumnChangeFromTable}
        />
      )}

      {/* Hidden import input */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
      />
    </div>
  );
}

// ============================================================================
// List Library Sub-Component
// ============================================================================

interface ListLibraryProps {
  definitions: ListDefinition[];
  activeListId: string | null;
  executing: boolean;
  hasData: boolean;
  onExecute: (def: ListDefinition) => void;
  onCreateNew: () => void;
  onEdit: (def: ListDefinition) => void;
  onDuplicate: (def: ListDefinition) => void;
  onDelete: (id: string) => void;
  onExport: (def: ListDefinition) => void;
  onImport: () => void;
}

function ListLibrary({
  definitions,
  activeListId,
  executing,
  hasData,
  onExecute,
  onCreateNew,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  onImport,
}: ListLibraryProps) {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Actions */}
      <div className="flex items-center gap-1 px-3 py-2 border-b">
        <Button
          variant="outline"
          size="sm"
          onClick={onCreateNew}
          disabled={!hasData}
          className="text-xs h-7"
        >
          <Plus className="h-3 w-3 mr-1" />
          New List
        </Button>
        <Button variant="ghost" size="sm" onClick={onImport} className="text-xs h-7">
          <Upload className="h-3 w-3 mr-1" />
          Import
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* User's saved lists */}
        {definitions.length > 0 && (
          <div className="px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Saved Lists
            </span>
            <div className="mt-1 space-y-1">
              {definitions.map(def => (
                <ListItem
                  key={def.id}
                  definition={def}
                  isActive={activeListId === def.id}
                  executing={executing && activeListId === def.id}
                  hasData={hasData}
                  onExecute={onExecute}
                  onEdit={onEdit}
                  onDuplicate={onDuplicate}
                  onDelete={onDelete}
                  onExport={onExport}
                />
              ))}
            </div>
          </div>
        )}

        {definitions.length > 0 && <Separator className="my-1" />}

        {/* Presets */}
        <div className="px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Templates
          </span>
          <div className="mt-1 space-y-1">
            {LIST_PRESETS.map(preset => (
              <ListItem
                key={preset.id}
                definition={preset}
                isActive={activeListId === preset.id}
                executing={executing && activeListId === preset.id}
                hasData={hasData}
                onExecute={onExecute}
                onDuplicate={onDuplicate}
                isPreset
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// List Item
// ============================================================================

interface ListItemProps {
  definition: ListDefinition;
  isActive: boolean;
  executing: boolean;
  hasData: boolean;
  onExecute: (def: ListDefinition) => void;
  onEdit?: (def: ListDefinition) => void;
  onDuplicate?: (def: ListDefinition) => void;
  onDelete?: (id: string) => void;
  onExport?: (def: ListDefinition) => void;
  isPreset?: boolean;
}

function ListItem({ definition, isActive, executing, hasData, onExecute, onEdit, onDuplicate, onDelete, onExport, isPreset }: ListItemProps) {
  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted/50 ${
        isActive ? 'bg-muted' : ''
      }`}
      onClick={() => hasData && onExecute(definition)}
    >
      <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-xs font-medium">{definition.name}</div>
        {definition.description && (
          <div className="truncate text-xs text-muted-foreground">{definition.description}</div>
        )}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        {executing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (hasData) onExecute(definition);
                  }}
                  disabled={!hasData}
                  aria-label={`Run list ${definition.name}`}
                >
                  <Play className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Run</TooltipContent>
            </Tooltip>
            {!isPreset && onEdit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(definition);
                    }}
                    aria-label={`Edit list ${definition.name}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Edit</TooltipContent>
              </Tooltip>
            )}
            {onDuplicate && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicate(definition);
                    }}
                    aria-label={isPreset ? `Use ${definition.name} as template` : `Duplicate list ${definition.name}`}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isPreset ? 'Use as Template' : 'Duplicate'}</TooltipContent>
              </Tooltip>
            )}
            {!isPreset && onExport && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      onExport(definition);
                    }}
                    aria-label={`Export list ${definition.name}`}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export</TooltipContent>
              </Tooltip>
            )}
            {!isPreset && onDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-6 w-6 hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(definition.id);
                    }}
                    aria-label={`Delete list ${definition.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
  );
}
