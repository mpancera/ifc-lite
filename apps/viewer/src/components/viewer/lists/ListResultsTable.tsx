/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ListResultsTable — virtualized results grid with in-table grouping &
 * aggregation. The column header is the control surface (sort · group · sum
 * · colour) and every action writes back to the ListDefinition, so the table
 * and the list settings stay in sync. Columns are drag-resizable.
 *
 * PERF: @tanstack/react-virtual renders only visible items (group headers +
 * rows), so 100K+ rows stay smooth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, ArrowDown, ChevronDown, Link2 } from 'lucide-react';
import { useViewerStore } from '@/store';
import { groupingColumnIds, type ListResult, type ListRow, type ColumnDefinition, type ListGrouping } from '@ifc-lite/lists';
import type { ProjectUnits } from '@ifc-lite/parser';
import { exportList, buildExportModel, type ExportFormat } from '@/lib/lists/export';
import { resolveListColumnUnits } from '@/lib/units/list-column-units';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { columnToAutoColor } from '@/lib/lists/columnToAutoColor';
import { AUTO_COLOR_FROM_LIST_ID } from '@/store/slices/lensSlice';
import { rgbaToHex, isGhostColor } from '@ifc-lite/lens';
import { evaluateNativeLens } from '@/lib/lens/native-lens';
import { toGlobalIdFromModels } from '@/store/globalId';
import { isRelationColumn } from '@/lib/lists/editTarget';
import { useListCellEdit } from '@/hooks/useListCellEdit';
import { rangeContains, useEditableListGrid, type EditableListGrid } from './useEditableListGrid';
import { useTranslation } from '@/i18n/useTranslation'; import { ColumnHeaderMenu } from './ColumnHeaderMenu'; import { formatLocaleCount } from './formatLocaleCount';
import { ListResultChrome, ListResultEmptyState } from './ListResultChrome';
import { ListResultsFilters, ListResultsExports } from './ListResultsControls';
import { ListGroupingBar } from './ListGroupingBar';
import { ListScheduleTable } from './ListScheduleTable';
import { ListGroupHeaderRow } from './ListGroupHeaderRow';
import { useListRowSelection } from './useListRowSelection';
import { useListVisibilityActions } from './useListVisibilityActions';
import { useVisibleListRows } from './useVisibleListRows';
import { ColumnResizeHandle } from './ColumnResizeHandle';
import { formatCellValue, compareCells, detectNumericColumns, autoColumnWidth,
  buildGroupedView, flatTotals, buildScheduleRows, rebuildGrouping,
  type DisplayItem, type Totals, type ScheduleRow } from './list-table-utils';
interface ListResultsTableProps {
  result: ListResult;
  /** List name — used as the export title / filename. */
  listName?: string;
  /** Active grouping from the executed definition (table ↔ settings sync). */
  grouping?: ListGrouping;
  /** Persist a grouping change made from the table back to the definition. */
  onGroupingChange?: (grouping: ListGrouping | undefined) => void;
  /** Per-model declared units (issue #1573 follow-up), keyed by the same
   *  `modelId` every `ListRow` carries — lets quantity/measure columns
   *  render (and export) CONVERTED into one resolved target unit via
   *  `resolveListColumnUnits`, the same resolver `buildExportModel` uses, so
   *  the on-screen table and the export can never disagree. */
  modelUnits: Map<string, ProjectUnits>;
  /** Turn the grid into a spreadsheet: cells become typeable, copy/paste works,
   *  and committed values are written to the mutation overlay. */
  editable?: boolean;
  /** Persist a per-column change made from the header menu (currently: which
   *  lens a `colour` column paints with). */
  onColumnChange?: (columnId: string, updates: Partial<ColumnDefinition>) => void;
}

export function ListResultsTable({ result, listName, grouping, onGroupingChange, modelUnits, editable = false, onColumnChange }: ListResultsTableProps) {
  const { t, locale } = useTranslation(); const unitDisplayOverrides = useViewerStore((s) => s.unitDisplayOverrides);
  const parentRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // A list answers its own filter, not the viewport's.
  //
  // This defaulted to ON, which quietly made every list a view of what happens
  // to be on screen: with a storey soloed, "All Elements" over ~19,500 entities
  // returned 392 rows, and turning the Rooms visibility off emptied a room
  // schedule outright. A schedule that silently omits what it was asked for is
  // worse than a long one — and the toggle is still here for anyone who wants
  // the viewport-linked reading deliberately.
  const [filterByVisibility, setFilterByVisibility] = useState(false);
  const [colorByColIdx, setColorByColIdx] = useState<number | null>(null);
  const [widthOverrides, setWidthOverrides] = useState<Record<string, number>>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const activateAutoColorFromColumn = useViewerStore((s) => s.activateAutoColorFromColumn);
  const activeLensId = useViewerStore((s) => s.activeLensId);

  const visibilityActions = useListVisibilityActions();

  const columns = result.columns;
  const numericCols = useMemo(() => detectNumericColumns(columns, result.rows), [columns, result.rows]);
  /** Columns whose value is reached through an IFC relationship — marked with a
   *  chain link and muted, header and cells alike, so it reads as "shown here,
   *  changed elsewhere". */
  const relationCols = useMemo(() => columns.map((c) => isRelationColumn(c)), [columns]);

  // ── Colour columns ──
  // A `colour` column carries no value; it paints the colour a lens gives the
  // row in 3D, so the table and the model agree at a glance. Empty by default:
  // with no lens active there is nothing to show, which is the honest state
  // rather than an invented palette.
  const colourColumns = useMemo(
    () => columns.map((c) => (c.source === 'colour' ? (c.propertyName || '') : null)),
    [columns]);
  const savedLenses = useViewerStore((s) => s.savedLenses);
  const lensColorMap = useViewerStore((s) => s.lensColorMap);
  const models = useViewerStore((s) => s.models);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  /**
   * Colour maps keyed by lens id, for columns pinned to a specific saved lens.
   *
   * The active lens already publishes its map to the store; a pinned one has to
   * be evaluated here. Evaluating is a pure call on the same provider the lens
   * panel uses, so a pinned column shows exactly what activating that lens
   * would show.
   */
  const [pinnedColourMaps, setPinnedColourMaps] = useState<Map<string, Map<number, string>>>(() => new Map());
  useEffect(() => {
    const wanted = new Set(colourColumns.filter((id): id is string => !!id));
    if (wanted.size === 0) { setPinnedColourMaps(new Map()); return; }
    const controller = new AbortController();
    void (async () => {
      const maps = new Map<string, Map<number, string>>();
      for (const lensId of wanted) {
        const lens = savedLenses.find((l) => l.id === lensId);
        if (!lens) continue;
        try {
          // Upstream's native evaluation, so a pinned column shows exactly
          // what activating that lens would show.
          const { result } = await evaluateNativeLens(lens, controller.signal);
          const hex = new Map<number, string>();
          for (const [id, rgba] of result.colorMap) {
            if (!isGhostColor(rgba)) hex.set(id, rgbaToHex(rgba));
          }
          maps.set(lensId, hex);
        } catch {
          if (controller.signal.aborted) return;
        }
      }
      if (!controller.signal.aborted) setPinnedColourMaps(maps);
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutationVersion is the edit signal
  }, [colourColumns, savedLenses, mutationVersion]);

  // Single per-column unit resolution (issue #1573 follow-up), shared with
  // `buildExportModel` so the table and the export can never disagree.
  const unitResolver = useMemo(
    () => resolveListColumnUnits(columns, modelUnits, unitDisplayOverrides),
    [columns, modelUnits, unitDisplayOverrides],
  );

  // "Visible only" — ignoring the list's own isolation (#6368).
  const visibilityFilteredRows = useVisibleListRows(result.rows, filterByVisibility);

  const filteredRows = useMemo(() => {
    if (!searchQuery) return visibilityFilteredRows;
    const q = searchQuery.toLowerCase();
    return visibilityFilteredRows.filter((row) =>
      row.values.some((v) => v !== null && String(v).toLowerCase().includes(q)));
  }, [visibilityFilteredRows, searchQuery]);

  // Sorts on the RAW value (single-model monotonic either way; a federated
  // column mixing declared units sorts by each row's pre-conversion number —
  // pre-existing, units aren't resolved per-row for sorting).
  const sortedRows = useMemo(() => {
    if (sortCol === null) return filteredRows;
    return [...filteredRows].sort((a, b) =>
      compareCells(a.values[sortCol], b.values[sortCol]) * (sortDir === 'asc' ? 1 : -1));
  }, [filteredRows, sortCol, sortDir]);

  // Rows as DISPLAYED (converted via `unitResolver`) — cell rendering, group
  // subtotals, and the grand-totals row all agree with the export (#1573).
  const displayRows = useMemo(
    () => sortedRows.map((r) => ({ ...r, values: r.values.map((v, i) => unitResolver.convertCell(i, v, r.modelId)) })),
    [sortedRows, unitResolver],
  );

  // ── Grouping / aggregation derived from the definition ──
  // Multi-criteria grouping (issue #1790): ordered group-by columns,
  // outermost first, restricted to columns that actually exist in the result.
  const groupColumnIds = useMemo(
    () => groupingColumnIds(grouping).filter((id) => columns.some((c) => c.id === id)),
    [grouping, columns]);
  const sumColumnIds = useMemo(() => grouping?.sumColumnIds ?? [], [grouping]);
  const isGrouped = groupColumnIds.length > 0;
  const groupChips = useMemo(
    () => groupColumnIds.map((id) => {
      const c = columns.find((c) => c.id === id);
      return { id, label: c ? (c.label ?? c.propertyName) : id };
    }),
    [groupColumnIds, columns]);
  const sumChips = useMemo(
    () => sumColumnIds.map((id) => {
      const c = columns.find((c) => c.id === id);
      return { id, label: c ? (c.label ?? c.propertyName) : id };
    }),
    [sumColumnIds, columns]);
  const showSumRow = sumColumnIds.length > 0;

  // Result presentation (issue #1790 round 2): `schedule` swaps the nested
  // collapsible tree for a Bonsai-style pivot table — one row per group-value
  // tuple, grouping columns first, then a first-class Count column, then any
  // configured sums. Only meaningful once grouped.
  const scheduleMode = isGrouped && grouping?.view === 'schedule';
  const scheduleRows = useMemo<ScheduleRow[]>(() => {
    if (!scheduleMode) return [];
    const sort = sortCol === null ? null : { colIdx: sortCol, dir: sortDir };
    return buildScheduleRows(
      displayRows, columns,
      { columnId: groupColumnIds[0], columnIds: groupColumnIds, sumColumnIds },
      sort,
    );
  }, [scheduleMode, displayRows, columns, groupColumnIds, sumColumnIds, sortCol, sortDir]);
  // The pivot header/body/footer live in `ListScheduleTable` — see the note
  // there on role-qualified column keys.

  const handleViewChange = useCallback((next: 'nested' | 'schedule') => {
    if (!onGroupingChange || !grouping) return;
    onGroupingChange({ ...grouping, view: next });
  }, [onGroupingChange, grouping]);

  const { items, groupCount, totals, groupKeys } = useMemo<{
    items: DisplayItem[]; groupCount: number; totals: Totals; groupKeys: string[];
  }>(() => {
    if (isGrouped) {
      const sort = sortCol === null ? null : { colIdx: sortCol, dir: sortDir };
      const view = buildGroupedView(
        displayRows, columns,
        { columnId: groupColumnIds[0], columnIds: groupColumnIds, sumColumnIds },
        expandedGroups, sort,
      );
      return { items: view.items, groupCount: view.groupCount, totals: view.totals, groupKeys: view.groupKeys };
    }
    return {
      items: displayRows.map((row): DisplayItem => ({ kind: 'row', row })),
      groupCount: 0,
      totals: flatTotals(displayRows, columns, sumColumnIds),
      groupKeys: [],
    };
  }, [isGrouped, displayRows, columns, groupColumnIds, sumColumnIds, expandedGroups, sortCol, sortDir]);

  // ── Editable mode ──
  // Addressing is by ROW index over the rows only: `items` interleaves group
  // headers, and a paste that counted those would land its values one row off
  // for every group it crossed.
  const { editRows, rowIdxOfItem } = useMemo(() => {
    const rows: ListRow[] = [];
    const perItem = new Array<number>(items.length).fill(-1);
    items.forEach((item, i) => {
      if (item.kind !== 'row') return;
      perItem[i] = rows.length;
      rows.push(item.row);
    });
    return { editRows: rows, rowIdxOfItem: perItem };
  }, [items]);

  const { commitCell } = useListCellEdit();
  const displayedValue = useCallback((rowIdx: number, colIdx: number) => {
    const row = editRows[rowIdx];
    if (!row) return null;
    const patched = gridRef.current?.patchFor(row, colIdx);
    return patched !== undefined ? patched : row.values[colIdx];
    // `gridRef` is filled in immediately below; reading it through a ref keeps
    // this callback out of the hook's own dependency cycle.
  }, [editRows]);

  /** Point a colour column at a specific saved lens, or back at the active one.
   *  Written to the definition so the choice survives with the list. */
  const handlePinLens = useCallback((col: ColumnDefinition, lensId: string) => {
    if (!onGroupingChange) return;
    // `onGroupingChange` is the table's only channel back to the definition;
    // the column edit rides along with the grouping it already persists.
    onColumnChange?.(col.id, { propertyName: lensId });
  }, [onGroupingChange, onColumnChange]);

  const grid = useEditableListGrid({ enabled: editable, rows: editRows, columns, displayedValue, commitCell });
  const gridRef = useRef<EditableListGrid | null>(null);
  gridRef.current = grid;

  // A fill drag is tracked on the WINDOW, by hit-testing the row under the
  // pointer, rather than by each cell reporting that the mouse entered it.
  // Per-cell hover misses a fast drag that skips between cells, and stops
  // reporting entirely once the pointer leaves the row area — which is exactly
  // where someone drags when they mean "all the way down". The release is
  // caught here too, since a drag can end anywhere.
  useEffect(() => {
    if (!editable) return;
    const rowUnder = (x: number, y: number): number | null => {
      const el = document.elementFromPoint(x, y);
      const cell = el?.closest<HTMLElement>('[data-fill-row]');
      if (!cell) return null;
      const idx = Number(cell.dataset.fillRow);
      return Number.isInteger(idx) ? idx : null;
    };
    const onMove = (event: MouseEvent) => {
      if (!gridRef.current?.isFillDragActive()) return;
      const rowIdx = rowUnder(event.clientX, event.clientY);
      if (rowIdx !== null) gridRef.current.extendFill(rowIdx);
    };
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.('[data-fill-handle]')) return;
      event.preventDefault();
      event.stopPropagation();
      gridRef.current?.beginFill();
    };
    const onUp = () => gridRef.current?.endFill();
    // Capture, so the drag starts before whichever ancestor swallows mousedown.
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [editable]);

  const columnWidths = useMemo(
    () => columns.map((c, i) => widthOverrides[c.id] ?? autoColumnWidth(c.label ?? c.propertyName, result.rows, i)),
    [columns, widthOverrides, result.rows]);
  const totalWidth = useMemo(() => columnWidths.reduce((a, b) => a + b, 0), [columnWidths]);

  const virtualizer = useVirtualizer({
    count: scheduleMode ? scheduleRows.length : items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (scheduleMode ? 28 : (items[i]?.kind === 'group' ? 30 : 28)),
    overscan: 18,
    getItemKey: (i) => {
      if (scheduleMode) return `s:${scheduleRows[i]?.key ?? i}`;
      const it = items[i];
      if (it?.kind === 'group') return `g:${it.key}`;
      const r = (it as { row: ListRow }).row;
      return `r:${r.modelId}:${r.entityId}:${i}`;
    },
  });

  // ── Handlers ──
  const handleHeaderClick = useCallback((colIndex: number) => {
    setSortCol((prev) => {
      if (prev === colIndex) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return prev; }
      setSortDir('asc'); return colIndex;
    });
  }, []);

  const handleColorByColumn = useCallback((col: ColumnDefinition, colIdx: number) => {
    activateAutoColorFromColumn(columnToAutoColor(col), col.label ?? col.propertyName);
    setColorByColIdx(colIdx);
  }, [activateAutoColorFromColumn]);

  // Toggling a column in/out of the grouping: a second (third, …) column adds
  // a nesting level (multi-criteria grouping, issue #1790). `columnId` is kept
  // in sync with the first level for pre-multi-level consumers. `rebuildGrouping`
  // spreads the previous grouping so fields it doesn't touch — `view`, issue
  // #1790 round 2 — survive instead of silently resetting (bug found in QA:
  // removing a grouping level or toggling a sum column used to drop the
  // active schedule view back to nested).
  const toggleGroupBy = useCallback((colId: string) => {
    if (!onGroupingChange) return;
    const next = groupColumnIds.includes(colId)
      ? groupColumnIds.filter((x) => x !== colId)
      : [...groupColumnIds, colId];
    onGroupingChange(rebuildGrouping(grouping, next, sumColumnIds));
  }, [onGroupingChange, grouping, groupColumnIds, sumColumnIds]);

  const toggleSum = useCallback((colId: string) => {
    if (!onGroupingChange) return;
    const next = sumColumnIds.includes(colId) ? sumColumnIds.filter((x) => x !== colId) : [...sumColumnIds, colId];
    onGroupingChange(rebuildGrouping(grouping, groupColumnIds, next));
  }, [onGroupingChange, grouping, groupColumnIds, sumColumnIds]);

  const toggleGroupExpand = useCallback((key: string) => {
    setExpandedGroups((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);
  const allExpanded = groupKeys.length > 0 && groupKeys.every((k) => expandedGroups.has(k));
  const toggleExpandAll = useCallback(() => {
    setExpandedGroups(allExpanded ? new Set() : new Set(groupKeys));
  }, [allExpanded, groupKeys]);

  // Export honours the on-screen columns, grouping, sums, and totals.
  const handleExport = useCallback((format: ExportFormat) => {
    const model = buildExportModel({
      title: listName?.trim() || t('lists.resultsTable.defaultTitle'),
      columns,
      rows: sortedRows,
      grouping,
      sort: sortCol === null ? null : { colIdx: sortCol, dir: sortDir },
      numericCols,
      columnWidths,
      generatedAt: new Date().toLocaleString(),
      modelUnits,
      unitDisplayOverrides,
    });
    void exportList(format, model).catch((error) => {
      console.error('[Lists] export failed:', error);
      toast.error(t('lists.resultsTable.exportFailed', { message: error instanceof Error ? error.message : 'Unknown error' }));
    });
  }, [listName, columns, sortedRows, grouping, sortCol, sortDir, numericCols, columnWidths, modelUnits, unitDisplayOverrides, t]);
  // Every rendered line's member rows, in the virtualizer's index space: a
  // group header selects its whole subtree, a schedule row its tuple (#6368).
  const selectionLines = useMemo<ListRow[][]>(
    () => (scheduleMode ? scheduleRows.map((r) => r.rows) : items.map((it) => (it.kind === 'group' ? it.rows : [it.row]))),
    [scheduleMode, scheduleRows, items]);
  const selection = useListRowSelection(selectionLines, scheduleMode ? 'schedule' : 'nested');

  // Asked for from elsewhere — the command palette, a screenflow — through the
  // same consumed-once handoff the role dialog uses. The model can only be
  // built here, from what is actually on screen; a second builder somewhere
  // else would drift from the table it claims to export.
  const exportRequested = useViewerStore((s) => s.listExportRequested);
  const requestListExport = useViewerStore((s) => s.requestListExport);
  useEffect(() => {
    if (!exportRequested) return;
    handleExport(exportRequested);
    requestListExport(null);
  }, [exportRequested, handleExport, requestListExport]);

  return (
    <ListResultChrome result={result} visibleCount={sortedRows.length}
      filters={<ListResultsFilters searchQuery={searchQuery} onSearch={setSearchQuery} visibleOnly={filterByVisibility}
        onToggleVisible={() => setFilterByVisibility(value => !value)} count={sortedRows.length} total={result.rows.length} />}
      actions={<ListResultsExports onExport={handleExport} />}>
      {/* Grouping / totals control strip */}
      {(isGrouped || showSumRow) && onGroupingChange && (
        <ListGroupingBar
          groups={groupChips}
          sums={sumChips}
          groupCount={groupCount}
          count={totals.count}
          allExpanded={allExpanded}
          onRemoveGroup={(id) => toggleGroupBy(id)}
          onRemoveSum={(id) => toggleSum(id)}
          onToggleExpandAll={toggleExpandAll}
          view={isGrouped ? (grouping?.view ?? 'nested') : undefined}
          onViewChange={isGrouped ? handleViewChange : undefined}
        />
      )}

      {/* A refusal or a paste summary. Dismissible, and replaced rather than
          stacked — only the most recent one is actionable. */}
      {editable && grid.notice && (
        <div
          className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-900 dark:text-amber-200"
          role="status"
        >
          <span className="flex-1">{grid.notice}</span>
          <button className="shrink-0 underline" onClick={grid.clearNotice}>schliessen</button>
        </div>
      )}

      {/* Table */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto min-h-0"
        // The grid owns arrows, Enter, Delete and printable keys while a cell
        // is active; `tabIndex` is what lets it receive them at all.
        tabIndex={editable ? 0 : undefined}
        onKeyDown={editable ? (e) => { if (grid.handleKeyDown(e)) e.stopPropagation(); } : undefined}
        onCopy={editable ? grid.handleCopy : undefined}
        onPaste={editable ? grid.handlePaste : undefined}
      >
      {sortedRows.length === 0 && <ListResultEmptyState result={result} />}
      {scheduleMode ? (
        <ListScheduleTable
          scheduleRows={scheduleRows}
          groupChips={groupChips}
          sumChips={sumChips}
          columns={columns}
          sortCol={sortCol}
          sortDir={sortDir}
          totals={totals}
          widthOverrides={widthOverrides}
          setWidthOverrides={setWidthOverrides}
          onHeaderClick={handleHeaderClick}
          virtualizer={virtualizer}
          isRowSelected={selection.isSelected}
          onRowActivate={selection.activate}
          rowVisibility={(i) => visibilityActions.activeChannel(scheduleRows[i]?.key ?? '')}
          onRowVisibilityAction={(i, channel) => { const r = scheduleRows[i]; if (r) visibilityActions.run(r.key, r.rows, channel); }}
        />
      ) : (
        <div style={{ minWidth: totalWidth }}>
          {/* Header */}
          <div className="flex sticky top-0 z-10 bg-muted/80 backdrop-blur-sm border-b">
            {columns.map((col, colIdx) => {
              const colored = activeLensId === AUTO_COLOR_FROM_LIST_ID && colorByColIdx === colIdx;
              const groupLevel = groupColumnIds.indexOf(col.id);
              const groupedBy = groupLevel >= 0;
              const summed = sumColumnIds.includes(col.id);
              const unit = unitResolver.unitSymbol(colIdx);
              // Columns reached through a relationship are marked and muted the
              // way the properties panel mutes relationship-derived content: the
              // value is real, but it is not edited here.
              const viaRelation = relationCols[colIdx];
              return (
                <div
                  key={col.id}
                  className={cn(
                    'group/col relative flex items-center gap-0.5 border-r border-border/50 px-2 py-1.5 text-xs font-medium text-muted-foreground shrink-0',
                    colored && 'bg-primary/10',
                    (groupedBy || summed) && 'text-foreground',
                    viaRelation && !groupedBy && !summed && !colored
                      && 'bg-muted/60 text-muted-foreground/70',
                  )}
                  style={{ width: columnWidths[colIdx] }}
                >
                  <button className="flex min-w-0 flex-1 items-center gap-1 hover:text-foreground" onClick={() => handleHeaderClick(colIdx)}>
                    {groupedBy && <ChevronDown className="h-3 w-3 shrink-0 text-primary" aria-label={t('lists.resultsTable.groupedAriaLabel')} />}
                    {groupedBy && groupColumnIds.length > 1 && (
                      <span className="shrink-0 text-2xs font-semibold tabular-nums text-primary" aria-label={t('lists.resultsTable.groupingLevelAriaLabel', { level: groupLevel + 1 })}>
                        {groupLevel + 1}
                      </span>
                    )}
                    {viaRelation && (
                      <Link2
                        className="h-3 w-3 shrink-0 opacity-70"
                        aria-label="über eine Beziehung ermittelt"
                      />
                    )}
                    <span className="truncate">{col.label ?? col.propertyName}{unit ? ` (${unit})` : ''}</span>
                    {summed && <span className="text-primary">{t('lists.resultsTable.sumIcon')}</span>}
                    {sortCol === colIdx && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />)}
                  </button>
                  {onGroupingChange && (
                    <ColumnHeaderMenu
                      isNumeric={numericCols[colIdx]}
                      isGroupedBy={groupedBy}
                      groupedElsewhere={isGrouped && !groupedBy}
                      isSummed={summed}
                      active={groupedBy || summed || colored}
                      onSort={(dir) => { setSortCol(colIdx); setSortDir(dir); }}
                      onToggleGroup={() => toggleGroupBy(col.id)}
                      onToggleSum={() => toggleSum(col.id)}
                      onColorBy={() => handleColorByColumn(col, colIdx)}
                      lensOptions={colourColumns[colIdx] !== null
                        ? savedLenses.map((l) => ({ id: l.id, name: l.name }))
                        : undefined}
                      pinnedLensId={colourColumns[colIdx] ?? undefined}
                      onPinLens={colourColumns[colIdx] !== null
                        ? (lensId) => handlePinLens(col, lensId)
                        : undefined}
                    />
                  )}
                  <ColumnResizeHandle
                    columnId={col.id}
                    width={columnWidths[colIdx]}
                    title={`${col.label ?? col.propertyName}: ${t('lists.resultsTable.dragToResizeTitle')}`}
                    setWidthOverrides={setWidthOverrides}
                  />
                </div>
              );
            })}
          </div>
          {/* Virtualized rows / group headers */}
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const item = items[vRow.index];
              if (!item) return null;
              const transform = `translateY(${vRow.start}px)`;

              if (item.kind === 'group') {
                return (
                  <ListGroupHeaderRow
                    key={vRow.key}
                    item={item}
                    expanded={expandedGroups.has(item.key)}
                    selected={selection.isSelected(vRow.index)}
                    columns={columns}
                    columnWidths={columnWidths}
                    sumColumnIds={sumColumnIds}
                    transform={transform}
                    onToggleExpand={toggleGroupExpand}
                    onSelect={(modifiers) => selection.activate(vRow.index, modifiers)}
                    visibility={visibilityActions.activeChannel(item.key)}
                    onVisibilityAction={(channel) => visibilityActions.run(item.key, item.rows, channel)}
                  />
                );
              }

              const row = item.row;
              const globalId = toGlobalIdFromModels(models, row.modelId, row.entityId);
              const rowIdx = rowIdxOfItem[vRow.index];
              const isSelected = selection.isSelected(vRow.index);
              // Cast: both tags take the same handlers; `type` only reaches the button.
              const RowTag = (editable ? 'div' : 'button') as 'button';
              return (
                // Fork: an editable list renders a div with the button role, so an open
                // cell editor (an input) can sit inside the row; otherwise a real button.
                <RowTag
                  key={vRow.key}
                  {...(editable ? { role: 'button', tabIndex: 0 } : { type: 'button' as const })}
                  aria-pressed={isSelected}
                  className={cn('absolute left-0 top-0 flex w-full cursor-pointer select-none border-b border-border/30 text-left hover:bg-muted/40', isSelected && 'bg-primary/10')}
                  style={{ transform }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selection.activate(vRow.index, event); }
                  }}
                  onClick={(e) => selection.activate(vRow.index, e)}
                >
                  {row.values.map((value, colIdx) => {
                    // A colour column has no text — the cell IS the swatch.
                    const colourLensId = colourColumns[colIdx];
                    const swatch = colourLensId === null ? undefined : (
                      colourLensId === ''
                        ? lensColorMap.get(globalId)
                        : pinnedColourMaps.get(colourLensId)?.get(globalId)
                    );
                    // A patch is the raw text the user committed; the executed
                    // value keeps its engine type until the next Run.
                    const patched = editable ? grid.patchFor(row, colIdx) : undefined;
                    const shown = patched !== undefined ? String(patched) : value;
                    const isActive = editable && grid.active?.rowIdx === rowIdx
                      && grid.active?.colIdx === colIdx;
                    const isOpen = isActive && grid.editing;
                    const inRange = editable && !isActive
                      && rangeContains(grid.range, rowIdx, colIdx);
                    const inFill = editable && rangeContains(grid.fillPreview, rowIdx, colIdx);
                    // The handle hangs off the bottom-right cell of the
                    // selection, and only where dragging could write anything.
                    const showFillHandle = editable && grid.range
                      && grid.range.toRow === rowIdx && grid.range.toCol === colIdx
                      && grid.editableColumns[colIdx] && !isOpen;
                    return (
                      <div
                        key={colIdx}
                        className={cn(
                          'border-r border-border/20 px-2 py-1 text-xs truncate shrink-0',
                          numericCols[colIdx] && 'text-right font-mono tabular-nums',
                          relationCols[colIdx] && 'bg-muted/40 text-muted-foreground',
                          // An edited cell stays marked until the next Run, so
                          // what you changed is visible among what you did not.
                          // Purple is what the properties panel uses for a
                          // mutated value; one colour for "you changed this".
                          patched !== undefined && 'bg-purple-50/50 dark:bg-purple-950/30 text-purple-900 dark:text-purple-100',
                          inRange && 'bg-primary/10',
                          inFill && 'bg-primary/5 ring-1 ring-inset ring-primary/40',
                          isActive && !isOpen && 'ring-1 ring-inset ring-primary',
                          showFillHandle && 'relative',
                          editable && grid.editableColumns[colIdx] && 'cursor-text',
                        )}
                        // Member rows sit one indent step past the deepest group header.
                        style={{
                          width: columnWidths[colIdx],
                          ...(isGrouped && colIdx === 0 ? { paddingLeft: 8 + groupColumnIds.length * 16 } : undefined),
                          ...(swatch ? { backgroundColor: swatch } : undefined),
                        }}
                        title={colourLensId !== null
                          ? (swatch ?? 'Keine Lens-Farbe für dieses Bauteil')
                          : (shown !== null && shown !== undefined ? String(shown) : '')}
                        onClick={editable ? (e) => {
                          e.stopPropagation();
                          // Shift-click extends the selection, so it must not
                          // also re-select the row in the 3D view.
                          if (!e.shiftKey) selection.activate(vRow.index, e);
                          grid.selectCell({ rowIdx, colIdx }, e.shiftKey);
                        } : undefined}
                        onDoubleClick={editable ? (e) => { e.stopPropagation(); grid.beginEdit({ rowIdx, colIdx }); } : undefined}
                        data-fill-row={editable ? rowIdx : undefined}
                      >
                        {isOpen ? (
                          <input
                            autoFocus
                            className="w-full bg-background outline-none ring-1 ring-primary px-0.5 text-xs"
                            value={grid.draft ?? ''}
                            onChange={(e) => grid.setDraft(e.target.value)}
                            onBlur={(e) => grid.commitDraft(e.target.value, 'none')}
                            onClick={(e) => e.stopPropagation()}
                            // The open editor owns these keys; the container
                            // handler stands down while a cell is open, so one
                            // keystroke can never be committed twice.
                            onKeyDown={(e) => {
                              if (e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape') return;
                              e.preventDefault();
                              e.stopPropagation();
                              if (e.key === 'Escape') grid.cancelEdit();
                              else grid.commitDraft(e.currentTarget.value, e.key === 'Tab' ? 'right' : 'down');
                            }}
                          />
                        ) : colourLensId !== null ? null : formatCellValue(shown)}
                        {showFillHandle && (
                          <span
                            role="button"
                            aria-label="Wert nach unten ausfüllen"
                            title="Nach unten ziehen, um den Wert zu wiederholen"
                            // Inside the cell box, not overhanging it: the cell
                            // clips (`truncate` is overflow-hidden), so a handle
                            // sitting proud of the corner is invisible AND
                            // unclickable — the mousedown lands on the row behind.
                            className="absolute bottom-0 right-0 h-2 w-2 cursor-crosshair rounded-[1px] bg-primary ring-1 ring-background"
                            // The drag starts from a window-level capture
                            // listener (see the effect above), not from a
                            // handler here: an ancestor consumes mousedown
                            // during CAPTURE, before it can reach this element
                            // at all, so nothing bound at the target would run.
                            data-fill-handle=""
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </div>
                    );
                  })}
                </RowTag>
              );
            })}
          </div>
          {/* Grand-totals footer (sticky, aligned under columns) */}
          {showSumRow && (
            <div className="flex sticky bottom-0 z-10 border-t-2 border-border bg-muted/90 backdrop-blur-sm">
              {columns.map((col, colIdx) => (
                <div key={col.id} className="flex items-center border-r border-border/30 px-2 py-1 text-xs font-semibold shrink-0" style={{ width: columnWidths[colIdx] }}>
                  {colIdx === 0 && <span className="text-muted-foreground">{t('lists.resultsTable.totalCount', { count: formatLocaleCount(totals.count, locale) })}</span>}
                  {sumColumnIds.includes(col.id) && (
                    <span className="ml-auto font-mono tabular-nums text-foreground">{formatCellValue(totals.sums[col.id])}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </div>
    </ListResultChrome>
  );
}
