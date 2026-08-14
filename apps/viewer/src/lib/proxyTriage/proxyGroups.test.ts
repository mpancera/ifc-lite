/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupProxies, suggestAxes, collapseSerialNames, summariseGroups, groupSearchTerm,
  MAX_GROUPS, type ProxyElement,
} from './proxyGroups.js';

function proxy(expressId: number, over: Partial<ProxyElement> = {}): ProxyElement {
  return {
    expressId,
    name: `BuildingElementProxy ${expressId}`,
    description: 'IfcBuildingElementProxy',
    typeName: null,
    system: null,
    layer: null,
    geometryKey: null,
    ...over,
  };
}

/**
 * The shape of a real electrical model: every element auto-named, most of them
 * described with the name of their own class, meaning carried by the system
 * and — for a minority — by the description.
 */
const electrical: ProxyElement[] = [
  ...Array.from({ length: 6 }, (_, i) => proxy(100 + i, { system: 'Licht' })),
  ...Array.from({ length: 3 }, (_, i) => proxy(200 + i, { system: 'Licht', description: 'Deckenleuchte' })),
  ...Array.from({ length: 4 }, (_, i) => proxy(300 + i, { system: 'Starkstrom' })),
  proxy(400, { system: 'Medium', description: 'Kabelkanal' }),
];

describe('groupProxies', () => {
  it('puts the largest group first — that is where deciding once pays most', () => {
    const groups = groupProxies(electrical, ['system', 'description']);
    assert.equal(groups[0].members.length, 6);
    assert.equal(groups[0].label, 'Licht');
  });

  it('covers every element exactly once', () => {
    const groups = groupProxies(electrical, ['system', 'description']);
    const seen = groups.flatMap((g) => g.members);
    assert.equal(seen.length, electrical.length);
    assert.equal(new Set(seen).size, electrical.length);
  });

  it('keeps a described subset apart from its system-mates', () => {
    const groups = groupProxies(electrical, ['system', 'description']);
    const lamps = groups.find((g) => g.label === 'Licht · Deckenleuchte');
    assert.ok(lamps);
    assert.equal(lamps.members.length, 3);
  });

  it('does not treat the class name as a description', () => {
    // 'IfcBuildingElementProxy' in a description field is an export artefact,
    // not something the author said.
    const groups = groupProxies(electrical, ['description']);
    assert.ok(!groups.some((g) => /IfcBuildingElementProxy/.test(g.label)));
  });

  it('says so when an axis has nothing to say', () => {
    const groups = groupProxies([proxy(1)], ['type']);
    assert.equal(groups[0].label, 'Ohne Merkmal');
  });

  it('has nothing to group when there are no proxies', () => {
    assert.deepEqual(groupProxies([], ['system']), []);
  });

  it('keys a group stably, so a decision survives a regrouping', () => {
    const first = groupProxies(electrical, ['system', 'description']);
    const again = groupProxies([...electrical].reverse(), ['system', 'description']);
    assert.deepEqual(
      first.map((g) => g.key).sort(),
      again.map((g) => g.key).sort(),
    );
  });
});

describe('collapseSerialNames', () => {
  it('collapses a counted-off family onto its stem', () => {
    const counted = [proxy(1, { name: 'Leuchte 1' }), proxy(2, { name: 'Leuchte 2' })];
    const names = collapseSerialNames(counted);
    assert.equal(names.get(1), 'Leuchte');
    assert.equal(names.get(2), 'Leuchte');
  });

  it('reports a family counted off from the class name as nameless', () => {
    // `BuildingElementProxy 1 … 3643` is an export counting to itself. Once
    // the number is gone there is nothing left but the class name, so the
    // honest answer is that these elements have no name.
    const names = collapseSerialNames(electrical);
    assert.equal(names.get(100), null);
    assert.equal(names.get(400), null);
  });

  it('leaves a real name that happens to end in a number alone', () => {
    // 'KIR 16' and 'KIR 20' are two conduits, not one counted twice. What
    // tells them apart from a serial number is that each is SHARED.
    const conduits = [
      proxy(1, { name: 'KIR 16' }), proxy(2, { name: 'KIR 16' }),
      proxy(3, { name: 'KIR 20' }), proxy(4, { name: 'KIR 20' }),
    ];
    const names = collapseSerialNames(conduits);
    assert.equal(names.get(1), 'KIR 16');
    assert.equal(names.get(3), 'KIR 20');
  });

  it('reports an absent name as absent rather than inventing one', () => {
    const names = collapseSerialNames([proxy(1, { name: '' })]);
    assert.equal(names.get(1), null);
  });

  it('does not collapse a name down to nothing', () => {
    const names = collapseSerialNames([proxy(1, { name: '12' })]);
    assert.equal(names.get(1), '12');
  });
});

describe('suggestAxes', () => {
  it('picks the axes that actually cut the model', () => {
    assert.deepEqual(suggestAxes(electrical), ['system', 'description']);
  });

  it('leads with the type where the author gave one', () => {
    const typed = [
      proxy(1, { typeName: 'Leuchte rund', system: 'Licht' }),
      proxy(2, { typeName: 'Leuchte rund', system: 'Licht' }),
      proxy(3, { typeName: 'Steckdose', system: 'Licht' }),
    ];
    assert.equal(suggestAxes(typed)[0], 'type');
  });

  it('drops an axis that repeats one already chosen', () => {
    // The layer of an electrical model usually restates its system. A second
    // column carrying the same cut is noise.
    const mirrored = [
      proxy(1, { system: 'Licht', layer: 'E_Licht' }),
      proxy(2, { system: 'Licht', layer: 'E_Licht' }),
      proxy(3, { system: 'Kraft', layer: 'E_Kraft' }),
    ];
    assert.deepEqual(suggestAxes(mirrored), ['system']);
  });

  it('drops an axis that splits one element off a large group', () => {
    // Seen on a real model: adding the layer turned a group of 1365 into
    // 1364 and 1. Every row grew a third term to express that one element.
    // Eight systems, each with its own layer, and ONE element on a stray
    // layer: nine groups instead of eight, for a column on every row.
    const nearlyMirrored = [
      ...Array.from({ length: 8 }, (_, s) => (
        Array.from({ length: 5 }, (_, i) => proxy(s * 10 + i, {
          system: `System ${s}`, layer: `E_System_${s}`,
        }))
      )).flat(),
      proxy(999, { system: 'System 0', layer: 'E_Sonder' }),
    ];
    assert.deepEqual(suggestAxes(nearlyMirrored), ['system']);
  });

  it('refuses an axis that would make a group per element', () => {
    // Shared geometry is exact and useless as a lead: on the model this was
    // built against it produced 677 groups for 3643 elements.
    const scattered = Array.from({ length: MAX_GROUPS + 10 }, (_, i) => proxy(i, {
      system: 'Licht', geometryKey: `block-${i}`,
    }));
    assert.ok(!suggestAxes(scattered).includes('geometry'));
  });

  it('admits when nothing distinguishes them', () => {
    const identical = Array.from({ length: 5 }, (_, i) => proxy(i));
    assert.deepEqual(suggestAxes(identical), []);
  });
});

describe('groupSearchTerm', () => {
  const of = (label: string) => groupProxies(electrical, ['system', 'description'])
    .find((g) => g.label === label)!;

  it('reaches for the finest thing the author said', () => {
    // The system says which trade drew it; the description says what it is.
    assert.equal(groupSearchTerm(of('Licht · Deckenleuchte')), 'Deckenleuchte');
  });

  it('falls back to the coarser axis where that is all there is', () => {
    assert.equal(groupSearchTerm(of('Starkstrom')), 'Starkstrom');
  });

  it('offers nothing where the author said nothing', () => {
    const [nameless] = groupProxies([proxy(1)], ['description']);
    assert.equal(groupSearchTerm(nameless), '');
  });
});

describe('summariseGroups', () => {
  it('counts groups and elements', () => {
    const groups = groupProxies(electrical, ['system', 'description']);
    assert.equal(summariseGroups(groups), '4 Gruppen, 14 Elemente');
  });

  it('speaks singular where there is one of each', () => {
    assert.equal(summariseGroups(groupProxies([proxy(1)], ['system'])), '1 Gruppe, 1 Element');
  });
});
