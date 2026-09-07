# Fragdachse – Combat Runtime Migration Status

**Architektur:** [01](01_Combat_Runtime_Architecture_Core.md) + [02](02_Combat_Runtime_Architecture_Details.md) · **Plan:** [03](03_Combat_Runtime_Implementation_Plan.md) · **Betrieb:** [05](05_Combat_Runtime_Implementation_Cheatsheet.md)

> Operativer Status ohne Historie. **Nur der Orchestrator schreibt.** Keine Interface-Kopien, Vollinventare, Rohlogs oder SHA-Chronik. Zielgröße unter 8 KB.

## 1. Steuerung und aktueller Stand

| Feld | Aktueller Wert |
|---|---|
| Gesamtstatus | Block B aktiv; P2–P4 bestanden, P5 als Nächstes |
| Freigegebener Arbeitsblock | **B – fachlicher Kern** (P2 → P3 → P4 → P5 → P6 → R2) |
| Freigabequelle | Nutzerauftrag nach bestandenem R1; Block B ausdrücklich gestartet |
| Nächster Arbeitsschritt | P5 – Status und zielgebundene Mechanikzustände |
| Nächster geplanter Nutzerstopp | Nach R2; P7 benötigt gesonderte Freigabe C |
| Aktive Phase / Aufgabe | Keine; P4 lokal abgeschlossen |
| Arbeitsbranch / lokaler Checkout-HEAD | `codex/combat-runtime-refactor` @ `bba9fa0d` |
| Start-HEAD der laufenden Aufgabe | `bba9fa0d` |
| Aktiver Worker / Thread | Keiner |
| Betriebsmodus | Desktop-App; native Subagenten, keine eigene Agentenkonfiguration |
| Aktuell nötiger Modell-/Reviewstopp | Keiner |
| Aktueller Reparaturzähler | Kein offenes Reparaturpaket |
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
| P5 | B | ⬜ | Status / Mechanikzustände |
| P6 | B | ⬜ | Reaktionen / Death / Kill / Player-Lifecycle |
| R2 | B | ⬜ | Semantikreview; danach Nutzerstopp |
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

Vorhandene Nachbargrenze: `ProjectileCombatPort`, `ProjectileDirectImpactRequest/Outcome`, `ProjectileCombatExplosionRequest/Outcome`, `ProjectileExplosionResolutionPort` und Continuation. Vorhanden bedeutet nicht bereits an neue Combat-Owner angeschlossen.

## 4. Aktive Übergänge und Blocker

P1–P4 sind realisiert:

| Art / Befund | Betroffene Grenze und Ursache | Schließphase / nächste Aktion |
|---|---|---|
| Geplanter Integrationsübergang | Legacy-Projectile-Adapter nutzen die neuen Receipts noch nicht vollständig (D1/D4) | P7 |
| Geplanter Integrationsübergang | Verbleibende Life-/Death-Callbacks und Respawn-Orchestrierung außerhalb des Vitals-Owners (D2) | P6 |
| Geplanter Integrationsübergang | Status-Eligibility und explizite Herkunft statt Legacy-`direct`-Default (D5/D9) | P5/P7/P10 |
| Geplanter Integrationsübergang | Explizite Wirkungseinheiten, Host-Zeit und Renderer-unabhängige World-Mutation (D6/D7/D8) | P5/P6/P9 |
| Geplanter Integrationsübergang | Parallele Callback-/Metadatenreaktionen auf genau einen Ausführungspfad reduzieren (D10) | P6/P7 |
| Geplanter Integrationsübergang | Direkte `CombatSystem.getObstacleIndex()`-Consumer auf die World-Query-Grenze umstellen | P10 |
| Geplanter Integrationsübergang | P1-Contracts sind bewusst noch nicht produktiv verdrahtet; konkrete Target-/Life-Generationen und fachliche Capability-Owner fehlen | P2–P11 gemäß Contract-Manifest |

## 5. Nachweise und Reviews

**P0-Baseline:** bestanden auf `8457a193`. Check, Integration, Stress, Balance-Lab, Assets und Diff-Check: Exit 0; V1–V12 besitzen Einstiegspunkte.

**P1-Gate L:** 43/43 fokussiert, Integration 175/175, Typecheck und Diff-Check grün; R1 nach Korrekturen bestanden.

**P2-Gate L / letztes lokales Gate:** bestanden auf `2fd046a7` plus P2-Lieferung. `npm run check`: 2738 Core-/32 Architecturetests und Build grün; Integration 176/176; fokussiert 32/32; Typecheck, Writer-Audit und Diff-Check grün.

**P3-Gate L / letztes lokales Gate:** bestanden auf `fbcb208c` plus P3-Lieferung. Fokussiert 14/14 und Integration 176/176; `npm run typecheck` und `git diff --check`: Exit 0. Gemeinsamer Index, stale-sicheres Detach und renderer-unabhängige Zielmaße sind abgedeckt.

**P4-Gate L / letztes lokales Gate:** bestanden auf `bba9fa0d` plus P4-Lieferung. `npm run check`: 2752 Core-/32 Architecturetests und Build grün; Integration 177/177; Orchestrator-Fokus 34/34; Typecheck und Diff-Check grün. D3 ohne Tuningänderung; Enemy-Rettung meldet tatsächlichen Schaden getrennt von Rettungsheilung.

| Review | Ergebnis | Geprüfter Code-HEAD | Offene Blocking-Findings |
|---|---|---|---|
| R1 | Bestanden | `ee5742b4` | Keine |
| R2 | Nicht ausgeführt | – | – |
| P13 | Nicht ausgeführt | – | – |

Nur Testgruppe, Exit-Code, Ergebnis und gültigen Code-Bezug festhalten. Fehlender Beleg verlangt erneute Prüfung; alter Review-Pass gilt nach Code-Delta nicht automatisch weiter.

## 6. Fortschreibung und Wiederanlauf

Vor Workerstart Freigabe, Voraussetzungen und Working Tree prüfen; 🟨, Start-HEAD und Worker eintragen. Währenddessen schreibt nur der Worker. Nach Rückgabe Lieferung und Gates prüfen; nur erfüllte Arbeit ✅ setzen und mit Code committen.

Beim Wiederanlauf zuerst Branch/HEAD, Index, Working Tree und offene Threads mit § 1 abgleichen. Keine Phase blind wiederholen, keine Nutzeränderung verwerfen. Nach R1/R2 ausdrücklich „wartet auf Nutzerfreigabe B/C“ setzen. 01–03/05 werden nicht eigenmächtig umdefiniert. Keine Clientkonfiguration oder zusätzliche Agentenarchitektur erzeugen.

Nach P13: „technisch/architektonisch abgeschlossen; M offen“. Ohne Nutzerrückmeldung bleibt M offen. Ein gemeldeter In-Scope-Defekt öffnet P13 zur beauftragten gezielten Korrektur wieder.
