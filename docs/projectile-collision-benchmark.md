# Projektil-Kollisionssuche: CPU-Vergleich

Gemessen am 15.09.2026 unter Windows mit Node 24.14.0, Vitest 3.2.7 und einem
AMD Ryzen 7 5800X. Rohwerte aller Wiederholungen stehen in
[projectile-collision-benchmark.json](projectile-collision-benchmark.json).

## Verfahren

Der Benchmark isoliert `ProjectileCollisionProcessor.run`, einschließlich Zielvorbereitung,
räumlicher Indexabfrage, exakter Trefferprüfung und Kandidatensortierung. Vorher wurde der
ursprüngliche Processor aus Commit `31e7888c9fa99d5d488df6fa8fed8b05b0ac0295` ausgeführt,
mit der bisherigen `flatMap`-/Bounds-Projektion aller Felsen. Nachher verwendet dieselbe Fixture
die räumliche World-Abfrage am gemeinsamen `ArenaObstacleIndex` und den optimierten Processor.

- Seed 731; 4.000 bzw. 20.000 Felsen; 0, 8 oder 1.500 Projektile.
- Je zur Hälfte Overlap und Sweep; echte Felskontakte werden aufgelöst. Eine nicht verbrauchende
  Testreaktion hält dieselbe Arbeitslast über alle Messdurchläufe aufrecht.
- Pro Konfiguration drei Wiederholungen mit je zehn Aufwärm- und 50 Messdurchläufen.
- Aufbau und expliziter Index-Rebuild erfolgen außerhalb der laufenden Kollisionsmessung.
- Angegeben ist der Median der drei Wiederholungsmediane bzw. der drei p95-Werte.
- Die Kontaktanzahl war vor und nach der Änderung in jeder Konfiguration identisch.
  Separate Regressionstests vergleichen zusätzlich Trefferreihenfolge und Geometrie mit einer
  Vollsuche und einem geometrischen Brute-Force-Vergleich.

## Laufende Suche

Alle Zeiten in Millisekunden pro Processor-Durchlauf:

| Felsen | Projektile | Median vorher | Median nachher | p95 vorher | p95 nachher |
|---:|---:|---:|---:|---:|---:|
| 4.000 | 0 | 1,859 | <0,001 | 3,268 | <0,001 |
| 4.000 | 8 | 3,026 | 0,040 | 4,906 | 0,071 |
| 4.000 | 1.500 | 274,734 | 5,520 | 326,509 | 5,934 |
| 20.000 | 0 | 8,205 | <0,001 | 14,759 | <0,001 |
| 20.000 | 8 | 16,017 | 0,023 | 24,916 | 0,034 |
| 20.000 | 1.500 | 1.383,693 | 6,595 | 1.622,652 | 7,281 |

Bei 20.000 Felsen und 1.500 Projektilen entspricht dies rund **210-fach weniger CPU-Zeit**
für diesen isolierten Pfad. Unterschiedliche JIT-Aufwärmung und Systemlast erklären, weshalb
der kleine 8-Projektil-Fall mit 20.000 Felsen schneller ausfallen kann als mit 4.000 Felsen.

| Felsen | Projektile | Vorher durchsuchte Zielslots pro Durchlauf | Nachher räumlich gelieferte Kandidaten | Kontakte |
|---:|---:|---:|---:|---:|
| 4.000 | 8 | 32.000 | 57 | 12 |
| 4.000 | 1.500 | 6.000.000 | 9.263 | 1.878 |
| 20.000 | 8 | 160.000 | 57 | 12 |
| 20.000 | 1.500 | 30.000.000 | 11.061 | 2.250 |

Nach dem Indexaufbau liest der optimierte Pfad **keine Fels-Bounds erneut**. Der vorherige
Pfad las pro Durchlauf 4.000 bzw. 20.000 Bounds. Indexaufbau und Rebuild bleiben linear zur
World-Geometrie; ihre einzelnen Messwerte stehen in der JSON-Datei.

## Reproduktion

Im optimierten Arbeitsstand, PowerShell:

```powershell
$env:PROJECTILE_BENCH = 'spatial'
npx vitest run --pool=threads tests/stress/ProjectileCollisionBenchmark.test.ts
Remove-Item Env:PROJECTILE_BENCH
```

Für den ursprünglichen Vorher-Wert einen separaten Checkout des oben genannten Commits
verwenden und die beiden Dateien `tests/projectileCollisionFixture.ts` und
`tests/stress/ProjectileCollisionBenchmark.test.ts` aus diesem Arbeitsstand übernehmen.
Mit denselben installierten Abhängigkeiten denselben Befehl mit
`$env:PROJECTILE_BENCH = 'full'` ausführen. Der räumliche Zweig wird in diesem Modus nicht benutzt.
`full` im optimierten Arbeitsstand misst dagegen die Vollsuche mit dem **bereits optimierten**
Processor und reproduziert daher nicht die ursprünglichen CPU-Zeiten.

Ohne `PROJECTILE_BENCH` ist die Messmatrix übersprungen. Sie gehört zum vorhandenen
Stress-Runner; sie benötigt keine neue Testinfrastruktur und erzwingt keine engen Zeitgrenzen.

## Grenzen und Verifikation

Dies sind **keine Browser-FPS und keine vollständigen Host-Frame-Zeiten**. Rendering, echte
Physiksimulation, Schadensreaktionen sowie die zusätzliche Placement-/Basis-Anbindung sind
nicht Teil der isolierten Zeitmessung. Diese Anbindung wird durch Binding- und Integrationstests
geprüft. Dynamische Kampfziele bleiben linear an den bisherigen Snapshot-Grenzen vorbereitet.
Lange oder große Flugbereiche, viele tatsächliche Treffer und Geometrie-Rebuilds kosten weiterhin CPU.

Der 0-Projektil-Fall charakterisiert den Processor direkt: Die normale Host-Interaction-Stage
übersprang bereits vorher eine vollständig leere Aktivmenge. Neu unterbleibt die Vorbereitung
auch bei vorhandenen, aber für diesen Pfad irrelevanten Projektilen.

Bestanden: `npm run check` mit 3.694 Core-Tests, 33 Architecture-Tests und Produktionsbuild;
außerdem 479 Integrationstests und 17 bestehende Projectile-Stress-Tests. Die opt-in Messmatrix
wurde separat vor und nach der Änderung ausgeführt. Der Diff-Check der Aufgaben-Dateien ist sauber.
Der globale Diff-Check meldete während der Prüfung ein nachgestelltes Leerzeichen in einer
parallel geänderten Audio-Datei; diese gehört nicht zu dieser Aufgabe und wurde nicht verändert.

Ein bestehender Stress-Test erwartete Flammentreffer auf niedrige Türme und scheiterte auch mit
dem ursprünglichen Processor. Seine Erwartung wurde an die bereits geltende Höhenregel angepasst;
die Produktionsregel wurde nicht verändert.
