# Map 6: Prüfung und Umsetzung der Performance-Analyse

Stand: 8. September 2026. Ausgangsstand der Arbeitskopie: `d1822177`.
Grundlage: [Performance-Analyse](FRAGDACHSE_Map6_Performance_Analyse_2026-09-08.md) und Prüfung des aktuellen Quellcodes.
Die Trace-Zeitwerte wurden aus der Analyse übernommen, nicht erneut aus den Originalaufnahmen berechnet.

## Bewertung

Die Priorisierung ist nachvollziehbar: Wiederholte Konfigurationsauflösung und Shader-Erstnutzung
haben konkrete Codepfade. Die Projektil-Zielsicht erlaubt einen begrenzten, sicheren Fix.
Die Aussagen zu GC beschreiben eine Korrelation; sie belegen weder ein Speicherleck noch einen
einzigen Verursacher. Für einen umfassenden Rendering-Umbau oder andere Rauchdichten fehlt
weiterhin ein kontrollierter Vergleich.

## Umgesetzt

### 1. Loadouts und Restore-Tools

- [CoopDefenseLoadoutModifiers.ts](../../src/loadout/CoopDefenseLoadoutModifiers.ts) bereitet die
  Descriptor-Reihenfolge einmal vor und gruppiert nach Konfigurationsart und Slot. Die bisherigen
  Modifier-Stufen und ihre Reihenfolge bleiben erhalten.
- Effektive Konfigurationen werden anhand der Basis-Konfiguration und der unveränderlichen
  Additiv-/Prozent-Buckets wiederverwendet. Das funktioniert auch bei neuen kleinen Totals-Wrappern
  in Utility-Abfragen. Veränderliche Eingaben werden weiterhin neu aufgelöst. Die Validierung
  bleibt auf dem Auflösungspfad erhalten.
- [ArenaLifecycleCoordinator.ts](../../src/scenes/arena/ArenaLifecycleCoordinator.ts) prüft den
  committed Snapshot und Spielmodus vor der Host-Loadout-Auflösung. Neue Commits oder ein
  Moduswechsel führen zu einer neuen Auflösung. Ressourcen-, Utility- und Combat-Reconciliation
  laufen weiter; dynamische Buffs werden nicht eingefroren.
- [CoopDefensePlayerModifierSystem.ts](../../src/systems/CoopDefensePlayerModifierSystem.ts)
  behält das Runtime-Modell bei semantisch unveränderten Builds. Die Signaturprüfung erkennt
  auch Änderungen innerhalb desselben Eingabeobjekts.
- [ConstructionWorldRuntime.ts](../../src/world/ConstructionWorldRuntime.ts) liefert eine
  World-lokale Build-Revision für die Restore-Projektion. Frische, gleichwertige Lobby-Snapshots
  erhöhen diese Revision nicht. [PersistentBaseWorldMaterializer.ts](../../src/world/PersistentBaseWorldMaterializer.ts)
  prüft sie vor der Restore-Tool-Auflösung. Ein Wechsel der Player-Zuordnung eines Besitzers
  invalidiert die Projektion ebenfalls.

### 2. Shader-Warmup

[GpuVfxSystem.ts](../../src/effects/gpu/GpuVfxSystem.ts) bereitet die vorhandenen SpriteGPU-Lanes
ab Szenenaufbau über den tatsächlichen `SubmitterSpriteGPULayer.run()` vor, jeweils eine Lane pro
Render-Frame. Die bereits geprimten Member erreichen damit ProgramManager, Shader und VAO.
Deaktivierte Farbschreibzugriffe und ein kleiner Scissor verhindern sichtbare Probeausgaben;
es entstehen keine Gameplay-Projektile oder Effektereignisse.

Die vorhandene lokale Ladefreigabe und der Lobby-Reveal warten auf das Ende des Warmups.
Ein Host ohne lokale World-Präsentation wartet nicht darauf. Bei einem Rendererfehler wird
einmal gewarnt und der normale Renderpfad verwendet, damit die Ladefreigabe nicht hängen bleibt.
Listener werden bei Abschluss und Teardown entfernt. Der Warmup verschiebt Initialisierungsarbeit
in die Vorbereitung und kann diese entsprechend verlängern.

### 3. Projektil-Zielsicht

[WorldProjectileRuntime.ts](../../src/projectile/WorldProjectileRuntime.ts) überspringt den
Kollisions-Zielaufbau, wenn nach Barrier- und Deflection-Stage keine aktiven Projektile mehr
vorhanden sind. Die Live-Iteration und bestehende Trefferreihenfolge bleiben erhalten.

[WorldCombatGameplayBinding.ts](../../src/world/WorldCombatGameplayBinding.ts) hält die vereinigten
Basiszell-Bounds einschließlich Mittelpunkt und Radius vor. Die bestehende
`BaseManager.getObstacleGeneration()` invalidiert sie bei relevanten Basisänderungen.
Spieler, Gegner, Zug und platzierbare Bauten bleiben dynamische Ziele. Ein umfassender
Fels- oder Spatial-Index-Umbau wurde nicht vorgenommen.

### 4. Messlücken

In [ArenaRuntimeProfiler.ts](../../src/scenes/arena/ArenaRuntimeProfiler.ts) lagen zwei konkrete Fehler:

- `record()` setzte den Render-Framezähler jedes Mal zurück. Dadurch erreichte der GPU-Timer
  seinen Abfrage-Frame nie. Der Reset erfolgt jetzt beim Aufnahmestart; aktive Queries werden
  beim Beenden geschlossen.
- Der Draw-Call-Hook erfasste nur `drawElements`. Er zählt jetzt auch Phasers
  `drawInstancedArrays`; Batch-Flushes bleiben eine getrennte Kennzahl.

GPU-Ergebnisse werden weiterhin erst nach Verfügbarkeit abgefragt; das entspricht dem
[Khronos-Timer-Vertrag](https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/).

## Bewusst zurückgestellt

- **GC:** Die belegten Konfigurations- und Geometrie-Allokationen wurden reduziert. Ein globaler
  Pooling-Umbau wäre aus diesen Daten nicht begründet.
- **Graphics/Beleuchtung:** Die vorhandenen Ablationen für HUD, Vektorformen, Licht und Schatten
  reichen für einen gezielten Folgevergleich. Es gibt keinen hinreichenden Beleg, um jetzt
  Beleuchtung oder sämtliche Graphics-Objekte umzubauen.
- **Raketenrauch:** Kapazitätsdrops sind kein GPU-Zeitmaß. Poolgröße, Rauchdichte und Qualität
  bleiben bis zu einem kontrollierten Vergleich unverändert.

## Verifikation und verbleibende Messung

- `npm run check`: 3036 Core-Tests, 33 Architekturtests und Produktionsbuild erfolgreich.
- `npm run test:integration`: 332 Tests erfolgreich.
- `PerformanceAblation.test.ts`: 15 Tests erfolgreich.
- `ProjectilePerformance.test.ts`: 14 Tests im isolierten Lauf erfolgreich.
  Unter paralleler Gesamtprüfung überschritt ein Zeitbudget zunächst knapp sein Limit;
  isoliert lagen die drei Kollisions-Mediane bei 309–326 ms bei einem Limit von 900 ms.
  Das ist kein Vorher-/Nachher-Vergleich und keine Aussage über Browser-FPS.
- `git diff --check`: erfolgreich. Vite meldet weiterhin zur Laufzeit aufzulösende Font-URLs.

Keine Browserprüfung und kein neuer Gameplay-Trace wurden gestartet. Die tatsächliche
Shader-/GPU-Wirkung und ein FPS-Gewinn sind damit noch nicht gemessen. Der nächste sinnvolle
Vergleich verwendet Map 6 mit gleichem Loadout und denselben Einstellungen im Produktionsbuild:
GPU-Samples und Draw Calls zuerst auf Plausibilität prüfen, dann Framezeiten, Shader-Erstnutzung,
GC und die vorhandenen Rendering-Ablationen vergleichen.
