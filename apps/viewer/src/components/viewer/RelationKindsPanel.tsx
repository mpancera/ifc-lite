/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The relationship kinds a schematic can draw, and what each line means.
 *
 * Read-only, deliberately. The line styles are a first draft to be tuned
 * together, and a reference nobody can break is worth more right now than a
 * settings page that lets one person change what a line means for everyone
 * reading the drawing.
 *
 * Under Settings rather than in the Graph panel because it answers a question
 * about the *vocabulary*, not about the drawing in front of you — the panel's
 * own legend covers that, and lists only the kinds actually on screen.
 *
 * The names and the set of kinds are the Objektkatalog's, so a relation means
 * the same thing here as it does in a Data Template.
 */

import { useState } from 'react';
import { Spline } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RELATION_CATALOGUE } from '@/lib/graph/relationStyle';

interface RelationKindsPanelProps {
  trigger?: React.ReactNode;
}

export function RelationKindsPanel({ trigger }: RelationKindsPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Spline className="h-4 w-4 mr-2" />
            Beziehungsarten
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Beziehungsarten im Graph</DialogTitle>
          <DialogDescription>
            Im Schema trägt die <strong>Linienart</strong> die Beziehungsart, nicht die Farbe — ein
            Ingenieurschema wird gedruckt gelesen, und die Farbe ist für die Ränge vergeben.
            Benennung und Auswahl folgen dem Objektkatalog, damit eine Beziehung hier dasselbe
            heisst wie in einem Data Template.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Linie</th>
                <th className="py-1.5 pr-3 font-medium">Art</th>
                <th className="py-1.5 pr-3 font-medium">IFC-Beziehung</th>
                <th className="py-1.5 font-medium">Bedeutung</th>
              </tr>
            </thead>
            <tbody>
              {RELATION_CATALOGUE.map((r) => (
                <tr key={r.ifcEntity} className="border-b border-border/50 align-top">
                  <td className="py-2 pr-3">
                    <svg width="56" height="10" viewBox="0 0 56 10" aria-hidden="true">
                      <line
                        x1="1" y1="5" x2="55" y2="5"
                        stroke="currentColor"
                        strokeWidth={r.width}
                        strokeDasharray={r.dash}
                      />
                    </svg>
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap font-medium">
                    {r.label}
                    {/* Which kinds a chain can actually produce today. Without
                        it the table reads as a promise the app does not keep. */}
                    {!r.drawable && (
                      <span className="ml-1.5 font-normal text-[10px] text-muted-foreground">
                        noch nicht gezeichnet
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {r.ifcEntity}
                  </td>
                  <td className="py-2 text-muted-foreground">{r.hinweis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Die Linienarten sind ein erster Entwurf und werden gemeinsam angepasst. Änderbar sind sie
          hier noch nicht.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default RelationKindsPanel;
