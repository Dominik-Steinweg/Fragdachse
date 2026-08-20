# AI-Wissensbasis

Kompakter Router für langlebiges Projektwissen. Der Quellcode, die Typen und die authored Daten bleiben die technische Wahrheit. Vor Änderungen konkrete Aussagen gegen die betroffenen Codepfade und Tests prüfen.

- [architecture.md](architecture.md): Boot, Systemgrenzen, Abhängigkeiten und Scene-/Round-Lifetime.
- [networking.md](networking.md): Peer-Schichten, Kanalsemantik, Host-Autorität, Replikation und Resume.
- [gameplay.md](gameplay.md): Phasen, Modi, Participation/Spectator und allgemeine Gameplay-Grenzen.
- [coop-defense-authoring.md](coop-defense-authoring.md): Maps, Objectives, Encounters, Events, Fronts und Zeitbasis.
- [content-and-config.md](content-and-config.md): JSON-Authoring, Registries, Validatoren, IDs und Referenzintegrität.
- [rendering.md](rendering.md): Designraum, Kameras, Clarity Camera, Lightmap, Post-FX und Koordinatenfallen.
- [visual-guidelines.md](visual-guidelines.md): Art Direction, Top-down-Perspektive und Lesbarkeit.
- [performance.md](performance.md): Messmethodik, Qualitätsprofile und dauerhafte Hotpath-Regeln.
- [weapon-balance-lab.md](weapon-balance-lab.md): Versionierte Benchmark-Szenarien, Messfenster, Paritaet und Capability-Vertraege.
- [reference-implementations.md](reference-implementations.md): wenige kanonische Codebeispiele.
- [local-dev-environment.md](local-dev-environment.md): Agenten-Ports und opt-in Browserprüfung.
- [local-persistence.md](local-persistence.md): lokale Settings, Fortschritt, Migration und Import/Export.
- [held-item-sprites.md](held-item-sprites.md): Authoring-Pfad für getragene Item-Sprites.

## Gemeinsame Skills

Bearbeitbare Quellen sind .ai/skills/ und .ai/vendor/phaser-skills/. npm run ai:sync spiegelt sie nach .agents/skills/ und .claude/skills/; diese Spiegel nicht manuell auseinanderentwickeln.
