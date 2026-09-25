# Augenleuchten – Implementierungsprüfung

Stand: 25. September 2026. Alle 14 feindlichen Gegnerarten besitzen framegebundene
Leuchtaugen und kleine, schattenlose Bodenlichter. Zombie bleibt milchig-weiß, Rabid lila.
PNG-Dateien und abgeschlossene Blender-Archive wurden nicht verändert.

## Quellen und automatisierte Prüfung

- 182 Posen / 364 Augenellipsen aus den tatsächlich ausgewählten archivierten
  Blend-Dateien: Zombie `v2-ao`, Alien `v2-am`, Pyro `v2-an`, übrige Gegner `v2-ap`.
  Migration prüft Blend-, Render-Metadaten-, PNG-Hashes, Selection und Clip-Samples.
- Alle 14 aktuellen Blender-Rezepte im separaten Blender-5.2.1-Prozess vorbereitet:
  direkte Augen-Sockets und vollständige 13-Frame-Abdeckung geprüft, ohne neue Sprites
  zu rendern oder bestehende Archive zu speichern.
- `npm run check`: 4353 Core-Tests, 54 Architekturtests sowie Spiel- und Map-Editor-Build grün.
- `npm run test:assets`: 118 Tests grün, einschließlich fehlender Frames, ungültiger
  Koordinaten, fremder Revision/Bilder und abweichender Blend-Bindung.
- Gezielte World-Integration und Stress: 34 Tests grün. Zusätzlich deckt der Core
  Framewechsel, Idle, interpolierte Position, Ursprung, Rotation, nichtuniforme und
  negative Skalierung, Spiegelung, Fraktion, Sichtbarkeit, Tod und Teardown ab.
- 240 Gegner / 480 Augen / 240 Lichtdaten über 100 Spawn-/Despawn-Zyklen:
  dieselben Pufferobjekte werden weiterverwendet. Der Lichttest liefert 120
  Bodenlichter trotz 250 normaler Lichtquellen auf High, Medium und Low.

## Browserprüfung

Server: `npm run dev:browser`, HTTP 200 auf `127.0.0.1:8090`.
Das bestehende Navigation-Lab wurde mit echten Gegnern und gemischten Gruppen genutzt.
Sein Einstieg wartet jetzt auf den asynchronen Arena-Boot. `kinds=all` beziehungsweise
eine kommaseparierte Auswahl aktiviert eine Prüfung mit normaler Spielkamera;
die Referenzszenarien behalten ihre bisherigen Einstellungen.

Eine lokale, nicht eingecheckte Prüfansicht unter `build/eye-review.html` isoliert
denselben produktiven `EnemyEyeGlowRenderer` und `LightingSystem` von Kampfeffekten.
Alle Arten wurden bei Originalgröße und 3-facher Kontrollgröße, bei Tag/Nacht,
Idle, laufendem Framewechsel, Bewegung und Rotation betrachtet. Beim Pyro folgen die
Lichter den Maskengläsern. Die minimale Kernfläche wurde danach für kleine Gegner
leicht vergrößert, ohne zusätzliche Effekt-Layer einzuführen.

Die 100er-Ansicht zeigte nachts 200 Augen und 100 Bodenlichter. Ausblenden ergab
sofort 0/0, Wiedereinblenden erneut 200/100. Spiegelung, Positionssprung und die
Timebomb-Taumelequation wurden ebenfalls kontrolliert. Diese Spezialfallprüfung
setzt die Sprite-Zustände direkt; sie ist keine separate Abnahme der vollständigen
KI-gesteuerten Burrow-, Teleport- oder Zündabläufe.

## Performance-Lab: finaler A/B-Vergleich

Identischer Build `e7ecd12a23e154d564f95dbca6d02b6c5a7f02c93173e8d63cada39f996fc963`,
Fall `enemies.medium`, 120 Gegner während des gesamten Messfensters, Seed 16092026,
30 Sekunden, 00:00 Uhr, High, 1920×1080, DPR 1, Chrome 153.0.8010.53,
Ryzen 7 5800X / RTX 3080, Capture-Profil `reduced` v6. Keine parallelen Lasttests.

```text
npm run perf:chrome -- --case enemies.medium --duration-seconds 30 --enemy-eyes off --time-of-day 00:00 --capture-profile reduced
npm run perf:chrome -- --case enemies.medium --duration-seconds 30 --enemy-eyes on --time-of-day 00:00 --capture-profile reduced
```

| Messgröße | Aus | An | Änderung |
|---|---:|---:|---:|
| Framezeit Median | 15,1 ms | 15,2 ms | +0,7 % |
| Framezeit p95 | 23,0 ms | 23,1 ms | **+0,4 %** |
| Render-Submission p95 | 6,4 ms | 6,6 ms | +3,1 % |
| GPU p95 | 9,90 ms | 10,56 ms | +6,6 % |
| GL-Zeichenaufrufe Median | 161 | 165 | +4 |
| Gesamter Chrome-Seitenheap, beobachtetes Maximum | 799 MiB | 828 MiB | +29 MiB |

Das p95-Ziel von höchstens 10 % Mehrkosten wurde in diesem Vergleich eingehalten.
Es handelt sich um eine Beobachtung auf dieser Maschine, keinen Signifikanztest.
Der Vergleich meldet die beabsichtigte Abweichung `environment.enemyEyes`; die
Projektilspitze schwankte zwischen 119 und 123. Der gesamte Seitenheap enthält
Boot, alle Spielressourcen und GC-Schwankungen und misst nicht den Speicherbedarf
der Augenkomponente. Die GPU-Messung erfasst PRE_RENDER–POST_RENDER, nicht frühere
Offscreen-Arbeit; Framezeit und CPU-Submission ergänzen diese Grenze.

Die Augenkomponente verwendet zwei persistente GPU-Layer mit zunächst je 512
Plätzen, zwei gemeinsame 32-Pixel-Texturen und einen bei Bedarf angelegten
Bodenlicht-Layer mit zunächst 256 Plätzen. Es entstehen keine Emitter, Filter oder
Schatten-Scratch-Texturen pro Gegner. Größere Gruppen erweitern die Puffer, statt
sichtbare Augen oder Lichter wegen eines Budgets zu verwerfen.

Lokale vollständige Belege:

- [Ohne Augenlicht](../build/performance-results/2026-09-25T15-16-56.161Z-57c942a5/analysis.md)
- [Mit Augenlicht](../build/performance-results/2026-09-25T15-14-49.689Z-7db27658/analysis.md)
- [Vergleich](../build/performance-results/comparison-1790349503421/comparison.md)

Die vollständigen Chrome- und Spieltraces liegen in diesen Ergebnisordnern.
Der erste sandboxierte Versuch scheiterte vor dem Szenario am Verbindungsserver;
die erfolgreichen Aufnahmen verwendeten Netzwerkfreigabe für den normalen Spielstart.
