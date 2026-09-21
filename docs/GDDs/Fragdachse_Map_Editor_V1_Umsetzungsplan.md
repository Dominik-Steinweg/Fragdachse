# Fragdachse – Map-Editor V1: Umsetzungsplan

**Stand:** 21. September 2026

**Grundlage:** [Map-Editor-Konzept v2](Fragdachse_Map_Editor_V1_Konzept_v2.md) und statische Prüfung des aktuellen lokalen Quellcodes.

**Status:** V1 implementiert unter `tools/map-editor`; Start mit `npm run map:editor`. Die nachstehenden Festlegungen dokumentieren den Umsetzungsauftrag. Bedienung, Browserabnahme und verifizierte Bestandsfehler des Projektgates stehen in der [Editor-Dokumentation](../../tools/map-editor/README.md). Die Browserprüfung wurde ausdrücklich freigegeben und durchgeführt; vorhandene Kampagnendaten blieben nach Rücknahme der Teständerungen unverändert.

## 1. Ergebnis und Umfang

V1 liefert ein eigenständiges lokales Browserwerkzeug unter `npm run map:editor`. Es bearbeitet bestehende registrierte Coop-Defense-Maps sowohl räumlich als auch hinsichtlich ihrer Encounter, erzeugt eine Vorschau mit dem vorhandenen Generator und speichert bewusst in die ursprüngliche JSON-Datei.

**Kartenbearbeitung und Encounter-Bearbeitung gehören gemeinsam zur V1-Abnahme.** Ein reiner Encounter-Editor oder eine ausschließlich lesende Geländeansicht ist kein abgeschlossenes V1.

Enthalten sind die beiden Ansichten, gemeinsame Auswahl und Entwurf, Rückgängig/Wiederholen, XP-Auswertung, Boss-Slot, sämtliche im Konzept freigegebenen räumlichen Werkzeuge, feste Vorschau-Seeds, die Prüfung von fünf Varianten, Validierung und konfliktgeschütztes Speichern. Nicht enthalten sind neue Maps, Missionsartwechsel, Ereignis-/Belohnungseditor, integrierter Spieltest, Spielgrafik in der Vorschau und das Platzieren einzelner generierter Felsen/Bäume.

Die Umsetzung erfolgt in einzeln prüfbaren Arbeitspaketen. Bis zur Gesamtabnahme bleiben Zwischenstände ausdrücklich unvollständig.

## 2. Verifizierte Ausgangslage und Konsequenzen

| Befund im aktuellen Code | Konsequenz für die Umsetzung |
|---|---|
| [Map-Registry](../../src/config/coopDefenseMaps/index.ts) importiert einzelne JSON-Dateien in fachlicher Reihenfolge. [coopDefenseMaps.ts](../../src/config/coopDefenseMaps.ts) normalisiert die gesamte Registry und die interne Balance-Lab-Map bereits beim Modulimport. | Rohdateikatalog und Regeln von der geladenen Runtime-Registry trennen. Eine fehlerhafte Map darf nicht den gesamten Editorstart verhindern. Interne Lab-Maps werden nicht automatisch freigeschaltet. |
| `normalizeCoopDefenseMapConfig()` materialisiert Defaults, erzeugt den persistenten Basiskern und expandiert `waterAreas`. Eine erneute Normalisierung kann an `front` plus `spawnArea` scheitern. | Rohentwurf als einzige schreibbare Dokumentquelle; jede Ableitung normalisiert genau eine frische Kopie. Keine Rückspeicherung aus Registry, World-/Activity-Projektion oder normalisierter Config. |
| Einige Normalizer runden oder begrenzen Eingaben, etwa Gruppenzahlen und Zeiten. Leere Encounter werden abgelehnt. | Strenge Eingabeprüfung vor der Normalisierung; unzulässige Eingaben nicht durch stilles Runden scheinbar akzeptieren. Leere Encounter als Entwurf erlauben, Speichern blockieren. |
| [ArenaGenerator](../../src/arena/ArenaGenerator.ts) nimmt explizite `WorldMetrics` und eine Map-Konfiguration entgegen und benötigt keinen Phaser-Renderer. [WorldComposition](../../src/world/WorldComposition.ts) gibt bei einer Coop-Mission die vollständige Map weiter. | Generator im Worker wiederverwenden. Die Editorvorschau entspricht dem Missionsstart, nicht einer World ohne Activity. |
| `toWorldGenerationConfig()` im [Authoring-Adapter](../../src/config/authoring/coopDefenseAuthoringAdapter.ts) lässt Activity-Inhalte absichtlich weg. Der Generator liest unter anderem Tutorials, Checkpoints, Barrieren, Spawnquellen, Boss-Präsenz, Power-Ups und Ground-Hazards. | Diese Projektion allein reicht für die Editorvorschau nicht. Vollständige normalisierte Missionseingaben beibehalten. |
| Der Generator prüft Encounter-Spawngebiete und Fronten, liest dafür aber keine Gegneranzahlen. `ArenaLayout.seed` kann wegen Wiederholungsversuchen vom angeforderten Seed abweichen. | Mengenänderungen bestehender Gruppen brauchen keine Neugenerierung. Das Hinzufügen/Entfernen einer Gruppe kann hingegen eine Spawnquelle ändern. Angeforderten und tatsächlich verwendeten Seed getrennt anzeigen. |
| [analyzer.ts](../../src/debug/coopDefenseBalance/analyzer.ts) enthält tatsächlich `dynamic ||= addEncounterTotals(...)`. `finiteEnemyXp` enthält zudem den Boss. Eine zweite Lifecycle-XP-Rekursion existiert in `coopDefenseMaps.ts`. | Short-Circuit-Fehler beheben und eine gemeinsame Lifecycle-Fachlogik verwenden. Encounter-Summe und Boss-Summe ausdrücklich getrennt projizieren. |
| Die Lifecycle-Auswertung verhindert Endlosrekursion, kennzeichnet einen Zyklus aber nicht als unvollständige Rechnung. | Ergebnisvertrag um Vollständigkeit und konkrete Ursachen ergänzen; keine scheinbar exakte Zahl bei Zyklen oder unbekannten Gegnern. |
| [Tutorial-Geometrie](../../src/config/coopDefenseTutorial.ts) kennt explizite Metrics für die Felsregion, die Panel-Helfer greifen noch auf aktive globale Metrics zu. Zusätzliche Step-Flächen werden im Generator für explizite Anker erzeugt. | Gemeinsame metricsbasierte Geometrie für Panel, Felsfläche und Randbereich anbieten; Default- und Step-Verhalten unverändert abbilden. |
| `planTutorialSweep()` im [Airstrike-Handler](../../src/systems/CoopDefenseAirstrikeEventHandler.ts) ruft die Felsregion ohne Anker und ohne die bereits verfügbaren World-Metrics auf. Die [Event-Composition](../../src/activity/CoopMissionMapEventComposition.ts) übergibt keinen Tutorial-Anker. | Anker bis zum Planner weiterreichen und verschobene Tutorials mit einem Runtime-Verhaltenstest absichern. |
| Boss-Slots sind derzeit an `defeat-boss` gebunden; diese Missionsart verlangt einen Boss. `boss-phase` unterstützt aktuell nur Phase 2 des Void Hunter. | Kein freies Aktivieren eines Bosses auf beliebigen Maps und keine generische Phasenzahl vortäuschen. Eine erforderliche Boss-Löschung bleibt ein nicht speicherbarer Zwischenstand. |
| Basisanker haben verschiedene Koordinatenformen; `BaseRegistry` begrenzt die aufgelöste Position auf die Map. Vorhandene JSON-Dateien mischen kompakte und mehrzeilige Formatierung. | Ankerformen bewusst behandeln und außerhalb liegende Geometrie vor dem Runtime-Clamping melden. Quelltextbasierte, lokale JSON-Änderungen statt pauschaler Neuformatierung. |

## 3. Vorgeschlagene Architektur

### 3.1 Technischer Rahmen

- TypeScript, vorhandenes Vite und native HTML-Formulare; Canvas 2D für generiertes Terrain und eine eigene Zeichenebene für Vorgaben/Griffe. Kein zusätzliches UI-Framework und keine Phaser-Scene für den Editor.
- Eigenständiger Einstieg unter `tools/map-editor/`, eigener an Loopback gebundener Server; vorgeschlagener Port `8091` mit `strictPort`. Die Ports des Spiels werden nicht übernommen und laufende Prozesse nicht beendet.
- Eigene Vite-Konfiguration ohne Spiel-Warmup, Navigation-Report-Middleware oder erzwungene Phaser-/PeerJS-Chunks aus der normalen [Vite-Konfiguration](../../vite.config.ts).
- Die lokale API wird als `configureServer`-Plugin dieser Tool-Konfiguration eingebunden. `map:editor` startet Vite mit dieser Konfiguration und öffnet die Editorseite; ein zweiter Backend-Prozess ist dafür nicht erforderlich. Schreibendpunkte existieren ausschließlich im Tool-Server.
- Ein dedizierter Web Worker führt den synchronen Generator aus. Die Oberfläche bleibt währenddessen bedienbar. Die normale Spiel-Runtime wird nicht gestartet.
- Root-Abhängigkeiten weiterverwenden; kein separates Paketökosystem. Eine eigene Tool-TS-Konfiguration und `build:map-editor` erfassen Client und Worker, da die vorhandene [tsconfig.json](../../tsconfig.json) nur `src` einschließt. Den Editor-Build in das abschließende `check`-Gate aufnehmen.

### 3.2 Zuständigkeiten und geplante Module

Die folgenden neuen Pfade sind Vorschläge. Bestehende öffentliche Imports bleiben, soweit sinnvoll, als Fassade erhalten.

| Bereich / geplanter Ort | Verantwortung |
|---|---|
| `src/config/coopDefenseMapAuthoring.ts` | Registryfreie Map-Verträge, Normalisierung und fachliche Validierung. Bestehende Regeln werden verlagert, nicht nachgebaut. |
| `src/config/coopDefenseMapReferences.ts` | Typisierte Referenzstellen und Abhängigkeiten mit Dokumentpfaden; gemeinsame Grundlage für Validator und Editorhinweise. |
| `src/config/coopDefenseEnemyLifecycle.ts` | Feste direkte/Folge-XP, Lifecycle-Summen, dynamische Anteile und Vollständigkeit; Consumer sind Runtime-XP, Balance-Lab und Editor. |
| `src/config/coopDefenseMaps/sources.json` | Gemeinsamer Katalog erlaubter Quelldateien und ihrer Registry-Reihenfolge. Runtime-Registry und lokaler Dateizugriff verwenden dieselbe Zuordnung. |
| `tools/map-editor/client/document/` | Rohentwurf, Transaktionen, Undo/Redo, Dateibaseline und Formularzustände. |
| `tools/map-editor/client/encounters/` | Encounter-Tabelle, vollständige Gegnerliste, Gruppen, Trigger, Boss und XP-Darstellung. |
| `tools/map-editor/client/map/` | Kamera, Auswahl, Hit-Tests, Layer, räumliche Werkzeuge und Eigenschaften. |
| `tools/map-editor/client/preview/` | Worker, Auftragsrevisionen, Vorschauzustand und Variantenbericht. |
| `tools/map-editor/server/` | Erlaubter Dateizugriff, serverseitige Prüfung, Konflikterkennung und atomare Ersetzung. |

Die Trennung der Map-Regeln von der Registry muss auch transitive Imports erfassen. Beispielsweise zieht `BaseRegistry` heute schon durch einen importierten Default aus `coopDefenseMaps.ts` die geladene Registry heran. Der Editor-/Worker-Importgraph darf diesen Seiteneffekt nicht durch einen Umweg zurückholen. Dafür gezielt Imports auf den registryfreien Owner umstellen; kein pauschaler Runtime-Umbau.

Gemeinsame Spiellogik importiert niemals Editorcode. Der lokale Server kann die TypeScript-Fachprüfung über den vorhandenen Vite-SSR-Loader ausführen; Dateizugriffe verbleiben im Node-Prozess.

### 3.3 Datenhoheit

```text
Projektdatei + Quelltext-Hash
           ↓ explizites Laden
Rohentwurf ← Dokumenttransaktionen ← Formulare / Kartenwerkzeuge
    │                     └→ Undo/Redo
    ├→ lokale / fachliche Prüfung → Diagnosen mit Dokumentpfaden
    ├→ XP-Projektion für 1 Spieler
    ├→ frische normalisierte Kopie + WorldMetrics + Seed → Worker → Vorschau
    └→ explizites Speichern → erneute Serverprüfung → Quelltextänderungen → Datei
```

`MapDocumentSession` besitzt Rohentwurf, geladene Baseline, Datei-Revision und Historie. Normalisierte Daten und Canvas-Objekte sind ausschließlich Projektionen. Map-Auswahl, aktiver Tab, Scrollposition, Zoom, Layer, Preview-Seed und interne Gruppen-Schlüssel gehören zum Editorzustand und niemals ins Map-JSON.

Die gemeinsame Kopfzeile zeigt Map-Auswahl, Map-ID/Datei, schreibgeschützte Missionsart, Speichern, Undo/Redo und Änderungsstatus. Kartenauswahl und Encounter-Auswahl bleiben beim Ansichtswechsel erhalten.

Ein Dokumentwechsel beendet seine Worker-Aufträge und UI-Bindungen. Fehlgeschlagenes Speichern, Vorschaufehler und Ansichtswechsel verwerfen keinen Entwurf.

## 4. Dokumentbearbeitung, Validierung und Referenzen

### 4.1 Transaktionen und Rückgängig

- Eine abgeschlossene Zahlen-/Formulareingabe ist eine Transaktion. Enter oder Fokuswechsel übernimmt gültige Eingaben; Escape verwirft die laufende Eingabe.
- Ein Pointer-Drag beziehungsweise ein Wasser-Pinselstrich ist genau eine Transaktion. Währenddessen existiert eine temporäre Geometrie; Pointer-Abbruch/Escape stellt den Ausgangszustand wieder her.
- Vorübergehend leere oder unvollständige Textfelder leben separat vom Rohentwurf. Insbesondere löscht ein leeres Mengenfeld keine Spawn-Gruppe. Solange Eingaben offen/ungültig sind, darf Speichern nicht still den vorherigen Wert schreiben.
- Gültige Feldwerte können einen fachlich ungültigen Gesamtentwurf ergeben, etwa einen leeren Encounter oder außerhalb liegende Geometrie. Der Entwurf bleibt bearbeitbar; die Fehler sperren das Speichern.
- Bestehende IDs bleiben erhalten und sind in V1 nicht frei umbenennbar. Neue Encounters/Korridore/Felswände erhalten eindeutige IDs. Arrays ohne authored ID erhalten stabile interne Sitzungsschlüssel, damit Auswahl und Undo nicht allein an veränderlichen Indizes hängen.
- Undo/Redo erhält Reihenfolge, unbekannte Felder und Auswahlbezug. Eine Änderung nach Undo verwirft den Redo-Zweig. Der Änderungsstatus vergleicht den aktuellen Rohentwurf mit der gespeicherten Baseline; bloßes Öffnen oder Rückkehr zur Baseline ist sauber.
- Speichern löscht die Historie nicht. Bei Änderungen während eines laufenden Speichervorgangs bestätigt die Antwort nur den gesendeten Dokumentstand; neuere Änderungen bleiben als ungespeichert markiert.

### 4.2 Prüfgrenzen

1. **Datei-/Strukturprüfung:** gültiges JSON, erwartete Grundstruktur, zulässige Dokumentidentität. Unbekannte Felder bleiben erhalten. Syntaxfehler werden je Datei gemeldet und legen den Katalog nicht lahm; V1 enthält keinen allgemeinen JSON-Texteditor.
2. **Eingabeprüfung:** endliche Zahlen, ganzzahlige Mengen/Zellen, nichtnegative Zeiten, positive Ausdehnungen, gegenseitiger Ausschluss von `front` und `spawnArea`. Sekunden werden exakt in den bestehenden Millisekundenvertrag übersetzt. Feldgrenzen/Defaults stammen aus gemeinsamen Regeln.
3. **Fachliche Prüfung:** vorhandene Map-Normalisierung und Referenzprüfung auf einer Kopie. Diese bleibt auch serverseitig das Speichergate. Neue Diagnosen tragen mindestens Schweregrad, Code, JSON-Pfad, Objektbezug und verständlichen Text; bestehende Fehler nicht dauerhaft über String-RegEx als API auswerten.
4. **Geometrie-/Vorschauprüfung:** ursprüngliche sowie tatsächlich aufgelöste Positionen gegen World-Metrics prüfen; Generierungsfehler und Variantenbefunde separat anzeigen. Eine erfolgreiche Generierung ist kein Beleg für vollständige spielerische Lösbarkeit.

Blockierende Fehler verhindern das Speichern. Hinweise auf geänderte Reihenfolgesemantik, unwirksame Werte, bedingt erreichbare XP oder eine veraltete Vorschau sind Warnungen/Hinweise. Eine neue Vorschauerzeugung ist keine Voraussetzung für jede Speicherung; die Fünf-Varianten-Prüfung wird nie automatisch gestartet.

Die Fehlerliste führt zur betroffenen Kartenposition oder Formularzeile. Fehler in schreibgeschützten Inhalten zeigen ebenfalls Datei- und Dokumentpfad. Keine automatische Reparatur, Umordnung, Feldentfernung oder Default-Materialisierung.

### 4.3 Referenzbehandlung

Die gemeinsame Referenzanalyse erfasst mindestens Encounter-Trigger, Event-Trigger, Secondary-Objective-`start`/`focusUntil`/`holdUntil`, Checkpoint-`completeOn`, Barrieren-`openOn`, Mandatory-Defenses, Tutorial-Checkpoint-Bezüge, Bossabhängigkeiten und referenzierte Basen/Felswände.

- Encounter-/Felswand-Löschen wird bei verbleibenden Referenzen blockiert; alle betreffenden Stellen werden genannt. Nicht editierbare Events werden mitgeprüft.
- Vor einem Umordnen wird der Kandidatenstand fachlich geprüft. Explizite ID-Referenzen bleiben unverändert; für `after-previous` erscheint der Wechsel des Vorgängers vor der Übernahme. Das gilt auch, wenn eine Löschung eine relative Nachbarschaft verändert.
- Zyklische Abhängigkeiten, ungültige Secondary-Objective-Fenster oder ein `after-previous` am ersten Platz werden nicht unbemerkt übernommen. Eine eindeutig ungültige Umordnung wird mit Grund zurückgewiesen.
- Die zyklische Fachprüfung bleibt beim gemeinsamen Validator. Der Editor führt keine zweite unabhängige Trigger-Engine ein.

## 5. Funktionspaket Encounter und XP

### 5.1 Bedienung

Die Encounter-Übersicht zeigt Quelldokument-Reihenfolge, ID, typisierten Starttrigger, wirksame Pause, direkt eingeplante Anzahl, feste XP und Hinweise. Auf/Ab verändert ausdrücklich die Dokumentreihenfolge; es gibt keine versteckte Sortierung der Ausführung.

Darunter stehen standardmäßig **alle** Arten aus `COOP_DEFENSE_ENEMY_KINDS`, mit Namen aus `getEnemyName()`, direkter XP pro Gegner, Menge und XP-Beitrag. Suche und „Nur verwendete“ sind Zusatzfilter. Boss-Arten bleiben begründet deaktiviert sichtbar.

Bei null oder einer Gruppe ist die Hauptmenge bearbeitbar; bei mehreren Gruppen ist sie eine schreibgeschützte Summe. Unterzeilen bearbeiten jede bestehende Gruppe einzeln und erhalten deren Reihenfolge und Zusatzfelder. Gruppen bieten Menge, Verzögerung, Spawnfenster und die Alternative Front/Gebiet. Eine neue Gruppe zeigt den wirksamen `DEFAULT_SPAWN_FRONT` ausdrücklich an; sie übernimmt keinen zufälligen Nachbarwert. Beim Wechsel zu einem Gebiet wird `front` entfernt, beim Wechsel zurück `spawnArea`.

„Spawngebiet auf Karte bearbeiten“ selektiert den stabilen Gruppenbezug. Beim Rückwechsel bleiben Encounter-Auswahl und Scrollposition erhalten. Der Bossbereich bietet Art und Zeitpunkt entsprechend den aktuellen Missionsregeln; einen Boss-Spawnpunkt gibt es nicht.

Missionssemantik wird aus den aktuellen Director-/Resolver-Regeln abgeleitet: `repel-assault` führt seine geordnete Clear-/Rest-Kette aus; im geplanten Modus wirkt eine Vorgängerpause über `after-previous`. Die Pause nach dem letzten Encounter ist unwirksam. `after-defense` bedeutet terminal abgeschlossen, also auch gescheitert; nicht automatisch erfolgreich verteidigt.

### 5.2 Gemeinsame XP-Auswertung

Der sichtbare Bezug lautet „Konfiguriertes XP-Potenzial · 1 Spieler“. Bearbeitet werden stets authored Mengen. Die Berechnung verwendet den zentralen Spawn-Resolver mit Spielerzahl 1 und gemeinsame Gegnerdaten; sie erzeugt kein Gelände.

Der gemeinsame Lifecycle-Resolver liefert direkte XP, feste Folge-XP, direkte/Folge-Anzahl, dynamische Hinweise sowie `complete` und Diagnoseursachen. Der Balance-Analyzer kann seine bestehenden HP- und Mechanikwerte weiterhin daraus ableiten. Registry-Prüfung und Rekursionsschutz verhindern, dass Zyklen in Runtime-XP als endliche exakte Konfiguration akzeptiert werden; die Editorprojektion kann einen unvollständigen Teilbetrag ausdrücklich kennzeichnen.

Getrennte Anzeigen:

| Kennzahl | Inhalt |
|---|---|
| Ausgewählter Encounter / Encounter-Summe | Direkte Gegner-XP plus feste `deathSpawns`; direkte und Folgeanteile aufklappbar. |
| Boss | Eigener Slot einschließlich fester Folgeanteile, genau einmal. |
| Weitere feste XP | Bestehende Nebenzielbelohnungen, schreibgeschützt, bedingt erreichbar; keine Addition zum Encounterwert. |
| Dynamische Quellen | `spawnThrow`, permanente Spawns und weitere tatsächlich modellierte Laufzeitquellen ohne scheinbar exakte Gesamtsumme. |

Optional angezeigte Referenzwerte permanenter Quellen nennen Bezugsdauer und Annahmen. Bestehende `finiteEnemyXp`-Semantik im Balance-Lab nicht still umdefinieren: Sie enthält weiterhin den Boss, während der Editor eine ausdrücklich andere Teilansicht erhält. Die Short-Circuit-Korrektur wird durch „dynamischer Encounter, danach weiterer Encounter“ abgesichert.

Ist eine fachlich unabhängige Stelle des Entwurfs ungültig, können prüfbare Encounter weiter berechnet werden. Unbekannte Gegner, unvollständige Eingaben oder defekte Lifecycle-Konfigurationen erscheinen dagegen als unvollständig; kein stiller Nullwert und keine veraltete Zahl ohne Kennzeichnung.

## 6. Funktionspaket Karte

Linke Objektliste, mittlere zoombare Draufsicht, rechte Eigenschaften. Generiertes Terrain ist eine lesende Ebene; darüber liegen bearbeitbare Vorgaben mit Auswahlgriffen. Schematische 90°-Draufsicht, klare Legende und unterscheidbare Farben/Linien genügen. Kein Asset-Produktionspaket.

Alle Werkzeuge verwenden `WorldMetrics`, `CELL_SIZE` und die gemeinsamen Zell-/Welt-Konvertierungen. Ganzzahlige Authoring-Felder bleiben auch ohne optionales Fangraster ganzzahlig; Radien und dafür zugelassene Korridorpunkte dürfen ihre vertragliche Genauigkeit behalten. Geklemmte Runtime-Konverter dürfen außerhalb liegende Editorpositionen nicht verbergen.

| Element | V1-Bearbeitung und tatsächliche Quelle |
|---|---|
| Map-Maße | `arenaWidthCells`/`arenaHeightCells`; beim Verkleinern sämtliche betroffenen Vorgaben und aufgelösten Geometrien auflisten. Nichts abschneiden oder automatisch verschieben. |
| Fels-/Baumparameter | `rockFillRatio`, `treeCount`, `rockField.fillMode`, Dichteskalierung und globale Korridorparameter. Bei `solid` die unwirksame Noise-Dichte und unterdrückte Baumplatzierung erklären. |
| Korridore | Anlegen/duplizieren/löschen, Wegpunkte ergänzen/verschieben/entfernen, Radius ändern. Beim ersten Korridor einen fehlenden `rockField`-Block bewusst mit sichtbaren, gemeinsam definierten Werten anlegen. |
| Wasserflächen | `waterAreas[]` als Rechtecke anlegen/verschieben/skalieren/löschen; `water[]` mit einem Zellwerkzeug. Bereiche und Einzelzellen bleiben getrennte Authoring-Quellen. |
| Felswände | `rockWalls[]` anlegen/verschieben/skalieren/duplizieren/löschen; Referenzen aus Checkpoints vor Löschung prüfen. |
| Tutorial | Hauptanker `tutorialAnchor` und vorhandene `tutorialSteps[].anchor` verschieben; Panel, Felsfläche und Randbereich gemeinsam darstellen. Kein Skaliergriff. |
| Start/Checkpoints | Vorhandene `missionProgress.startArea` sowie Checkpoint-Positionen und Radien; IDs, Reihenfolge, Trigger, Respawn- und Abschlussregeln erhalten. |
| Normale Basen | Vorhandene `bases[].anchor` ändern; Form, Rolle, HP, Turrets und lokale Anbauten bleiben erhalten und bewegen sich mit der Basis. Kein Basisbaukasten. |
| Persistenter Basiskern | `persistentBase.anchor` als Quelle; niemals den daraus normalisierten `bases`-Eintrag zurückschreiben. Reservierungsfläche aus gemeinsamen Regeln darstellen. |
| Carry-/Missionszonen | Vorhandene `secondaryObjectives[].carry.spawnZone`/`deliveryZone` als Rechtecke bearbeiten; Missionsfunktion und Belohnungen bleiben unverändert. |
| Encounter-Spawns | Das `spawnArea` genau einer Gruppe bearbeiten; Encounter, Gegnerart und Gruppenschlüssel bleiben sichtbar. |
| Abgeleitete Basisvorschau | `persistentBasePreview` zeigt die Position seines Checkpoints; Auswahl führt zu diesem Quellobjekt, nicht zu einer zweiten Position. |

Bestehende andere Geometrie wie Gleise, Missionsbarrieren, Eventflächen und nicht freigegebene Pickup-Vorgaben bleibt sichtbar und schreibgeschützt. Sie wird weiterhin bei Vorschau, Bounds- und Referenzprüfung berücksichtigt. V1 fügt keine neuen Checkpoints, Tutorial-Schritte, Basen oder Missionsketten hinzu.

Für relative Basisanker bleibt die bestehende Bindung zunächst erhalten: `center-offset` verschiebt seine Offsets; `left-center`/`right-center` bieten die im Modell mögliche Bewegung. Freies zweidimensionales Platzieren erfordert eine ausdrücklich bezeichnete Umstellung auf `grid` innerhalb derselben Undo-Transaktion. Beim bloßen Laden findet diese Umstellung nicht statt.

Beim Wasser-Zellwerkzeug wird nur die explizite Zellenliste bearbeitet. Eine durch `waterAreas` bedeckte Zelle lässt sich dadurch nicht aus der Vereinigungsmenge ausschneiden; die Oberfläche verweist dann auf das betreffende Rechteck. Keine versteckte Expansion eines Rechtecks in Einzelzellen.

Fehlende optionale Werte zeigen ihren wirksamen Standard und die Herkunft. „Auf Standard zurücksetzen“ entfernt ein optionales Feld gezielt. Das gilt auch für Tutorial-Anker: Der Default stammt aus der vorhandenen Tutorial-Geometrie und nicht aus einem danebenliegenden Checkpoint. Zusätzliche Schritte benutzen die kurzen Panelmaße; ein verschobener Checkpoint verschiebt einen separat authorierten Tutorial-Anker nicht.

## 7. Generatorvorschau und Variantenprüfung

### 7.1 Ablauf

1. Dokumentstand erfassen; unvollständige Formulareingaben und Strukturfehler vorab melden.
2. Eine frische Kopie mit `normalizeCoopDefenseMapConfig()` einmalig normalisieren und dabei fachlich validieren.
3. Metrics über `resolveCoopDefenseWorldMetrics()` bilden und `resolveArenaGenerationInput()` für `COOP_DEFENSE_MODE` verwenden.
4. Vollständige normalisierte Map plus Metrics und festgehaltenen Seed an den Worker geben.
5. `ArenaGenerator.generate()` unverändert ausführen. Felsen, Wasser, Bäume, Gleise, Pedestals und relevante Hazardflächen aus dem Ergebnis zeichnen; Basen und Missionsmarker über dieselben Resolver/Quellen ergänzen.
6. Auftrag, Dokumentidentität und Geometrie-Revision vor Übernahme prüfen. Überholte Ergebnisse verwerfen; das zuletzt gültige Layout bis dahin deutlich als veraltet kennzeichnen.

Der Worker erhält keine geladene Map-ID als Ersatz für den Entwurf. Er lädt keinen alten Stand aus der Registry nach. Der Seed wird beim ersten Öffnen gesetzt, bleibt während Änderungen/Undo bestehen und wird ausschließlich durch „Neue Variante“ ersetzt. „Aktualisieren“ verwendet denselben Ausgangsseed. Angezeigte Diagnosewerte: Ausgangsseed, Ergebnis-Seed, Generatorversion, Fingerprint und Laufzeit.

### 7.2 Invalidierung und Abbruch

Eine kleine, beim Generator verortete Projektion beschreibt die tatsächlich geometriewirksamen Eingaben. Der vollständige Input geht weiterhin in die Generierung; die Projektion dient nur dem Vergleich und der Invalidierung. Relevante Änderungen an der Inputgrenze werden mit einem Paritätstest abgesichert.

- Counts/Delays/XP bei unverändertem Gruppenbestand und gleicher Spawngeometrie ändern den Vorschauzustand nicht.
- Neue/entfernte Gruppen, Fronten, Spawngebiete, Boss-Präsenz, Maße, Gelände, Basen, Tutorials und weitere vom Generator gelesene Missionsgeometrie invalidieren ihn entsprechend ihrer tatsächlichen Wirkung.
- Auswahl, Zoom, Layer und Ansicht sind keine Geometrieänderungen.
- Während einer Generierung sind weitere Bearbeitungen erlaubt. Ein expliziter Abbruch/ersetzender Auftrag beendet bei Bedarf den Worker und startet ihn neu, da eine reine Abbruchnachricht die synchrone Berechnung nicht unterbrechen würde.
- Ungültige Rohdaten erzeugen keinen neuen Job. Fehler/Timeout behalten Entwurf und letztes gültiges Ergebnis; sie zeigen eine konkrete Diagnose und erlauben einen neuen Versuch.

### 7.3 Fünf Varianten

Ein ausdrücklicher Aufruf friert einen Dokumentstand ein und erzeugt nacheinander fünf reproduzierbare Ausgangsseeds. Der Bericht nennt je Variante Ergebnis-Seed, Erfolg/Fehler, Laufzeit und verfügbare Generatordiagnosen. Gleiche Ergebnis-Fingerprints infolge Retry-Konvergenz werden erkennbar; fünf Anfragen sind nicht automatisch fünf unterschiedliche Layouts.

Für Auffälligkeiten werden vorhandene Generator-/Routenprüfungen genutzt beziehungsweise ihre bereits getroffenen Entscheidungen als Diagnose ausgegeben. Kein zweiter Navigationsvalidator mit abweichenden Regeln. Bewusst zerstörbare Felswände und Missionsbarrieren dürfen nicht pauschal als unlösbare Karte gelten. Die Stichprobe ist abbrechbar, überschreibt keinen neueren Entwurf und ersetzt keinen Spieltest.

## 8. Lokales Speichern und Konflikte

### 8.1 Schnittstelle

Ein kleiner Server bietet Map-Katalog, Laden und Speichern, beispielsweise `GET /api/maps`, `GET /api/maps/:sourceKey` und `PUT /api/maps/:sourceKey`. `sourceKey` wird ausschließlich gegen den gemeinsamen Katalog aufgelöst; der Client übermittelt keinen Dateipfad. Laden liefert Originaltext, Dokumentidentität und einen Hash der Originalbytes.

Der Server bindet an `127.0.0.1`, akzeptiert nur die eigene Origin und verwendet für Schreibaufrufe ein Sitzungstoken. Pfade werden nach Auflösung einschließlich Symlinks auf den erlaubten Map-Ordner begrenzt. Es gibt keine Shell-, Upload-, Neuanlage- oder beliebige Dateischreibschnittstelle.

Die Speichernachricht enthält Baseline-Revision und den vollständigen Rohentwurf. Serverseitig werden Identität, erlaubte Änderungen, Referenzen und fachliche Gültigkeit erneut geprüft. Nicht freigegebene Felder müssen gegenüber der geladenen Baseline unverändert bleiben; neue/duplizierte Objekte unterliegen ihren jeweiligen Dokumentoperationen.

### 8.2 Schreibablauf

1. Laufende Änderungen abschließen; bei identischem Entwurf keinen Schreibauftrag auslösen.
2. Aktuelle Datei lesen und ihren Byte-Hash mit der geladenen Revision vergleichen. Fehlende Datei oder anderer Hash ergibt einen Konflikt.
3. Den Rohentwurf serverseitig prüfen und Änderungen gegen den geladenen Originaltext erstellen. Normalisierte Daten dienen ausschließlich der Prüfung.
4. Unveränderte Quelltextbereiche bytegetreu behalten. Den vorhandenen TypeScript-JSON-Parser (`parseJsonText`) für Positionsinformationen nutzen; nur betroffene Werte beziehungsweise strukturell veränderte Container ersetzen. Einrückung, Zeilenenden und abschließenden Zeilenumbruch übernehmen. Das fertig erzeugte JSON erneut parsen und auf semantische Gleichheit mit dem Entwurf prüfen.
5. Vollständigen Inhalt in eine eindeutig benannte temporäre Datei im selben Verzeichnis schreiben, flushen und schließen. Schreibvorgänge des Tools je Map serialisieren.
6. Direkt vor Ersetzen die Revision nochmals prüfen; anschließend die Originaldatei atomar ersetzen. Auf Windows Fehler wie eine gesperrte Datei sauber melden. Kein Fallback „Original löschen und dann schreiben“.
7. Erst nach Erfolg neue Baseline/Revision bestätigen. Bei Fehlern die Originaldatei und den Browserentwurf behalten; temporäre Reste kontrolliert bereinigen.

Die Hash-Prüfung ist optimistische Konflikterkennung. Sie sperrt fremde Programme nicht; eine absolute Transaktion mit gleichzeitig schreibenden externen Editoren wird nicht behauptet. Dieser Grenzfall und das Ersetzungsverhalten unter Windows werden im Dateisystemtest ausdrücklich berücksichtigt.

Ein Konflikt bietet „Entwurf als Datei sichern“ und „Neu laden und eigenen Stand verwerfen“ nach bewusster Entscheidung. Der Export bewahrt den Rohentwurf und Basisinformationen zur Konfliktklärung; es gibt in V1 keinen automatischen Merge und kein erzwungenes Überschreiben.

Map-Dateien werden über die API statt als HMR-Imports geladen. Dateiwatcher können externe Änderungen anzeigen, ersetzen aber nie den Entwurf. Für den Tool-Einstieg automatisches Full-Reload bei Quelländerungen unterbinden. Map-Wechsel, Neuladen und Tab-Schließen warnen bei offenen Änderungen; Ansichtwechsel tun das nicht. Keine automatische Speicherung, Git-Commits oder Pushes.

## 9. Arbeitspakete und Reihenfolge

| Paket | Inhalt | Abhängigkeit | Fertig, wenn … |
|---|---|---|---|
| **A – Gemeinsame Regeln und Datenzugang** | Rohquellkatalog; registryfreie Map-Regeln/Defaults; referenzierbare Diagnosen; gemeinsame Lifecycle-Auswertung; Short-Circuit-Korrektur. Relevante Imports umstellen. | – | Einzelne Rohmaps unabhängig ladbar sind, Runtime-Verträge weiter gelten und die XP-Regression abgesichert ist. |
| **B – Dokumentkern und sichere Speicherung** | Entwurf/Baseline, Transaktionen, Undo/Redo, Feldpuffer, lokale API, Quelltextänderungen, atomare Speicherung, Konfliktexport und Wechselwarnungen. | A | Eine isolierte Feldänderung verlustfrei speicherbar ist; No-op, Undo, externe Änderung und fehlgeschlagener Write geprüft sind. |
| **C – Echte Vorschau als frühe Integrationsstrecke** | Tool-Shell, Canvas/Kamera, Worker, vollständige Map-Eingaben, feste Seeds, Invalidierung und Abbruch. Zunächst Maße plus ein Rechteckwerkzeug anschließen. | A, B | Eine Rohdatenänderung durch Transaktion, Generator, sichtbares Overlay, Undo und Speichern durchgängig funktioniert. |
| **D – Vollständige Encounter-Ansicht** | Übersicht, alle Gegner, Multi-Gruppen, Trigger, Reihenfolge/Referenzen, Boss, XP und Sprung zur Karte. | A, B; C für Kartensprung | Der gesamte Encounter-Umfang einschließlich Sondersemantik ohne manuelle JSON-Nacharbeit bedienbar ist. |
| **E – Vollständige räumliche Werkzeuge** | Geländeparameter, Korridore, Wasser, Wände, Start/Checkpoints, Basisanker, Carry-Zonen und gruppengebundene Spawngebiete; Layer und Bounds-Diagnosen. | C; D für Gruppenbindung | Alle freigegebenen Geometrien über Maus und Eigenschaften denselben Entwurf ändern und verlustfrei gespeichert werden. |
| **F – Tutorial-Parität und Varianten** | Gemeinsame Tutorial-Geometrie, Anker-Weitergabe zum Airstrike-Planner, korrekte Step-Flächen, fünf Varianten und Diagnosebericht. | C, E | Verschobene Tutorials Generator, Darstellung und Luftangriff konsistent erreichen; Varianten abbrechbar und revisionsgebunden sind. |
| **G – Integration und V1-Abnahme** | Repräsentative Bestandsmaps, Fehler-/Konfliktabläufe, Build-Gates, kurze Bedienungsdokumentation und abschließende Scope-Prüfung. | A–F | Alle Abnahmekriterien erfüllt und verbleibende Einschränkungen ausdrücklich dokumentiert sind. |

**Empfohlener Start:** A und B, danach C als vertikale Integrationsstrecke. Damit werden Rohdatenverlust, Importkopplung und Generator-Parität geprüft, bevor der Großteil der Oberfläche entsteht. D und E bleiben gleichrangige Pflichtpakete; ihre Reihenfolge ist keine Verschiebung von Kartenbearbeitung auf V2.

Grobe Planung für eine mit dem Projekt vertraute Person: **15–25 Arbeitstage**, einschließlich Prüfungen und Integration, ohne aufwendiges UI-Design. Das ist eine Aufwandsspanne, keine Terminzusage. Nach C neu schätzen: die wesentlichen Unsicherheiten liegen im verlustarmen JSON-Schreiben, in der Entkopplung des Importgraphs und in den räumlichen Sonderfällen. Es sind keine fehlenden Produktentscheidungen erkennbar, die den Start von A/B blockieren.

## 10. Prüfstrategie und Abnahme

Die [Testpolicy](../ai/testing.md) gilt. Bestehende Tests erweitern; neue Tests nur für neue langlebige Editorverträge. Vorhandenes Vitest verwenden, keine neue Test-/Browser-/CI-Infrastruktur.

| Bereich | Wesentliche Regressionen / vorhandene Einstiegspunkte |
|---|---|
| Rohdaten/Datei | Unbekannte Felder, fehlende Defaults und unveränderte Gruppendaten bleiben erhalten; `waterAreas` bleiben Rechtecke; No-op erzeugt keinen Write; Undo bis zur Baseline; abgebrochener Drag; Konflikt und Schreibfehler erhalten Original; paralleles Editieren während Save bleibt dirty. Neue kleine Dokument-/Dateivertragstests. |
| Fachliche Regeln | Referenzen aus nicht editierbaren Inhalten, leere Encounter, Triggerzyklen, Umordnung, verbotene Boss-Konfigurationen; [CoopDefenseEncounters](../../tests/CoopDefenseEncounters.test.ts), [CoopDefenseMaps](../../tests/CoopDefenseMaps.test.ts), [CoopDefenseMapDirector](../../tests/CoopDefenseMapDirector.test.ts). |
| XP | Nach dynamischem Encounter weiterhin alle Folgenden zählen; direkte/feste/dynamische Anteile; Boss genau einmal; Mehrfachgruppen; Zyklen/unbekannte Arten; [CoopDefenseBalanceLab](../../tests/balance-lab/CoopDefenseBalanceLab.test.ts) sowie vorhandene Scheduled-XP-Tests. Keine festen aktuellen Balancezahlen duplizieren. |
| World/Generator | Editorpfad und Runtime-Eingaben ergeben bei gleicher Map/Seed/Metrics denselben Fingerprint; globale aktive Metrics sind irrelevant; [ArenaGeneratorWorldMetrics](../../tests/ArenaGeneratorWorldMetrics.test.ts), [WorldActivityAuthoring](../../tests/WorldActivityAuthoring.test.ts), [WaterTerrain](../../tests/WaterTerrain.test.ts). |
| Preview-Protokoll | Überholte Workerantwort, Map-Wechsel, Abbruch, Fehler und fünf aufeinanderfolgende Jobs; Mengenänderung ohne Geometriewechsel bleibt aktuell, neue Spawnquelle wird veraltet. Controllerverhalten ohne Screenshot prüfen. |
| Tutorial | Anker, Default, Steuerungsvariante und kurze Step-Fläche stimmen überein; Luftangriff folgt verschobenem Anker auch bei fremden globalen Metrics; [CoopDefenseTutorialArena](../../tests/CoopDefenseTutorialArena.test.ts), [CoopDefenseTutorialAdvanceMap](../../tests/CoopDefenseTutorialAdvanceMap.test.ts), [CoopDefenseC2](../../tests/CoopDefenseC2.test.ts). |
| Integration/Stress | Passende Tests unter `tests/integration/` bei World-/Activity-Vertragsänderungen; gezielte Multi-Seed-Fälle in [CoopDefenseArenaGeneration](../../tests/stress/CoopDefenseArenaGeneration.test.ts) statt umfangreicher Seed-Loops im Core. |

Für A–F jeweils die passenden fokussierten Tests ausführen. Abschlussgate: `npm run check`, gezielte Integrationstests, `npm run test:balance-lab -- tests/balance-lab/CoopDefenseBalanceLab.test.ts` und die betroffenen Generierungs-Stresstests. Der Editor-Build muss zusätzlich zum normalen Spiel-Build abgedeckt sein; nicht unmittelbar davor nochmals separat typechecken.

Eine echte Browser-/Sichtprüfung bleibt gemäß Projektregel opt-in. Die aktuelle Planungsanfrage startet weder Server noch Browser. Bei später ausdrücklich beauftragter Sichtprüfung `npm run dev:browser -- --config tools/map-editor/vite.config.ts` verwenden und HTTP 200 auf `http://127.0.0.1:8090/` abwarten; die Tool-Konfiguration muss dort den Editor inklusive API bereitstellen. Der normale Editorstart bleibt `map:editor` auf Port 8091. Ohne diese Freigabe ist die manuelle UI-Abnahme als nicht verifiziert zu melden.

Die manuelle Abnahme deckt mindestens eine `repel-assault`-Map, eine Boss-Map, eine `survive`-Map mit permanenten Quellen, eine `advance`-Map mit Tutorial/Checkpoints und eine Map mit Carry-Zonen ab. Bestehende Maps mit `waterAreas`, relativen Basisankern und mehreren Gruppen derselben Gegnerart werden gezielt einbezogen; fehlende Sonderfälle werden in temporären Testentwürfen statt durch neue Kampagnenmaps geprüft.

### V1-Abnahmekriterien

- [x] Das Tool startet ohne Lobby, Multiplayer und Spielsimulation; alle freigegebenen Bestandsmaps sind auswählbar.
- [x] Öffnen, Ansichtwechsel und unverändertes Speichern verändern keine Datei; eine Bearbeitung erhält alle nicht betroffenen Daten und fehlenden optionalen Felder.
- [x] Encounters lassen sich anlegen, duplizieren, löschen und kontrolliert umordnen; Referenzen einschließlich schreibgeschützter Inhalte bleiben gültig.
- [x] Die vollständige Gegnerliste, Multi-Gruppen, Front/Gebiet, Trigger und Boss funktionieren gemäß vorhandenen Regeln; null ist keine gespeicherte Gruppe.
- [x] XP bleiben nach dynamischen Encounters vollständig; Encounter, Boss, bedingte Rewards und dynamische Quellen sind nachvollziehbar getrennt.
- [x] Alle im Konzept geforderten Gelände- und Missionswerkzeuge sind vorhanden, einschließlich einzelner Wasserzellen und gekoppelter Tutorial-Flächen.
- [x] Tutorial-Anker wirken auch im Runtime-Luftangriff; das unabhängige Verschieben eines Checkpoints verändert keinen separat gesetzten Tutorial-Anker.
- [x] Gleicher Rohstand und Ausgangsseed erzeugen dasselbe Generatorergebnis wie der Missionspfad; vollständige relevante Eingaben werden berücksichtigt.
- [x] Seedwechsel, Aktualisierung, „Vorschau veraltet“, Worker-Abbruch und fünf Varianten sind nachvollziehbar; überholte Ergebnisse können keinen aktuellen Stand überschreiben.
- [x] Zahlenfeld und Mausoperation verändern dieselbe Quelle; ein Drag ist genau einmal rückgängig machbar; Auswahl bleibt beim Ansichtswechsel erhalten.
- [x] Externe Dateiänderungen, fehlgeschlagene Writes und offene Eingaben führen nicht zu stiller Datenvernichtung; der eigene Entwurf kann bei Konflikten gesichert werden.
- [ ] Vollständiges Projektgate grün: Spiel- und Editor-Build, Architecture sowie gezielte Editor-/Balance-/Generatorprüfungen bestehen. Zwölf Fehler der breiten Core-/Integration-/Stressläufe sind am unveränderten Git-Stand reproduziert; siehe Abnahmebericht in der Editor-Dokumentation.
- [x] Manuelle UI-Abnahme ist nach ausdrücklicher Beauftragung durchgeführt oder klar als noch ausstehend ausgewiesen. Erst die gemeinsame Karten-/Encounter-Abnahme schließt V1 ab.

## 11. Dokumentation nach der Umsetzung

Eine kurze Tool-Anleitung beschreibt Start, freigegebene Felder, Default-Herkunft, Undo, Seed-/Vorschausemantik und Konfliktbehandlung. Dieser Plan bleibt Planungs-/Abnahmeunterlage unter `docs/GDDs/`.

Die normative Architektur wird durch diesen Plan nicht umgeschrieben. Ein späterer Writeback nach `docs/ai/` erfolgt nur für dann im Code und in Tests verifizierte, systemübergreifende Verträge, insbesondere gegebenenfalls den gemeinsamen Rohdaten-/Normalisierungs- und Generatorinput-Vertrag.
