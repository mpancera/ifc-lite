/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Input } from '@/components/ui/input';
import type { BuildingXExportProduct } from '@/lib/exportProducts/exportProducts';
import type { BuildingXSettings } from '@/store/slices/exportProductsSlice';

/**
 * The two facts Building X requires and the model cannot supply, plus the
 * optional rest of the address and the device classes.
 *
 * Inline on the row rather than behind a dialog: they are four short fields,
 * and a dialog would hide the one thing somebody has to check before issuing —
 * that the country and time zone are this building's, not the last one's.
 */
export function BuildingXSettingsFields({
  product, disabled, onSetting,
}: {
  product: BuildingXExportProduct;
  disabled: boolean;
  onSetting: <K extends keyof BuildingXSettings>(key: K, value: BuildingXSettings[K]) => void;
}) {
  return (
    <div className="mt-1 space-y-1 pl-6">
      <div className="flex items-center gap-1">
        <Input
          className="h-7 flex-1 text-xs"
          defaultValue={product.timeZone}
          disabled={disabled}
          placeholder="Zeitzone, z. B. Europe/Zurich"
          aria-label="Zeitzone"
          onBlur={(event) => onSetting('timeZone', event.target.value)}
        />
        <Input
          className="h-7 w-16 text-xs uppercase"
          defaultValue={product.countryCode}
          disabled={disabled}
          placeholder="CHE"
          aria-label="Ländercode"
          onBlur={(event) => onSetting('countryCode', event.target.value)}
        />
      </div>
      <div className="flex items-center gap-1">
        <Input
          className="h-7 flex-1 text-xs"
          defaultValue={product.street}
          disabled={disabled}
          placeholder="Strasse (optional)"
          aria-label="Strasse"
          onBlur={(event) => onSetting('street', event.target.value)}
        />
        <Input
          className="h-7 w-16 text-xs"
          defaultValue={product.postalCode}
          disabled={disabled}
          placeholder="PLZ"
          aria-label="Postleitzahl"
          onBlur={(event) => onSetting('postalCode', event.target.value)}
        />
        <Input
          className="h-7 w-24 text-xs"
          defaultValue={product.locality}
          disabled={disabled}
          placeholder="Ort"
          aria-label="Ort"
          onBlur={(event) => onSetting('locality', event.target.value)}
        />
      </div>
      <Input
        className="h-7 w-full text-xs"
        defaultValue={product.equipmentClasses.join(', ')}
        disabled={disabled}
        placeholder="Geräteklassen, z. B. IfcSensor, IfcAlarm (leer = nur Struktur)"
        aria-label="Geräteklassen"
        onBlur={(event) => onSetting(
          'equipmentClasses',
          event.target.value.split(',').map((entry) => entry.trim()).filter(Boolean),
        )}
      />
    </div>
  );
}
