# Referenzimplementierungen

Diese Pfade sind kanonische Einstiegspunkte, keine Kopiervorlagen. Immer Call-Sites, Lifetime und Cleanup mitlesen.

## Round-Lifecycle

src/scenes/arena/ArenaLifecycleCoordinator.ts: buildArena() und tearDownArena() zeigen die einzige vorgesehene Round-Verdrahtung, den Cache-Reset und die vollständige Entkopplung. Neue Systeme bleiben fachlich in src/systems/.

## Netzwerk

src/network/NetworkBridge.ts zeigt die fachliche API; src/network/peer/PeerRoom.ts und PeerLink.ts zeigen Store-/RPC- und Kanalverträge. tests/PeerProtocol.test.ts, tests/PeerLink.test.ts und tests/FullGameStateBootstrap.test.ts sind die passenden Referenzen für Parser, Kanalwahl und Baselines.

## Visuelle Effekte

- src/effects/AsmdPrimaryRenderer.ts: komponierte Hitscan-Sequenz mit Mündung, Impact und Cleanup.
- src/effects/EffectSystem.ts: gemeinsame Explosionseffekte und Übergabe an zentrale Kamera-/Lichtregie.
- src/effects/RocketRenderer.ts: kontinuierliches Projektil mit Create/Update/Destroy und Richtungsvektor.
- src/powerups/PowerUpRenderer.ts: repliziertes Weltobjekt mit vorhandenen Assets und sauberem Container-Lifecycle.

Layer, Partikelmengen und Filterkosten nicht blind übernehmen; siehe visual-guidelines.md und performance.md.

## Phaser-freie UI-Modelle

src/ui/CoopDefenseItemsModel.ts mit tests/CoopDefenseItemsModel.test.ts trennt Daten-/Ablageregeln vom Phaser-Overlay. Für Pointerpositionen im Designraum und Drag-Verträge src/ui/CoopDefenseItemsOverlay.ts, src/ui/UiTooltip.ts und src/graphics/RenderResolution.ts zusammen lesen.
