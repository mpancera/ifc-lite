/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Ribbon · a discipline tab — one of the fork's own registers, painted from
 * its definition as labelled groups of large buttons. The base tabs are each
 * hand-laid; these are generated, because their whole point is that moving a
 * tool between trades is a data change and not a layout job.
 */

import { Fragment } from 'react';
import type { DisciplineTab } from './definitions';
import { DisciplineItemButton } from './DisciplineItemButton';
import { RibbonGroup, RibbonGroupDivider, RibbonLargeButton } from '../ribbon/primitives';

export function DisciplineRibbonTab({ tab }: { tab: DisciplineTab }) {
  return (
    <>
      {tab.groups.map((group, index) => (
        <Fragment key={group.label}>
          {index > 0 && <RibbonGroupDivider />}
          <RibbonGroup label={group.label}>
            {group.items.map((item) => (
              <DisciplineItemButton
                key={item.id}
                item={item}
                render={(state) => (
                  <RibbonLargeButton
                    icon={item.icon}
                    label={item.ribbonLabel ?? item.label}
                    tooltip={item.tooltip}
                    // A dialog trigger is not a latch, so it carries no
                    // aria-pressed at all rather than a permanent "false".
                    active={item.kind === 'dialog' ? undefined : state.active}
                    disabled={state.disabled}
                    onClick={state.onClick}
                  />
                )}
              />
            ))}
          </RibbonGroup>
        </Fragment>
      ))}
    </>
  );
}
