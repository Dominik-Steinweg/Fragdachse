# Fragdachse – Agenten-Router

Fragdachse ist ein browserbasierter 2D-Arena-Shooter mit Phaser 4 und direkten WebRTC-Verbindungen. Der Quellcode ist die technische Wahrheit; diese Datei und [`docs/ai/index.md`](docs/ai/index.md) routen nur zu langlebigen Verträgen.

## Erst suchen, dann lesen

- Mit `rg` nach Symbolen, Imports und Tests suchen und nur die betroffenen Ausschnitte lesen.
- Einstiegspunkte: `src/main.ts` → `src/scenes/ArenaScene.ts`; Netzwerkgrenze `src/network/NetworkBridge.ts`; gemeinsame Verträge `src/types.ts` und `src/config.ts`.
- Fachliche Wissensseiten stehen im [AI-Router](docs/ai/index.md). Nur die für die Aufgabe relevanten Seiten laden.

## Architekturregeln

- Phaser ist auf 4.2.1 festgelegt. `import * as Phaser from 'phaser'` verwenden und keine Phaser-3-Muster übernehmen.
- `peerjs` darf nur in `src/network/peer/PeerJsTransport.ts` importiert werden. Gameplay spricht über `NetworkBridge`, nie über das Transportsubstrat. Der Host entscheidet Simulation, Treffer, Ressourcen, Spawns, Rundenzustand und Layout; Clients senden Eingaben/Aktionen und visualisieren replizierten Zustand.
- `ArenaContext` trennt Scene- und Round-Lifetime. Round-Ressourcen werden in `ArenaLifecycleCoordinator.buildArena()` erzeugt, in `tearDownArena()` vollständig entkoppelt und außerhalb einer Runde als `null` behandelt.
- Scenes und Coordinators orchestrieren. Regeln gehören in `src/systems/`, Entity-Lifecycle in `src/entities/` und Darstellung in `src/effects/`, `src/arena/` oder `src/ui/`. Bestehende Manager, Resolver, Registry- und Callback-Verträge vor neuen Abstraktionen prüfen.
- Authored Content bleibt in JSON/Registries und wird durch die vorhandenen Loader/Validatoren aufgelöst. Wire- und Ready-Snapshots führen IDs bzw. vertraglich definierte Zustände, keine zufällig rekonstruierten Konfigurationen.

## Skills und visuelle Qualität

- Bei Phaser-Aufgaben zuerst den projektspezifischen Skill `.ai/skills/fragdachse-phaser/SKILL.md` und danach nur die passenden offiziellen Skills unter `.ai/vendor/phaser-skills/` lesen.
- `.ai/skills/` und `.ai/vendor/phaser-skills/` sind die bearbeitbaren Quellen. `.agents/skills/` und `.claude/skills/` sind generierte Spiegel; Änderungen danach mit `npm run ai:sync` synchronisieren.
- Sichtbare Gameplay-Grafiken folgen [`docs/ai/visual-guidelines.md`](docs/ai/visual-guidelines.md): orthografische 90°-Top-down-Ansicht, klare Lesbarkeit, produktionsnaher Qualitätsmaßstab.

## Proportionale Prüfung

| Änderung | Prüfung |
|---|---|
| Markdown, Instruktionen oder Kommentare | Pfade, Links, Symbolnamen und `git diff --check` prüfen |
| Kleine isolierte TypeScript-Änderung | `npm run typecheck` |
| Getestetes Modul | passender existierender Test, z. B. `npm test -- tests/PeerRoom.test.ts` |
| Mehrere Module, Netzwerk, Lifecycle oder Build-Konfiguration | `npm run check` |
| Sichtbare Phaser-/UI-Änderung | `npm run build` |

Es gibt kein Lint-Script. Keine neue Test-, Browser- oder CI-Infrastruktur ohne Auftrag. Vor `npm run build` nicht zusätzlich typechecken; der Build enthält TypeScript.

Browserprüfung ist opt-in: Ohne ausdrückliche Aufforderung keinen Dev-Server, Browser oder Screenshot starten. Falls ausdrücklich verlangt, `npm run dev:browser` verwenden, auf HTTP 200 von `http://127.0.0.1:8090/` warten und keinen fremden Prozess auf Port 8080 beenden. Scheitert ein Screenshot wegen eines verborgenen Browser-Panes, die Sichtprüfung als nicht verifiziert melden.

## Knowledge Writeback

Nach substanziellen Änderungen nur verifizierte, langlebige Verträge unter `docs/ai/` ergänzen; keine Bug-Chronik, Balancekopie oder Einmalbeobachtung. Im Abschluss größerer Aufgaben genau eine Zeile nennen: `Knowledge writeback: No durable project knowledge discovered.` oder `Knowledge writeback: Updated <path> with <verified rule>.`
