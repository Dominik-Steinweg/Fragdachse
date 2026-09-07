# Fragdachse – Combat Runtime Migration Status

**Architektur:** [01](01_Combat_Runtime_Architecture_Core.md) + [02](02_Combat_Runtime_Architecture_Details.md) · **Plan:** [03](03_Combat_Runtime_Implementation_Plan.md) · **Betrieb:** [05](05_Combat_Runtime_Implementation_Cheatsheet.md)

> Operativer Status ohne Historie. **Nur der Orchestrator schreibt.** Keine Interface-Kopien, Vollinventare, Rohlogs oder SHA-Chronik. Zielgröße unter 8 KB.

## 1. Steuerung und aktueller Stand

| Feld | Aktueller Wert |
|---|---|
| Gesamtstatus | Block C aktiv; P8-Gate erfüllt, P9 als Nächstes |
| Freigegebener Arbeitsblock | **C – Integration und Abschluss** (P7 → P8 → P9 → P10 → P11 → P12 → P13) |
| Freigabequelle | Nutzerauftrag nach bestandenem R2; Block C ausdrücklich gestartet |
| Nächster Arbeitsschritt | P9 World-Mutation / Support / Domain-Fan-out mit frischem Sol-/High-Worker |
| Nächster geplanter Nutzerstopp | Nach P13; manuelle Gameplay-/Sichtabnahme M bleibt offen |
| Aktive Phase / Aufgabe | Keine; P8 lokal abgeschlossen |
| Arbeitsbranch / lokaler Checkout-HEAD | `codex/combat-runtime-refactor` @ `08fc9e8a` |
| Start-HEAD der laufenden Aufgabe | `08fc9e8a` |
| Aktiver Worker / Thread | Keiner; frischer P9-Kontext als Nächstes |
| Betriebsmodus | Desktop-App; native Subagenten, keine eigene Agentenkonfiguration |
| Aktuell nötiger Modell-/Reviewstopp | Keiner |
| Aktueller Reparaturzähler | P13 noch nicht begonnen; 0/2 automatische Fixschleifen |
| Technische Endabnahme F / manuelle Abnahme M | Beide offen |
| Browserprüfung / Deployment | Nicht beauftragt, nicht durchgeführt |

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
| P9 | C | ⬜ | World-Mutation / Domain-Fan-out |
| P10 | C | ⬜ | Verbleibende Consumer |
| P11 | C | ⬜ | Gesamtgraph / Frame / Network / Presentation |
| P12 | C | ⬜ | Legacy-Entfernung / Ratchets / Wissen |
| P13 | C | ⬜ | Unabhängiger Abschluss / technisches Gate F |
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

## 4. Aktive Übergänge und Blocker

P1–P7 sind realisiert:

| Art / Befund | Betroffene Grenze und Ursache | Schließphase / nächste Aktion |
|---|---|---|
| Geplanter Integrationsübergang | Verbleibende Nicht-Projectile-Consumer auf explizite Herkunft umstellen (D9) | P8/P10 |
| Geplanter Integrationsübergang | Explizite Wirkungseinheiten und renderer-unabhängige World-Mutation (D6/D8) | P9 |
| Geplanter Integrationsübergang | Direkte `CombatSystem.getObstacleIndex()`-Consumer auf die World-Query-Grenze umstellen | P10 |
| Geplanter Integrationsübergang | Verbleibende Attack-, World-, Consumer- und Composition-Ports produktiv schließen | P8–P11 gemäß Contract-Manifest |

## 5. Nachweise und Reviews

**P0/P1:** Baseline-Matrix grün; P1 Fokus 43/43, Integration 175/175, Typecheck/Diff-Check grün; R1 nach Korrekturen bestanden.

**P2–P6 Gates L:** jeweilige Fokus-/Integrationssuiten, Architektur, TypeScript, Build, Writer- und Diff-Audits grün; Details in den Phasen-Commits.

**R2:** bestanden auf `b74a1b07`; 133/133 Fokus, 201/201 Integration und 32/32 Architektur grün; keine reproduzierbaren P2–P6-Stopper.

**P7-Gate L:** Fokus 63/63, Check 2781 Core/32 Architektur und Build grün; Orchestrator-Stichprobe 57/57, TypeScript/Diff-Check grün.

**P8-Gate L:** Fokus 27/27 und Melee-Regression 18/18, Check 2783 Core/32 Architektur und Build grün; Orchestrator-Stichprobe 25/25, TypeScript/Diff-Check grün.

| Review | Ergebnis | Geprüfter Code-HEAD | Offene Blocking-Findings |
|---|---|---|---|
| R1 | Bestanden | `ee5742b4` | Keine |
| R2 Review 7 | Bestanden | `b74a1b07` | Keine |
| P13 | Nicht ausgeführt | – | – |

Nur Testgruppe, Exit-Code, Ergebnis und gültigen Code-Bezug festhalten. Fehlender Beleg verlangt erneute Prüfung; alter Review-Pass gilt nach Code-Delta nicht automatisch weiter.

## 6. Fortschreibung und Wiederanlauf

Vor Workerstart Freigabe, Voraussetzungen und Working Tree prüfen; 🟨, Start-HEAD und Worker eintragen. Währenddessen schreibt nur der Worker. Nach Rückgabe Lieferung und Gates prüfen; nur erfüllte Arbeit ✅ setzen und mit Code committen.

Beim Wiederanlauf Branch/HEAD, Working Tree und Threads mit § 1 abgleichen. Keine Phase wiederholen oder Nutzeränderung verwerfen. Nach R1/R2 Nutzerfreigabe abwarten; 01–03/05 nicht eigenmächtig umdefinieren.
