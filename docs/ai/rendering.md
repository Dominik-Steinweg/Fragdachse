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

Zusatzzoom der Weltkamera multipliziert den Designzoom und ist nie kleiner als 1: Die Standardansicht ist die weiteste Sicht. Der Spieler wählt per Mausrad eine Grundsicht ([PlayerCameraZoom.ts](../../src/effects/camera/PlayerCameraZoom.ts)), Spawn- und Todesnahaufnahme ([SpawnCameraZoom.ts](../../src/effects/camera/SpawnCameraZoom.ts)) setzen darauf auf, ein Boss-Intro ([cameraFocusOverride.ts](../../src/graphics/cameraFocusOverride.ts)) gewinnt nur, wenn es näher heranholt. Allein die Kameraverfolgung in [WorldPresentationFrameBinding.ts](../../src/world/WorldPresentationFrameBinding.ts) wendet den Zoom an. Sie glättet den gezeigten Weltpunkt, nie den geklemmten Ausschnitt; der Ausschnitt entsteht jeden Frame exakt aus Punkt, Zoom und Klemmung, sonst zöge die Kamera am Arenarand nach jeder Zoomänderung nach. Die Residency hält während eines Zooms die Standardansicht vor, World-Teardown setzt den Zoom zurück. Kameras, die die Verfolgung ersetzen (Dev-Szenario), lesen den angewandten Faktor über `getAppliedStagedZoom`. Bildschirmfeste Ebenen, die Weltpunkte selbst in Designkoordinaten umrechnen, multiplizieren mit dem Zusatzzoom (`camera.zoomX` geteilt durch die Renderskalierung), siehe `resolveRadialFocusFrame` in [radialFocusState.ts](../../src/effects/postfx/radialFocusState.ts).

GPU-Fels-/Mauerflächen, Power-Up-Podeste und GPU-VFX verwenden
[GpuLayerCameraTransform.ts](../../src/graphics/GpuLayerCameraTransform.ts), damit ihre View-Matrix
auch in versetzten, gefilterten Kameras mit normalen Sprites übereinstimmt. Phaser 4.2.1 setzt
im GPU-Submitter sonst die externe Viewport-Verschiebung zusätzlich im Kamera-Framebuffer an.
Die Korrektur bleibt im Renderpfad; gespeicherte Weltpositionen bleiben unverändert.
[GpuLayerCameraTransform.test.ts](../../tests/GpuLayerCameraTransform.test.ts) prüft diese Parität
gegen die installierten Phaser-Methoden mit und ohne Kamera-Framebuffer und bei mehreren Skalierungen.

[CameraPostFxController.ts](../../src/effects/postfx/CameraPostFxController.ts) und [PostFxComposer.ts](../../src/effects/postfx/PostFxComposer.ts) halten Post-FX als visuelle, widerrufbare Komposition. Ein Effekt darf keine dauerhafte Spielregel oder kollisionsrelevante Farbe erzeugen.

## Runtime und Renderer

Phasers `RESTORE_WEBGL` stellt die WebGL-Ressourcen wieder her, rekonstruiert aber nicht
den zuvor ausschliesslich auf der GPU gezeichneten Inhalt von Render-Targets.
Owner solcher Inhalts-Caches invalidieren deshalb ihre Gueltigkeitsmerkmale und zeichnen
ueber ihren bestehenden Update- oder Bake-Pfad erneut, auch wenn Kamera und Zeit unveraendert sind.
[ChunkedRenderSurface.ts](../../src/arena/chunks/ChunkedRenderSurface.ts) behaelt dabei seine
budgetierte Chunk-Bereitschaft; [LightingSystem.ts](../../src/effects/LightingSystem.ts) und
[CloudFieldTexture.ts](../../src/effects/sunlight/CloudFieldTexture.ts) erneuern ihre jeweils
gecachten Licht- und Wolkeninhalte beim naechsten Update.
Der jeweilige Owner meldet seinen Renderer-Listener beim Teardown wieder ab.

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

Fliegende Drohnen besitzen keinen eigenen Lichtcode. Ihr Renderer reicht je angezeigter
Drohne Pose und ein Profil aus Lichtankern bei
[DroneNavLightRenderer.ts](../../src/effects/droneNavLights/DroneNavLightRenderer.ts) ein;
Farben, Beacon-Takt, Tag/Nacht-Verhalten, Kronenband und die begrenzten Bodenlicht-Pools
gehören dem gemeinsamen Modell. Der szenenweite Layer schreibt nur die im aktuellen Frame
eingereichten Lichter, sodass entfernte Drohnen nie Lichter zurücklassen. Die Lichtfarben
bleiben im Farbton von Gegneraugen, verbündeten Effekten, Telegraph-Rot und Feuerleit-Mint
getrennt ([DroneNavLightModel.test.ts](../../tests/DroneNavLightModel.test.ts)).

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

Stoerungen der Wasseroberflaeche (Wellenringe, Aufwoelbungen, Strudel, Kielwasser, kleine Einschlaege)
gehoeren in die Flaeche selbst: Praesentations-Owner reichen sie pro Frame ueber
`WaterDisturbanceField.for(scene)?.submit(...)` ein ([WaterDisturbanceField.ts](../../src/arena/WaterDisturbanceField.ts)).
Das Feld gehoert zum `WaterSurfaceRenderer` (World-Lifetime, GPU-Ziel erst beim ersten Einreichen) und
wird vom Wassershader in dessen eigenem Licht schattiert (Himmelsreflex, Sonnenglanz, Schaum als
Rauschspitze). Overlays zeichnen nur, was ueber der Oberflaeche liegt (Gischt, Nebel, Koerper unter
Wasser); Spielregeln lesen das Feld nie.

Was ins Wasser faellt, wird Faerbung des Wasserkoerpers statt Decal: Owner leihen dem Renderer ueber
`WaterSurfaceRenderer.setDye(...)` eine Textur (Dichte in B, optional ein Farbton) ueber einem Weltrechteck;
der Wassershader faerbt nur den Koerper, vor Reflexen, Wellen und Glanz. Landmarken liegen unter
`DEPTH.WATER`, damit das Wasser sie verdeckt. Beispiel: das Blutfeld ([BloodFieldSystem.ts](../../src/effects/blood/BloodFieldSystem.ts)).

[ArenaBuilder.ts](../../src/arena/ArenaBuilder.ts) trennt Runtime-/Physik-Proxies von visuellen World-Objekten. Ohne Presentation werden World-Physik, Runtime-Geometrie und notwendige Indizes weiter aufgebaut; nur die visuellen Flächen, Overlays und Streamer entfallen. Renderer beobachten Runtime und werden bei Teardown vollständig gelöst.

Player- und Tree-Runtime folgen demselben Prinzip: PlayerBody und TreePhysicsProxy sind Simulation; Sprite, Licht, Textur und Overlay sind Präsentation. Kollisionen werden aus expliziter Runtime-Geometrie abgeleitet, nicht aus Displaymaßen.

Welt-HP-Balken beobachten bestaetigte HP-/Max-HP-Paare; Erstzustand, Respawn und bewusste
Resets sind stille Baselines, unveraenderte Refreshes keine Treffer. Der
[HealthBarFeedbackModel](../../src/effects/health/HealthBarFeedbackModel.ts) besitzt nur lokale
Feedbackzeit und Sichtbarkeit, keine Health-Authority. Der
[WorldHealthBarRenderer](../../src/effects/health/WorldHealthBarRenderer.ts) wird einmal nach
Zustands- und Positionssynchronisation vom Combat-Presentation-Controller getaktet. Er zeichnet
alle sichtbaren Balken einer Familie als Instanzen eines gemeinsamen SDF-Layers
([BarSdfGpu](../../src/effects/bars/BarSdfGpu.ts), ein Draw je Familie und Tiefe); diese Layer
sind scene-langlebig, Entity-Bindings und ihre HP-Historie enden mit dem jeweiligen Owner. Der World-Presentation-Frame-Binding loest die verbleibenden World-Bindings vor dem
statischen Handoff. HP null verbirgt die Anzeige, invalidiert aber noch nicht das Handle:
Die echte Entity-Entfernung bleibt beim Lifecycle-Owner. Die Consumer- und Handoff-Vertraege
sichern [WorldHealthBarConsumers.test.ts](../../tests/integration/WorldHealthBarConsumers.test.ts)
und [WorldPresentationFrameLifetime.test.ts](../../tests/integration/WorldPresentationFrameLifetime.test.ts).

## Figuren- und Turmassets

`ShadowSystem` besitzt die worldgebundenen `CharacterMeshShadowRenderer`-Ressourcen.
Auch die gemeinsame `CharacterShadowReceiver`-Maske gehoert `ShadowSystem`, unabhaengig von
Spielern und Qualitaetsstufe. Weitere Figuren-Caster leihen sie ueber `borrowFigureEnvironment`;
bei World-/Qualitaetswechsel werden ihre Borrower vor der Maske entkoppelt.
Sonnenzustand und pausierbare Praesentationszeit kommen von `WorldSunlightPresentation`;
World-Unbind und Qualitaetswechsel geben Masken-Slots, Geometriebuffer und Empfaengermaske frei.
Ein Gegner-Meshschatten gehoert zur Sheet-Revision, aus der er gebacken wurde, und wird ueber das
dargestellte Runtime-Asset (`imageKey`) gefunden, nicht ueber die Gegnerart; ein Sheet anderer
Revision (etwa ein Animationsentwurf) behaelt den Ellipsenschatten
([EnemyMeshRenderer.test.ts](../../tests/EnemyMeshRenderer.test.ts)).
Die binaeren, hashgebundenen Meshdaten bleiben im game-owned Loader-Cache. Schatten lesen den
tatsaechlich dargestellten Sprite-Frame und dessen Rotation, nicht Netzwerk-Facing oder eine
eigene Animationsuhr. Meshpositionen sind X rechts, Y Sued, Z oben; Projektion erfolgt erst nach
Instanz-/Hand-Socket-Transformation entlang des kontinuierlichen Welt-Sonnenvektors.
Hand-Socket und Rueckstosspose binden Waffenbild, visuellen Muendungspunkt und Waffenproxy
aneinander; Gameplay-Muendungen bleiben unabhaengig vom Renderpose-Vertrag.
Koerper und Waffe schreiben eine Vereinigungsmaske ohne Alpha-Akkumulation. Erst deren weiche
Komposition liegt ueber Bodenbewuchs und unter Figuren sowie deren gemeinsamem Nebelpass. Die Empfaengermaske schliesst
Basen/Hindernisse aus und reduziert die Wasserantwort; PMA-Multiply erhaelt Ziel-Alpha.
Low verwendet die Spielerellipse; die gebackenen D-Masken werden nicht geladen.

Die versionierte [Runtime-Assetauswahl](../../src/config/pipelineAssets/assets/) (ein Eintrag je Datei,
Zugriff in Skripten nur über `scripts/asset-pipeline/pipeline-registry.mjs`) und ihre PNGs unter
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

## Portale

Alle Portale teilen eine Darstellung: Translokator-Paare, Feuerleit-Ausgänge und Mündungsportale,
Generator-Portale und die Landepunkt-Vorschau. Ihre Owner leiten je Frame `PortalEndView`s aus
repliziertem oder lokalem Zustand ab und reichen sie unter einem eigenen Owner-Schlüssel an die
World-weite [PortalPresentation](../../src/effects/portal/PortalPresentation.ts) im `RendererBundle`
(`submit`/`clear`). Diese besitzt den GPU-Layer ([PortalGpuLayer](../../src/effects/gpu/PortalGpuLayer.ts),
Bodenmaterial unter den Figuren, Leuchtrand und Partikel über der Lightmap), Teleport- und
Kollaps-Ereignisse, die Portal-Lichter und die Zielansicht aus dem Terrain-Farb-Snapshot.

- Ein Anwendungsfall wählt nur einen Stil aus [PortalStyle](../../src/effects/portal/PortalStyle.ts)
  und befüllt die Ansicht (Partner, Öffnung, Lebens- oder Ladeanzeige); Form, Bewegung, Partikel und
  Transfer-Effekt bleiben gemeinsam. Neue Portalarten bauen keinen eigenen Portal-Renderer.
- Teleport-RPCs tragen nur Punkt und Farbe. Richtung und Stil ergeben sich aus dem dort
  eingereichten Ende und seinem Partner (`playFlashAt`); ein Punkt ohne Ende bleibt ungerichtet.
- Die Darstellung entscheidet nichts: Übertritt, Gates und Kollaps-Wirkung gehören dem Transport
  (siehe [gameplay.md](gameplay.md)).

## Lobby-Bauwerke

Die vier Menü-Bauwerke der LobbyWorld entstehen je aus einem Blender-Export
([export-lobby-structures.mjs](../../scripts/asset-pipeline/export-lobby-structures.mjs)): Beauty, Albedo,
Elevation (Höhe + oktaedrische Normale), Emissionsschichten, Solid-Maske und Sockets im Manifest
[lobby-structures.json](../../src/assets/manifests/lobby-structures.json). Aus derselben Solid-Maske wird die
Kontur in [lobbyStructureOutlines.json](../../src/config/authoring/lobbyStructureOutlines.json) abgeleitet
(`sourceSha256` bindet beide); Kollision, Nebelbarriere, Figurenschatten-Ausschluss und Shift-Annäherung lesen nur
diese Kontur, nie Texturen zur Laufzeit.

Die Bauwerke erscheinen mit den Host-Freischaltungen: keines vor `persistentBaseUnlocked`, danach Werkstatt und
Bauhof, mit `lobbyItemsUnlocked` die Waffenkammer, mit `lobbyDawnUnlocked` der Händler. Die Voraussetzungen stehen je
Gebäude in `requires` (Basis-Feld `requiresWorldParameters`, Darstellung und Shift über `lobbyBuildingsOfWorld`); die
Flags reisen im WorldDescriptor, Clients sehen also die Lobby des Hosts. Der Zugriff bleibt personenbezogen (Bauhof: Host).

- [LobbyStructureRenderer](../../src/arena/lobbyStructures/LobbyStructureRenderer.ts) stellt den Körper ins
  Wachturm-Band (`DEPTH.ROCKS + .15`); Decals, Blut und Bodenschatten liegen darunter, Sonnen-Composite, Lightmap
  und Nebel-Composite darüber.
- Licht am Material ist ein MULTIPLY-Relief über der Albedo mit derselben `formationResponse` wie die Felsen,
  Eigenschatten aus der Höhe in Sonnenrichtung und Lampen-/Mondrelief über `surfaceNightResponse`. Sonne, Wolken,
  Mond und Relieflampen leiht allein `WorldSunlightPresentation` (Ziel `structures`); Low zeigt die Beauty.
- Der Bodenschatten ist ein Höhenfeld-Raymarch mit Peilung und Profil aus `ShadowSystem.getLongCasterFrame`;
  er gehört nie in den Chunk-Bake. Er liest nicht die Elevation, sondern den Export `caster-height`: nur
  Solid-Geometrie (keine Seile, Heringe, begehbaren Böden), max-gepoolt auf 2 px je Texel, und marschiert kürzer
  als ein Texel. Sonst zerfallen dünne Teile und streifende Kanten im Schrittraster zu Zähnen.
- Emissionsschichten liegen über der Lightmap (ADD, `emissiveAlpha`); `forge` und `cyan` tragen eine Tagesgrundhelligkeit,
  `lamp` folgt `getArtificialLightFactor`. Socket-Lichter nutzen eigene Presets.
- Die Solid-Maske ist der Nebel-Dachstempel (`getFogSurfaceStamps`); eine eigene Dunstschicht gibt es nicht.
- Mitarbeiter sind reine Präsentation ohne Körper und Netzwerk:
  [LobbyStaffModel](../../src/arena/lobbyStructures/LobbyStaffModel.ts) entscheidet Arbeit, Hinwenden und Gruß,
  Clip-Marker lösen GPU-Funken über das gemeinsame `GpuVfxSystem` aus.

## Persistenter Basiskern als Fort

Der freundliche persistente Kern (die Basis mit `persistentReservationRadiusCells`) zeichnet keine 47-Blob-Kacheln,
kein Akzentleuchten und keine `baseGlow`-Lichter, sobald seine Blender-Passes geladen sind; ihn stellt der
[BaseFortRenderer](../../src/arena/baseStructures/BaseFortRenderer.ts) des BaseManagers dar
([export-base-structures.mjs](../../scripts/asset-pipeline/export-base-structures.mjs),
[base-structures.json](../../src/assets/manifests/base-structures.json)). Kollision, HP, Lichtverdeckung und
Turmzellen bleiben zellbasiert; das Fort präsentiert sie nur.

- Ein Rezept-Build liefert zwei Teile: den Bau (Relief, Raymarch-Schatten und Emission wie bei den Lobby-Bauwerken,
  Körper unter Turm-Aura und -Sprite) und eine durchscheinende Bodenschicht (`fdGround`) in `DEPTH.BASES` über dem
  Baubereichskies. Die Bodenschicht liegt über den Boden-Chunks und bekommt deren Sonnenschattierung nicht; ein
  fester Tint gleicht sie an.
- Fackeln und Laternen sind Sockets; nur Laternen und große Fackeln setzen kleine Lightmap-Lichter, sonst überflutet
  die Summe der Lichter das Fort.
- Der Zellzerfall blendet den Bau stufenweise aus; die Solid-Maske ist der Nebelstempel.

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
- Bodennebel wird bei Tag und Nacht einmal auf `GROUND_FOG_COMPOSITE` über Figuren, getragenen
  Waffen und Figurenschatten komponiert. Alle erhalten dieselbe lokale Nebeldeckung und dieselben
  Bewegungsspuren; Schatten verdunkeln so nicht das Streulicht. Figurenanzeigen und Projektile
  liegen darüber. `GROUND_FOG` bleibt der untere Anker für bodengebundene Effekte und Flächen,
  damit deren Zeichenreihenfolge unabhängig vom Nebelpass bleibt. Die Sonnenmodulation liegt
  unter Projektilen und erfasst Welt, Nebel und Figuren.
- Die Lichtkarte liegt unter Kronen. Kronen erhalten Sonnen-, Ambient- und lokale
  Lichtbeiträge im eigenen Material. Ambient und lokale Lichter werden als Irradianz genau einmal
  verbraucht; weißer Vertex-Tint verhindert einen zweiten Kronen-Tint.
- Glühwürmchen bleiben emissiv über der Lichtkarte; ihre Nebeldämpfung gehört ihrem Material.
- Vögel am Boden liegen bei den Landtieren unter dem Bodennebel, ihre Flugschatten im Band der
  Figurenschatten (unter Nebel und Kronen). Niedriger Flug liegt über dem Nebel-Composite, aber unter
  Sonnenpass und Lichtkarte: Er wird wie der Boden beleuchtet, sonst springt die Farbe beim Abheben.
  Hoher Flug liegt über den Kronen und unter Bombern und erhält den nur abdunkelnden Kronen-Tint.
  Ein Vogel wird einmal pro Frame gesampelt und je nach Höhe in höchstens zwei dieser Ebenen
  platziert; die obere Kopie ist vollständig, bevor die untere ausblendet.

Maßgeblich sind [DEPTH](../../src/config.ts), [WorldSunComposite](../../src/effects/sunlight/WorldSunComposite.ts),
[FogGpuField](../../src/effects/groundFog/FogGpuField.ts) und
[AmbientWildlifeRenderer](../../src/arena/AmbientWildlifeRenderer.ts) (`BIRD_LAYER_DEPTHS`).

Das großflächige Lichtmuster stammt aus den weltverankerten Wolkenöffnungen. Sonnenazimut und
Elevation verändern geometrische Schatten und Material-Formlicht, nicht die Koordinaten dieses Feldes.
Boden, Wasserlicht, Nebel und Pflanzenschatten lesen dieselbe Öffnung. Die Nebelstreuung enthält
keine Blattkonturen; ihre Kompensation verwendet exakt den Composite-Faktor, damit Nebel nicht
zweimal beleuchtet wird. Der gemeinsame Owner und die pausierbare Präsentationszeit gelten auch
für den analytischen Fallback ohne Wolkentextur.

### Nacht: Mondinseln, Lampen an Material und Void-Botanik

**Mondinseln.** [WorldSunlightPresentation](../../src/effects/sunlight/WorldSunlightPresentation.ts) bleibt der einzige
Ambient-Writer; der Mond ist kein zweiter. Er zeichnet weltverankerte Inseln als Ambient-Schicht in die Lichtkarte.
[MoonSky](../../src/effects/sunlight/MoonSky.ts) löst die Inseln aus der Uhrzeit, dem World-Wert `moonlight` und einem
optionalen Activity-Override auf (der Dawn-Blutmond ist ein solcher Override desselben Mondes).

- Abweichend vom Wolkenvertrag driften die Inseln mit der synchronisierten Spieluhr, nicht mit der pausierbaren
  Präsentationszeit, damit alle Peers dieselben Inseln sehen. Replizierter Zustand entsteht dadurch nicht.
- Der Bleed behandelt das Mondlicht der Nacht als Ambient, damit die Nacht selbst nicht glüht. Nur ein Override behält
  seinen Schein.
- Kronen über der Lichtkarte lesen dieselben Inseln über `LightMapAmbientLayer.sampleAt`.

**Lampen an Materialien unter der Lichtkarte.** `LightingSystem.sampleSurfaceLights` leiht Materialien die stärksten
Lampen mit `surfaceRelief`. Das Material gibt damit nur relative Form, die Bestrahlung bleibt in der Lichtkarte: Eine
flache Fläche oder ein Pixel ohne dominante Lampe behält exakt den Faktor 1
([SurfaceLocalLights](../../src/effects/SurfaceLocalLights.ts), Vertrag
[SurfaceLocalLights.test.ts](../../tests/SurfaceLocalLights.test.ts)).

**Lampen in Felsen.** Für Lampen mit `surfaceReach*` entsteht die Felsverdeckung aus einer polaren Felskarte pro Lampe
([RockPenetrationShader](../../src/effects/RockPenetrationShader.ts)), sobald die V7-Coverage resident ist. Jeder Strahl
kennt Ein- und Austritt seines ersten Felsens an der sichtbaren Kontur. Davor ist es hell, die Front des ersten Felsens
ist bis zur Eindringtiefe beleuchtet, dahinter ist alles dunkel, Boden und weitere Felsen gleichermaßen. Licht und
Schatten widersprechen sich deshalb nie ([RockLampShadow.test.ts](../../tests/RockLampShadow.test.ts)). Für diese
Lampen erzeugen Felszellen mit residenter Coverage keine Schattenpolygone, denn Zellrechtecke weichen von der Kontur
ab. Nur Felsen ohne Coverage und alle anderen Occluder bleiben polygonal
([LightShadowGeometry.test.ts](../../tests/LightShadowGeometry.test.ts)).

**Wasser nachts.** Der Nachtteil des Wassermaterials setzt erst nach der fertigen Uferlinie an; der Shader-Teil davor
bleibt bytegleich ([WaterSunlight.test.ts](../../tests/WaterSunlight.test.ts)).

**Void als Gefahrenmarker** ist reine Präsentation: Violett bedeutet Gefahr.

- Void entsteht nur aus Gefahrenquellen ([VoidDangerField](../../src/arena/VoidDangerField.ts)). Ohne Quellen gibt es
  kein Void, keine Textur und kein Quad, so bleiben PvP, Lobby und sicheres Gelände frei.
  - Die World liefert feindliche Basen, Spawnzonen, den Kraken-Teich mit Ausgängen und `voidDanger.foci`.
  - Die Activity liefert per Pull dauerhafte Void-Bodengefahren und die Präsenz jeder Quelle
    ([CoopMissionVoidDanger](../../src/activity/CoopMissionVoidDanger.ts)).
- Pflanzen und Dunst sind getrennt. Fehlt die Präsenz einer Quelle (Basis zerstört, Stätte geschlossen, Spawnort
  verbraucht), wird ihr Dunst von einer Welle aus ihrem Zentrum bis auf kleine, dichte Restflecken über den
  Void-Pflanzen abgetragen ([VoidHazeResidue](../../src/arena/VoidHazeResidue.ts)). Befallene Pflanzen stehen so nie in
  klarer Luft. Pflanzen und getränkter Boden bleiben als Narbe. Ein noch nicht aktiver Spawnort (kommende Zone,
  schlafende Basis) trägt nur gedämpften Dunst.
- Die Geflecht-Textur trägt getränkten Boden (R), Landanteil (G) und Dunst (B). Ein Präsenzwechsel schreibt nur B im
  Begrenzungsrahmen der Quelle neu und blendet über Teil-Uploads über. Daten im Alpha einer Canvas-Textur würden
  vormultipliziert, und ein weiterer Sampler passt nicht in den Nebel-Pass.
- Angekündigte Spawnzonen verdichten B im Shader (`uVoidAlert[8]`, `uVoidAlertLevel[8]` in `VOID_CREEP_GLSL`). Boden,
  Fels, Glow, Nebelluft und Partikel lesen denselben Wert. Der Client glättet die Stärke, damit ein ersetzter Takt
  abklingt statt abzureißen ([CoopDefenseSpawnZoneAlerts.test.ts](../../tests/CoopDefenseSpawnZoneAlerts.test.ts)).
- Das Feld verbraucht nie Zufall des Layouts, die Map-Fingerprints bleiben unverändert. Der Befall ist zusammenhängend:
  Es gibt keinen Wurf je Pflanze, der einzelne befallene Pflanzen neben unberührte setzt.
- Void-Frames tragen zwingend das Präfix `void-` und liegen in eigenen Atlanten mit deckungsgleichem Emissive-Atlas.
  Natürliche Familienfilter (`startsWith('lily-pad')` …) und ihre Auswahl bleiben so unberührt.
- Ihr Leuchten läuft als dekoratives Bodenlicht durch die Lichtkarte. Es wird zuletzt gefüllt und verdrängt nie
  Spiellicht.
- Adern und Sporen-Partikel liegen knapp über der Lichtkarte unter den Kronen (Band E). Die Partikel gehören zum Dunst,
  nicht zu den Pflanzen: ein kameragebundener GPU-Pass ([VoidSporeMotes](../../src/effects/sunlight/VoidSporeMotes.ts)).
  Feiner als ein Bildschirmpixel verlieren sie Helligkeit statt zu wachsen.
- Befallene Seerosen färben ihr Wasser: Ein Fleckenfeld aus den Platzierungen ([VoidWaterStain](../../src/arena/VoidWaterStain.ts))
  färbt im Sonnenwasser-Programm nach dem Nachtteil nur den Wasserkörper. Uferfilm, Wellen und Alpha bleiben,
  um gesunde Pflanzen bleibt das Wasser natürlich ([VoidWaterStain.test.ts](../../tests/VoidWaterStain.test.ts)).
- Wo der Befall etabliert ist, durchzieht ein gemeinsames Geflecht Boden, Felsdächer und Wasser
  ([VoidCreepField](../../src/arena/VoidCreepField.ts)). Owner ist die World-Sonnenlicht-Darstellung, die Tinte liegt am
  Boden unter Gleisen, Basen und Decals (`DEPTH.VOID_CREEP`) und auf Felsen innerhalb der V7-Kontur
  (`DEPTH.ROCK_VOID_CREEP`). Ihr Nachtleuchten ist eine Glow-Schicht der Lichtkarte (`setGlowLayer`). Anders als die
  Mondschicht zählt sie als Licht über der Nacht und darf deshalb bluten. Das Geflecht erscheint als Sporendunst ohne
  eigene Kanten: Jeder Anteil blendet aus dem Nichts ein. Schwebende Sporen gehören zum Land, im Wasser wirkt es als
  Tinte mit treibendem Sporenfilm ([VoidCreepField.test.ts](../../tests/VoidCreepField.test.ts)).
- Der Bodennebel trägt den Sporendunst in der Luft (`GroundFogSystem.setVoidHaze`, von der Sonnenlicht-Darstellung
  geliehen). Im Display-Pass schneiden die Waffenspuren den Dunst wie den Nebel, die Hemmung im Dichtefeld des Nebels
  (Explosionen, Bewegung) öffnet ihn, die Nebelluft trägt ihn mit. Ohne aktiven Nebel bleibt nur der Bodenschleier.
  Der Nebel gibt die geliehenen Sampler beim Lösen sofort frei ([FogWoodlandLight.test.ts](../../tests/FogWoodlandLight.test.ts)).
- Der Nebel-Composite liegt über den Figuren (`GROUND_FOG_COMPOSITE` über `PLAYERS`). Was er trägt, verschleiert Figuren.
  Deshalb gilt:
  - Der Void-Dunst haftet an Land und Ufern. Über offenem Wasser bleibt nur ein dünner Film (`OPEN_WATER_HAZE`), dort
    trägt die Tinte das Void. Was im Wasser lebt (Kraken, Mini-Kraken), bleibt lesbar.
  - Körper ab Bossgröße halten die Luft um sich offen, auch in Ruhe (`GroundFogSystem.captureMotion`). Normaler Nebel und
    der Dunst darin weichen um Kraken oder Titan zurück
    ([GroundFog.test.ts](../../tests/GroundFog.test.ts)).
- Umgekehrt verleiht der Nebel seine Luft (`GroundFogSystem.getAirBinding`, [FogAirBinding](../../src/effects/groundFog/FogAirBinding.ts))
  lesend an die Partikel. Er tauscht seine Texturen pro Simulationsschritt und kann sie freigeben. Ein Leihender fragt
  deshalb jeden Frame erst nach dem Nebelschritt und behält die Bindung nie länger.
- Weltverankertes Detail feiner als ein Bildschirmpixel flimmert bei Kamerabewegung. Materialien blenden solche
  Oktaven über die Pixelgröße der Kamera aus. Die Lichtkarte ist gröber als der Bildschirm und trägt nur weiches Licht.
- Weltflächen, die der Kamera folgen, leiten ihr Rechteck aus `getVisibleWorldView` ab. Die Arena-Kamera hat Origin
  (0, 0), Phasers gecachtes `camera.worldView` setzt 0,5 voraus und verschiebt solche Flächen.

### Atmosphäre und fachliche Grade-Komposition

[CameraPostFxController](../../src/effects/postfx/CameraPostFxController.ts) hält `WorldGradeInputs`
neben der Sonnenbasis. `resolveBaseGrade` verwendet die Sonnenatmosphäre als Basis und wendet danach
Void (authored `trackMode`), Bossprofil und lokale Verletzung an. Erst `composePostFx` legt
Ereignispulse darüber. Sonnen-Updates dürfen diese fachlichen Kanäle nicht überschreiben;
die Reihenfolge der Updates beider Eingänge verändert das Ergebnis nicht. Dauerbild und Pulse
behalten die getrennten Clamp-Verträge in [worldGrade.ts](../../src/effects/postfx/worldGrade.ts).

Felskolonien behalten eine gemeinsame Alpha-Ebene ueber Mineral und Ueberhang.
`RockOverlayStreamer` backt ihren Kontakt getrennt, `RockFoliageLighting` waehlt
das Licht am Empfaenger. Komplementaer maskierte Kopien derselben Farbe duerfen
nicht per Source-over zusammengesetzt werden: Sie verlieren an teilgedeckten
Kanten Alpha und legen einen Saum des Untergrunds frei, auch bei korrektem PMA.
Vertrag: [RockOverlayStreamer.test.ts](../../tests/RockOverlayStreamer.test.ts).

Fels-Horizonte unterscheiden Geometrie-Revision und Sonnenrichtung. Ein residenter Chunk hält bis zu
zwei Azimut-Stützstellen derselben Geometrie (Feld-/Okklusionsatlas und Horizont-Historie). Alle
Empfänger interpolieren deren Horizontwinkel pro Texel nach dem tatsächlichen Azimut und testen erst
danach gegen die Elevation; zwei fertige Licht- oder Schattenergebnisse werden nie überblendet, sonst
entstehen Doppelkanten. Eine Stützstelle wird nur ersetzt, solange sie kein Gewicht trägt; die
nächste entsteht in Laufrichtung vorab. Ein reiner Richtungs-Bake rechnet nur die Sonnenhorizonte über
der gecachten Geometrie neu. Ohne direktes Licht folgt die Richtung weiter der Sonne, damit der
Wechsel zum Sonnenaufgang im Dunkeln liegt. Geometrieänderungen, insbesondere Zerstoerung, verwerfen
veraltete Ergebnisse und die zweite Stützstelle. Geometrie-Reparaturen werden als gemeinsame
Worker-Transaktion ueber betroffene residente Chunks veroeffentlicht; bis dahin bleibt der letzte exakte
Feldstand erhalten. Die gemeinsamen Empfaenger (Felsoberflaeche, Boden und Felsbewuchs) lesen denselben
Stand. Geometrie-Reparaturen schreiben weder Zellraster-Schaetzungen noch einen Reparatur-Fade.
Uebertragene Worker-Ergebnisse sind Kopien; der begrenzte Geometrie-Cache behaelt seine eigenen Buffer.
Owner: [RockFormationLighting.ts](../../src/arena/rocks/RockFormationLighting.ts);
Vertragstest: [RockFormationLighting.test.ts](../../tests/RockFormationLighting.test.ts).

Footprint- und statische Schatten folgen dem kontinuierlichen Wurf-Azimut `castAzimuth` aus
[SunPath.ts](../../src/effects/sunlight/SunPath.ts): tagsüber der Sonnenbogen, nachts ein Bogen über
Süden zurück zur Aufgangsrichtung, ohne Sprung um Mitternacht oder im Morgengrauen. Lange Caster
(Waldkronen, Stämme, Wachtürme) zeichnet `ShadowSystem` bei gebundenem Sonnenpfad jeden Frame mit
aktueller Richtung und aktuellem Profil. Kronen sind dabei je Baum einmal weich gebackene Masken,
die nur verschoben werden; ihre Deckkraft folgt über Alpha, die Weichheit backt erst bei spürbarer
Drift neu. Nur kurze Kontakt-Footprints (Basen, Wände, Geschütztürme) bleiben im Chunk-Bake. Eine
Caster-Art liegt nie zugleich im Bake und im Frame-Pfad.
Vertragstest: [ShadowStaticBake.test.ts](../../tests/ShadowStaticBake.test.ts).

## Runtime-Asset-Vertrag

Farbtexturen werden durch `scripts/prepare-runtime-assets.mjs` verlustfrei veroeffentlicht.
`src/assets/RuntimeAssetUrls.ts` bindet logische Loader-Pfade an den Inhalts-Hash der tatsaechlich
geladenen Datei, auch fuer Deferred-Assets und Retry. Logische Asset-IDs bleiben stabil.
Die PNG-Exportzwischenprodukte bleiben fuer Offline-Paritaetspruefungen vorhanden.
Bei premultipliziert hochgeladenen Farbtexturen sind Alpha und RGB bei Alpha > 0 exakt;
unsichtbares RGB darf nur dort entfallen. Datenatlanten behalten alle Kanaele, auch RGB
unter Alpha 0, und ihren bisherigen non-PMA-Upload. Farbkompression darf nicht auf Daten
uebertragen werden. Nach einem Export aktualisiert `npm run assets:runtime` die Runtime-Dateien;
die Build-Scripts fuehren diesen Schritt automatisch aus. Die URL-Versionen sind nicht committet:
`scripts/asset-cache.ts` leitet sie bei jedem Build-, Dev- und Testlauf aus den Bytes unter
`public/assets` ab und stellt sie als `virtual:runtime-asset-urls` bereit.

Culling und Residency verwenden das sichtbare Weltrechteck aus `src/graphics/CameraWorldView.ts`: Die Berechnung berücksichtigt Kamera-Ursprung, Zoom und Rotation aus dem aktuellen Zustand. `camera.worldView` kann vor `preRender` veraltet sein und bildet den Arena-Ursprung nicht korrekt ab. Frame-Consumer reichen wiederverwendbaren Ausgabespeicher ein.

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

## Zeichenreihenfolge und Empfaenger

Depth beschreibt die Zeichenreihenfolge, keine geometrische Hoehe oder Schattenmaske.
Die beiden Composites in [LightingSystem.ts](../../src/effects/LightingSystem.ts)
beeinflussen zuvor gezeichnete World-Pixel; eigene Materialbeleuchtung und die
Clarity-Kamera bleiben getrennte Vertraege. Ein Fog-Impuls verleiht seinem Ausloeser
keinen automatischen Nebelempfang.

Der [diagnostische Ebenenvertrag](../../src/effects/EffectLayerContract.ts) trennt
beabsichtigte Hoehe/Lichtart von bestehender Depth/Blend-Zuordnung. Renderpfade
konsumieren diese Metadaten nicht. Gleichstaende am Sonnen-Composite und an der
Kronengrenze sind explizite bekannte Ausnahmen, keine gesicherte Sortiergarantie.
Siehe [Tiefenstaffelung](../depth-layering.md) und
[Vertragstest](../../tests/depthR0Contract.test.ts).
