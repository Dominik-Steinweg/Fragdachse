# Referenz-Implementierungen

Diese Seite nennt wenige konkrete Einstiegspunkte, die als Muster dienen. Sie ersetzt nicht die jeweiligen Verträge.

## World ohne Activity

- [src/config/authoring/lobbyWorld.ts](../../src/config/authoring/lobbyWorld.ts) zeigt eine normale authored World ohne Activity.
- [src/arena/LobbyWorldLayout.ts](../../src/arena/LobbyWorldLayout.ts) liefert ihr Layout über denselben World-Layout-Vertrag.
- [tests/WorldWithoutActivityProof.test.ts](../../tests/WorldWithoutActivityProof.test.ts) und [tests/SharedWorldWithoutActivity.test.ts](../../tests/SharedWorldWithoutActivity.test.ts) schützen den Zustand World ohne Activity.

## World-Aufbau und Participation

- [src/world/WorldLifecycle.ts](../../src/world/WorldLifecycle.ts) besitzt World-Identität und Lebensdauer.
- [src/world/WorldParticipation.ts](../../src/world/WorldParticipation.ts) zeigt den host-authoritativen Teilnahmevertrag.
- [src/scenes/arena/ArenaLifecycleCoordinator.ts](../../src/scenes/arena/ArenaLifecycleCoordinator.ts) orchestriert Aufbau, Runtime-Bindung und Teardown.
- [tests/WorldParticipationContracts.test.ts](../../tests/WorldParticipationContracts.test.ts) trennt Participation von Round-State, Replikation und lokaler Presentation.

## Runtime ohne Renderer

- [src/world/WorldRuntimeContext.ts](../../src/world/WorldRuntimeContext.ts) bündelt World-Identität, Definition, Metrics, Basen und persistente Site.
- [src/arena/ArenaBuilder.ts](../../src/arena/ArenaBuilder.ts) baut Runtime-/Physik-Proxies unabhängig von optionalen visuellen Objekten.
- [tests/PlayerTreeRuntimeContracts.test.ts](../../tests/PlayerTreeRuntimeContracts.test.ts) und [tests/WorldPresentationContracts.test.ts](../../tests/WorldPresentationContracts.test.ts) sichern die Entkopplung.

## Netzwerk

- [src/network/NetworkBridge.ts](../../src/network/NetworkBridge.ts) ist die Gameplay-Grenze.
- [src/network/peer/PeerRoom.ts](../../src/network/peer/PeerRoom.ts) zeigt die Transportabstraktion unterhalb dieser Grenze.
- [src/network/peer/PeerJsTransport.ts](../../src/network/peer/PeerJsTransport.ts) ist der einzige PeerJS-Importpfad.
- [tests/WorldChannelContracts.test.ts](../../tests/WorldChannelContracts.test.ts) und [tests/PeerLink.test.ts](../../tests/PeerLink.test.ts) verifizieren Store-, Revision- und Channelverträge.

## Persistenz

- [src/persistentBase/PersistentBaseContributionStore.ts](../../src/persistentBase/PersistentBaseContributionStore.ts) zeigt den mission-lokalen Arbeitsstand mehrerer Besitzer mit Commit/Rollback.
- [src/persistentBase/PersistentBaseComposite.ts](../../src/persistentBase/PersistentBaseComposite.ts) zeigt eine reine, deterministische Merge-Autorität ohne Phaser- und Netzwerkbindung.
- [src/utils/localPreferences.ts](../../src/utils/localPreferences.ts) ist die Validierungs- und Migrationsgrenze.
- [tests/LocalPersistence.test.ts](../../tests/LocalPersistence.test.ts) prüft Import, Migration, Cache und Fehlerverhalten.
