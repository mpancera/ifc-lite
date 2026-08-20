---
'@ifc-lite/viewer': minor
---

Listen und Diagramme sind Exportprodukte

Beide Arten waren deklariert und nicht gebaut — der Stapel meldete «noch nicht
gebaut» und schrieb nichts. Jetzt lassen sie sich hinzufügen und werden vom
Stapel ausgegeben, Listen als CSV, XLSX oder PDF, Diagramme als CSV oder JSON.

Eine Liste wird **beantwortet, bevor sie geschrieben wird**. Sie auszuwählen
exportiert nichts: die Datei entsteht aus den Zeilen, Spalten, Gruppen und
Summen, die die Tabelle zeigt. Also führt der Lauf sie erst aus.

Ein Diagramm wird als **Kette plus Startklassen** übernommen, nicht als
Verweis auf einen Katalog — den gibt es nicht. Ein Diagramm *ist* eine Kette
und die Klassen, ab denen gelaufen wird, und beides stellt man ein, indem man
auf das Ergebnis schaut. Der Knopf übernimmt, was das Graph-Panel gerade zeigt.

Beim Bauen kam heraus, dass die Deklarationen an drei Stellen geraten waren
und dreimal daneben lagen:

* Eine Liste sollte `json` können — der Schreiber kann CSV, Excel und PDF und
  hat keinen JSON-Weg.
* Ein Diagramm sollte `svg` können — `@ifc-lite/graph` schreibt einen Baum;
  ihn zu zeichnen ist Sache dessen, der ihn zeichnet.
* Ein Diagramm trug nur eine Ansichts-Kennung. Ohne Startklassen zeichnet eine
  Kette nichts, ein solches Produkt hätte also nie eine Datei ergeben — und
  gesagt hätte es das erst beim Lauf.

Ein Produkt, dessen Format kein Schreiber beherrscht, ist ein Produkt, das nie
ausgegeben werden kann. Die Formatlisten nennen jetzt, was die Schreiber
wirklich können.
