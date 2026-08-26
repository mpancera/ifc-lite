/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  planSesCatalogRequest, describeSesCatalogFailure, describeSesCatalogGap,
  DEFAULT_SES_CATALOG_URL, SES_ATTRIBUTION,
} from './sesCatalogProxy.js';

const CONFIGURED = {
  SES_CATALOG_CLIENT_ID: 'abc.access',
  SES_CATALOG_CLIENT_SECRET: 'shhh',
};

describe('planSesCatalogRequest', () => {
  it('sends the credential in the headers Access expects', () => {
    const plan = planSesCatalogRequest(CONFIGURED);
    assert.equal(plan.kind, 'request');
    if (plan.kind !== 'request') return;
    assert.equal(plan.request.headers['CF-Access-Client-Id'], 'abc.access');
    assert.equal(plan.request.headers['CF-Access-Client-Secret'], 'shhh');
  });

  it('falls back to the dictionary address', () => {
    const plan = planSesCatalogRequest(CONFIGURED);
    assert.equal(plan.kind === 'request' && plan.request.url, DEFAULT_SES_CATALOG_URL);
  });

  it('lets a deployment point somewhere else', () => {
    // A staging dictionary has its own address and its own service access;
    // hard-coding one would make the two impossible to tell apart.
    const plan = planSesCatalogRequest({ ...CONFIGURED, SES_CATALOG_URL: 'https://staging/api/x' });
    assert.equal(plan.kind === 'request' && plan.request.url, 'https://staging/api/x');
  });

  it('reports an unconfigured deployment instead of trying', () => {
    const plan = planSesCatalogRequest({});
    assert.equal(plan.kind, 'unconfigured');
    if (plan.kind !== 'unconfigured') return;
    assert.deepEqual([...plan.missing], ['SES_CATALOG_CLIENT_ID', 'SES_CATALOG_CLIENT_SECRET']);
  });

  it('names the half that is missing', () => {
    // Half a credential produces a redirect to a login page, which is a much
    // harder symptom to read than being told which value is absent.
    const plan = planSesCatalogRequest({ SES_CATALOG_CLIENT_ID: 'abc.access' });
    assert.deepEqual(
      plan.kind === 'unconfigured' ? [...plan.missing] : [],
      ['SES_CATALOG_CLIENT_SECRET'],
    );
  });

  it('treats blank settings as absent', () => {
    // Pages writes an empty string for a variable that was created and never
    // filled in; sending that is the same as sending nothing.
    const plan = planSesCatalogRequest({ SES_CATALOG_CLIENT_ID: '  ', SES_CATALOG_CLIENT_SECRET: '' });
    assert.equal(plan.kind, 'unconfigured');
  });

  it('trims a pasted credential', () => {
    const plan = planSesCatalogRequest({
      SES_CATALOG_CLIENT_ID: ' abc.access\n',
      SES_CATALOG_CLIENT_SECRET: ' shhh ',
    });
    assert.equal(plan.kind === 'request' && plan.request.headers['CF-Access-Client-Id'], 'abc.access');
  });
});

describe('describeSesCatalogFailure', () => {
  it('explains the redirect that means the policy is wrong', () => {
    // The single most likely misconfiguration: an "Allow" policy sends a
    // service token into a sign-in flow it cannot complete.
    assert.match(describeSesCatalogFailure(302), /Service Auth/);
  });

  it('separates a withdrawn access from a wrong address', () => {
    assert.match(describeSesCatalogFailure(403), /withdrawn|expired/);
    assert.match(describeSesCatalogFailure(404), /no catalogue/);
  });

  it('still says something useful about an unexpected status', () => {
    assert.match(describeSesCatalogFailure(500), /500/);
  });
});

describe('describeSesCatalogGap', () => {
  it('says the symbols are licensed by name, not inherited by a copy', () => {
    const text = describeSesCatalogGap(['SES_CATALOG_CLIENT_SECRET']);
    assert.match(text, /SES_CATALOG_CLIENT_SECRET/);
    assert.match(text, /by name/);
  });
});

describe('SES_ATTRIBUTION', () => {
  it('is the association name exactly as it asked to be named', () => {
    // The whole of what was asked in return. A paraphrase here would quietly
    // break the terms the symbols are used under.
    assert.equal(SES_ATTRIBUTION, 'Verband Schweizerischer Errichter von Sicherheitsanlagen (SES)');
  });
});
