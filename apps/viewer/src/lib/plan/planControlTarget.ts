/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Telling the plan's own controls apart from the drawing under them.
 *
 * The toolbar, the layer menu, the scale bar and the rest are CHILDREN of the
 * element that carries the plan's mouse handlers, so their clicks bubble into
 * it — and the plan makes its selection on mouse-UP, at the cursor. Pressing
 * the "3D" button therefore selected whatever line happened to lie beneath the
 * button. From the outside that reads as: switch the view, and something other
 * than what you had is selected.
 *
 * Matched by what a control IS rather than by marking each one, because the
 * alternative is a rule every future control has to remember, and the failure
 * mode of forgetting is silent.
 */

/** Interactive things. A canvas or an SVG overlay is not one of them. */
const CONTROL_SELECTOR = [
  'button', 'a', 'input', 'select', 'textarea', 'label',
  '[role="button"]', '[role="menu"]', '[role="menuitem"]',
  '[role="dialog"]', '[role="slider"]', '[role="tab"]',
].join(', ');

/**
 * Whether an event's target belongs to the plan's controls.
 *
 * Walks up from the target, so a click on the icon or the text inside a button
 * counts as a click on the button.
 */
export function isPlanControlTarget(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.closest(CONTROL_SELECTOR) !== null;
}
