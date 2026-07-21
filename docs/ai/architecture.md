# Architektur

Nur bei Aufgaben lesen, die Systemgrenzen, Scene-/Round-Lifecycle oder mehrere Subsysteme berühren. Einzelne API-Details direkt im Code prüfen.

## Start und Hauptfluss

`src/main.ts` wartet zuerst auf `NetworkBridge.initializeLobby()`, aktiviert dann den Singleton aus `src/network/bridge.ts` und erzeugt erst danach `Phaser.Game`. `ArenaScene` ist die einzige Phaser-Scene; die Lobby ist `src/scenes/LobbyOverlay.ts` innerhalb dieser Scene, keine zweite Scene.

`src/scenes/ArenaScene.ts` lädt Assets, erzeugt Scene-Lifetime-Dienste und UI, assembliert `ArenaContext`, verdrahtet Renderer und delegiert den laufenden Betrieb:

- `ArenaLifecycleCoordinator`: Phasenwechsel, Arena-Aufbau/-Abbau und Rundenergebnisse.
- `HostUpdateCoordinator`: autoritative Simulation und Publikation.
- `ClientUpdateCoordinator`: empfangene Zustände, Interpolation und lokale Prediction.
- `RpcCoordinator`: fachliche RPC-Handler; der eigentliche Playroom-Zugriff bleibt im Bridge-Modul.

`ArenaScene.update()` koordiniert diese Komponenten. Neue umfangreiche Regel- oder Effektlogik gehört nicht direkt in die Scene.

## Zuständigkeiten

- `src/systems/`: hostseitige Gameplay-Regeln, zeitlicher autoritativer State und Kollisionsergebnisse.
- `src/entities/`: Entity-Lifecycle, Manager, Host-Objekte und Clientdarstellung replizierter Entities.
- `src/effects/`: nicht-autoritative visuelle Reaktion, Partikel und Renderer. Effekte entscheiden keinen Schaden.
- `src/arena/`: Layout-Erzeugung, Terrain, Registrys und statische/dynamische Arena-Objekte.
- `src/loadout/`: Waffen-, Utility- und Ultimate-Konfiguration sowie Ausführung.
- `src/ui/`: HUD, Overlays und lokale Eingabevisualisierung.
- `src/network/`: PlayroomKit-Adapter, schneller Gameplay-Kanal, Ping/Qualität und Snapshot-Codecs.
- `src/config.ts`, `src/types.ts`: gemeinsame Konstanten und Wire-/Domänenverträge; Magic Numbers nicht verteilen.

Abhängigkeiten laufen grob von Scene/Coordinators zu Systems/Manager/Renderer. Gameplay-Module sprechen über die fachliche `NetworkBridge`-API, nicht über PlayroomKit. Renderer lesen entschiedene Zustände oder Ereignisse und bleiben von autoritativer Logik getrennt.

## Zwei Lebensdauern

`src/scenes/arena/ArenaContext.ts` ist der ausdrückliche Vertrag:

- Scene-Lifetime: Manager, Kernsysteme, Audio, Eingabe und HUD bestehen ab `ArenaScene.create()` stabil.
- Round-Lifetime: Arena-Resultat, Registrys und Modus-/Host-Systeme sind außerhalb einer Runde `null`.

`ArenaLifecycleCoordinator.buildArena()` beginnt defensiv mit `tearDownArena()`, verwirft den Netzwerk-Merge-Cache, hydriert das vom Host veröffentlichte Layout und verdrahtet Round-Systeme. Im Coop-Modus wartet der Client zusätzlich auf den zuverlässigen `RoundState`, weil Map-ID und Spielerzahl Teil derselben Build-Baseline sind.

`tearDownArena()` zerstört dynamische Phaser-Objekte, leert Renderer/Manager, entfernt Callback-Sinks und Resolver und setzt alle Round-Referenzen zurück. Provider, die Round-Systeme schließen, müssen die Referenz erst beim Aufruf aus `ctx` lesen und `null` tolerieren; keine veraltete Round-Instanz dauerhaft capturen.

Die statische Kulisse entsteht über `ArenaBuilder.buildStatic()`. Runde-spezifische Inhalte werden separat gebaut und über `ArenaBuilder.destroyDynamic()` entfernt.

## Nicht offensichtliche Entscheidungen

- Der Host publiziert vor `LOBBY → ARENA` Layout, Zeitbasen und Round-State zuverlässig; der Phasenwechsel ist das nachgelagerte Gate.
- Ein spät gestarteter Client kann bereits in `ARENA` eintreten. `initialize()` plant deshalb den Aufbau im nächsten Frame, nachdem Create-time-Callbacks und RPCs stehen.
- Bei Rundenwechseln muss `NetworkBridge.resetGameStateCache()` die Merge-Baseline von Delta-Slices verwerfen, sonst könnten unveränderte Werte aus der Vorrunde weiterleben.
- Phaser-4-WebGL verwendet hier keine `GeometryMask` für den Arena-Clip. `ArenaScene.ensureArenaClipMask()` lässt sie bewusst `null`; Bounds, Clamping und Sichtbarkeitslogik übernehmen die Begrenzung.

## Wichtige Referenzpfade

- Boot: `src/main.ts`
- Orchestrierung: `src/scenes/ArenaScene.ts`
- Lifetime-Vertrag: `src/scenes/arena/ArenaContext.ts`
- Round-Aufbau/-Abbau: `src/scenes/arena/ArenaLifecycleCoordinator.ts`
- Renderer-Verdrahtung: `src/scenes/arena/RendererBundle.ts`
- Arena-Aufbau: `src/arena/ArenaBuilder.ts`
- Netzwerkgrenze: `src/network/NetworkBridge.ts`
