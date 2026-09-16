/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Fetch one published Elementbeispiel and read it into placeable pieces.
 *
 * The async half of placing one. It is separate from `placeExampleInStore`
 * because that half has to run inside the store's synchronous builder — with
 * its role gate, its overlay and its spatial registration — and a fetch cannot.
 *
 * The file is fetched FRESH each time rather than cached with the list: an
 * example's geometry is what the dictionary publishes today, and a placement
 * is the moment it matters. The list is small and cheap to hold; a stale
 * geometry copy would be neither.
 */

import { IfcParser } from '@ifc-lite/parser';
import { getModelLengthUnitScale } from '@/lib/length-unit-scale';
import { externalRequestsAllowed } from '@/lib/privacy/externalRequests';
import { readExampleModel, type ExampleModel } from './exampleModel.js';

export type FetchExampleResult =
  | { readonly ok: true; readonly model: ExampleModel }
  | { readonly ok: false; readonly error: string };

/**
 * Fetch, parse and read — or say why not.
 *
 * Every failure comes back as a message rather than an exception: this runs
 * from a click, and the caller's job is to tell the user, not to unwind.
 */
export async function fetchExampleModel(url: string): Promise<FetchExampleResult> {
  // The same gate the list went through. Asked again because this is its own
  // request, and a consent withdrawn between listing and placing must hold.
  if (!externalRequestsAllowed('catalog')) {
    return { ok: false, error: 'Externe Anfragen sind blockiert. Unter Datei → Datenschutz freigeben.' };
  }

  let buffer: ArrayBuffer;
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return { ok: false, error: `Das Beispiel antwortete mit ${response.status}.` };
    buffer = await response.arrayBuffer();
  } catch (err) {
    return { ok: false, error: `Das Beispiel war nicht erreichbar: ${(err as Error).message}` };
  }

  try {
    const store = await new IfcParser().parseColumnar(buffer);
    // The example's OWN unit, read from its own file. The ratio to this
    // model's is what the placement puts on the transformation operator.
    const model = readExampleModel(store, getModelLengthUnitScale(store));
    if (!model) {
      return { ok: false, error: 'Diese Datei enthält kein platzierbares Objekt.' };
    }
    return { ok: true, model };
  } catch (err) {
    return { ok: false, error: `Das Beispiel liess sich nicht lesen: ${(err as Error).message}` };
  }
}
