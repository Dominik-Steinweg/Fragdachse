# Rendering

## Geltungsbereich

Rendering visualisiert World- und Activity-Zustand, besitzt aber keine Gameplay-Autorität. Die Darstellung darf fehlen oder reduziert sein, ohne dass Host-Simulation, World-Identity oder Physikverträge ungültig werden.

## Eine Scene, mehrere Präsentationsflächen

[src/scenes/ArenaScene.ts](../../src/scenes/ArenaScene.ts) ist die zentrale Phaser-Scene. Sie orchestriert World-/Activity-Lifecycle, Policies, Eingabe, Kameras und Renderer; sie ist nicht der Owner fachlicher Regeln.

[WorldPresentation.ts](../../src/world/WorldPresentation.ts) unterscheidet none, preview und interactive:

- none erzeugt keine World-Präsentationsflächen;
- preview zeigt replizierte World-Flächen und erlaubte Overlays, aber keine lokalen Rechte, Participation oder Player-Runtime;
- interactive aktiviert die vollständige World-Präsentation für gültige Teilnahme.

[PresentationPolicy.ts](../../src/world/PresentationPolicy.ts) und [InputPolicy.ts](../../src/world/InputPolicy.ts) sind reine Ableitungen. Sie entscheiden nicht über Host-Autorität, Treffer oder Ressourcen.

## Explosions-Audio

Explosions-Audio wird unabhängig vom `ExplosionVisualStyle` über die Quell-ID im
`broadcastExplosionEffect`-Ereignis aufgelöst. [ExplosionAudio.ts](../../src/audio/ExplosionAudio.ts)
besitzt die Zuordnung und explizite Ersatzaufnahmen für noch unveröffentlichte Sounds.
Meteor-Snapshots steuern nur die Darstellung; der Einschlags-Sound kommt einmalig über den
Explosions-RPC, damit Snapshot-Entfernungen keinen zweiten Sound auslösen.

## Initialer Boot und Lobby-Bereitschaft

`ArenaScene.create()` startet den budgetierten Aufbau; Phasers `CREATE` bedeutet noch keine
Systembereitschaft. Die Scene bleibt waehrenddessen pausiert und unsichtbar, Eingaben gesperrt.
Gameplay-/Effekt-Callbacks werden erst nach Aufbau ihrer Abhaengigkeiten ohne weiteren
Yield registriert; Verbindungsfehler und Kick werden bis dahin gehalten. Neue Startschritte
muessen ihren Cleanup vor dem naechsten Yield fuer Shutdown und direkten Destroy besitzen.
Erst der abgeschlossene Aufbau erlaubt Updates. Der DOM-Bootscreen bleibt bis zur bestehenden
World-Reveal-Barriere nach einem Render bestehen; Direktbeitritte gehen weiterhin an den
Arena-Ladeschleier.

[BootLoaderProgress.ts](../../src/ui/BootLoaderProgress.ts) beruecksichtigt Download- und
Verarbeitungswarteschlangen gemeinsam; Phasers Download-`PROGRESS` allein ist keine
Asset-Bereitschaft. Der Balken zaehlt abgeschlossene Dateien, keine geschaetzte Restzeit.
Unmessbare Vorbereitungsarbeit zeigt Aktivitaet. `window.__FD_BOOT__` haelt Phasenzeitpunkte,
gemessene Aufbauabschnitte und die aktuell noch verarbeiteten Dateien fuer lokale Diagnose.

## Zweite Asset-Ladephase und Musik

[DeferredAssets.ts](../../src/assets/DeferredAssets.ts) besitzt die zweite Ladephase fuer die
Lebensdauer der ArenaScene. Nur zum Lobby-Reveal unnoetige Inhalte gehoeren in `DEFERRED_ASSETS`.
Lobby-Freigabe und direkte Arena-Einstiege starten denselben idempotenten Owner; UI und Audio
beobachten ihn. Audio ist erst nach Phasers Verarbeitung/Decodierung verwendbar. Browser-Freigabe,
Lautstaerke und Wiedergabe gehoeren dagegen allein dem Audio-System und sind keine Ladebedingungen.

Der Arenastart erweitert die World-Ladebarriere um die separat zu Spieler-Ready und World-Revision
replizierte Asset-Bereitschaft aller verbundenen aktiven World-Teilnehmer. Der lokale Arena-Aufbau
wartet vor der ersten Verwendung nachgeladener Inhalte; dieses Warten verbraucht keine
Descriptor- oder Terrain-Timeouts. Nur explizit optionale Inhalte duerfen nach begrenzten
Fehlversuchen fehlen; erforderliche Inhalte geben die Barriere bei Fehlern nicht frei.

## Designraum und Koordinaten

[src/graphics/RenderResolution.ts](../../src/graphics/RenderResolution.ts) hält Designraum, Renderauflösung, Device-Pixel-Ratio und Pointer-Umrechnung zusammen. Kamera und Canvas skalieren gemeinsam; die Kamera beginnt im Designraum am vereinbarten Ursprung, damit Screen-fixed UI und World-Inhalt nicht auseinanderdriften.

Roh-Pointerkoordinaten sind Renderpixel. Für UI-Rechnung werden sie in den Designraum umgerechnet; für World-Eingabe liefern Kamera-World-Point oder Phaser-Hit-Testing die korrekte Weltposition. Die unerschütterte Pointerposition wird für Gameplay verwendet, damit visuelles Camera-Feedback keine Ziel- oder Platzierungslogik verändert.

## Kameras und Klarheit

Die World-Kamera trägt World-FX und Camera-Feedback. Eine transparente Clarity-Kamera hält HUD und bewusst immer lesbare Overlays frei von diesen Effekten. [ClarityCameraRegistry.ts](../../src/scenes/arena/ClarityCameraRegistry.ts) und [clarityCameraAssignment.ts](../../src/scenes/arena/clarityCameraAssignment.ts) vergeben die Zuordnung opt-in und behandeln Container als Präsentationseinheit.

Camera-Feedback besitzt einen zentralen Owner: [CameraFeedbackController.ts](../../src/effects/camera/CameraFeedbackController.ts) und [CameraFeedbackModel.ts](../../src/effects/camera/CameraFeedbackModel.ts) sammeln, priorisieren, begrenzen und lösen Requests. Gameplay ruft keine direkten Kamera-Shakes auf; der Feedback-Offset verändert nicht die fachliche World- oder Pointer-Geometrie.

GPU-Fels-/Mauerflächen, Power-Up-Podeste und GPU-VFX verwenden
[GpuLayerCameraTransform.ts](../../src/graphics/GpuLayerCameraTransform.ts), damit ihre View-Matrix
auch in versetzten, gefilterten Kameras mit normalen Sprites übereinstimmt. Phaser 4.2.1 setzt
im GPU-Submitter sonst die externe Viewport-Verschiebung zusätzlich im Kamera-Framebuffer an.
Die Korrektur bleibt im Renderpfad; gespeicherte Weltpositionen bleiben unverändert.
[GpuLayerCameraTransform.test.ts](../../tests/GpuLayerCameraTransform.test.ts) prüft diese Parität
gegen die installierten Phaser-Methoden mit und ohne Kamera-Framebuffer und bei mehreren Skalierungen.

[CameraPostFxController.ts](../../src/effects/postfx/CameraPostFxController.ts) und [PostFxComposer.ts](../../src/effects/postfx/PostFxComposer.ts) halten Post-FX als visuelle, widerrufbare Komposition. Ein Effekt darf keine dauerhafte Spielregel oder kollisionsrelevante Farbe erzeugen.

## Runtime und Renderer

Phaser 4.2.1 verwendet fuer WebGL-`ADD` die Faktoren `(ONE, DST_ALPHA)` auch fuer RGB.
Farbmodulation auf deckenden World-/Kamerazielen muss deshalb deren Ziel-Alpha erhalten:
Schon ein abgesenktes Alpha laesst spaetere additive Draws den Hintergrund abdunkeln,
selbst unter transparenten Effekttexeln. Der Sonnen-Composite verwendet fuer RGB
`(DST_COLOR, SRC_COLOR)` und separat fuer Alpha `(ZERO, ONE)`; seine Quell-Alpha darf
nicht die Szenendeckung steuern. Normales PMA-Compositing bleibt unveraendert.
Private Material-, Masken-, Daten- und Filter-Zwischenziele duerfen transparente Alpha
tragen; diese Regel verlangt dort weder opake Clears noch eine pauschale Alpha-Klemmung.
Die Blend- und Folgedraw-Vertraege pruefen
[SunRenderQuality.test.ts](../../tests/SunRenderQuality.test.ts) und
[GpuVfxSystem.test.ts](../../tests/GpuVfxSystem.test.ts).


[LightingSystem.ts](../../src/effects/LightingSystem.ts) besitzt beide Licht-Composites:
MULTIPLY und den optionalen, weich gesättigten Bleed-Beitrag aus derselben Lightmap nach
Ambient-Abzug. Lichtquellen nutzen weiterhin ausschließlich die vorhandene Lightmap samt
Budget und Verdeckung. Beide Beiträge liegen vor den World-Kamerafiltern und unter den
Baumkronen; Clarity-Inhalte bleiben ungefiltert. `GraphicsQuality` kann Bleed unabhängig
abschalten, ohne Lichtquellen oder deren Simulation zu verändern.

Essenzlicht konsumiert ausschließlich zugriffsgefilterte Darstellungspositionen aus
[AdrenalineEssenceLighting.ts](../../src/adrenalineEssence/AdrenalineEssenceLighting.ts).
Alle sichtbaren, belegten Raumzellen gehen als geborgter Frame an `LightingSystem`,
das sie gemeinsam in dieselbe Lightmap zeichnet, ohne einzelne Essenzen nach dem
normalen Lichtbudget auszusortieren. Dichte Ansammlungen teilen Lichtflächen;
Qualitätsstufen verändern deren Renderauflösung statt ihrer Abdeckung. Der
Presentation-Owner entfernt seinen Frame bei Sichtbarkeitsverlust und Teardown.

Gegneraugen verwenden die `eyeAnchors` des importierten `PipelineAsset`: normalisierte
Ellipsen je Sprite-Frame, aus ausgewerteter Blender-Geometrie mit der Exportkamera und
denselben Animationssamples. Der Import bindet sie an Revision, Variante, Blend- und
PNG-Hashes; fehlende oder fremde Anker sind Assetfehler. Neue Rezepte liefern direkte
`eyeLeft`-/`eyeRight`-Mesh-Sockets. Historische Migrationen lesen ausschließlich die
ausgewählte archivierte Quelle und verändern weder Sprites noch Archive.

[EnemyEyeGlowRenderer.ts](../../src/effects/EnemyEyeGlowRenderer.ts) liest nach der
Gegner-Visual-Synchronisierung den tatsächlich angezeigten Frame und Sprite-Transform.
Gemeinsame GPU-Layer zeichnen die Augen über der Nachtabdunklung und unter Baumkronen.
Nur lebende, sichtbare feindliche Gegner liefern Augen und Licht. Ein geborgter,
wiederverwendeter Frame-Puffer geht vor dem Licht-Update an `LightingSystem`;
dessen separater GPU-Batch zeichnet schattenlose Bodenlichter ohne das normale
Lichtbudget zu belegen, auch bei niedriger Qualität. Die World-Frame-Bindung besitzt
die Freigabe; Presentation-Verlust, World-Wechsel und Teardown leeren die Daten.

Wasser besitzt getrennte World-Geometrie: [WaterGeometry.ts](../../src/arena/WaterGeometry.ts) sperrt Bodenabfragen, Platzierung und gesweepte Koerperbewegung auch bei deaktivierten Buddel-Collidern. Es hat keine HP und nimmt nicht an Schuss-, Sicht- oder Projektil-Hindernisabfragen teil; die Navigation fuehrt Wasser als ausdruecklich unpassierbar. [WaterSurfaceRenderer.ts](../../src/arena/WaterSurfaceRenderer.ts) gehoert ausschliesslich zur World-Praesentation: Maskentextur und Shader entstehen pro residentem Chunk, Uferdaten bleiben statisch, Animation verwendet gemeinsame Weltkoordinaten und lokale Zeit. Renderer-Teardown veraendert keine Wasser-Spielregel.

Wasser-CPU-Masken werden fuer die gesamte dargestellte World einschliesslich Ufer-Rand-Chunks
vor Reveal und repliziertem World-Ready vorbereitet. Der aktive Presentation-Frame taktet die
Vorbereitung in begrenzten Arbeitspaketen; Residency liest ausschliesslich fertige Masken.
Der Cache lebt mit der `WorldPresentationBinding`, bleibt bei GPU-Eviction und Handoff erhalten
und wird beim Presentation-Teardown zusammen mit angefangener Bake-Arbeit freigegeben. Ein
Handoff pausiert die Vorbereitung bis zur Adoption. Worlds ohne lokale Presentation tragen
keine Wasser-Renderkosten. Der Terrain-Farbsnapshot liest dieselben fertigen CPU-Masken
ueber eine schreibgeschuetzte Sicht und uebertraegt ihre Deckung in budgetierten Ladeabschnitten;
er backt keine zweite Wassergeometrie. Snapshot-Abbruch loest nur seine eigene Arbeit, nicht
den World-Maskencache. Die Verträge sichern
[WaterSurfaceRenderer.test.ts](../../tests/WaterSurfaceRenderer.test.ts),
[WorldPresentationFrameLifetime.test.ts](../../tests/integration/WorldPresentationFrameLifetime.test.ts)
und [LobbyWorldInteractive.test.ts](../../tests/integration/LobbyWorldInteractive.test.ts).

[ArenaBuilder.ts](../../src/arena/ArenaBuilder.ts) trennt Runtime-/Physik-Proxies von visuellen World-Objekten. Ohne Presentation werden World-Physik, Runtime-Geometrie und notwendige Indizes weiter aufgebaut; nur die visuellen Flächen, Overlays und Streamer entfallen. Renderer beobachten Runtime und werden bei Teardown vollständig gelöst.

Player- und Tree-Runtime folgen demselben Prinzip: PlayerBody und TreePhysicsProxy sind Simulation; Sprite, Licht, Textur und Overlay sind Präsentation. Kollisionen werden aus expliziter Runtime-Geometrie abgeleitet, nicht aus Displaymaßen.

Welt-HP-Balken beobachten bestaetigte HP-/Max-HP-Paare; Erstzustand, Respawn und bewusste
Resets sind stille Baselines, unveraenderte Refreshes keine Treffer. Der
[HealthBarFeedbackModel](../../src/effects/health/HealthBarFeedbackModel.ts) besitzt nur lokale
Feedbackzeit und Sichtbarkeit, keine Health-Authority. Der
[WorldHealthBarRenderer](../../src/effects/health/WorldHealthBarRenderer.ts) wird einmal nach
Zustands- und Positionssynchronisation vom Combat-Presentation-Controller getaktet. Seine
View-Pools sind scene-langlebig; Entity-Bindings und ihre HP-Historie enden mit dem jeweiligen
Owner. Der World-Presentation-Frame-Binding loest die verbleibenden World-Bindings vor dem
statischen Handoff. HP null verbirgt die Anzeige, invalidiert aber noch nicht das Handle:
Die echte Entity-Entfernung bleibt beim Lifecycle-Owner. Die Consumer- und Handoff-Vertraege
sichern [WorldHealthBarConsumers.test.ts](../../tests/integration/WorldHealthBarConsumers.test.ts)
und [WorldPresentationFrameLifetime.test.ts](../../tests/integration/WorldPresentationFrameLifetime.test.ts).

## Figuren- und Turmassets

`ShadowSystem` besitzt die worldgebundenen `CharacterShadowRenderer`-Ressourcen. Die Bindung an
Sonnenzustand und pausierbare Praesentationszeit kommt ausschliesslich von `WorldSunlightPresentation`;
World-Unbind und Low-Qualitaet zerstoeren Quads und Empfaengermaske, geteilte Loader-Texturen bleiben
game-owned. Schatten lesen den tatsaechlich dargestellten Sprite-Frame und dessen Rotation, nicht
Netzwerk-Facing oder eine eigene Animationsuhr. Azimut wird ueber den invers rotierten Lichtvektor
in Rechts/Sued-Achsen bestimmt; vier lineare non-PMA-Masken werden in einem Draw interpoliert.
Der Figurenschatten liegt auf dem dynamischen Schatten-Layer ueber Bodennebel und Bodenbewuchs,
aber unter Figuren; eine Empfaengermaske schliesst Basen und
Hindernisse aus und reduziert die Wasserantwort. Das Multiply-Blending erhaelt Ziel-Alpha.


Die versionierte [Runtime-Assetauswahl](../../src/config/pipelineAssets.json) und ihre PNGs unter
`public/assets/sprites/pipeline-v2/` sind unabhängig von lokalen Blender-Quellen. Statische Bilder
und animierte Sheets besitzen getrennte Texturschlüssel. Sheet-Geometrie und explizite Clipframes
stammen aus der Auswahl; der Ruheframe ist kein Teil des Bewegungsloops. Anzeigegrößen werden
aus den Figurenkonfigurationen abgeleitet. `PLAYER_VISUAL_SCALE` skaliert den Dachs in Arena,
Lobby-Vorschau und Köder rein visuell; Waffen und Sprite-Overlays folgen der Renderpose.
`PLAYER_SIZE` bleibt die Gameplay-Basis für Spieler- und Ködergeometrie sowie Gameplay-Mündungen.
Beim spritegebundenen Köder wird der visuelle Maßstab für den Arcade-Kreis herausgerechnet;
Hitscan-, Projektil- und Coop-Zielsichten verwenden ebenfalls die Gameplay-Größe.
[FigureSpriteGeometry.test.ts](../../tests/integration/FigureSpriteGeometry.test.ts) und
[HeldWeaponFire.test.ts](../../tests/integration/HeldWeaponFire.test.ts) sichern diese Trennung.
Arcade-Kreisradien werden in Quellpixeln gesetzt, damit die
Sprite-Skalierung den konfigurierten Weltdurchmesser erhält; Spieler-Overlays übernehmen den
aktuellen Texturframe und dessen Skalierung.

Bei Gegnern erweitert das importierte `PipelineAsset.displayScale` ausschließlich den
transparenten Bewegungsraum des Sprites. [EnemyEntity](../../src/entities/EnemyEntity.ts)
rechnet diesen Faktor aus dem zentrierten Arcade-Kreis heraus; Trefferabfragen verwenden
`getCollisionRadius()`. Augenanker und Silhouettenkopien folgen dem gesamten Canvas,
während körperbezogene Licht-, Markierungs- und Effektgrößen den Faktor herausrechnen.
Die im Blender-Clip vorgezogene Figur verschiebt weder Entity-Position noch Trefferkugel.

[BadgerAnimations.ts](../../src/animations/BadgerAnimations.ts) registriert optionale `idle`-Clips
aus derselben Assetauswahl wie den Lauf. Stehende aktive Figuren spielen diesen Clip ohne
Neustart bei wiederholter Synchronisation; Figuren ohne Idle-Clip und inaktive Spieler halten
den neutralen Ruheframe. Die Player-Presentation sperrt Atmung und Lauf bei Tod, Unsichtbarkeit
und den blockierenden Eingrabphasen. Die Animation verändert weder Kollisionsgeometrie noch
Gameplay-Zeit; [BadgerAnimations.test.ts](../../tests/BadgerAnimations.test.ts) prüft die Übergänge.

Der [TurretAnimationController](../../src/effects/TurretAnimationController.ts) bindet Basis- und
platzierbare Turmsprites an ihre bestehenden Turm-IDs. Bestätigte Projektilspawns treiben
Schussanimationen; die erste Client-Übernahme bleibt stumm. Tesla folgt dem replizierten
Kuppelzustand. Animationen schreiben keine Spielzustände zurück. Sprite-Zerstörung löst die
Bindung, World-Teardown leert auch Aktivität und verbleibende Bindungen.

## Pfadgebundene Projectile-Präsentation

[`WorldProjectileRuntime`](../../src/projectile/WorldProjectileRuntime.ts) besitzt den rendererfreien
[`ProjectilePathRecorder`](../../src/projectile/ProjectileFlightPath.ts) als abgeleitete World-Projektion.
Technische Bewegung bleibt bis zur Bestätigung durch den Runtime-Owner vorläufig; bestätigte Kontakte
begrenzen diese Strecke. Gameplay und Physik lesen den Präsentationspfad niemals zurück.
Bounce-Feedback bleibt am Kontaktpunkt; der Flight-Pivot verbindet die ankommende und ausgehende
Center-Bewegung. Collider-Separation und Sweep-Depenetration sind technische Urspruenge, keine
zusaetzlichen Flugsegmente. Erst neue Bewegung verlaengert den Pfad nach einem Bounce.
Verworfene Physics-Beobachtungen geben keine Sprite-Position frei: Nach einem Kontakt muss eine
frische Physics-Beobachtung mit dem synchronisierten Sprite uebereinstimmen, bevor dessen Position
wieder als Bewegung aufgezeichnet wird.
Bounce-Punkte bleiben Ecken, räumliche Unterbrechungen werden nicht verbunden. Die Historie ist nach
Alter und Punktzahl begrenzt; nur unveränderte geradlinige Bewegung darf zusammengefasst werden.
Pfadzeiten sind die Host-Zeit des Physikzustands: Host-Uhr minus Fixed-Step-Rückstand der Physik
(`getStepLagMs`), nicht die gemeinsame Frame-Uhr. Mehrere Schritte eines Frames erhalten so getrennte
Zeiten. Ein Darstellungskopf, der auf der bestätigten Spitze ruht, wird nicht neu gestempelt; sonst
entstünde eine Zeittreppe aus erfundenem Stillstand und Sprüngen ohne Dauer. Segment-Konsumenten
müssen dennoch einzelne Null-Längen- oder Null-Dauer-Segmente (Kontakte, Bounces) ohne Bruch tragen.

Ein zeitlich fortschreitender Cursor konsumiert bestätigte Segmente einmalig. Flight Signature,
Rocket-Smoke und Projectile-Burn teilen den neutralen Distanz-Sampler, besitzen aber eigene Dichten,
Paletten und Lebenszeiten. Rocket-Exhaust bleibt zeitbasiert an der dargestellten Triebwerksposition.
Kopfgebundene Akzente gehören weiterhin den spezialisierten Projectile-Renderern.

Flammenketten verwenden den optionalen, replizierten `flameStreamKey` aus dem
Projectile-Presentation-Vertrag. Unabhängige bewegliche Quellen desselben Besitzers benötigen
unterschiedliche Schlüssel; ohne expliziten Schlüssel bleibt die Zuordnung zum Quellturm oder
Besitzer bestehen. Dieser Darstellungsschlüssel verändert weder Provenance noch Team oder
Schadenszuordnung. Den Vertrag sichern die Projectile-Snapshot- und Presentation-Runtime-Tests.

Flight-Material wird nach dem GPU-Retire-Sweep emittiert: zuerst alle kritischen Cores, danach Wake
und Dekoration. Historische Spawns setzen GPU-Animationsalter und Pool-Restlebenszeit gemeinsam;
abgelaufenes Material wird verworfen. Core und Haupt-Wake verwenden zusammenhängende GPU-Ribbons:
gemeinsame Knoten bewahren Position und Entstehungszeit; neue Nachbarn dürfen nur den geometrischen
Anschluss ergänzen. Alterung läuft entlang der Fläche, nicht einheitlich je Sprite. Die Ribbon-
Geometrie und die Sprite-Dekoration teilen Budget, Prioritäten, Source-Lifetime und Profiler der
Flight-Lane. Ribbon-Handles gehören einer Präsentationsinstanz; wiederverwendete Projectile-IDs
oder unterbrochene Historien verbinden keine alten Trails. Die historischen Mittellinien werden
bei Bounce oder Despawn nicht umorientiert oder gelöscht. World-Teardown entfernt auch nachlaufende Member, Cursor,
gepufferte Pfade und ausstehende Emissionen. Details der Client-Zeitbasis stehen in
[networking.md](networking.md#projectile-flight-replikation).

## GPU-VFX-Framefolgen

Ein `GpuVfxSpawnSpec` darf optional eine benannte One-Shot-Framefolge aus
[`GpuVfxFrameAnimations.ts`](../../src/effects/gpu/GpuVfxFrameAnimations.ts) waehlen. Alle Frames
liegen bereits beim Bau in [`GpuVfxAtlas.ts`](../../src/effects/gpu/GpuVfxAtlas.ts); die nutzende
Render-Lane registriert ihre Folgen vor dem ersten geprimten Member. Ohne diese Option bleibt der
statische Frame-Pfad unveraendert.

Der Death-Disintegration-Effekt kombiniert auf der bestehenden Gore-Lane lange Cohesion mit einem
GPU-seitigen Fragment-zu-Staub-Morph und einer spaet beschleunigenden Release-Bewegung. Farbe und
Silhouette stammen weiterhin aus dem replizierten Texture-/Frame-Snapshot und dessen lokal
analysierten Chunks; einzelne Fragmentzustaende werden nicht repliziert.

## Große World-Flächen

Statische World-Flächen werden über Chunking und Streaming resident gehalten. [ChunkedRenderSurface.ts](../../src/arena/chunks/ChunkedRenderSurface.ts), [GroundSurfaceStreamer.ts](../../src/arena/chunks/GroundSurfaceStreamer.ts) und [RockOverlayStreamer.ts](../../src/arena/chunks/RockOverlayStreamer.ts) begrenzen sichtbare Arbeit, recyceln Ressourcen und veröffentlichen neu gebackene Flächen atomar.

Der Renderer darf daher nicht voraussetzen, dass die gesamte World als eine ständig neu gezeichnete Fläche vorliegt. Cleanup und Pool-Recycling gehören zur Renderer-Lifetime.

Felsen: `RockVisualState.frame` ist immer der 47-Blob-Frame (Retiling, Moos- und Vegetationsmasken). Textur und Frame der gezeichneten Felsbasis leiten GPU- und Classic-Renderer, Overlay-Silhouette und Trümmer ausschließlich über `resolveRockTexture` aus Frame und Rasterposition ab ([RockBaseConfig.ts](../../src/arena/RockBaseConfig.ts)); die Kollision bleibt die volle Rasterzelle.

Persistente GPU-/World-Flächen gehören zur World- und Chunk-Lifetime; transiente VFX gehören zur Effects-Lifetime. Beide Ressourcenklassen werden getrennt erzeugt, aktualisiert und beim jeweiligen Owner-Teardown freigegeben.

## DOM und Vollbild

DOM-Overlays liegen unter demselben Game-Container, der auch Parent und Fullscreen-Target ist. [src/ui/fullscreen.ts](../../src/ui/fullscreen.ts) ist der Owner dieser Grenze; neue Overlay-Wurzeln dürfen nicht außerhalb des Vollbildcontainers entstehen.

## Verifikation

Sichtbare Phaser- oder UI-Änderungen werden mit npm run build geprüft. Browser, Dev-Server und Screenshots sind opt-in und nur nach ausdrücklicher Aufforderung auszuführen. Für visuelle Lesbarkeit gilt zusätzlich [visual-guidelines.md](visual-guidelines.md).

## Sonnenwald-Assetvertrag

Unveränderliche Woodland-Texturen gehören dem Game-Asset-Cache.
[WoodlandAssets.ts](../../src/assets/WoodlandAssets.ts) lädt sie über den regulären Scene-Loader;
World-Renderer leihen sie und entfernen sie nicht beim World-Teardown. Fehlende Pflichtassets
blockieren die Boot-Vorbereitung und benutzen die vorhandene Fehler-/Retry-Anzeige.

Kronen-Normalen/AO/Dicke und Horizonte sind lineare UNORM-Daten: Alpha ist ein Datenkanal,
keine Transparenz. Der Upload erfolgt ohne Alpha-Premultiplikation und ohne Canvas-Roundtrip.
Die Mineral-Coverage liegt als CPU-Alpha im Binary-Cache; Worker erhalten eine Kopie,
damit Transferables den gemeinsamen Cache nicht ablösen. Der Loader wählt genau eine
V7-Farbauflösung (1× oder 2×) anhand der GPU-Texturgrenze; Framegröße, Margin und Spacing
skalieren gemeinsam. Auswahl und Speicherbilanz besitzt
[WoodlandAssetManifest.ts](../../src/assets/WoodlandAssetManifest.ts).

## Sonnenwald-World-Presentation

[WorldSunlightPresentation](../../src/effects/sunlight/WorldSunlightPresentation.ts) besitzt den
Sonnenzustand und die aktiven Materialbindungen einer lokal dargestellten World.
[WorldComposition](../../src/world/WorldComposition.ts) bindet ihn am
[WorldPresentationFrameBinding](../../src/world/WorldPresentationFrameBinding.ts);
der eigenständige [Basis-Editor](../../src/persistentBase/PersistentBaseEditorWorld.ts) verwendet
denselben Owner. Activity, Runde und Netzwerkrolle erzeugen keinen zweiten Sonnen-Writer.
Felsen und Kronen entstehen beim regulären Aufbau mit ihren Produktionsmaterialien.

Ein Terrain-Handoff überträgt statische Oberflächen, nicht den Sonnen-Owner.
`WorldRuntime.releasePresentation()` löst vorher die Framebindung: Empfänger werden entkoppelt,
danach temporäre Sonnenfelder, Kronen-Renderrollen und Vegetationslicht freigegeben.
Die neue World bindet ihren eigenen Zustand; Woodland-Assets bleiben im Game-Cache.
Zerstörte Owner reagieren weder auf spätere Frames noch auf Debug-Overrides.

Die Tageszeit stammt aus der bestehenden replizierten World-Uhr. Wind-/Wolkenbewegung und
Uhrsprung-Blenden verwenden lokale, pausierbare Präsentationszeit; sie erzeugen keinen
zusätzlichen replizierten Zustand. Defaults, Limits und Atmosphären-Keyframes gehören
[src/config/sunlight.ts](../../src/config/sunlight.ts); Dev-Overrides schreiben durch denselben Owner.

Die Depth-Reihenfolge ist Teil des Beleuchtungsvertrags:

- Fische liegen über Wasser, unter schwimmender Flora; diese und Landtiere liegen unter Bodennebel.
- Beleuchteter Bodennebel liegt über Felsbewuchs, aber unter Figuren; ohne aktive Sonne verwendet
  er `GROUND_FOG`. Die Sonnenmodulation liegt unter Projektilen und erfasst so Welt, Nebel und Figuren.
- Die Lichtkarte liegt unter Kronen. Kronen erhalten Sonnen-, Ambient- und lokale
  Lichtbeiträge im eigenen Material. Ambient und lokale Lichter werden als Irradianz genau einmal
  verbraucht; weißer Vertex-Tint verhindert einen zweiten Kronen-Tint.
- Glühwürmchen bleiben emissiv über der Lichtkarte; ihre Nebeldämpfung gehört ihrem Material.

Maßgeblich sind [DEPTH](../../src/config.ts), [WorldSunComposite](../../src/effects/sunlight/WorldSunComposite.ts),
[FogGpuField](../../src/effects/groundFog/FogGpuField.ts) und
[AmbientWildlifeRenderer](../../src/arena/AmbientWildlifeRenderer.ts).

Das großflächige Lichtmuster stammt aus den weltverankerten Wolkenöffnungen. Sonnenazimut und
Elevation verändern geometrische Schatten und Material-Formlicht, nicht die Koordinaten dieses Feldes.
Boden, Wasserlicht, Nebel und Pflanzenschatten lesen dieselbe Öffnung. Die Nebelstreuung enthält
keine Blattkonturen; ihre Kompensation verwendet exakt den Composite-Faktor, damit Nebel nicht
zweimal beleuchtet wird. Der gemeinsame Owner und die pausierbare Präsentationszeit gelten auch
für den analytischen Fallback ohne Wolkentextur.

### Atmosphäre und fachliche Grade-Komposition

[CameraPostFxController](../../src/effects/postfx/CameraPostFxController.ts) hält `WorldGradeInputs`
neben der Sonnenbasis. `resolveBaseGrade` verwendet die Sonnenatmosphäre als Basis und wendet danach
Void (authored `trackMode`), Bossprofil und lokale Verletzung an. Erst `composePostFx` legt
Ereignispulse darüber. Sonnen-Updates dürfen diese fachlichen Kanäle nicht überschreiben;
die Reihenfolge der Updates beider Eingänge verändert das Ergebnis nicht. Dauerbild und Pulse
behalten die getrennten Clamp-Verträge in [worldGrade.ts](../../src/effects/postfx/worldGrade.ts).

Fels-Horizonte unterscheiden Geometrie-Revision und Sonnenrichtung. Ein Richtungswechsel entwertet
keinen geometrisch gültigen laufenden Bake: Sein Ergebnis darf als Zwischenstand erscheinen und
wird anschließend auf die neueste Richtung nachgeführt. Geometrieänderungen, insbesondere
Zerstoerung, verwerfen veraltete Ergebnisse. Geometrie-Reparaturen werden als gemeinsame Worker-Transaktion
ueber betroffene residente Chunks veroeffentlicht; bis dahin bleibt der letzte exakte Feldstand erhalten.
Die gemeinsamen Empfaenger (Felsoberflaeche, Boden und Felsbewuchs) lesen denselben Stand.
Nur Sonnenrichtungswechsel verwenden Horizont-Blends auf der pausierbaren Praesentationsuhr,
Geometrie-Reparaturen schreiben weder Zellraster-Schaetzungen noch einen Reparatur-Fade.
Uebertragene Worker-Ergebnisse sind Kopien; der begrenzte Geometrie-Cache behaelt seine eigenen Buffer.

## Runtime-Asset-Vertrag

Farbtexturen werden durch `scripts/prepare-runtime-assets.mjs` verlustfrei veroeffentlicht.
`src/assets/RuntimeAssetUrls.ts` bindet logische Loader-Pfade an den Inhalts-Hash der tatsaechlich
geladenen Datei, auch fuer Deferred-Assets und Retry. Logische Asset-IDs bleiben stabil.
Die PNG-Exportzwischenprodukte bleiben fuer Offline-Paritaetspruefungen vorhanden.
Bei premultipliziert hochgeladenen Farbtexturen sind Alpha und RGB bei Alpha > 0 exakt;
unsichtbares RGB darf nur dort entfallen. Datenatlanten behalten alle Kanaele, auch RGB
unter Alpha 0, und ihren bisherigen non-PMA-Upload. Farbkompression darf nicht auf Daten
uebertragen werden. Nach einem Export aktualisiert `npm run assets:runtime` die Runtime-Dateien
und URL-Versionen; die Build-Scripts fuehren diesen Schritt automatisch aus.

Culling und Residency verwenden das sichtbare Weltrechteck aus `src/graphics/CameraWorldView.ts`: Die Berechnung ber�cksichtigt Kamera-Ursprung, Zoom und Rotation aus dem aktuellen Zustand. `camera.worldView` kann vor `preRender` veraltet sein und bildet den Arena-Ursprung nicht korrekt ab. Frame-Consumer reichen wiederverwendbaren Ausgabespeicher ein.

Loadout-/Upgrade-Icons, Decals und Groundcover verwenden getrennte Offline-Atlanten.
`src/assets/RuntimeAtlases.ts` loest logische IDs in Textur-Key und Frame auf; Existenzpruefungen
muessen beide pruefen. UI und Bake-Images verwenden dieses Paar. CPU-/Canvas-Leser schneiden
mit `Frame.cutX/cutY/cutWidth/cutHeight` aus, statt das gesamte Atlasbild als Einzelbild zu lesen.
Die Vollbild-Geometrie bleibt unbeschnitten und ungedreht; Randextrusion verhindert Filter-Bleeding.

## Private WebGL-Paesse und VAOs

Bei rohen GL-Paessen ist `ELEMENT_ARRAY_BUFFER` Teil des gebundenen VAO, nicht nur
ein globales Binding. Phasers `WebGLVAOWrapper.bind()` aktualisiert den globalen
Indexbuffer-Cache nicht. Beim erzwungenen Zuruecksetzen daher zuerst ein privates
VAO binden und globale Bindings wiederherstellen, Phasers VAO erst danach:
`glWrapper.update(undefined, true, true)` (`vaoLast`). Andernfalls kann ein fremder
oder leerer Indexbuffer in Phasers VAO geschrieben werden. Dies gilt auch fuer
Upload-only-Paesse. Owner: [RockFormationGpuRepair.ts](../../src/arena/rocks/RockFormationGpuRepair.ts);
Vertragstest: [RockFormationLighting.test.ts](../../tests/RockFormationLighting.test.ts).

Private Datentextur-Uploads muessen `UNPACK_PREMULTIPLY_ALPHA_WEBGL` und
`UNPACK_FLIP_Y_WEBGL` auch vor `texSubImage2D` explizit deaktivieren und danach den
Caller-Zustand restaurieren. Das einmalige Setzen bei `texImage2D` reicht nicht:
Phasers Farb-Uploads koennen die Flags zwischen Daten-Updates umschalten.
RGBA-Daten duerfen bei Alpha 0 beliebige RGB-Werte tragen (etwa Sonnenproben).
