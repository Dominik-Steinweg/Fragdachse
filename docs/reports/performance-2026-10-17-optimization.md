# Performance-Regression seit 058add2 und Optimierungsrunde

Stand: 17. Oktober 2026. Ausgangspunkt `main` bei `b7737252`, Vergleich gegen `058add2b`
(10. Oktober), Optimierungen auf dem Branch `perf-pass`.

**Ergebnis:** Der optimierte Stand braucht gegenüber `b7737252` in ruhigen Szenen 20 bis 30 % weniger CPU-Zeit pro Frame, im normalen Kampf 26 bis 31 % und bei 100 bis 500 Gegnern 32 bis 44 % weniger. In allen Spielszenen liegt er auch unter `058add2b` (14 bis 29 % weniger), in der Lobby gleichauf, obwohl alle neuen Features erhalten bleiben.

## Ausgangslage

Zwischen `058add2b` und `b7737252` liegen 519 Commits. Der Review-Parcours des Performance-Labs
(drei Wiederholungen, hohe und niedrige Qualität, abwechselnde Reihenfolge) zeigte in ruhigen Szenen
0,2 bis 0,4 ms mehr CPU-Zeit pro Frame, bei vielen Gegnern und im Kampf 18 bis 34 % mehr.
Die Last war vergleichbar: gleiche Gegnerzahlen, ähnliche Geschosszahlen, keine Workload-Warnungen.

Zwei Ursachen ließen sich direkt zuordnen:

- **Lightmap-Neuaufbau in fast jedem Frame (seit `50f66e2b`).** `LightingSystem.syncViewportToCamera`
  verglich `view.right - scrollX` ohne Toleranz mit der Basisbreite. Gleitkommarauschen der
  Scrollposition ergab bei etwa jeder fünften Position knapp mehr als 1920 px; die Lightmap pendelte
  zwischen zwei Größen und baute Lightmap und Occluder-Slots neu auf (rund 130 neue Render-Targets
  pro Sekunde, jeweils mit synchroner Framebuffer-Prüfung).
- **Volle Netz-Snapshots in Darstellungsschleifen.** Alien-Kegel, Schild-Anstürmer, Brandstifter und
  Gauss-Warnung riefen pro Gegner und Frame `EnemyEntity.getNetSnapshot()` auf, um ein Feld zu lesen.

## Änderungen

Alle Änderungen erhalten Host-Autorität, World-/Activity-Lebenszyklen und das Drahtformat.

| Bereich | Änderung | Sichtbar/spielbar |
|---|---|---|
| Licht | Toleranz von 0,5 px und Hysterese beim Lightmap-Wachstum; Test für fraktionale Kamerascrolls | nein |
| Gegner-Renderer | Gegnerart-Prüfung vor dem Snapshot-Aufruf; `getNetSnapshot` ohne Objekt-Spreads | nein |
| Netzwerk | `NetworkBridge.getLatestPlayerStates()`: der Host dekodiert seinen eigenen Snapshot nicht mehr pro Frame; der Kraken-Empfänger wird in seinen Event-Listenern ausdrücklich nachgeführt | nein |
| Audio | Hörbare Überlagerung gleicher One-Shots begrenzt (8 je Key): fremde Quellen starten die älteste Kopie neu oder entfallen in deren ersten 45 ms; eigene Sounds und UI immer hörbar; freie Stimmen anderer Keys werden bei voller Retention freigegeben | ja, dichtere Gefechte klingen weniger überladen |
| Blutflecken | Einblenden, Halten und Ausblenden werden im Batch aus der Uhr berechnet statt mit zwei Tweens je Fleck; Eintreffen über eine sortierte Warteschlange statt Timer; Lauf-Suche ohne Kopie der Display-Liste. Canvas behält Tweens und Timer | nein |
| Gegner-Halo | Atmen pro Frame aus der Uhr statt Endlos-Tween; der Halo atmet jetzt auch in der Größe, die der alte Tween wegen `setDisplaySize` nie zeigte | leicht |
| Physik | Arcade `useTree: false`: alle Collider zielen auf statische Gruppen, der dynamische RTree wurde pro 120-Hz-Schritt neu gebaut und nie abgefragt | nein |
| Schatten | `EnemyMeshShadowRenderer` ohne temporäre Sets und Arrays pro Frame | nein |
| Bodenökologie | ~1.500 Einzelbilder (Laub, Ufersteine, Seerosen) als `SpriteGPULayer`-Seiten zu 2048 px; das Schaukeln der Seerosen läuft auf der GPU mit der Wasserzeit | nein |
| Bäume | Stämme als Textur-Quad statt `Arc`-Pfad | nein |
| Felsen | GPU-Seiten 2048 statt 512 px: 4 bis 6 statt 24 Draw-Calls im Bild | nein |
| Phaser | Uniform-Anfragen der Shader-Programme in einer nativen `Map` (`installPhaserUniformRequests`); Phaser 4.2.1 löschte bei jedem Bind jeden Schlüssel eines Objekts | nein |
| Wildtiere | Zellprüfungen über ein numerisches Raster statt String-Schlüssel | nein |
| Türme | Zielsuche prüft die Sichtlinie nur für Kandidaten, die gewinnen würden; gleiche Zielwahl | nein |
| Gegnerbewegung | Ab 96 Körpern löst jede Einheit ihre Steuerung nur jeden zweiten Frame und behält dazwischen die zuletzt geprüfte Wahl, solange Ziel, Geometrie und Geschwindigkeit unverändert sind | Reaktion in großen Horden einen Frame später |

## Messung

Performance-Lab-Suite `review` mit drei Builds (`058add2b`, `b7737252`, `perf-pass`), je drei Wiederholungen
in hoher und niedriger Qualität, Reihenfolge je Wiederholung gewechselt, keine CPU-Drosselung, keine Profiler. Angegeben
ist der Median der Lauf-Mediane der CPU-Zeit pro Frame in ms; Frame p95 ist der Median der Lauf-p95. 18 von 18 Läufen
vollständig, keine Browserfehler oder Konsolenwarnungen.

### Hohe Qualität

| Fall | 058add2 | current | final | final vs. current | final vs. 058add2 | Frame p95 current → final | Streuung final |
|---|---:|---:|---:|---:|---:|---:|---:|
| lobby | 3,4 | 3,7 | 3,4 | −8 % | +0 % | 6,2 → 6,2 | 3,4–3,4 |
| review.enemies-100 | 11,4 | 15,1 | 9,7 | −36 % | −15 % | 18,3 → 12,2 | 9,5–9,9 |
| review.enemies-300 | 24,3 | 32,7 | 20,3 | −38 % | −16 % | 42,5 → 24,3 | 19,5–20,3 |
| review.enemies-500 | 44,6 | 56,5 | 31,8 | −44 % | −29 % | 72,7 → 42,4 | 31,7–33,0 |
| review.player | 4,3 | 4,6 | 3,5 | −24 % | −19 % | 6,2 → 6,2 | 3,4–3,7 |
| review.fog-rock | 4,6 | 4,6 | 3,7 | −20 % | −20 % | 6,2 → 6,2 | 3,5–3,7 |
| review.camera | 5,7 | 6,1 | 4,7 | −23 % | −18 % | 12,1 → 6,2 | 4,7–4,8 |
| review.explosions | 4,7 | 5,0 | 3,7 | −26 % | −21 % | 6,2 → 6,1 | 3,6–3,7 |
| review.train | 4,3 | 4,6 | 3,5 | −24 % | −19 % | 6,2 → 6,2 | 3,5–3,5 |
| ultimate.armageddon | 8,3 | 9,7 | 6,7 | −31 % | −19 % | 12,2 → 12,1 | 6,7–6,8 |
| combat.day | 12,5 | 15,4 | 10,7 | −31 % | −14 % | 24,2 → 18,1 | 10,7–10,7 |

### Niedrige Qualität

| Fall | 058add2 | current | final | final vs. current | final vs. 058add2 | Frame p95 current → final | Streuung final |
|---|---:|---:|---:|---:|---:|---:|---:|
| lobby | 2,9 | 3,2 | 2,9 | −9 % | +0 % | 6,2 → 6,2 | 2,9–3,2 |
| review.enemies-100 | 9,9 | 12,1 | 8,2 | −32 % | −17 % | 18,2 → 12,2 | 8,1–8,3 |
| review.enemies-300 | 22,2 | 28,1 | 18,0 | −36 % | −19 % | 36,4 → 24,3 | 17,5–18,4 |
| review.enemies-500 | 40,1 | 52,8 | 30,6 | −42 % | −24 % | 66,7 → 36,4 | 29,5–30,9 |
| review.player | 3,7 | 4,0 | 2,9 | −27 % | −22 % | 6,2 → 6,2 | 2,9–2,9 |
| review.fog-rock | 4,0 | 4,4 | 3,1 | −30 % | −23 % | 6,2 → 6,2 | 3,1–3,3 |
| review.camera | 5,2 | 5,4 | 4,3 | −20 % | −17 % | 6,2 → 6,2 | 4,2–4,3 |
| review.explosions | 4,0 | 4,4 | 3,2 | −27 % | −20 % | 6,2 → 6,2 | 3,2–3,3 |
| review.train | 3,5 | 3,8 | 2,9 | −24 % | −17 % | 6,2 → 6,2 | 2,9–2,9 |
| ultimate.armageddon | 7,3 | 7,7 | 5,8 | −25 % | −21 % | 12,2 → 6,2 | 5,7–5,9 |
| combat.day | 11,1 | 12,3 | 9,1 | −26 % | −18 % | 18,2 → 12,2 | 9,1–9,5 |

In ruhigen Szenen erreichen alle drei Stände die Bildwiederholrate (Frame p95 6,2 ms); dort ist die gesparte CPU-Zeit
Reserve für schwächere Rechner. Im Kampf und bei Horden sinkt auch die p95-Framezeit deutlich, etwa bei 300 Gegnern
von 42,5 auf 24,3 ms (hoch).

Der JS-Heap bleibt beim aktuellen Stand (Median über alle Messfenster, hoch: 830 MiB für `058add2b`, 1.016 MiB für
`b7737252`, 1.004 MiB optimiert). Speicher war bewusst nachrangig.

Die Zuordnung der Kosten stützt sich auf CPU-Profile mit Aufrufbäumen (Sampling 250 µs, über Sourcemaps zugeordnet)
der Szenen „300 Gegner“, „Tagkampf“ und „ruhige Spielfigur“ sowie auf Objektzählungen während der Messfenster:
im Kampf etwa 572 → 12 aktive Tweens, 142 → 3 Timer und 77 → 35 gleichzeitig spielende Sounds; in der ruhigen Szene
3.225 → 1.710 Einträge in der Display-Liste.

## Prüfung

- `npm run check`: 6.972 Core-Tests, 63 Architecture-Tests, Spiel-, Map-Editor- und Balance-Editor-Build.
- `npm run test:integration` (995), `npm run test:stress` (165), `npm run test:assets` (238), `git diff --check`.
- Sichtvergleich per Screenshot im Performance-Lab: ruhige Szene und Felsszene pixelnah identisch
  (mittlere Abweichung 0,19 bzw. 0,03 von 255, verbleibende Punkte sind zeitabhängige Wasserglanzlichter);
  Kampfszene mit Blutflecken, Halos und Effekten ohne fehlende Elemente.

## Grenzen

- Ein Rechner (Ryzen 7 5800X, RTX 3080, Chrome 155, 1920 × 1080, 165-Hz-Monitor), lokale Host-Simulation
  ohne echtes WebRTC. Framezeiten in ruhigen Szenen sind an die Bildwiederholrate gebunden; die
  CPU-Zeit zeigt dort die gewonnene Reserve.
- Gehör und GPU-Zeiten einzelner Features sind nicht gemessen. Das Audiolimit ist per Test belegt,
  nicht akustisch abgenommen.
- Ladezeiten wurden nicht verglichen.

Rohdaten, Profile, Census- und Screenshot-Skripte liegen lokal unter `build/perf-compare-20261017/`.
