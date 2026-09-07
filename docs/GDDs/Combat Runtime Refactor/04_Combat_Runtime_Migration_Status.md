# Fragdachse – Combat Runtime Migration Status

**Architektur:** [01](01_Combat_Runtime_Architecture_Core.md) + [02](02_Combat_Runtime_Architecture_Details.md) · **Plan:** [03](03_Combat_Runtime_Implementation_Plan.md) · **Betrieb:** [05](05_Combat_Runtime_Implementation_Cheatsheet.md)

> Operativer Status ohne Historie. **Nur der Orchestrator schreibt.** Keine Interface-Kopien, Vollinventare, Rohlogs oder SHA-Chronik. Zielgröße unter 8 KB.

## 1. Steuerung und aktueller Stand

| Feld | Aktueller Wert |
|---|---|
| Gesamtstatus | Block B gestoppt; R2 Review 3 mit Blocker |
| Freigegebener Arbeitsblock | **B – fachlicher Kern** (P2 → P3 → P4 → P5 → P6 → R2) |
| Freigabequelle | Nutzerauftrag nach bestandenem R1; Block B ausdrücklich gestartet |
| Nächster Arbeitsschritt | Manuelle Prüfung/Freigabe des R2-Blockers; P7 nicht beginnen |
| Nächster geplanter Nutzerstopp | Nach R2; P7 benötigt gesonderte Freigabe C |
| Aktive Phase / Aufgabe | Keine; Nutzerstopp nach ausgeschöpften Fixschleifen |
| Arbeitsbranch / lokaler Checkout-HEAD | `codex/combat-runtime-refactor` @ `8c8b8dc5` |
| Start-HEAD der laufenden Aufgabe | – |
| Aktiver Worker / Thread | Keiner |
| Betriebsmodus | Desktop-App; native Subagenten, keine eigene Agentenkonfiguration |
| Aktuell nötiger Modell-/Reviewstopp | Nutzerentscheidung erforderlich |
| Aktueller Reparaturzähler | 2/2 Fixschleifen genutzt; Review 3 fehlgeschlagen, Automatik beendet |
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
| R2 | B | 🟧 | Review 3: Status-Lifetime-Blocker; Nutzerstopp |
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
| R2-Blocker | ID-basierter Status-/Injector-Zustand des toten Enemy überlebt bei gleichnamigem Nachfolger | Manuelle Prüfung; keine weitere Automatik |

## 5. Nachweise und Reviews

**P0/P1:** Baseline-Matrix grün; P1 Fokus 43/43, Integration 175/175, Typecheck/Diff-Check grün; R1 nach Korrekturen bestanden.

**P2-Gate L:** Check 2738 Core/32 Architektur, Integration 176/176, Fokus 32/32, Typecheck/Writer-/Diff-Audit grün.

**P3-Gate L:** Fokus 14/14, Integration 176/176, Typecheck/Diff-Check grün; gemeinsamer Index und stale-sicheres Detach abgedeckt.

**P4-Gate L:** 2752 Core/32 Architektur, Integration 177/177, Fokus 34/34 und Build grün; Rettung trennt Schaden und Heilung.

**P5-Gate L:** 2759 Core/32 Architektur, Integration 177/177, Fokus 50/50 und Build grün; kein zweiter Tick.

**P6-Gate L:** 2770 Core/32 Architektur, Integration 179/179, Fokus 35/35 und Build grün; Timer-/Writer-Audit grün.

**R2-Fix 1:** drei Repros geschlossen; 2772 Core/32 Architektur, Integration 183/183, Fokus 26/26 und Build grün.

**R2-Fix 2:** zwei Review-Repros plus angrenzender instanzgebundener Clear geschlossen. Check 2775 Core/32 Architektur und Build grün; Integration 188/188; Orchestrator-Fokus 46/46; Typecheck/Diff-Check grün.

**R2 Review 3:** 119/119 Fokus, Integration 188/188 und Architektur 32/32 grün. Die fünf früheren Blocker bleiben geschlossen; Repro zeigt jedoch alten TargetStatus-/EnergyInjector-Zustand auf einer gleichnamigen Nachfolgerinstanz.

| Review | Ergebnis | Geprüfter Code-HEAD | Offene Blocking-Findings |
|---|---|---|---|
| R1 | Bestanden | `ee5742b4` | Keine |
| R2 Review 3 | Nicht bestanden | `8c8b8dc5` | Status-Lifetime bei Enemy-ID-Wiederverwendung |
| P13 | Nicht ausgeführt | – | – |

Nur Testgruppe, Exit-Code, Ergebnis und gültigen Code-Bezug festhalten. Fehlender Beleg verlangt erneute Prüfung; alter Review-Pass gilt nach Code-Delta nicht automatisch weiter.

## 6. Fortschreibung und Wiederanlauf

Vor Workerstart Freigabe, Voraussetzungen und Working Tree prüfen; 🟨, Start-HEAD und Worker eintragen. Währenddessen schreibt nur der Worker. Nach Rückgabe Lieferung und Gates prüfen; nur erfüllte Arbeit ✅ setzen und mit Code committen.

Beim Wiederanlauf Branch/HEAD, Working Tree und Threads mit § 1 abgleichen. Keine Phase wiederholen oder Nutzeränderung verwerfen. Nach R1/R2 Nutzerfreigabe abwarten; 01–03/05 nicht eigenmächtig umdefinieren.
