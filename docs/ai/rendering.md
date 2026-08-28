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
