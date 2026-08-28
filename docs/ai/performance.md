# Performance

## Geltungsbereich

Performance-Regeln beschreiben dauerhafte Hotpath-Grenzen und Messdisziplin. Einzelne Benchmarkwerte, Gerätebeobachtungen, Map-Größen und Balance-Ergebnisse gehören in Tests, authored Daten oder das Balance-Lab, nicht in diese Seite.

## World- und Renderkosten

Die World-Geometrie wird einmal für die konkrete World aufgelöst und über WorldMetrics, Indizes und Layout-Fingerprint gebunden. Renderer und Systems dürfen keine parallelen Geometriequellen oder globalen Metrics-Spiegel als versteckte Ersatzquelle aufbauen.

Statische, große Flächen werden chunked und viewportnah gestreamt. Chunk- und Surface-Implementierungen sollen:

- Arbeit nur für relevante Resident-Bereiche einplanen;
- Bake/Reveals atomar sichtbar machen;
- vorhandene Texturen, Container und Buckets recyceln;
- Dirty-Markierungen zusammenfassen;
- beim Wechsel der World alle Resident-Ressourcen lösen.

Die Verträge dafür liegen bei [ChunkedRenderSurface.ts](../../src/arena/chunks/ChunkedRenderSurface.ts), [GroundSurfaceStreamer.ts](../../src/arena/chunks/GroundSurfaceStreamer.ts), [RockOverlayStreamer.ts](../../src/arena/chunks/RockOverlayStreamer.ts) und im Test [ChunkedRenderSurface.test.ts](../../tests/ChunkedRenderSurface.test.ts).

## Verifizierte Phaser-Fallen

Für Phaser 4.2.1 gelten bei großen World-Darstellungen besonders diese drei Grenzen:

- Ein `Layer` ist eine eigene Display-Liste, deren Renderer seine Kinder selbst durchläuft. Die Camera-Culling-Stufe filtert die Scene-Liste; sie macht die verschachtelten Layer-Kinder nicht automatisch zu einer viewport-indexierten Liste.
- Scene- und Layer-Listen bleiben listenförmige Renderarbeit: Kamera-Prüfung, `willRender` und bei Bedarf Depth-Sort laufen über die enthaltenen Einträge. Viele dauerhaft versteckte Objekte kosten daher weiterhin Arbeit, auch wenn nur wenige sichtbar sind.
- `Graphics` hält Zeichenbefehle und zerlegt komplexe Pfade bei der WebGL-Darstellung in Geometrie. Ein eigenes `dirty`-Flag spart höchstens unnötigen Command-Aufbau im Anwendungscode; es ersetzt weder das Caching stabiler Geometrie noch das Baken statischer Formen in eine Textur. Häufig wechselnde Geometrie sollte dagegen nicht in jedem Frame neue Texturen erzeugen.

## Hotpaths und Allokationen

Update-, Sichtbarkeits-, Kollisions- und Snapshot-Pfade dürfen nicht unkontrolliert temporäre Objekte oder vollständige World-Scans erzeugen. Vorhandene ArenaCell-, Point-, Rock-, Obstacle- und LightOccluder-Indizes werden wiederverwendet und sind an die aktuelle World-Geometrie gebunden.

Eine Optimierung bleibt korrekt, wenn sie World-Revision, Cleanup, newest-state-Semantik und host-authoritative Ergebnisse unverändert lässt. Premature Caches oder globale Mutable-Konfiguration sind keine Abkürzung um explizite World-Kontexte.

## Worker- und Main-Thread-Grenzen

Teure Berechnungen, insbesondere Flowfield-Arbeit, dürfen über die bestehende Worker-Grenze laufen. [FlowFieldCoordinator.ts](../../src/systems/flowfield/FlowFieldCoordinator.ts) bleibt der fachliche Einstiegspunkt; Worker-Ergebnisse müssen zur passenden World-Geometrie und zum passenden Lebenszyklus gehören.

Worker und Main Thread dürfen keine konkurrierenden Definitionen von WorldMetrics oder Layout pflegen. Nach World-Ende werden Jobs, Listener und Resultate ignoriert oder gelöst.

## Kamera, FX und Qualität

Camera-Feedback, Post-FX und Partikel sind Presentation-Kosten. [GraphicsQuality.ts](../../src/graphics/GraphicsQuality.ts) darf Effekte, Filter, Renderauflösung und Bewegungsdarstellung steuern, aber keine Gameplay-Regel, Collision oder Trefferentscheidung verändern.

Der zentrale CameraFeedbackController verhindert, dass mehrere Systeme dieselbe Kamera direkt verändern. FX-Objekte brauchen eine klare Lebensdauer und müssen beim Scene-/World-Teardown freigegeben werden.

## Runtime ohne Presentation

Host-Simulation darf ohne lokale Renderer laufen. [ArenaBuilder.ts](../../src/arena/ArenaBuilder.ts) kann Runtime-/Physik-Proxies ohne visuelle World-Objekte erzeugen; diese Trennung ist auch für Headless-Balance- und Testpfade maßgeblich.

Ein nicht rendernder Host darf keine Presentation-Kosten bezahlen, die für seine autoritative Simulation nicht erforderlich sind.

## Messen statt dokumentieren

Wenn eine konkrete Performancefrage entsteht:

1. die betroffene Phase und World-/Activity-Lifetime bestimmen;
2. vorhandene Indizes, Streamer, Worker- und Quality-Grenzen instrumentieren;
3. Korrektheit und Cleanup mit passenden Contract-Tests sichern;
4. Ergebnisse als reproduzierbaren Test, Report oder Benchmark-Artefakt ablegen;
5. nur eine neue Dokumentationsregel ergänzen, wenn mehrere Systeme eine stabile, nicht offensichtliche Grenze brauchen.

Contract-Tests schützen dabei Invarianten und Lebenszyklen, nicht hardwareabhängige Laufzeitwerte.

## Verifikation

Nach sichtbaren Phaser-Änderungen npm run build ausführen. Für reine Performance- oder Systemänderungen den passenden Test und bei mehreren Modulen npm run check verwenden. Keine Browserprüfung starten, wenn sie nicht ausdrücklich beauftragt wurde.

## Maßgebliche Tests

- [tests/ChunkedRenderSurface.test.ts](../../tests/ChunkedRenderSurface.test.ts)
- [tests/WorldMetricsScopeContracts.test.ts](../../tests/WorldMetricsScopeContracts.test.ts)
- [tests/WorldPresentationContracts.test.ts](../../tests/WorldPresentationContracts.test.ts)
- [tests/PlayerTreeRuntimeContracts.test.ts](../../tests/PlayerTreeRuntimeContracts.test.ts)
