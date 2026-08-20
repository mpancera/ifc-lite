---
'@ifc-lite/viewer': minor
---

Der Stapellauf für Exportprodukte gibt jetzt wirklich aus

Die Liste der Exportprodukte gab es schon — mit Reihenfolge, Format und
Auswahl, gespeichert je Projekt. Der Knopf darunter war dauerhaft deaktiviert:
«Stapellauf noch nicht gebaut». Jetzt läuft er.

**Er fährt den Grundriss durch die Blätter, statt daneben zu rendern.** Eine
Zeichnung ist, was auf dem Schirm steht: das Geschoss, das geschnitten wird,
das Planprodukt mit seinen Symbolen und seiner Drehung, die eingeschalteten
Ebenen. Ein Lauf, der diesen Zustand woanders zusammensetzt, schreibt eine
Datei, die nicht der entspricht, die jemand freigegeben hat — und weicht ab,
sobald sich eine der beiden Seiten ändert.

**Er wartet auf jedes Blatt.** Ohne das Warten trägt die zweite Datei den
Namen des zweiten Produkts und den Inhalt des ersten. Der Grundriss
veröffentlicht dafür, was er gerade zeichnet.

**Er verweigert vorher, nicht mittendrin.** Jede Sperre wird vor dem ersten
Schreiben geprüft: vier Dateien und ein Abbruch bei der fünften hinterlassen
eine halbe Abgabe, der man nicht ansieht, welche Hälfte fehlt.

**Er hört nach einem Fehlschlag nicht auf.** Ein Blatt, das nicht kommt, wird
als solches gemeldet und der Rest läuft weiter — und ein Geschoss, auf dem in
Schnitthöhe nichts liegt, wird verweigert statt als leere, gültige Datei
ausgegeben. Eine leere Zeichnung ist schlimmer als ein Fehler, weil sie wie
eine gelieferte aussieht.

Als gewöhnliche Funktion und nicht als Hook: die Schreiber sind über
`requestPlanExport` ohnehin erreichbar, übrig bleibt eine Abfolge mit
Wartepunkten. Ein Hook hätte den Lauf an die Lebensdauer einer Komponente
gebunden — wer mitten im Stapel wegnavigiert, hätte eine halbe Abgabe ohne
Fehlermeldung.
