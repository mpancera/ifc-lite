/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Binding the session to a project folder.
 *
 * Two things are deliberately visible here rather than hidden, because both
 * are surprising the first time and confusing forever after if concealed:
 *
 * 1. **There is no folder path.** The browser does not hand one out — a handle
 *    knows its own name and nothing else. Two folders called `Planung` are
 *    indistinguishable, so a person can give one a name of their own. Showing
 *    an invented path would be worse than admitting the gap.
 * 2. **Access has to be granted again after a restart.** A remembered folder
 *    is not an open one. Reopening needs a click, and that click is the user
 *    gesture the browser requires.
 */

import { useEffect, useState } from 'react';
import { Folder, FolderOpen, Pin, PinOff, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { useViewerStore } from '@/store';
import { folderDisplayName, isDerivedKey } from '@ifc-lite/project';

interface ProjectFolderPanelProps {
  trigger?: React.ReactNode;
}

export function ProjectFolderPanel({ trigger }: ProjectFolderPanelProps) {
  const folder = useViewerStore((s) => s.projectFolder);
  const recents = useViewerStore((s) => s.recentProjects);
  const canBind = useViewerStore((s) => s.canBindProjectFolder);
  const error = useViewerStore((s) => s.projectError);
  const models = useViewerStore((s) => s.models);

  const bind = useViewerStore((s) => s.bindProjectFolder);
  const openRecent = useViewerStore((s) => s.openRecentProject);
  const unbind = useViewerStore((s) => s.unbindProjectFolder);
  const forget = useViewerStore((s) => s.forgetRecentProject);
  const label = useViewerStore((s) => s.labelProject);
  const pin = useViewerStore((s) => s.pinProject);
  const loadRecents = useViewerStore((s) => s.loadRecentProjects);
  const currentKey = useViewerStore((s) => s.currentProjectKey);

  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  // Only when the dialog is actually opened: reading IndexedDB on every app
  // start to fill a list nobody may look at is work for nothing.
  useEffect(() => { if (open) void loadRecents(); }, [open, loadRecents]);

  const key = currentKey();
  const derived = key !== null && isDerivedKey(key);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="outline" size="sm">Projekt</Button>}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Projekt</DialogTitle>
          <DialogDescription>
            Ein Projekt ist ein Ordner. Höhensystem, Zonen und Listen gehören zu
            ihm — beim Wechsel wandern sie mit oder werden verworfen, aber nie
            stillschweigend übernommen.
          </DialogDescription>
        </DialogHeader>

        {/* What is bound now */}
        <div className="rounded-sm border px-3 py-2">
          {folder ? (
            <>
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-emerald-600" />
                <span className="text-[13px]">{folderDisplayName(folder)}</span>
                {folder.label && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Ordner: {folder.name}
                  </span>
                )}
                <Button
                  variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[11px]"
                  onClick={unbind}
                >
                  Lösen
                </Button>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Gebunden. Der Ordner selbst bleibt beim Lösen unberührt.
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="text-[13px]">Kein Ordner gebunden</span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {models.size === 0
                  ? 'Ohne Modelle und ohne Ordner gibt es kein Projekt.'
                  : derived
                    ? 'Die Projektgrenze wird aus den geladenen Modellen abgeleitet. '
                      + 'Das erkennt einen Wechsel, aber dasselbe Projekt morgen nicht wieder.'
                    : 'Die Projektgrenze ist unbestimmt.'}
              </p>
            </>
          )}
        </div>

        {canBind ? (
          <Button variant="outline" size="sm" onClick={() => void bind()}>
            <Folder className="mr-1 h-3.5 w-3.5" />
            Ordner wählen …
          </Button>
        ) : (
          // Not a failure to hide: on Firefox and Safari the API does not
          // exist, and a button that cannot work is worse than a sentence
          // saying so.
          <p className="rounded-sm border border-amber-500/40 bg-amber-50 px-3 py-2 text-[11px] dark:bg-amber-950/30">
            Dieser Browser kann keinen Ordner binden — die File System Access API
            fehlt (Chrome und Edge haben sie). Modelle laden funktioniert
            weiterhin; die Projektgrenze wird dann aus den geladenen Modellen
            abgeleitet.
          </p>
        )}

        {error && (
          <p className="text-[11px] text-red-600 dark:text-red-400">{error}</p>
        )}

        {recents.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Zuletzt verwendet</p>
            <ul className="space-y-1">
              {recents.map((entry) => (
                <li key={entry.id} className="flex items-center gap-1 rounded-sm border px-2 py-1">
                  {renaming === entry.id ? (
                    <form
                      className="flex flex-1 items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const input = e.currentTarget.elements.namedItem('label');
                        if (input instanceof HTMLInputElement) void label(entry.id, input.value);
                        setRenaming(null);
                      }}
                    >
                      <Input
                        name="label" autoFocus defaultValue={entry.label ?? ''}
                        placeholder={entry.name}
                        className="h-6 text-[12px]"
                      />
                      <Button type="submit" size="sm" className="h-6 px-2 text-[11px]">OK</Button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="flex-1 text-left text-[12px] hover:underline"
                        onClick={() => void openRecent(entry.id)}
                        title="Öffnen — der Browser fragt dabei erneut nach Zugriff"
                      >
                        {folderDisplayName(entry)}
                        {entry.label && (
                          <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                            {entry.name}
                          </span>
                        )}
                      </button>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        title="Eigenen Namen vergeben — der Ersatz für den Pfad, den es nicht gibt"
                        onClick={() => setRenaming(entry.id)}
                      >
                        <span className="text-[11px]">✎</span>
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        title={entry.pinned ? 'Nicht mehr anheften' : 'Anheften'}
                        onClick={() => void pin(entry.id, !entry.pinned)}
                      >
                        {entry.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-6 w-6"
                        title="Aus der Liste entfernen — der Ordner bleibt bestehen"
                        onClick={() => void forget(entry.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Ein gemerkter Ordner ist kein offener: der Browser fragt beim
              Öffnen erneut nach Zugriff. Einen Pfad zeigt er nie an — nur den
              Ordnernamen, deshalb der eigene Name.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
