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
- **Encounter & XP:** Encounter anlegen, kopieren, umordnen und löschen; Startbedingungen und Gruppen getrennt bearbeiten. `0` in einer einzelnen Gegner-Mengenzeile entfernt die Gruppe. Mehrfachgruppen werden aufgeklappt und behalten eigene Verzögerungen, Spawnfenster und Gebiete. Referenzierte Encounter/Wände können nicht unbemerkt entfernt werden.
- **XP:** Referenz ist ein Spieler. Encounter-XP, feste Folgegegner, Boss und bedingte Nebenzielbelohnungen sind getrennt. Beschwörer und permanente Quellen erhalten keine vermeintlich exakte Gesamthochrechnung. Offene Eingaben und unvollständige Berechnungen sind gekennzeichnet.
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

## Abnahme am 21. September 2026

Spiel- und Editor-Build sowie 54 Architecture-Tests bestanden. 65 gezielte Tests für Dokumente, Speichern, Vorschau, Lifecycle-XP, Tutorial-Airstrikes, World/Activity-Authoring, Balance und Multi-Seed-Generierung bestanden.

Browserprüfung auf Port 8090 mit Maps 1, 2, 5, 9 und 17: beide Ansichten, Mehrfachgruppen, Boss-/Survival-XP, Carry-Drag, Wasserrechteck, Undo/Redo, Seedwechsel, fünf Varianten, Map-Wechsel während Generierung, Speichern und konkurrierende Sitzungen. Die gespeicherte Teständerung wurde zurückgenommen; der SHA-256 der Map-Datei entspricht wieder dem Ausgangszustand.

Das vollständige Projektgate ist wegen bereits im unveränderten Git-Stand reproduzierter Fehler nicht grün:

- Core: ein Tutorial-/Basis-Freiraum-Konflikt auf Map 6 (`CoopDefenseTutorialArena`).
- Integration: sieben veraltete Rundenende-Fixtures ohne `syncRoomOwners` sowie drei Lobby-Fixtures ohne aktive Netzwerkverbindung.
- Breite Stress-Suite: ein bestehender Spawnanzahlfehler in `NavigationSpawns` auf Map 7. Die betroffene Generator-Suite ist grün.

Die zunächst parallel mit Builds ausgeführte breite Balance-Suite hatte zwei Zeitüberschreitungen. Der gezielte Coop-Balance-Lauf einschließlich der neuen Regression ist ohne Timeout grün. Diese Bestandsprobleme wurden nicht durch Änderungen an Kampagnenwerten oder Testerwartungen verdeckt.
