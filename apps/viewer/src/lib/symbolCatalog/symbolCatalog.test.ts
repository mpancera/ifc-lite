/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSymbolCatalog, classKeyCandidates, symbolEntryFor, symbolDrawingFor,
  entryAppliesTo, referencedSymbols, symbolCatalogCoverage, symbolDrawingUrl,
  DEFAULT_SYMBOL_CATALOG_URL, type SymbolCatalog,
} from './symbolCatalog.js';
import {
  checkSymbolSvg, isSymbolSvgRenderable, svgForEmbedding, viewBoxOf, EXPECTED_VIEWBOX,
} from './symbolSvg.js';

/** The shape the data dictionary is asked to publish. */
const PAYLOAD = {
  symbols: {
    'IfcAlarm.MANUALPULLBOX': {
      id: 'IfcAlarm.MANUALPULLBOX',
      symbol: 'handfeuermelder',
      label: 'Handfeuermelder',
      products: ['brandschutzkonzept', 'feuerwehrlageplan'],
    },
    'IfcSensor.FIRESENSOR': {
      id: 'IfcSensor.FIRESENSOR',
      symbol: 'rauchmelder',
      label: 'Rauchmelder',
      products: ['brandschutzkonzept'],
    },
    // The state the catalogue starts in: classified, not yet drawn.
    'IfcFireSuppressionTerminal.SPRINKLER': {
      id: 'IfcFireSuppressionTerminal.SPRINKLER',
      symbol: '',
      label: 'Sprinkler',
      products: [],
    },
  },
};

const catalog = () => parseSymbolCatalog(PAYLOAD, 'https://example.test/data/local-symbols.json')!;

describe('parseSymbolCatalog', () => {
  it('reads the map shape the class dictionary uses', () => {
    const parsed = catalog();
    assert.equal(parsed.entries.length, 3);
    assert.equal(parsed.entries[0].label, 'Handfeuermelder');
  });

  it('accepts an array export too', () => {
    const parsed = parseSymbolCatalog({ symbols: Object.values(PAYLOAD.symbols) });
    assert.equal(parsed?.entries.length, 3);
  });

  it('takes the id from the map KEY when the entry omits it', () => {
    // The natural way to write a map, and it must not silently lose entries.
    const parsed = parseSymbolCatalog({
      symbols: { 'IfcDoor.FIREDOOR': { label: 'Brandschutztür', symbol: 'brandschutztuer' } },
    });
    assert.equal(parsed?.entries[0].id, 'IfcDoor.FIREDOOR');
  });

  it('keeps an entry that has no drawing yet', () => {
    // The catalogue exists before the drawings do; such a row still says the
    // class is meant to carry a symbol.
    const sprinkler = catalog().entries.find((e) => e.label === 'Sprinkler');
    assert.ok(sprinkler);
    assert.equal(sprinkler.symbol, null);
  });

  it('turns an empty symbol into null rather than an empty name', () => {
    // So "no drawing" is a state a caller must handle, not one it can render.
    const parsed = parseSymbolCatalog({ symbols: { 'A.B': { symbol: '   ' } } });
    assert.equal(parsed?.entries[0].symbol, null);
  });

  it('drops an entry with no Fachklasse to join on', () => {
    const parsed = parseSymbolCatalog({ symbols: [{ label: 'Namenlos', symbol: 'x' }] });
    assert.deepEqual(parsed?.entries, []);
  });

  it('drops a duplicate id, which would make lookup order-dependent', () => {
    const parsed = parseSymbolCatalog({
      symbols: [
        { id: 'A.B', label: 'Erst', symbol: 'a' },
        { id: 'A.B', label: 'Zweit', symbol: 'b' },
      ],
    });
    assert.equal(parsed?.entries.length, 1);
    assert.equal(parsed?.entries[0].label, 'Erst');
  });

  it('tells "empty catalogue" apart from "not a catalogue"', () => {
    // A caller has to report different things for the two.
    assert.deepEqual(parseSymbolCatalog({ symbols: [] })?.entries, []);
    assert.equal(parseSymbolCatalog(null), null);
    assert.equal(parseSymbolCatalog('nope'), null);
  });

  it('falls back to the label when none is given', () => {
    const parsed = parseSymbolCatalog({ symbols: { 'A.B': { symbol: 'x' } } });
    assert.equal(parsed?.entries[0].label, 'A.B');
  });
});

describe('classKeyCandidates', () => {
  it('goes from most specific to least', () => {
    assert.deepEqual(
      classKeyCandidates('IfcSensor', 'USERDEFINED', 'Rauchmelder'),
      ['IfcSensor.USERDEFINED.Rauchmelder', 'IfcSensor.USERDEFINED', 'IfcSensor'],
    );
  });

  it('omits the levels the element does not have', () => {
    assert.deepEqual(classKeyCandidates('IfcWall'), ['IfcWall']);
    assert.deepEqual(classKeyCandidates('IfcAlarm', 'BELL'), ['IfcAlarm.BELL', 'IfcAlarm']);
  });

  it('answers nothing for an element with no entity name', () => {
    assert.deepEqual(classKeyCandidates(''), []);
    assert.deepEqual(classKeyCandidates('   '), []);
  });
});

describe('symbolEntryFor', () => {
  it('finds the exact Fachklasse', () => {
    const entry = symbolEntryFor(catalog(), 'IfcAlarm', { predefinedType: 'MANUALPULLBOX' });
    assert.equal(entry?.label, 'Handfeuermelder');
  });

  it('matches however the exporter spelled the entity', () => {
    // IFC type names come out of the file as `IFCALARM` in some tools.
    const entry = symbolEntryFor(catalog(), 'IFCALARM', { predefinedType: 'manualpullbox' });
    assert.equal(entry?.label, 'Handfeuermelder');
  });

  it('falls back to an entity-wide entry', () => {
    // What lets one row cover a whole entity while a catalogue is young.
    const parsed = parseSymbolCatalog({ symbols: { IfcAlarm: { symbol: 'alarm', label: 'Alarm' } } });
    assert.equal(symbolEntryFor(parsed, 'IfcAlarm', { predefinedType: 'BELL' })?.label, 'Alarm');
  });

  it('filters by plan product', () => {
    // The whole point of `products`: the Lageplan shows fewer symbols.
    const c = catalog();
    assert.ok(symbolEntryFor(c, 'IfcSensor', {
      predefinedType: 'FIRESENSOR', productId: 'brandschutzkonzept',
    }));
    assert.equal(symbolEntryFor(c, 'IfcSensor', {
      predefinedType: 'FIRESENSOR', productId: 'feuerwehrlageplan',
    }), null);
  });

  it('lets a general entry apply where the specific one is for another product', () => {
    // A specific row belonging to a different product must not end the search.
    const parsed = parseSymbolCatalog({
      symbols: [
        { id: 'IfcAlarm.BELL', symbol: 'glocke', label: 'Glocke', products: ['brandschutzkonzept'] },
        { id: 'IfcAlarm', symbol: 'alarm', label: 'Alarm', products: ['feuerwehrlageplan'] },
      ],
    });
    const entry = symbolEntryFor(parsed, 'IfcAlarm', {
      predefinedType: 'BELL', productId: 'feuerwehrlageplan',
    });
    assert.equal(entry?.label, 'Alarm');
  });

  it('treats an entry naming no product as applying everywhere', () => {
    assert.ok(entryAppliesTo(
      { id: 'A', symbol: 'a', label: 'A', products: [] }, 'feuerwehrlageplan',
    ));
  });

  it('answers null without a catalogue at all', () => {
    assert.equal(symbolEntryFor(null, 'IfcAlarm'), null);
  });
});

describe('symbolDrawingFor', () => {
  const withDrawings: SymbolCatalog = {
    ...catalog(),
    drawings: { handfeuermelder: `<svg viewBox="${EXPECTED_VIEWBOX}"><circle r="3"/></svg>` },
  };

  it('returns the SVG for a class that has one', () => {
    const svg = symbolDrawingFor(withDrawings, 'IfcAlarm', { predefinedType: 'MANUALPULLBOX' });
    assert.match(String(svg), /<svg/);
  });

  it('returns null for an entry whose drawing is not made yet', () => {
    assert.equal(symbolDrawingFor(withDrawings, 'IfcFireSuppressionTerminal', {
      predefinedType: 'SPRINKLER',
    }), null);
  });

  it('returns null for an entry whose drawing failed to fetch', () => {
    // Named in the catalogue but absent from `drawings`.
    assert.equal(symbolDrawingFor(withDrawings, 'IfcSensor', {
      predefinedType: 'FIRESENSOR',
    }), null);
  });
});

describe('referencedSymbols', () => {
  it('lists each drawing once, ignoring entries without one', () => {
    assert.deepEqual(referencedSymbols(catalog()).sort(), ['handfeuermelder', 'rauchmelder']);
  });
});

describe('symbolCatalogCoverage', () => {
  it('separates "not drawn yet" from "drawing missing"', () => {
    // Two different jobs: one for whoever draws, one for whoever publishes.
    const coverage = symbolCatalogCoverage({
      ...catalog(),
      drawings: { handfeuermelder: '<svg/>' },
    });
    assert.equal(coverage.entries, 3);
    assert.equal(coverage.withSymbol, 2);
    assert.equal(coverage.withoutSymbol, 1);
    assert.deepEqual(coverage.missingDrawings, ['rauchmelder']);
  });
});

describe('symbolDrawingUrl', () => {
  it('derives the drawing address from the catalogue address', () => {
    // Pointing the viewer at a staging dictionary must move the drawings too,
    // or it mixes one catalogue's list with another's pictures.
    assert.equal(
      symbolDrawingUrl('handfeuermelder', 'https://staging.test/data/local-symbols.json'),
      'https://staging.test/data/symbols/handfeuermelder.svg',
    );
  });

  it('uses the shipped address by default', () => {
    assert.match(symbolDrawingUrl('x'), /^https:\/\/[^/]+\/data\/symbols\/x\.svg$/);
    assert.match(DEFAULT_SYMBOL_CATALOG_URL, /local-symbols\.json$/);
  });

  it('escapes a name that would otherwise change the path', () => {
    assert.ok(!symbolDrawingUrl('../../etc/passwd').includes('../'));
  });
});

describe('checkSymbolSvg — safety', () => {
  const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${EXPECTED_VIEWBOX}"><circle r="3" fill="#d00"/></svg>`;

  it('accepts a plain self-contained symbol', () => {
    const check = checkSymbolSvg(good);
    assert.ok(check.ok, check.problems.join(','));
    assert.ok(isSymbolSvgRenderable(check));
  });

  it('refuses a script — it would run with the page’s privileges', () => {
    const check = checkSymbolSvg(good.replace('<circle', '<script>alert(1)</script><circle'));
    assert.ok(check.problems.includes('script'));
    assert.ok(!isSymbolSvgRenderable(check));
  });

  it('refuses an event handler', () => {
    const check = checkSymbolSvg(good.replace('<circle', '<circle onload="alert(1)"'));
    assert.ok(check.problems.includes('event-handler'));
    assert.ok(!isSymbolSvgRenderable(check));
  });

  it('refuses anything that would fetch a second resource', () => {
    for (const bad of [
      '<image href="https://evil.test/x.png"/>',
      '<use xlink:href="https://evil.test/x.svg#a"/>',
      '<foreignObject><b>hi</b></foreignObject>',
      '<style>@import url(https://evil.test/x.css);</style>',
    ]) {
      const check = checkSymbolSvg(good.replace('<circle', `${bad}<circle`));
      assert.ok(check.problems.includes('external-reference'), bad);
      assert.ok(!isSymbolSvgRenderable(check), bad);
    }
  });

  it('refuses an HTML error page served with status 200', () => {
    const check = checkSymbolSvg('<!doctype html><html><body>404</body></html>');
    assert.deepEqual(check.problems, ['not-svg']);
  });

  it('does not read a legitimate attribute ending in "on" as a handler', () => {
    const check = checkSymbolSvg(
      `<svg version="1.1" viewBox="${EXPECTED_VIEWBOX}"><circle r="3"/></svg>`,
    );
    assert.ok(!check.problems.includes('event-handler'), check.problems.join(','));
  });
});

describe('svgForEmbedding', () => {
  const good = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${EXPECTED_VIEWBOX}"><circle r="3"/></svg>`;

  it('passes a sound symbol through untouched', () => {
    assert.equal(svgForEmbedding(good), good);
  });

  it('withholds one that must not be shown', () => {
    assert.equal(svgForEmbedding(good.replace('<circle', '<script>alert(1)</script><circle')), null);
  });

  it('gives a viewBox-less symbol a size, or it draws nothing at all', () => {
    // The detector bug: embedded as an image, an SVG with neither viewBox nor
    // width/height has no intrinsic size. It was in the plan's DOM and drew
    // empty space.
    const sized = svgForEmbedding('<svg><circle r="3"/></svg>');
    assert.equal(viewBoxOf(sized ?? ''), EXPECTED_VIEWBOX);
  });

  it('leaves a wrong viewBox alone — that is the author’s statement', () => {
    const off = '<svg viewBox="0 0 10 10"><circle r="3"/></svg>';
    assert.equal(svgForEmbedding(off), off);
  });
});

describe('checkSymbolSvg — shape', () => {
  it('insists on the agreed viewBox, so symbols sit on their point', () => {
    const off = '<svg viewBox="0 0 10 10"><circle r="3"/></svg>';
    const check = checkSymbolSvg(off);
    assert.ok(check.problems.includes('wrong-viewbox'));
    // A drawing fault, not a danger: still renderable, but reported.
    assert.ok(isSymbolSvgRenderable(check));
  });

  it('notices a missing viewBox', () => {
    assert.ok(checkSymbolSvg('<svg><circle r="3"/></svg>').problems.includes('no-viewbox'));
  });

  it('accepts commas as separators — same box, written differently', () => {
    assert.equal(viewBoxOf('<svg viewBox="-5,-5,10,10"/>'), EXPECTED_VIEWBOX);
    assert.ok(checkSymbolSvg('<svg viewBox="-5, -5, 10, 10"><circle/></svg>').ok);
  });
});
