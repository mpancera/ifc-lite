/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Being told which project you are in by the window that opened you.
 *
 * A folder settles this on its own (see `descriptor.ts`), but an application
 * that opens this one with a file rather than a folder has no folder to leave
 * anything in. The window that did the opening is then the only thing that
 * knows, and `window.opener` is the only channel back to it.
 *
 * ## Why not the URL
 *
 * `?project=proj_x` would be two lines and a hole. A link is settable by
 * anyone, so a planted key would make this application treat a stranger's
 * session as an existing project — with its height system, its zones, its
 * lists. That is precisely the inheritance a project key exists to prevent,
 * handed in through the address bar.
 *
 * ## What makes the message channel different
 *
 * An offer is only taken when it comes from the window that actually did the
 * opening, at the same origin, first, and in a version this side understands.
 * Origin alone is NOT enough: any same-origin window could post. Those checks
 * are the whole security argument, so they live here in one place where they
 * can be tested, rather than spread through an event handler.
 */

import { parseProjectDescriptor, type ProjectDescriptor } from './descriptor.js';

/** Sent to the opener on start: "I exist, tell me where I am". */
export const PROJECT_HELLO = 'PROJECT_HELLO';

/** The opener's reply. */
export const PROJECT_OFFER = 'PROJECT_OFFER';

/** Bumped only for a change that an older reader would misinterpret. */
export const PROJECT_HANDSHAKE_PROTOCOL = 1;

/**
 * How long to wait before deciding nobody is going to answer.
 *
 * Generous, because the opener may still be starting up, and cheap, because
 * the fallback is the ordinary standalone behaviour rather than an error.
 */
export const PROJECT_OFFER_TIMEOUT_MS = 5000;

/**
 * Read an offer out of a message payload, or `null` when it is not one.
 *
 * The project itself goes through the same validation as a descriptor read
 * from a file: a key arriving by message is no more trustworthy than one
 * arriving on disk.
 */
export function parseProjectOffer(data: unknown): ProjectDescriptor | null {
  if (typeof data !== 'object' || data === null) return null;
  const message = data as Record<string, unknown>;

  if (message.type !== PROJECT_OFFER) return null;
  // An unknown protocol is refused rather than read optimistically: the whole
  // point of the number is that a later shape might mean something different.
  if (message.protocol !== PROJECT_HANDSHAKE_PROTOCOL) return null;

  return parseProjectDescriptor(message.project);
}

/** The message this side sends. Exported so the other side can mirror it
 *  without copying a string literal that then drifts. */
export function projectHelloMessage(): { type: string; protocol: number } {
  return { type: PROJECT_HELLO, protocol: PROJECT_HANDSHAKE_PROTOCOL };
}

export interface OfferAcceptance {
  /** The event's origin. */
  origin: string;
  /** The window the event came from. */
  source: unknown;
  /** This document's own origin. */
  selfOrigin: string;
  /** The window that opened this one, if any. */
  opener: unknown;
  /** Whether an offer has already been taken this session. */
  alreadyAccepted: boolean;
}

/**
 * Whether an offer may be acted on. All four conditions, and each for its own
 * reason:
 *
 * - **Same origin.** Anything else is a different application entirely.
 * - **From the opener itself.** Origin alone is not enough — any same-origin
 *   window could post, including one this application never asked for.
 * - **Not already accepted.** A window that changes project mid-session is
 *   exactly the boundary crossing the key exists to catch, so the first answer
 *   is the only one.
 * - **There is an opener.** Without one there is nobody who could legitimately
 *   be answering, and a message claiming otherwise is not from a parent.
 */
export function mayAcceptOffer(state: OfferAcceptance): boolean {
  if (state.alreadyAccepted) return false;
  if (!state.opener) return false;
  if (state.origin !== state.selfOrigin) return false;
  return state.source === state.opener;
}
