# Ladezeiten Boot → Lobby → Karte, 29.10.2026

Branch `load-times` (Basis `main` 29a33e12), Plan: Lobby früher sichtbar, Kartenstart kürzer, Lobby-
Wartezeit für die nächste Karte nutzen, Dateien ohne sichtbaren Verlust verkleinern. Dateigrößen und
Service Worker liefen parallel auf eigenen Branches (siehe unten) und sind in diesen Zahlen nicht enthalten.

## Messung

`npm run perf:chrome -- --load`, Performance-Lab-Produktionsbundle, High, 1664×936, sichtbares Chrome,
RTX 3080. Lokal 3 Läufe je Stand (Median), 50 Mbit/s je 1 Lauf. „Kalt“ = geleerter HTTP-Cache; der erste
Lauf eines Profils hat zusätzlich einen kalten Shader-Cache (der Wert in Klammern, entspricht dem
allerersten Besuch). Für Karten zählt „World-Ready“ ab Weltaufbau (plus ~0,4–0,6 s Lobby-Ausblendung
davor): Der Reveal-Wert des Labs fällt in den Countdown, wenn seine 100-ms-Abfrage den Beginn der
Spawn-Nahaufnahme erwischt; der Ladeschleier ist dann längst offen (siehe Befunde).

| Lokal | Baseline | Endstand |
|---|---:|---:|
| Boot → Lobby, kalt (erster Besuch) | 9,3 s (27,1 s) | 5,3 s (13,6 s) |
| Boot → Lobby, warm | 8,9 s | 5,4 s |
| Map 1 / 7 / 15, World-Ready | 5,0 / 7,4 / 5,3 s | 2,9 / 3,4 / 2,1 s |
| Karte → Lobby | 3,5–3,7 s | 1,9 s |

| 50 Mbit/s | Baseline | Endstand |
|---|---:|---:|
| Boot → Lobby, kalt | 33,7 s | 23,2 s |
| Boot → Lobby, warm | 7,4 s | 5,4 s |
| Map 7 / 15, World-Ready | 5,7 / 4,0 s | 3,6 / 2,3 s |
| Map 1, World-Ready | 5,1 s | 8,0 s (wartet auf die zweite Phase, s. u.) |

Download vor der Lobby (lokal, kalt): Sprites 38,3 → 25,8 MB, UI 11,0 → 5,4 MB, Skripte 16,7 → 11,7 MB
(Sprachpakete).

## Änderungen

**Kritischer Pfad bis zur Lobby**
- `KHR_parallel_shader_compile` wird beim Boot aktiviert; das GPU-VFX-Warmup reicht alle Lanes und
  Proben in einem Frame ein und fragt danach nur den Status ab (vorher je Frame ein blockierender Link,
  einzeln bis 1 s). Nebel- und Material-Links warten am Ende der Vorbereitung nicht blockierend.
- Der Lobby-Reveal wartet nur noch auf die sichtbare Render-Arbeit; Kampf-Warmup und Kampf-Präsentation
  laufen dahinter weiter. Runden warten unverändert auf beides.
- Fels-Formation: Bereitschaft zählt nur darstellbare Geometrie (vorher alle drei Stützstellen-Stufen:
  Lobby 36 statt 12 Jobs). Der Worker startet beim Preload und wird je World neu initialisiert
  (Modulstart vorher bis 3,8 s auf dem kritischen Pfad).
- Phaser und Preload starten parallel zum Verbindungsaufbau, die Vorbereitung erst nach `bridge.activate()`.
- Bauhof-Bühne, Rundenend-Overlays (zusammen ~0,3 s Boot-CPU) und Sprachpakete erst nach dem Reveal.

**Zweite Ladephase**
- Rundeninhalte (Gegner außer Schießstand-Ziel, Dawn-Props/-Decals/-Ergebnisbilder, reaktive Props,
  Brutgrube, Brücken, Gleise, Zugmaterial, Gegnerbasen, Missionsobjekte; zusammen mit den
  Deko-Bildern ~18 MB) laden als erforderliche Einträge nach dem Reveal in Paketen zu 16 Dateien;
  ungenutzte Legacy-Kronen gar nicht mehr.

**Kartenstart**
- Der Boden-Material-Worker hält bis zu 4 Kacheln; ein wartender Chunk-Owner darf im selben Frame die
  nächsten Jobs vorab anfragen (Map 7: Bodenkacheln 4,4 → 2,6 s).
- Layout-Prefetch für alle Kampagnenkarten (vorher nur Karten mit persistenter Basis).
- Die Ladekamera zeigt vor dem ersten Spawn den erwarteten Spawnbereich; hinter dem Ladeschleier springt
  sie, ein sichtbares Gleiten endet exakt.
- Eine Runde mit dynamischer Tageszeit lädt mit ihrer Startzeit (Map 15 lud bisher den Endzustand 23:30
  und sprang zum Start auf 20:45, mit neuem Licht- und Schatten-Bake).

## Befunde

- Der größte Einzelposten war das Warten auf Kampf-Shader vor dem Lobby-Reveal (bis 11,9 s beim ersten Besuch).
- Die gelegentliche Lücke von konstant ~4,2 s zwischen World-Ready und Lab-Reveal (Map 15 meist,
  Map 1/7 zufällig, auch in der Baseline) ist ein Messartefakt: Die Spawn-Nahaufnahme verändert den
  Ausschnitt jeden Frame, die Reveal-Abfrage meldet bis zum Ende der Fahrt „nicht bereit“. Der Schleier
  ist zu diesem Zeitpunkt bereits offen, sonst würde die Nahaufnahme nicht starten.
- Startet eine Runde direkt nach dem Boot, wartet sie auf die zweite Phase (bei 50 Mbit/s Map 1 +3 s).
  Boot bis spielbar ist trotzdem kürzer (35,9 s statt 43,5 s), und normale Lobby-Wartezeit deckt das ab.

## Offen

- Dateigrößen (Branch `claude/inspiring-roentgen-6a79d1`, Bericht `assets-optimization-2026-10-29.md`)
  und Service Worker (Branch `claude/elated-mcnulty-c921e0`, Bericht `service-worker-2026-10-29.md`)
  sind noch nicht in `load-times` integriert; die Berichte liegen in diesen Branches.
- Nicht umgesetzt: geteilte Sonnen-Shaderprogramme, Worker-Pool für Fels-Builds, Bilddecode außerhalb
  des Main-Threads, Priorisierung der Inhalte der angekündigten Karte in der zweiten Phase, Prefetch für PvP.
- Nicht gemessen: Gastrolle, schwache GPU, Low.

Rohdaten: `build/performance-results/2026-10-29T18-16-30.634Z-308fb8f9` (Baseline),
`…T19-35-44.463Z-82bfb068` (Endstand lokal), `…T19-29-19.190Z-d7b6ea34` / `…T19-28-08.749Z-82d6c6e6`
(50 Mbit/s Baseline / Endstand) im Worktree `load-times`.
