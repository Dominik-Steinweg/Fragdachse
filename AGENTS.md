# Fragdachse – Agenten-Router

Fragdachse ist ein browserbasierter 2D-Arena-Shooter mit Phaser 4 und direkten WebRTC-Verbindungen. Der Quellcode ist die technische Wahrheit; diese Datei und [`docs/ai/index.md`](docs/ai/index.md) routen nur zu langlebigen Verträgen.

## Erst suchen, dann lesen

- Mit `rg` nach Symbolen, Imports und Tests suchen und nur die betroffenen Ausschnitte lesen.
- Einstiegspunkte: `src/main.ts` → `src/scenes/ArenaScene.ts`; Netzwerkgrenze `src/network/NetworkBridge.ts`; gemeinsame Verträge `src/types.ts` und `src/config.ts`.
- Fachliche Wissensseiten stehen im [AI-Router](docs/ai/index.md). Nur die für die Aufgabe relevanten Seiten laden.

## Architekturregeln

- Phaser ist auf 4.2.1 festgelegt. `import * as Phaser from 'phaser'` verwenden und keine Phaser-3-Muster übernehmen.
- `peerjs` darf nur in `src/network/peer/PeerJsTransport.ts` importiert werden. Gameplay spricht über `NetworkBridge`, nie über das Transportsubstrat. Der Host entscheidet Simulation, Treffer, Ressourcen, Spawns, Rundenzustand und Layout; Clients senden Eingaben/Aktionen und visualisieren replizierten Zustand.
- `ArenaContext` trennt langlebige Scene-Systeme von World-, Activity- und Round-Runtime. Die Scene bleibt bestehen; eine Activity setzt eine vorhandene World voraus, während eine World ohne Activity/Round existieren kann. Activity-/Round-Ressourcen werden vom `ArenaLifecycleCoordinator` in der passenden Lifecycle-Phase erzeugt, vollständig entkoppelt und außerhalb ihrer Lifetime als `null` behandelt.
- Scenes und Coordinators orchestrieren. Regeln gehören in `src/systems/`, Entity-Lifecycle in `src/entities/` und Darstellung in `src/effects/`, `src/arena/` oder `src/ui/`. Bestehende Manager, Resolver, Registry- und Callback-Verträge vor neuen Abstraktionen prüfen.
- Authored Content bleibt in JSON/Registries und wird durch die vorhandenen Loader/Validatoren aufgelöst. Wire- und Ready-Snapshots führen IDs bzw. vertraglich definierte Zustände, keine zufällig rekonstruierten Konfigurationen.
- Vor größeren Features oder Refactorings zuerst das [Architektur-Leitbild](docs/ai/architecture-principles.md) und danach die konkrete Vertragsseite im [AI-Router](docs/ai/index.md) lesen.

## Skills und visuelle Qualität

- Bei Phaser-Aufgaben zuerst den projektspezifischen Skill `.ai/skills/fragdachse-phaser/SKILL.md` und danach nur die passenden offiziellen Skills unter `.ai/vendor/phaser-skills/` lesen.
- `.ai/skills/` und `.ai/vendor/phaser-skills/` sind die bearbeitbaren Quellen. `.agents/skills/` und `.claude/skills/` sind generierte Spiegel; Änderungen danach mit `npm run ai:sync` synchronisieren.
- Sichtbare Gameplay-Grafiken folgen [`docs/ai/visual-guidelines.md`](docs/ai/visual-guidelines.md): orthografische 90°-Top-down-Ansicht, klare Lesbarkeit, produktionsnaher Qualitätsmaßstab.

## Proportionale Prüfung

Neue oder geänderte Tests schützen langlebiges Verhalten oder Invarianten, nicht aktuelles Tuning
oder zufällige Implementierungsdetails. Bestehende passende Tests bevorzugt erweitern. Details:
[`docs/ai/testing.md`](docs/ai/testing.md).

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

`docs/ai/` ist eine Wissensbasis für langlebige, systemübergreifende Projektinvarianten und keine Implementierungschronik. `architecture-principles.md` ist dabei die bewusst normative Ausnahme: Es hält ein beschlossenes Architektur-Leitbild fest, darf vom historisch gewachsenen Ist-Code abweichen und ist keine Behauptung vollständiger Umsetzung. Normale Knowledge-Writebacks betreffen verifizierte Ist-Verträge der Fachseiten; Änderungen am Leitbild benötigen eine explizite Architekturentscheidung und entstehen nicht automatisch aus einer einzelnen Implementierung.

Eine neue Regel braucht einen positiven, im aktuellen Code und in den passenden Types/Tests verifizierten Grund. Das ist insbesondere der Fall, wenn:

- mehrere Systeme dieselbe nicht offensichtliche Grenze kennen müssen;
- eine lokale Implementierung die Architektur allein nicht vermittelt;
- ein falscher Ansatz bei neuen Features sehr wahrscheinlich wäre;
- die Regel unabhängig von konkreten Balance-, Map- oder Featurewerten gilt;
- die Regel einen stabilen fachlichen Owner besitzt.

Kein ausreichender Grund für Knowledge Writeback ist dagegen, dass eine Implementierung kompliziert war, ein Bug schwer zu finden war, ein Performanceproblem teuer war, mehrere Korrekturschleifen nötig waren, ein Algorithmus technisch interessant ist oder eine konkrete Zahl gemessen wurde. Solche Details gehören in Code, Kommentare, Tests, authored Daten oder die Git-Historie.

Der Normalfall nach einer Featureänderung darf ausdrücklich sein: `Knowledge writeback: No durable project knowledge discovered.` Im Abschluss größerer Aufgaben genau eine Zeile nennen: `Knowledge writeback: No durable project knowledge discovered.` oder `Knowledge writeback: Updated <path> with <verified rule>.`
