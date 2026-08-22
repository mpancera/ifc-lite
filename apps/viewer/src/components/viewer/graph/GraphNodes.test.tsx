/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a node box actually says.
 *
 * The enum slots reach the drawing through four hops — file, source adapter,
 * graph package, panel — and every one of them typechecks whether or not the
 * value survives. This asserts the last hop against rendered text, because the
 * failure being guarded is not a crash: it is a box that silently reads
 * `IfcSensor` when the model says `FIRESENSOR`, which looks exactly like a
 * model that carries no PredefinedType.
 */

import '@/test/setup-dom.js';
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type NodeProps } from '@xyflow/react';
import { GraphBoxNode } from './GraphNodes.js';
import type { GraphNodeData } from './GraphNodes.js';

const roots: Root[] = [];

/** Render one box and hand back its text plus the tooltip it carries. */
function renderNode(data: GraphNodeData): { text: string; title: string } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    // React Flow passes a good deal more than this; the box reads `data` and
    // `selected` only, so the rest is cast away rather than stubbed — a fuller
    // prop object would assert React Flow's shape rather than this
    // component's behaviour, and would need updating whenever theirs changes.
    // The provider is required, not decoration: the box carries two React Flow
    // `Handle`s, and they read the flow store on render.
    root.render(
      <ReactFlowProvider>
        <GraphBoxNode {...({ data, selected: false } as unknown as NodeProps)} />
      </ReactFlowProvider>,
    );
  });
  const box = host.querySelector('div');
  return { text: box?.textContent ?? '', title: box?.getAttribute('title') ?? '' };
}

after(() => {
  act(() => {
    for (const root of roots) root.unmount();
  });
});

function element(overrides: Partial<GraphNodeData> = {}): GraphNodeData {
  return {
    kind: 'element',
    ifcType: 'IfcSensor',
    name: 'BM-01',
    assetIdentifier: '',
    tag: '',
    predefinedType: '',
    flowDirection: '',
    dangling: false,
    ...overrides,
  };
}

describe('GraphBoxNode', () => {
  it('refines the class with its PredefinedType', () => {
    // Ten boxes in a row all reading `IfcSensor` distinguish nothing, which is
    // the state this replaces.
    const { text } = renderNode(element({ predefinedType: 'FIRESENSOR' }));
    assert.match(text, /IfcSensor\.FIRESENSOR/);
  });

  it('still shows the bare class when the model carries no PredefinedType', () => {
    const { text } = renderNode(element());
    assert.match(text, /IfcSensor/);
    assert.doesNotMatch(text, /\./);
  });

  it('lets the cable position win over the asset identifier', () => {
    // On a wired run the tag is the more specific of the two: the identifier
    // says where the device stands in the building, the tag where it sits on
    // the cable. A run drawn with only room numbers has no order in it.
    const { text, title } = renderNode(
      element({ assetIdentifier: 'LM.01.1.04_FST.RM.001', tag: 'MK03.02' }),
    );
    assert.match(text, /MK03\.02/);
    assert.doesNotMatch(text, /FST/);
    // Not lost — one hover away.
    assert.match(title, /LM\.01\.1\.04_FST\.RM\.001/);
  });

  it('lets the asset identifier win over the class, as before', () => {
    // The identifier is what the drawing, the list and the export all agree
    // on; the refined class is the fallback, not a second line.
    const { text } = renderNode(
      element({ assetIdentifier: 'A.01.03_FST.RM.001', predefinedType: 'FIRESENSOR' }),
    );
    assert.match(text, /A\.01\.03_FST\.RM\.001/);
    assert.doesNotMatch(text, /IfcSensor/);
  });

  it('marks a port with its flow direction', () => {
    const { text } = renderNode(
      element({ kind: 'port', ifcType: 'IfcDistributionPort', name: 'P1', flowDirection: 'SINK' }),
    );
    assert.match(text, /←/);
  });

  it('marks nothing when the port has no direction in the file', () => {
    // An empty corner reads as "the file does not say". A neutral symbol would
    // read as a third kind of port.
    const { text } = renderNode(
      element({ kind: 'port', ifcType: 'IfcDistributionPort', name: 'P1' }),
    );
    assert.doesNotMatch(text, /[←→↔]/);
  });

  it('never marks a non-port, whatever the slot holds', () => {
    // FlowDirection means nothing on an element, and drawing it there would
    // assert something the slot does not say.
    const { text } = renderNode(element({ flowDirection: 'SINK' }));
    assert.doesNotMatch(text, /[←→↔]/);
  });

  it('puts the refined class and the direction in the tooltip', () => {
    const { title } = renderNode(
      element({ kind: 'port', ifcType: 'IfcDistributionPort', name: 'P1', predefinedType: 'CABLE', flowDirection: 'SOURCE' }),
    );
    assert.match(title, /IfcDistributionPort\.CABLE/);
    assert.match(title, /SOURCE/);
  });
});
