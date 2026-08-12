# Performance

Performance-Arbeit beginnt mit einer Messung unter vergleichbarer Map, Rolle, Spielerzahl, Qualitätsstufe und Spielsituation. Einzelne historische Profilwerte und abgeschlossene Optimierungen gehören nicht in diese Wissensbasis.

## Qualitätsprofile

GraphicsQualityController verwaltet high, medium und low. Die Einstellung ist lokal und darf nur Darstellungskosten beeinflussen: Partikel, Filter/Post-FX, Schatten, Lightmap-Auflösung und Lichtbudgets. Simulation, Physik, Treffer, Gameplay, Netzwerktakt und replizierter Zustand bleiben identisch. Kritische Telegraphen und Zustandsanzeigen dürfen auf low nicht verschwinden.

Neue Emitter und Filter über die bestehende Qualitätsinfrastruktur registrieren. visible = false reicht nicht, um Updatekosten zu stoppen; für deaktivierte Effekte auch Emission/Pool und active korrekt behandeln. Szeneweite Pools am Round-Teardown auf einen Grundstock trimmen.

## Dauerhafte Hotpath-Regeln

- Statische Arena- und Menüflächen backen, wenn sie unveränderlich sind. Dynamische Hindernisse, Blut und Gameplay-Visuals bleiben separat, damit Zerstörung und Replikation nicht gegen einen Bake arbeiten.
- Segmentbasierte Hindernisprüfungen laufen über die eine Round-Instanz von ArenaObstacleIndex; nicht pro Kandidat getBounds() aufrufen. Der Index darf konservativ filtern, aber keinen echten Treffer auslassen, und wird bei Geometrieänderungen synchron invalidiert.
- Homing- und Zielsuche erst bewerten, dann Sichtlinie für die besten Kandidaten prüfen. Keine per-Gegner-Flowfields oder temporären Arrays erzeugen, wenn die bestehenden Services/Callbacks dieselbe Information liefern.
- Mehrere Coop-Flowfields dürfen gemeinsame Topologie teilen, nicht aber unterschiedliche Zielmengen oder Clearance-Annahmen vermischen.
- Häufige homogene Visuals poolen. Physik-/Gameplay-Objekte nur poolen, wenn der Reset vollständig und messbar günstiger ist.
- Frame-Getter auf dem Client dürfen nicht jedes Mal localStorage lesen, JSON parsen oder Upgrade-Profile neu auflösen; bestehende Referenz-/Round-Caches verwenden und explizit invalidieren.
- Dirty-Flags und einmal-pro-Frame-Rebuilds für große UI-/Overlay-Bäume nutzen; keine komplette Baumzerstörung pro Klick.

## Messworkflow

T öffnet PerformanceDiagnosticsOverlay. Der Profiler trennt Frame-Delta, Scene-Update, Render-Abgabe, Netzwerk, Host-Simulation, Client-Synchronisierung und Visual-Buckets. Render-Abgabe ist CPU-Zeit um Phaser-Render-Ereignisse, nicht automatisch GPU-Zeit.

Für Ursachenzuordnung den vorhandenen Ablationsmodus verwenden: immer baseline → Kategorie → baseline, gleiche Map und stabile Spielsituation. ΔgameStepMs/ΔrenderSubmitMs über mehrere Zyklen auswerten, nicht FPS-Sprünge oder zwei verschiedene Ablationen direkt vergleichen. Ablation schaltet Darstellung ab; Host-Logik, Physik und Netzwerk laufen weiter.

Chrome DevTools nur ergänzend und nicht gleichzeitig mit dem In-App-Profiler verwenden. P95/P99 und Slow-Frame-Anteil sind für Hänger aussagekräftiger als ein Mittelwert. Report-Schema und Messfelder leben in src/scenes/arena/ArenaRuntimeProfiler.ts und src/scenes/arena/PerformanceAblation.ts; nicht in Markdown nacherzählen.

## Verifikation

Geeignete Tests sind tests/ArenaObstacleIndex.test.ts, tests/GraphicsQualityAndPerformance.test.ts, tests/PerformanceAblation.test.ts, tests/ProjectilePerformance.test.ts und tests/CoopDefenseProfileMemo.test.ts. Tests sollen Invarianten und Messverträge schützen, nicht eine bestimmte Hardware- oder Balancezahl festschreiben.
