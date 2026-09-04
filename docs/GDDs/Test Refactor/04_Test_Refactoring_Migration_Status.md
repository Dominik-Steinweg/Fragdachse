# Fragdachse – Test Refactoring: Migrationsstatus

**Architektur:** `01_Test_Architecture_Core.md` + `02_Test_Architecture_Details.md`  
**Plan:** `03_Test_Refactoring_Implementation_Plan.md`

> Temporäres, bewusst kleines Arbeitsprotokoll für Coding-KIs.  
> Nach jeder Phase nur den **aktuellen handlungsrelevanten Zustand** pflegen.  
> Abgeschlossene Detailhistorie, frühere Dateilisten und erledigte Risiken wieder entfernen.  
> Keine Commit-SHAs eintragen – die Commit-Historie liegt in Git.  
> `01`, `02` und `03` werden während der Umsetzung nicht selbständig geändert.

---

## Statuslegende

- ⬜ offen
- 🟨 aktiv
- 🟧 blockiert
- ✅ abgeschlossen

---

## 1. Aktueller Stand

- **Aktive Phase:** `Phase 2 – Runner-/Suite-Trennung`
- **Zuletzt abgeschlossen:** `Phase 1 – Baseline und handlungsrelevante Migrationskarte`
- **Gesamtstatus:** Phase 1 abgeschlossen; Suite-Trennung als nächster Schritt offen.
- **Letzter automatisierter Gate:** `npm test` — grün (356 Testdateien, 2994 passed, 15 skipped)
- **Bekannte Regressionen:** keine
- **Sichtprüfung:** nicht vorgesehen

---

## 2. Phasenstatus

| Phase | Status | Kurzgegenstand |
|---|:---:|---|
| 1 | ✅ | Baseline + handlungsrelevante Migrationskarte |
| 2 | 🟨 | Runner-/Suite-Trennung |
| 3 | ⬜ | Source-Ratchets + Architecture-Tests |
| 4 | ⬜ | Config-/Content-/Visual-Tuning-Kopplung |
| 5 | ⬜ | Redundanz + Mock-Shape + Restballast |
| 6 | ⬜ | AI-Testpolicy + Final Gate |

---

## 3. Offene Test-Migrationskarte

> Nur problematische oder noch ungeklärte Cluster aufnehmen.  
> Gute `KEEP`-Tests nicht vollständig inventarisieren.  
> Erledigte Einträge nach Abschluss des Clusters entfernen.

| Cluster / Testbereich | Problem | Zielaktion | Zielphase | Status |
|---|---|---|---:|:---:|
| Source-/Phase-/Cutover-Ratchets (`ArenaSceneFrameCutover`, `Phase11DependencyCutover`, `PlayerGameplayReadViewBoundary`, `WorldGameplayCompositionContracts`, weitere Ownership-/Lifetime-Contracts) | 56 Testdateien lesen Produktionscode; historische Marker und dauerhafte Grenzen sind vermischt | B/R/S klassifizieren, Behavior-Tests stärken, Architecture-Scan konsolidieren, Historie löschen | 3 | offen |
| Balance-Lab-/Progression-/Benchmarktests (`Asmd`, `Bite`, `Glock`, `P90`, Coverage, Weapon-*`, `CoopDefenseBalanceLab`, `WeaponBalanceLab*`) | 16 spezialisierte Dateien; `npm test` schließt sie über 12 Einzelpfade aus | unter `tests/balance-lab/` bündeln und `test:balance-lab` als eigenen Runner etablieren | 2 | offen |
| Large-Arena-/Multi-Seed-/Performance-Tests (`LargeArenaGeneration`, `ArenaLoadingContracts`, `CoopDefenseArenaGeneration`, `PerformanceAblation`, `ProjectilePerformance`) | große Generator-/Benchmarkläufe werden aktuell nicht sauber vom Daily Gate getrennt | `stress`-Suite; technische Assertions behalten, Tuning-/Timingwerte prüfen | 2 | offen |
| Asset-/Pixel-/Maskenprüfungen (`GroundCoverField`, `RockMossField`, `RockVegetationField`, `PersistentBaseGravel`, `TerrainColorSnapshot`, weitere Texture-/Pixeltests) | Dateisystem-, Dekodierungs- und Pixelarbeit ist über normale Tests verteilt | technisch notwendige Integrität behalten, teure Prüfungen in `assets` verschieben | 2 | offen |
| große World-/Campaign-/Materialization-Integration (`ArenaLoadingContracts`, `LobbyWorld*`, `PersistentBase*`, `WorldMaterializationOwnership`, `SharedWorldWithoutActivity`) | reale Composition-/Materialization-Tests sind wertvoll, aber nicht durchweg Core-kostengünstig | echte Multi-Owner-Verträge nach `integration`, Pure-/Runtime-Teile im Core belassen | 2 | offen |
| normale Config-/Balance-Tests (`GraveTitanVoidPlasma`, `CoopDefenseInfernoColossusCombat`, `Ak47CoopDefenseUpgrades`, `PlasmaSwarm`, `CoopDefenseMaps`, `CoopDefenseItemStats`, `CoopDefenseRuntimeAffixWiring`, `InspectorSupportWeapons`, `CoopDefenseHostileBase`) | mutable authored Werte und Mapdaten können als zweite Wahrheit eingefroren sein | Assertion je Schutzwert prüfen; relativ zur Config, Strukturvalidator oder DELETE | 4 | offen |
| Visual-/VFX-/UI-Snapshots (`ArenaVisualAttribution`, `GraphicsQualityAndPerformance`, Renderer-/PostFX-/Terrain-Tests) | exakte ästhetische Farben, Alpha-, Glow-, Partikel- und Timingwerte sind mögliche Tuning-Ratchets | Lifecycle/Bounds/Verdrahtung schützen; ästhetische Snapshots DELETE oder MOVE | 4 | offen |
| Redundanz / Mock-Call-Shape | 89 Dateien nutzen Spies/Mocks; große Testdateien und doppelte Ownership-/Content-Aussagen sind erkennbar | nur berührte Cluster auf unterschiedlichen Schutzwert prüfen, dann CONSOLIDATE/REWRITE/DELETE | 5 | offen |

---

## 4. Offene Risiken / Entscheidungen

- Runner-Zuordnung der gemischten Dateien (`ArenaLoadingContracts`, `GraphicsQualityAndPerformance`, `PersistentBaseGravel`) muss anhand der einzelnen Tests erfolgen; keine pauschale Verschiebung.
- Die vorhandenen Source-Reads sind nicht automatisch löschbar: vor Phase 3 muss je Assertion geprüft werden, ob sie B, R oder S ist und ob ein Runtime-/Validator-Test bereits denselben Schutz liefert.

Während der Umsetzung hier nur Punkte führen, die die **nächste Phase** beeinflussen, z. B.:

- echter Vertrag unklar;
- Test lässt sich nicht ohne Produktionsänderung sinnvoll retten;
- Runner-Zuordnung technisch problematisch;
- unerwartete Flakiness;
- möglicher Produktionsbug.

Erledigte Punkte entfernen.

---

## 5. Dokumentations-Follow-ups

Für Phase 6 vorgesehen:

- `docs/ai/testing.md` neu
- `AGENTS.md` sehr kurzer Testhinweis
- `docs/ai/index.md`
- `docs/ai/local-dev-environment.md`
- `docs/ai/weapon-balance-lab.md`
- `.ai/skills/fragdachse-phaser/SKILL.md`
- danach `npm run ai:sync`

Keine dieser Änderungen vor Phase 6 nur vorsorglich durchführen, sofern ein früherer Runner-Umbau nicht zwingend einen kleinen aktuellen Kommando-Hinweis erfordert.

---

## 6. Nächster konkreter Schritt

**Phase 2 vollständig umsetzen.**

Dabei die Spezial-Suites über stabile Verzeichnis-/Patternregeln herstellen, die dateispezifische Balance-Exclude-Liste ablösen und danach alle in Phase 2 definierten Runner einschließlich `npm run check` und Build ausführen.

---

## 7. Update-Format nach jeder Phase

Nur aktualisieren:

- aktive Phase;
- zuletzt abgeschlossen;
- Gesamtstatus;
- letzter automatisierter Gate;
- bekannte aktuelle Regressionen;
- Phasenstatus;
- offene handlungsrelevante Migrationscluster;
- offene Risiken/Entscheidungen;
- Dokumentations-Follow-ups;
- nächster konkreter Schritt.

Nicht pflegen:

- Commit-SHAs;
- chronologische Historie;
- Liste aller guten Tests;
- abgeschlossene Detailmigrationen;
- vollständige Teststatistik je Phase, sofern sie für den nächsten Schritt nicht relevant ist.
