---
'@ifc-lite/viewer': minor
---

Was eine Vorführung zeigen muss, lässt sich auch ansteuern

Vier Stellen, an denen der Zustand nur im Kopf einer Komponente lag und darum
weder von der Kommandopalette noch von einem Flow erreichbar war:

**Der 2D-Zeiger traf nicht.** Ein Beat, der eine Wand nachzieht, projizierte
Gebäudekoordinaten durch die 3D-Kamera — die einzige Projektion, die der Store
kennt —, während der Grundriss auf dem Schirm war. Der gezeichnete Cursor stand
damit in jedem 2D-Beat neben der Linie, die er zog. Der Plan veröffentlicht
jetzt seinen eigenen Transform, und `null`, sobald er nicht montiert ist, was
genau das Signal ist, auf die Kamera zurückzufallen.

**Die Rolle wechselte ohne sichtbaren Grund.** Der Rollendialog lässt sich
jetzt von aussen öffnen, über dieselbe Einmal-Übergabe wie der Flavor-Dialog.
Die Rolle entscheidet, ob überhaupt etwas geschrieben werden darf; wenn sie
umspringt, ohne dass jemand sie gesehen hat, liest sich das, als entscheide die
Software selbst.

**Die untere Leiste war 300 px hoch, immer.** Die Höhe liegt jetzt im Store.
Eine Tabelle mit fünf Zeilen und ein Kettengraph brauchen beide mehr, bevor man
etwas erkennt. Der Wert ist eine Bitte: das Layout begrenzt weiterhin selbst,
damit niemand eine Leiste bestellen kann, die höher ist als das Fenster.

**Die Liste konnte nur von Hand exportiert werden.** `requestListExport`
löst den Export der Liste aus, die gerade auf dem Schirm steht. Gebaut wird das
Exportmodell weiterhin in der Tabelle, aus dem, was sie tatsächlich zeigt — ein
zweiter Modellbauer anderswo würde von der Tabelle abweichen, die er zu
exportieren behauptet.

Dazu eine Meldung, die log: Ein Grundriss ohne Bauteile, aber mit hinterlegter
Zeichnung sagte «Aus diesem Modell liessen sich keine Geschosse mit Geometrie
lesen», während die Zeichnung sichtbar dalag. Das ist der Anfangszustand des
Nachzeichnens, kein Fehler, und liest sich jetzt auch so.
