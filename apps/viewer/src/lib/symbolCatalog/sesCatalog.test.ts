/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSesCatalog, mergeSesCatalog, sesShapesToSvg } from './sesCatalog.js';
import { parseSymbolCatalog, symbolEntryFor, symbolDrawingFor, symbolCatalogCoverage } from './symbolCatalog.js';

/** The dictionary's answer, in the shape it actually sends. */
const SES_PAYLOAD = {
  quelle: 'ses',
  viewBox: '0 0 24 24',
  lizenz: {
    inhaber: 'Verband Schweizerischer Errichter von Sicherheitsanlagen (SES)',
    bewilligung: 'Verwendung im Data Dictionary und in IFCedit mit Zustimmung des Verbands (2026-08-25).',
  },
  symbols: {
    'IfcSensor.SMOKESENSOR': {
      id: 'IfcSensor.SMOKESENSOR',
      symbol: 'Rauchmelder',
      label: 'Rauchmelder',
      products: ['werkplan-bma'],
      viewBox: '0 0 24 24',
      zeichnung: [
        { el: 'path', d: 'M1.5 22.5L22.5 22.5L22.5 1.5L1.5 1.5L1.5 22.5', filled: false },
        { el: 'ellipse', cx: 12, cy: 10.45, rx: 4.83, ry: 4.83, filled: false },
      ],
    },
  },
};

/** The VKF catalogue, which covers the same class on other products. */
const VKF_CATALOG = parseSymbolCatalog({
  symbols: {
    'IfcSensor.SMOKESENSOR': {
      id: 'IfcSensor.SMOKESENSOR',
      symbol: 'rauchmelder',
      label: 'Rauchmelder',
      products: ['brandschutzkonzept', 'werkplan-bma'],
    },
    'IfcAlarm.SIREN': { id: 'IfcAlarm.SIREN', symbol: 'sirene', label: 'Sirene', products: [] },
  },
}, 'https://example/local-symbols.json', '2026-08-25T00:00:00.000Z', {
  rauchmelder: '<svg viewBox="-5 -5 10 10"><circle cx="0" cy="0" r="3"/></svg>',
  sirene: '<svg viewBox="-5 -5 10 10"><circle cx="0" cy="0" r="2"/></svg>',
})!;

describe('sesShapesToSvg', () => {
  it('writes paths and ellipses into one document', () => {
    const svg = sesShapesToSvg(SES_PAYLOAD.symbols['IfcSensor.SMOKESENSOR'].zeichnung);
    assert.ok(svg);
    assert.match(svg, /^<svg xmlns=/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /<path d="M1\.5 22\.5/);
    assert.match(svg, /<ellipse cx="12" cy="10\.45" rx="4\.83" ry="4\.83"/);
  });

  it('draws in black rather than currentColor', () => {
    // These end up as data URIs inside an `<image>`, where nothing is
    // inherited from the page — `currentColor` would render invisible.
    const svg = sesShapesToSvg([{ el: 'path', d: 'M0 0L1 1', filled: false }])!;
    assert.match(svg, /stroke="#000000"/);
    assert.doesNotMatch(svg, /currentColor/);
  });

  it('honours the filled flag', () => {
    const filled = sesShapesToSvg([{ el: 'path', d: 'M0 0L1 1Z', filled: true }])!;
    assert.match(filled, /fill="#000000"/);
    const hollow = sesShapesToSvg([{ el: 'path', d: 'M0 0L1 1Z', filled: false }])!;
    assert.match(hollow, /fill="none"/);
  });

  it('keeps an ellipse an ellipse', () => {
    // Four of the association's drawings are genuinely not circular. Rounding
    // them to a circle would be a redrawn symbol, and the permission covers
    // the drawings unchanged.
    const svg = sesShapesToSvg([{ el: 'ellipse', cx: 5, cy: 5, rx: 4, ry: 2, filled: false }])!;
    assert.match(svg, /rx="4" ry="2"/);
  });

  it('abstains when nothing drawable is left', () => {
    // An empty document would be stored as a valid drawing and render as a
    // blank square — which reads as "no symbol for this device".
    assert.equal(sesShapesToSvg([]), null);
    assert.equal(sesShapesToSvg([{ el: 'ellipse', cx: 0, cy: 0, rx: 0, ry: 0 }]), null);
    assert.equal(sesShapesToSvg('nonsense'), null);
  });

  it('cannot have markup written into it through a path', () => {
    // The text may still contain the word; what must not happen is it
    // escaping the attribute and becoming one. The quote is what does that.
    const svg = sesShapesToSvg([{ el: 'path', d: 'M0 0" onload="alert(1)', filled: false }])!;
    assert.match(svg, /&quot; onload=&quot;/);
    assert.doesNotMatch(svg, /"\s*onload="/);
  });
});

describe('parseSesCatalog', () => {
  it('reads entries, drawings and the attribution', () => {
    const ses = parseSesCatalog(SES_PAYLOAD);
    assert.ok(ses);
    assert.equal(ses.entries.length, 1);
    assert.equal(ses.entries[0].symbol, 'Rauchmelder');
    assert.deepEqual([...ses.entries[0].products], ['werkplan-bma']);
    assert.match(ses.drawings.Rauchmelder, /<ellipse/);
    assert.equal(ses.attribution, 'Verband Schweizerischer Errichter von Sicherheitsanlagen (SES)');
    assert.match(ses.permission!, /Zustimmung des Verbands/);
  });

  it('drops an entry that names no product', () => {
    // An entry with no product applies EVERYWHERE, which would put association
    // symbols on an authority plan. That is the one outcome worth losing an
    // entry over.
    const ses = parseSesCatalog({
      symbols: {
        'IfcAlarm.SIREN': { symbol: 'Sirene', products: [], zeichnung: [{ el: 'path', d: 'M0 0L1 1' }] },
      },
    });
    assert.equal(ses?.entries.length, 0);
  });

  it('drops an entry whose drawing is unusable, keeping the rest', () => {
    const ses = parseSesCatalog({
      symbols: {
        broken: { symbol: 'Kaputt', products: ['werkplan-bma'], zeichnung: [] },
        ...SES_PAYLOAD.symbols,
      },
    });
    assert.equal(ses?.entries.length, 1);
  });

  it('says "not this catalogue" for something else', () => {
    assert.equal(parseSesCatalog(null), null);
    assert.equal(parseSesCatalog({ error: 'unconfigured' }), null);
  });

  it('reads an empty catalogue as empty, not as absent', () => {
    const ses = parseSesCatalog({ symbols: {} });
    assert.ok(ses);
    assert.equal(ses.entries.length, 0);
  });
});

describe('mergeSesCatalog', () => {
  const merged = mergeSesCatalog(VKF_CATALOG, parseSesCatalog(SES_PAYLOAD))!;

  it('gives the Werkplan the association symbol', () => {
    const entry = symbolEntryFor(merged, 'IfcSensor', {
      predefinedType: 'SMOKESENSOR', productId: 'werkplan-bma',
    });
    assert.equal(entry?.symbol, 'Rauchmelder');
  });

  it('leaves the authority plan the VKF symbol', () => {
    // The regression this whole module is shaped around: both sources cover
    // this class, and on a Brandschutzkonzept the VKF drawing is the correct
    // one. A merge that simply overwrote would be invisible here.
    const entry = symbolEntryFor(merged, 'IfcSensor', {
      predefinedType: 'SMOKESENSOR', productId: 'brandschutzkonzept',
    });
    assert.equal(entry?.symbol, 'rauchmelder');
  });

  it('still finds a class the association does not cover', () => {
    const entry = symbolEntryFor(merged, 'IfcAlarm', {
      predefinedType: 'SIREN', productId: 'werkplan-bma',
    });
    assert.equal(entry?.symbol, 'sirene');
  });

  it('hands out the right drawing for each product', () => {
    const werkplan = symbolDrawingFor(merged, 'IfcSensor', {
      predefinedType: 'SMOKESENSOR', productId: 'werkplan-bma',
    });
    const konzept = symbolDrawingFor(merged, 'IfcSensor', {
      predefinedType: 'SMOKESENSOR', productId: 'brandschutzkonzept',
    });
    assert.match(werkplan!, /viewBox="0 0 24 24"/);
    assert.match(konzept!, /viewBox="-5 -5 10 10"/);
  });

  it('counts Fachklassen, not rows', () => {
    // Two rows now describe the smoke detector. Counting rows would report
    // three covered classes where the model has two.
    assert.equal(symbolCatalogCoverage(merged).entries, 2);
    assert.equal(symbolCatalogCoverage(merged).withSymbol, 2);
  });

  it('carries the attribution into the catalogue', () => {
    assert.match(merged.attribution!, /Verband Schweizerischer Errichter/);
  });

  it('leaves the catalogue alone when there is nothing to merge', () => {
    assert.equal(mergeSesCatalog(VKF_CATALOG, null), VKF_CATALOG);
    assert.equal(mergeSesCatalog(null, parseSesCatalog(SES_PAYLOAD)), null);
  });
});

describe('with no plan product chosen', () => {
  const merged = mergeSesCatalog(VKF_CATALOG, parseSesCatalog(SES_PAYLOAD))!;

  it('does not make a licensed symbol the default', () => {
    // `null` means "no product asked" and every entry applies. Since the
    // association's entries sit first — that is how they win on their own
    // products — they would otherwise take over a plan that had not yet said
    // which document it is. Wrong drawing, and invisible.
    const entry = symbolEntryFor(merged, 'IfcSensor', { predefinedType: 'SMOKESENSOR' });
    assert.equal(entry?.symbol, 'rauchmelder');
  });

  it('still answers for a class only the association covers', () => {
    // Falling back must not mean falling silent: where there is no second
    // answer, the licensed one is the only one there is.
    const onlySes = mergeSesCatalog(VKF_CATALOG, parseSesCatalog({
      symbols: {
        'IfcDiscreteAccessory.USERDEFINED.KEYBOX': {
          symbol: 'Schlüsselkasten', products: ['werkplan-bma'],
          zeichnung: [{ el: 'path', d: 'M0 0L1 1', filled: false }],
        },
      },
    }))!;
    const entry = symbolEntryFor(onlySes, 'IfcDiscreteAccessory', {
      predefinedType: 'USERDEFINED', objectType: 'KEYBOX',
    });
    assert.equal(entry?.symbol, 'Schlüsselkasten');
  });
});
