/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The protocol of a run: every decision, every message, every timing. A
 * result that cannot explain itself is a result nobody will trust on the
 * second plan, so the stages write here as they go, and the protocol is
 * saved next to the draft.
 */

import type { Decision, HarmonizerMessage } from './types.js';
import type { StageVisual } from './visual/stage-visual.js';

export class Protocol {
  readonly decisions: Decision[] = [];
  readonly messages: HarmonizerMessage[] = [];
  readonly timings: Record<string, number> = {};
  /** One picture per stage, in the order the stages ran. */
  readonly visuals: StageVisual[] = [];

  private readonly now: () => number;

  constructor(now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.now = now;
  }

  /** Record a decision with the data it was based on. */
  note(step: string, message: string, data?: unknown): void {
    this.decisions.push(data === undefined ? { step, message } : { step, message, data });
  }

  /** Record a message for the person. Duplicates by code are kept; they refer to different pages. */
  say(message: HarmonizerMessage): void {
    this.messages.push(message);
  }

  /** Record the picture of a stage. */
  show(visual: StageVisual): void {
    this.visuals.push(visual);
  }

  /** Run a stage and record how long it took, in milliseconds. */
  time<T>(step: string, fn: () => T): T {
    const start = this.now();
    try {
      return fn();
    } finally {
      this.timings[step] = (this.timings[step] ?? 0) + (this.now() - start);
    }
  }

  /** Same as {@link time} for asynchronous stages. */
  async timeAsync<T>(step: string, fn: () => Promise<T>): Promise<T> {
    const start = this.now();
    try {
      return await fn();
    } finally {
      this.timings[step] = (this.timings[step] ?? 0) + (this.now() - start);
    }
  }
}
