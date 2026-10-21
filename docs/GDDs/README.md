# GDD- und Konzeptübersicht

Diese Seite zeigt, welches Dokument zu einem Thema aktuell ist und ob es umgesetzt wurde. Die
„Status“-Zeilen in den Dokumentköpfen geben den Stand beim Schreiben wieder und veralten. Maßgeblich
ist der Code; der Stand hier wurde am 2026-10-16 an `main` geprüft.

Stand-Werte:
- **umgesetzt:** Das Feature ist auf `main` vorhanden. Balancing und Spieltests können trotzdem offen sein.
- **ersetzt:** Eine neuere Version gilt.
- **normativ:** Zielarchitektur; der Fortschritt steht in der jeweiligen Status-Datei.

Neue GDDs bekommen hier eine Zeile. Ersetzt eine neue Version eine alte, wird die alte auf „ersetzt“
gesetzt.

## Inspector Gadachs

| Dokument | Stand |
|---|---|
| [Feuerleit-Utilities V1](Fragdachse_GDD_Inspector_Gadachs_Feuerleit_Utilitys_V1.md) | ersetzt durch V2 |
| [Feuerleit-Utilities V2](Fragdachse_GDD_Inspector_Gadachs_Feuerleit_Utilitys_V2.md) | umgesetzt (Turmkopien, Portale, Basisbeschuss); offen: HE kostenpflichtig für den Inspector (P3.1) |
| [Ultimates V1](Fragdachse_GDD_Inspector_Gadachs_Ultimates_V1.md) | ersetzt durch V2 |
| [Ultimates V2](Fragdachse_GDD_Inspector_Gadachs_Ultimates_V2.md) | umgesetzt (Holo-Offensive, Bombergeschwader mit Bomberflug, Drohnen-Nachtlicht) |

## Waffen, Utilities und Upgrades

| Dokument | Stand |
|---|---|
| [Adrenalin-Essenz GDD v2.1](Adrenalin%20Essenz/Fragdachse_Adrenalin_Essenz_GDD_v2_1.md) und [Umsetzungsplan](Adrenalin%20Essenz/Fragdachse_Adrenalin_Essenz_Implementation_Plan.md) | umgesetzt |
| [Angriffsdrohnenstation v2](Fragdachse_GDD_Angriffsdrohnenstation_v2.md) | umgesetzt |
| [Decoy-Utility v2](Fragdachse_GDD_Decoy_Utility_Rework_v2.md) | umgesetzt |
| [HE-Granaten-Upgradebaum v2](Fragdachse_GDD_HE_Grenade_Upgrade_Tree_v2.md) | umgesetzt |
| [MG-Turm v3](MG_Turm_Gameplay_Upgrade_Konzept_v3.md) | umgesetzt |
| [Plasmabrenner v1](Fragdachse_Plasmabrenner_Upgrade_Konzept_v1.md) | umgesetzt |
| [Rocket-Launcher-Upgrade v2](FRAGDACHSE_Rocket_Launcher_Upgrade_GDD_v2.md) | umgesetzt |
| [Smoke-Granaten-Überarbeitung](Fragdachse_GDD_Smoke_Grenade_Rework.md) | umgesetzt; Spielabnahme: [Bericht](../reports/Smoke_Grenade_Rework_Playtest.md) |
| [Stinkdrüsen/Seuchen-Upgrades](Fragdachse_GDD_Stinkdruesen_Seuchen_Upgrades.md) | umgesetzt |
| [Translocator v2](Fragdachse_GDD_Translocator_Utility_Rework_v2.md) | umgesetzt |
| [Zeus-Upgrades](Fragdachse_GDD_Zeus_Upgrades.md) und [Implementierungsplan](Fragdachse_GDD_Zeus_Implementierungsplan.md) | umgesetzt |

## Gegner

| Dokument | Stand |
|---|---|
| [Alien-Kegelangriff V1](Fragdachse_GDD_Alien_Kegelangriff_V1.md) | umgesetzt (die Kopfzeile „keine Implementierung“ ist veraltet) |
| [Brandstifter](Fragdachse_GDD_Brandstifter.md) | umgesetzt |
| [Kabummtula V1](Fragdachse_GDD_Kabummtula_V1.md) | umgesetzt (ersetzt den Zeitbomben-Dachs); Optimierungsphase mit Testfeedback offen |
| [Mörser-Dachs V1](Fragdachse_GDD_Moerser_Dachs_V1.md) | umgesetzt |
| [Schild-Anstürmer V1](Fragdachse_GDD_Schild_Anstuermer_V1.md) | umgesetzt (die Kopfzeile „keine Implementierung“ ist veraltet) |

## Modi, Kampagne und Basis

| Dokument | Stand |
|---|---|
| [From Dachs Till Dawn – Gesamtkonzept V1](Fragdachse_From_Dachs_Till_Dawn_Gesamtkonzept_V1.md) | Rahmenkonzept |
| [From Dachs Till Dawn – GDD V2](Fragdachse_From_Dachs_Till_Dawn_GDD_V2.md) | in Umsetzung; Pakete A–F auf `main`, weitere Arbeit im Branch `dawn` |
| [Dawn – Bildsprache V1](Fragdachse_From_Dachs_Till_Dawn_Art_Direction_V1.md), [Händler-UI V1](Fragdachse_From_Dachs_Till_Dawn_Haendler_UI_V1.md), [Uhr V1](Fragdachse_From_Dachs_Till_Dawn_Uhr_V1.md) | Gestaltungsvorgaben zu Dawn |
| [Kampagnenprogression Maps 1–17](Fragdachse_GDD_Kampagnenprogression_Maps_1-17%20%281%29.md) und [Tuning](Kampagnenprogression_Maps_1-17_Tuning.md) | umgesetzt; Playtests und Balancing offen |
| [Map 16 – Spinnensteig V1](Fragdachse_GDD_Map16_Spinnensteig_V1.md) | umgesetzt (ersetzt den Prototyp „Zeitzünder“); Playtest offen |
| [Sprengbare Brücken V1](Fragdachse_GDD_Sprengbare_Bruecken_V1.md) | umgesetzt auf `main` (Map 12, Dawn-Sprengstofflager, Flussbogen, Teichland-Kanal, Blender-Bausatz); Playtest offen |
| Persistente Basis Phase 3: [Roadmap](Persistent%20Base%20Phase%203/Fragdachse_GDD_Persistente_Basis_Phase3_Roadmap.md), [3C](Persistent%20Base%20Phase%203/Fragdachse_GDD_Persistente_Basis_Phase3C_Implementierungsplan.md), [3D V4](Persistent%20Base%20Phase%203/Fragdachse_GDD_Persistente_Basis_Phase3D_V4.md), [3E](Persistent%20Base%20Phase%203/Fragdachse_GDD_Persistente_Basis_Phase3E.md), [3F V3](Persistent%20Base%20Phase%203/Fragdachse_GDD_Persistente_Basis_Phase3F_V3.md) | umgesetzt; den Stand der einzelnen Phasen nennt die Roadmap |

## Welt, Darstellung und Technik

| Dokument | Stand |
|---|---|
| [Bodennebel-Konzept v1](Fragdachse_Bodennebel_Konzept_v1.md) | umgesetzt ([Lab](../ground-fog-lab.md)) |
| [Nachtsicht, Mondlicht und Void-Botanik V1](Fragdachse_GDD_Nachtsicht_Void_Botanik_V1.md) | umgesetzt (Mondinseln, Lampe an Felsen, Nachtwasser, Void-Botanik mit Argon- und ComfyUI-Assets); offen: Spieltest, Referenzbilder des Nachttests |
| [Void-Gefahrenzonen und feste Spawnzonen V1](Fragdachse_GDD_Void_Gefahrenzonen_V1.md) | umgesetzt (2026-10-19); offen: Spieltest, Void-Vorschau im Map-Editor, Perf-Messpaar; ersetzt N-6/N-7 der Nachtsicht |
| [Hindernisklassen und Schusslinien](FRAGDACHSE_GDD_Hindernisklassen_und_Schusslinien.md) und [Umsetzung](FRAGDACHSE_Hindernisklassen_Umsetzung.md) | umgesetzt |
| [HP-Balken-Trefferfeedback](HP_Bar_Feedback_Implementation.md) | umgesetzt |
| [KI- und Navigationskonzept](Fragdachse_KI_Navigation_Implementierungskonzept.md) | umgesetzt ([Status](../navigation-implementation-status.md)) |
| [LivingBar GPU – Konzept](Fragdachse_LivingBar_GPU_Visual_Fidelity_Technisches_Konzept.md) und [Umsetzung](Fragdachse_LivingBar_GPU_Visual_Fidelity_Umsetzungsplan.md) | umgesetzt |
| [Projectile Flight Signature v2](Fragdachse_Projectile_Flight_Signature_GDD_v2.md) | umgesetzt |
| [Schießstand und Shift-Interaktionen v1](Fragdachse_Konzept_Schiessstand_Shift_Interaktionen_v1.md) | umgesetzt |
| Map 6 Performance: [Analyse](FRAGDACHSE_Map6_Performance_Analyse_2026-09-08.md) und [Umsetzung](FRAGDACHSE_Map6_Performance_Umsetzung_2026-09-08.md) | historischer Bericht (2026-09-08) |

## Werkzeuge

| Dokument | Stand |
|---|---|
| [Audio-Studio-Konzept v1](Fragdachse_Audio_Studio_Konzept_v1.md) | umgesetzt (`tools/audio-studio`) |
| [Map-Editor V1, Konzept v2](Fragdachse_Map_Editor_V1_Konzept_v2.md) und [Umsetzungsplan](Fragdachse_Map_Editor_V1_Umsetzungsplan.md) | umgesetzt (`npm run map:editor`) |
| [Performance-Lab, Konzept V1 Rev. 3](Fragdachse_Performance_Lab_Konzept_V1_Revision_3.md) | umgesetzt ([Bedienung](../performance-lab.md)) |

## Architektur-Refactorings

Diese Dokumente sind normativ. Den Fortschritt pflegt jeweils die Status-Datei.

| Reihe | Stand |
|---|---|
| [Arena Runtime](ArenaRuntime%20Refactor/Fragdachse_Arena_Runtime_Architecture.md) | [Migration Status](ArenaRuntime%20Refactor/Fragdachse_Arena_Runtime_Migration_Status.md) |
| [ArenaScene](ArenaScene%20Refactor/Fragdachse_ArenaScene_Architecture.md) | [Migration Status](ArenaScene%20Refactor/Fragdachse_ArenaScene_Migration_Status.md) |
| [Combat Runtime](Combat%20Runtime%20Refactor/01_Combat_Runtime_Architecture_Core.md) | [Migration Status](Combat%20Runtime%20Refactor/04_Combat_Runtime_Migration_Status.md) |
| [Gameplay Runtime](Gameplay%20Runtime%20Refactor/01_Gameplay_Runtime_Architecture_Core.md) | [Migrationsstatus](Gameplay%20Runtime%20Refactor/04_Gameplay_Runtime_Migration_Status.md) |
| [Projectile Runtime](Projectile%20Runtime%20Refactor/01_Projectile_Runtime_Architecture_Core.md) | abgeschlossen ([Abschlussstatus](Projectile%20Runtime%20Refactor/04_Projectile_Runtime_Migration_Status.md)) |
| [Test-Architektur](Test%20Refactor/01_Test_Architecture_Core.md) | [Migrationsstatus](Test%20Refactor/04_Test_Refactoring_Migration_Status.md) |

Das beschlossene Architektur-Leitbild für neue Arbeit steht in
[`docs/ai/architecture-principles.md`](../ai/architecture-principles.md).
