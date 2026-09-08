/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Classic strip · the Disciplines menu — the same five registers the ribbon
 * shows as tabs, folded into one dropdown with a submenu per discipline.
 *
 * One button rather than five: the classic strip is a single row that is
 * already full, and a user who chose it chose density. The submenus keep the
 * ribbon's grouping (a label per group, a separator between groups) so the
 * geography is the same in both styles, only flattened.
 */

import { Fragment } from 'react';
import { HardHat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DISCIPLINE_TABS, type DisciplineItem } from './definitions';
import { DisciplineItemButton, type DisciplineItemState } from './DisciplineItemButton';

function MenuRow({ item, state }: { item: DisciplineItem; state: DisciplineItemState }) {
  const Icon = item.icon;
  const body = (
    <>
      <Icon className="h-4 w-4 mr-2" />
      {item.label}
    </>
  );
  // A dialog trigger must keep the menu open until the dialog takes over,
  // otherwise Radix unmounts the trigger before the dialog can mount.
  if (item.kind === 'dialog') {
    return (
      <DropdownMenuItem onSelect={(e) => e.preventDefault()} disabled={state.disabled} title={item.tooltip}>
        {body}
      </DropdownMenuItem>
    );
  }
  // A plain command with no on/off state gets a plain row, not an unchecked box.
  if (item.kind === 'action' && !item.isActive) {
    return (
      <DropdownMenuItem onSelect={state.onClick} disabled={state.disabled} title={item.tooltip}>
        {body}
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuCheckboxItem
      checked={state.active}
      disabled={state.disabled}
      onCheckedChange={state.onClick}
      title={item.tooltip}
    >
      {body}
    </DropdownMenuCheckboxItem>
  );
}

export function DisciplinesMenu() {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Disciplines">
              <HardHat className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Disciplines — Data, Architecture, Fire, Security, Automation</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        {DISCIPLINE_TABS.map((tab) => (
          <DropdownMenuSub key={tab.id}>
            <DropdownMenuSubTrigger title={tab.intro}>{tab.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              {tab.groups.map((group, index) => (
                <Fragment key={group.label}>
                  {index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </DropdownMenuLabel>
                  {group.items.map((item) => (
                    <DisciplineItemButton
                      key={item.id}
                      item={item}
                      render={(state) => <MenuRow item={item} state={state} />}
                    />
                  ))}
                </Fragment>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
