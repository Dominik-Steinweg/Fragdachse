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

Auch die Arena-Decals sind zur Laufzeit unveränderlich (rein visuell, keine Kollision, keine HP) und werden von `ArenaBuilder.bakeDecals()` nach demselben Muster gebacken; `decalStamps` erhält ihre Geometrie für den Sampler. Dynamische Blut-Decals stammen aus `BloodEffectShared` und sind davon nicht betroffen – sie bleiben eigene Objekte.

Dieselbe Backregel gilt für die gesamte Lobby-/Menü-Vorschau, nicht nur für ihren Boden: `MenuArenaPreviewRenderer.bakeLayer()` backt Dirt, Decals, Felsen und Kronen je als ein Tiefenband an den Vorschau-Bounds (Kamera-Scroll auf `bounds.offsetX/offsetY`). Die Bänder bleiben getrennt, weil die Schatten-Graphics des `ShadowSystem` zwischen ihnen liegen (Fels-Schatten unter `DEPTH.ROCKS`, Kronen-Schatten unter `DEPTH.CANOPY`).

Zwei nicht offensichtliche Regeln dabei:

- Die Layer-Alpha wird auf die **Einzelbilder vor dem Backen** angewendet, die RenderTexture bleibt bei Alpha 1. Nur so bleibt das Ergebnis bei einander überlappenden Bildern pixelgleich (der „over"-Operator ist assoziativ); eine Alpha auf dem fertigen Layer würde Überlappungen anders gewichten.
- Dauerhaft unsichtbar konfigurierte Bänder (`visible: false` bzw. `alpha: 0`, aktuell Tracks und Baumstämme) werden gar nicht erst erzeugt.

Das wirkt über die Lobby hinaus: Die Vorschau wird beim Match-Start nur unsichtbar geschaltet und nicht abgebaut, lag also während der gesamten Runde als über tausend unsichtbare Objekte in der Display-Liste der Arena. Wer Vorschau-Objekte hinzufügt, zahlt sie deshalb in beiden Phasen.

## Projektil-Hotpath und Pooling

Host-Systeme erhalten die aktiven Projektile als stabile `ReadonlySet`-Sicht und IDs werden
über einen gepflegten Index aufgelöst. Projektil-Renderer werden beim zentralen
Projektil-Cleanup freigegeben; deshalb dürfen sie nicht zusätzlich pro Frame aktive
ID-Arrays und Orphan-Sets aus der gesamten Projektilmenge materialisieren. Der replizierte
Projektil-Snapshot wird erst beim tatsächlichen Network-Tick gebaut.

`syncHostRenderers()` läuft in genau einem Durchlauf über die Projektilliste und verteilt
jedes Projektil per `switch (projectileStyle)` an seinen Renderer statt eines Durchlaufs pro
Renderer-Typ. Style-unabhängige Pfade (Burn für jedes Projektil, Tracer nach `tracerConfig`)
und der Bullet-Body-Sync der kugelartigen Stile laufen im selben Durchlauf mit; `gauss` wird
weiterhin bewusst von BulletRenderer (Body-Sync) **und** GaussRenderer bedient.

Endlos laufende Puls-Tweens auf Filtern (`repeat: -1`) gehören pausiert, sobald ihr Ziel
unsichtbar geschaltet wird – sonst laufen sie durch das ganze Match weiter und markieren den
Filter jeden Frame neu. `BadgerPreview.setVisible()` kapselt das; Aufrufer dürfen die
Sichtbarkeit deshalb nicht am Sprite vorbei setzen.

Scene-lifetime-Renderer mit Objekt-Pools müssen ihren Pool beim Runden-Teardown auf einen
Grundstock trimmen. Der Pool darf innerhalb einer Runde bis zum Spitzenbedarf wachsen – sonst
allokiert er mitten im Gefecht nach –, aber ohne Trimmen bleibt die Spitze einer Runde für die
gesamte Sitzung als unsichtbare Objekte in der Display-Liste liegen und wird auch in der Lobby
jeden Frame durch Update- und Depth-Sort-Pässe gezogen. Betroffen waren der Heat-Haze-Pool des
`FlamethrowerUpgradeRenderer` und der Pfützen-Pool des `SlimeTrailRenderer`; beide trimmen jetzt
in ihrem `clear()`, das der `ArenaLifecycleCoordinator` beim Teardown aufruft. Nur `train` und
`translocatorTeleport` im `RendererBundle` sind round-scoped, alle anderen Renderer überleben die
Runde – bei ihnen ist dieses Muster zu prüfen.

Pooling gehört an homogene, kurzlebige Visuals: Rocket-Smoke verwendet einen gemeinsamen,
vorreservierten `ParticleEmitter`, dessen Partikel Phaser intern wiederverwendet. Die
autoritativen Physik-Shapes werden bewusst nicht gepoolt. Rectangle-/Circle-Varianten,
projektilspezifische Arcade-Collider, World-Bounds-Listener und umfangreicher optionaler
Gameplay-State würden einen vollständigen und fehleranfälligen Reset erfordern, während
ihre Spawn-Allokation nicht im gemessenen per-Frame-Hotpath liegt.

## Lokaler Messworkflow

`T` öffnet die Performance-Diagnose. Die Live-Ansicht arbeitet ohne Telemetrie. Eine Aufzeichnung wird manuell gestartet und gestoppt, ist auf 30 Minuten begrenzt und kann danach als JSON heruntergeladen werden. Der Export enthält Browser-/Renderer-Metadaten und Qualitätswechsel, aber keine Raumcodes oder Spieler-IDs.

Messfenster trennen Frame-Delta, Scene-Update, CPU-Render-Abgabe, Netzwerk-Update/-Flush, Visuals sowie Host-Simulation beziehungsweise Client-Synchronisierung. Dadurch darf ein langsamer Host nicht vorschnell der Grafik zugeschrieben werden. Die Render-Abgabe misst CPU-Zeit zwischen Phasers Pre-/Post-Render-Ereignissen, nicht die vollständige GPU-Zeit, und stammt aus dem vorherigen Frame, weil `update` vor `render` läuft.

## Diagnose-Trace (Ablationsmodus)

Ein normaler Trace zeigt, *wieviel* ein Frame kostet, nicht *wodurch*. Über eine gespielte Runde
steigen und fallen Partikel, Lichter, Blut und Objektzahl gemeinsam, ihre Korrelationen bleiben
deshalb schwach (typisch 0,2–0,5) und taugen nicht zur Ursachenzuordnung.

Der Ablationsmodus schaltet stattdessen während der Aufzeichnung reihum je einen
Darstellungsaspekt für ein Zeitfenster ab und vergleicht ihn mit dem unmittelbar davor
liegenden Baseline-Fenster. Das Spiel ist dabei absichtlich nicht normal spielbar – es ist ein
reines Messwerkzeug.

Start über den Knopf **„Diagnose-Trace starten"** in der `T`-Diagnose; er startet Aufzeichnung
und Ablation gemeinsam. Kategorien: Filter/Glow, Partikel, Lichter, Schatten, Blut, Felsen,
Bodenfeuer, Projektile, statische Deko, HUD.

Zwei Eigenschaften machen die Zahlen belastbar:

- **Baseline zwischen jeder Ablation.** Die Abfolge ist `baseline → Kategorie → baseline → …`,
  jede Messung hat also einen frischen Nachbarn und ist gegen langsame Drift (Gegnerzahl,
  Blutmenge, Rundenfortschritt) robust. Nie zwei Ablationen direkt miteinander vergleichen.
- **Der Display-Listen-Scan läuft in jedem Segment**, auch in der Baseline und auch dort, wo
  über Systemschalter abgeschaltet wird. Seine Kosten sind damit in allen Segmenten gleich und
  fallen aus der Differenz heraus.

`ablation` gehört zu den Fenster-Metadaten, ein Fenster mischt also nie zwei Segmente. Zur
Auswertung reichen `windows[].ablation` mit den zugehörigen `timings`; `frameSeries` trägt
zusätzlich die Spalte `ablationCode`, die Legende steht in `ablation.codes`/`ablation.labels`.

### Durchführung

1. Stabile Ausgangslage herstellen: gewünschte Qualitätsstufe wählen, Fenster im Vordergrund
   lassen und die Auflösung während der Messung nicht ändern.
2. Für Arena-Zahlen eine Runde mit **gleichbleibender** Action laufen lassen. Nicht mitten in
   der Messung die Spielsituation grundlegend wechseln – die Baseline-Nachbarschaft fängt
   Drift ab, aber keine Sprünge.
3. Mindestdauer: ein voller Zyklus ist `Segmentlänge × (Kategorien × 2 + 1)`, bei 4 s Segmenten
   also gut **90 Sekunden pro Phase**. Für die Lobby und die Arena getrennt jeweils einen
   vollen Zyklus abwarten, zusammen also mindestens **3–4 Minuten**.
4. Besser zwei bis drei Zyklen aufzeichnen. Erst dann lässt sich an der Streuung gleicher
   Kategorien erkennen, ob ein Unterschied echt oder Rauschen ist.
5. Stoppen und als JSON exportieren.

### Auswertung

Je Kategorie `gameStepMs`/`renderSubmitMs` des Ablations-Fensters gegen die benachbarte
Baseline stellen. Die Differenz ist die **obere Schranke** dessen, was diese Kategorie kostet –
sie enthält immer auch das Wegfallen abhängiger Arbeit. Eine Kategorie ist erst dann ein
lohnendes Optimierungsziel, wenn ihre Differenz über mehrere Zyklen stabil und deutlich
größer als die Streuung der Baselines untereinander ist.

Grenzen, die bei der Interpretation gelten:

- `lights` blendet den Lightmap-Composite aus, verhindert aber nicht dessen Erzeugung; der Wert
  ist die Composite-Kostenschranke, nicht die gesamte Beleuchtung.
- Die Zuordnung der Objekte läuft heuristisch über Texturschlüssel, Typ und Tiefenband, damit
  der Produktionscode keine Diagnose-Marker tragen muss. Fehlzuordnungen kosten Messschärfe.
- Ablation ändert nur die Darstellung, nicht die Simulation. Host-Logik, Physik und Netzwerk
  laufen unverändert weiter.

## Gebackene statische Schatten

Die statischen Sonnenschatten liegen als gebackene RenderTexture je Tiefenband vor;
`staticGraphics` dient nur noch als Zeichenpuffer und bleibt dauerhaft unsichtbar. Ohne das
Backen rastert die GPU pro Frame alle gestapelten Alpha-Lagen neu – das war der größte
gemessene Einzelposten im Frame.

Beim Backen gelten zwei nicht offensichtliche Regeln:

- Die Textur startet **deckend weiß**, die Footprints werden mit ihrem MULTIPLY-Blendmode
  hineingezeichnet, und die fertige Textur wird selbst per MULTIPLY komponiert. Weiß ist das
  neutrale Element, dadurch enthält die Textur exakt das Produkt der gestapelten Lagen.
  Normales Alpha-Blending wäre **nicht** gleichwertig, weil die Schattenfarbe (`0x05070b`)
  nicht exakt schwarz ist. Phasers WebGL-Pfad übernimmt beim Zeichnen in eine DynamicTexture
  den Blendmode des Objekts, die Rechnung geht also auf.
- Die Arena-Maske trägt die gebackene Textur, nicht der Zeichenpuffer.
- Zeichenpuffer und gebackene Textur müssen **immer gemeinsam** geleert werden. Nur den Puffer
  zu leeren lässt die gebackenen Schatten stehen; sie überleben dann den Arena-Teardown und
  bleiben als Raster in der Lobby sichtbar. `clear()` leert deshalb über `clearStatic()`.
  Eine geleerte Textur wird zusätzlich ausgeblendet, damit sie keine wirkungslose
  Vollflächen-Blendpass pro Frame kostet.

Die statischen Schatten sind nach Veränderlichkeit getrennt: **Fels- und Turret-Schatten**
(`rocks`) werden bei jeder Hindernisänderung neu gebacken, **Baum-Schatten** (`trees`) nie –
`layout.trees` kennt kein Sichtbarkeits-Prädikat, Bäume werden also nie entfernt. Das ist die
teurere Gruppe: Eine Krone stapelt 32 Lagen, ein Fels 8. Ein neues Layout-Objekt baut beide
Gruppen neu auf, derselbe Layout-Bezeichner nur die Felsen.

`RockVisualHelper` sammelt Hindernisänderungen über ein Dirty-Flag und stößt den Rebuild
einmal am Ende des Frames an (`POST_UPDATE`). Eine Explosion zerstört typischerweise mehrere
Felsen und löste sonst pro Fels einen vollständigen Rebuild aus. Bewusst ein Frame-Sammelpunkt
und kein Zeit-Timer: Eine Verzögerung ließe den Schatten sichtbar länger stehen als den Fels.
Im Extremfall – jeder Frame eine Zerstörung – fällt das Verfahren damit auf höchstens einen
Bake pro Frame zurück, also auf die Rasterisierung, die vorher ohnehin jeden Frame lief.

### Gemessene Kostenverteilung (Ablations-Trace, RTX 3080, high, Map 14)

Der erste vollständige Diagnose-Trace ordnet die Frame-Zeit so zu:

- **Schatten sind der mit Abstand größte Posten: rund 7 ms eines 21,7-ms-Arena-Frames.** In
  beiden Messpaaren war die Szene während der Ablation sogar voller als in der Baseline, der
  Effekt ist also eher unterschätzt. Ursache ist Overdraw, nicht Geometrie: `drawFootprint()`
  stapelt pro Schattenwerfer `blurLayers` alphagefüllte Formen, um Weichheit zu erzeugen –
  Fels 8, **Baumkrone 32**. Entsprechend sinkt beim Abschalten die Render-Zeit stark, während
  Draw-Calls und Buffer-Uploads praktisch unverändert bleiben.
- **HUD/UI kostet rund 4,5 ms in der Arena** und erzeugt dabei ~82 Draw-Calls mit ~82
  Programmwechseln – ein Wechsel pro Draw-Call, also praktisch kein Batching.
- **Glow-Filter kosten nur ~0,3 ms.** Sie verursachen zwar ~30 Framebuffer-Bindings, die sind
  auf dieser Klasse GPU aber billig. Framebuffer-Bindings taugen hier nicht als Kostenindikator.
- **Die Zahl der Display-Objekte ist nicht mehr der Hebel.** Das Ausblenden von über 1200
  sichtbaren Objekten (Felsen bzw. statische Deko) ändert die Frame-Zeit nicht messbar. Wer
  Objekte einspart, spart deshalb vor allem Szenen-Walk, nicht Renderzeit.

Rauschband beachten: Die Streuung der Arena-Baselines liegt bei etwa ±4,4 ms (2σ). In der
Arena sind damit nur Effekte ab rund 5 ms sicher auflösbar; die ruhigere Lobby löst kleinere
Effekte auf. Nullbefunde sind nur so viel wert wie der Wirksamkeitsnachweis der Ablation:
Für Felsen und statische Deko ist er über die entfernten Objektzahlen belegt, für Partikel,
Lichter und Bodenfeuer war er im ersten Trace uneindeutig.

## Verträge des Report-Schemas

`ablation.segments` ist leer, wenn der Diagnosemodus nicht lief; die Aufzeichnung ist dann
durchgehend `baseline`. Die Segmentgrenzen sind wie `frameSeries.rows[].atMs` relativ zum
Aufzeichnungsstart.

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
