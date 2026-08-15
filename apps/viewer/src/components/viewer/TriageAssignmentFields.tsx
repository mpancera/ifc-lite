/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The system and the type a triage group can be given, beside its class.
 *
 * Marc, 2026-08-15: where a group grouped well on its other attributes and the
 * system or the type is simply absent, the triage should be able to supply it.
 * The group is already the right unit — decided once, written to every member.
 *
 * # Existing first, new second
 * Both fields offer what the model already has before offering to create. A
 * model with an `IfcSystem` called "Starkstrom" must not end up with a second
 * one because the triage only knew how to create.
 *
 * # Two decisions, not one control with a mode
 * `IfcRelAssignsToGroup` says which installation an element belongs to;
 * `IfcRelDefinesByType` says what product it is. An element can want either,
 * both or neither.
 */

import React from 'react';
import { Network, Boxes as TypeIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGroupTargets, type GroupTarget } from '@/hooks/useGroupTargets';
import type { AssignmentChoice, GroupAssignment } from '@/lib/classTriage/groupAssignment';

export interface TriageAssignmentFieldsProps {
  /** The class the members will HAVE once the writes land. */
  entity: string | null;
  assignment: GroupAssignment;
  onChange: (assignment: GroupAssignment) => void;
}

function Row({
  icon, label, hint, targets, choice, onPick, newPlaceholder,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  targets: readonly GroupTarget[];
  choice: AssignmentChoice | null;
  onPick: (choice: AssignmentChoice | null) => void;
  newPlaceholder: string;
}): React.ReactElement {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span>{label}</span>
        <span className="font-mono text-[10px]">{hint}</span>
      </div>

      {targets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {targets.map((target) => {
            const picked = choice?.kind === 'existing' && choice.expressId === target.expressId;
            return (
              <Button
                key={target.expressId}
                size="sm"
                variant={picked ? 'default' : 'outline'}
                className="h-5 px-1.5 text-[11px]"
                title={`#${target.expressId} · ${target.ifcClass}`}
                onClick={() => onPick(picked
                  ? null
                  : { kind: 'existing', expressId: target.expressId, name: target.name })}
              >
                {target.name}
              </Button>
            );
          })}
        </div>
      )}

      <Input
        value={choice?.kind === 'new' ? choice.name : ''}
        onChange={(event) => {
          const name = event.target.value;
          onPick(name ? { kind: 'new', name } : null);
        }}
        placeholder={newPlaceholder}
        className="h-6 text-xs"
      />
    </div>
  );
}

export function TriageAssignmentFields({
  entity, assignment, onChange,
}: TriageAssignmentFieldsProps): React.ReactElement {
  const { systems, types, typeClass } = useGroupTargets(true, entity);

  return (
    <div className="space-y-2 border-t pt-2">
      <Row
        icon={<Network className="h-3 w-3" />}
        label="System"
        hint="IfcRelAssignsToGroup"
        targets={systems}
        choice={assignment.system}
        onPick={(system) => onChange({ ...assignment, system })}
        newPlaceholder="oder neues System, z. B. Starkstrom"
      />

      {typeClass ? (
        <Row
          icon={<TypeIcon className="h-3 w-3" />}
          label="Typ"
          hint={`IfcRelDefinesByType → ${typeClass}`}
          targets={types}
          choice={assignment.type}
          onPick={(type) => onChange({ ...assignment, type })}
          newPlaceholder={`oder neuer ${typeClass}, z. B. Motor M1`}
        />
      ) : (
        // Said rather than hidden: "no type field" looks like a bug, "this
        // class has no type class" is an answer.
        <p className="leading-tight text-muted-foreground">
          {entity
            ? `${entity} hat keine Typ-Klasse im Schema — hier lässt sich kein Typ zuweisen.`
            : 'Typ erst nach der Klassenentscheidung — er richtet sich nach ihr.'}
        </p>
      )}
    </div>
  );
}

export default TriageAssignmentFields;
