/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Funktionsübersicht — was die Basis (IFClite) kann und was dieser Fork
 * (IFCedit) dazugelegt hat, in je einer Zeile pro Funktion.
 *
 * Bewusst eine Datei mit reinen Daten und keine generierte Liste: die
 * interessante Information ist *wozu* eine Funktion da ist und *wo* sie
 * liegt, und das steht in keinem Commit und in keinem Dateinamen. Die
 * ausführliche Fassung mit Begründungen steht weiterhin in EXTENSION.md;
 * hier steht nur, was jemand beim Öffnen der App wissen muss.
 *
 * Beim Ergänzen: `where` ist der Ribbon-Pfad, wie er in der Oberfläche
 * steht (also "Author › Create › Zones", nicht der Komponentenname), damit
 * die Zeile auch als Wegbeschreibung taugt.
 */

/** Woher eine Funktion stammt: Basis-App oder dieser Fork. */
export type FeatureOrigin = 'ifclite' | 'ifcedit';

export interface FeatureEntry {
  /** Wie die Funktion in der Oberfläche heisst. */
  name: string;
  /** Wo sie liegt — Ribbon-Pfad oder Ort in der App. Fehlt, wenn sie überall wirkt. */
  where?: string;
  /** Ein Satz: was sie tut. */
  what: string;
  origin: FeatureOrigin;
}

export interface FeatureSection {
  id: string;
  title: string;
  /** Ein Satz zum Bereich, damit die Liste ohne Vorwissen lesbar bleibt. */
  intro: string;
  entries: FeatureEntry[];
}

export const FEATURE_SECTIONS: FeatureSection[] = [
  {
    id: 'files',
    title: 'Dateien & Modelle',
    intro: 'Was hereinkommt und was hinausgeht. Alles läuft im Browser, nichts wird hochgeladen.',
    entries: [
      {
        name: 'IFC öffnen',
        where: 'File › Model › Open, oder Datei ins Fenster ziehen',
        what: 'IFC2X3, IFC4, IFC4X3 und IFC5 (IFCX), geparst von einem Rust-Kern als WebAssembly.',
        origin: 'ifclite',
      },
      {
        name: 'Föderation',
        where: 'File › Model › Add model',
        what: 'Mehrere Modelle gleichzeitig offen — Architektur, Struktur, Haustechnik nebeneinander.',
        origin: 'ifclite',
      },
      {
        name: 'Punktwolken',
        where: 'Datei ins Fenster ziehen (LAS, LAZ, PLY, PCD, E57)',
        what: 'Scan neben dem Modell, mit Klassenfilter und Legende; lange Ladevorgänge sind abbrechbar.',
        origin: 'ifclite',
      },
      {
        name: 'Export',
        where: 'File › Export',
        what: 'IFC/STEP (mit allen Änderungen), GLB, KMZ, HBJSON, CSV, JSON-LD, Parquet, IFC5.',
        origin: 'ifclite',
      },
      {
        name: 'Teilen & Einbetten',
        where: 'File › Share',
        what: 'Link auf eine Ansicht, oder den Viewer als iframe in eine andere Seite stellen.',
        origin: 'ifclite',
      },
      {
        name: 'Projektbindung',
        where: 'File › Settings › Projekt',
        what: 'Ein Ordner ist ein Projekt. Höhensystem, Zonen und Anmerkungen gehören zu ihm und tauchen nicht im nächsten Projekt wieder auf.',
        origin: 'ifcedit',
      },
      {
        name: 'Sidecar-Dateien',
        where: 'Unterordner dc/ im gebundenen Projektordner',
        what: 'Ableitungen (Höhensystem, Geschosse je Modell) werden als Dateien neben das Modell geschrieben, nicht in einen privaten Browser-Speicher.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'view',
    title: 'Ansicht & Navigation',
    intro: 'Der WebGPU-Renderer und alles, was die Kamera und die Sichtbarkeit steuert.',
    entries: [
      {
        name: 'WebGPU-Renderer',
        what: 'Geometrie wird streamend verarbeitet — die ersten Dreiecke stehen, während der Rest der Datei noch läuft.',
        origin: 'ifclite',
      },
      {
        name: 'Kamera & Standardansichten',
        where: 'View › Camera / View',
        what: 'Orbit, Walk, ViewCube, sechs Standardansichten, orthografisch oder perspektivisch.',
        origin: 'ifclite',
      },
      {
        name: 'Schnitt',
        where: 'Home › Measure & Mark › Section',
        what: 'Schnittebene durch das Modell, frei setzbar.',
        origin: 'ifclite',
      },
      {
        name: 'Sichtbarkeit',
        where: 'Elements › Visibility',
        what: 'Isolieren, ausblenden, auf eine Auswahl fokussieren, ein Geschoss solo schalten.',
        origin: 'ifclite',
      },
      {
        name: 'Lens',
        where: 'Analyze › Style › Lens',
        what: 'Regelbasiert einfärben und filtern — nach Typ, Eigenschaft, Wertebereich.',
        origin: 'ifclite',
      },
      {
        name: 'Beleuchtung & Sonnenstand',
        where: 'View › Context › Lighting',
        what: 'Lichtvorgaben und Sonnenstand nach Ort und Zeit.',
        origin: 'ifclite',
      },
      {
        name: 'Karte & Gelände',
        where: 'View › Context › World',
        what: 'Das Modell auf Kartenkacheln und Geländehöhe — nur nach Freigabe im Datenschutz-Gate.',
        origin: 'ifclite',
      },
      {
        name: 'Lens: geghostet oder weg',
        where: 'Analyze › Style › Lens',
        what: 'Ob nicht getroffene Elemente blass stehen bleiben oder ganz verschwinden, ist jetzt eine Entscheidung und keine Voreinstellung.',
        origin: 'ifcedit',
      },
      {
        name: 'Farbpaletten',
        where: 'File › Settings › Colour palette',
        what: 'Die Oberfläche und die Lens-Farben aus einer JSON-Datei laden, damit eine Installation auf einen Blick als solche erkennbar ist. Keine Markenfarbe liegt im Repository.',
        origin: 'ifcedit',
      },
      {
        name: 'Werkzeugstreifen am Viewport',
        where: 'Links im 3D-Fenster',
        what: 'Dieselben Zeichen- und Messwerkzeuge am Modell wie im Plan, statt nur im Ribbon.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'elements',
    title: 'Elemente & Auswahl',
    intro: 'Das Modell durchsuchen, gliedern und einzelne Elemente greifen.',
    entries: [
      {
        name: 'Hierarchie',
        where: 'Elements › Hierarchy',
        what: 'Baum nach Raumstruktur, Klasse, Typ, Material oder Gruppe.',
        origin: 'ifclite',
      },
      {
        name: 'Suche & Filter',
        where: 'Elements › Elements › Search',
        what: 'Volltext und ein Filterbaukasten über Typ, Eigenschaft und Beziehung.',
        origin: 'ifclite',
      },
      {
        name: 'Auswahl',
        what: 'Klick, Rechteckauswahl, Hover-Tipps, GUID kopieren, Kontextmenü am Element.',
        origin: 'ifclite',
      },
      {
        name: 'Messen & Anmerken',
        where: 'Home › Measure & Mark',
        what: 'Strecken messen und Text- oder Zeichenanmerkungen setzen.',
        origin: 'ifclite',
      },
      {
        name: 'Beziehungsarten',
        where: 'File › Settings › Beziehungsarten',
        what: 'Auswählen, welche IFC-Beziehungen überhaupt ausgewertet und angezeigt werden.',
        origin: 'ifcedit',
      },
      {
        name: 'Graph',
        where: 'Analyze › Data › Graph',
        what: 'Ein Schema neben dem Modell: Elemente und ihre Beziehungen als Netz, mit derselben Auswahl wie im 3D.',
        origin: 'ifcedit',
      },
      {
        name: 'Klassenkatalog IFC4.3',
        what: 'IfcSensor, IfcAlarm und die ganze MEP- und Infrastruktur-Familie sind eigene Klassen statt „Unknown“ — sonst findet keine Liste und keine Abfrage sie.',
        origin: 'ifcedit',
      },
      {
        name: 'Elemente im Raum haben ein Geschoss',
        what: 'Ein Gerät in einem Raum erreicht sein Geschoss über den Raum. Vorher war die Geschossangabe für solche Elemente überall leer.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'data',
    title: 'Eigenschaften & Daten',
    intro: 'Was an einem Element hängt, lesen und ändern.',
    entries: [
      {
        name: 'Eigenschaften',
        where: 'Rechte Seitenleiste',
        what: 'Attribute, Property Sets, Mengen und Typ-Eigenschaften des gewählten Elements.',
        origin: 'ifclite',
      },
      {
        name: 'Eigenschaften bearbeiten',
        where: 'Author › Edit › Edit Mode',
        what: 'Werte ändern mit Undo/Redo; die Änderungen fliessen in den IFC-Export.',
        origin: 'ifclite',
      },
      {
        name: 'Massenbearbeitung',
        where: 'Author › Properties › Bulk Edit',
        what: 'Eine Eigenschaft über eine ganze Auswahl hinweg setzen.',
        origin: 'ifclite',
      },
      {
        name: 'Daten importieren',
        where: 'Author › Properties › Import data (CSV)',
        what: 'Eine CSV auf Elemente abbilden und ihre Spalten als Eigenschaften schreiben.',
        origin: 'ifclite',
      },
      {
        name: 'Abfragen',
        where: 'Analyze › Data › Script',
        what: 'Die bim.*-API und SQL über DuckDB-WASM gegen das geladene Modell.',
        origin: 'ifclite',
      },
      {
        name: 'Smart Properties',
        where: 'Author › Properties › Smart Property',
        what: 'Regelbasierte Werte: eine Anlagenkennzeichnung aus Gebäude, Geschoss, Raum, Produkttyp und Zähler zusammensetzen, statt sie zu tippen.',
        origin: 'ifcedit',
      },
      {
        name: 'Regeln für fehlende Angaben',
        where: 'Author › Properties › Smart Property',
        what: 'Was passiert, wenn ein Gerät in einem Korridor keinen Raum hat: Segment weglassen, ersetzen oder melden — statt stillschweigend eine plausible falsche Kennung zu erzeugen.',
        origin: 'ifcedit',
      },
      {
        name: 'Werte bleiben aktuell',
        what: 'Ändert sich eine Raumnummer, rechnen die betroffenen Regelwerte nach.',
        origin: 'ifcedit',
      },
      {
        name: 'Typ statt Instanz',
        what: 'Katalogprodukte tragen ihre Vorgabewerte auf einem geteilten IfcXxxType, den alle Platzierungen desselben Produkts benutzen — nicht als Kopie an jedem Element.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'lists',
    title: 'Listen & Auswertung',
    intro: 'Tabellen aus dem Modell — und in diesem Fork auch zurück ins Modell.',
    entries: [
      {
        name: 'Listen & Zeitpläne',
        where: 'Analyze › Data › List / Schedule',
        what: 'Auswertungen über Elemente mit frei wählbaren Spalten, speicherbar als Voreinstellung.',
        origin: 'ifclite',
      },
      {
        name: 'List Edit',
        where: 'Analyze › Data › List, bei aktivem Edit Mode',
        what: 'Das Ergebnisraster als Tabellenblatt: tippen, Bereich einfügen, Füllgriff ziehen, Farbspalte.',
        origin: 'ifcedit',
      },
      {
        name: 'Raum-Spalte',
        where: 'Spaltenauswahl einer Liste',
        what: 'In welchem Raum ein Element liegt, als eigene Spalte; „Container“ heisst jetzt „Contained in“.',
        origin: 'ifcedit',
      },
      {
        name: 'Listen sehen, was gezeichnet wurde',
        what: 'Neu platzierte Elemente und geänderte Werte stehen sofort in Listen und in der Lens — vorher erst nach Export und erneutem Öffnen.',
        origin: 'ifcedit',
      },
      {
        name: 'Listen filtern selbst',
        what: 'Eine Liste antwortet auf ihren eigenen Filter, nicht auf das, was gerade im Fenster sichtbar ist.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'check',
    title: 'Prüfen & Vergleichen',
    intro: 'Qualitätssicherung am Modell.',
    entries: [
      {
        name: 'IDS-Prüfung',
        where: 'Analyze › Validate › IDS Check',
        what: 'Modell gegen eine IDS-Anforderungsdatei prüfen, mit Bericht je Spezifikation.',
        origin: 'ifclite',
      },
      {
        name: 'Kollisionsprüfung',
        where: 'Analyze › Validate › Clash',
        what: 'Kollisionen zwischen Modellen oder Gewerken finden, als BCF exportierbar.',
        origin: 'ifclite',
      },
      {
        name: 'Versionsvergleich',
        where: 'Analyze › Compare',
        what: 'Zwei Stände desselben Modells gegenüberstellen: dazugekommen, weg, geändert.',
        origin: 'ifclite',
      },
      {
        name: 'BCF-Issues',
        where: 'Analyze › Validate › BCF Issues',
        what: 'Themen anlegen, mit Blickpunkt und Auswahl, als BCF-Datei austauschen.',
        origin: 'ifclite',
      },
      {
        name: 'Abweichungen',
        where: 'Analyze › Compare › Layers',
        what: 'Modell gegen Scan oder Referenzfläche, mit Abweichungsdarstellung.',
        origin: 'ifclite',
      },
      {
        name: 'Einheiten-Übersicht',
        where: 'File › Settings › Höhen & Lage',
        what: 'Was jedes geladene Modell tatsächlich als Einheit deklariert — und wo zwei sich widersprechen.',
        origin: 'ifcedit',
      },
      {
        name: 'Änderungen am Referenzmodell',
        where: 'Author › Properties › Changes to the reference model',
        what: 'Was am fremden Modell angefasst wurde: Element, Feld, vorher/nachher — getrennt von allem, was man selbst dazugestellt hat.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'plan',
    title: '2D & Pläne',
    intro: 'Der Grundriss als Arbeitsfläche, nicht als Kamerastellung von oben.',
    entries: [
      {
        name: '2D-Zeichnungen',
        where: 'Home › Measure & Mark › Section',
        what: 'Schnitte und Ansichten als Vektorzeichnung, mit Blattaufbau und Schriftfeld.',
        origin: 'ifclite',
      },
      {
        name: 'Plan-Modus',
        where: 'View › Mode › 2D',
        what: 'Ein Geschoss, geschnitten, orthografisch, solo geschaltet — und auf dem Weg zurück wieder so, wie es vorher war.',
        origin: 'ifcedit',
      },
      {
        name: 'Zeichenwerkzeuge',
        where: 'Werkzeugstreifen im Plan',
        what: 'Linie, Rechteck, Text, Messen — klick-zu-klick, mit Shift-Zwang und rechter Maustaste zum Schieben.',
        origin: 'ifcedit',
      },
      {
        name: 'Marke ins Modell übernehmen',
        where: 'Werkzeugstreifen im Plan',
        what: 'Eine gezeichnete Marke wird als IfcAnnotation Teil des Modells statt eine Notiz daneben.',
        origin: 'ifcedit',
      },
      {
        name: 'Plan drehen',
        where: 'Werkzeugstreifen im Plan',
        what: 'Für orthogonales Arbeiten an einem schräg stehenden Gebäudeteil — der Plan dreht sich, das Modell nicht. Die Drehung wird pro Projekt gemerkt.',
        origin: 'ifcedit',
      },
      {
        name: 'Tür- und Fenstersymbole',
        what: 'Symbol mit Anschlagbogen, aus der gezeichneten Geometrie abgeleitet statt aus OperationType — ein Symbol je Tür, nicht je Türtyp.',
        origin: 'ifcedit',
      },
      {
        name: 'Beschriftung',
        what: 'Raumname und Fläche im Raum, Türmasse an der Tür, alles über eine Textebene.',
        origin: 'ifcedit',
      },
      {
        name: 'Massstab statt Zoom',
        what: 'Ein Massstab und ein Massstabsbalken, wie auf einem Plan — kein Zoom in Prozent. Nordpfeil in der Ecke des ViewCubes.',
        origin: 'ifcedit',
      },
      {
        name: 'Geräte als Marke',
        what: 'Ein Melder wird im Plan als Symbol gezeichnet, nicht in seiner tatsächlichen Grösse von vier Zentimetern.',
        origin: 'ifcedit',
      },
      {
        name: 'Aus dem Plan platzieren',
        what: 'Ein Element im Grundriss setzen, durch dieselbe Platzierungsmechanik wie im 3D.',
        origin: 'ifcedit',
      },
      {
        name: 'DXF-Unterlage',
        where: 'View › Mode › 2D',
        what: 'Einen gescannten oder exportierten Plan unterlegen und je Geschoss zuweisen.',
        origin: 'ifcedit',
      },
      {
        name: 'DXF einpassen',
        what: 'Zwei Linien auf demselben Bauteil zeichnen — Versatz, Drehung und Massstab ergeben sich daraus, statt geraten zu werden.',
        origin: 'ifcedit',
      },
      {
        name: 'Räume aus dem Plan',
        what: 'Raumflächen aus einer importierten Zeichnung ableiten, nicht nur aus modellierten Wänden.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'author',
    title: 'Autorenwerkzeuge',
    intro: 'Was in das Modell hinein geschrieben wird.',
    entries: [
      {
        name: 'Add Element',
        where: 'Author › Create › Add Element',
        what: 'Wand, Decke, Stütze, Tür, Fenster und weitere Bauteile per Klick setzen, mit Vorschau und Undo.',
        origin: 'ifclite',
      },
      {
        name: 'Space Sketch',
        where: 'Author › Create › Space Sketch',
        what: 'Räume aufziehen, auch dort, wo das Modell keine hat.',
        origin: 'ifclite',
      },
      {
        name: 'Geometrie bearbeiten',
        where: 'Author › Edit',
        what: 'Verschieben, drehen, duplizieren, löschen — mit vollständiger Undo-Kette.',
        origin: 'ifclite',
      },
      {
        name: 'Elementbibliothek',
        where: 'Author › Create › Add Element › Library',
        what: 'Melder, Kameras, Signalgeber und ähnliche Geräte aus einem Katalog setzen statt aus einer fest verdrahteten Typenliste.',
        origin: 'ifcedit',
      },
      {
        name: 'Firmenbibliothek',
        where: 'Author › Create › Product Library',
        what: 'Einen eigenen Produktkatalog als JSON importieren. Er bleibt im Browser und liegt nie im Repository.',
        origin: 'ifcedit',
      },
      {
        name: 'Projekt-Produkte',
        where: 'Author › Create › Product Library',
        what: 'Welche Katalogprodukte im aktuellen Modell tatsächlich verbaut sind, aufklappbar bis zur einzelnen Instanz.',
        origin: 'ifcedit',
      },
      {
        name: 'Raumzuordnung',
        what: 'Ein platziertes Element ist im umschliessenden IfcSpace enthalten — damit „welche Geräte sind in diesem Raum“ aus der Datei beantwortbar ist statt aus Koordinaten.',
        origin: 'ifcedit',
      },
      {
        name: 'Disziplin-Rollen',
        where: 'File › Settings › Disziplin',
        what: 'Mit aktiver Rolle tritt jedes platzierte Gerät seiner Anlage bei — einem IfcDistributionSystem — statt lose im Modell zu stehen.',
        origin: 'ifcedit',
      },
      {
        name: 'Schreibschutz je Rolle',
        where: 'File › Settings › Disziplin, Anzeige in der Statusleiste',
        what: 'Viewer liest nur, eine Disziplin ergänzt und darf das Referenzmodell nicht ändern, Editor darf alles. Der Zustand steht in der Statusleiste, weil er ändert, was ein Klick bewirkt.',
        origin: 'ifcedit',
      },
      {
        name: 'Zonen',
        where: 'Author › Create › Zones',
        what: 'Räume zu einer IfcZone zusammenfassen — als IFC-Beziehung geschrieben, also überlebt sie den Export. Farbe und Thema hängen an der Zone selbst.',
        origin: 'ifcedit',
      },
      {
        name: 'Kompartimente',
        where: 'Author › Create › Compartments',
        what: 'Brandabschnitte und ähnliche Bereiche über Geschosse hinweg, mit Zyklusschutz bei verketteten Zugehörigkeiten.',
        origin: 'ifcedit',
      },
      {
        name: 'Nach Zone einfärben',
        where: 'Analyze › Style › Lens',
        what: '„Color by Zone / Group“, auf ein Thema einschränkbar; jede Zone bestimmt ihre eigene Farbe.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'heights',
    title: 'Bezugsgrössen & Lage',
    intro: 'Die Arbeit, die vor dem Modell kommt: Höhen, Projektkoordinaten, Georeferenz.',
    entries: [
      {
        name: 'Georeferenz anzeigen',
        where: 'View › Context › Move georef',
        what: 'Basispunkt und Nordrichtung des Modells sehen und verschieben.',
        origin: 'ifclite',
      },
      {
        name: 'Referenz-Höhensystem',
        where: 'File › Settings › Höhen & Lage',
        what: 'Geschosshöhen als eine projektweite Referenz — von Hand definierbar, bevor überhaupt ein Modell existiert.',
        origin: 'ifcedit',
      },
      {
        name: 'Modellabgleich',
        where: 'File › Settings › Höhen & Lage',
        what: 'Was jedes geladene Modell an Geschossen und Höhen mitbringt, gegen die Referenz gestellt.',
        origin: 'ifcedit',
      },
      {
        name: 'Höhensystem exportieren',
        where: 'File › Settings › Höhen & Lage',
        what: 'Als heights.json in den Projektordner, benannt nach dem Projekt.',
        origin: 'ifcedit',
      },
      {
        name: 'Georeferenz nachrüsten',
        where: 'Rechte Seitenleiste › Georeferenzierung',
        what: 'Eine Koordinatenoperation aus benannten Passpunkten lösen und auf das Modell anwenden.',
        origin: 'ifcedit',
      },
      {
        name: 'Parzelle einpassen',
        what: 'Die amtliche Parzellengrenze holen (nur nach Freigabe) und eine modellierte Fläche darauf einpassen; die schlechteste Passung wird in beide Richtungen gemessen.',
        origin: 'ifcedit',
      },
      {
        name: 'Gebäude einpassen',
        what: 'Eine modellierte Aussenkante auf die vermessene legen, mit Umriss aus einer triangulierten Fläche.',
        origin: 'ifcedit',
      },
      {
        name: 'Widersprüche melden',
        what: 'Wenn sich die Georeferenzangaben einer Datei gegenseitig widersprechen, wird das benannt statt eine davon stillschweigend zu nehmen.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'session',
    title: 'Sitzung & Datenschutz',
    intro: 'Was mit der Arbeit passiert, wenn der Tab zugeht — und was den Rechner verlässt.',
    entries: [
      {
        name: 'Alles im Browser',
        what: 'Parsen, Geometrie und Rendern laufen lokal. Kein Modell wird auf einen Server geladen.',
        origin: 'ifclite',
      },
      {
        name: 'Sitzung überlebt den Reload',
        what: 'Autorierte Elemente und Änderungen werden bei jeder Bearbeitung lokal gesichert und beim Öffnen wiederhergestellt. Verschlüsselt gegen den SHA-256 der Quelldatei, nicht gegen ihren Namen.',
        origin: 'ifcedit',
      },
      {
        name: 'Wiederherstellung mit Abgleich',
        what: 'Bei gleicher Datei kommentarlos zurück. Bei einer anderen Fassung wird erst gezeigt, was noch passt, was in einem geänderten Bereich liegt und was ins Leere zeigt.',
        origin: 'ifcedit',
      },
      {
        name: 'Datenschutz-Gate',
        where: 'File › Settings › Data privacy',
        what: 'Ein einziger Schalter vor allen ausgehenden Anfragen — Kartenkacheln, Geländehöhe, Ortssuche, EPSG, bSDD. Aus, bis er eingeschaltet wird, und im Zweifel aus.',
        origin: 'ifcedit',
      },
      {
        name: 'Keine fremden Schriften',
        what: 'Die Symbolschrift kommt vom eigenen Server, auf die benutzten Zeichen reduziert. Ein frischer Ladevorgang spricht mit keinem fremden Host.',
        origin: 'ifcedit',
      },
    ],
  },

  {
    id: 'extend',
    title: 'Erweitern & Automatisieren',
    intro: 'Die Wege, die App zu verändern, ohne sie neu zu bauen.',
    entries: [
      {
        name: 'Extensions',
        where: 'Author › Customize › Extensions',
        what: 'Zusatzwerkzeuge und Panels installieren, mit Rechteprüfung und Prüfprotokoll.',
        origin: 'ifclite',
      },
      {
        name: 'Flavors',
        where: 'Statusleiste, Chip mit dem Paletten-Symbol',
        what: 'Umschaltbare Profile aus Extensions, Lenses, Abfragen und Overlay — teilbar als Datei.',
        origin: 'ifclite',
      },
      {
        name: 'Script',
        where: 'Analyze › Data › Script',
        what: 'Die bim.*-API direkt gegen das offene Modell, im Editor in der App.',
        origin: 'ifclite',
      },
      {
        name: 'KI & MCP',
        where: 'Chat-Panel',
        what: 'Fragen in normaler Sprache an das Modell; über MCP können Agenten dieselben Werkzeuge benutzen.',
        origin: 'ifclite',
      },
      {
        name: 'Zusammenarbeit',
        where: 'File › Share › Collabs Room',
        what: 'Mehrere Leute gleichzeitig an einem IFCX-Modell, über CRDT.',
        origin: 'ifclite',
      },
      {
        name: 'Kommandopalette & Kürzel',
        where: 'Strg+K',
        what: 'Jeden Befehl über die Tastatur erreichen.',
        origin: 'ifclite',
      },
      {
        name: 'CLI & Pakete',
        what: '36 npm-Pakete und ein Kommandozeilenwerkzeug für dieselben Fähigkeiten ausserhalb der App — prüfen, exportieren, zusammenführen, in CI.',
        origin: 'ifclite',
      },
    ],
  },
];

export const ORIGIN_LABEL: Record<FeatureOrigin, string> = {
  ifclite: 'IFClite',
  ifcedit: 'IFCedit',
};

export function countByOrigin(origin: FeatureOrigin): number {
  let n = 0;
  for (const section of FEATURE_SECTIONS) {
    for (const entry of section.entries) {
      if (entry.origin === origin) n++;
    }
  }
  return n;
}
