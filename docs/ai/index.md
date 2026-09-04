# AI-Wissensbasis

Diese Seiten dokumentieren langlebige Architektur- und Fachverträge von Fragdachse. Die technische Wahrheit bleibt der Quellcode; Types, Validatoren, Tests und authored Daten präzisieren ihn. Die Dokumentation soll Ownership, Lebensdauer, Autorität, Identität, Replikation und Erweiterungsgrenzen schnell auffindbar machen.

## Router

| Seite | Lesen, wenn ... |
| --- | --- |
| [architecture-principles.md](architecture-principles.md) | Vor größeren neuen Features, Refactorings oder Architekturentscheidungen: Owner, Authority, Lifetime, Abhängigkeiten und Abstraktionsbedarf prüfen. |
| [architecture.md](architecture.md) | World, Activity, Lebenszyklus, Participation, Runtime oder Zuständigkeiten geändert werden. |
| [networking.md](networking.md) | Netzwerkgrenzen, Channel, Snapshot/Deltas, RPCs, Revisionen oder Late Join betroffen sind. |
| [content-and-config.md](content-and-config.md) | authored World-/Activity-Inhalte, Registries, IDs oder Resolver betroffen sind. |
| [gameplay.md](gameplay.md) | Host-Autorität, Fähigkeiten, Eingaben, Runden oder Player-Runtime betroffen sind. |
| [coop-defense-authoring.md](coop-defense-authoring.md) | Coop-Defense-Szenarien, Missionen, Map-Adapter oder persistente Basen geändert werden. |
| [rendering.md](rendering.md) | ArenaScene, Kameras, Presentation, Renderer, FX oder visuelle Laufzeitobjekte betroffen sind. |
| [performance.md](performance.md) | Renderbudget, Streaming, Worker-Grenzen, Allokationen oder Qualitätsstufen betroffen sind. |
| [local-persistence.md](local-persistence.md) | Settings, Progress, Import/Export oder PersistentBase-Speicherung betroffen sind. |
| [visual-guidelines.md](visual-guidelines.md) | sichtbare Gameplay-Grafik oder Lesbarkeit gestaltet wird. |
| [held-item-sprites.md](held-item-sprites.md) | Held-Item-Sprites, Generatoren oder deren Laufzeitbindung geändert werden. |
| [weapon-balance-lab.md](weapon-balance-lab.md) | Balance-Lab, Headless-Szenarien, Benchmarks oder Debug-Ausgaben betroffen sind. |
| [testing.md](testing.md) | neue, geänderte, verschobene oder entfernte Tests sowie Runner-/Suite-Grenzen betroffen sind. |
| [reference-implementations.md](reference-implementations.md) | ein konkreter Einstiegspunkt als Muster für eine neue Änderung gesucht wird. |
| [local-dev-environment.md](local-dev-environment.md) | Verifikation, AI-Skill-Sync oder lokaler Start gebraucht wird. |

## Quellenhierarchie

Bei Widersprüchen gilt: aktueller Quellcode, öffentliche Types und Validatoren, passende Tests, authored Daten, erst danach diese Seiten. Eine Seite darf keinen Detailgrad vortäuschen, den ihr Owner nicht im Code garantiert.

## Dokumentationsregeln

- Beschreibe Invarianten und Zuständigkeiten, nicht lokale Methodenfolgen.
- Nenne IDs, Werte, Map-Listen und Versionen nur, wenn sie Teil eines aktuellen Vertrags oder einer konkreten Migration sind.
- Trenne World, Activity, Room-Mitgliedschaft, WorldParticipation, Replikation und lokale Presentation.
- Verweise für Details auf die kleinste maßgebliche Source-Datei oder den passenden Vertragstest.
- Prüfe nach Änderungen Pfade, Links, Symbolnamen und git diff --check. Für Änderungen an .ai/skills/fragdachse-phaser/SKILL.md anschließend npm run ai:sync ausführen.
