# Performance: zweite Optimierungsrunde und Hebel mit Optik-/Gameplay-Änderung

Stand: 18. Oktober 2026, Branch `perf-pass` (aufbauend auf
[Runde 1](performance-2026-10-17-optimization.md)).

**Ergebnis:** Diese Runde spart gegenüber Runde 1 bis zu 11 % CPU-Zeit pro Frame: bei Horden und im Kampf 5 bis 11 %, in ruhigen Szenen 0 bis 6 %. Gegenüber dem Ausgangsstand `b7737252` braucht der Branch jetzt in ruhigen Szenen 28 bis 35 % weniger, im Kampf 32 bis 37 % und bei 100 bis 500 Gegnern 38 bis 52 % weniger (alle drei Stände in einer Messreihe). Die zweite Hälfte des Berichts listet die Hebel, die nur mit sichtbaren oder spielerischen Änderungen weiter tragen.

## Änderungen ohne sichtbaren Verlust

| Bereich | Änderung | Sichtbar/spielbar |
|---|---|---|
| Blutflecken | Eigene Bodentiefe 9,84 unter Figuren, Figurenschatten und Klauen-Telegraphen statt Gegnertiefe 9,95. In WebGL sind Flecken reine Daten in einer Batch-Ebene: kein Phaser-Image, keine Display-Listen-Suche, kein Hinzufügen und Entfernen je Fleck. Die Layer-Abweichungen D01 und D04 sind damit behoben | ja, besser: Blut liegt nicht mehr über Gegnerkörpern |
| Baumstamm-Schatten | Alle Stämme teilen Sonnenrichtung und Profil. Ein gebackener Stempel je Form ersetzt rund 5.000 pro Frame neu zerlegte Pfadbefehle; ein Quad je Baum, gleiche MULTIPLY-Mischung. Canvas und überlange Abendschatten behalten die Polygone | nein |
| Turm-Platzierung | Reichweitenvorschau als drei gebackene Texturen (Fläche, atmender weicher Rand, Kontur mit Ticks) statt fünf Ellipsen à 160 Segmenten und 48 Strichen je Frame | nein, Kanten glatter |
| Matrix-Verwundbarkeit | Ohne aktives Feld mit Verwundbarkeitsbonus entfällt das Bounds-Rechnen je Gegner und Frame | nein |
| Reparaturdrohne | Upgrade-Prüfung liest die Stufe direkt statt das ganze Profil je Spieler und Frame zu bereinigen und zu klonen | nein |
| Loadout-Abgleich | Unveränderte, vom Bridge-Cache gelieferte Snapshots werden nicht mehr je Frame serialisiert | nein |
| Angriffspositionen | Reservierungen in einem Raster je Ziel; ein Kandidat prüft nur Reservierungen in Reichweite. Gleiche Wahl | nein |
| Horden-Steuerung | Die Teilung auf jeden zweiten Frame gilt auch für blockierte Einheiten, solange sie nicht im Rückzugsmodus sind (gleiche Schwelle wie die Kontinuitätsregel des Lösers) | nein |

## Messung

Performance-Lab-Suite `review` mit drei Builds in einer Reihe: Ausgangsstand `b7737252` („current“), Runde 1
und Runde 2, je drei Wiederholungen in hoher und niedriger Qualität, Reihenfolge je Wiederholung gewechselt.
Median der Lauf-Mediane der CPU-Zeit pro Frame in ms; Frame p95 als Median der Lauf-p95. 18 von 18 Läufen
vollständig, keine Browserfehler oder Konsolenwarnungen.

### Hohe Qualität

| Fall | current | Runde 1 | Runde 2 | Runde 2 vs. current | Runde 2 vs. Runde 1 | Frame p95 current → Runde 2 | Streuung Runde 2 |
|---|---:|---:|---:|---:|---:|---:|---:|
| lobby | 3,5 | 3,1 | 3,0 | −14 % | −3 % | 8,2 → 8,2 | 3,0–3,1 |
| review.enemies-100 | 14,0 | 8,9 | 8,2 | −41 % | −8 % | 22,2 → 15,3 | 8,1–8,6 |
| review.enemies-300 | 41,1 | 23,0 | 21,2 | −48 % | −8 % | 53,5 → 30,7 | 20,7–21,4 |
| review.enemies-500 | 74,7 | 39,0 | 36,1 | −52 % | −7 % | 99,9 → 46,4 | 35,8–37,2 |
| review.player | 5,1 | 3,6 | 3,4 | −33 % | −6 % | 8,2 → 8,2 | 3,4–3,4 |
| review.fog-rock | 5,2 | 3,7 | 3,6 | −31 % | −3 % | 8,3 → 8,2 | 3,6–3,6 |
| review.camera | 6,7 | 5,0 | 4,7 | −30 % | −6 % | 14,7 → 8,3 | 4,7–4,8 |
| review.explosions | 5,7 | 3,8 | 3,7 | −35 % | −3 % | 8,2 → 8,2 | 3,7–3,7 |
| review.train | 5,1 | 3,7 | 3,5 | −31 % | −5 % | 8,2 → 8,2 | 3,5–3,6 |
| ultimate.armageddon | 11,1 | 7,8 | 7,2 | −35 % | −8 % | 15,9 → 8,5 | 7,2–7,2 |
| combat.day | 18,2 | 12,1 | 11,4 | −37 % | −6 % | 24,1 → 16,1 | 11,2–11,8 |

### Niedrige Qualität

| Fall | current | Runde 1 | Runde 2 | Runde 2 vs. current | Runde 2 vs. Runde 1 | Frame p95 current → Runde 2 | Streuung Runde 2 |
|---|---:|---:|---:|---:|---:|---:|---:|
| lobby | 2,9 | 2,7 | 2,7 | −7 % | +0 % | 8,2 → 8,2 | 2,6–2,7 |
| review.enemies-100 | 11,1 | 7,3 | 6,9 | −38 % | −5 % | 16,0 → 8,5 | 6,8–7,1 |
| review.enemies-300 | 25,5 | 16,8 | 15,6 | −39 % | −7 % | 45,9 → 23,6 | 15,4–16,1 |
| review.enemies-500 | 66,1 | 35,7 | 31,9 | −52 % | −11 % | 85,4 → 45,0 | 31,1–32,2 |
| review.player | 4,1 | 3,0 | 2,9 | −29 % | −3 % | 8,2 → 8,2 | 2,8–2,9 |
| review.fog-rock | 4,6 | 3,2 | 3,2 | −30 % | −0 % | 8,2 → 8,2 | 3,2–3,2 |
| review.camera | 6,1 | 4,4 | 4,3 | −30 % | −2 % | 8,3 → 8,3 | 4,3–4,5 |
| review.explosions | 4,6 | 3,2 | 3,0 | −35 % | −6 % | 8,2 → 8,2 | 3,0–3,1 |
| review.train | 4,0 | 2,9 | 2,9 | −28 % | −0 % | 8,2 → 8,2 | 2,8–2,9 |
| ultimate.armageddon | 8,3 | 6,3 | 6,1 | −27 % | −3 % | 15,4 → 8,3 | 5,9–6,1 |
| combat.day | 14,1 | 10,1 | 9,6 | −32 % | −5 % | 23,2 → 15,8 | 9,6–9,7 |

Die Absolutwerte weichen von der Messung am 17. Oktober ab: Die Bildwiederholung lief diesmal mit 8,2 ms statt
6,2 ms je Frame, und der Ausgangsstand war in derselben Reihe deutlich langsamer als am Vortag. Vergleiche sind
deshalb nur innerhalb einer Messreihe gültig. Der JS-Heap bleibt praktisch gleich (Median hoch: 1.038 / 999 /
991 MiB).

## Wo die verbleibende CPU-Zeit liegt

CPU-Profile mit Aufrufbäumen (Sampling 250 µs) der optimierten Fassung vor dieser Runde: ruhige Spielfigur,
Tagkampf, 300 Gegner. Angegeben ist die inklusive CPU-Zeit je Sekunde Messung und ihr Anteil an der belegten
Hauptthread-Zeit. Zeilen können sich überschneiden; die GPU-VFX-Zeile enthält die Übergabe aller GPU-Ebenen.

| System | ruhige Spielfigur | Tagkampf | 300 Gegner |
|---|---:|---:|---:|
| Bodennebel (Simulation + Darstellung) | 27 (6 %) | 39 (4 %) | 41 (4 %) |
| Sonnenlicht/Vegetationslicht | 73 (16 %) | 55 (6 %) | 28 (3 %) |
| Lightmap (dynamisches Licht) | 3 (1 %) | 8 (1 %) | 9 (1 %) |
| Figuren-Schatten | 4 (1 %) | 34 (3 %) | 42 (4 %) |
| GPU-VFX (Partikel, Spuren, Gore) | 23 (5 %) | 107 (11 %) | 81 (8 %) |
| Blutflecken | 0 (0 %) | 26 (3 %) | 22 (2 %) |
| Wildtiere | 22 (5 %) | 25 (3 %) | 12 (1 %) |
| Arcade-Physik (120 Hz) | 0 (0 %) | 25 (3 %) | 56 (6 %) |
| Gegner-KI und Bewegung | 8 (2 %) | 73 (7 %) | 190 (19 %) |
| Projektil-Simulation | 1 (0 %) | 56 (6 %) | 94 (10 %) |
| Netz-Snapshots (Solo unnötig) | 0 (0 %) | 8 (1 %) | 18 (2 %) |
| Effekt-Loopback (lokale Effekte) | 0 (0 %) | 12 (1 %) | 18 (2 %) |
| Augen-Glühen/Lesbarkeit | 0 (0 %) | 14 (1 %) | 22 (2 %) |
| Phaser-Render gesamt | 277 (60 %) | 397 (40 %) | 234 (24 %) |
| Container (HUD, Ringe) | 28 (6 %) | 43 (4 %) | 20 (2 %) |
| Display-Liste: Filter/Sortierung | 11 (2 %) | 28 (3 %) | 18 (2 %) |
| CPU belegt gesamt | 460 | 985 | 988 |

## Hebel mit Optik- oder Gameplay-Änderung

Die folgenden Themen verändern Aussehen oder Spielverhalten und sind deshalb nicht umgesetzt. Der genannte
Anteil ist die gemessene Obergrenze des jeweiligen Systems; die Schätzung nennt, was eine sinnvolle Umsetzung
realistisch einsparen könnte.

| Thema | Änderung | Gemessener Anteil | Geschätzter Gewinn | Kosten an Optik oder Gameplay |
|---|---|---:|---:|---|
| Vegetationslicht vorbacken | Sonnen- und Vegetationslicht wird je Boden-, Fels- und Kronen-Chunk mit eigenem Material in jedem Frame gezeichnet. Beim Chunk-Bake einbacken und nur bei merklicher Sonnenstandsänderung neu backen; Wolkenschatten bleiben im Composite dynamisch | ruhig 16 %, Kampf 6 % | ruhig 8–12 %, Kampf 3–5 % | Pflanzenlicht folgt der Sonne in kleinen Stufen statt stufenlos |
| Gegner-KI nach Entfernung staffeln oder deckeln | Gegner außerhalb des Bildes nur per Flowfield ohne Gedränge-Steuerung, seltener Zielsuche; alternativ Obergrenze gleichzeitig aktiver Gegner mit Nachschub-Warteschlange | Kampf 7 %, 300 Gegner 19 % | Horde 8–15 %, Kampf 2–4 % | gröbere Bewegung außerhalb des Bildes oder weniger dichte Massen |
| Weniger, stärkere Gegnergeschosse | Gegnerwaffen mit halber Feuerrate und doppeltem Schaden oder Hitscan für langsame Waffen. Wirkt zugleich auf Kollision, Flugspuren, Mündungsfeuer, Sound und Netz | Projektile Kampf 6 %, Horde 10 %, plus Anteil an GPU-VFX | Kampf 5–8 %, Horde 8–12 % | andere Ausweichdynamik, Balance muss nachgezogen werden |
| Effektdichte nach Last | Gore-Fragmente, Brennpartikel und Flugspuren in Massen dynamisch halbieren | GPU-VFX Kampf 11 %, Horde 8 % | Kampf 3–5 % | Treffer wirken in großen Gefechten weniger dicht |
| Physik mit 60 statt 120 Hz | Halbe Schrittzahl, dazu Interpolation der Darstellung für 120/165-Hz-Monitore | Kampf 3 %, Horde 6 % | 1,5–3 % | minimal gröbere Kollisionen, Interpolation neu zu bauen |
| Bodennebel träger | Nebel-Simulation mit halber Rate oder Auflösung; schwächere Reaktion auf Gegnerbewegung | 4–6 % | 2–3 % | Nebel reagiert langsamer auf Bewegung |
| Wildtiere nur im Bild | Tiere außerhalb des Bildes pausieren oder Tierzahl halbieren (heute rund 250) | ruhig 5 %, Kampf 3 % | ruhig 2–3 % | weniger Leben am Bildrand |
| Einfache Schatten für Horden | Ab einer Gegnerzahl Ellipsen- statt Mesh-Schatten | Kampf 3 %, Horde 4 % | Horde 2–3 % | flachere Schattenform in Massen |
| HUD-Balken per Shader-Maske | Lebendige Balken nutzen je 51 Streifen für runde Ecken; eine Maske im Shader und gebackene statische Rahmen ersetzen sie | Container ruhig 6 %, Kampf 4 % | ruhig 2–4 % | keine, wenn sauber umgesetzt; mittlerer Aufwand |
| Solo ohne Netz-Snapshots | Im Einzelspiel keine Snapshot-Kodierung und kein Effekt-Loopback über die Netzschicht | Horde 3–4 % | Horde 2–4 % | keine sichtbaren, aber ein zweiter Solo-Pfad in der Netzgrenze |
| Stufe „Leistung“ unter „Niedrig“ | Bündelt vorgebackenes Licht, Effektdichte, trägen Nebel, Wildtiere im Bild, einfache Schatten und eine gröbere Lightmap | „Niedrig“ spart heute 15–17 % gegenüber „Hoch“ | zusammen mit „Niedrig“ 25–35 % | sichtbar einfachere Welt; nur für schwache Rechner gedacht |

Das größte verbleibende Einzelstück ist Phasers allgemeiner Render-Overhead (ruhig rund 60 %, Kampf 40 % der
CPU-Zeit): rund 230 Draw-Calls je Frame in hoher Qualität, jeder mit Batch-Wechsel und Uniform-Setup. Hier
helfen vor allem weniger getrennte Materialpässe, also vor allem das vorgebackene Vegetationslicht.

## Prüfung

- `npm run check`: 6.972 Core-Tests in 671 Dateien, 63 Architecture-Tests, drei Builds.
- `npm run test:integration` (995), `npm run test:stress` (165), `npm run test:assets` (238), `git diff --check`.
- Layer-Vertrag: D01 und D04 als behoben aus der Ausnahmeliste entfernt; der Test prüft die Blutflecken jetzt
  unter Figurenhöhe. Neue Renderbesitzer (Reichweitenvorschau, Stamm-Stempel) im Katalog bzw. in der Attribution.
- Sichtvergleich im Performance-Lab: ruhige Szene mit Stamm-Stempeln pixelnah gleich (mittlere Abweichung 0,09–0,12
  von 255, verbleibende Punkte sind Statusring-Animation und Wasserglanz); Kampfszene mit Blut unter den Figuren.

Rohdaten, Profile und Skripte liegen lokal unter `build/perf-compare-20261017/`.
