/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type {
  CatalogEntry,
  CatalogProvider,
  CatalogSourceKind,
  CatalogProvenance,
  CatalogMounting,
  CatalogIfcMapping,
  CatalogGeometryHint,
  CatalogTechnicalData,
} from './types.js';
export { LocalSeedCatalogProvider } from './localSeedCatalog.js';
export { useCatalogEntries, fileImportProvider, type UseCatalogEntriesResult } from './useCatalog.js';
export {
  FileImportCatalogProvider,
  parseCatalogImport,
  type CatalogImportResult,
  type CatalogImportError,
} from './fileImportCatalogProvider.js';
