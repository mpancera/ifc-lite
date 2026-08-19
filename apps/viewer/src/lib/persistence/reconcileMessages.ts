/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What the reconciliation report SAYS, separate from what it finds.
 *
 * The split is not tidiness: these sentences are the feature. A verdict icon
 * tells somebody that a decision exists, and only the sentence tells them
 * which way to decide — so each one carries three things on purpose:
 *
 *   1. what the objects are, in the reader's words rather than in ours
 *      ("Typen, Systeme, Gruppen", not "self-contained entities");
 *   2. WHY the verdict is what it is, phrased as a reason and not as an
 *      absence — "es gibt nichts, was sie ungültig machen könnte" instead of
 *      "hängen an keinem Bauteil", which reads like a defect report next to a
 *      green tick and was the specific thing that made a reader stop and
 *      wonder whether something was about to be lost;
 *   3. what happens if it IS applied, because "the storey does not exist" ends
 *      in the question "and then?" every time.
 *
 * Each message also names the file now open. "Das Geschoss existiert nicht
 * mehr" invites "in what?"; naming it removes the question and, when the claim
 * is wrong, makes it obvious that it is wrong.
 */

export interface ReconcileText {
  /** Headline of the row — always carries its own count. */
  label: string;
  /** The reasoning underneath. Two or three sentences, no jargon. */
  detail: string;
}

/** `n one` / `n many`, so no row can appear without saying how much it covers. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * How the open file is referred to. Callers without a name get a phrase that
 * is still true, rather than an empty pair of quotes.
 */
export function fileLabel(currentModelName?: string): string {
  return currentModelName ? `„${currentModelName}“` : 'dieser Fassung';
}

export const RECONCILE_TEXT = {
  allChanges: (n: number, file: string): ReconcileText => ({
    label: `Alle Änderungen (${n})`,
    detail: `Byte-gleiche Datei — jede gespeicherte Änderung bezieht sich auf genau die `
      + `Bauteile, die auch in ${file} stehen.`,
  }),

  selfContained: (n: number, file: string): ReconcileText => ({
    label: `${n} Produkttypen, Anlagen und Verknüpfungen`,
    detail: `Diese Objekte haben keine Platzierung im Bauwerk — Typen, Systeme, Gruppen und `
      + `ihre Verknüpfungen. In ${file} gibt es deshalb nichts, was sie ungültig machen `
      + `könnte; sie werden unverändert übernommen.`,
  }),

  placedOk: (n: number, file: string): ReconcileText => ({
    label: plural(n, 'platziertes Bauteil', 'platzierte Bauteile'),
    detail: `Geschoss und umgebender Raum stehen in ${file} unverändert da — gleiche GlobalId `
      + `und gleicher Geometrie-Fingerabdruck wie beim Speichern. Die Position bleibt gültig.`,
  }),

  directOnStorey: (n: number, file: string): ReconcileText => ({
    label: plural(n, 'Bauteil direkt im Geschoss', 'Bauteile direkt im Geschoss'),
    detail: `Diese Bauteile standen in keinem Raum, sondern unmittelbar im Geschoss — es gibt `
      + `also keinen Raum, dessen Umbau ihnen etwas anhaben könnte. Das Geschoss selbst ist `
      + `in ${file} vorhanden.`,
  }),

  unverifiedRoom: (n: number, file: string): ReconcileText => ({
    label: `${plural(n, 'platziertes Bauteil', 'platzierte Bauteile')} ohne Raumvergleich`,
    detail: `Der Raum ist in ${file} vorhanden. Ob er seither umgebaut wurde, lässt sich nicht `
      + `sagen: dieser gespeicherte Stand ist älter als der Formvergleich und hält keinen `
      + `Fingerabdruck des Raums fest.`,
  }),

  reshapedRoom: (n: number, file: string): ReconcileText => ({
    label: `${plural(n, 'Bauteil steht', 'Bauteile stehen')} in einem umgebauten Raum`,
    detail: `Der Raum existiert in ${file} noch, hat dort aber eine andere Form als beim `
      + `Speichern. Das Bauteil bliebe an seiner alten Stelle stehen — Position prüfen, bevor `
      + `es übernommen wird.`,
  }),

  deletedRoom: (n: number, file: string): ReconcileText => ({
    label: `${plural(n, 'Bauteil steht', 'Bauteile stehen')} in einem gelöschten Raum`,
    detail: `Der Raum, in dem sie standen, fehlt in ${file}; das Geschoss gibt es noch. `
      + `Übernommen würden sie dem Geschoss zugeordnet und behielten ihre alten Koordinaten — `
      + `geometrisch gültig, fachlich vermutlich falsch.`,
  }),

  storeyGone: (n: number, file: string): ReconcileText => ({
    label: plural(n, 'Bauteil ohne Geschoss', 'Bauteile ohne Geschoss'),
    detail: `Das Geschoss, auf dem sie standen, gibt es in ${file} nicht mehr. Sie lassen sich `
      + `nirgends einhängen und werden weder in die Geschossstruktur aufgenommen noch `
      + `gezeichnet; im gespeicherten Stand bleiben sie erhalten.`,
  }),

  storeyUnrecorded: (n: number, file: string): ReconcileText => ({
    label: plural(n, 'Bauteil ohne festgehaltenes Geschoss', 'Bauteile ohne festgehaltenes Geschoss'),
    detail: `Beim Speichern wurde zu ihnen kein Geschoss mitgeschrieben — das ist etwas anderes `
      + `als ein gelöschtes Geschoss und sagt nichts über ${file} aus. Ohne Geschoss lassen `
      + `sie sich nicht einhängen; im gespeicherten Stand bleiben sie.`,
  }),

  alreadyPresent: (n: number, file: string): ReconcileText => ({
    label: plural(n, 'Objekt steht bereits in der Datei', 'Objekte stehen bereits in der Datei'),
    detail: `Diese Objekte wurden aus dem gespeicherten Stand schon einmal exportiert und `
      + `stehen unter denselben GlobalIds in ${file}. Sie werden nicht noch einmal eingefügt — `
      + `sonst hätte jedes von ihnen einen Zwilling.`,
  }),

  editsOk: (n: number, file: string): ReconcileText => ({
    label: plural(n, 'bearbeitetes Bauteil', 'bearbeitete Bauteile'),
    detail: `Die korrigierten Bauteile wurden in ${file} über ihre GlobalId wiedergefunden. `
      + `Die Änderungen landen auf denselben Bauteilen wie damals.`,
  }),

  editsReshaped: (n: number, file: string): ReconcileText => ({
    label: `${plural(n, 'Korrektur betrifft', 'Korrekturen betreffen')} ein geändertes Bauteil`,
    detail: `Das Bauteil gibt es in ${file} noch, es wurde aber überarbeitet. Die Korrektur `
      + `passt vielleicht nicht mehr zu dem, was heute dort steht.`,
  }),

  editsOrphaned: (n: number, file: string): ReconcileText => ({
    label: `${plural(n, 'Attributkorrektur', 'Attributkorrekturen')} ohne Bezugsbauteil`,
    detail: `Das bearbeitete Bauteil existiert in ${file} nicht mehr. Die Korrektur wird nicht `
      + `angewendet — sie würde sonst auf einem fremden Bauteil landen.`,
  }),

  deletionsOrphaned: (n: number, file: string): ReconcileText => ({
    label: `${plural(n, 'Löschung', 'Löschungen')} ohne Bezugsbauteil`,
    detail: `Die gelöschten Bauteile fehlen in ${file} bereits — die Löschung ist dort `
      + `gegenstandslos und bewirkt nichts.`,
  }),
} as const;

/** How many names an expanded row shows before it starts counting instead. */
export const ENTITY_LIST_LIMIT = 12;

/**
 * The objects behind a row, named the way the model names them.
 *
 * A row that says "1 Bauteil ohne Geschoss" leaves exactly one question open,
 * and express ids do not answer it — `IfcSensor Melder Raum` does. Placements
 * carry type and name; anything else (a type, a system, a relationship) is
 * looked up in the authored entities, where attribute 2 is `Name`.
 */
export function entityLabels(
  snapshot: {
    placements: ReadonlyArray<{ expressId: number; ifcType: string; name: string }>;
    newEntities: ReadonlyArray<{ expressId: number; type: string; attributes: readonly unknown[] }>;
  },
  expressIds: readonly number[],
): string[] {
  const placed = new Map(snapshot.placements.map((p) => [p.expressId, p] as const));
  const authored = new Map(snapshot.newEntities.map((e) => [e.expressId, e] as const));

  return expressIds.map((id) => {
    const p = placed.get(id);
    if (p) return p.name ? `${p.ifcType} · ${p.name}` : p.ifcType;
    const e = authored.get(id);
    if (!e) return `#${id}`;
    const name = typeof e.attributes[2] === 'string' ? e.attributes[2] : '';
    return name ? `${e.type} · ${name}` : e.type;
  });
}

/** "und 4 weitere" — what an expanded row says once it stops listing. */
export function moreLabel(hidden: number): string {
  return `und ${hidden} weitere`;
}
