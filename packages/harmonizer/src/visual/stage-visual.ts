/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The visual contract of a stage.
 *
 * Every stage returns a picture of what it saw and what it decided, next to
 * its numbers. The pictures are collected in the protocol in the order the
 * stages ran, so a person can walk the pipeline from the file to the draft
 * and see at each step what the tool had in front of it. A result that can
 * be looked at is a result that can be doubted in the right place, and that
 * is what makes it trustworthy.
 *
 * The contract for the stages still to come is the same: a stage that draws
 * candidates colours them by confidence; a stage that filters shows what it
 * discarded, not only what it kept; a stage that compares shows both sides.
 */
export interface StageVisual {
  /** Stable key of the stage: 'route', 'pdf-pages', 'dxf-layers', 'units', 'ids', later 'align', 'candidates', 'topology', 'draft', 'diff'. */
  stage: string;
  /** Short heading, as a person would name the step. */
  title: string;
  /** What the picture shows and what to check in it, one or two sentences. */
  caption: string;
  /** Self-contained SVG markup: no fonts, scripts or external references. */
  svg: string;
  width: number;
  height: number;
  /** The key figures behind the picture, for a host that lays a table beside it. */
  facts: Array<{ label: string; value: string }>;
}
