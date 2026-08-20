---
'@ifc-lite/drawing-2d': minor
---

Geräte stehen im DXF als zählbare Symbole

Der Plan-Export schrieb Melder als lose Striche. Auf Papier sah das richtig
aus, im CAD war es nichts: man konnte die Rauchmelder nicht zählen, sie nicht
von den Handfeuermeldern unterscheiden und nichts über das einzelne Gerät
erfahren. Ein Errichter, der so einen Plan bekommt, hat ein Bild von einem Plan.

Jetzt gibt es `BLOCK`, `INSERT` und `ATTRIB`:

* **Ein Block je Symbolfamilie, nicht je Gerät.** Zwei Rauchmelder sind
  dasselbe Symbol — eine Datei mit einem Block pro Vorkommen hat den Aufwand
  von Blöcken und keinen ihrer Vorteile. Ein Austausch wirkt damit auf alle
  Platzierungen auf einmal.
* **Name und IFC-Klasse als Attribute**, beide unsichtbar. Eine Auswertung
  liest ein Attribut so oder so, und ein Plan, auf dem neben jedem Gerät sein
  voller Name steht, ist ein Plan, den niemand lesen kann. Ein sichtbares
  Nummernfeld gehört dorthin, sobald es eine kurze Kennung gibt — ein dauerhaft
  leeres Feld läse sich als fehlende Daten.
* **Dieselben Angaben zusätzlich als XDATA**, damit sie einen Umlauf durch
  einen Leser überleben, der unerwartete Attribute verwirft.

Öffnungssymbole bleiben bewusst lose Striche: eine Öffnung gehört zu ihrer
Wand und ist nichts Zählbares — ein Block würde mehr behaupten, als wahr ist.

Ein `INSERT` auf einen Block, den die Datei nicht definiert, wird verweigert
statt geschrieben: das ist der eine Fall, den jeder Leser ablehnt, und die
Datei öffnete sich als Fehlermeldung statt als Zeichnung. Die BLOCKS-Sektion
entsteht nur, wenn wirklich ein Block definiert wurde — R12 verlangt sie nicht,
und eine leere wäre ein Kopf um nichts.
