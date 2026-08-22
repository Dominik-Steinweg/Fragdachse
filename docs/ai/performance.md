# Performance

Performance-Arbeit beginnt mit einer Messung unter vergleichbarer Map, Rolle, Spielerzahl, Qualitätsstufe und Spielsituation. Einzelne historische Profilwerte und abgeschlossene Optimierungen gehören nicht in diese Wissensbasis.

## Qualitätsprofile

GraphicsQualityController verwaltet high, medium und low. Die Einstellung ist lokal und darf nur Darstellungskosten beeinflussen: Partikel, Filter/Post-FX, Schatten, Lightmap-Auflösung und Lichtbudgets. Simulation, Physik, Treffer, Gameplay, Netzwerktakt und replizierter Zustand bleiben identisch. Kritische Telegraphen und Zustandsanzeigen dürfen auf low nicht verschwinden.

Neue Emitter und Filter über die bestehende Qualitätsinfrastruktur registrieren. visible = false reicht nicht, um Updatekosten zu stoppen; für deaktivierte Effekte auch Emission/Pool und active korrekt behandeln. Szeneweite Pools am Round-Teardown auf einen Grundstock trimmen.

## Dauerhafte Hotpath-Regeln

- Laufende Performance-Diagnostik ist ausschließlich während einer expliziten Trace-Assist-
  Aufzeichnung oder geöffneten Live-Ansicht aktiv. `ArenaRuntimeProfiler` besitzt den zentralen
  Lifecycle. Die normale Companion-Serie läuft mit 4 Hz: Gauges beschreiben den aktuellen Zustand,
  Intervallfelder werden seit dem letzten Sample per Delta/Total/Max gesammelt, damit kurze CPU-,
  Snapshot-, Flowfield-, Rock- und VFX-Bursts nicht zwischen zwei 250-ms-Samples verschwinden.
  Es gibt keinen periodischen Scene-Vollscan; Scene Inspection ist eine ausdrückliche Aktion.
  Der GPU-Timer bleibt auf aufgezeichnete Frames begrenzt und exportiert asynchrone Ergebnisse als
  sparse `{atMs, renderFrame, durationMs}`-Serie. Die funktionale Transportbasisdiagnose
  (Lobby-Ping und Relay-Erkennung) bleibt davon unberührt.
- Statische Arena- und Menüflächen backen, wenn sie unveränderlich sind. Dynamische Hindernisse, Blut und Gameplay-Visuals bleiben separat, damit Zerstörung und Replikation nicht gegen einen Bake arbeiten.
- Segmentbasierte Hindernisprüfungen laufen über die eine Round-Instanz von ArenaObstacleIndex; nicht pro Kandidat getBounds() aufrufen. Der Index darf konservativ filtern, aber keinen echten Treffer auslassen, und wird bei Geometrieänderungen synchron invalidiert.
- Homing- und Zielsuche erst bewerten, dann Sichtlinie für die besten Kandidaten prüfen. Keine per-Gegner-Flowfields oder temporären Arrays erzeugen, wenn die bestehenden Services/Callbacks dieselbe Information liefern.
- Mehrere Coop-Flowfields dürfen gemeinsame Topologie teilen, nicht aber unterschiedliche Zielmengen oder Clearance-Annahmen vermischen.
- Alle Runtime-Flowfields laufen über einen `FlowFieldCoordinator` und einen gemeinsamen Web Worker. Der Worker besitzt jede Zielableitung, jedes Integrations- und Vektorfeld sowie alle Clearance-Profile; im Main Thread bleibt nur der Topologiespiegel des Standardprofils, weil `isTraversableAt`, `isCircleGroundFreeAt` und die Kreis-/Linienprädikate mitten im Frame gelesen werden. Beide Seiten leiten diesen Spiegel mit demselben `FlowFieldKernel` aus demselben Patch-Strom ab; der Kernel importiert weder Phaser noch `src/config.ts` (dessen `GRID_COLS`/`ARENA_OFFSET_*` sind mutable `let`, der Worker sähe eine zweite Modulinstanz).
- Aktiviert wird ausschließlich an festen Nav-Ticks (`COOP_DEFENSE_NAV_TICK_INTERVAL_MS`), nie dazwischen und nie teilweise: Feld, Boss-`traversable` und die zugehörige Payload (etwa das strategische Ziel-Mapping) wechseln in einem Referenz-Swap. Es gibt genau einen Job in Flight und keine Queue – während ein Job läuft, entsteht kein Pending-Job, beim nächsten freien Tick wird frisch gesampelt. Unveränderte Zielmengen erzeugen keinen Rebuild. Überholte Ergebnisse werden über `generationId`, `goalVersion` und `topologyVersion` verworfen; bleibt ein Ergebnis aus, bleibt das letzte vollständige Feld aktiv.
- `FlowFieldCoordinator` hält statische Zellquellen und die dynamische Fels-/Obstacle-Belegung persistent. Ein koordiniertes `ARENA_MAP_GRID_CHANGED_EVENT` mit Koordinate aktualisiert nur das Occupancy-Raster und klassifiziert die geänderte Zelle samt Wall-Adjacency-Nachbarn; Provider-/Full-Rebuilds bleiben auf koordinatenlose Events, Base-Strukturwechsel und Clearance-Sonderfälle begrenzt.
- Ein Clearance-Profil ist keine reine Maske: `applyWallAdjacencySurcharge` läuft nach `applyClearanceMask` und liest `traversable`, deshalb weichen neben `traversable` auch `costs` und `wallAdjacent` ab, und der Zielabstand zu Basen wächst auf `clearanceCells + 1`. Ein solches Profil braucht eigene Arrays und eine eigene Zielableitung; Profile werden nach `clearanceCells` gekeyt, nicht nach Rolle.
- Base-Änderungen rechnen nicht mehr synchron im Frame. Der Coordinator verschickt den Patch prioritär und sperrt die entfallenen Basisziele sofort im Main Thread, bis das neue Feld aktiv ist – ohne diese Sperre bliebe ein Gegner auf der Zielzelle der toten Basis stehen, weil sein Integrationswert dort `0` ist und `EnemyManager` das als „angekommen" wertet.
- Häufige homogene Visuals poolen. Physik-/Gameplay-Objekte nur poolen, wenn der Reset vollständig und messbar günstiger ist.
- `Graphics.strokeCircle`, `fillCircle` und `arc` erzeugen im WebGL-Renderer rund 101 Punkte pro
  Bogen, unabhängig vom Radius (`GraphicsWebGLRenderer.js`, `iterStep = 0.01`; jeder Punkt ist eine
  Objektallokation plus ein `cos`/`sin`-Paar). Die Tessellierung läuft in jedem gezeichneten Frame
  erneut über den gesamten `commandBuffer` – ein Dirty-Flag auf den Neuaufbau senkt die
  Renderkosten deshalb nicht, und `pathDetailThreshold` verwirft Punkte erst nach ihrer Erzeugung.
  In Pro-Frame-Pfaden gehören gebackene Texturen mit langlebigen Images hin (`src/ui/AimVisuals.ts`);
  wo die Winkelgeometrie wirklich dynamisch ist, den Bogen mit `moveTo`/`lineTo` selbst tessellieren.
- Frame-Getter auf dem Client dürfen nicht jedes Mal localStorage lesen, JSON parsen oder Upgrade-Profile neu auflösen; bestehende Referenz-/Round-Caches verwenden und explizit invalidieren.
- Dirty-Flags und einmal-pro-Frame-Rebuilds für große UI-/Overlay-Bäume nutzen; keine komplette Baumzerstörung pro Klick.
- Fels-Änderungswellen sammeln IDs bis `POST_UPDATE` und backen Mottle, Decals und statische
  Schatten nur in lokalen Dirty-Chunks neu. Layout-/Profilwechsel behalten den vollständigen
  Rebuild als Fallback; Scratch-RenderTextures werden vom jeweiligen Arena-/Renderer-Eigentümer
  wiederverwendet und in dessen Teardown zerstört.
- Entfernte Felsen invalidieren `ArenaObstacleIndex` nicht: Queries lesen `active` live und
  überspringen zerstörte Quellen sofort. Nur neue bzw. geometrisch veränderte Hindernisse
  fordern einen Index-Neubau an, damit Pelletserien nicht zwischen Treffern voll neu indizieren.
- Radiale Felsabfragen verwenden den bestehenden `ArenaBuilderResult.rockGrid` über
  `RockGridIndex.forEachRockInRadius`: Die Weltkreis-Range liefert nur eine konservative
  Zellober-Menge, danach bleiben Mittelpunkt-, Aktiv-, Schaden-, Falloff- und LOS-Prüfungen
  beim Aufrufer. Der Query-Buffer dedupliziert IDs und bewahrt die `rockObjects`-Reihenfolge;
  es gibt keine zweite Belegungsstruktur.

## Grosse Arenen

Coop-Arenen sind auf beiden Achsen bis 1024 Zellen konfigurierbar; die Grenze ist keine
Designentscheidung, sondern die Stelle, an der `rockCellKey` (Stride 65536), der
`Int32Array`-Fels-Index und der zellbasierte Terrain-Lookup technisch enden. Kein sichtbares
Renderziel skaliert mehr mit der Weltflaeche (siehe rendering.md); was mit ihr skaliert, sind
Datenmengen: Fels-, Dirt- und Decal-Listen sowie Flow-Field-Raster; das initiale `ArenaLayout` wird nicht über WebRTC übertragen. Übertragen wird nur der kompakte `ArenaDescriptor`.

`src/arena/diagnostics/LargeArenaBenchmark.ts` ist der dauerhafte Messpunkt dafuer. Er baut sich
seine Karte selbst und haengt bewusst an keiner authored Map, damit er das Loeschen einer
Testarena ueberlebt; `tests/LargeArenaGeneration.test.ts` faehrt ihn mit festen Seeds und prueft
Determinismus und Vollstaendigkeit, nie Laufzeiten. Eine feste Millisekundenschwelle waere auf
fremder Hardware ein instabiles Gate und keine Aussage ueber den Code.

Für große Karten prüft `tests/LargeArenaGeneration.test.ts` die deterministische Host-/Client-
Generierung und misst die Descriptor-Größe. Die vollständigen Layout-Listen bleiben lokal; der
Fingerprint dient als klarer Diagnosefehler bei abweichenden Generatorständen. Während des
Loading-Screens darf der gemeinsame Chunk-Scheduler aggressiv arbeiten; nach dem Countdown gelten
unverändert `CHUNK_BAKE_PREFETCH_FRAME_BUDGET_MS` und `CHUNK_BAKE_URGENT_FRAME_BUDGET_MS`.

Sechs Regeln fuer grosse Felsbestaende sind messungsbelegt und duerfen nicht zurueckfallen:

**`StaticGroup.refresh()` ist kein Nachfuehren, sondern ein Vollumbau.** Es ruft `body.reset()` auf
jedem Mitglied, und jedes `reset()` entfernt den Koerper aus dem statischen RTree und fuegt ihn
sofort wieder ein. Pro zerstoertem Fels kostete das bei 29 000 Felsen 58 000 Baumoperationen; eine
Flaechenzerstoerung ergab daraus ein 30 Sekunden langes Standbild. Der Gruppenabgang meldet den
Koerper ohnehin schon ab, und Felsen bewegen sich nie – es gibt nichts nachzufuehren
(`tests/RockPhysicsChurn.test.ts`).

**Ein Region-Bake fragt einen raeumlichen Index, nie den Gesamtbestand.** Fels-Overlays und
statische Schatten backen je Dirty-Chunk; ein Durchlauf ueber alle Felsen je Region und Ebene war
nach einer Zerstoerungswelle der groesste Posten im `POST_UPDATE`. `ArenaCellBucketIndex` liefert
dafuer eine *Obermenge* – der genaue Test bleibt beim Aufrufer, damit der Index keine Auswahlregel
verschieben kann (`tests/ArenaCellBucketIndex.test.ts`).

Dasselbe gilt fuer alle statischen, weltpositionierten Bake-Platzierungen: Ground Cover, Boden-
und Fels-Decals sowie Fels-Moos und Kantenvegetation bauen ihren `ArenaPointBucketIndex` genau
einmal aus den deterministischen Platzierungen auf. Ein Chunk fragt nur Buckets im konservativen
Ausdehnungsradius ab und prueft danach die echte Groesse/Position; die Treffer bleiben in
Quelllistenreihenfolge. Die Query- und Arbeitsbuffer werden zwischen Full- und Dirty-Bakes
wiederverwendet (`tests/ArenaPointBucketIndex.test.ts`). Wachsende Fels- und Materialquellen
bleiben davon getrennt und werden weiterhin inkrementell ueber `ArenaCellBucketIndex.sync`
nachgefuehrt.

**Phaser 4 cullt nicht an den Kamera-Bounds.** `GameObject.willRender()` prueft nur Renderflags und
Kamerafilter; jedes Objekt der Anzeigeliste laeuft sonst durch Transform, Tint, Quad und Batch. Bei
24 000 Fels-Images waren das 16,7 ms `renderSubmit` je Frame fuer 1 600 tatsaechlich sichtbare
Objekte. Im Classic-Pfad setzt `RockViewportCuller` deshalb `visible` bucketweise statt einzelne
Objekte aus der Anzeigeliste zu nehmen; deren Aenderung kostet je Objekt eine lineare Suche, zwei
Events und eine Tiefensortierung. `RockVisualState.active` bleibt die Darstellungswahrheit;
Sichtbarkeit ist rein lokal.

**Die Anzeigeliste ist eine lineare Struktur.** `scene.add.*` prueft `List.exists` und `destroy()`
sucht mit `indexOf` – beides ueber die gesamte Liste. Ein einziges kurzlebiges Objekt kostete damit
bei zehntausenden Eintraegen drei Vollscans. Bake-Bilder werden deshalb losgeloest erzeugt
(`new Phaser.GameObjects.Image(...)`, siehe `ArenaVisualFactory`) und kommen gar nicht erst hinein.

**Eine `Layer` cullt ihre Kinder nicht.** Sie macht die Szenenliste kurz, aber `LayerWebGLRenderer`
laeuft weiterhin durch *alle* Kinder einer sichtbaren Ebene und ruft je Kind `willRender()`. Eine
einzige grosse Fels-Ebene band den Renderpfad damit weiter an den Gesamtbestand. Der Felsbestand
liegt deshalb in einer Ebene **je 512-px-Rasterchunk** (`RockLayerGrid`, dasselbe
`ArenaChunkGrid` wie das Chunk-Streaming – kein zweites Raumraster). Eine Ebene ausserhalb
des Ausschnitts ist selbst unsichtbar und wird nicht betreten; ihre Kinder kosten nichts.
`RockViewportCuller` fuehrt beide Stufen: grob je Ebene, fein je 128-px-Bucket innerhalb der
kameranahen Ebenen. Die Ebenenmenge wird dabei **aus** der Bucketmenge abgeleitet und nicht
getrennt aus demselben Rechteck berechnet – zwei Rasterabfragen runden an der Kante verschieden,
und ein sichtbarer Fels in einer unsichtbaren Ebene faellt erst auf, wenn die Ebene spaeter aufgeht
und er dort ploetzlich auftaucht (`tests/ArenaCellBucketIndex.test.ts`). Das gilt nur fuer
`rockRenderer=classic`; `spriteGpu` erzeugt keine Classic-Images, keine `RockLayerGrid` und keinen
per-Rock-Culler, sondern schaltet feste GPU-Pages als Ganzes.

Beides zusammen haelt die Szenenliste kurz, sodass jede Truemmer-, Partikel- und Tween-Erzeugung
einer Zerstoerungswelle billig bleibt. Diagnose und Ablationsmodus steigen ueber
`forEachSceneDisplayObject` eine Ebene tief in `Layer`-Kinder ab, sonst faende die
`rocks`-Kategorie nichts mehr. Im Sprite-GPU-Pfad ist jede Page selbst ein Displayobjekt mit der
Textur `rocks` und bleibt dadurch derselben Ablationskategorie zugeordnet.

Der Ablationsmodus nutzt fuer seine gleichmaessig in Baseline und Segmenten laufenden Scans
zusaetzlich `forEachAblationDisplayObject`, das `Container`-Kinder rekursiv erreicht. Die
allgemeine Diagnose-/Count-Traversierung bleibt bewusst nicht-rekursiv. `vectorShapes` blendet
dabei ausschliesslich Arc-/Graphics-Rendering aus; klassische `ParticleEmitter` und
`SpriteGPULayer`-VFX bleiben eigene Ablationskategorien.

**Zerstoerungs-VFX ausserhalb des Bildes entfallen.** `RockDestructionRenderer` sammelt sichtbare
Zerstoerungen bis `POST_UPDATE` und vergibt ein gemeinsames Budget: hoechstens vier raeumlich
verteilte Felsen laufen gleichzeitig durch die hochwertige Fragmentspur, deren maximal 144 Images
aus einem Pool kommen; der Rest wird durch hoechstens 32 gemeinsame Dust-/Debris-Bursts vertreten.
Die beiden Partikelemitter bleiben bestehen und werden wiederverwendet. Dadurch entstehen weder
pro Fragment Tween-/Destroy-Ketten noch pro Fels ein Emitter, und der Sichtbarkeitstest steht
weiterhin ganz vorn in `playDestruction()`.

## Messworkflow

T öffnet PerformanceDiagnosticsOverlay. Die Live-Anzeige enthält sowohl `FPS aktuell` aus dem
letzten ungeglätteten Frame als auch `Ø FPS` aus dem bisherigen Messfenster. Der Profiler trennt
Frame-Delta, aktuelle Gauges,
Intervallaggregate, Netzwerk, Host-Simulation, Client-Synchronisierung und semantische Visual-
Buckets. `hostCpuMs`/`clientCpuMs` sind Intervall-Total/Maxwerte; Durchschnittswerte werden erst
aus Total/Count abgeleitet. Worker-Compute wird vollständig im Worker gemessen, Round-Trip
vollständig im Main Thread; `atMs` bleibt immer Main-Thread-Sessionzeit. Render-Abgabe ist
CPU-Zeit um Phaser-Render-Ereignisse, nicht automatisch GPU-Zeit.

Für Ursachenzuordnung den vorhandenen Ablationsmodus verwenden: immer baseline → Kategorie → baseline, gleiche Map und stabile Spielsituation. ΔgameStepMs/ΔrenderSubmitMs über mehrere Zyklen auswerten, nicht FPS-Sprünge oder zwei verschiedene Ablationen direkt vergleichen. Ablation schaltet Darstellung ab; Host-Logik, Physik und Netzwerk laufen weiter.

Empfohlener Korrelation-Workflow: Chrome Recording starten → Trace Assist starten → spielen →
Trace Assist stoppen → Chrome Recording stoppen. Die `FD:session:sync:<id>:<elapsedMs>`-Marker
alle fünf Sekunden sind eine robuste Fallback-Korrelation, aber bei sehr kurzen Chrome-Aufnahmen
nicht garantiert enthalten. Der bisherige Workflow bleibt gültig, sobald mindestens ein Sync-
Marker im Chrome-Trace liegt. P95/P99 und Slow-Frame-Anteil sind für Hänger aussagekräftiger als
ein Mittelwert. Report-Schema und Messfelder leben in
`src/scenes/arena/ArenaRuntimeProfiler.ts` und `src/scenes/arena/PerformanceAblation.ts`.
Das Environment-Feld `renderer` unterscheidet dabei `webgl2` und `webgl1`; der asynchrone
GPU-Timer nutzt auf WebGL2 `EXT_disjoint_timer_query_webgl2` und fällt auf WebGL1, sofern
`EXT_disjoint_timer_query` verfügbar ist.

Die aktive Attribution registriert jedes renderbare Vector-Objekt einzeln; ein Hook in derselben
Source deckt keine weiteren Factory-Ergebnisse ab. Registrierung und Destroy-Lifecycle liefern
je Graphics-Familie `createdObjects`/`destroyedObjects` als 250-ms-Intervallwerte und in der
Recording-Summary. Der Performance-Report weist den verwendeten GPU-Timer-Backend sowie
GPU-Framezeit als `avg`/`p95`/`p99`/`peak` aus. Draw Calls und Phaser-Batch-Flushes werden, wenn
der konkrete Renderer-Hook verfügbar ist, separat erfasst; Pipeline- und Texture-Batch-Wechsel
bleiben andernfalls explizit `unsupported`.

Netzwerk-`bytesSent`/`bytesReceived` stammen weiterhin als echte Transportwerte aus WebRTC-
Statistiken. Diagnose führt keine zusätzliche Serialisierungs- oder UTF-8-Runde ein; lokale
Payload-Warnungen sind ausdrücklich nur geschätzt. Session-Kontext wie Rolle, Phase, Modus, Map,
Quality sowie Rock-Renderer/Page-Size wird als beobachteter Kontext fortgeschrieben und nicht nur
im Start-Environment eingefroren.

## Verifikation

Geeignete Tests sind tests/ArenaObstacleIndex.test.ts, tests/GraphicsQualityAndPerformance.test.ts, tests/PerformanceAblation.test.ts, tests/ProjectilePerformance.test.ts und tests/CoopDefenseProfileMemo.test.ts. Tests sollen Invarianten und Messverträge schützen, nicht eine bestimmte Hardware- oder Balancezahl festschreiben.
