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
- Fels-Änderungswellen sammeln IDs bis `POST_UPDATE` und backen Mottle, Decals und statische
  Schatten nur in lokalen Dirty-Chunks neu. Layout-/Profilwechsel behalten den vollständigen
  Rebuild als Fallback; Scratch-RenderTextures werden vom jeweiligen Arena-/Renderer-Eigentümer
  wiederverwendet und in dessen Teardown zerstört.
- Entfernte Felsen invalidieren `ArenaObstacleIndex` nicht: Queries lesen `active` live und
  überspringen zerstörte Quellen sofort. Nur neue bzw. geometrisch veränderte Hindernisse
  fordern einen Index-Neubau an, damit Pelletserien nicht zwischen Treffern voll neu indizieren.

## Grosse Arenen

Coop-Arenen sind auf beiden Achsen bis 1024 Zellen konfigurierbar; die Grenze ist keine
Designentscheidung, sondern die Stelle, an der `rockCellKey` (Stride 65536), der
`Int32Array`-Fels-Index und der zellbasierte Terrain-Lookup technisch enden. Kein sichtbares
Renderziel skaliert mehr mit der Weltflaeche (siehe rendering.md); was mit ihr skaliert, sind
Datenmengen: Fels-, Dirt- und Decal-Listen, Flow-Field-Raster und das initiale `ArenaLayout`.

`src/arena/diagnostics/LargeArenaBenchmark.ts` ist der dauerhafte Messpunkt dafuer. Er baut sich
seine Karte selbst und haengt bewusst an keiner authored Map, damit er das Loeschen einer
Testarena ueberlebt; `tests/LargeArenaGeneration.test.ts` faehrt ihn mit festen Seeds und prueft
Determinismus und Vollstaendigkeit, nie Laufzeiten. Eine feste Millisekundenschwelle waere auf
fremder Hardware ein instabiles Gate und keine Aussage ueber den Code.

Referenzmessung auf dem Entwicklungsrechner (400 x 80 Zellen, drei feste Seeds, Node 24):
`ArenaGenerator.generate()` Median rund 750 ms, Maximum rund 830 ms, deterministisch. Das um
Decals reduzierte Initial-Layout ist dabei rund 1,4 MiB – der Peer-Transport serialisiert
unkomprimiert als JSON-String (`encodePeerMessage`), die Zahl ist also die tatsaechliche
reliable Nutzlast. Beides ist gemessen und dokumentiert, aber nicht optimiert: Ein Umbau von
Generator oder Wire-Format gehoert erst hinter einen Trace, der ihn als reales Problem zeigt.

Fuenf Regeln fuer grosse Felsbestaende sind messungsbelegt und duerfen nicht zurueckfallen:

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

**Phaser 4 cullt nicht an den Kamera-Bounds.** `GameObject.willRender()` prueft nur Renderflags und
Kamerafilter; jedes Objekt der Anzeigeliste laeuft sonst durch Transform, Tint, Quad und Batch. Bei
24 000 Fels-Images waren das 16,7 ms `renderSubmit` je Frame fuer 1 600 tatsaechlich sichtbare
Objekte. `RockViewportCuller` setzt deshalb `visible` bucketweise – nicht die Anzeigeliste selbst,
deren Aenderung je Objekt eine lineare Suche, zwei Events und eine Tiefensortierung kostet.
`active` bleibt die Wahrheit darueber, ob ein Fels noch steht; Sichtbarkeit ist rein lokal.

**Die Anzeigeliste ist eine lineare Struktur.** `scene.add.*` prueft `List.exists` und `destroy()`
sucht mit `indexOf` – beides ueber die gesamte Liste. Ein einziges kurzlebiges Objekt kostete damit
bei zehntausenden Eintraegen drei Vollscans. Zwei Konsequenzen, beide messungsbelegt: Bake-Bilder
werden losgeloest erzeugt (`new Phaser.GameObjects.Image(...)`, siehe `ArenaVisualFactory`), und
der Felsbestand liegt in einer eigenen `Layer` statt in der Szenenliste. Damit bleibt die
Szenenliste kurz, und jede Truemmer-, Partikel- und Tween-Erzeugung einer Zerstoerungswelle wird
entsprechend billiger. Diagnose und Ablationsmodus steigen ueber `forEachSceneDisplayObject` eine
Ebene tief in `Layer`-Kinder ab, sonst faende die `rocks`-Kategorie nichts mehr.

**Zerstoerungs-VFX ausserhalb des Bildes entfallen.** `RockDestructionRenderer` erzeugt je Fels bis
zu 36 Truemmer-Images mit je einem Tween. Eine Flaechenzerstoerung raeumt auf einer grossen Karte
tausende Felsen gleichzeitig ab – zehntausende Objekte, von denen der Spieler nur die wenigen im
Bild sieht. Der Sichtbarkeitstest steht deshalb ganz vorn in `playDestruction()`; am sichtbaren
Bild aendert er nichts.

## Messworkflow

T öffnet PerformanceDiagnosticsOverlay. Der Profiler trennt Frame-Delta, Scene-Update, Render-Abgabe, Netzwerk, Host-Simulation, Client-Synchronisierung und Visual-Buckets. Render-Abgabe ist CPU-Zeit um Phaser-Render-Ereignisse, nicht automatisch GPU-Zeit.

Für Ursachenzuordnung den vorhandenen Ablationsmodus verwenden: immer baseline → Kategorie → baseline, gleiche Map und stabile Spielsituation. ΔgameStepMs/ΔrenderSubmitMs über mehrere Zyklen auswerten, nicht FPS-Sprünge oder zwei verschiedene Ablationen direkt vergleichen. Ablation schaltet Darstellung ab; Host-Logik, Physik und Netzwerk laufen weiter.

Chrome DevTools nur ergänzend und nicht gleichzeitig mit dem In-App-Profiler verwenden. P95/P99 und Slow-Frame-Anteil sind für Hänger aussagekräftiger als ein Mittelwert. Report-Schema und Messfelder leben in src/scenes/arena/ArenaRuntimeProfiler.ts und src/scenes/arena/PerformanceAblation.ts; nicht in Markdown nacherzählen.

## Verifikation

Geeignete Tests sind tests/ArenaObstacleIndex.test.ts, tests/GraphicsQualityAndPerformance.test.ts, tests/PerformanceAblation.test.ts, tests/ProjectilePerformance.test.ts und tests/CoopDefenseProfileMemo.test.ts. Tests sollen Invarianten und Messverträge schützen, nicht eine bestimmte Hardware- oder Balancezahl festschreiben.
