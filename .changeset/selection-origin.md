---
'@ifc-lite/viewer': minor
---

Ein Koordinatensystem auf dem gewählten Bauteil

Neuer Schalter im View-Reiter: das gewählte Bauteil bekommt ein kleines
XYZ-Dreibein an seinem Mittelpunkt.

Die Hervorhebung beantwortet «welches» und hört da auf. Wo die interessanten
Bauteile 15 cm grosse Melder unter einer Decke sind, reicht das nicht — ein
hervorgehobener Melder zwei Räume weiter und einer hinter einer Wand sehen
gleich aus, und keiner von beiden verrät, wie herum er steht.

Als SVG über dem Canvas, nicht in der Szene: so bleibt die Marke bei jedem Zoom
gleich gross und ist noch lesbar, wenn das Bauteil selbst ein paar Pixel misst.
In der Szene gezeichnet würde sie beim Herauszoomen verschwinden — genau dann,
wenn man am ehesten wissen will, wo das Ding steht.

Die Achsenkonvention ist dieselbe wie beim Basispunkt-Marker, damit zwei Marken
auf einem Schirm nicht Verschiedenes bedeuten können.
