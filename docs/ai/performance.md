# Performance und Grafikqualität

Grafikqualität ist eine lokale, sofort wirksame Einstellung. `GraphicsQualityController` besitzt die Profile `high`, `medium` und `low`; `localPreferences` persistiert die Auswahl. Sie wird weder repliziert noch in autoritative Simulation, Physik, Trefferprüfung oder Netzwerktakt eingespeist. Ein Host hat deshalb weiterhin seine zusätzliche Simulations- und Netzwerkbelastung, unabhängig von der gewählten Darstellung.

## Visuelle Budgets

Die Profile steuern zentral:

- Partikelmengen und laufende Emissionsraten nach `critical`, `standard` und `decorative`;
- Lightmap-Auflösung, maximale Lichter und Verdeckungs-Slots;
- Dichte statischer Schatten-Layer und Projektilschatten;
- interne und externe Phaser-Filter.

Der Controller wird am Anfang von `ArenaScene.create()` an die Scene gebunden. Danach erzeugte ParticleEmitter werden automatisch als `standard` erfasst. Abweichende Bedeutung wird am vorhandenen Emitter gesetzt oder beim Effect-Helper angegeben. `critical` ist für Gameplay-Lesbarkeit reserviert, `decorative` für gefahrlos entfallende Atmosphäre. Neue Qualitätszweige dürfen keine Gameplay-Konfiguration duplizieren.

Filter werden über `utils/phaserFx.ts` registriert, damit ein Profilwechsel bestehende Handles sofort aktiviert oder deaktiviert. `LightingSystem` und `ShadowSystem` abonnieren das Profil und bauen nur ihre lokalen Renderressourcen neu auf; Spielzustand bleibt erhalten.

## Lobby-UI

Phaser-Canvas-Text wird bei `setText()`, `setStyle()` und `setColor()` neu gerastert und als
Textur hochgeladen. Lobby-Panels synchronisieren deshalb unveränderte Netzwerkzustände nicht
pro Frame, sondern nur bei einer geänderten Zustandssignatur. Aim-, Scope-, Placement- und
Charge-Vorschauen lösen außerhalb einer aktiven Arena keine Loadout-Konfiguration auf; ohne
Round-`LoadoutManager` würde dieser Fallback sonst wiederholt persistierte Auswahl- und
Coop-Profildaten lesen.

## Statischer Boden als gebackene RenderTexture

Der Dirt-Boden ist rein statisch und macht den Großteil der Display-Liste aus (mehrere tausend Kacheln). `ArenaBuilder.bakeDirt()` erzeugt die Kacheln mit Autotiling, backt sie einmalig in eine arenagroße RenderTexture (interne Kamera um den Arena-Offset gescrollt, damit weltpositionierte Bilder korrekt landen) und verwirft danach die Einzel-Images. So läuft pro Frame ein Objekt statt tausender durch Renderwalk und Transform-Schritt; die Kosten sind fix und qualitätsunabhängig. Zerstörbare Felsen bleiben bewusst außen vor und dynamisch.

`ArenaBuilderResult` führt deshalb `dirtLayer` (das gebackene Objekt, für Teardown) und `dirtStamps` (die Kachel-Geometrie) statt einer Image-Liste. Der `ArenaTerrainColorSampler` zeichnet seine CPU-Canvas aus `dirtStamps`, nicht aus Live-Objekten – wer weitere statische Layer backt, muss deren Geometrie ebenso für den Sampler erhalten.

## Projektil-Hotpath und Pooling

Host-Systeme erhalten die aktiven Projektile als stabile `ReadonlySet`-Sicht und IDs werden
über einen gepflegten Index aufgelöst. Projektil-Renderer werden beim zentralen
Projektil-Cleanup freigegeben; deshalb dürfen sie nicht zusätzlich pro Frame aktive
ID-Arrays und Orphan-Sets aus der gesamten Projektilmenge materialisieren. Der replizierte
Projektil-Snapshot wird erst beim tatsächlichen Network-Tick gebaut.

Pooling gehört an homogene, kurzlebige Visuals: Rocket-Smoke verwendet einen gemeinsamen,
vorreservierten `ParticleEmitter`, dessen Partikel Phaser intern wiederverwendet. Die
autoritativen Physik-Shapes werden bewusst nicht gepoolt. Rectangle-/Circle-Varianten,
projektilspezifische Arcade-Collider, World-Bounds-Listener und umfangreicher optionaler
Gameplay-State würden einen vollständigen und fehleranfälligen Reset erfordern, während
ihre Spawn-Allokation nicht im gemessenen per-Frame-Hotpath liegt.

## Lokaler Messworkflow

`T` öffnet die Performance-Diagnose. Die Live-Ansicht arbeitet ohne Telemetrie. Eine Aufzeichnung wird manuell gestartet und gestoppt, ist auf 30 Minuten begrenzt und kann danach als JSON heruntergeladen werden. Der Export enthält Browser-/Renderer-Metadaten und Qualitätswechsel, aber keine Raumcodes oder Spieler-IDs.

Messfenster trennen Frame-Delta, Scene-Update, CPU-Render-Abgabe, Netzwerk-Update/-Flush, Visuals sowie Host-Simulation beziehungsweise Client-Synchronisierung. Dadurch darf ein langsamer Host nicht vorschnell der Grafik zugeschrieben werden. Die Render-Abgabe misst CPU-Zeit zwischen Phasers Pre-/Post-Render-Ereignissen, nicht die vollständige GPU-Zeit, und stammt aus dem vorherigen Frame, weil `update` vor `render` läuft.

## Verträge des Report-Schemas

Nur Werte, die sich während einer Messung nicht ändern können, dürfen in den Reportkopf. `environment` wird deshalb bei `startRecording()` erfasst, nicht beim Export; Rolle, Qualität, Modus und Map stehen pro Fenster und gebündelt in `recordingScope`. Ein Kopf, der beim Klick auf Export gefüllt wird, beschreibt sonst den Zustand des Klicks und nicht den der Messung. `recordedWindows` überlebt den Export, ein zweiter Export derselben Messung ist also möglich und an gleicher `recordingId` sowie gleichem Dateinamen erkennbar.

`fps` folgt ab Schema v3 aus dem mittleren ungeglätteten `rawDeltaMs` und beschreibt nur
die tatsächlich erfassten Frames. `record()` läuft in Lobby, Arena und beendetem Match;
ein Phasenwechsel schließt das aktuelle Fenster. Fenster ohne `coveragePercent` nahe 100
oder mit großem `maxSampleGapMs` weisen auf pausierte/fehlende Scene-Updates oder einen
inaktiven Tab hin und tragen keine belastbare Bildrate.

Phaser 4 führt für WebGL keinen Draw-Call-Zähler: `drawCount` gibt es nur am `CanvasRenderer`, und der `RenderNodeManager` bietet nur einen Debug-Graphen für einen Einzelframe. `drawCallCount` entsteht deshalb aus Wrappern auf den Zeichenmethoden des GL-Kontexts, die als eigene Eigenschaft die Prototyp-Methode verdecken. Sie liegen nur an, solange die Diagnose offen ist oder eine Aufzeichnung läuft, und werden per `delete` wieder entfernt; im normalen Spiel ist der Kontext unberührt. Ein Wert von 0 kann daher auch bedeuten, dass nicht gezählt wurde. Wie die Render-Abgabe beschreibt der Wert den vorherigen Frame.

Objekte pro Draw-Call ist die Kennzahl für Batching. Bricht sie ein, während die Objektzahl gleich bleibt, wechseln zu viele Texturen oder Blend-Zustände innerhalb der Szene; große statische Flächen gehören dann in eine gemeinsame Textur oder einen GPU-Layer.

Das CPU-Budget zerfällt in Phaser-SceneManager, Renderer-Setup, Render-Abgabe und einen
echten unbekannten CPU-Rest. Innerhalb von `ArenaScene.update()` werden Prelude,
Netzwerk-Update, Scene-/Lobby-Zustand, Rollen-Schritt, Nachbereitung, Visuals, Schatten,
Licht, Netzwerk-Flush und Diagnose unterschieden. `visualStepMs` zerfällt lückenlos in
`visualCameraMs`, `visualEnemyMs`, `visualEffectsMs`, `visualAimMs` und `visualHudMs`.
Die `fire*`- und `host*`-Werte sind Teilkosten von `roleStepMs` und dürfen nicht erneut
zum Update-Budget addiert werden. Positive `overaccounted*`-Werte zeigen überlappende
oder zeitlich um einen Frame versetzte Messungen und müssen bei der Interpretation
berücksichtigt werden.

Vergleiche nach Möglichkeit dieselbe Map, Rolle, Spielerzahl und Kampfsituation. Erst ein Profil wechseln oder Code ändern, dann ein neues Messfenster beziehungsweise eine neue Aufzeichnung erzeugen. P95/P99 und der Anteil langsamer Frames sind für sporadische Hänger aussagekräftiger als nur der Mittelwert.

## Trace-Schema v4

Schema v4 zeichnet alle Scene-Phasen (`lobby`, `arena`, `terminated`) auf. `rawDeltaMs`
ist die ungeglättete Zeit zwischen Phaser-Schritten und die Grundlage für `fps`, P95/P99
und Slow-Frame-Anteile; `deltaMs` und `smoothedFps` bleiben nur als Vergleich mit Phasers
geglätteter Spielzeit erhalten. `frameSeries` bewahrt die einzelnen Frames als
spaltenbeschriebene Zahlenreihen auf. `contextChanges` ordnet ihnen Phase, Rolle,
Loadout, Aim-/Scope-/Placement-Zustand, Fokus und Rundendauer zu, ohne diese
Zeichenketten in jedem Frame zu duplizieren.

`detailTimings` und `detailCounts` zerlegen insbesondere Aim/Scope, Client-Snapshot-
Verarbeitung und Lighting. Bei Lighting sind Queue-Aufbau, direkte und verdeckende
Lichter, Schattengeometrie, RenderTexture-Befehle, Licht-Presets, Lightmap-/Scratch-
Pixel und Schattenquads getrennt. Diese CPU-Zeiten messen den Aufbau der Phaser-
Command-Buffer; RenderTexture-Befehle werden erst im Render-Schritt ausgeführt. Der
asynchron und nur stichprobenartig verwendete
`EXT_disjoint_timer_query_webgl2`-Timer liefert deshalb zusätzlich die GPU-Zeit des
gesamten Frames, sofern Browser und GPU ihn bereitstellen. Er wird nie blockierend
ausgelesen.

WebGL-Wrapper erfassen während einer Aufzeichnung neben Draw-Calls auch
Framebuffer-Binds, echte Programmwechsel sowie Textur- und Buffer-Uploads. Speicher-
Samples (`performance.memory`) und GC-Einträge sind Browser-abhängig und dürfen leer
sein. `instrumentation.profilerRecordMs` macht die Eigenkosten der Aufzeichnung
sichtbar.

Schema v4 betrachtet das gesamte Frame-Budget. Die Phaser-Core-Ereignisse trennen den
vollständigen CPU-Spielschritt, SceneManager-Update, Scene-Systeme/Plugins, Renderer-Setup
und Render-Abgabe. Diese vollständigen Werte gehören jeweils zum vorherigen abgeschlossenen
Frame, weil `ArenaScene.update()` vor `poststep` und `postrender` läuft. `betweenFramesMs`
ist Zeit zwischen zwei Spielschritten und enthält typischerweise normales VSync-/FPS-Limit-
Warten; sie ist für sich allein kein Optimierungsproblem. `unaccountedFrameMs` bezeichnet
dagegen nur CPU-Zeit innerhalb des gemessenen Phaser-Schritts, die keinem bekannten
Lifecycle-Abschnitt zugeordnet ist.

Der Host-Schritt ist in Gegner-KI, Spielersysteme, Physik, Kampf/Projektile, Explosionen,
Flächeneffekte, Welt-/Visual-Synchronisierung, HUD, Effekt-Flush und Snapshot-Bau geteilt.
Der Client behält seine Aufteilung nach Snapshot, Spielern, Projektilen/FX, Weltzustand,
Interpolation, HUD und Renderer-Sync. Lobby-/UI-Zustand, Input/Kamera, Rundenzustand und
Diagnose-Eigenkosten sind ebenfalls eigene Reihen. Netzwerkdaten ergänzen CPU-Zeiten um
Traffic-Raten, Sendepuffer, Backpressure, verworfene Fast-Nachrichten sowie RTT.

`instrumentation.observability` sagt explizit, welche Browser-APIs verfügbar waren.
Unterstützte Browser liefern Long Animation Frames mit Skript-/Invoker-Zuordnung und
Forced-Layout-/Pause-Zeit sowie Event Timing mit Input-, Handler- und Presentation-Delay.
Long Tasks, GC, Heap-Samples und GPU-Timer bleiben zusätzliche, browserabhängige Signale.
Der In-App-Trace liefert weiterhin keine vollständigen JavaScript-Callstacks und keine
GPU-Pass-Aufschlüsselung pro GameObject oder Filter. Wenn ein unbekannter CPU-Restposten
oder die GPU-Gesamtzeit auffällig bleibt, ist ein Browser-Performance-Trace mit
CPU-Sampling beziehungsweise ein GPU-Frame-Capture erforderlich.
