# Georeferenzierung nachrüsten

**Stand:** Entwurf, 2026-08-10 · **Anlass:** Architekturmodell 004_MOD_ARC

## Worum es geht

Viele Fachmodelle kommen ohne brauchbare Georeferenzierung aus der
Autorensoftware. Der Editor kann die Werte schon speichern und exportieren —
was fehlt, ist ein Weg, sie **herzuleiten**, statt sie abzufragen.

Der Auslöser ist ein reales Modell. Es trug eine `IfcMapConversion`, aber mit
Werten ausserhalb jedes Schweizer Koordinatenbereichs, und eine
`IfcSite`-Referenzkoordinate, die auf San Francisco zeigte — der
Autodesk-Werksvorgabewert. Zusammen mit einem korrekt referenzierten
Geländemodell ergab das im Viewer 103 m Versatz.

Der Fehler war rekonstruierbar: die Datei enthielt eine flache Platte namens
„Geländemodell" mit 138.179 × 148.781 m Ausdehnung. Die amtliche Parzelle misst
138.200 × 148.700 m. Aus dieser Deckung liess sich der wahre Nullpunkt des
Modells auf wenige Zentimeter zurückrechnen. Was von Hand geht, geht auch
maschinell.

## Was heute schon da ist

`GeoreferencingPanel.tsx` zeigt und bearbeitet `IfcProjectedCRS` und
`IfcMapConversion` feldweise. `step-exporter.ts` legt beide Entitäten neu an,
wenn sie in der Quelldatei fehlen. Es gibt eine EPSG-Suche, eine Minikarte zum
Positionieren und eine Übernahme der abgetasteten Geländehöhe.

Die Grenzen:

- Die Beschriftungen sind Schema-Bezeichner. `XAxisAbscissa` / `XAxisOrdinate`
  sind Cosinus und Sinus des Nordwinkels — ohne Normkenntnis nicht bedienbar.
  Die Winkelzeile darunter hilft, steht aber an dritter Stelle.
- Der Einstieg setzt alle Werte auf null. Die Zahlen muss man mitbringen.
- Es gibt keine Plausibilisierung. Der Fehlerfall oben wäre unbemerkt
  durchgelaufen.
- Der Kartenpick trifft auf einige Meter genau. Für Kataster zu grob.

## Vorschlag: drei Wege zu den Zahlen

Alle drei füllen dieselben sechs Werte und nutzen den bestehenden
Mutations- und Exportpfad. Es kommt nichts Neues ins Datenmodell.

### A — Referenzpunkt-Paarung

Der allgemeine Fall, unabhängig von Land und Datenlage.

Der Anwender klickt einen Punkt im Modell an (Gebäudeecke, Fixpunkt) und gibt
dessen amtliche Koordinate ein oder pickt sie auf der Karte. Daraus:

| Punkte | Bestimmbar | Kontrolle |
| --- | --- | --- |
| 1 | Verschiebung | keine, Drehung muss bekannt sein |
| 2 | Verschiebung + Drehung | Streckenvergleich als Massstabsprobe |
| ≥3 | Ausgleichung | Restklaffen je Punkt |

Das ist eine Helmert-Transformation in der Ebene. Der Massstab bleibt bei IFC
fest auf 1 — die Abweichung, die eine freie Massstabsschätzung ergäbe, ist
deshalb kein Parameter, sondern ein **Qualitätsmass**: weicht sie mehr als ein
Promille ab, stimmt etwas mit den Punktpaaren nicht.

Die Restklaffen gehören sichtbar in die Oberfläche. Sie sind das Einzige, was
dem Anwender sagt, ob das Ergebnis trägt.

### B — Parzelleneinpassung (Schweiz)

Der automatische Fall, wenn das Modell eine Umgebungs- oder Geländefläche
enthält, die der Parzelle entspricht.

1. Anwender gibt die E-GRID an (oder wählt die Parzelle auf der Karte).
2. Amtliche Parzellengeometrie holen.
3. Kandidatenfläche im Modell suchen: `IfcSite`-Umriss, `IfcGeographicElement`
   mit `.TERRAIN.`, oder eine vom Anwender gewählte Fläche.
4. Umriss einpassen — Drehung mitschätzen, nicht nur die Bounding Box
   vergleichen. Ein Suchlauf über die Drehung mit Bewertung der
   Flächenüberdeckung reicht für eine erste Fassung.
5. Ergebnis mit Restklaffen anzeigen, Anwender bestätigt.

**Wichtig:** die Annahme „modellierte Fläche = Parzelle" ist nicht garantiert.
Es könnte auch eine Baulinie oder ein Gebäudeumriss sein. Die Einpassung darf
deshalb nie stillschweigend übernommen werden — Restklaffen zeigen, Bestätigung
verlangen. Im Anlassfall lagen sie bei 2 und 8 cm, das war eindeutig. Bei 3 m
wäre es das nicht.

### C — Kartenpick

Existiert bereits, bleibt als Grobpositionierung. Sinnvoll als erster Wurf,
bevor A oder B verfeinert.

## Plausibilisierung

Billig zu bauen, hoher Nutzen, unabhängig von A/B/C. Nach jeder Änderung
prüfen und als Warnung anzeigen:

- Liegen `Eastings` / `Northings` im Gültigkeitsbereich des gewählten EPSG-Codes?
  Der Anlassfall lag Millionen Meter daneben und wäre sofort aufgefallen.
- Passt `OrthogonalHeight` zur Geländehöhe an dieser Stelle? Abweichungen über
  etwa 50 m sind erklärungsbedürftig.
- Steht `IfcSite.RefLatitude` / `RefLongitude` noch auf einem bekannten
  Werksvorgabewert? San Francisco (37°47'42" / −122°23'38") ist die Revit-
  Vorgabe und ein sicheres Zeichen, dass nie referenziert wurde.
- Ist `Scale` mit den Einheiten verträglich? Diese Prüfung gibt es schon
  (`detectScaleUnitMismatch`) — sie ist das Vorbild für die anderen.

## Höhe

`OrthogonalHeight` ist laut Norm orthometrisch. Der Editor rechnet die
Geoidundulation bereits ein (`egm96-undulation.ts`), mit einem Schalter für
Dateien, die ellipsoidisch gemeint sind. Für die Schweiz kommt die Höhe aus dem
amtlichen Höhenmodell an der ermittelten Lage.

Der Anlassfall zeigt, warum das getrennt zu behandeln ist: dort war die
Höhenangabe plausibel (ellipsoidisch gerechnet rund 308 m ü. M., das Gelände
liegt bei 306.7 m), nur Lage und Nordrichtung waren nie gesetzt. Höhe und Lage
scheitern unabhängig voneinander.

## Bezug zu Swiss GIS-BIM

Gebraucht werden drei Abfragen: Parzellengeometrie nach E-GRID, Geländehöhe an
einem Punkt, Adress- und Parzellensuche. Alle drei stecken in Swiss GIS-BIM in
`src/lib/geoadmin.ts` und `src/lib/lv95.ts`, beide bereits frameworkfrei.

**Entschieden:** IFClite spricht selbst mit geo.admin.ch. Kein gemeinsames
Paket, keine Abhängigkeit zu Swiss GIS-BIM.

Der Grund ist nicht technisch, sondern organisatorisch: so bleibt dieser Anteil
frei von jedem Bezug zum privaten GIS-Projekt und lässt sich stromaufwärts
zurückgeben. Der Preis ist doppelte Pflege bei den Abfragen — vertretbar, weil
es sich um wenige, stabile Endpunkte handelt.

Daraus folgt eine Bauregel: **kein Schweiz-Wissen in den allgemeinen Pfaden.**
Der Bereichstest, die Referenzpunkt-Paarung und die Plausibilisierung müssen
ohne Landesbezug funktionieren. Was schweizspezifisch ist — Parzellenabfrage,
Höhenmodell — gehört hinter eine austauschbare Schnittstelle, damit derselbe
Mechanismus später andere Landesdienste bedienen kann.

Offen bleibt der **Datenschutz.** Jede Abfrage sendet Koordinaten nach aussen.
Der Editor hat dafür bereits eine Regelung (`DataPrivacyPanel`) — die
Georeferenzabfragen gehören unter dieselbe Zustimmung.

## Reihenfolge

1. ~~Plausibilisierung.~~ **Erledigt.** `georef-validation.ts` — Widerspruch
   zwischen den beiden Ortsangaben, Werksvorgabe-Erkennung, Rückweg-Probe,
   dazu die bestehende Massstabsprüfung in derselben Liste.
2. ~~Referenzpunkt-Paarung (A).~~ **Erledigt.** `solve-georeference.ts` mit der
   Tabelle im Panel. Ausgleichung über beliebig viele Paare, Restklaffe je
   Zeile, Massstab gesperrt und die Abweichung als Probe in ppm.
3. ~~Parzelleneinpassung (B).~~ **Erledigt.** `extract-outline.ts` gewinnt den
   Umriss aus den Randkanten der Auswahl, `parcel-source.ts` holt die amtliche
   Grenze, `fit-outline.ts` passt ein, `mesh-to-map.ts` überbrückt Bezugssystem
   und Einheiten. Die Fläche wählt der Anwender im Viewport — die Einpassung
   kann eine Grundstücksgrenze nicht von einer Baulinie unterscheiden, also
   bleibt diese Beurteilung beim Menschen.
4. Beschriftungen entschärfen: Nordwinkel vor die Rohfelder, verständliche
   Bezeichnungen, Rohwerte einklappbar für alle, die sie wirklich brauchen.
   **Als Nächstes.**
5. Punkte im 3D-Viewport anklicken, statt die lokalen Koordinaten abzutippen.
   Ausbaustufe zu 2 — die Tabelle bleibt der Unterbau.

## Noch nie im Browser geprüft

Alle vier Schritte hängen an Unit-Tests. Der Viewer braucht eine gebaute
WASM-Laufzeit, ein geladenes Modell und eine Auswahl, bis das Panel überhaupt
erscheint — entsprechend ist noch nie jemand die Kette am lebenden Objekt
durchgegangen. Das ist die grösste verbleibende Unsicherheit, nicht die
Mathematik. Ein Durchgang mit `004_MOD_ARC.ifc` und E-GRID CH775979211712 wäre
der erste echte Beleg.

## Offene Punkte

- Einpassung bei gedrehten Umrissen: Suchlauf über die Drehung oder
  Formvergleich der Kanten?
- Was passiert mit `IfcSite.RefLatitude` / `RefLongitude`? Konsistent
  mitschreiben oder unangetastet lassen? Beides hat Argumente — die Angaben
  sind ab IFC4 nachrangig, aber Werkzeuge lesen sie trotzdem.
- Soll der Editor bei erkanntem Werksvorgabewert ungefragt korrigieren dürfen
  oder immer nur vorschlagen?
