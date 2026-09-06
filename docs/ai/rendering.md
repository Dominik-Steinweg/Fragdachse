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

## Designraum und Koordinaten

[src/graphics/RenderResolution.ts](../../src/graphics/RenderResolution.ts) hält Designraum, Renderauflösung, Device-Pixel-Ratio und Pointer-Umrechnung zusammen. Kamera und Canvas skalieren gemeinsam; die Kamera beginnt im Designraum am vereinbarten Ursprung, damit Screen-fixed UI und World-Inhalt nicht auseinanderdriften.

Roh-Pointerkoordinaten sind Renderpixel. Für UI-Rechnung werden sie in den Designraum umgerechnet; für World-Eingabe liefern Kamera-World-Point oder Phaser-Hit-Testing die korrekte Weltposition. Die unerschütterte Pointerposition wird für Gameplay verwendet, damit visuelles Camera-Feedback keine Ziel- oder Platzierungslogik verändert.

## Kameras und Klarheit

Die World-Kamera trägt World-FX und Camera-Feedback. Eine transparente Clarity-Kamera hält HUD und bewusst immer lesbare Overlays frei von diesen Effekten. [ClarityCameraRegistry.ts](../../src/scenes/arena/ClarityCameraRegistry.ts) und [clarityCameraAssignment.ts](../../src/scenes/arena/clarityCameraAssignment.ts) vergeben die Zuordnung opt-in und behandeln Container als Präsentationseinheit.

Camera-Feedback besitzt einen zentralen Owner: [CameraFeedbackController.ts](../../src/effects/camera/CameraFeedbackController.ts) und [CameraFeedbackModel.ts](../../src/effects/camera/CameraFeedbackModel.ts) sammeln, priorisieren, begrenzen und lösen Requests. Gameplay ruft keine direkten Kamera-Shakes auf; der Feedback-Offset verändert nicht die fachliche World- oder Pointer-Geometrie.

[CameraPostFxController.ts](../../src/effects/postfx/CameraPostFxController.ts) und [PostFxComposer.ts](../../src/effects/postfx/PostFxComposer.ts) halten Post-FX als visuelle, widerrufbare Komposition. Ein Effekt darf keine dauerhafte Spielregel oder kollisionsrelevante Farbe erzeugen.

## Runtime und Renderer

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

Ein zeitlich fortschreitender Cursor konsumiert bestätigte Segmente einmalig. Flight Signature,
Rocket-Smoke und Projectile-Burn teilen den neutralen Distanz-Sampler, besitzen aber eigene Dichten,
Paletten und Lebenszeiten. Rocket-Exhaust bleibt zeitbasiert an der dargestellten Triebwerksposition.
Kopfgebundene Akzente gehören weiterhin den spezialisierten Projectile-Renderern.

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

Persistente GPU-/World-Flächen gehören zur World- und Chunk-Lifetime; transiente VFX gehören zur Effects-Lifetime. Beide Ressourcenklassen werden getrennt erzeugt, aktualisiert und beim jeweiligen Owner-Teardown freigegeben.

## DOM und Vollbild

DOM-Overlays liegen unter demselben Game-Container, der auch Parent und Fullscreen-Target ist. [src/ui/fullscreen.ts](../../src/ui/fullscreen.ts) ist der Owner dieser Grenze; neue Overlay-Wurzeln dürfen nicht außerhalb des Vollbildcontainers entstehen.

## Verifikation

Sichtbare Phaser- oder UI-Änderungen werden mit npm run build geprüft. Browser, Dev-Server und Screenshots sind opt-in und nur nach ausdrücklicher Aufforderung auszuführen. Für visuelle Lesbarkeit gilt zusätzlich [visual-guidelines.md](visual-guidelines.md).
