/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Picks the discipline role, which decides two things at once: which
 * installation placed elements join, and whether the reference model may be
 * changed at all.
 *
 * It used to live inside the Add Element panel, visible only while the library
 * type was selected. That was fine while the role only grouped placements; now
 * that it governs write access it has to be reachable and readable without
 * being mid-placement.
 */


import { Eye, HardHat, Lock, Unlock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useViewerStore } from '@/store';
import {
  DISCIPLINE_ROLES,
  EDITOR_ROLE_ID,
  VIEWER_ROLE_ID,
  findDisciplineSystem,
  type DisciplineSystem,
} from '@/lib/roles/disciplineRoles';

function RoleOption({
  active, title, subtitle, onSelect,
}: { active: boolean; title: string; subtitle: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2 rounded-sm border transition-colors ${
        active
          ? 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/30'
          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
      }`}
    >
      <span className="block text-[13px] text-zinc-900 dark:text-zinc-100">{title}</span>
      <span className="block text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-0.5">
        {subtitle}
      </span>
    </button>
  );
}

interface DisciplineRolePanelProps {
  trigger?: React.ReactNode;
}

export function DisciplineRolePanel({ trigger }: DisciplineRolePanelProps) {
  // Open state in the store rather than here, so a caller elsewhere — a demo,
  // the command palette — can both show the roles and put them away again. The
  // role governs whether anything may be written at all; one that flips with
  // nobody having seen it reads as the software deciding for itself.
  const open = useViewerStore((s) => s.roleDialogOpen);
  const setOpen = useViewerStore((s) => s.setRoleDialogOpen);
  const activeId = useViewerStore((s) => s.activeDisciplineSystemId);
  const setActiveId = useViewerStore((s) => s.setActiveDisciplineSystemId);
  const active: DisciplineSystem | null = findDisciplineSystem(activeId);

  // Three levels of write access, each with its own colour so the current one
  // is readable at a glance rather than inferred from which option is ticked.
  const access = activeId === VIEWER_ROLE_ID
    ? {
      Icon: Eye,
      tone: 'border-sky-200 dark:border-sky-900 bg-sky-50/60 dark:bg-sky-950/20',
      iconTone: 'text-sky-600 dark:text-sky-400',
      text: 'Schreibgeschützt: das Modell lässt sich ansehen, auswerten und exportieren, '
        + 'aber nicht verändern.',
    }
    : active
      ? {
        Icon: Lock,
        tone: 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/20',
        iconTone: 'text-emerald-600 dark:text-emerald-400',
        text: 'Referenzmodell geschützt: es sind nur Ergänzungen möglich. Bauteile des '
          + 'Architekturmodells lassen sich nicht ändern oder löschen.',
      }
      : {
        Icon: Unlock,
        tone: 'border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20',
        iconTone: 'text-amber-600 dark:text-amber-400',
        text: 'Editor: Korrekturen am Referenzmodell sind erlaubt. Solche Änderungen '
          + 'erscheinen unter „Änderungen am Referenzmodell".',
      };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <HardHat className="h-4 w-4 mr-2" />
            Fachrolle
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fachrolle</DialogTitle>
          <DialogDescription>
            Bestimmt, welcher Anlage platzierte Bauteile beitreten — und ob am Referenzmodell
            überhaupt etwas geändert werden darf.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className={`flex items-start gap-2.5 rounded-sm border px-3 py-2.5 ${access.tone}`}>
            <access.Icon className={`h-4 w-4 shrink-0 mt-0.5 ${access.iconTone}`} />
            <p className="text-[11px] font-mono leading-relaxed text-zinc-600 dark:text-zinc-300">
              {access.text}
            </p>
          </div>

          <div className="space-y-1.5">
            <RoleOption
              active={activeId === VIEWER_ROLE_ID}
              title="Viewer"
              subtitle="Nur lesen · nichts wird verändert"
              onSelect={() => setActiveId(VIEWER_ROLE_ID)}
            />
            <RoleOption
              active={activeId === EDITOR_ROLE_ID}
              title="Editor"
              subtitle="Keine Anlagenzuordnung · Referenzmodell änderbar"
              onSelect={() => setActiveId(EDITOR_ROLE_ID)}
            />
            {DISCIPLINE_ROLES.map((role) => (
              <div key={role.id} className="pt-1.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1">
                  {role.label}
                </p>
                <div className="space-y-1">
                  {role.systems.map((system) => (
                    <RoleOption
                      key={system.id}
                      active={activeId === system.id}
                      title={system.label}
                      subtitle={`IfcDistributionSystem.${system.predefinedType} (${system.objectType})`}
                      onSelect={() => setActiveId(system.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
