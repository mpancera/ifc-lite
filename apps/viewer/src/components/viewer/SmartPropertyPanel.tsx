/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Editor for rule-driven property values.
 *
 * Laid out as a row of segments, matching how the value reads: each column is
 * a separator, a source, and what happens when that source is empty. The point
 * of showing the fallback next to the source — rather than behind a settings
 * icon — is that in real models it fires constantly, so it is part of reading
 * the rule, not an edge case.
 *
 * The preview evaluates through the SAME resolver the rules use in anger.
 * Reimplementing it here would be the third time this fork produced a view
 * that disagreed with the data behind it.
 */

import { useMemo, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/toast';
import { useViewerStore } from '@/store';
import { useSmartPropertyRules } from '@/hooks/useSmartPropertyRules';
import { evaluateRule } from '@/lib/smartProperties/evaluate';
import { makeModelResolver } from '@/lib/smartProperties/modelResolver';
import { makeModelCounterResolver } from '@/lib/smartProperties/modelCounter';
import { isCounter, type RuleSegment, type SmartPropertyRule, type ValueScope } from '@/lib/smartProperties/types';

const SCOPES: ReadonlyArray<{ value: ValueScope; label: string }> = [
  { value: 'IfcSite', label: 'Areal' },
  { value: 'IfcBuilding', label: 'Gebäude' },
  { value: 'IfcBuildingStorey', label: 'Geschoss' },
  { value: 'IfcSpace', label: 'Raum' },
  { value: 'IfcEntity', label: 'Bauteil' },
  { value: 'IfcEntityType', label: 'Produkttyp' },
];

const FIELDS = ['Name', 'LongName', 'Tag', 'Description', 'ObjectType'] as const;

/** Encodes a source as one select value, so the picker stays a single control. */
const COUNTER_VALUE = 'counter';
const encodeSource = (segment: RuleSegment): string =>
  isCounter(segment.source) ? COUNTER_VALUE : `${segment.source.scope}.${segment.source.field}`;

function decodeSource(value: string): RuleSegment['source'] {
  if (value === COUNTER_VALUE) {
    return { kind: 'counter', width: 3, scopedBy: ['IfcSpace', 'IfcEntityType'] };
  }
  const [scope, field] = value.split('.');
  return { scope: scope as ValueScope, field };
}

function SourcePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[168px] font-mono text-[11px]">
        <span className="truncate">{value === COUNTER_VALUE ? 'Zähler' : value}</span>
      </SelectTrigger>
      <SelectContent>
        {SCOPES.map((scope) => (
          <SelectGroup key={scope.value}>
            <SelectLabel className="font-mono text-[10px] uppercase">{scope.label}</SelectLabel>
            {FIELDS.map((field) => (
              <SelectItem key={`${scope.value}.${field}`} value={`${scope.value}.${field}`} className="font-mono text-[11px]">
                {scope.value}.{field}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        <SelectGroup>
          <SelectLabel className="font-mono text-[10px] uppercase">Sonstige</SelectLabel>
          <SelectItem value={COUNTER_VALUE} className="font-mono text-[11px]">
            Zähler (fortlaufend)
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function SegmentColumn({
  segment, index, onChange, onRemove,
}: {
  segment: RuleSegment;
  index: number;
  onChange: (next: RuleSegment) => void;
  onRemove: () => void;
}) {
  const fallbackKind = segment.fallback.kind;

  return (
    <div className="shrink-0 w-[200px] space-y-1.5">
      <div className="flex items-center justify-between h-5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600">
          {index === 0 ? 'Wurzel' : 'Baustein'}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
          aria-label="Baustein entfernen"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <Input
          value={segment.separator ?? ''}
          onChange={(e) => onChange({ ...segment, separator: e.target.value })}
          placeholder={index === 0 ? '—' : '.'}
          disabled={index === 0}
          className="h-8 w-8 px-0 text-center font-mono text-[11px]"
          title={index === 0 ? 'Das erste Segment hat kein Trennzeichen' : 'Trennzeichen davor'}
        />
        <SourcePicker
          value={encodeSource(segment)}
          onChange={(v) => onChange({ ...segment, source: decodeSource(v) })}
        />
      </div>

      <Select
        value={fallbackKind}
        onValueChange={(kind) => onChange({
          ...segment,
          fallback: kind === 'alternative'
            ? { kind: 'alternative', separator: segment.separator, source: { scope: 'IfcEntity', field: 'Name' } }
            : { kind: kind as 'warn' | 'omit' },
        })}
      >
        <SelectTrigger className="h-7 font-mono text-[10px]">
          <span className="truncate">
            {fallbackKind === 'warn' ? 'Wenn leer: warnen'
              : fallbackKind === 'omit' ? 'Wenn leer: weglassen'
                : 'Wenn leer: Ersatzquelle'}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="omit" className="font-mono text-[11px]">weglassen (mit Trennzeichen)</SelectItem>
          <SelectItem value="warn" className="font-mono text-[11px]">warnen</SelectItem>
          <SelectItem value="alternative" className="font-mono text-[11px]">Ersatzquelle</SelectItem>
        </SelectContent>
      </Select>

      {segment.fallback.kind === 'alternative' && (
        <SourcePicker
          value={`${segment.fallback.source.scope}.${segment.fallback.source.field}`}
          onChange={(v) => {
            const decoded = decodeSource(v);
            if (isCounter(decoded)) return; // a counter never yields nothing
            onChange({ ...segment, fallback: { kind: 'alternative', separator: segment.separator, source: decoded } });
          }}
        />
      )}
    </div>
  );
}

interface SmartPropertyPanelProps {
  trigger?: React.ReactNode;
}

export function SmartPropertyPanel({ trigger }: SmartPropertyPanelProps) {
  const [open, setOpen] = useState(false);
  const { rules, isDefault, commit, reset } = useSmartPropertyRules();
  const [draft, setDraft] = useState<SmartPropertyRule | null>(null);

  const rule = draft ?? rules[0] ?? null;

  const activeModelId = useViewerStore((s) => s.activeModelId);
  const models = useViewerStore((s) => s.models);
  const mutationViews = useViewerStore((s) => s.mutationViews);
  const selectedEntityId = useViewerStore((s) => s.selectedEntityId);
  const mutationVersion = useViewerStore((s) => s.mutationVersion);

  /** What this rule would produce for the current selection. */
  const preview = useMemo(() => {
    if (!rule || !activeModelId || selectedEntityId == null) return null;
    const store = models.get(activeModelId)?.ifcDataStore;
    const view = mutationViews.get(activeModelId);
    if (!store || !view) return null;
    try {
      const resolve = makeModelResolver({ store, view });
      // No `store` callback — a preview must never hand out a number.
      const resolveCounter = makeModelCounterResolver({
        view, resolve, pset: rule.target.pset, applicability: rule.applicability,
      });
      return evaluateRule(rule, selectedEntityId, resolve, resolveCounter);
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, activeModelId, models, mutationViews, selectedEntityId, mutationVersion]);

  if (!rule) return null;

  const update = (next: SmartPropertyRule) => setDraft(next);
  const dirty = draft !== null;

  const save = async () => {
    if (!draft) return;
    await commit([draft, ...rules.filter((r) => r.id !== draft.id)]);
    setDraft(null);
    toast.success('Regel gespeichert — bestehende Bauteile werden nachgeführt.');
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setDraft(null); }}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Wand2 className="h-4 w-4 mr-2" />
            Smart Property
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-5xl max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
          <DialogTitle>Smart Property</DialogTitle>
          <DialogDescription>
            Setzt einen Eigenschaftswert aus dem Modell zusammen. Wird beim Platzieren gefüllt
            und nachgeführt, wenn sich eine Quelle ändert.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-auto">
          <div className="px-6 py-4 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  Gilt für (IFC-Klassen, kommagetrennt)
                </Label>
                <Input
                  value={rule.applicability.join(', ')}
                  onChange={(e) => update({
                    ...rule,
                    applicability: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })}
                  className="h-8 font-mono text-[11px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  Ziel (Pset · Eigenschaft)
                </Label>
                <div className="flex gap-1">
                  <Input
                    value={rule.target.pset}
                    onChange={(e) => update({ ...rule, target: { ...rule.target, pset: e.target.value } })}
                    className="h-8 font-mono text-[11px]"
                  />
                  <Input
                    value={rule.target.property}
                    onChange={(e) => update({ ...rule, target: { ...rule.target, property: e.target.value } })}
                    className="h-8 w-[150px] font-mono text-[11px]"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  Zusammensetzung
                </Label>
                <Button
                  variant="ghost" size="sm" className="h-6 text-[11px]"
                  onClick={() => update({
                    ...rule,
                    segments: [...rule.segments, {
                      separator: '.', source: { scope: 'IfcEntity', field: 'Name' }, fallback: { kind: 'omit' },
                    }],
                  })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Baustein
                </Button>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {rule.segments.map((segment, index) => (
                  <SegmentColumn
                    key={index}
                    segment={segment}
                    index={index}
                    onChange={(next) => update({
                      ...rule,
                      segments: rule.segments.map((s, i) => (i === index ? next : s)),
                    })}
                    onRemove={() => update({
                      ...rule,
                      segments: rule.segments.filter((_, i) => i !== index),
                    })}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-sm border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
              <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-400 dark:text-zinc-600 mb-1">
                Vorschau · gewähltes Bauteil
              </p>
              {preview ? (
                <>
                  <p className="text-[13px] font-mono text-zinc-900 dark:text-zinc-100 break-all">
                    {preview.value || '(leer)'}
                  </p>
                  {(preview.warnings.length > 0 || preview.omitted.length > 0) && (
                    <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 mt-1">
                      {preview.warnings.length > 0 && `fehlt: ${preview.warnings.join(', ')}`}
                      {preview.warnings.length > 0 && preview.omitted.length > 0 && ' · '}
                      {preview.omitted.length > 0 && `weggelassen: ${preview.omitted.join(', ')}`}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                  Ein Bauteil auswählen, um das Ergebnis zu sehen.
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t shrink-0 sm:justify-between gap-2">
          <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-600 self-center mr-auto">
            {isDefault ? 'Mitgelieferte Regel' : 'Eigene Regel'}
          </span>
          <div className="flex gap-2">
            {!isDefault && (
              <Button variant="ghost" size="sm" onClick={() => { void reset(); setDraft(null); }}>
                Auf Standard zurücksetzen
              </Button>
            )}
            <Button size="sm" disabled={!dirty} onClick={() => { void save(); }}>
              Speichern
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
