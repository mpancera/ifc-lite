/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ask the window that opened this one which project we are in.
 *
 * The folder settles this by itself when there is one. Opened WITH A FILE
 * rather than a folder — a model handed over as a `blob:` URL, say — there is
 * no folder to read, and the opener is the only thing that knows.
 *
 * Runs once, early, and only when there IS an opener. A viewer somebody
 * navigated to directly never sends anything, never waits, and never mentions
 * it: standalone is the normal case in this application, not a degraded one.
 *
 * The rules for accepting an answer live in `@ifc-lite/project` where they are
 * tested; this hook is the part that needs a window.
 */

import { useEffect, useRef } from 'react';
import {
  mayAcceptOffer, parseProjectOffer, projectHelloMessage,
  PROJECT_OFFER_TIMEOUT_MS, type ProjectDescriptor,
} from '@ifc-lite/project';

export interface UseOpenerProjectOptions {
  /** Called once, with the project the opener named. */
  onProject: (project: ProjectDescriptor) => void;
}

export function useOpenerProject({ onProject }: UseOpenerProjectOptions): void {
  // Held in a ref so a re-render cannot re-arm the handshake and let a second
  // offer through the "first one only" rule.
  const accepted = useRef(false);
  const onProjectRef = useRef(onProject);
  onProjectRef.current = onProject;

  useEffect(() => {
    const opener = window.opener as Window | null;
    if (!opener) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onMessage = (event: MessageEvent) => {
      if (!mayAcceptOffer({
        origin: event.origin,
        source: event.source,
        selfOrigin: window.location.origin,
        opener,
        alreadyAccepted: accepted.current,
      })) return;

      const project = parseProjectOffer(event.data);
      if (!project) return;

      accepted.current = true;
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) clearTimeout(timer);
      onProjectRef.current(project);
    };

    window.addEventListener('message', onMessage);

    // Never '*': the opener served this document, so its origin is known, and
    // broadcasting would tell any listening frame that this window exists.
    opener.postMessage(projectHelloMessage(), window.location.origin);

    // Nobody answered. Not an error and not worth a message — an opener that
    // does not speak this is the ordinary case.
    timer = setTimeout(() => window.removeEventListener('message', onMessage),
      PROJECT_OFFER_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', onMessage);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, []);
}
