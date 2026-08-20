---
'@ifc-lite/viewer': patch
---

Zwei Leser sahen nicht, was in dieser Sitzung entstanden ist

**Der Zonen-Pinsel lehnte jeden selbst gezeichneten Raum ab.** `IfcZonePanel`
las die Klasse eines Bauteils nur aus der geparsten Datei. Ein Raum, den man
gerade gezeichnet hat, steht dort nicht — die Klasse kam als `Unknown` zurück
und der Pinsel antwortete «Unknown kann nicht Mitglied einer Zone sein — IFC
lässt nur Räume zu». Räume zeichnen und sie dann gruppieren ist die normale
Reihenfolge, kein Sonderfall; das Werkzeug sagte an genau dieser Stelle nein.

**Die Lens färbte nichts.** Der Lens-Adapter prüft über die Raumhierarchie, ob
ein Bauteil ein Produkt ist — der Test soll Punkte, Richtungen und Profile
aussortieren. Die geparste Hierarchie kennt aber nur, was aus der Datei kam,
also fiel in einem Modell, das ganz in dieser Sitzung entstanden ist, jedes
Bauteil durch: die Lens ging über frisch gemalten Zonen auf und färbte
0 Elemente. Der Test fragt jetzt zusätzlich das Overlay, über Containment und
Aggregation — Wände und Geräte kommen auf dem einen Weg, Räume auf dem anderen.

Dazu: `GraphPanel` verwarf die Kettenauswahl in einem Effekt, der die Auswahl
bei einem *Modellwechsel* ungültig machen soll — er lief aber auch beim ersten
Mounten. Wer den Graph einstellt und ihn dann aufdeckt, verlor damit genau die
Einstellung, die er gerade gemacht hat.
