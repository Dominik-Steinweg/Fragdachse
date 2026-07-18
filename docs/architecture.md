# Architektur in Kürze

Diese Referenz nur bei Änderungen lesen, die mehrere Subsysteme, das Netzwerk oder den Arena-Lifecycle betreffen.

## Start und Zuständigkeiten

`src/main.ts` initialisiert zuerst die Playroom-Lobby, aktiviert anschließend den gemeinsamen `NetworkBridge` und startet danach Phaser mit der einzigen `ArenaScene`. Die Lobby ist ein Overlay innerhalb dieser Scene, keine eigene Phaser-Scene.

- Scenes und Coordinator verbinden Komponenten und steuern Phasen.
- Systems besitzen autoritative Gameplay-Regeln und hostseitige Updates.
- Manager besitzen Entity-Lifecycle und Synchronisierung.
- Effects und Renderer stellen bereits entschiedene Ereignisse dar.
- UI liest Zustände und übersetzt lokale Bedienung in Aktionen.

## Host und Clients

Der Host entscheidet über Simulation, Treffer, Ressourcen, Spawns und Rundenzustand. Clients senden Eingaben beziehungsweise Anforderungen und stellen den empfangenen Zustand dar. `src/network/NetworkBridge.ts` ist die einzige direkte PlayroomKit-Grenze; andere Module verwenden ihre fachliche API.

Beständige Lobby-, Auswahl- und Rundendaten werden zuverlässig übertragen. Häufig aktualisierte Spielzustände verwenden kompakte Snapshots beziehungsweise Deltas; kurzlebige Effekte und Aktionen können über RPC oder den Gameplay-Transport laufen. Vor Änderungen immer vorhandene State-Keys, RPC-Typen, Codecs und Merge-Logik suchen und bestehende Wire-Formate bewahren.

## Lifecycle

`ArenaContext` enthält zwei Lebensdauern:

- Scene-Lifetime: nach `ArenaScene.create()` vorhanden und bis zum Scene-Ende stabil.
- Round-Lifetime: nur während einer Arena aktiv, auf Clients teilweise und auf dem Host vollständig belegt.

`ArenaLifecycleCoordinator.buildArena()` erstellt Round-Ressourcen und verdrahtet sie. `tearDownArena()` muss Listener, Phaser-Objekte und Round-Referenzen vollständig entfernen. Provider dürfen Round-Referenzen nur zur Aufrufzeit lesen und müssen `null` tolerieren.

## Neue Features einordnen

1. Autoritative Regel oder zeitlicher Gameplay-State: `src/systems/`.
2. Entity-Bestand und Synchronisierung: `src/entities/`.
3. Rein visuelle Darstellung: `src/effects/`.
4. HUD oder Overlay: `src/ui/`.
5. Orchestrierung und Phasenübergänge: `src/scenes/arena/`.
6. Transport, RPC oder Snapshot-Codec: `src/network/`.

Bestehende Abstraktionen und fachnahe Tests zuerst suchen; neue Querschnittsschichten nur bei wiederholtem Bedarf einführen.

