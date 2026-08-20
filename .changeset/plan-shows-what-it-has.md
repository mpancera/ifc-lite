---
'@ifc-lite/viewer': patch
---

Der Grundriss behandelt eine hinterlegte Zeichnung nicht länger als «nichts da»

Drei Stellen in derselben Kette, alle mit derselben Annahme: es gibt nur etwas
zu zeigen, wenn ein Schnitt durch Geometrie etwas gefunden hat. Der Zustand, in
dem eine DXF unter einem noch leeren Modell liegt, ist aber kein Sonderfall —
es ist der Anfangszustand des Nachzeichnens, und man ist die ganze Zeit darin.

* **Einpassen und Zoomen wurden verworfen.** Der Behandler für die
  Fokus-Anfrage stieg bei fehlender Zeichnung aus, bevor er zum Einpassen kam.
  Beides betrifft das Papier und nicht ein Bauteil darauf und wird jetzt vorher
  beantwortet; nur die Suche nach einem einzelnen Element braucht den Schnitt.
* **`fitToView` hatte nichts zu messen.** Es liest die Grenzen der
  geschnittenen Zeichnung. Ohne Schnitt blieb der Plan auf Massstab 1 stehen —
  ein Pixel pro Meter, ein 12-Meter-Gebäude also zwölf Pixel breit. Es nimmt
  jetzt ersatzweise die Ausdehnung der sichtbaren Unterlagen.
* **Die Leermeldung log.** «Aus diesem Modell liessen sich keine Geschosse mit
  Geometrie lesen», während die Zeichnung sichtbar dalag, liest sich als
  Störung und schickt den Leser auf Fehlersuche.

Dazu eine Verdrahtung, die nie lief: der Plan veröffentlicht seinen Transform
für Leser ausserhalb seines React-Baums, aber der Effekt lief nur beim Mounten
— und da gibt der Grundriss `null` zurück, es gibt also keinen Container. Beim
Umschalten lief er nicht erneut, weil sich der Transform in dem Moment nicht
ändert. Veröffentlicht wurde damit nie etwas, und jeder Leser fiel still auf
die 3D-Kamera zurück.
