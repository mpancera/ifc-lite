/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export { edgeId } from './types.js';
export type {
  Graph,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  GraphRelation,
  RelationDirection,
} from './types.js';

export type { GraphSource } from './source.js';

export {
  buildRelationGraph,
  chainRanks,
  danglingNodes,
  elementInSpaceInStorey,
  elementInSpaceInZone,
  systemMembers,
  systemMembersInSpace,
} from './chain.js';
export type { ChainStart, RelationChain, RelationHop } from './chain.js';
