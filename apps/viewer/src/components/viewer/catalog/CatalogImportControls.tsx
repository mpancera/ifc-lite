/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * "Import Firmenbibliothek (JSON)" / "Reset" controls — shared between the
 * Add Element panel's compact library browser and the bigger Product
 * Library dialog so the import behaviour only lives in one place.
 */

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { fileImportProvider } from '@/lib/catalog';

export interface CatalogImportControlsProps {
  source: 'file-import' | 'local-seed';
  onImported: () => void;
  className?: string;
}

export function CatalogImportControls({ source, onImported, className }: CatalogImportControlsProps) {
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const result = await fileImportProvider.importFromFile(file);
      onImported();
      if (result.errors.length > 0) {
        toast.error(`Imported ${result.entries.length} element(s), skipped ${result.errors.length} invalid row(s) — see console.`);
        console.warn('[catalog import] skipped rows:', result.errors);
      } else {
        toast.success(`Imported ${result.entries.length} element(s) into the library.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to import catalog file.');
    } finally {
      setImporting(false);
    }
  };

  const handleResetToSeed = async () => {
    await fileImportProvider.clear();
    onImported();
    toast.info('Reverted to the built-in example library.');
  };

  return (
    <div className={['flex gap-1', className].filter(Boolean).join(' ')}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleImportFile(file);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={importing}
        onClick={() => fileInputRef.current?.click()}
        className="h-7 text-[10px] font-mono gap-1"
      >
        <Upload className="h-3 w-3" />
        {importing ? 'Importing…' : 'Import Firmenbibliothek (JSON)'}
      </Button>
      {source === 'file-import' && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void handleResetToSeed()}
          className="h-7 text-[10px] font-mono"
        >
          Reset
        </Button>
      )}
    </div>
  );
}
