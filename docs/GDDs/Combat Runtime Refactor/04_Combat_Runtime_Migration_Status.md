# Fragdachse – Combat Runtime Migration Status

**Architektur:** [01](01_Combat_Runtime_Architecture_Core.md) + [02](02_Combat_Runtime_Architecture_Details.md) · **Plan:** [03](03_Combat_Runtime_Implementation_Plan.md) · **Betrieb:** [05](05_Combat_Runtime_Implementation_Cheatsheet.md)

> Operativer Status ohne Historie. **Nur der Orchestrator schreibt.** Keine Interface-Kopien, Vollinventare, Rohlogs oder SHA-Chronik. Zielgröße unter 8 KB.

## 1. Steuerung und aktueller Stand

| Feld | Aktueller Wert |
|---|---|
| Gesamtstatus | Block B aktiv; R2 Review 1 nicht bestanden, Fixschleife 1 aktiv |
| Freigegebener Arbeitsblock | **B – fachlicher Kern** (P2 → P3 → P4 → P5 → P6 → R2) |
| Freigabequelle | Nutzerauftrag nach bestandenem R1; Block B ausdrücklich gestartet |
| Nächster Arbeitsschritt | Begrenzter P5/P6-Fix, danach frisches R2 Review 2 |
| Nächster geplanter Nutzerstopp | Nach R2; P7 benötigt gesonderte Freigabe C |
| Aktive Phase / Aufgabe | R2-Fix 1 – Target-Inkarnation, Burn-Provenance, Player-Status-Lifetime |
| Arbeitsbranch / lokaler Checkout-HEAD | `codex/combat-runtime-refactor` @ `ac5a77ba` |
| Start-HEAD der laufenden Aufgabe | `ac5a77ba` |
| Aktiver Worker / Thread | P6-Fix-Worker, Astra / High |
| Betriebsmodus | Desktop-App; native Subagenten, keine eigene Agentenkonfiguration |
| Aktuell nötiger Modell-/Reviewstopp | Keiner |
| Aktueller Reparaturzähler | R2 Fixschleife 1 von max. 2 |
| Technische Endabnahme F / manuelle Abnahme M | Beide offen |
| Browserprüfung / Deployment | Nicht beauftragt, nicht durchgeführt |

Analysebasis: `main` @ `d5cb4519fb06dd74e22d21e8d63e635ea75bbc26`; Projectile ist abgeschlossen. P0/F bleiben eigene Combat-Gates.

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
| R2 | B | 🟧 | Review 1 mit drei lokalen Blockern; Fix 1 aktiv |
| P7 | C | ⬜ | Projectile-Adapter |
| P8 | C | ⬜ | Hitscan / Melee / Preview |
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

## 4. Aktive Übergänge und Blocker

P1–P4 sind realisiert:

| Art / Befund | Betroffene Grenze und Ursache | Schließphase / nächste Aktion |
|---|---|---|
| Geplanter Integrationsübergang | Legacy-Projectile-Adapter nutzen die neuen Receipts noch nicht vollständig (D1/D4) | P7 |
| Geplanter Integrationsübergang | Explizite Herkunft statt Legacy-`direct`-Default (D9) | P7/P10 |
| Geplanter Integrationsübergang | Explizite Wirkungseinheiten und renderer-unabhängige World-Mutation (D6/D8) | P9 |
| Geplanter Integrationsübergang | Verbleibende Projectile-Callback-Reaktionen auf den einen Ausführungspfad umstellen (D10) | P7 |
| Geplanter Integrationsübergang | Direkte `CombatSystem.getObstacleIndex()`-Consumer auf die World-Query-Grenze umstellen | P10 |
| Geplanter Integrationsübergang | P1-Contracts sind bewusst noch nicht produktiv verdrahtet; konkrete Target-/Life-Generationen und fachliche Capability-Owner fehlen | P2–P11 gemäß Contract-Manifest |
| R2-Fix 1 | Enemy-Child-Reaktion prüft Target-Inkarnation nach externen Hooks nicht erneut | P6-Fix |
| R2-Fix 1 | Burn-Tick verwirft gespeicherte `CombatSource` und rekonstruiert Legacy-Herkunft | P5/P6-Fix |
| R2-Fix 1 | Player-Vulnerability endet nicht mit der Life-Instanz | P5/P6-Fix |

## 5. Nachweise und Reviews

**P0/P1:** Baseline-Matrix grün; P1 Fokus 43/43, Integration 175/175, Typecheck/Diff-Check grün; R1 nach Korrekturen bestanden.

**P2-Gate L:** Check 2738 Core/32 Architektur, Integration 176/176, Fokus 32/32, Typecheck/Writer-/Diff-Audit grün.

**P3-Gate L:** Fokus 14/14, Integration 176/176, Typecheck/Diff-Check grün; gemeinsamer Index und stale-sicheres Detach abgedeckt.

**P4-Gate L:** Check 2752 Core/32 Architektur und Build grün; Integration 177/177, Fokus 34/34, Typecheck/Diff-Check grün. D3 ohne Tuningänderung; Rettung trennt Schaden und Heilung.

**P5-Gate L / letztes lokales Gate:** bestanden auf `b032ea84` plus P5-Lieferung. Check: 2759 Core-/32 Architekturtests und Build grün; Integration 177/177; Orchestrator-Fokus 50/50; Typecheck, Writer- und Diff-Audit grün. Source-Tod bleibt vom endgültigen Source-Detach getrennt; kein zweiter Tick.

**P6-Gate L / letztes lokales Gate:** bestanden auf `bc03fee1` plus P6-Lieferung. Check: 2770 Core-/32 Architekturtests und Build grün; Integration 179/179; Orchestrator-Fokus 35/35; Typecheck, Timer-/Writer- und Diff-Audit grün.

| Review | Ergebnis | Geprüfter Code-HEAD | Offene Blocking-Findings |
|---|---|---|---|
| R1 | Bestanden | `ee5742b4` | Keine |
| R2 Review 1 | Nicht bestanden | `ac5a77ba` | 3 lokale Fixes: Inkarnation, Burn-Source, Player-Status |
| P13 | Nicht ausgeführt | – | – |

Nur Testgruppe, Exit-Code, Ergebnis und gültigen Code-Bezug festhalten. Fehlender Beleg verlangt erneute Prüfung; alter Review-Pass gilt nach Code-Delta nicht automatisch weiter.

## 6. Fortschreibung und Wiederanlauf

Vor Workerstart Freigabe, Voraussetzungen und Working Tree prüfen; 🟨, Start-HEAD und Worker eintragen. Währenddessen schreibt nur der Worker. Nach Rückgabe Lieferung und Gates prüfen; nur erfüllte Arbeit ✅ setzen und mit Code committen.

Beim Wiederanlauf Branch/HEAD, Working Tree und Threads mit § 1 abgleichen. Keine Phase wiederholen oder Nutzeränderung verwerfen. Nach R1/R2 Nutzerfreigabe abwarten; 01–03/05 nicht eigenmächtig umdefinieren.
