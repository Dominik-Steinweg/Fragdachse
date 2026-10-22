# Performance: Nachtlauf Map-16-Endphase, Map 20 und Horden

Stand: 22. Oktober 2026, Branch `perf-night-1022` (von `main` 458c1030), autonomer Nachtlauf.
Integriert per Fast-Forward nach `main` (nicht gepusht), Endstand f26be39b. Der Folgelauf (06:15–07:45)
ergänzte inkrementelle Bodenfeuer-Verbraucher auf Host und Client und zwei Allokationshebel
(siehe „Behaltene Hebel“, letzte vier Zeilen); die Tabellen unter „Messung“ zeigen den Stand ac8ecf88.

**Ergebnis:** In der Map-16-Endphase braucht ein Frame 16 % weniger CPU-Zeit (p95 −22 %, Ausreißer
p99 23 → 16 ms). Horden profitieren am stärksten: 300 Gegner −25 %, 500 Gegner −46 % (p95 −62 %).
Map 20 verliert vor allem die Spitzen beim Tintenspucken der Mini-Kraken (p95 je nach Phase −20 bis −35 %).
Ruhige Szenen werden 3 bis 7 % schneller. Alle Änderungen sind ohne gewollte Sicht- oder
Spieländerung; die einzige Zeitänderung ist das Bodenfeuer-Update des Hosts im Netztakt (siehe unten).

## Neues Szenario `campaign.map16-endgame`

Map 16 ab Checkpoint cp8: authored Void-Rückfeuer (Sweep 7 s), Kriechfeuer (36 s) und der
Encounter der Brandlichtung (2 Brandstifter, 1 Werfer, 5 Mini-Kraken, 5 Kabummtulas). Der Spieler
steht geheilt auf dem cp8-Marker und schießt alle 350 ms auf den nächsten Gegner; 40 s Messung.
Last laut Lauf: bis 4.737 Feuerzellen (2.265 sichtbar), 14 Gegner, ~110 Schüsse, 60 aktive Lichter.
Aufruf: `npm run perf:chrome -- --case campaign.map16-endgame` oder als Suite-Fall; beschrieben in
[Performance-Lab](../performance-lab.md). Screenshots aus der Messphase:
`build/perf-night-2026-10-22/screens/map16-after-8s.png` und `-20s.png` (Kampf, Gegner, Void-Feuer-Schleier).

### Hypothese „Feuerflächen + große Map + mehrere Gegner“

Teilweise bestätigt, aber anders als vermutet: Die Flammen selbst (GPU-Partikel, budgetiert und
kameragefiltert) kosten kaum etwas – Emission < 0,3 % CPU, GPU-Renderphase ~3,3 ms. Teuer war die
CPU-Kette um die große Fläche: Der Host baute den Bodenfeuer-Snapshot mit ~4.700 Zellen jeden Frame neu
und sortierte ihn, drei Verbraucher verglichen jeweils alle Zellen, und die Sonnenlicht-Präsentation
sammelte jeden Frame alle Void-Glühpunkte über sämtliche Felsökologie-Anker ein (zusammen > 10 % der
Frame-CPU). Die Gegnerzahl (14) spielt hier eine kleinere Rolle; bei Horden dominierte dagegen ein
linearer Hindernis-Scan (siehe Hebel 9/10).

## Messung

Performance-Lab-Suite mit gebauten Sites, hohe Qualität, je 3 gepaarte Läufe (A/B abwechselnd),
1920×1080, gleicher Seed. Median der Lauf-Mediane der CPU-Zeit pro Frame (ms); p95 als Median der Lauf-p95.
Ausgangsstand `1864a78a` (= main 458c1030 plus Szenario), Endstand `ac8ecf88` (ohne das zuletzt
ergänzte Warnband-Culling `e450b06a`). Rohdaten: `build/perf-night-2026-10-22/results/e2e-*`.

| Fall | CPU p50 vorher → nachher | Δ | CPU p95 vorher → nachher | Frame p99 vorher → nachher |
|---|---:|---:|---:|---:|
| campaign.map16-endgame | 11,7 → 9,8 | −16 % | 16,5 → 12,8 | 23,0 → 16,3 |
| lobby | 3,7 → 3,6 | −3 % | 5,5 → 5,3 | 8,5 → 8,5 |
| review.enemies-100 | 10,8 → 9,8 | −9 % | 14,8 → 13,7 | 22,0 → 16,5 |
| review.enemies-300 | 40,4 → 30,5 | −25 % | 52,6 → 38,8 | 60,9 → 45,8 |
| review.enemies-500 | 98,5 → 52,9 | −46 % | 178,7 → 67,3 | 196,2 → 75,0 |
| review.player | 5,2 → 4,9 | −6 % | 6,5 → 6,1 | 8,5 → 8,6 |
| review.fog-rock | 5,2 → 4,9 | −6 % | 6,5 → 6,0 | 8,5 → 8,6 |
| review.camera | 6,4 → 6,2 | −3 % | 9,6 → 9,1 | 15,5 → 15,3 |
| review.explosions | 5,6 → 5,4 | −4 % | 7,0 → 6,7 | 8,5 → 8,6 |
| review.train | 5,4 → 5,0 | −7 % | 7,0 → 6,5 | 8,6 → 8,5 |
| ultimate.armageddon | 9,8 → 9,2 | −6 % | 11,9 → 11,3 | 16,1 → 16,1 |
| combat.day (in der Suite) | 17,1 → 14,9 | −13 % | 25,0 → 20,7 | 30,9 → 24,0 |

Spreizung der Läufe: enemies-300 38,2–42,0 → 29,7–30,6; enemies-500 95,9–103,8 → 51,3–53,0;
combat.day 17,0–17,4 → 14,7–15,2. `combat.day` läuft in der Suite nach den Horden-Fällen in derselben
Seite und ist dort langsamer als einzeln (einzeln: 10,2 → 9,6 ms, −6 %, p95 −9 %).

Die Absolutwerte weichen von Runde 2 (18.10.) ab, vor allem bei Horden (dort 21 bzw. 36 ms für 300/500
Gegner); Vergleiche gelten nur innerhalb einer Messreihe.

### Map 20 (Abgrundteich, Kraken)

`npm run perf:kraken` gegen zwei Dev-Server (Ausgangsstand `1864a78a` auf :8091, Endstand auf :8090),
hohe Qualität, feste 60-Hz-Schritte, je Seite zwei vollständige Läufe mit dem korrigierten Skript
(`2177e9ba`, siehe unten); Werte sind Mittel der beiden Lauf-Mediane bzw. -p95/-p99 in ms. Ab ~55 Gegnern
schwanken die Wellen zwischen den Läufen; der Endstand hatte in den Landphasen sogar mehr Gegner.
Rohdaten: `build/perf-night-2026-10-22/kraken/full-base1`, `full-base2`, `fix-cur3`, `full-cur2`.

| Phase | Gegner vorher → nachher | CPU p50 | CPU p95 | CPU p99 |
|---|---|---:|---:|---:|
| intro | 10 → 10 | 7,6 → 7,9 | 12,7 → 12,7 | 23,8 → 24,0 |
| water | 10 → 10 | 7,8 → 7,7 | 10,3 → 9,9 | 13,4 → 12,1 |
| ink | 23 → 23 | 8,7 → 8,7 | 12,5 → 11,9 | 14,8 → 13,4 |
| spines | 30 → 30 | 10,7 → 10,3 | 15,3 → 12,9 | 17,4 → 14,1 |
| eggs-hatch | 43 → 43 | 11,7 → 10,9 | 18,8 → 14,5 | 21,7 → 18,8 |
| dive-tentacles | 55 → 55 | 10,8 → 10,2 | 19,3 → 12,8 | 21,6 → 14,1 |
| water-waves | 55 → 61/62 | 12,8 → 12,5 | 20,3 → 15,7 | 24,0 → 17,0 |
| ashore | 61/66 → 73 | 12,6 → 12,0 | 22,8 → 15,6 | 26,8 → 19,7 |
| land-claw | 61/66 → 73 | 11,1 → 11,9 | 15,5 → 14,3 | 23,1 → 16,7 |
| land-spines | 61/66 → 73 | 11,5 → 12,3 | 14,6 → 15,4 | 15,4 → 17,5 |
| land-trail-waves | 66/67 → 79 | 11,6 → 11,6 | 19,2 → 14,8 | 22,3 → 17,1 |
| death | 65/66 → 78 | 12,0 → 11,0 | 21,6 → 14,8 | 25,0 → 22,1 |

Der Median bleibt bei gleicher Gegnerzahl 0–7 % niedriger; die Spitzen (p95) fallen in allen Phasen mit
Tinte, Eiern, Tentakeln und Wellen um 20–35 %. `land-claw`/`land-spines` liegen bei 11–20 % mehr Gegnern
leicht höher im Median.

Hauptursache der Spitzen war das Neubacken der Tinten-Wassermasken (`krakenWaterMask`, 5,4 % der
Map-20-CPU im Profil vor dem Fix, danach 1,1 % für die legitimen Körper-/Tentakelmasken). Das
Profil enthält zusätzlich ~3 % Dev-Szenario-Panel (Messwerkzeug, kein Spielcode).

## Behaltene Hebel

| Commit | Bereich | Änderung | Messpaar (A → B) |
|---|---|---|---|
| 976cfbd9 | Void-Botanik | Glühpunkte und Emissionskolonien der Void-Felsen nur bei Ökologie-Neuaufbau oder wenn ein Ankerfels fällt/zurückkehrt neu sammeln (Revision) statt jeden Frame über alle Anker | map16 CPU p50 11,2 → 10,2 (−9 %), p95 15,4 → 14,4 |
| abf5a022 | Bodenfeuer | Host veröffentlicht eine wachsende Feuerfläche höchstens einmal je Netz-Tick (20 Hz); erste Änderung nach ruhigem Tick sofort; Schaden und direkte Abfragen bleiben live | map16 10,3 → 9,9 (−4 %) |
| 91ff1cbe | Bodenfeuer | Snapshot inkrementell: nur geänderte Zellen neu, keine Sortierung von ~4.700 Einträgen | map16 10,0 → 9,7 (−3 %); Paket abf5a022+91ff1cbe bestätigt: 10,3 → 9,6 (−7 %), p95 −8 % |
| e7217d18 | Kraken-Effekte | Tintenwolken behalten ihr Effekt-Quad und damit ihre gebackene 128²-Wassermaske; vorher verschob jede neue Wolke die Zuordnung, alle Wolken buken neu | Map 20 p95: Tauchen 18,9 → 12,9, Wellen 20,7 → 15,0, Landgang 23,7 → 15,8 |
| 5f0ad8aa, 3c2c16c7, 5d23c21c | Host-Physik | `canOccupyCircle` (Impuls-Sweep bei Rückstoß/Dash) nutzt ein Raster der statischen Fels-/Stamm-/Basiskörper statt aller Körper; Neuaufbau nur bei Mitgliederänderung der Gruppen | enemies-300 39,1 → 30,5 (−22 %); combat.day einzeln 10,2 → 9,6 (−6 %) |
| 2d902ed5 | Adrenalin-Essenz | Sammler als Liste statt String-Raster je Cluster | im Endpaket |
| 91a6c718 | Blutfeld | Ablauf- und Grenzen-Scan über alle Slots nur bei Änderung oder Erreichen der nächsten Frist | im Endpaket |
| 5c8ca13c | Blutfeld | Pool-Kandidaten erst per Distanz verwerfen (exakt, gleiche Wahl) | im Endpaket |
| 8ca467ac, bd6d2183 | Shader-Aufbau | Alpha-Zero-Guard merkt geschützte Header und überspringt Textur-Additions | im Endpaket |
| 6393e68c | Zielsuche | Homing-Abfragen ohne Kopie des Gegner-Arrays | im Endpaket |
| ac8ecf88 | Bodenfeuer | Kontaktabfragen ohne Rectangle-Allokation je Zelle | im Endpaket |
| e450b06a | Feuer-Warnband | Vorheiz-Band nur im Kamerabild (+2 Zellen Rand) | nicht separat gemessen |
| 27012d3b | Bodenfeuer | FireSystem führt ein host-lokales Änderungsjournal je Veröffentlichung (entfernte/neue Zellen, nie auf dem Draht); Renderer und Netz-Delta wenden es an statt ~4.700 Zellen zu vergleichen, Renderer sammelt nur betroffene Regionen | map16 (6bc36df7 → 27012d3b) CPU Mittel 9,17 → 8,97 (−2 %, Läufe überlappen nicht), p95 12,3 → 11,7 (−5 %) |
| 3e4fab11 | Bodenfeuer-Client | Client führt das Delta in eine id-indizierte Sicht zusammen (kein Neuaufbau/Sortieren je Tick, Ablaufprüfung nur bei fälliger Zelle) und journalisiert es für den Client-Renderer | Microbenchmark 4.700 Zellen, 8 neue je Tick: Merge 0,52 → 0,09 ms je Tick; der Voll-Diff im Client-Renderer entfällt zusätzlich. Das Lab misst nur den Host |
| 5d4626af, f26be39b | Allokationen | Uniform-Requests per `forEach` statt Entry-Arrays je Programm-Bind; Kampf-Integrationsport einmal je Laufzeit statt ~20 Closures je Abfrage (Map-20-Heap-Profil: ~7 % bzw. ~2 % der Allokationen) | Review-Suite ohne messbaren CPU-Effekt (alle Fälle im Rauschen), reine GC-Entlastung |

## Sichtbare oder spielerische Änderungen

- **Bodenfeuer-Ausbreitung (Host):** Eine sich ausbreitende Feuerfläche erscheint beim Host in
  Schritten von 50 ms statt pro Frame – im selben Takt, den Clients schon immer sahen. Neue Feuer nach
  einer Pause erscheinen sofort; Schaden, Kontakte und Platzierungsprüfungen lesen weiter live.
- Sonst keine: Glühpunkte, Masken, Warnband im Bild und Physik liefern dieselben Ergebnisse.
  Sichtprüfung per Screenshot der Map-16-Messphase (siehe oben); ein Vorher/Nachher-Pixelvergleich
  wurde nicht gemacht.

## Verworfen

| Hebel | Grund |
|---|---|
| Kraken-Mesh-Cache 32 → 128 Posen | kein messbarer Effekt; höchstens 2 Tentakel gleichzeitig, das Nachladen ist normales Vorab-Streaming |
| Taschenlampen-Verdeckung cachen | die Lampe dreht im Kampf ständig; kaum Treffer zu erwarten (nicht umgesetzt) |
| Flammen als Shader-Fläche statt Partikel | Befund: Flammen-Rendering ist nicht der Engpass; ohne Sichtabnahme kein Tausch der Art Direction |

## Offene Hebel

| Thema | Befund | Idee |
|---|---|---|
| Bodenfeuer-Netz | Bei 4.700 Zellen sendet der Host jede Sekunde einen Voll-Snapshot (Verlustreparatur): ≈152 KB JSON roh, ≈14 KB deflate, Host-`stringify` ≈0,8 ms, Client-`parse` ≈0,6 ms | bewusst unverändert (Verlust-Robustheit); bei Bedarf seltener oder als Bitmaske, dann mit `perf:network` messen |
| Horden-Kollision | Phasers Arcade-RTree (Gegner gegen statische Körper, 120 Hz) ~6 % bei 500 Gegnern | eigener Raster-Collider oder Physik mit 60 Hz plus Interpolation (Gameplay-Abwägung) |
| Gegner-Fortbewegung | `EnemyLocomotion.solve` ~9 % bei 500 Gegnern | Entfernungs-LOD außerhalb des Bildes (aus Runde 2) |
| Phaser-Render | weiterhin ~40–45 % der Frame-CPU, ~230 Draw-Calls; map16: `renderSubmit` 5,1 von 9,0 ms, davon ~7 % Uniform-Verarbeitung je Batch (Phaser setzt alle Uniforms je Batch, Duplikate filtert es bereits) | Draw-Calls/Batch-Wechsel senken, vorgebackenes Vegetationslicht (Runde 2) |
| Kraken-Szenario | Gegnerzahlen schwanken ab ~55 zwischen Läufen (55–79), Vergleiche der späten Phasen bleiben deshalb unscharf | Wellen-Spawn im Szenario deterministisch machen |
| Kraken-Masken | Körper-/Tentakel-Wassermasken backen bei jeder Bewegung am Ufer 128² Proben (~1,5 % Map 20) | gröberer Schwellwert oder kleinere Maske (sichtbare Uferkante prüfen) |

## Prüfung

- `npm run check:release` vor jeder Code-Integration, zusätzlich `npm run test:stress`.
- `perf:kraken`-Skript: Zielwahl in `land-spines` und Waffenreichweite vor der Todesphase korrigiert (`2177e9ba`); vier vollständige Läufe.
- Neue Tests: Feuer-Snapshot im Netztakt und inkrementell in Id-Reihenfolge
  (`tests/FireSystemVisualStyles.test.ts`), stabile Tintenwolken-Quads (`tests/KrakenRenderer.test.ts`),
  Hindernis-Raster mit `enable` und Mitgliederänderung (`tests/HostPhysicsSystemAllocation.test.ts`).
- Neue/erweiterte Tests: Journal-Pfad des Feuer-Renderers inkl. übersprungener Veröffentlichung
  (`tests/GroundFireGpuParticles.test.ts`), Host-Journal → Netz-Delta → Client inkl. Ablauf
  (`tests/integration/GroundHazardNetwork.test.ts`).
- Drahtformat unverändert, keine Protokollversion nötig.

## Playtest-Hinweise

1. **Map 16 bis zum Ende spielen** (cp8, Brandlichtung), am besten mit einem zweiten Spieler als Client:
   Fühlt sich der Kampf im Void-Feuer flüssiger an? Breitet sich das Kriechfeuer bei Host *und* Client
   gleichmäßig und lückenlos aus, und verschwinden auslaufende Flächen sauber?
2. **Map 20 gegen Mini-Kraken-Wellen:** Ruckler, wenn viele Mini-Kraken Tinte spucken, sollten weg sein;
   die Tintenwolken sollen am Ufer weiter korrekt am Wasser enden.
3. **Gegner mit Rückstoß an Felsen** (Explosionen, Schrotflinte, Dash-Gegner): dürfen weiterhin nicht
   in oder durch Felsen, Stämme oder Basen geschoben werden – auch direkt nachdem eine Wand gebaut oder
   ein Fels zerstört wurde.
4. **Feuer-Warnband** am Bildrand beim Schwenken der Kamera: Es soll ohne Lücke ins Bild laufen.
