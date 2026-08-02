/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Applies the stored palette for the whole session.
 *
 * Mounted once near the root (same shape as `ZoneAssignmentSyncMount`) rather
 * than living in the palette dialog: the colours have to be there from the
 * first paint, not from whenever someone happens to open a panel.
 */

import { useColorPalette } from '@/hooks/useColorPalette';

export function ColorPaletteMount() {
  useColorPalette();
  return null;
}
