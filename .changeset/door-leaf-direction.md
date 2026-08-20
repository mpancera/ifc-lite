---
'@ifc-lite/create': minor
---

Eine Tür kann quer zur X-Achse stehen

`addDoorToStore` nimmt `RefDirection` entgegen — die Richtung, in der das
Türblatt läuft, als storey-lokale Richtung.

Bisher gab es das nicht, und die Folge war keine Einschränkung, sondern ein
falsches Ergebnis: das Blatt ist ein Rechteck `Width` entlang der X-Achse der
Platzierung und `FrameThickness` quer dazu, also stand jede Tür in einer
Nord-Süd-Wand quer zur Wand statt darin. Es sah aus wie ein Modellfehler und
war einer.

Als Richtung und nicht als Winkel, weil der Aufrufer genau das hat — das
`End - Start` seiner Wand — und der Umweg über einen Winkel und zurück die
Stelle ist, an der ein Vorzeichen verlorengeht.

Ohne den Parameter wird weiterhin gar keine `IfcDirection` geschrieben. Ein
mitgeliefertes Standard-`[1,0,0]` würde jede Datei um Entitäten erweitern, die
sie nie gebraucht hat.
