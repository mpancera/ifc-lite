---
'@ifc-lite/viewer': minor
---

Demodaten lassen sich im Browser hinterlegen

Der Abschnitt Demodaten im Demo-Flows-Panel zeigt jeden Slot mit seiner
Herkunft — hochgeladen, lokal vorhanden oder fehlend — und nimmt die fehlenden
per Dateiauswahl entgegen. Damit ist ein Flow auf einem Rechner vorführbar, auf
dem `public/demo-local/` leer ist, und das ist der Normalfall: der Ordner ist
eine Bequemlichkeit der Maschine, auf der die Clips gebaut wurden.

Die Datei landet in der IndexedDB dieses Browsers, nicht auf dem Server. Das
ist der Punkt und nicht ein Implementierungsdetail: `public/` wird von Vite
unverändert in jeden Build kopiert, ein Modell dort wäre also aus jedem
Deployment unter vorhersagbarer URL herunterladbar. Im Browser existiert es in
einem Profil auf einer Maschine, und das Repository hat keinen Weg, auf dem es
reisen könnte.

Gespeichert wird unter dem Namen des Slots, nie unter dem der hochgeladenen
Datei. Die Slotnamen sind absichtlich generisch — sie stehen im Modellbaum,
während aufgenommen wird, und eine vom Arbeitsrechner gewählte Datei heisst
nach dem Gebäude, aus dem sie stammt.

Der Abschnitt listet alle Slots, nicht nur die, die einem Schritt fehlen. Die
erste Fassung bot den Upload neben dem Schritt an, der die Datei braucht — die
beiden Föderationsmodelle gehören zu keinem Schritt der Journey und waren damit
gar nicht zu erreichen.

Nebenbei: `fetchDemoFile` prüfte nur den Status, nicht den Inhaltstyp. Der
Dev-Server beantwortet einen unbekannten Pfad mit der SPA-Hülle und 200, der
Clip lief also mit einer HTML-Seite in den Parser.
