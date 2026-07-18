# Fragdachse – Copilot-Hinweise

Die kanonischen Projektregeln stehen in `/AGENTS.md`. Lies und befolge sie, insbesondere die Architektur-Invarianten und die proportionale Prüfmatrix.

- Ermittle Repository-Fakten mit gezielter Suche, statt vorsorglich große Dateien oder das gesamte Projekt zu laden.
- Nutze bei bereichsübergreifenden Netzwerk- oder Lifecycle-Änderungen zusätzlich `/docs/architecture.md`.
- Das Projekt verwendet Phaser 4. Prüfe unsichere APIs gezielt gegen die installierten Typen unter `node_modules/phaser/types/`; übernimm keine Phaser-3-Muster.
- Verwende vorhandene Systems, Manager, Renderer und `src/utils/phaserFx.ts`, bevor du neue Abstraktionen anlegst.
- Führe nur die in `/AGENTS.md` für die konkrete Änderungsgröße verlangte Prüfung aus.
