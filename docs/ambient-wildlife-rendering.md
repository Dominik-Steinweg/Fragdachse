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

## Störungen (alle Arten)

Seit 21.10.2026 gilt eine Störregel für alle Tiere. Bewegte Körper (dargestellte Spieler und Gegner,
gemessen bis zur Körperkante) und gemerkte Impulse (Schüsse, zerstörerische Explosionen) alarmieren.
Die Reichweite ergibt sich aus `alertRadius` und dem Impulstyp (`disturbance` in
[AmbientWildlifeConfig](../src/arena/AmbientWildlifeConfig.ts)). Gegner werden über
`EnemyManager.forEachEnemy` ohne Allokation gelesen, auf Sicht plus Rand begrenzt und pro Frame in ein
grobes Bucket-Grid kompaktiert. Explosionen erreichen Nebel und Wildlife über
`EffectSystem.bindExplosionObserver`. Alles bleibt lokale Präsentation ohne Netzwerkzustand.

## Vögel

Spatzenschwärme, Elstern, Raben und Waldkäuze verwenden denselben Triangle-Batch. Jeder Vogel hat
Kanäle für Kontaktschatten, Körper, Schwanz, Kopf und beide Flügel; ein Schwarm wiederholt sie je
Mitglied. Gefaltete Flügel schwenken um die Schulter nach hinten, Kanäle tragen dafür eine Rotation
(`WildlifeMesh.rotated`). Der bestehende Pfad ohne Rotation bleibt unverändert.

Der Renderer sampelt jeden Vogel einmal pro Frame und gibt die Lage an bis zu zwei von vier Ebenen
(`BIRD_LAYER_DEPTHS`): Boden unter dem Nebel, Flugschatten im Figurenschattenband, niedriger Flug
unter den Kronen, hoher Flug über den Kronen. Die Gewichte überblenden nach Höhe, die obere Kopie
ist vollständig, bevor die untere verschwindet (`writeBirdLayerWeights`). Im Kronenband steigt ein
Vogel aus den Blättern oder sinkt hinein; Reiseflughöhen liegen nie im Band. Flugebenen erhalten
`resolveCanopyTint` als reine Multiplikation. Der Flugschatten teilt die animierten Posen des
Körpers, ist ein überlappungsfreier Fächer und folgt bei Tag der Sonne, nachts schwach dem Mond
(`projectBirdShadow`). Präsentationszustand liegt am Renderer, nie am Tier.

Ton: [AmbientWildlifeAudio](../src/arena/AmbientWildlifeAudio.ts) liest die einmaligen Signale des
Modells. Die IDs stehen in [audio-sounds.md](audio-sounds.md).

### Messung am 21.10.2026

Modell-Update allein, isolierter Vitest-Lauf auf Node, 600 Frames nach 120 Warmup-Frames,
synthetische Karte 8320 × 3200 mit 400 Bäumen und Teich (113 Schmetterlinge, 90 Motten,
34 Glühwürmchen, 96 Schlangen, 14 Fischgruppen; mit Vögeln zusätzlich 18 Spatzenschwärme,
10 Elstern, 6 Raben, 6 Eulen), Sicht 1920 × 1080:

| Messgröße | `main` cc28b186 | mit Vögeln |
| --- | ---: | ---: |
| Aufbau unter der Ladeabdeckung | 8,2 ms | 20,6 ms |
| Update ohne Störer, Tag | 0,140 ms | 0,161 ms |
| Update mit 300 bewegten Körpern in Sicht | 0,809 ms (nur als Spieler übergeben) | 0,290 ms |

Darstellungs- und GPU-Kosten wurden nicht gemessen; die Sichtprüfung erfolgte im Wildlife-Labor und
im Dev-Szenario auf Map 1 (Tag und Nacht). Einzelwerte schwanken mit JIT und Last.

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
