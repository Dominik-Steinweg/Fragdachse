# Fragdachse – Agenten-Router

Fragdachse ist ein schneller browserbasierter 2D-PvP/PvE-Arena-Shooter mit Phaser 4 und direkten WebRTC-Verbindungen. Der Quellcode ist die technische Wahrheit; Dokumentation hält Absichten, Systemgrenzen und nicht offensichtliche Verträge fest.

## Erst suchen, dann lesen

- Zuerst mit `rg` nach Symbolen, Imports und passenden Tests suchen. Nur relevante Ausschnitte und aufgabenbezogene Dokumente laden, niemals pauschal die ganze Wissensbasis.
- Einstieg: `src/main.ts` → `src/scenes/ArenaScene.ts`. Gameplay: `src/systems/`; Darstellung: `src/effects/`; Entities und Synchronisierung: `src/entities/`; Round-Orchestrierung: `src/scenes/arena/`; Netzwerkgrenze: `src/network/NetworkBridge.ts`; gemeinsame Verträge: `src/types.ts`, `src/config.ts`.
- Wissensrouter: [`docs/ai/index.md`](docs/ai/index.md). Architektur, Gameplay, Netzwerk oder Visuals nur lesen, wenn die Aufgabe den Bereich berührt.

## Dauerhafte Architekturregeln

- Phaser ist exakt auf 4.2.1 gelockt. Als `import * as Phaser from 'phaser'` importieren und keine Phaser-3-Muster übernehmen.
- Der Transport liegt in `src/network/peer/`; nur `PeerJsTransport.ts` importiert `peerjs`, und PeerJS dient ausschließlich als Signaling-Broker. Gameplay-Code spricht nur über `NetworkBridge`. Gameplay ist host-autoritativ; Clients senden Eingaben/Aktionen und rendern replizierten Zustand sowie Ereignisse.
- `ArenaContext` trennt Scene-Lifetime von Round-Lifetime. Round-Systeme sind außerhalb einer aktiven Runde `null`, werden in `buildArena()` gesetzt und in `tearDownArena()` vollständig entkoppelt und bereinigt.
- Scenes und Coordinator orchestrieren. Regeln gehören in Systems, Visuals in Effects/Renderer, Entity-Lifecycle in Manager. Bestehende Infrastruktur und Konstanten vor neuen Abstraktionen prüfen.

## Skills und visuelle Qualität

- Für Phaser-Aufgaben zuerst den projektspezifischen Skill `fragdachse-phaser` und die passenden offiziellen Skills unter `.agents/skills/` konsultieren; nur relevante Skills laden, nicht den gesamten Satz. Kanonische Quellen: `.ai/skills/` und `.ai/vendor/phaser-skills/`.
- Für Explosionen, Partikel, Projektile, Kamera-Feedback, Sprites, PNGs oder andere Gameplay-Grafiken zusätzlich den Skill `visual-production` verwenden und bestehende hochwertige Referenzen untersuchen.
- Sichtbare Ergebnisse sind standardmäßig produktionsnah, nicht bloße Platzhalter. Gameplay-Grafiken verwenden eine orthografische 90°-Top-down-Ansicht: kein Isometric, keine Dreiviertelansicht, kein Horizont und keine sichtbaren Objektseiten. Details: [`docs/ai/visual-guidelines.md`](docs/ai/visual-guidelines.md).
- Eigene Skills nur unter `.ai/skills/` bearbeiten. `.agents/skills/` und `.claude/skills/` sind generierte, eingecheckte Spiegel; nach Skill-Änderungen `npm run ai:sync` ausführen.

## Proportionale Prüfung

| Änderung | Prüfung |
|---|---|
| Nur Markdown, Instruktionen oder Kommentare | Links/Pfade und betroffene Inhalte prüfen |
| Kleine isolierte TypeScript-Änderung | `npm run typecheck` |
| Getestetes Modul | passende Testdatei, z. B. `npm test -- tests/GameplayTransportChannel.test.ts` |
| Mehrere Module, Netzwerk, Lifecycle oder Build-Konfiguration | `npm run check` |
| Sichtbare Phaser-/UI-Änderung | `npm run build`; Browserprüfung einmal am Ende und nur für das betroffene Verhalten |

Vor `npm run build` nicht zusätzlich typechecken; der Build enthält TypeScript. Es gibt derzeit kein Lint-Script. Keine Tests nur für Coverage und keine neue CI-/Lint-/Browser-Infrastruktur ohne ausdrücklichen Auftrag.

## Browserprüfung

Nur bei sichtbar geändertem Verhalten: `npm run dev:browser`, dann erst nach HTTP 200 von `http://127.0.0.1:8090/` genau diese URL öffnen. Höchstens ein Verbindungs- und ein Seitenlade-Retry; bei blockiertem Verbindungsaufbau abbrechen und melden. Für Mehrspielerprüfungen einen zweiten Tab mit der `#r=`-URL des ersten öffnen. Bekannte Meldungen zu noch fehlenden Loadout-/Upgrade-/Gegner-Sprites ignorieren, wenn das Zielbild rendert. Server und Browser danach beenden.

Port 8090 gehört exklusiv dem Agenten, Port 8080 exklusiv dem Menschen (`npm run dev`). Niemals einen fremden Prozess auf 8080 beenden und niemals `localhost` statt `127.0.0.1` verwenden. Details und Begründung: [`docs/ai/local-dev-environment.md`](docs/ai/local-dev-environment.md).

Schlägt der Screenshot mit „Browser pane is not displayed / not compositing frames" fehl, ist der Browser-Pane verborgen: Dann läuft auch Phasers Game-Loop nicht und es gibt kein Bild zum Prüfen. Das ist ein Umgebungszustand, kein Anwendungsfehler. Die Sichtprüfung nicht als bestanden melden und kein Ergebnis erfinden, sondern offen berichten und auf Konsole/Netzwerk/`read_page` ausweichen. Siehe dieselbe Seite.

## Definition of Done und Knowledge Writeback

- Nach substanziellen Aufgaben prüfen, ob eine Erkenntnis projektspezifisch, nicht offensichtlich, verifiziert, wiederverwendbar und voraussichtlich langlebig ist. Nur dann das passendste vorhandene Dokument unter `docs/ai/` knapp ergänzen; neue Seiten nur für ein tragfähiges eigenständiges Thema und dann in `docs/ai/index.md` verlinken.
- Keine Bug-Chronik, Tippfehler, Einmalfehler, Debugdaten, verworfenen Experimente oder aus einer einzelnen Codezeile offensichtlichen Fakten dokumentieren. Allgemeine Verträge statt Entstehungsgeschichte festhalten.
- Im Abschluss größerer Aufgaben genau eine kurze Zeile angeben: `Knowledge writeback: No durable project knowledge discovered.` oder `Knowledge writeback: Updated <path> with <verified rule>.`
