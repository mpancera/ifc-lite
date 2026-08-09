# Bezugsgrössen für frühe Kostenschätzungen

**Stand:** Entwurf, 2026-08-10 · **Herkunft:** aus Swiss GIS-BIM hierher verschoben

## Worum es geht

In frühen Projektphasen wird kalkuliert, bevor ein detailliertes Modell
existiert. Die Kennwerte dafür hängen an wenigen Bezugsgrössen: Grundfläche,
Gebäudevolumen, Hüllfläche, Fassadenfläche nach Himmelsrichtung, Dachfläche.
Aus einem einfachen Volumenmodell lassen sich diese Grössen rechnen, statt sie
von Hand einzugeben.

Der Editor ist dafür der richtige Ort, weil dort das Modell liegt. Ein
GIS-Werkzeug kann nur den Bestand und den Standort beschreiben – für ein
Projekt braucht es das Modell des Architekten.

## Bezug zur Forschung

Grundlage ist ein Forschungsprojekt der FHNW zur modellbasierten
Kostenschätzung, publiziert als *Simplification and enrichment of IFC models
for cost estimation* (Marcinkeviciute, Schildknecht, Huber, Pancera, Gschwind
et al., Creative Construction Conference 2025).

Kernaussagen daraus:

- Für eine detaillierte Kostenschätzung sind rund **180 Parameter** definiert.
  45 % lassen sich aus volumetrischen Modellen gewinnen, 45 % aus
  informationsarmen Modellen, 10 % bleiben manuell.
- Bauteile werden nicht modelliert, sondern **abgeleitet**: aus den Flächen der
  Stockwerksvolumen, eingeordnet nach Normalenrichtung und danach, was eine
  Fläche berührt.
- Die vollständige Parameterliste ist nicht veröffentlicht.

## Das Regelwerk

Jede Fläche wird nach zwei Kriterien zugeordnet: Richtung der Normalen **und**
was sie berührt – Innenvolumen (IV), Aussenvolumen (EV) oder Terrain.

| Normale | Bedingung | Bauteil |
| --- | --- | --- |
| aufwärts | IV berührt EV | Flachdach begehbar |
| aufwärts | IV berührt nichts | Flachdach nicht begehbar |
| aufwärts | IV berührt Terrain | Flachdach unterirdisch |
| aufwärts | geneigt | Steildach |
| aufwärts | IV berührt IV | Innendecke |
| aufwärts | EV berührt EV oder nichts | Balkon |
| seitwärts | IV berührt EV oder nichts | Aussenwand |
| seitwärts | IV berührt Terrain | Aussenwand unterirdisch |
| seitwärts | EV berührt nichts | Geländer |
| abwärts | IV berührt nichts | Aussendecke (Untersicht) |
| abwärts | IV berührt Terrain | Bodenplatte |

Fassaden bekommen zusätzlich eine von acht Himmelsrichtungen.

## Was schon gerechnet ist

In Swiss GIS-BIM lief ein Stand davon auf swissBUILDINGS3D. Er ist dort
entfernt, der Code steht aber im Repo `mpancera/swiss-gis-bim` im Commit
`1b00df0`:

| Datei | Inhalt |
| --- | --- |
| `src/lib/quantities.ts` | Bezugsgrössen-Set mit Quelle und eBKP-H/SIA-Zuordnung je Wert, Ausgabe als CSV, JSON und flache Parameterliste |
| `src/lib/sitework.ts` | Abtrag und Auftrag gegen ein Bezugsniveau, Nachbarbauten mit Abstand zur Parzellengrenze |
| `src/lib/building-parts.ts` | `volumeAbove()` – Rauminhalt über einer Ebene, Hüllfläche, Gebäudehüllzahl |

Alles davon ist reines TypeScript ohne Framework und ohne DOM, also direkt
übernehmbar.

### Der Volumensatz

Das Volumen oberhalb einer Ebene kommt über den Satz von Gauss mit dem Feld
F = (0, 0, z − z₀). Dessen Divergenz ist eins, also ist das Volumen das
Oberflächenintegral von (z − z₀)·n_z über die geklippte Hülle. Auf der
Schnittebene selbst ist z − z₀ null – die Deckfläche trägt nichts bei und muss
gar nicht erst gebildet werden.

Voraussetzung ist ein geschlossenes, nach aussen orientiertes Netz.

## Was im Editor anders ist als im GIS

| | GIS (swissBUILDINGS3D) | Editor (Architekturmodell) |
| --- | --- | --- |
| Geometrie | geschlossene Hülle | Stockwerksvolumen oder Bauteile |
| IV/EV-Unterscheidung | nein | ja |
| Balkon, Geländer, Untersicht | nicht ableitbar | ableitbar |
| begehbar / nicht begehbar | nicht ableitbar | ableitbar |
| Untergeschosse, Geschosszahl | nicht bekannt | bekannt |
| Nutzflächen, Wohnungen | nicht bekannt | bekannt |
| Gelände | vorhanden (swissALTI3D) | nur wenn modelliert |

Der Editor kann also den vollen Zweig bedienen. Was ihm fehlt, ist das
**Gelände** – und genau das liefert Swiss GIS-BIM als IFC oder LandXML, mit
Georeferenzierung nach LoGeoRef50. Die beiden Seiten ergänzen sich an dieser
Stelle.

## Vorgeschlagenes Vorgehen

1. Flächenklassifikation über die Normalen auf die Modellgeometrie anwenden
   (der Rechenkern dafür liegt in `building-parts.ts` vor).
2. Nachbarschaftsbeziehungen zwischen Volumen bestimmen, um IV/EV/Terrain
   auseinanderzuhalten. Das ist der eigentliche neue Teil.
3. Abgeleitete Bauteile als neue Entities in das Modell schreiben und im
   Betrachter darstellbar machen.
4. Bezugsgrössen daraus rechnen und als Eigenschaftssatz an `IfcBuilding`
   hängen.
5. Gelände aus Swiss GIS-BIM beziehen, um ober- und unterirdisch zu trennen.

## Offen

- Die **Formkomplexität** (`ord_form_roof`, `ord_form_baseplate`, Score 1–8 aus
  rechten gegenüber schiefen Winkeln, Neigung und Wiederkehr ähnlicher Formen)
  ist im Paper beschrieben, der Algorithmus aber nicht veröffentlicht. Ein
  eigener Score unter diesem Namen wäre irreführend.
- Die echten Parameternamen sind nicht öffentlich. Aus Tabelle 1 des Papers ist
  nur das Muster ablesbar:
  `area_<bauteil>_<inside|outside>_<aboveground|underground>_<richtung>`, dazu
  `num_`, `ord_` und `table_`. Liegt die Liste vor, sind es reine
  Schlüsselumbenennungen.
