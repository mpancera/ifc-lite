---
'@ifc-lite/drawing-2d': minor
---

Die Meldernummer reist bis ins DXF

Ein Melder trug im Export seinen Namen und seine Klasse, aber nicht die
Nummer, die das Regelwerk ihm beim Platzieren gegeben hat. Die steht in
`Pset_ConstructionOccurence.AssetIdentifier`, und der Exportweg fragte kein
Property-Set.

Beim Nachmessen am erzeugten Modell kam heraus, dass es **zwei** Angaben sind
und nicht eine:

* Die zugewiesene Kennung ist ein **Pfad**, nicht eine Nummer —
  `Building.Level 1.Space 1_fire.smoke-detector.001`. Eindeutig, und genau
  das, worauf eine Auswertung verbindet. Neben jedes Symbol gedruckt würde sie
  den Plan unter seinen eigenen Kennungen begraben.
* Was auf einer Zeichnung steht, ist `Tag` am Bauteil — die kurze Bezeichnung,
  die eine Meldergruppe vergibt.

Also reist die Kennung als unsichtbares Attribut `KENNUNG` mit und gezeichnet
wird `NUMMER` aus dem Tag. Wo keines vergeben ist, steht nichts: ein leeres
Feld neben jedem Symbol liest sich wie abhandengekommene Daten. Beide stehen
zusätzlich in den XDATA, die Kennung zuerst.

Gelesen wird über `MutablePropertyView.getPropertyValue`, das die Reihenfolge
schon kennt — anstehende Änderung, dann in dieser Sitzung angelegtes
Property-Set, dann die geparste Datei. Ein Melder, der eben erst nummeriert
wurde, hat in der geparsten Datei überhaupt keine Zeile.
