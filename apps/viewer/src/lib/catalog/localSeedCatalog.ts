/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Generic, public-safe seed catalog — a handful of common fire/security/
 * intrusion installation elements with their standard IFC4/4X3 mapping.
 * No real manufacturer or product data; `technicalData` values are
 * illustrative placeholders, not a real datasheet. Meant to exercise the
 * catalog data model and the Add Element "library" UI end to end until a
 * real product catalog (see `CatalogSourceKind: 'aas'` in `types.ts`) is
 * wired in.
 *
 * `provenance.sourceRef` on every entry is the entry id in a separate,
 * IFC-4.3-schema-mapping reference project (a curated, German-language
 * classification of IFC entities) — pure standard-schema information,
 * not proprietary.
 */

import type { CatalogEntry, CatalogProvider } from './types.js';

const SEED_ENTRIES: CatalogEntry[] = [
  {
    id: 'fire.smoke-detector',
    tag: 'RM',
    label: 'Rauchmelder',
    description: 'Sensor zur Detektion von Rauch.',
    discipline: 'fire',
    category: 'detector',
    ifc: { entity: 'IfcSensor', predefinedType: 'SMOKESENSOR' },
    geometry: { width: 0.1, depth: 0.1, height: 0.05 },
    mounting: 'ceiling',
    technicalData: { OperatingVoltage: '24V DC', IPRating: 'IP42' },
    provenance: { source: 'local-seed', sourceRef: 'IfcSensor.SMOKESENSOR' },
  },
  {
    id: 'fire.heat-detector',
    tag: 'WM',
    label: 'Wärmemelder',
    description: 'Sensor zur Detektion einer erhöhten Temperatur oder Temperaturanstiegsrate.',
    discipline: 'fire',
    category: 'detector',
    ifc: { entity: 'IfcSensor', predefinedType: 'HEATSENSOR' },
    geometry: { width: 0.1, depth: 0.1, height: 0.05 },
    mounting: 'ceiling',
    technicalData: { OperatingVoltage: '24V DC', IPRating: 'IP42' },
    provenance: { source: 'local-seed', sourceRef: 'IfcSensor.HEATSENSOR' },
  },
  {
    id: 'fire.manual-call-point',
    tag: 'HFM',
    label: 'Handfeuermelder',
    description: 'Handfeuermelder mit Glasscheibe zur manuellen Brandalarmauslösung.',
    discipline: 'fire',
    category: 'manual-call-point',
    ifc: { entity: 'IfcAlarm', predefinedType: 'BREAKGLASSBUTTON' },
    geometry: { width: 0.09, depth: 0.09, height: 0.04 },
    mounting: 'wall',
    provenance: { source: 'local-seed', sourceRef: 'IfcAlarm.BREAKGLASSBUTTON' },
  },
  {
    id: 'fire.siren',
    tag: 'Si',
    label: 'Akustischer Signalgeber (Sirene)',
    description: 'Akustischer Alarmgeber in Form einer Sirene.',
    discipline: 'fire',
    category: 'alarm-indicator',
    ifc: { entity: 'IfcAlarm', predefinedType: 'SIREN' },
    geometry: { width: 0.15, depth: 0.1, height: 0.1 },
    mounting: 'wall',
    technicalData: { OperatingVoltage: '24V DC', SoundPressure: '~100 dB @ 1m' },
    provenance: { source: 'local-seed', sourceRef: 'IfcAlarm.SIREN' },
  },
  {
    id: 'security.camera',
    label: 'Kamera',
    description: 'Gerät zur Aufnahme von Bildern.',
    discipline: 'security',
    category: 'camera',
    ifc: { entity: 'IfcAudioVisualAppliance', predefinedType: 'CAMERA' },
    geometry: { width: 0.12, depth: 0.12, height: 0.1 },
    mounting: 'ceiling',
    provenance: { source: 'local-seed', sourceRef: 'IfcAudioVisualAppliance.CAMERA' },
  },
  {
    id: 'intrusion.motion-detector',
    label: 'Bewegungsmelder',
    description: 'Sensor zur Erfassung von Bewegung.',
    discipline: 'intrusion',
    category: 'motion-detector',
    ifc: { entity: 'IfcSensor', predefinedType: 'MOVEMENTSENSOR' },
    geometry: { width: 0.08, depth: 0.06, height: 0.06 },
    mounting: 'ceiling',
    provenance: { source: 'local-seed', sourceRef: 'IfcSensor.MOVEMENTSENSOR' },
  },
  {
    id: 'intrusion.contact-sensor',
    label: 'Kontaktmelder',
    description: 'Gerät, das einen Kontaktzustand erkennt, z.B. ob eine Tür geschlossen ist.',
    discipline: 'intrusion',
    category: 'contact-sensor',
    ifc: { entity: 'IfcSensor', predefinedType: 'CONTACTSENSOR' },
    geometry: { width: 0.06, depth: 0.02, height: 0.02 },
    mounting: 'wall',
    provenance: { source: 'local-seed', sourceRef: 'IfcSensor.CONTACTSENSOR' },
  },
  {
    id: 'intrusion.glass-break-sensor',
    label: 'Glasbruchmelder',
    description: 'Sensor, der das Zerbrechen einer Glasscheibe akustisch erkennt.',
    discipline: 'intrusion',
    category: 'glass-break-sensor',
    ifc: { entity: 'IfcSensor', predefinedType: 'USERDEFINED', objectType: 'GLASSBREAKSENSOR' },
    geometry: { width: 0.08, depth: 0.08, height: 0.03 },
    mounting: 'wall',
    provenance: { source: 'local-seed', sourceRef: 'IfcSensor.USERDEFINED.GLASSBREAKSENSOR' },
  },
];

export class LocalSeedCatalogProvider implements CatalogProvider {
  readonly id = 'local-seed' as const;

  listEntries(): CatalogEntry[] {
    return SEED_ENTRIES;
  }
}
