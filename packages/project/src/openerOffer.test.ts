/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The acceptance rules ARE the security argument for this channel, so they are
 * tested one condition at a time rather than through a happy path that would
 * pass with any three of the four in place.
 */

import { describe, it, expect } from 'vitest';
import { projectKeyFromModels } from './key.js';
import {
  mayAcceptOffer, parseProjectOffer, projectHelloMessage,
  PROJECT_HANDSHAKE_PROTOCOL, PROJECT_OFFER,
} from './openerOffer.js';

const KEY = 'proj_0123456789abcdef0123456789abcdef';
const offer = (over: Record<string, unknown> = {}) => ({
  type: PROJECT_OFFER,
  protocol: PROJECT_HANDSHAKE_PROTOCOL,
  project: { key: KEY, name: 'Nordbau', number: '017' },
  ...over,
});

describe('parseProjectOffer', () => {
  it('reads a well-formed offer', () => {
    expect(parseProjectOffer(offer())).toEqual({ key: KEY, name: 'Nordbau', number: '017' });
  });

  it('ignores a message of another type', () => {
    // The same window may be used for other traffic; this must not claim it.
    expect(parseProjectOffer(offer({ type: 'SOMETHING_ELSE' }))).toBeNull();
  });

  it('refuses a protocol it does not know', () => {
    // Refused rather than read optimistically: the point of the number is that
    // a later shape might mean something different.
    expect(parseProjectOffer(offer({ protocol: 2 }))).toBeNull();
    expect(parseProjectOffer(offer({ protocol: undefined }))).toBeNull();
  });

  it('validates the project as strictly as one read off disk', () => {
    // A key arriving by message is no more trustworthy than one on disk.
    expect(parseProjectOffer(offer({ project: { key: 'x' } }))).toBeNull();
    expect(parseProjectOffer(offer({ project: null }))).toBeNull();
    expect(parseProjectOffer(offer({
      project: { key: projectKeyFromModels(['a.ifc']) },
    }))).toBeNull();
  });

  it('shrugs off anything that is not a message object', () => {
    for (const bad of [null, undefined, 'PROJECT_OFFER', 42, []]) {
      expect(parseProjectOffer(bad)).toBeNull();
    }
  });
});

describe('mayAcceptOffer', () => {
  const opener = { name: 'opener' };
  const base = {
    origin: 'https://example.test',
    source: opener,
    selfOrigin: 'https://example.test',
    opener,
    alreadyAccepted: false,
  };

  it('accepts when every condition holds', () => {
    expect(mayAcceptOffer(base)).toBe(true);
  });

  it('refuses a different origin', () => {
    expect(mayAcceptOffer({ ...base, origin: 'https://elsewhere.test' })).toBe(false);
  });

  it('refuses a same-origin window that is not the opener', () => {
    // The condition most easily left out, and the one that matters most:
    // origin alone would let any same-origin window plant a project.
    expect(mayAcceptOffer({ ...base, source: { name: 'someone else' } })).toBe(false);
  });

  it('refuses when there is no opener at all', () => {
    // Nobody could legitimately be answering, so a message claiming to is not
    // from a parent.
    expect(mayAcceptOffer({ ...base, opener: null, source: null })).toBe(false);
  });

  it('refuses a second offer', () => {
    // A window that changes project mid-session is exactly the boundary
    // crossing the key exists to catch.
    expect(mayAcceptOffer({ ...base, alreadyAccepted: true })).toBe(false);
  });
});

describe('projectHelloMessage', () => {
  it('carries the protocol, so the other side can refuse an old one', () => {
    expect(projectHelloMessage()).toEqual({
      type: 'PROJECT_HELLO', protocol: PROJECT_HANDSHAKE_PROTOCOL,
    });
  });
});
