/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { evaluateLens, evaluateAutoColorLens, groupBucketValue } from './engine.js';
import { GHOST_COLOR, hexToRgba } from './colors.js';
import type { Lens, LensDataProvider, AutoColorSpec } from './types.js';

/** Simple mock provider from entity list */
function createMockProvider(entities: Array<{
  id: number;
  type: string;
}>): LensDataProvider {
  const entityMap = new Map(entities.map(e => [e.id, e]));

  return {
    getEntityCount: () => entities.length,
    forEachEntity: (cb) => {
      for (const e of entities) cb(e.id, 'model-1');
    },
    getEntityType: (id) => entityMap.get(id)?.type,
    getPropertyValue: () => undefined,
    getPropertySets: () => [],
  };
}

describe('evaluateLens', () => {
  it('should return empty results for lens with no enabled rules', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Disabled', enabled: false, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    expect(result.colorMap.size).toBe(0);
    expect(result.hiddenIds.size).toBe(0);
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should colorize matching entities and ghost non-matches', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
      ],
    };
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
    ]);
    const result = evaluateLens(lens, provider);

    expect(result.colorMap.get(1)).toEqual(hexToRgba('#FF0000', 1));
    expect(result.colorMap.get(2)).toEqual(GHOST_COLOR);
    expect(result.ruleCounts.get('r1')).toBe(1);
  });

  it('should hide entities with hide action', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Hide Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'hide', color: '#000000' },
      ],
    };
    const provider = createMockProvider([
      { id: 1, type: 'IfcSlab' },
      { id: 2, type: 'IfcWall' },
    ]);
    const result = evaluateLens(lens, provider);

    expect(result.hiddenIds.has(1)).toBe(true);
    expect(result.hiddenIds.has(2)).toBe(false);
    expect(result.colorMap.has(1)).toBe(false); // Hidden, not colored
    expect(result.colorMap.get(2)).toEqual(GHOST_COLOR);
  });

  it('should apply transparent action with alpha 0.3', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Transparent Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'transparent', color: '#00FF00' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    const color = result.colorMap.get(1);
    expect(color).toBeDefined();
    expect(color![3]).toBeCloseTo(0.3);
  });

  it('should match first rule only (short-circuit)', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Walls Red', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
        { id: 'r2', name: 'Walls Blue', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#0000FF' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    // First rule (red) should win
    expect(result.colorMap.get(1)).toEqual(hexToRgba('#FF0000', 1));
    expect(result.ruleCounts.get('r1')).toBe(1);
    expect(result.ruleCounts.get('r2')).toBe(0);
  });

  it('should count matches per rule correctly', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r-wall', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
        { id: 'r-slab', name: 'Slabs', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcSlab' }, action: 'colorize', color: '#0000FF' },
      ],
    };
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
      { id: 4, type: 'IfcDoor' },
    ]);
    const result = evaluateLens(lens, provider);

    expect(result.ruleCounts.get('r-wall')).toBe(2);
    expect(result.ruleCounts.get('r-slab')).toBe(1);
    // Door is ghosted
    expect(result.colorMap.get(4)).toEqual(GHOST_COLOR);
  });

  it('should return execution time', () => {
    const lens: Lens = {
      id: 'test',
      name: 'Test',
      rules: [
        { id: 'r1', name: 'Walls', enabled: true, criteria: { type: 'ifcType', ifcType: 'IfcWall' }, action: 'colorize', color: '#FF0000' },
      ],
    };
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const result = evaluateLens(lens, provider);

    expect(typeof result.executionTime).toBe('number');
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// evaluateAutoColorLens
// ============================================================================

describe('evaluateAutoColorLens palette override', () => {
  const spec: AutoColorSpec = { source: 'ifcType' };

  it('uses the supplied palette in order, largest group first', () => {
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
    ]);

    const result = evaluateAutoColorLens(spec, provider, ['#009999', '#D72339']);

    expect(result.legend.find(e => e.name === 'IfcWall')!.color).toBe('#009999');
    expect(result.legend.find(e => e.name === 'IfcSlab')!.color).toBe('#D72339');
  });

  it('continues past the end of a short palette instead of repeating it', () => {
    // A brand palette is finite; it must not cap how many distinct values can
    // be shown, and must not reuse a colour that is already taken.
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
      { id: 3, type: 'IfcColumn' },
    ]);

    const result = evaluateAutoColorLens(spec, provider, ['#009999']);
    const colors = result.legend.map(e => e.color);

    expect(colors.length).toBe(3);
    expect(colors[0]).toBe('#009999');
    expect(new Set(colors).size).toBe(3);
  });

  it('falls back to the generated sequence when no palette is given', () => {
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);

    const withNone = evaluateAutoColorLens(spec, provider);
    const withEmpty = evaluateAutoColorLens(spec, provider, []);

    expect(withEmpty.legend[0].color).toBe(withNone.legend[0].color);
  });
});

describe('evaluateAutoColorLens', () => {
  it('should group entities by IFC type and assign distinct colors', () => {
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
      { id: 4, type: 'IfcColumn' },
    ]);

    const spec: AutoColorSpec = { source: 'ifcType' };
    const result = evaluateAutoColorLens(spec, provider);

    // All 4 entities should have colors (3 groups)
    expect(result.colorMap.size).toBe(4);
    expect(result.legend.length).toBe(3);

    // Walls (2 entities) should be the largest group → first color
    const wallEntry = result.legend.find(e => e.name === 'IfcWall');
    expect(wallEntry).toBeDefined();
    expect(wallEntry!.count).toBe(2);

    // Each group gets a distinct color from uniqueColor()
    const colors = result.legend.map(e => e.color);
    expect(new Set(colors).size).toBe(3); // all distinct
  });

  it('should ghost entities with empty/null values', () => {
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: '' },
    ]);

    const spec: AutoColorSpec = { source: 'ifcType' };
    const result = evaluateAutoColorLens(spec, provider);

    // Entity with empty type should be ghosted
    expect(result.colorMap.get(2)).toEqual(GHOST_COLOR);
    expect(result.legend.length).toBe(1); // Only "IfcWall"
  });

  it('should auto-color by attribute when provider supports it', () => {
    const entities = [
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
    ];
    const provider = createMockProvider(entities);
    (provider as Record<string, unknown>).getEntityAttribute = (id: number, attr: string) => {
      if (attr === 'Name') {
        if (id === 1) return 'Wall A';
        if (id === 2) return 'Wall A';
        if (id === 3) return 'Slab B';
      }
      return undefined;
    };

    const spec: AutoColorSpec = { source: 'attribute', propertyName: 'Name' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(2); // "Wall A" and "Slab B"
    const wallGroup = result.legend.find(e => e.name === 'Wall A');
    expect(wallGroup!.count).toBe(2);
  });

  it('should sort legend by count descending (largest group first)', () => {
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcWall' },
      { id: 4, type: 'IfcSlab' },
      { id: 5, type: 'IfcColumn' },
      { id: 6, type: 'IfcColumn' },
    ]);

    const spec: AutoColorSpec = { source: 'ifcType' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend[0].name).toBe('IfcWall');
    expect(result.legend[0].count).toBe(3);
    expect(result.legend[1].count).toBe(2);
    expect(result.legend[2].count).toBe(1);
  });

  it('should populate ruleEntityIds for isolation', () => {
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
    ]);

    const spec: AutoColorSpec = { source: 'ifcType' };
    const result = evaluateAutoColorLens(spec, provider);

    // Each legend entry has a corresponding ruleEntityIds entry
    for (const entry of result.legend) {
      const ids = result.ruleEntityIds.get(entry.id);
      expect(ids).toBeDefined();
      expect(ids!.length).toBe(entry.count);
    }
  });

  it('should return execution time', () => {
    const provider = createMockProvider([{ id: 1, type: 'IfcWall' }]);
    const spec: AutoColorSpec = { source: 'ifcType' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(typeof result.executionTime).toBe('number');
    expect(result.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('should group a multi-material element under EVERY one of its materials (#1366)', () => {
    // 4 walls with Gypsum, plus Insulation on three of them; one is single-mat.
    const materials = new Map<number, string[]>([
      [1, ['Gypsum']],
      [2, ['Gypsum', 'Insulation']],
      [3, ['Gypsum', 'Insulation']],
      [4, ['Insulation']],
    ]);
    const provider: LensDataProvider = {
      getEntityCount: () => materials.size,
      forEachEntity: (cb) => { for (const id of materials.keys()) cb(id, 'm1'); },
      getEntityType: () => 'IfcWall',
      getPropertyValue: () => undefined,
      getPropertySets: () => [],
      getMaterialNames: (id) => materials.get(id) ?? [],
    };

    const result = evaluateAutoColorLens({ source: 'material' }, provider);

    const byName = new Map(result.legend.map(e => [e.name, e]));
    expect(new Set(byName.keys())).toEqual(new Set(['Gypsum', 'Insulation']));
    // Gypsum: walls 1,2,3 — Insulation: walls 2,3,4. Multi-material walls
    // appear in BOTH buckets (previously they bucketed by the layer-set name).
    expect(new Set(result.ruleEntityIds.get(byName.get('Gypsum')!.id))).toEqual(new Set([1, 2, 3]));
    expect(new Set(result.ruleEntityIds.get(byName.get('Insulation')!.id))).toEqual(new Set([2, 3, 4]));
    expect(byName.get('Gypsum')!.count).toBe(3);
    expect(byName.get('Insulation')!.count).toBe(3);
    // Every element still renders in exactly one colour.
    for (const id of materials.keys()) {
      expect(result.colorMap.has(id)).toBe(true);
    }
  });

  it('falls back to single getMaterialName when getMaterialNames is absent', () => {
    const provider: LensDataProvider = {
      getEntityCount: () => 1,
      forEachEntity: (cb) => cb(1, 'm1'),
      getEntityType: () => 'IfcWall',
      getPropertyValue: () => undefined,
      getPropertySets: () => [],
      getMaterialName: () => 'Concrete',
    };
    const result = evaluateAutoColorLens({ source: 'material' }, provider);
    expect(result.legend.map(e => e.name)).toEqual(['Concrete']);
    expect(result.ruleEntityIds.get(result.legend[0].id)).toEqual([1]);
  });

  it('should auto-color by property when provider supports getPropertyValue', () => {
    const entities = [
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
    ];
    const provider = createMockProvider(entities);
    (provider as Record<string, unknown>).getPropertyValue = (id: number, pset: string, prop: string) => {
      if (pset === 'Pset_WallCommon' && prop === 'IsExternal') {
        if (id === 1) return 'True';
        if (id === 2) return 'False';
      }
      return undefined;
    };

    const spec: AutoColorSpec = { source: 'property', psetName: 'Pset_WallCommon', propertyName: 'IsExternal' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(2); // "True" and "False"
    expect(result.colorMap.size).toBe(3); // 2 matched + 1 ghosted (entity 3)
    expect(result.colorMap.get(3)).toEqual(GHOST_COLOR);
  });

  it('should auto-color by quantity when provider supports getQuantityValue', () => {
    const entities = [
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
    ];
    const provider = createMockProvider(entities);
    (provider as Record<string, unknown>).getQuantityValue = (id: number, qset: string, qname: string) => {
      if (qset === 'Qto_WallBaseQuantities' && qname === 'Width') {
        if (id === 1) return 0.3;
        if (id === 2) return 0.3;
      }
      return undefined;
    };

    const spec: AutoColorSpec = { source: 'quantity', psetName: 'Qto_WallBaseQuantities', propertyName: 'Width' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(1); // "0.3"
    const group = result.legend[0];
    expect(group.count).toBe(2);
    expect(result.colorMap.get(3)).toEqual(GHOST_COLOR);
  });

  it('should auto-color by classification when provider supports getClassifications', () => {
    const entities = [
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
      { id: 3, type: 'IfcColumn' },
    ];
    const provider = createMockProvider(entities);
    (provider as Record<string, unknown>).getClassifications = (id: number) => {
      if (id === 1) return [{ system: 'Uniclass', identification: 'EF_25_10', name: 'Walls' }];
      if (id === 2) return [{ system: 'Uniclass', identification: 'EF_25_30', name: 'Floors' }];
      return [];
    };

    const spec: AutoColorSpec = { source: 'classification', psetName: 'Uniclass' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(2); // two classification values
    expect(result.colorMap.get(3)).toEqual(GHOST_COLOR); // no classification → ghost
    // Legend shows the name alongside System: Code, not just the code. (#1460)
    const labels = result.legend.map((e) => e.name).sort();
    expect(labels).toEqual(['Uniclass: EF_25_10 (Walls)', 'Uniclass: EF_25_30 (Floors)']);
  });

  it('should drop the name parenthetical when the classification has no name (#1460)', () => {
    const entities = [
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
    ];
    const provider = createMockProvider(entities);
    (provider as Record<string, unknown>).getClassifications = (id: number) => {
      // Code only, no name.
      if (id === 1) return [{ system: 'Uniclass', identification: 'EF_25_10' }];
      // Name repeats the bare code -> no redundant parenthetical.
      if (id === 2) return [{ system: 'Uniclass', identification: 'EF_25_30', name: 'EF_25_30' }];
      return [];
    };

    const spec: AutoColorSpec = { source: 'classification', psetName: 'Uniclass' };
    const result = evaluateAutoColorLens(spec, provider);

    const labels = result.legend.map((e) => e.name).sort();
    expect(labels).toEqual(['Uniclass: EF_25_10', 'Uniclass: EF_25_30']);
  });

  it('drops the parenthetical when the name repeats the full System: Code string (#1469)', () => {
    const entities = [{ id: 1, type: 'IfcWall' }];
    const provider = createMockProvider(entities);
    (provider as Record<string, unknown>).getClassifications = () => [
      // Some exports store the whole "System: Code" string in the name attribute.
      { system: 'Uniclass', identification: 'EF_25_10', name: 'Uniclass: EF_25_10' },
    ];

    const spec: AutoColorSpec = { source: 'classification', psetName: 'Uniclass' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.map((e) => e.name)).toEqual(['Uniclass: EF_25_10']);
  });

  it('should honor psetName as a classification-system filter for multi-system entities', () => {
    const entities = [
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
    ];
    const provider = createMockProvider(entities);
    // Each entity carries references from two classification systems. The first
    // reference is Uniclass; psetName must steer grouping to OmniClass instead.
    (provider as Record<string, unknown>).getClassifications = (id: number) => {
      if (id === 1) {
        return [
          { system: 'Uniclass', identification: 'EF_25_10', name: 'Walls' },
          { system: 'OmniClass', identification: '23-13', name: 'Walls' },
        ];
      }
      if (id === 2) {
        return [
          { system: 'Uniclass', identification: 'EF_25_30', name: 'Floors' },
          { system: 'OmniClass', identification: '23-13', name: 'Floors' },
        ];
      }
      return [];
    };

    const spec: AutoColorSpec = { source: 'classification', psetName: 'OmniClass' };
    const result = evaluateAutoColorLens(spec, provider);

    // Both entities share the same OmniClass code -> a single group (grouping is
    // by System: Code, not the name). The label carries the first-seen name. (#1460)
    expect(result.legend.length).toBe(1);
    expect(result.legend[0].name).toBe('OmniClass: 23-13 (Walls)');
    expect(result.legend[0].count).toBe(2);
  });

  it('should auto-color by material when provider supports getMaterialName', () => {
    const entities = [
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcWall' },
      { id: 3, type: 'IfcSlab' },
    ];
    const provider = createMockProvider(entities);
    (provider as Record<string, unknown>).getMaterialName = (id: number) => {
      if (id === 1) return 'Concrete';
      if (id === 2) return 'Concrete';
      if (id === 3) return 'Steel';
      return undefined;
    };

    const spec: AutoColorSpec = { source: 'material' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(2); // "Concrete" and "Steel"
    const concreteGroup = result.legend.find(e => e.name === 'Concrete');
    expect(concreteGroup!.count).toBe(2);
  });

  it('should gracefully handle missing optional provider methods', () => {
    const provider = createMockProvider([
      { id: 1, type: 'IfcWall' },
      { id: 2, type: 'IfcSlab' },
    ]);
    // Provider has no getPropertyValue, getMaterialName, etc.

    const spec: AutoColorSpec = { source: 'property', psetName: 'Pset_WallCommon', propertyName: 'IsExternal' };
    const result = evaluateAutoColorLens(spec, provider);

    // All entities should be ghosted (no property data available)
    expect(result.legend.length).toBe(0);
    for (const [, color] of result.colorMap) {
      expect(color).toEqual(GHOST_COLOR);
    }
  });

  it('should generate unique colors for any number of distinct values', () => {
    const entities = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      type: `IfcType${i}`,
    }));
    const provider = createMockProvider(entities);

    const spec: AutoColorSpec = { source: 'ifcType' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(30);
    // All 30 colors should be unique (no repeats)
    const colors = new Set(result.legend.map(l => l.color));
    expect(colors.size).toBe(30);
  });

  it('should auto-color by model when provider supports getModelId', () => {
    const entities = [
      { id: 1, type: 'IfcWall', modelId: 'model-a' },
      { id: 2, type: 'IfcWall', modelId: 'model-a' },
      { id: 3, type: 'IfcSlab', modelId: 'model-b' },
    ];
    const entityMap = new Map(entities.map(e => [e.id, e]));
    const modelNames = new Map([
      ['model-a', 'Building A.ifc'],
      ['model-b', 'Building B.ifc'],
    ]);

    const provider = createMockProvider(entities);
    (provider as LensDataProvider).getModelId = (id) => entityMap.get(id)?.modelId;
    (provider as LensDataProvider).getModelName = (modelId) => modelNames.get(modelId);

    const spec: AutoColorSpec = { source: 'model' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(2);
    expect(result.colorMap.size).toBe(3);

    const groupA = result.legend.find(e => e.name === 'Building A.ifc');
    const groupB = result.legend.find(e => e.name === 'Building B.ifc');
    expect(groupA).toBeDefined();
    expect(groupA!.count).toBe(2);
    expect(groupB).toBeDefined();
    expect(groupB!.count).toBe(1);

    const colors = new Set(result.legend.map(e => e.color));
    expect(colors.size).toBe(2);
  });

  it('should auto-color single model as one group', () => {
    const entities = [
      { id: 1, type: 'IfcWall', modelId: 'legacy' },
      { id: 2, type: 'IfcSlab', modelId: 'legacy' },
    ];
    const entityMap = new Map(entities.map(e => [e.id, e]));

    const provider = createMockProvider(entities);
    (provider as LensDataProvider).getModelId = (id) => entityMap.get(id)?.modelId;
    (provider as LensDataProvider).getModelName = () => 'Model';

    const spec: AutoColorSpec = { source: 'model' };
    const result = evaluateAutoColorLens(spec, provider);

    expect(result.legend.length).toBe(1);
    expect(result.legend[0].name).toBe('Model');
    expect(result.legend[0].count).toBe(2);
  });
});

// ============================================================================
// evaluateAutoColorLens — "By Zone" (group) source (#1075)
// ============================================================================

/** Mock provider where each entity belongs to a set of groups/zones. */
function createGroupProvider(
  entities: Array<{ id: number; groups: Array<{ id: number; name?: string; type: string; objectType?: string }> }>,
): LensDataProvider {
  const map = new Map(entities.map((e) => [e.id, e]));
  return {
    getEntityCount: () => entities.length,
    forEachEntity: (cb) => { for (const e of entities) cb(e.id, 'model-1'); },
    getEntityType: () => 'IfcSpace',
    getPropertyValue: () => undefined,
    getPropertySets: () => [],
    getEntityGroups: (id) => map.get(id)?.groups ?? [],
  };
}

describe('evaluateAutoColorLens — By Zone', () => {
  it('buckets by distinct named zones instead of collapsing to one (#1075 47-vs-4)', () => {
    // Each space sits in its own named zone — must yield one legend entry per zone.
    const provider = createGroupProvider([
      { id: 1, groups: [{ id: 100, name: 'Dwelling A', type: 'IfcZone' }] },
      { id: 2, groups: [{ id: 101, name: 'Dwelling B', type: 'IfcZone' }] },
      { id: 3, groups: [{ id: 102, name: 'Dwelling C', type: 'IfcZone' }] },
    ]);
    const result = evaluateAutoColorLens({ source: 'group' }, provider);
    expect(result.legend.map((e) => e.name).sort()).toEqual(['Dwelling A', 'Dwelling B', 'Dwelling C']);
  });

  it('colours by the IfcZone when an element is in several groups', () => {
    // The lens is "by zone": the element takes the zone's colour, not the
    // system's, however the relationship graph happened to order them.
    const provider = createGroupProvider([
      { id: 1, groups: [
        { id: 200, name: 'HVAC', type: 'IfcDistributionSystem' },
        { id: 201, name: 'Fire Compartment 1', type: 'IfcZone' },
      ] },
    ]);
    const result = evaluateAutoColorLens({ source: 'group' }, provider, ['#111111', '#222222']);

    expect(result.legend[0].name).toBe('Fire Compartment 1');
    expect(result.colorMap.get(1)).toEqual(hexToRgba('#111111', 1));
  });

  it('still lists the other memberships in the legend', () => {
    // An element renders in one colour, but the legend answers "what zones are
    // there", not "which won a colour". Hiding a zone whose rooms all sit in
    // another one too makes it look like the zone does not exist.
    const provider = createGroupProvider([
      { id: 1, groups: [
        { id: 200, name: 'HVAC', type: 'IfcDistributionSystem' },
        { id: 201, name: 'Fire Compartment 1', type: 'IfcZone' },
      ] },
    ]);
    const result = evaluateAutoColorLens({ source: 'group' }, provider);

    expect(result.legend.map((e) => e.name).sort()).toEqual(['Fire Compartment 1', 'HVAC']);
  });

  it('lists a zone whose members are all in another zone as well', () => {
    // Marc's case: every room of "Office A" was also painted into "Zone 1",
    // and Office A vanished from the legend entirely.
    const provider = createGroupProvider([
      { id: 1, groups: [
        { id: 100, name: 'Zone 1', type: 'IfcZone' },
        { id: 101, name: 'Office A', type: 'IfcZone' },
      ] },
      { id: 2, groups: [{ id: 100, name: 'Zone 1', type: 'IfcZone' }] },
    ]);
    const result = evaluateAutoColorLens({ source: 'group' }, provider);

    expect(result.legend.map((e) => `${e.name}:${e.count}`).sort())
      .toEqual(['Office A:1', 'Zone 1:2']);
  });

  it('de-duplicates a room listed twice under the same zone', () => {
    const provider = createGroupProvider([
      { id: 1, groups: [
        { id: 100, name: 'Zone 1', type: 'IfcZone' },
        { id: 100, name: 'Zone 1', type: 'IfcZone' },
      ] },
    ]);
    const result = evaluateAutoColorLens({ source: 'group' }, provider);

    expect(result.legend).toHaveLength(1);
    expect(result.legend[0].count).toBe(1);
  });

  it('falls back to ObjectType (system type) when a group has no name', () => {
    const provider = createGroupProvider([
      { id: 1, groups: [{ id: 300, type: 'IfcDistributionSystem', objectType: 'AHU-01' }] },
    ]);
    const result = evaluateAutoColorLens({ source: 'group' }, provider);
    expect(result.legend[0].name).toBe('IfcDistributionSystem: AHU-01');
  });

  it('ghosts elements with no group membership', () => {
    const provider = createGroupProvider([
      { id: 1, groups: [{ id: 400, name: 'Zone A', type: 'IfcZone' }] },
      { id: 2, groups: [] },
    ]);
    const result = evaluateAutoColorLens({ source: 'group' }, provider);
    expect(result.legend).toHaveLength(1);
    expect(result.colorMap.get(2)).toEqual(GHOST_COLOR);
  });
});

describe('evaluateAutoColorLens — a value that dictates its own colour', () => {
  const zones = (): LensDataProvider => ({
    ...createGroupProvider([
      { id: 1, groups: [{ id: 100, name: 'Zone A', type: 'IfcZone' }] },
      { id: 2, groups: [{ id: 101, name: 'Zone B', type: 'IfcZone' }] },
      { id: 3, groups: [{ id: 101, name: 'Zone B', type: 'IfcZone' }] },
    ]),
    getValueColor: (value) => (value === 'Zone A' ? '#472A24' : null),
  });

  it('uses the dictated colour instead of the palette', () => {
    // A trigger zone is red because it is red in the fire concept.
    const result = evaluateAutoColorLens({ source: 'group' }, zones(), ['#111111', '#222222']);
    const entry = result.legend.find((e) => e.name === 'Zone A')!;

    expect(entry.color).toBe('#472A24');
  });

  it('leaves values with no opinion to the palette', () => {
    const result = evaluateAutoColorLens({ source: 'group' }, zones(), ['#111111', '#222222']);
    const entry = result.legend.find((e) => e.name === 'Zone B')!;

    // Zone B holds two entities, so it sorts first and takes palette slot 0.
    expect(entry.color).toBe('#111111');
  });

  it('keeps the dictated colour when bucket order changes', () => {
    // Adding a room to a zone reshuffles the count-sorted order. A palette
    // colour would move with it; a dictated one must not.
    const base = createGroupProvider([
      { id: 1, groups: [{ id: 100, name: 'Zone A', type: 'IfcZone' }] },
      { id: 2, groups: [{ id: 100, name: 'Zone A', type: 'IfcZone' }] },
      { id: 3, groups: [{ id: 101, name: 'Zone B', type: 'IfcZone' }] },
    ]);
    const provider: LensDataProvider = {
      ...base,
      getValueColor: (value) => (value === 'Zone A' ? '#472A24' : null),
    };
    const result = evaluateAutoColorLens({ source: 'group' }, provider, ['#111111', '#222222']);

    expect(result.legend.find((e) => e.name === 'Zone A')!.color).toBe('#472A24');
  });

  it('is not consulted when the provider does not implement it', () => {
    const result = evaluateAutoColorLens({ source: 'group' }, createGroupProvider([
      { id: 1, groups: [{ id: 100, name: 'Zone A', type: 'IfcZone' }] },
    ]), ['#111111']);

    expect(result.legend[0].color).toBe('#111111');
  });
});

describe('groupBucketValue', () => {
  it('uses the group name', () => {
    expect(groupBucketValue({ id: 100, name: 'Zone A', type: 'IfcZone' })).toBe('Zone A');
  });

  it('falls back to the ObjectType, qualified by type', () => {
    expect(groupBucketValue({ id: 100, type: 'IfcSystem', objectType: 'BMA' }))
      .toBe('IfcSystem: BMA');
  });

  it('falls back to the express id, so unnamed groups still bucket apart', () => {
    expect(groupBucketValue({ id: 100, type: 'IfcZone' })).toBe('IfcZone #100');
    expect(groupBucketValue({ id: 101, type: 'IfcZone', name: '  ' })).toBe('IfcZone #101');
  });

  it('agrees with the value the engine buckets by', () => {
    // The contract `getValueColor` keys on: derive it here, match it there.
    const result = evaluateAutoColorLens({ source: 'group' }, createGroupProvider([
      { id: 1, groups: [{ id: 100, type: 'IfcZone' }] },
    ]));

    expect(result.legend[0].name).toBe(groupBucketValue({ id: 100, type: 'IfcZone' }));
  });
});

describe('evaluateAutoColorLens — narrowing By Zone to one theme', () => {
  /** A provider whose groups honour the filter, as the viewer's does. */
  function themedProvider(
    entities: Array<{ id: number; groups: Array<{ id: number; name: string; type: string; theme: string }> }>,
  ): LensDataProvider {
    const byId = new Map(entities.map((e) => [e.id, e.groups]));
    return {
      forEachEntity: (cb) => { for (const e of entities) cb(e.id, 'm'); },
      getEntityType: () => 'IfcSpace',
      getPropertySets: () => [],
      getEntityGroups: (globalId, filter) => {
        const groups = byId.get(globalId) ?? [];
        return (filter ? groups.filter((g) => g.theme === filter) : groups)
          .map(({ id, name, type }) => ({ id, name, type }));
      },
    } as unknown as LensDataProvider;
  }

  const rooms = () => themedProvider([
    { id: 1, groups: [
      { id: 100, name: 'BA 1', type: 'IfcZone', theme: 'fire-compartment' },
      { id: 200, name: 'AZ-A', type: 'IfcZone', theme: 'fire-trigger' },
    ] },
    { id: 2, groups: [
      { id: 101, name: 'BA 2', type: 'IfcZone', theme: 'fire-compartment' },
      { id: 200, name: 'AZ-A', type: 'IfcZone', theme: 'fire-trigger' },
    ] },
  ]);

  it('shows every membership when no theme is chosen', () => {
    const result = evaluateAutoColorLens({ source: 'group' }, rooms());

    expect(result.legend.map((e) => e.name).sort()).toEqual(['AZ-A', 'BA 1', 'BA 2']);
  });

  it('leaves one zone per room once a theme is chosen', () => {
    // The point: three legend entries but only two colours could ever show,
    // because each room renders once. Narrowed, legend and picture agree.
    const result = evaluateAutoColorLens(
      { source: 'group', groupFilter: 'fire-compartment' }, rooms(),
    );

    expect(result.legend.map((e) => e.name).sort()).toEqual(['BA 1', 'BA 2']);
    expect(result.legend.every((e) => e.count === 1)).toBe(true);
  });

  it('narrows to the other theme just as well', () => {
    const result = evaluateAutoColorLens(
      { source: 'group', groupFilter: 'fire-trigger' }, rooms(),
    );

    expect(result.legend.map((e) => e.name)).toEqual(['AZ-A']);
    expect(result.legend[0].count).toBe(2);
  });

  it('ghosts everything when no room carries the chosen theme', () => {
    const result = evaluateAutoColorLens(
      { source: 'group', groupFilter: 'ventilation' }, rooms(),
    );

    expect(result.legend).toEqual([]);
    expect(result.colorMap.get(1)).toEqual(GHOST_COLOR);
  });
});
