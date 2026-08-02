/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Product Library dialog — a bigger, dedicated surface for the element
 * catalog, complementing (not replacing) the Add Element panel's compact
 * picker. Two tabs:
 *   - Firmenbibliothek: browse/import/reset the active catalog.
 *   - Projekt-Produkte: which catalog products are actually placed in the
 *     current model, one row per shared `IfcXxxType`, instances underneath
 *     (see `lib/catalog/projectProducts.ts` for what this does and doesn't
 *     cover yet).
 *
 * A `Dialog` (matching `DataConnector`/`BulkPropertyEditor`'s pattern) so
 * it needs no integration with the workspace-panel registry's per-panel
 * visibility plumbing — self-contained, low-risk to add.
 */

import { useMemo, useState } from 'react';
import { ChevronRight, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useViewerStore } from '@/store';
import { toGlobalIdFromModels } from '@/store/globalId';
import { useCatalogEntries } from '@/lib/catalog';
import { getProjectProducts } from '@/lib/catalog/projectProducts';
import { CatalogImportControls } from './CatalogImportControls';

interface ProductLibraryPanelProps {
  trigger?: React.ReactNode;
}

export function ProductLibraryPanel({ trigger }: ProductLibraryPanelProps) {
  const [open, setOpen] = useState(false);
  const { entries, source, refresh } = useCatalogEntries();

  const activeModelId = useViewerStore((s) => s.activeModelId);
  const models = useViewerStore((s) => s.models);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);
  const setSelectedEntityId = useViewerStore((s) => s.setSelectedEntityId);

  const mutationView = activeModelId ? mutationViews.get(activeModelId) : null;
  // mutationVersion isn't read below, but bumps whenever the overlay
  // changes — the dependency is what keeps this in sync with new placements.
  const products = useMemo(
    () => getProjectProducts(mutationView),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutationView, mutationVersion],
  );

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpanded = (typeId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId); else next.add(typeId);
      return next;
    });
  };

  const selectInstance = (expressId: number) => {
    if (!activeModelId) return;
    const globalId = toGlobalIdFromModels(models, activeModelId, expressId);
    setSelectedEntityId(globalId);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Library className="h-4 w-4 mr-2" />
            Product Library
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
          <DialogTitle>Product Library</DialogTitle>
          <DialogDescription>
            The company element catalog, and which of its products are placed in the current project.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="library" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="mx-6 mt-4 w-fit shrink-0">
            <TabsTrigger value="library" className="font-mono text-xs">Firmenbibliothek</TabsTrigger>
            <TabsTrigger value="products" className="font-mono text-xs">Projekt-Produkte ({products.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="flex-1 overflow-hidden flex flex-col px-6 pb-6 pt-3 gap-3">
            <div className="flex items-center justify-between gap-2">
              <CatalogImportControls source={source} onImported={refresh} />
              <span className="text-[10px] font-mono uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
                {source === 'file-import' ? 'Firmenbibliothek' : 'Example data'} · {entries.length} element{entries.length === 1 ? '' : 's'}
              </span>
            </div>
            <ScrollArea className="flex-1 border rounded-sm border-zinc-200 dark:border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-[10px] uppercase">Label</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Discipline</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Category</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">IFC Mapping</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Mounting</TableHead>
                    <TableHead className="font-mono text-[10px] uppercase">Technical Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-[11px] font-mono text-zinc-500 py-6">
                        No catalog entries.
                      </TableCell>
                    </TableRow>
                  )}
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs">{entry.label}</TableCell>
                      <TableCell className="font-mono text-xs capitalize">{entry.discipline}</TableCell>
                      <TableCell className="font-mono text-xs">{entry.category}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.ifc.entity}{entry.ifc.predefinedType ? `.${entry.ifc.predefinedType}` : ''}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{entry.mounting}</TableCell>
                      <TableCell className="font-mono text-[10px] text-zinc-500">
                        {entry.technicalData && Object.keys(entry.technicalData).length > 0
                          ? Object.entries(entry.technicalData).map(([k, v]) => `${k}=${v}`).join(', ')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="products" className="flex-1 overflow-hidden flex flex-col px-6 pb-6 pt-3 gap-2">
            <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
              Only products placed via the Element Library this session are shown — not every type already in the source file.
            </p>
            <ScrollArea className="flex-1 border rounded-sm border-zinc-200 dark:border-zinc-800">
              {products.length === 0 ? (
                <p className="text-center text-[11px] font-mono text-zinc-500 py-6">
                  No library elements placed in this model yet.
                </p>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-900">
                  {products.map((product) => {
                    const isOpen = expanded.has(product.typeId);
                    return (
                      <div key={product.typeId}>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(product.typeId)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                        >
                          <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-mono text-zinc-900 dark:text-zinc-100">{product.typeName}</span>
                            <span className="block text-[10px] font-mono text-zinc-500 dark:text-zinc-400">
                              {product.ifcType}{product.catalogEntryId ? ` · ${product.catalogEntryId}` : ''}
                            </span>
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                            {product.instances.length} instance{product.instances.length === 1 ? '' : 's'}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="pl-8 pb-2">
                            {product.instances.map((instance) => (
                              <button
                                key={instance.expressId}
                                type="button"
                                onClick={() => selectInstance(instance.expressId)}
                                className="w-full flex items-center gap-2 px-2 py-1 text-left rounded-sm hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-[11px] font-mono text-zinc-700 dark:text-zinc-300"
                              >
                                {instance.name} <span className="text-zinc-400">#{instance.expressId}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
