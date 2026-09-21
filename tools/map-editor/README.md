# Fragdachse Map-Editor V1

Lokales Werkzeug zum Bearbeiten bestehender Kampagnenmaps. Karte und Encounter arbeiten auf demselben Rohentwurf; Lobby, Phaser-Renderer und Multiplayer werden nicht gestartet.

## Start

```sh
npm run map:editor
```

Öffnet den Editor auf `http://127.0.0.1:8091/`. Der Prozess muss Schreibrechte auf `src/config/coopDefenseMaps/` besitzen. Für die ausdrücklich freigegebene Browserprüfung:

```sh
npm run dev:browser -- --config tools/map-editor/vite.config.ts
```

Dieser Aufruf verwendet Port 8090. `npm run build:map-editor` prüft TypeScript und erzeugt den Client-Build; die lokale Datei-API gehört zum Vite-Editorprozess. `npm run check` enthält zusätzlich zum Spiel-Build diesen Editor-Build.

## Bedienung

- **Karte:** Objekt links auswählen, auf der Karte ziehen oder Eigenschaften rechts ändern. Mausrad zoomt, rechte/mittlere Maustaste verschiebt die Ansicht. Rechtecke besitzen Größen- und Korridore Wegpunktgriffe. Ein Drag ist eine Undo-Transaktion; Escape bricht ihn ab.
- **Gelände:** Maße, Noise-/Felsfeldparameter, Korridore, Wasserrechtecke, einzelne Wasserzellen und Felswände bearbeiten. Solid-Felsfelder kennzeichnen unwirksame Noise-/Baumparameter. Das Wasser-Radierwerkzeug bearbeitet nur explizite Einzelzellen; Wasserrechtecke bleiben eigenständige Quellen.
- **Missionsgeometrie:** Bestehende Tutorial-Anker, Startbereiche, Checkpoints, Basisanker, Carry-Zonen und Spawngebiete bewegen. Tutorialgrößen folgen den tatsächlichen Panels. Basisform, lokale Anbauten, Missionsfunktion und Belohnungen bleiben erhalten. Relative Basisanker können ausdrücklich auf freie Grid-Positionierung umgestellt werden.
- **Feuerfronten:** Bestehende rechteckige Feuerfronten (z. B. Map 14) über ihre eigene Ebene auswählen. Position und Größe per Feldern, Ziehen, Eckgriffen oder „Gebiet neu aufziehen“ ändern. Startzeit, Verzögerung, Ausbreitungsdauer, Vorwarnzeit je Zelle und Nachbrenndauer bei Treffern werden in Sekunden bearbeitet. Die Unregelmäßigkeit der Front ist ebenfalls einstellbar. Erreichte Flächen bleiben dauerhaft aktiv; die Vorschau zeigt die gesamte Zielfläche. Auslöserart, Schadenswerte und Ereignisidentität bleiben erhalten.
- **Überlappende Objekte:** Feuerfronten liegen bei Darstellung und Auswahl hinter den übrigen Objekten. Alt+Klick wechselt durch alle getroffenen Objekte; die Feuerfront selbst bleibt über freie Bereiche, ihren Rand und die Objektliste erreichbar. Ausblenden der Ebene entfernt auch ihre Auswahlfläche.
- **Power-Ups:** Eigene Kartenebene; Art, feste Position oder automatische Region bearbeiten. Automatische Positionen sind erst nach „Aktualisieren“ auf der Karte auswählbar; Ziehen setzt einen festen Anker. Unter „Map & Gelände“ Power-Ups hinzufügen, in ihren Eigenschaften löschen. Bestehende Basis-Power-Ups lassen sich ebenfalls ändern und behalten ihre lokalen Zellversätze zur Basis.
- **Gleise:** Unter „Map & Gelände“ ein-/ausschalten und links, mittig, rechts oder auf einer festen Spalte platzieren. Ziehen verschiebt die gesamte zweispaltige Strecke horizontal. „Keine Gleise“ (`none`) entfernt auch die Korridorreservierung; der bestehende Void-Korridor bleibt ein eigener Modus. Zugereignisse verlangen weiterhin echte Gleise und blockieren andernfalls Speichern und Vorschau.
- **Encounter & XP:** Encounter anlegen, kopieren, umordnen und löschen. Jede konfigurierte Gegnergruppe besitzt einen eigenen Eintrag in Dokumentreihenfolge, auch bei gleicher Gegnerart. Art, Menge, Delay, Spawnfenster und Front beziehungsweise Spawn-Area direkt pro Gruppe bearbeiten. Spawn-Areas lassen sich über X/Y/Breite/Höhe oder auf der Karte ändern. Gruppen einzeln hinzufügen, duplizieren oder löschen; Undo stellt ihre Daten wieder her. Referenzierte Encounter/Wände können nicht unbemerkt entfernt werden.
- **Aktive Spawnfronten:** Eine eigene Kartenebene markiert die gemäß Map-Definition verwendeten Fronten mit Randlinien, Richtungszeichen und Beschriftung. Auswahl zeigt die zugehörigen Encountergruppen, permanenten Map-Quellen und Bosse. „Front auf Karte zeigen“ springt von einer Gruppe zur Markierung. Spawn-Areas aktivieren keine zusätzliche Front, außer bei Gegnertypen, deren Spielregel ausdrücklich Randspawns vorsieht; auf unwirksame Spawn-Areas weist der Editor hin. Die Markierungen zeigen die Richtungen der gesamten Definition, keine zeitabhängige Simulation oder garantierten freien Spawnzellen.
- **Permanente Spawns:** Violette, mit ∞ gekennzeichnete Einträge im Encounter-Bereich. Gegnerart, Menge pro Spawn, Intervall, Startzeit und Front beziehungsweise vorhandene Spawn-Basis bearbeiten; Quellen hinzufügen, kopieren oder löschen. Der Kartensprung zeigt die gewählte Front oder Basis. Basisquellen benötigen eine Basis mit Spawnzentrum und Rolle `spawn-point`; beim Quellenwechsel werden unvereinbare Front-/Basisangaben entfernt.
- **XP und Rundenzeit:** Referenz ist ein Spieler. „Geplante Rundenzeit (s)“ bearbeitet `balanceReferenceDurationSec`; dieser Wert dient der XP-/Drop-Planung, verändert aber keinen Missionsende-Timer. Permanente Quellen werden vom ersten Spawn ab Startzeit bis vor das Planende hochgerechnet, mit derselben Regel wie die Spielreferenz. Durchgehend aktive Quellen und das Besiegen ihrer Gegner werden vorausgesetzt; zerstörte Spawn-Basen können den tatsächlichen Ertrag reduzieren. Feste Encounter-XP, Folgegegner, Boss und bedingte Nebenzielbelohnungen bleiben nachvollziehbar getrennt. Dynamische Beschwörungen sind nicht in der Summe enthalten. Offene Eingaben und unvollständige Berechnungen sind gekennzeichnet.
- **Vorschau:** Seed einstellen und bewusst aktualisieren. Der echte Arena-Generator läuft im abbrechbaren Worker. Geometrieänderungen markieren das vorige Layout als veraltet. „5 Varianten prüfen“ erzeugt fünf reproduzierbare Ausgangsseeds; der Bericht nennt Ergebnis-Seed, Dauer und Fingerprint. Das zuletzt erfolgreiche Ergebnis wird angezeigt. Unterschiedliche Anfragen können durch Generator-Retries dasselbe Layout erreichen.
- **Speichern:** Änderungen werden in die vorhandene Projektdatei geschrieben. Enter oder Fokuswechsel bestätigt Zahlen; Escape verwirft die offene Eingabe. Strg+S speichert, Strg+Z macht Dokumentänderungen rückgängig, Strg+Umschalt+Z wiederholt sie. Innerhalb eines Zahlenfelds bleibt die normale Textbearbeitung erhalten.

Unbekannte Felder, fehlende optionale Werte und `waterAreas` bleiben im Rohdokument erhalten. Ohne Änderung wird nicht geschrieben. Der Writer erhält unveränderte JSON-Teilbäume und ersetzt die Datei über eine temporäre Geschwisterdatei. Externe Änderungen ergeben einen Konflikt statt eines stillen Überschreibens. „Entwurf sichern“ exportiert Rohentwurf, Basisrevision, Originaltext und offene Eingaben als Rettungsdatei; danach kann bewusst neu geladen werden. Ein Import von Rettungsdateien gehört nicht zu V1.

## Grenzen

Schematische Draufsicht statt Spielgrafik; kein integrierter Spieltest, kein Map-Neuanlegen, Missionsartwechsel, Belohnungs- oder allgemeiner Ereigniseditor. Nicht freigegebene Vorgaben werden bewahrt. Warnungen über Tutorial-/Basis-Freiraum blockieren nicht; fehlerhafte Referenzen oder ungültige Geometrie blockieren Speichern und neue Generierung. Fünf Varianten ersetzen keinen regulären Spieltest.

## Technische Verträge

- `src/config/coopDefenseMapSources.json` bindet auswählbare IDs an feste Dateien. Die API nimmt keine freien Pfade entgegen und prüft Loopback-Origin, Sitzungstoken, Rohdaten und Revision erneut.
- `MapDocumentSession` besitzt Entwurf, Baseline, stabile Auswahl und Undo/Redo. Bestätigte Save-Snapshots überschreiben keine währenddessen entstandenen Änderungen.
- `coopDefenseMapAuthoring.ts` enthält die gemeinsamen, registryfreien Regeln; normalisierte Kopien sind ausschließlich abgeleitet. `coopDefenseEnemyLifecycle.ts` liefert die gemeinsamen festen XP einschließlich endlicher Folgegegner.
- Vorschauen verwenden explizite `WorldMetrics` und unveränderte Generatorregeln. Tutorial-Unterbau und Basisplatzierung werden mit der Runtime geteilt. Der bestehende Airstrike-Planner erhält jetzt ebenfalls den Tutorial-Anker.

## Erstabnahme am 21. September 2026

Spiel- und Editor-Build sowie 54 Architecture-Tests bestanden. 65 gezielte Tests für Dokumente, Speichern, Vorschau, Lifecycle-XP, Tutorial-Airstrikes, World/Activity-Authoring, Balance und Multi-Seed-Generierung bestanden.

Browserprüfung auf Port 8090 mit Maps 1, 2, 5, 9 und 17: beide Ansichten, Mehrfachgruppen, Boss-/Survival-XP, Carry-Drag, Wasserrechteck, Undo/Redo, Seedwechsel, fünf Varianten, Map-Wechsel während Generierung, Speichern und konkurrierende Sitzungen. Die gespeicherte Teständerung wurde zurückgenommen; der SHA-256 der Map-Datei entspricht wieder dem Ausgangszustand.

Das vollständige Projektgate ist wegen bereits im unveränderten Git-Stand reproduzierter Fehler nicht grün:

- Core: ein Tutorial-/Basis-Freiraum-Konflikt auf Map 6 (`CoopDefenseTutorialArena`).
- Integration: sieben veraltete Rundenende-Fixtures ohne `syncRoomOwners` sowie drei Lobby-Fixtures ohne aktive Netzwerkverbindung.
- Breite Stress-Suite: ein bestehender Spawnanzahlfehler in `NavigationSpawns` auf Map 7. Die betroffene Generator-Suite ist grün.

Die zunächst parallel mit Builds ausgeführte breite Balance-Suite hatte zwei Zeitüberschreitungen. Der gezielte Coop-Balance-Lauf einschließlich der neuen Regression ist ohne Timeout grün. Diese Bestandsprobleme wurden nicht durch Änderungen an Kampagnenwerten oder Testerwartungen verdeckt.

## Prüfung der Power-Up-, Gleis- und Encounter-Erweiterung

Spiel- und Editor-Build, 54 Architekturtests und die 23 Editor-Dokument-, Vorschau- und Speichertests sind grün. Browserprüfung auf Maps 1, 5 und 11: Gegnerart hinzufügen, Mehrfachgruppen löschen und gemeinsam rückgängig machen; Power-Up hinzufügen/löschen, Art wechseln, automatische Position per Drag fixieren; Gleise ausschalten, feste Spalte ändern und ziehen; ungültige Basis-Power-Up-Positionen und Gleise ohne erforderliche Zugunterstützung blockieren das Speichern. Die Browser-Testentwürfe wurden verworfen, keine Kampagnenmap wurde dafür gespeichert.

Das Gesamtgate meldet im aktuellen Arbeitsstand einen Tutorial-Freiraumfehler auf Map 8 (3.975 Core-Tests bestanden). Die breite Stresssuite meldet drei Fehler: zwei Generatorfälle zu Gleis-/Basisfreiraum und Wassergrenzen sowie den Spawnanzahlfall auf Map 7. Diese Befunde betreffen Maps mit unveränderten Gleismodi; die neuen `none`- und Positionsregressionen bestehen. Testprotokolle liegen lokal unter `build/map-editor-verification/content-*.log`.

## Prüfung der einzelnen Gegnergruppen und Spawnfronten

`npm run check` besteht mit 3.980 Core-Tests, 54 Architekturtests sowie Spiel- und Editor-Build. 26 gezielte Editor-Tests prüfen unter anderem voneinander unabhängige Gruppenänderungen, Front-/Area-Wechsel, Quellenzuordnung, Randspawn-Sonderregeln und Undo. Das aktuelle Protokoll liegt unter `build/map-editor-verification/groups-fronts-check.log`.

Browserprüfung auf Maps 1 und 11: zwei Gruppen derselben Art separat bearbeiten, Delay und Spawn-Area nur der zweiten Gruppe ändern, auf eine Front wechseln und zur Markierung springen, Änderungen rückgängig machen, Gruppen einzeln hinzufügen/duplizieren/löschen sowie Fronten ein-/ausblenden und ihre Quellen anzeigen. Die Konsole bleibt fehlerfrei; die Testentwürfe wurden ohne Speichern zurückgenommen.
