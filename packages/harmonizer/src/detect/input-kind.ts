/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { MessageCodes, message } from '../messages.js';
import type { HarmonizerMessage, InputKind, Route } from '../types.js';

/** What a file is, from its extension. The content check follows; this only decides which check. */
export function inputKindFromName(fileName: string): InputKind {
  const ext = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
  switch (ext) {
    case 'dxf':
      return 'dxf';
    case 'dwg':
      return 'dwg';
    case 'pdf':
      return 'pdf';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'tif':
    case 'tiff':
    case 'bmp':
    case 'webp':
      return 'image';
    default:
      return 'unknown';
  }
}

export interface InputRouting {
  kind: InputKind;
  /** The route the kind implies before any content is read; 'vector' for PDF means "check the pages". */
  route: Route;
  messages: HarmonizerMessage[];
}

/**
 * Route by kind alone. A DXF is vector, an image is raster, a DWG cannot be
 * read here, and a PDF is vector until its pages say otherwise.
 */
export function routeByKind(fileName: string): InputRouting {
  const kind = inputKindFromName(fileName);
  switch (kind) {
    case 'dxf':
    case 'pdf':
      return { kind, route: 'vector', messages: [] };
    case 'image':
      return { kind, route: 'raster', messages: [message(MessageCodes.RASTER_NOT_SUPPORTED, 'warning')] };
    case 'dwg':
      return { kind, route: 'unavailable', messages: [message(MessageCodes.DWG_NOT_READABLE, 'error')] };
    default:
      return { kind, route: 'unavailable', messages: [message(MessageCodes.UNKNOWN_INPUT, 'error', { fileName })] };
  }
}
