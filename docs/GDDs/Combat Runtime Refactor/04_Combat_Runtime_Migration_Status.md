# Fragdachse – Combat Runtime Migration Status

**Architektur:** [01](01_Combat_Runtime_Architecture_Core.md) + [02](02_Combat_Runtime_Architecture_Details.md) · **Plan:** [03](03_Combat_Runtime_Implementation_Plan.md) · **Betrieb:** [05](05_Combat_Runtime_Implementation_Cheatsheet.md)

> Operativer Status ohne Historie. **Nur der Orchestrator schreibt.** Keine Interface-Kopien, Vollinventare, Rohlogs oder SHA-Chronik. Zielgröße unter 8 KB.

## 1. Steuerung und aktueller Stand

| Feld | Aktueller Wert |
|---|---|
| Gesamtstatus | Block B aktiv; P2 bestanden |
| Freigegebener Arbeitsblock | **B – fachlicher Kern** (P2 → P3 → P4 → P5 → P6 → R2) |
| Freigabequelle | Nutzerauftrag nach bestandenem R1; Block B ausdrücklich gestartet |
| Nächster Arbeitsschritt | P3 – gemeinsame World-Geometrie und reine Queries |
| Nächster geplanter Nutzerstopp | Nach R2; P7 benötigt gesonderte Freigabe C |
| Aktive Phase / Aufgabe | Keine zwischen den Phasen |
| Arbeitsbranch / lokaler Checkout-HEAD | `codex/combat-runtime-refactor` @ `2fd046a7` |
| Start-HEAD der laufenden Aufgabe | Keiner |
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
| P3 | B | ⬜ | Geometrie / Queries |
| P4 | B | ⬜ | Damage / Support / Modifier / Defense |
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

Vorhandene Nachbargrenze: `ProjectileCombatPort`, `ProjectileDirectImpactRequest/Outcome`, `ProjectileCombatExplosionRequest/Outcome`, `ProjectileExplosionResolutionPort` und Continuation. Vorhanden bedeutet nicht bereits an neue Combat-Owner angeschlossen.

## 4. Aktive Übergänge und Blocker

P1-Contracts und P2-Combatant-Mutation sind realisiert:

| Art / Befund | Betroffene Grenze und Ursache | Schließphase / nächste Aktion |
|---|---|---|
| Geplanter Integrationsübergang | Legacy-Damage-/Projectile-Adapter nutzen die neuen Receipts noch nicht vollständig (D1/D4) | P4/P7 |
| Geplanter Integrationsübergang | Verbleibende Life-/Death-Callbacks und Respawn-Orchestrierung außerhalb des Vitals-Owners (D2) | P6 |
| Geplanter Integrationsübergang | Faktorherkunft, Support-/Status-Eligibility und explizite Herkunft statt `direct`-Default (D3/D5/D9) | P4/P5/P7/P10 |
| Geplanter Integrationsübergang | Explizite Wirkungseinheiten, Host-Zeit und Renderer-unabhängige World-Mutation (D6/D7/D8) | P5/P6/P9 |
| Geplanter Integrationsübergang | Parallele Callback-/Metadatenreaktionen auf genau einen Ausführungspfad reduzieren (D10) | P6/P7 |
| Geplanter Integrationsübergang | P1-Contracts sind bewusst noch nicht produktiv verdrahtet; konkrete Target-/Life-Generationen und fachliche Capability-Owner fehlen | P2–P11 gemäß Contract-Manifest |

## 5. Nachweise und Reviews

**P0-Baseline:** bestanden auf `8457a193`. `npm run check`, `npm run test:integration`, `npm run test:stress`, `npm run test:balance-lab`, `npm run test:assets` und `git diff --check`: jeweils Exit 0. V1–V12 besitzen vorhandene Einstiegspunkte; keine neue Charakterisierung nötig. Kein früherer Projectile-Testlauf wurde als Combat-Nachweis übernommen.

**P1-Gate L / letztes lokales Gate:** bestanden auf `496a5208` plus P1-Lieferung. Fokussierte Tests: 43/43, Integration: 175/175, `npm run typecheck` und `git diff --check`: Exit 0. R1 fand danach drei Contract-Blocker.

**P2-Gate L / letztes lokales Gate:** bestanden auf `2fd046a7` plus P2-Lieferung. `npm run check`: 2738 Core-/32 Architecturetests und Build grün; Integration 176/176; fokussiert 32/32; Typecheck, Writer-Audit und Diff-Check grün.

| Review | Ergebnis | Geprüfter Code-HEAD | Offene Blocking-Findings |
|---|---|---|---|
| R1 | Bestanden | `ee5742b4` | Keine |
| R2 | Nicht ausgeführt | – | – |
| P13 | Nicht ausgeführt | – | – |

Nach Tests nur Befehl/Testgruppe, Exit-Code, Ergebnis und gültigen Code-Bezug festhalten. Abgebrochene, nicht gestartete oder von Berechtigungen verhinderte Läufe nicht grün markieren. Kurze Logs optional unter `tmp/combat-refactor/`; sie sind keine Voraussetzung für Wiederaufnahme, wenn sie fehlen. Fehlender Beleg bedeutet nötige erneute Prüfung.

Nach relevantem Code-Delta gilt ein alter Review-Pass nicht automatisch weiter. Reine Status-Commits sind davon unterscheidbar. Code-Anker müssen erreichbar sein; keinen eigenen noch nicht existierenden Commit-SHA in diese Datei schreiben.

## 6. Fortschreibung und Wiederanlauf

Vor Workerstart Freigabe, Voraussetzungen und Working Tree prüfen; Aufgabe auf 🟨, Start-HEAD und aktiven Worker eintragen. Während der Worker schreibt, bleibt der Orchestrator schreibend inaktiv. Nach Rückgabe reale Lieferung, lokale Gates und Übergangsfristen prüfen; nur erfüllte Arbeit ✅ setzen und gemeinsam mit Code committen. Ein Zwischen-/Review-Fix-Commit sichert Arbeit, lässt das noch unerfüllte Gate aber offen. Danach Worker schließen und nächste zulässige Aufgabe wählen.

Beim Wiederanlauf zuerst Branch/HEAD, Index, Working Tree und offene Threads mit § 1 abgleichen. Keine Phase blind wiederholen, keine Nutzeränderung verwerfen. Nach R1/R2 ausdrücklich „wartet auf Nutzerfreigabe B/C“ setzen. 01–03/05 werden nicht eigenmächtig umdefiniert. Keine Clientkonfiguration oder zusätzliche Agentenarchitektur erzeugen.

Nach P13: „technisch/architektonisch abgeschlossen; M offen“. Ohne Nutzerrückmeldung bleibt M offen. Ein gemeldeter In-Scope-Defekt öffnet P13 zur beauftragten gezielten Korrektur wieder.
