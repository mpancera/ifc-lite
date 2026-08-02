/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Load a colour palette, or go back to the built-in one.
 *
 * Type and layout are untouched by design: the point is to make a customised
 * deployment recognisable at a glance, not to turn it into a different
 * product. Palettes are files — no organisation's brand colours live in this
 * repository.
 */

import { useRef, useState } from 'react';
import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useColorPalette } from '@/hooks/useColorPalette';
import { UI_COLOR_KEYS } from '@/lib/theme/palette';

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={`${label}: ${color}`}>
      <span
        className="h-3.5 w-3.5 rounded-sm border border-zinc-300 dark:border-zinc-700 shrink-0"
        style={{ background: color }}
      />
      <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 truncate">{label}</span>
    </div>
  );
}

interface ColorPalettePanelProps {
  trigger?: React.ReactNode;
}

export function ColorPalettePanel({ trigger }: ColorPalettePanelProps) {
  const [open, setOpen] = useState(false);
  const { palette, loadFromFile, reset } = useColorPalette();
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const result = await loadFromFile(file);
    if (!result.ok) {
      toast.error(`Palette nicht geladen: ${result.errors[0] ?? 'unbekannter Fehler'}`);
      return;
    }
    if (result.errors.length > 0) {
      toast.info(`Palette geladen, ${result.errors.length} Eintrag/Einträge übersprungen.`);
    } else {
      toast.success('Palette geladen.');
    }
  };

  const lightKeys = palette?.ui?.light ? Object.keys(palette.ui.light) : [];
  const darkKeys = palette?.ui?.dark ? Object.keys(palette.ui.dark) : [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Palette className="h-4 w-4 mr-2" />
            Farbpalette
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Farbpalette</DialogTitle>
          <DialogDescription>
            Eine geladene Palette färbt die Oberfläche und die Datenvisualisierung um.
            Schrift und Aufbau bleiben unverändert.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-sm border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
            <p className="text-xs font-mono text-zinc-900 dark:text-zinc-100">
              {palette ? palette.name : 'ifclite (eingebaut)'}
            </p>
            {palette?.source && (
              <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                {palette.source}
              </p>
            )}
            {!palette && (
              <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
                Keine Palette geladen — Standarddarstellung.
              </p>
            )}
          </div>

          {palette && (lightKeys.length > 0 || darkKeys.length > 0) && (
            <div className="space-y-2">
              {lightKeys.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1.5">
                    Hell · {lightKeys.length} von {UI_COLOR_KEYS.length} Rollen
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(palette.ui!.light!).map(([key, color]) => (
                      <Swatch key={key} color={color} label={key} />
                    ))}
                  </div>
                </div>
              )}
              {darkKeys.length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1.5">
                    Dunkel · {darkKeys.length} von {UI_COLOR_KEYS.length} Rollen
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(palette.ui!.dark!).map(([key, color]) => (
                      <Swatch key={key} color={color} label={key} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {palette?.dataViz && palette.dataViz.length > 0 && (
            <div>
              <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1.5">
                Datenvisualisierung · {palette.dataViz.length} Farben
              </p>
              <div className="flex flex-wrap gap-1">
                {palette.dataViz.map((color, i) => (
                  <span
                    key={i}
                    title={color}
                    className="h-4 w-4 rounded-sm border border-zinc-300 dark:border-zinc-700"
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onFile}
            />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
              Palette laden (JSON)
            </Button>
            {palette && (
              <Button variant="ghost" size="sm" onClick={() => void reset()}>
                Zurücksetzen
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
