# Performance nach Spielbereichen

Stand: 9. Oktober 2026, Commit `77f5690b` (StainPerformance).

**Grafik und Effekte sind in den untersuchten Situationen der größte CPU-Bereich. Bei vielen Gegnern kommen hohe Kosten für Bewegung, Kollisionen und Geschosse dazu.** Die aussichtsreichsten Änderungen betreffen deshalb gleichzeitig aktive Gegner und Geschosse, die Partikel ihrer Darstellung sowie die ständig gezeichnete Umgebung. Eine weitere Konzentration auf Blutflecken wäre nach der bereits erfolgten Optimierung nicht die erste Wahl.

Diese Analyse beschreibt den laufenden Spielbetrieb. Sie verändert weder Gameplay noch Grafik. Einen einzigen Durchschnitt für eine ganze Spielsession gibt es hier bewusst nicht: Dafür müsste bekannt sein, wie lange Spieler in ruhigen Szenen, normalen Kämpfen und großen Gegneransammlungen verbringen. Die folgenden Mittelwerte gelten jeweils für eine benannte Spielsituation.

## Wie die Zahlen zu lesen sind

- **CPU-Zeit pro Frame:** Zeit für einen Spielschritt einschließlich der CPU-Arbeit zur Vorbereitung und Übergabe der Grafik. Das ist der Hauptthread des Browsers, nicht die Gesamtauslastung aller Prozessorkerne.
- **Framezeit:** Abstand zwischen aufeinanderfolgenden Frames im Runner. Für 60 FPS stehen etwa 16,7 ms pro Frame zur Verfügung, für 120 FPS etwa 8,3 ms. Eine mittlere CPU-Zeit unter dieser Grenze garantiert noch keine gleichmäßig flüssigen Frames.
- **Frame p95:** 95 % der Frames eines Laufs liegen unter diesem Wert. Die Tabelle mittelt die p95-Werte der Wiederholungen; sie berechnet kein gemeinsames Perzentil aus allen Frames.
- **GPU-Zeit:** separat abgefragte Zeit der Renderphase auf der Grafikkarte. CPU und GPU arbeiten überlappend; ihre Zeiten werden nicht addiert.
- **Bereichsanteile:** angenäherte Anteile an der aktiven CPU-Zeit aus Stichproben des Aufrufstapels. Sie sind weder GPU-Anteile noch zugesicherte Einsparungen beim Abschalten eines Features.

## Gesamtkosten der Spielsituationen

Alle Zeiten in hoher Grafikqualität, ohne CPU-Sampling-Profiler. Angegeben ist das arithmetische Mittel der Mittelwerte der einzelnen Läufe.

| Situation | CPU Ø ms | Frame Ø ms | Frame p95 ms | GPU Ø ms | Läufe |
| --- | --- | --- | --- | --- | --- |
| Ruhige Spielfigur | 4,2 | 6,1 | 6,1 | 2,0 | 2 |
| 100 Gegner | 13,1 | 13,4 | 16,0 | 3,7 | 3 |
| 300 Gegner | 32,7 | 33,3 | 52,5 | 6,8 | 3 |
| 500 Gegner | 66,7 | 67,6 | 118,8 | 14,4 | 3 |
| Kampf bei Tag | 13,1 | 13,3 | 18,3 | 3,4 | 2 |
| Kampf bei Nacht | 14,3 | 14,5 | 18,3 | 3,5 | 2 |
| Ruhe nach Kampf | 5,2 | 6,1 | 6,2 | 4,4 | 2 |
| Map 15 insgesamt | 7,9 | 8,6 | 15,3 | 2,6 | 3 |
| Map 15: zweite Phase | 9,2 | 9,5 | 15,5 | 2,8 | 3 |

Die ruhige Szene enthält keine Gegner. Die Kampfprobe nutzt Wellen, Glock, Barriere und Raketenturm. Die Gegnerproben verwenden eine festgelegte Mischung aus tollwütigen, Alien- und Pyro-Dachsen. Sie bilden nicht jeden möglichen Build oder Gegnertyp ab.

Die 300- und 500-Gegner-Proben überschreiten schon mit ihrer mittleren CPU-Zeit das Budget für 60 FPS. Bei 500 Gegnern kommen ausgeprägte Spitzen hinzu. Die GPU-Zeiten liegen in diesen beiden Proben deutlich darunter: Die CPU ist hier der vorrangige Engpass. Diese Aussage gilt für die getestete Hardware und Last.

Map 15 ist mit durchschnittlich 7,9 ms CPU-Zeit deutlich günstiger als die großen Gegnerproben; in der zweiten Bossphase sind es 9,2 ms. Viele sichtbare Feuerflächen bedeuten daher nicht automatisch, dass diese Szene das größte aktuelle Performanceproblem ist.

Die 100-Gegner-Probe hat 2 Sekunden Aufwärmzeit, die gesonderten 300- und 500-Gegner-Proben 30 Sekunden. Dazu entwickeln sich Geschosse und Treffer dynamisch. Die Zahlen zeigen die Größenordnung der Belastung, aber keine saubere Kostenkurve pro zusätzlichem Gegner. Unterschiedliche Aufwärmzeiten oder kurze Überlastungsphasen dürfen nicht zu einer linearen Hochrechnung vermischt werden.

## Aufteilung in größere Bereiche

Jede aktive Profilstichprobe wird genau einem Bereich zugeordnet. Die Anteile summieren sich vor Rundung auf 100 %. Zwei Profile je Situation; alle in hoher Grafikqualität.

| Bereich | Ruhig | Tagkampf | Nachtkampf | 300 Gegner | Map 15 |
| --- | --- | --- | --- | --- | --- |
| Grafik & Effekte | 80,4 % | 69,8 % | 71,2 % | 56,1 % | 75,7 % |
| Gegner & Spielregeln | 7,3 % | 19,5 % | 18,5 % | 31,3 % | 13,5 % |
| Zustandsabgleich | 1,6 % | 2,8 % | 2,6 % | 3,3 % | 2,5 % |
| Bedienung & Ton | 3,2 % | 3,1 % | 2,7 % | 3,8 % | 2,7 % |
| Verwaltung & Rest | 7,6 % | 4,8 % | 4,9 % | 5,5 % | 5,6 % |

Im Tagkampf beanspruchen Grafik und Effekte etwa 70 % der aktiven CPU-Arbeit. Bei 300 Gegnern sinkt dieser Anteil auf etwa 56 %, während Gegner und Spielregeln auf etwa 31 % steigen. Ein kleinerer Grafikanteil bedeutet dabei nicht, dass insgesamt weniger Grafikarbeit anfällt: Der gesamte Frame wird erheblich teurer.

## Unterkategorien

Auch diese Prozentwerte beziehen sich auf die **gesamte aktive CPU-Zeit der jeweiligen Situation**, nicht nur auf ihren übergeordneten Bereich. Werte unter 0,05 % können gerundet als 0,0 % erscheinen.

### Grafik und Effekte

| Bestandteil | Ruhig | Tagkampf | 300 Gegner | Map 15 |
| --- | --- | --- | --- | --- |
| Klassische Partikel | 0,4 % | 7,5 % | 10,8 % | 1,4 % |
| GPU-Effekte: Daten und Verwaltung | 0,2 % | 2,2 % | 2,7 % | 2,4 % |
| Geschossbilder & Leuchtspuren | 0,1 % | 4,8 % | 5,8 % | 1,0 % |
| Blutflecken & Trefferbilder | 0,1 % | 2,1 % | 2,2 % | 1,2 % |
| Bodenfeuer, Flammen & Warnflächen | 0,1 % | 0,0 % | 0,0 % | 2,5 % |
| Schatten | 0,9 % | 1,2 % | 1,2 % | 1,7 % |
| Licht, Bloom & Bildfilter | 3,9 % | 2,8 % | 1,6 % | 3,4 % |
| Nebel & Wasser | 3,8 % | 2,8 % | 3,2 % | 3,9 % |
| Boden, Felsen & Vegetation | 16,4 % | 5,9 % | 3,5 % | 4,7 % |
| Tiere in der Umgebung | 7,8 % | 2,7 % | 1,0 % | 7,1 % |
| Figurenbilder & Statusdarstellung | 0,6 % | 2,6 % | 2,8 % | 3,1 % |
| Animationen & Ausblenden | 0,2 % | 3,2 % | 4,1 % | 3,0 % |
| Gemeinsames Zeichnen: Kreise & Linien | 11,2 % | 4,5 % | 1,9 % | 4,5 % |
| Gemeinsames Zeichnen: Bilder & GPU-Layer | 14,2 % | 11,6 % | 5,9 % | 18,3 % |
| Kameras, Sortierung & Renderübergabe | 18,2 % | 12,6 % | 6,8 % | 14,4 % |
| Weitere Effektdarstellung | 2,4 % | 3,3 % | 2,5 % | 3,2 % |

### Gegner und Spielregeln

| Bestandteil | Ruhig | Tagkampf | 300 Gegner | Map 15 |
| --- | --- | --- | --- | --- |
| Gegnerentscheidungen & Bewegungssuche | 0,3 % | 3,0 % | 9,4 % | 2,7 % |
| Physik, Kollisionen & Raumabfragen | 0,3 % | 5,3 % | 9,9 % | 1,4 % |
| Geschossflug & Trefferberechnung | 0,2 % | 3,6 % | 4,8 % | 1,0 % |
| Flächeneffekte & Statusregeln | 0,3 % | 0,5 % | 0,6 % | 1,6 % |
| Spieler, Gebäude, Upgrades & Rundenregeln | 5,2 % | 5,5 % | 5,0 % | 4,9 % |
| Koordination des Spielschritts | 1,1 % | 1,6 % | 1,6 % | 1,8 % |

### Zustandsabgleich

| Bestandteil | Ruhig | Tagkampf | 300 Gegner | Map 15 |
| --- | --- | --- | --- | --- |
| Snapshots, Packen & Entpacken | 1,6 % | 2,8 % | 3,3 % | 2,5 % |

### Bedienung und Ton

| Bestandteil | Ruhig | Tagkampf | 300 Gegner | Map 15 |
| --- | --- | --- | --- | --- |
| HUD, Menüs, Eingaben & Zielhilfe | 3,0 % | 1,7 % | 1,1 % | 2,1 % |
| Tonverarbeitung im Hauptthread | 0,2 % | 1,4 % | 2,8 % | 0,6 % |

### Verwaltung und Rest

| Bestandteil | Ruhig | Tagkampf | 300 Gegner | Map 15 |
| --- | --- | --- | --- | --- |
| Speicherbereinigung | 0,9 % | 1,5 % | 2,8 % | 1,1 % |
| Messinstrumentierung | 1,6 % | 0,9 % | 0,6 % | 1,3 % |
| Allgemeine Engine-Verwaltung | 2,3 % | 1,1 % | 0,8 % | 1,4 % |
| Browser / nicht zugeordnet | 2,8 % | 1,3 % | 1,3 % | 1,8 % |

### Was die Grafikunterkategorien umfassen

Klassische Partikel sind die vom Phaser-Partikelsystem verwalteten Einzelteilchen, einschließlich ihrer im Aufrufstapel erkennbaren Zeichenarbeit. Geschossbilder und Leuchtspuren erfassen die zugehörigen spezialisierten Darstellungsfunktionen. „GPU-Effekte: Daten und Verwaltung“ meint deren CPU-Arbeit; die Ausführung ihrer Shader auf der Grafikkarte ist darin nicht enthalten.

Gemeinsames Zeichnen umfasst wiederverwendete Engine-Funktionen für Bilder, Formen, Kameras, Sortierung und Renderübergabe. Beim Zeichnen einer allgemeinen Bildsammlung ist nicht immer erkennbar, welcher Anteil auf einen Gegner, ein Umgebungsobjekt oder einen Effekt entfällt. Diese Arbeit bleibt deshalb separat. Sie wird nicht willkürlich auf „Bäume“, „Gegner“ oder „Blut“ verteilt.

Die benannten Feature-Unterkategorien sind somit die **direkt zuordenbaren Anteile**, nicht die vollständigen Kosten einer Entfernung des Features. Zum Beispiel können Bodenfeuer und Schatten zusätzlich gemeinsame Zeichenarbeit und GPU-Zeit verursachen. Speicherbereinigung wird ebenfalls separat geführt, weil der Aufrufstapel die früheren Verursacher der Speicherbelegung nicht zuverlässig identifiziert.

Bei 300 Gegnern schwankt der Partikelanteil in den beiden Wiederholungen nur zwischen 10,7 und 10,9 %, die Bewegungssuche zwischen 9,3 und 9,5 % und Physik/Raumabfragen zwischen 9,4 und 10,4 %. Das sind beobachtete Wiederholungsbereiche, keine statistischen Konfidenzintervalle.

## Welche Änderungen helfen könnten

### Weniger gleichzeitig aktive Gegner und Geschosse

Das ist der breiteste Ansatzpunkt für eine Änderung am Spieldesign. Jeder zusätzliche Gegner kann Entscheidungen, Bewegung, Raumabfragen, Treffer, Zustandsdaten und Darstellung auslösen. Seine Schüsse bringen weitere Simulation, Partikel, Leuchtspuren und Geräusche mit. Bei 300 Gegnern entfallen bereits etwa 24 % auf Bewegungssuche, Physik und Geschossberechnung zusammen; zusätzliche Darstellungskosten sind darin noch nicht enthalten.

Mögliche Änderungen sind kleinere gleichzeitig aktive Wellen, zeitlich stärker verteilte Spawns, weniger Mehrfachgeschosse und kürzere Geschosslebenszeiten. Weniger, dafür stärkere Gegner könnten einen Teil der Schwierigkeit erhalten. Das verändert jedoch das Gefühl eines Massenkampfs, die Ausweichsituationen und das Balancing. Die Tests belegen den Lastanstieg, aber keine konkrete Einsparung für eine noch nicht implementierte Designvariante.

### Die Darstellung vieler Geschosse vereinfachen

Im Tagkampf entfallen ungefähr 7,5 % auf klassische Partikel, 4,8 % auf Geschossbilder/Leuchtspuren und 2,2 % auf die CPU-Verwaltung der GPU-Effekte. Bei 300 Gegnern sind es etwa 10,8 %, 5,8 % und 2,7 %.

Ein konkreter Kandidat sind Energiebälle: [EnergyBallRenderer](../src/effects/EnergyBallRenderer.ts) erzeugt pro Ball zwei klassische Partikelemitter. Der Kern emittiert zwei Teilchen alle 16 ms, die Hülle eines alle 28 ms, zusätzlich zu Bildern und weiteren Darstellungsbestandteilen. Weniger Partikel pro Ball, kürzere Nachleuchtzeiten oder eine einfachere Hülle könnten die Kosten reduzieren, während Geschosskern, Flugbahn und Gefahrenlesbarkeit erhalten bleiben. Nicht der gesamte gemessene Partikelanteil stammt von Energiebällen, und nicht die gesamten genannten Anteile wären dadurch einsparbar.

Das wäre mein erster Kandidat für eine gezielte optische Vereinfachung unter Kampflast. Technisches Bündeln oder eine andere Darstellung könnten ebenfalls helfen, müssten aber gegen die bestehende Darstellung gemessen werden.

### Die ständig aktive Umgebung günstiger machen

In der ruhigen Szene entfallen etwa 16,4 % direkt auf Boden/Felsen/Vegetation und 7,8 % auf Umgebungstiere. Dazu kommt gemeinsame Zeichenarbeit. Die Fixture enthält insgesamt 72 Bäume, 247 Umgebungstiere und 4688 Felsen; diese Bestandszahlen sind keine Zählung gleichzeitig sichtbarer oder einzeln gezeichneter Objekte.

Weniger rein dekorative Objekte oder Tiere, seltener aktualisierte Bewegung außerhalb der unmittelbaren Aufmerksamkeit und vereinfachte Umgebungsformen könnten schon die Grundlast senken. Statische Teile zwischengespeichert zu zeichnen wäre eine technische Alternative, die die Optik möglichst erhält. Eingriffe in kollidierende Felsen oder andere Deckung würden hingegen auch das Gameplay verändern. Die direkt zugeordneten Anteile sind ein Suchhinweis, keine pauschale Einsparprognose für die ganze Umgebung.

### Grafikqualität als bereits vorhandenen Hebel nutzen

Im frischen Vergleich wurde jeweils dieselbe Kampf-Fixture abwechselnd zweimal auf High und Low ausgeführt:

| Situation | High CPU Ø | Low CPU Ø | Änderung | High → Low Frame p95 |
| --- | --- | --- | --- | --- |
| Kampf bei Tag | 13,1 ms | 10,9 ms | -17,1 % | 18,3 → 18,2 ms |
| Kampf bei Nacht | 14,3 ms | 12,3 ms | -13,5 % | 18,3 → 18,2 ms |
| Ruhe nach Kampf | 5,2 ms | 4,5 ms | -12,7 % | 6,2 → 6,1 ms |

Die mittlere CPU-Zeit sinkt in diesen Läufen um rund 13 bis 17 %. Die langsameren Kampf-Frames verbessern sich dabei kaum: Frame-p95 bleibt ungefähr 18,2 bis 18,3 ms. Weniger mittlere Arbeit beseitigt also noch nicht die Spitzen.

Low verändert ein ganzes Paket: Partikeldichte, dynamische und Geschossschatten, Vegetationsbeleuchtung, Lichtauflösung, Glow, Bloom und weitere Bildfilter. [GraphicsQuality](../src/graphics/GraphicsQuality.ts) und [SunRenderQuality](../src/effects/sunlight/SunRenderQuality.ts) definieren die Unterschiede. Daraus lässt sich nicht ableiten, dass allein Schatten oder allein Bloom 13 bis 17 % sparen.

Die vorgegebenen Spawns, das Layout, die Ausrüstung und die Messdauer sind gleich; Treffer sowie gleichzeitig lebende Gegner/Geschosse entwickeln sich während der Simulation unterschiedlich. Das ist ein Vergleich des gesamten Qualitätspakets im laufenden Szenario, kein Test identischer Einzelbilder. Die Wiederholungen zeigen einen konsistenten CPU-Vorteil, aber keinen isolierten kausalen Effekt jeder einzelnen Einstellung.

Die GPU-Abfragen fallen im Tagkampf unter Low sogar höher aus: 3,4 → 5,1 ms; nachts 3,5 → 4,9 ms. Die Ursache ist mit diesen Daten nicht isoliert. Deshalb ist der CPU-Vorteil kein Beleg für eine entsprechende GPU-Einsparung. Auf einer deutlich schwächeren Grafikkarte könnte die Bewertung anders ausfallen.

### KI und Kollisionen gezielt unter hoher Last reduzieren

Bei 300 Gegnern liegen Bewegungssuche und Physik/Raumabfragen zusammen bei etwa 19,3 %. Denkbar sind seltener erneuerte Zielentscheidungen, über mehrere Frames verteilte Arbeit oder weniger aktive Interaktionen in dichten Gruppen. Dafür müsste geprüft werden, welche Entscheidungen gefahrlos älter sein dürfen. Zu stark reduzierte Aktualisierung kann Reaktionszeit, Wegfindung oder Trefferverhalten sichtbar ändern. Die hier gemessenen Anteile enthalten keine Kosten der separaten Flowfield-Worker.

### Kleinere Bereiche nachrangig behandeln

Blutflecken und Trefferbilder liegen im aktuellen Stand bei etwa 2,1 bis 2,2 % in den beiden betrachteten Kampflasten. Ton liegt bei etwa 1,4 bis 2,8 %, HUD/Eingaben bei etwa 1,1 bis 1,7 %. Diese Bereiche können lokale Probleme enthalten, sind nach den vorliegenden Profilen aber keine erste Wahl für einen großen allgemeinen Gewinn.

Der Zustandsabgleich liegt bei etwa 2,8 bis 3,3 %. Der Runner nutzt LocalHost: Er erfasst lokale Snapshot-Erzeugung, Packen und Entpacken, aber keinen echten WebRTC-Transport und keine zusätzlichen entfernten Spieler. Das ist keine Aussage über die gesamten Kosten einer Mehrspielerpartie.

## Gemessene CPU-Phasen als Gegenprüfung

Die folgenden Zeiten stammen direkt aus bestehenden Messspannen der Läufe ohne Sampling-Profiler. Sie beantworten, in welchem Abschnitt des Frames die CPU arbeitet. Diese zeitlichen Phasen sind eine zweite Sicht auf dieselbe Arbeit und dürfen nicht zu den vorherigen Feature-Anteilen addiert werden.

| CPU-Phase | Ruhig | Tagkampf | 300 Gegner | 500 Gegner |
| --- | --- | --- | --- | --- |
| Spielschritt des Hosts | 0,3 ms | 2,9 ms | 10,4 ms | 24,5 ms |
| Nachgelagerte Darstellung | 0,5 ms | 2,0 ms | 5,4 ms | 9,4 ms |
| Engine-Update inkl. Partikeln und Physik | 0,1 ms | 1,7 ms | 6,9 ms | 19,2 ms |
| Nachbereitung des Updates | 0,0 ms | 0,3 ms | 0,7 ms | 1,4 ms |
| Zeichnen und Renderübergabe | 2,8 ms | 5,5 ms | 8,4 ms | 11,1 ms |
| Übrige Arbeit im Spiel-Callback | 0,6 ms | 0,7 ms | 0,9 ms | 1,1 ms |

Der Host-Spielschritt enthält neben Regeln auch Aufrufe für Darstellung und Ton. Das Engine-Update enthält unter anderem Partikel und Physik. Deshalb wäre es falsch, die erste Zeile vollständig „KI“ und die Engine vollständig „Overhead“ zu nennen. Kleine Differenzen entstehen durch Messfenstergrenzen; verschachtelte Elternspannen wie das gesamte Scene-Update werden hier nicht nochmals addiert.

## Messbasis und Grenzen

- Windows, Ryzen 7 5800X, RTX 3080, rund 32 GiB RAM, Chrome 154.0.8037.98, 1920 × 1080, DPR 1, keine CPU-Drosselung.
- Unveränderter archivierter Produktionsbuild unter `build/perf-six-hour-20261008/round2/site`. Die vorangegangenen Änderungen und die archivierten Einstiegsdateien stimmen mit den erfassten Hashes überein; der aktuelle Commit enthält diese Optimierung.
- 14 neue Browserläufe: acht mit CPU-Sampling für die Bereichszuordnung und sechs ohne Sampling für ruhige Szene, Tagkampf, Nachtkampf und Erholung. Alle abgeschlossen, keine protokollierten Browserfehler oder Konsolenwarnungen.
- Ergänzend drei vorhandene Läufe je 100-, 300-, 500-Gegner- und Map-15-Probe desselben Builds. Die 100-Gegner-Probe stammt aus dem längeren Review-Parcours; die anderen drei aus gesonderten Läufen. Unterschiedliche Vorgeschichte und Aufwärmzeiten bleiben ausdrücklich erhalten.
- Profile: zwei High-Läufe je ruhige Szene, Kampfparcours, 300 Gegner und Map 15. Der Kampfparcours liefert getrennte Fenster für Tag, Nacht und Erholung. Die Boss-Unterphasen überlappen das Gesamtfenster und erhalten deshalb keine eigenständige CPU-Prozentaufteilung.
- Der vorhandene Runner wurde für die Analyse lokal so ergänzt, dass er nach Ende der Messung alle Stichproben samt Aufrufvorfahren exportiert. Der Spielbuild blieb unverändert. Die Zuordnung erfolgt über Sourcemaps, Funktionsherkunft und den nächsten passenden Eigentümer im Aufrufstapel; gemeinsame Funktionen bleiben gemeinsame Kosten.
- Profiling erzeugt selbst zusätzliche Arbeit und kann den Verlauf eines lebenden Szenarios beeinflussen. Die Prozentanteile sind deshalb Näherungen; die absoluten Framezeiten stammen ausschließlich aus Läufen ohne Sampling. Die normale Performance-Lab-Instrumentierung bleibt dort aktiv und ist ebenfalls nicht kostenlos.
- Erfasst sind Hauptthread und gesamte abgefragte GPU-Renderphase. GPU-Kosten einzelner Features, Audio-Threads, Worker, echter Netzwerkverkehr, Ladezeiten und Speicherbelegung pro Feature sind damit nicht aufgeschlüsselt. Aus einer RTX-3080-Messung folgt keine Aussage für jedes Zielgerät.

### Nachprüfbare Artefakte

Alle neuen Rohdaten und Auswertungsskripte liegen in `build/perf-breakdown-20261009/`:

- `profile-*/suite.json`: vollständige Profile und Lastbelege.
- `profile-breakdown.json`: Mittelwerte, Wiederholungsbereiche und Stichprobenabdeckung.
- `profile-assignments.json` und `classify-profiles.mjs`: einzelne Zuordnungen und ihre Regeln.
- `timing-light/suite.json`, `timing-combat/suite.json`: neue Messungen ohne Sampling.
- `timing-summary.json` und `timing-summary.mjs`: arithmetische Mittel und direkte CPU-Phasen, einschließlich der älteren Lastproben.
- `audit.json`, `provenance.json`: Laufstatus, Lastmerkmale und Hashprüfung.

Der bestehende [Performance-Vertrag](ai/performance.md), [RuntimeFrameProbe](../src/scenes/arena/RuntimeFrameProbe.ts), [ArenaRuntimeProfiler](../src/scenes/arena/ArenaRuntimeProfiler.ts) und die [Szenariodefinitionen](../src/debug/performanceLab/scenarios.ts) bestimmen Messgrenzen und Last. Diese Analyse erweitert keine dauerhaften Projektverträge.

Knowledge writeback: No durable project knowledge discovered.
