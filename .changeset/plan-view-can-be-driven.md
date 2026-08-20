---
'@ifc-lite/viewer': minor
---

Der Grundriss lässt sich von aussen einpassen und zoomen

`requestPlanFit()` passt die ganze Zeichnung ins Fenster, `requestPlanZoom(f)`
skaliert um die Fenstermitte. Beide gehen über dieselbe Anfrage wie
`requestPlanFocus`, weil alle drei im selben Transform enden und zwei
Mechanismen, die um ihn streiten, eine halb verschobene und halb eingepasste
Ansicht hinterlassen.

Ein Zoom lässt sich nicht als Einpassen ausdrücken: der Grundriss passt sich
selbst ein, sobald eine Zeichnung ankommt, ein zweites Einpassen bewegt also
nichts. Das ist keine Feinheit, sondern der Unterschied zwischen «zeig mir das
näher» und «nichts passiert».

Dazu lässt sich eine Liste jetzt von aussen beantworten: `requestListRun`
nimmt eine Definition entgegen und zeigt ihr Ergebnis. Getrennt von
`pendingListDraft`, das den Builder öffnet — eine Liste bearbeiten zu wollen
und eine Liste beantwortet haben zu wollen sind verschiedene Absichten, und ein
Feld für beides bräuchte ein zweites Feld, das sagt welche.
