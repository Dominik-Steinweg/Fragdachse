# AI-Wissensbasis

Diese Seiten sind ein kleiner Router für langlebiges Projektwissen. Der Quellcode ist immer die technische Wahrheit. Vor einer Aufgabe nur die fachlich relevanten Seiten lesen und Aussagen bei Änderungen gegen reale Codepfade verifizieren.

- [`architecture.md`](architecture.md): Systemgrenzen, Einstiegspunkte und Scene-/Round-Lifecycle.
- [`gameplay.md`](gameplay.md): Spielidee, Modi sowie Trennung von Lobby und Arena.
- [`networking.md`](networking.md): WebRTC-Transport, Host-Autorität, Kanalzuordnung, Replikation und Diagnose.
- [`visual-guidelines.md`](visual-guidelines.md): verbindliche Perspektive, Qualitätsmaßstab, Effekt- und Assetregeln.
- [`reference-implementations.md`](reference-implementations.md): wenige bewährte Code-Referenzen und ihre sinnvolle Verwendung.

Neue Seiten nur anlegen, wenn ein bestätigtes eigenständiges Thema genug dauerhaftes Wissen besitzt. Vorzugsweise vorhandene Seiten aktualisieren und neue Seiten hier eintragen.

## Gemeinsame Skills pflegen

Kanonisch und manuell bearbeitbar sind nur:

- `.ai/skills/` für projektspezifische Skills.
- `.ai/vendor/phaser-skills/` für den gepinnten, unveränderten offiziellen Phaser-Skill-Satz.

`npm run ai:sync` spiegelt beide Quellen nach `.agents/skills/` (Codex) und `.claude/skills/` (Claude Code). Diese generierten Spiegel werden eingecheckt, damit beide Agenten ohne lokale Einrichtung dieselben Inhalte sehen. Die einfachere Alternative wären Verzeichnis-Symlinks; sie wird wegen Windows-Rechten, Git-Portabilität und unterschiedlicher Agentenumgebungen nicht verwendet.

Ein Phaser-Update erfolgt bewusst manuell: exakte installierte Version prüfen, einen festen offiziellen Tag/Commit wählen, dessen vollständigen `skills/`-Inhalt und Lizenz in `.ai/vendor/phaser-skills/` ersetzen, [`VERSION.md`](../../.ai/vendor/phaser-skills/VERSION.md) aktualisieren, `npm run ai:sync` ausführen und Quellen gegen beide Spiegel vergleichen.
