# Fragdachse – Combat Runtime Migration Status

**Architektur:** [01](01_Combat_Runtime_Architecture_Core.md) + [02](02_Combat_Runtime_Architecture_Details.md) · **Plan:** [03](03_Combat_Runtime_Implementation_Plan.md) · **Betrieb:** [05](05_Combat_Runtime_Implementation_Cheatsheet.md)

> Operativer Status ohne Historie. **Nur der Orchestrator schreibt.** Keine Vollinventare/Rohlogs. Zielgröße unter 8 KB.

## 1. Steuerung und aktueller Stand

| Feld | Aktueller Wert |
|---|---|
| Gesamtstatus | Block C aktiv; P13 läuft |
| Freigegebener Arbeitsblock | **C – Integration und Abschluss** (P7 → P8 → P9 → P10 → P11 → P12 → P13) |
| Freigabequelle | Nutzerauftrag nach bestandenem R2; Block C ausdrücklich gestartet |
| Nächster Arbeitsschritt | Frisches P13-Review 3 auf Korrekturcheckpoint 2 |
| Nächster geplanter Nutzerstopp | Nach P13; manuelle Gameplay-/Sichtabnahme M bleibt offen |
| Aktive Phase / Aufgabe | P13 – Review 3 nach Korrekturschleife 2 |
| Arbeitsbranch / lokaler Checkout-HEAD | `codex/combat-runtime-refactor` @ `d015ba61` |
| Start-HEAD der laufenden Aufgabe | `d015ba61` |
| Aktiver Worker / Thread | Frischer Astra-/High-Reviewer, read-only |
| Betriebsmodus | Desktop-App; native Subagenten, keine eigene Agentenkonfiguration |
| Aktuell nötiger Modell-/Reviewstopp | Keiner |
| Aktueller Reparaturzähler | P13: 2/2 automatische Fixschleifen |
| Technische Endabnahme F / manuelle Abnahme M | Beide offen |
| Browserprüfung / Deployment | Nicht durchgeführt |

**Freigaberegel:** R1/R2 erteilen keine Freigabe für B/C; dafür zählt nur eine tatsächliche Nutzernachricht.

## 2. Phasen und Review-Gates

⬜ offen · 🟨 aktiv · 🟧 blockiert · ✅ gemäß eigenem Gate abgeschlossen.

✅ bei P1–P12 bedeutet lokales Gate L, **nicht** spielbar oder global grün. Geplante Übergänge stehen in § 4. Ein noch nicht committierter Abschluss nach Unterbrechung muss gegen Git geprüft werden.

| Schritt | Block | Status | Gegenstand |
|---|:---:|:---:|---|
| P0 | A | ✅ | Baseline / Delta |
| P1 | A | ✅ | Contracts / World-Aufbauplan |
| R1 | A | ✅ | Vertragsreview bestanden; Nutzerstopp |
| P2 | B | ✅ | Combatant-Mutation |
| P3 | B | ✅ | Geometrie / Queries |
| P4 | B | ✅ | Damage / Support / Modifier / Defense |
| P5 | B | ✅ | Status / Mechanikzustände |
| P6 | B | ✅ | Reaktionen / Death / Kill / Player-Lifecycle |
| R2 | B | ✅ | Bestanden; keine reproduzierbaren Block-B-Stopper |
| P7 | C | ✅ | Projectile-Adapter |
| P8 | C | ✅ | Hitscan / Melee / Preview |
| P9 | C | ✅ | World-Mutation / Domain-Fan-out |
| P10 | C | ✅ | Verbleibende Consumer |
| P11 | C | ✅ | Gesamtgraph / Frame / Network / Presentation |
| P12 | C | ✅ | Legacy-Entfernung / Ratchets / Wissen |
| P13 | C | 🟨 | Unabhängiger Abschluss / technisches Gate F |
| M | Nutzer | ⬜ | Gebündelte Gameplay-/Sichtabnahme |

## 3. Realisierte Contracts

- `src/combat/CombatScope.ts`: `CombatScope`, `CombatTargetRef`, `CombatSource` (CF-SCOPE).
- `src/combat/CombatMutation.ts`: `TargetMutationOutcome`, Target-Mutation-Ports, `CombatDamagePort`, `CombatSupportPort` und explizite Damage-Basen (CF-MUTATION/CF-RESOLVE).
- `src/combat/CombatCapabilities.ts`: schmale CF-READ/QUERY/ATTACK/STATUS/REACTION/LIFE/FRAME/WORLD-Ports.
- `src/combat/WorldCombatRuntime.ts`: world-owned Build/Bind/Activate/Detach/Destroy-Grenze mit Required-Port-Prüfung; Besitzslot in `src/world/WorldRuntime.ts`.
- `src/combat/ProjectileCombatContractAdapter.ts`: reiner Provenance-/Target-/Direct-Basis-Adapter auf die unveränderten Projectile-Nachbarverträge.
- `src/combat/PlayerVitalsOwner.ts`, `EnemyManager`, `DecoySystem`: kanonische Combatant-Writer mit atomaren, unveränderlichen Mutation-Receipts und Instanz-/Life-Prüfung.
- `WorldGeometryBinding` bindet den einzigen `ArenaObstacleIndex` an die World und stellt schmale, read-only LoS-/LoF-/Muzzle-/Target-Geometriequeries bereit; Legacy-Consumer wechseln in P10.
- `CombatResolution` und `CombatRelationshipPolicy`: Phaser-freie Damage-/Support-Regeln mit expliziter Faktorherkunft, Eligibility, Host-Zeit/RNG und kanonischem Mutation-Commit.
- `CombatBurnStatusOwner`, `EnemyMovementStatusSystem`, `TargetStatusSystem` und `PlasmaSwarmReactionSystem`: je ein World-lokaler Writer mit passiven Reads und explizitem Advance/Prune/Clear.
- `PlayerLifeRuntime` und `WorldCombatReactions`: deadline-basierter Respawn ohne Timer sowie geordnete, reentrancy-sichere Reaction-/Kill-Folgen aus gesicherten Fakten.
- Projectile-Direct-Adapter committen Player-/Enemy-/Decoy-Schaden über konkrete Targets und Receipts; `WorldProjectileRuntime` übernimmt tatsächliche AoE-Keys in seine Same-Frame-Continuation.
- Normalisierte Hitscan-/Melee-Aufträge laufen über `CombatImmediateAttackPort`; sichere Mündung/Range bleiben bei Execution, der Host führt Query→Resolution→Mutation aus und Melee friert die geometrische Grundzielmenge vor der ersten Mutation ein.
- `WorldObjectMutationRuntime` dedupliziert World-Aliase und projiziert atomare Owner-Outcomes; Rock-/Construction-/Base-/Train-HP, Removal und Cleanup bleiben bei den fachlichen Ownern, während `RockVisualHelper` nur noch präsentiert.
- Gameplay-Consumer hängen an expliziten Actor-/Relationship-/Geometry-/Damage-/Support-/Modifier-/Status-Slices; Burrow nutzt die World-Geometrie und lehnt einen Exit ohne gebundenen Query-Port fail-closed ab.
- Combat-Kern und `WorldCombatRuntime` entstehen einmal pro lokaler World im Build→Bind→Activate-Ablauf; Scope-Generation und identitätsgesicherte Leases machen Rebuild/Teardown stale-sicher. Host-Frame und Combat-RPCs verwenden synchronisierte Host-Zeit bei erhaltener Stage-Reihenfolge.
- `WorldCombatCore` ersetzt den produktiven `CombatSystem`; Scene-Slot, Legacy-Ports, optionale Attack-Fallbacks und tote Attribution-Maps sind entfernt. Architektur-/Gameplay-/Networking-Wissen und Syntax-Ratchet halten die verifizierten Grenzen fest.

## 4. Aktive Übergänge und Blocker

P1–P12 sind realisiert. Die zwei Blocker aus Review 2 sind in Fix 2 behoben; Review 3 entscheidet Abschluss oder manuellen Stopp.

## 5. Nachweise und Reviews

**P0–P6/R1:** Phasengates und Vertragsreview grün; Details in den Commits.

**P2–P6 Gates L:** Fokus/Integration, Architektur, TypeScript, Build und Writer-Audits grün.

**R2:** bestanden auf `b74a1b07`; keine reproduzierbaren P2–P6-Stopper.

**P7–P10 Gates L:** jeweilige Fokus-/Regressionstests, vollständiger Check, TypeScript-, Writer- und Diff-Audits grün; genaue Zahlen stehen in den Phasencommits.

**P11-Gate L:** Fokus 87/87, RPC 11/11, Headless-Integration 89/89, Check 2789 Core/32 Architektur und Build grün; Orchestrator-Stichprobe 25/25 sowie Ownership-/Zeit-/Stage-/Diff-Ratchets grün.

**P12-Gate L:** Check 2789 Core/33 Architektur/Build, Integration 204 und Balance-Lab 94 grün; Orchestrator-Stichprobe 41/41 plus Architektur 33/33, Legacy-/Writer-/Diff-Audits grün.

**P13-Fix 1:** 62 Fokus, Check 2789/33/Build, Integration 210, Stress 44, Balance-Lab 94, Assets 44 und Diff-Check grün.

| Review | Ergebnis | Geprüfter Code-HEAD | Offene Blocking-Findings |
|---|---|---|---|
| R1 | Bestanden | `ee5742b4` | Keine |
| R2 Review 7 | Bestanden | `b74a1b07` | Keine |
| P13 | Nicht ausgeführt | – | – |

Nur Testgruppe, Exit-Code, Ergebnis und gültigen Code-Bezug festhalten. Fehlender Beleg verlangt erneute Prüfung; alter Review-Pass gilt nach Code-Delta nicht automatisch weiter.

## 6. Fortschreibung und Wiederanlauf

Vor Workerstart Freigabe, Voraussetzungen und Working Tree prüfen; 🟨, Start-HEAD und Worker eintragen. Währenddessen schreibt nur der Worker. Nach Rückgabe Lieferung und Gates prüfen; nur erfüllte Arbeit ✅ setzen und mit Code committen.

Beim Wiederanlauf Branch/HEAD, Working Tree und Threads mit § 1 abgleichen. Keine Phase wiederholen oder Nutzeränderung verwerfen. Nach R1/R2 Nutzerfreigabe abwarten; 01–03/05 nicht eigenmächtig umdefinieren.
