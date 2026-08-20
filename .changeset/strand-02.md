---
'@ifc-lite/viewer': minor
---

Strang 2 der User Journey lässt sich vorführen

«Wenn das Modell schon da ist» — Modell des Architekten öffnen, die geforderte
Qualität per IDS nachweisen, die nicht erfüllten Stellen isolieren, kurz Melder
setzen und den Plan als PDF, SVG und DXF ausgeben.

Dafür sind zwei Dinge ansteuerbar geworden, die vorher nur ein Klick waren:

* **Der IDS-Prüflauf.** Ein Dokument liess sich schon ohne Panel laden
  (`loadIdsContent`), gerechnet wurde aber nur per Knopf — der Lauf gehört
  einem Worker, einem Fortschrittskanal und dem Modell, gegen das er prüft.
  `setIdsRunRequested` ist die andere Hälfte.
* **Die drei Planausgaben.** Sie stecken in `useDrawingExport`, das ein Dutzend
  Zustände des Grundrisses liest — was auf dem Schirm ist, *ist* die Zeichnung.
  Ein Aufrufer, der das anderswo zusammensetzt, exportiert etwas anderes. Also
  geht die Anfrage hinein und der Grundriss beantwortet sie
  (`requestPlanExport`).

Dazu `public/samples/brandmelder-uebergabe.ids`: vier Anforderungen, ohne die
eine Brandmeldeplanung stehenbleibt — Raumname, lesbare Bezeichnung,
Nettogrundfläche, Geschossname. Generisch gehalten, ohne Bezug auf ein Projekt,
und durch eine echte Übergabe-IDS ersetzbar, ohne den Clip anzufassen.

Die Nachweise der Takte behaupten bewusst keine Trefferquote: wie viel ein
Modell erfüllt, ist eine Eigenschaft des Modells und nicht der Software. Sie
prüfen, dass ein Bericht entstanden ist und dass die Isolierung greift.
