/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Loads, applies and persists the active colour palette.
 *
 * Applied to `<html>` as inline custom properties, so it layers over the
 * built-in theme without the stylesheet knowing anything about it, and
 * re-applied on a light/dark switch since the two modes carry different
 * colours.
 */

import { useCallback, useEffect, useState } from 'react';
import { useViewerStore } from '@/store';
import { applyPalette, parsePalette, setActiveDataVizPalette, type ColorPalette } from '@/lib/theme/palette';
import { clearActivePalette, loadActivePalette, saveActivePalette } from '@/lib/theme/idbPaletteStorage';

export interface LoadPaletteResult {
  ok: boolean;
  errors: string[];
}

export function useColorPalette() {
  const theme = useViewerStore((s) => s.theme);
  const [palette, setPalette] = useState<ColorPalette | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadActivePalette().then((found) => {
      if (cancelled) return;
      setPalette(found);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // `colorful` is a third built-in mode with its own look; treat anything that
  // is not dark as light rather than leaving a palette half-applied.
  useEffect(() => {
    applyPalette(document.documentElement, palette, theme === 'dark' ? 'dark' : 'light');
  }, [palette, theme]);

  // Lens evaluation reads this imperatively from an effect, so it is published
  // outside React rather than passed down. Bumping mutationVersion is what
  // makes an already-active lens pick up a newly loaded palette.
  useEffect(() => {
    setActiveDataVizPalette(palette?.dataViz);
    useViewerStore.getState().bumpMutationVersion();
  }, [palette]);

  const loadFromFile = useCallback(async (file: File): Promise<LoadPaletteResult> => {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return { ok: false, errors: ['Die Datei ist kein gültiges JSON.'] };
    }
    const { palette: parsed, errors } = parsePalette(json);
    if (!parsed) return { ok: false, errors };

    setPalette(parsed);
    await saveActivePalette(parsed);
    return { ok: true, errors };
  }, []);

  const reset = useCallback(async () => {
    setPalette(null);
    await clearActivePalette();
  }, []);

  return { palette, loaded, loadFromFile, reset };
}
