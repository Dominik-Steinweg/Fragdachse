# Ambient wildlife: Darstellung und Messung

## Entscheidung

Die Wildlife-Darstellung verwendet vorbereitete Dreiecksnetze mit wiederverwendbaren
Animationskanälen. Schmetterlingspaletten und Schlangengrößen teilen ihre unveränderliche
Geometrie. Flügelbreite, Schweben, Schlangenwelle, Zunge, Schwarmbewegung und Fischschwanz
werden weiterhin kontinuierlich aus denselben Formeln und Zeitquellen abgeleitet.
`AmbientWildlifeModel`, Tieranzahl, Interaktionen und Ebenenreihenfolge bleiben unverändert.

Die zwei World-eigenen Ebenen verwenden Phasers vorhandenen `BatchHandlerTriFlat` samt
Shader und GPU-Puffern. Graphics dient ausschließlich als vorhandener GameObject-/Render-
Adapter; Zeichenbefehle, Ellipsen-Punktarrays und die laufende Pfadtriangulierung entfallen.
Der Renderer besitzt begrenzte CPU-Puffer und keine eigenen GPU-Ressourcen oder Texturen.
Die Vorbereitung erfolgt im bisherigen ArenaBuilder-Konstruktor unter der Ladeabdeckung.
Handoffs behalten dieselbe Renderer-Instanz; Destroy löst Mesh-Referenzen und CPU-Puffer.
Unsichtbare Tiere werden vor dem Animationssampling übersprungen und senden keine Geometrie.
Beim Wiedereintritt wird unmittelbar der aktuelle Modell-/Animationszustand verwendet.

## GPU-Abwägung

| Ansatz | Nutzen und Kosten |
| --- | --- |
| Gemeinsame Texturen mit Teiltransformationen | Gut für starre Silhouetten und Flügel. Schlangenkörper und Fischschwanz benötigen zusätzliche Verformung; Rasterisierung/Filterung verändert die vorhandenen kleinen Polygonkonturen. |
| Animationsframes | Entfernen Pfadaufbau, benötigen aber viele Varianten/Phasen und Texturspeicher. Diskrete Frames erfüllen die gewünschte kontinuierliche Verformung ohne zusätzliche Interpolation nicht. |
| Instanzierter Shader | Vorhandene SpriteGPULayer- und FlightRibbon-RenderNodes wurden geprüft. Sie liefern Integrationsmuster, aber keine passende Wildlife-Verformung. Ein eigener Shader könnte Wellen/Flügel auswerten; individuelle Bewegung, Reaktionen, Culling und Zustandsübergaben benötigen weiterhin CPU-Synchronisierung. Zusätzliche Shader-, Warmup-, Buffer- und Teardown-Verträge wären erforderlich. |
| Vorbereitete Geometrie, bestehender Triangle-Batch | Gewählt: vermeidet den gemessenen CPU-Hauptaufwand, erhält kontinuierliche Konturen und verwendet bestehende Shader-/GPU-Ownership. Zusätzlicher CPU-Speicher und mehr Dreiecke gegenüber Phasers dynamischer Punktvereinfachung sind der messbare Preis. |

Es wurden keine Shader-/Atlas-Prototypen als Vergleich implementiert. Die Auswahl kombiniert
die Prüfung der vorhandenen Infrastruktur mit der Messung des bisherigen und des gewählten Pfads.
Es gibt keine neuen Shader, Textur-Uploads, Readbacks, globalen Caches oder Animationsdrosselung.

## Messung am 15.09.2026

Windows, Node v24.14.0, AMD64 Family 25 Model 33. Vergleich gegen
`f18541eef9bba61f200f6e702356b4765e8b9950`. Isolierter Vitest-Lauf, 100 Warmup-Frames,
180 Messframes, gleiche Population, identische Phasenfolge und 1024 × 1024 sichtbarer Bereich.
120 Schmetterlinge + 96 Schlangen + 96 Fischgruppen mit insgesamt 288 Fischmitgliedern.
Die Modell-Simulation ist aus beiden Zeitmessungen ausgeschlossen.

| Messgröße | Vorher | Nachher |
| --- | ---: | ---: |
| CPU Darstellung + Phaser-Batch, Median | 16,821 ms | 2,501 ms (−85,1 %) |
| CPU p95 | 23,912 ms | 3,507 ms |
| CPU vollständig ausgeblendet, Median | 0,0061 ms | 0,0061 ms |
| Batch-Aufrufe pro Frame, Mittel | 3.709,88 | 2 |
| Batch-Flushes pro Frame | 3 | 3 |
| Übergebene Dreiecke pro Frame, Mittel | 21.008,98 | 34.464 |
| Vom Batch angeforderte Uploadbytes pro Frame, Mittel | 882.377 | 1.447.488 |
| Flushes / Uploadbytes vollständig ausgeblendet | 0 / 0 | 0 / 0 |
| Vorbereitung der Testdarstellung, ein Lauf | 3,462 ms | 9,459 ms |
| Gehaltener JS-Heap im Headless-Test, Median nach GC | 1.639.856 B | 2.797.896 B |
| Gehaltene ArrayBuffer im Headless-Test, Median nach GC | 688.128 B | 1.950.336 B |

**Messgrenzen:** Tatsächlich ausgeführt werden die installierten Phaser-Ellipsen-/Graphics-/
Triangulierungsfunktionen und der Batch-Pufferencoder. Die GL-Treibergrenze ist durch Zähler
ersetzt. Flushes sind deshalb keine gemessenen Browser-Draw-Calls; Uploadbytes sind die
vom Encoder angeforderte Datenmenge. GPU-Zeit, tatsächlicher GPU-Speicher und die Sichtprüfung
wurden nicht gemessen: Die ausdrücklich angefragte Browserfreigabe liegt bisher nicht vor.
Heap-/ArrayBuffer-Werte sind tatsächliche Differenzmessungen im Headless-Harness nach GC
(Median aus drei Instanzen), einschließlich desselben emulierten Batch-Puffers in beiden Pfaden.
Sie sind keine Aussage über den vollständigen Browser-Speicherbedarf. Keine Spiel-FPS ableiten.

Der zusätzliche Dreiecksaufwand entsteht, weil der alte Graphics-Pfad standardmäßig nahe
Punkte zur Laufzeit entfernt (`pathDetailThreshold = 1`). Die neue Darstellung hält die volle
vorbereitete Kontur vor. Der Vergleich bei voller Pfadauflösung prüft die Flächen je Farbe
gegen den bisherigen Renderer; unterschiedliche Dreiecksdiagonalen verändern die Kontur nicht.

## Reproduktion und Prüfung

```powershell
$env:WILDLIFE_BASELINE = 'f18541eef9bba61f200f6e702356b4765e8b9950'
npx vitest run --pool=threads tests/stress/AmbientWildlifeRendering.test.ts
```

Optional schreibt `WILDLIFE_REPORT` die Messwerte als JSON. Der historische Renderer wird
aus der expliziten Git-Revision gelesen und nicht als zweite Implementierung mitgeliefert.
Ohne `WILDLIFE_BASELINE` ist der Vergleichstest übersprungen.

`npm run check` bestanden: 3.697 Core-Tests, 33 Architecture-Tests und Produktionsbuild.
Die Stress-Suite bestand ebenfalls (74 Tests, ein optionaler Benchmark übersprungen).
Der isolierte Wildlife-Vergleich einschließlich Kontur-Parität bestand separat.
Die neuen Runtime-Tests sichern Culling/Wiedereintritt, feste Topologie, die bestehende
Schlangenwelle, unveränderte Modellreaktionen und idempotenten Teardown.
