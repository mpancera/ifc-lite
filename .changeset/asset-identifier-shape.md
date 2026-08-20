---
'@ifc-lite/create': minor
'@ifc-lite/viewer': minor
---

Der Asset-Identifier liest sich wie eine Kennzeichnung

Aus `Building.Level 1.Space 1_fire.smoke-detector.001` wird
`A.01.03_FST.RM.001`. Nicht durch Umbenennen im Nachhinein — jedes Segment kam
aus einer Quelle, die etwas anderes enthielt, als sie sollte:

* **Das Gebäude hiess «Building».** `IfcCreator` schrieb den Namen fest. Er ist
  jetzt wählbar (`BuildingName`, `SiteName`), Vorgabe unverändert.
* **Das Geschoss hatte keine lesbare Bezeichnung.** `StoreyParams` kennt jetzt
  `LongName` — dieselbe Trennung wie beim Raum: `Name` trägt die Nummer, der
  Identifier will die Nummer, der Plankopf will die Worte.
* **Räume hiessen «Space 1».** Das Namensmuster kann jetzt auffüllen: `{nn}`
  ergibt `01`, `02`, `03`. `'0{n}'` sieht bis zum zehnten Raum richtig aus.
* **Der Typ trug die Katalog-ID als Tag.** Die ID ist ein Schlüssel und wird
  nie gezeigt; das Tag ist, was jemand auf einen Plan schreibt. Der Katalog
  führt jetzt beides, das Tag steht am Typ (`RM`, `WM`, `HFM`, `Si`) und die ID
  im dafür vorgesehenen `ElementType`, das auch der Wiederverwendungsschlüssel
  ist.
* **Das Gewerk fehlte ganz.** Es kommt aus der Disziplin des Produkts, nicht
  aus der Anlage, in die es platziert wurde: eine Kamera, die man bei aktiver
  Brandmelderolle setzt, ist immer noch eine Kamera. Es reist als Eigenschaft
  am Typ, weil es eine ist — kein Attribut auf `IfcTypeProduct` bedeutet
  «welches Gewerk», und eines zweckzuentfremden liesse die Datei jeden anderen
  Leser anlügen.

Nur `fire → FST` ist hinterlegt. Die übrigen Gewerke sind absichtlich leer statt
geraten: ein Identifier wird in Abgaben zitiert und am Telefon durchgegeben, und
ein erfundenes Kürzel ist schlimmer als ein sichtbar fehlendes Segment.

Damit ein fehlendes Kürzel nicht auch die Struktur mitnimmt, kann ein Segment
seinen Trenner weitergeben (`handOnSeparator`). Das `_` markiert, wo der Ort
aufhört und das Gerät anfängt — ohne Gewerk bleibt `A.01.03_RM.001` und wird
nicht zu `A.01.03.RM.001`, einer flachen Kette ohne die Grenze, um die herum der
Identifier gebaut ist.

Und eine Regel kann jetzt eine EIGENSCHAFT lesen, nicht nur ein Attribut.
