# Bodennebel V1 – Prüfbericht

Erstabnahme: 21. September 2026, Arbeitsstand auf Basis von `3356afb4`.
Bedienung und Architektur: [Bodennebel-Lab](ground-fog-lab.md).
Einzelne Messläufe: [Benchmarkdaten](ground-fog-benchmark.json).

## Nachabstimmung am 22. September 2026

Ausgangspunkt dieser Änderung ist `ec0dcbaf` (Fog 0.1). Lauf, Dash und Projektilreaktionen
wurden verstärkt; Hitscan und Nahkampf sind angebunden. Druckausgleich auf der GPU
verbreitert Ansammlungen vor Felsen und verstärkt die seitliche Strömung an Ecken.

Der gemeldete P90-/Glock-Fehler hatte zwei Ursachen: einzelne Löcher im groben Feld und
eine zu grobe Tile-Zuordnung der vielen kurzen Diagonalsegmente. Kleine Projektile nutzen
jetzt durchgehende, pro Projektil zusammengefasste GPU-Spuren mit stetigem Alter. Nur wirklich
berührte Tiles werden belegt. Die sichtbare Nachwirkung läuft über 3,2 Sekunden aus;
Richtungswechsel und echte Unterbrechungen werden weiterhin berücksichtigt.

**GPU-Prüfung: 21 Verträge bestanden.** Ergänzt wurden gerichteter Nahkampf, Nachwirkung
kleiner Spuren nach einer Sekunde, lückenlose Diagonalen, Zusammenfassung gerader Wege,
breiterer Stau und abgelenkte Eckströmung. Die Druckreaktion ersetzt die frühere Annahme
überall unveränderter Windgeschwindigkeit; begrenzte, endliche Geschwindigkeit bleibt geprüft.
Die kontrollierte Diagonale bestand aus 40 Eingangssegmenten und belegte einen gespeicherten
Abschnitt. Alle 19 Auslesepunkte waren belegt, mit stetiger Abschwächung entlang der Spur.
In der Hindernis-Fixture lag die zusätzliche Dichte noch 76 Pixel vor dem Fels bei etwa 0,032.

Im sichtbaren Lab wurde P90-Dauerfeuer als schwenkender Fächer geprüft: durchgehende
Linien, ungefähr 52–56 gespeicherte Abschnitte, keine verworfenen Eingaben und keine
lokalen Überläufe. Die Zählung bleibt während laufenden Feuers und anschließenden Auslaufens
begrenzt. Glock und Hitscan wurden zusätzlich auf Mittel als durchgehende Fächer ohne
lokale Überläufe angesehen. Lauf, Dash, Plasma und der gerichtete Nahkampf wurden mit
dem Produktionsrenderer geprüft. Einzelschuss sowie getrennte Lauf-/Dash-Auswahl sind
im Lab reproduzierbar. Der Nahkampfkegel ist zusätzlich durch den GPU-Vergleich seiner
Vorder- und Rückseite abgesichert.

Die nachfolgenden neun Leistungsläufe dokumentieren **den Stand vor dieser Nachabstimmung**.
Sie wurden für die neue Druckberechnung und Spurzusammenfassung nicht erneut als vollständige
Messreihe durchgeführt und sind keine aktuellen Kostenangaben dieser Änderungen.

Aktuelle automatisierte Prüfung: 60 gezielte Tests bestanden; im vollständigen Core-Lauf
4.038 bestanden und dieselben drei vorhandenen Map-Fehler. Der vollständige Integrationslauf
enthält weiterhin die zehn bereits dokumentierten Fehler. Die gezielt betroffenen
HeldWeaponFire- und WorldPresentationFrameLifetime-Suiten sowie die Architekturprüfung
bestehen. Die erste parallele Ausführung hatte zwei zusätzliche Timeouts; beide betroffenen
Dateien und der anschließende Core-Lauf bestanden ohne diese Timeouts. Produktionsbuild,
Lab-Build und `git diff --check` bestanden; alle 21 GPU-Verträge wurden mit dem finalen
Shader erneut erfolgreich ausgeführt.

## Optische Abstimmung

Die Prüfung erfolgte im **sichtbaren** eingebetteten Browser mit dem Produktionsnebel,
Spielassets, Terrainoberflächen, Wasser und Lightmap. Port 8090 war durch den Map-Editor
belegt; der eigene Server lief über `npm run dev:browser -- --port 8092` nach HTTP 200.
Es wurden keine fremden Prozesse beendet.

Die Nutzerrückmeldung zur Intensität ist in den Standard eingeflossen: Deckkraft **0,50**,
Dichtefaktor **1,85**, Map-Stärke **1**. Die zentrale Alpha-Grenze bleibt **0,30**.
Dieser Stand wurde erneut mit den folgenden Szenarien geprüft.

| Szenario | Beobachtung / Nachweis |
| --- | --- |
| Wasser, Rasen, Dirt | Morgens sichtbare bewegte Schwaden, Terrainstruktur bleibt erkennbar. Kein geschlossener heller Ufersaum. Mittags sehr schwacher Restnebel. |
| Nacht | Nebel wird gemeinsam mit dem Gelände abgedunkelt. Die unbeleuchtete Szene ist erwartungsgemäß sehr dunkel. Das Lesbarkeitsszenario ergänzt deshalb ein Produktionslicht (`baseGlow`), unter dem Warnkreis, Pickup, Essenz und Smoke unterscheidbar bleiben. |
| Felsdurchbruch und Barriere | Neue Öffnungen starten ohne lokale Quelle. Kontrollierte GPU-Auslesungen bestätigen Nullfluss durch geschlossene Wände und Zufluss am offenen Rand. Die Durchgangsvariante besitzt eine einzelne offene Zellreihe. |
| Nuke-Fläche | Die Debugansicht zeigt unmittelbar nach Zerstörung eine große unerreichte Innenfläche; im Spielbild bleibt diese zunächst frei. Nebel entsteht dort durch randseitigen Zufluss. |
| Basis | Nach logischer Entfernung bleibt die sichtbare Basis ausgespart. In Pause und Einzelschritten stimmt das erste entfernte Oberflächenfeld mit dem Loch in der Darstellungsmaske überein. |
| Bewegung | Wiederholbarer Lauf mit Dash, Stillstand und großer Figur; zusätzlich Teleport, langer Frame und Kamerawackeln ausgeführt. Keine durchgehende Teleport-Radiergasse beobachtet. Quellunterbrechungen sind zusätzlich durch Tests abgesichert. |
| Projektile | P90, Schrot, Rakete, Plasma, Feuerball, Abpraller und 12-ms-Lebensdauer ausgeführt. Die kleinen Spuren bleiben bewusst schmal und bei verkleinertem Lab-Bild dezent. Abschlusssegment und Abprallsegmente sind zusätzlich im Produktionspfad getestet. |
| Feine Spurmaske | Das gemeinsame 8-Pixel-Feld verlor schmale P90-Spuren. Deshalb ergänzen Hoch/Mittel analytisch alternde GPU-Segmentstempel. GPU-Auslesungen bestätigen eine schmale Spur, keine breite freigeräumte Bahn und ihr zeitliches Verschwinden. |
| Qualität / Sättigung | Hoch, Mittel und Niedrig im sichtbaren Lab geprüft. Niedrig reduziert die Zwischenpässe und deaktiviert Gegner-/Projektilreaktionen. Im zusätzlichen Schrotlauf auf Mittel wurden drei nachrangige Impulse verworfen; der Puffer blieb begrenzt. |
| Kamera / Lebensdauer | Mehrere Kamerarundläufe und World-Neuaufbauten ausgeführt. Extremzoom meldet `view capacity exceeded`, deaktiviert den sichtbaren Effekt und hält auch dann höchstens 64 Cache-Chunks. Pause hält den Zustand; Einzelschritte setzen ihn fort. |

Es wurden bewegte Zustände wiederholt abgetastet und feste Ansichten nach Parameteränderungen
verglichen. Die Browserprüfung ist keine aufgezeichnete Videoabnahme und kein Multiplayer-Spieltest.
Host-/Client-Präsentation, Late-Join-Eingänge und Handoff werden durch die unten genannten
Tests und reproduzierbare Lab-Eingaben abgesichert.

## GPU-Verträge

Alle **15** Prüfungen bestanden mit kontrollierten Auslesungen außerhalb der Leistungsmessung:

- Grunddichte vorhanden, Sperrzellen leer, kein Transport durch geschlossene Wände.
- Neue Öffnung ohne lokale Quelle, Zufluss am Rand, Fortschreiten nach innen.
- Wiederbelegung leert den Zustand; Auslesen verändert ihn nicht.
- Geschwindigkeitskodierung erhält den Wind; gleichmäßiger Fluss bleibt stabil und erzeugt kein Schachbrettmuster.
- Änderungen in eingefrorenen Cache-Chunks erhalten unveränderte Zellen und werden vor Wiederaufnahme angewendet.
- Feine Projektilspur bleibt schmal und läuft auf der GPU aus.

Beispielwerte der Fixture: geschlossene Wand **0**, neue Öffnungsmitte **0**,
früher Randzufluss **0,0647**, später eingeströmte Dichte **0,2475**, wieder gesperrte Zelle **0**.

## Relative Leistung

1920 × 1080, Hoch, Seed 183, 06:00, Stärke 1, Deckkraft 0,50, identische Kamera und
Last aus zwei Figuren, P90-Dauerfeuer und periodischen Explosionen. Je Variante drei
Läufe mit **10 s Aufwärmen + 30 s Messung**. Währenddessen liefen keine Builds oder Tests.
Alle neun Läufe erfüllten die Lab-Kadenzprüfung. Gemessen wurde der unveränderliche Build
`fog-lab-CaIL1d41.js`; danach korrigierte Cache-Sonderfälle und Lab-Beschriftungen betreffen
nicht den stationären Messablauf.

Die Bereiche zeigen Minimum bis Maximum der drei jeweiligen Lauf-Percentile, in Millisekunden.

| Variante | CPU Median / p95 / p99 | GPU Median / p95 / p99 | Frame Median / p95 / p99 |
| --- | --- | --- | --- |
| Aus | 0 / 0 / 0,1 | Keine Nebelpässe, keine Abfragen | 18,2 / 31,2–31,3 / 31,6–31,9 |
| Grundnebel | 0,3 / 0,5 / 0,6–0,7 | 0,184–0,205 / 2,778–2,969 / 3,872–4,132 | 16,5–16,6 / 17,2–17,3 / 17,6–17,8 |
| Alle Reaktionen | 0,3–0,4 / 0,5–0,6 / 0,6–0,7 | 0,241–0,261 / 2,845–3,040 / 3,655–4,022 | 16,5 / 17,2–17,3 / 17,6–17,8 |

Grundnebel und volle Reaktionen verwendeten jeweils **20 aktive Chunks, 0 Cache-Chunks**
und **23.388.416 Texturbytes (22,3 MiB)**. Aus verwendete keine Nebeltexturen.
In allen neun Messläufen wurden **0 Impulse verworfen**.

**Einordnung:** Der eingebettete Browser drosselte RAF, weshalb das Lab einen festen
60-Hz-Timer verwendet. Die Variante ohne Nebel zeigte einen anderen Timer-Takt
(etwa 49 statt 60 Frames/s). Daraus lässt sich **kein FPS-Gewinn durch Nebel** ableiten.
Für Mehrkosten sind die getrennte CPU-Submission und asynchronen GPU-Abfragen aussagekräftiger.
Die GPU-Mediane mischen reine Renderframes und Frames mit 30-Hz-Simulation; p95/p99 zeigen
die teureren Fortschreibungsschritte. Diese Messung ist keine Hardwaregarantie.
Die Timer-Erweiterung war verfügbar; ohne sie meldet das Lab „GPU-Zeit nicht verfügbar“.

## Automatisierte Prüfung

| Prüfung | Ergebnis |
| --- | --- |
| Gezielte Authoring-, Editor-, Settings-, Projektil-, Effekt- und World-Suite | **165 bestanden**, 11 Dateien |
| GroundFog nach letzter Cache-Korrektur | **7 bestanden** |
| Architektur | **54 bestanden**, 6 Dateien |
| MovementEffectsStress, ProjectileReplicationLoad, ArenaLoadingContracts | **4 bestanden**, 3 Dateien |
| Spiel-Build, Fog-Lab-Build, Map-Editor-Build | **Bestanden**, einschließlich TypeScript |
| `git diff --check` | **Bestanden** |
| `npm run check` | **4.032 bestanden, 3 vorhandene Fehler** im Core-Lauf |
| Vollständige Integrationssuite | **546 bestanden, 10 vorhandene Fehler** |

Die drei Core-Fehler betreffen `CoopDefenseMaps.test.ts` (Power-up-Startbelegung) und
`CoopDefenseRockFieldMap.test.ts` (Freiflächenanteil und Korridoranzahl).
Die zehn Integrationsfehler betreffen `ArenaExitLifecycle.test.ts` (veralteter Fake ohne
`syncRoomOwners`) und `LobbyWorldInteractive.test.ts` (fehlende NetworkBridge-Verbindung).

Alle **13 Fehler wurden unverändert auf dem sauberen Ausgangsstand `3356afb4` reproduziert**:
Die vier betroffenen Dateien lieferten dort ebenfalls 13 Fehler und 75 erfolgreiche Tests.
`npm run check` ist damit insgesamt nicht grün; die anschließend nötigen Architektur- und
Build-Prüfungen wurden separat erfolgreich ausgeführt. Lokale ausführliche Logs liegen
unter `build/fog-*.log` und sind nicht Teil der versionierten Dokumentation.
