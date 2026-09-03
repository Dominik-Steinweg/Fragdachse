# Fragdachse – Gameplay Runtime Refactoring: Migrationsstatus

**Architektur:** `01_Gameplay_Runtime_Architecture_Core.md` + `02_Gameplay_Runtime_Architecture_Details.md`  
**Plan:** `03_Gameplay_Runtime_Implementation_Plan.md`  
**Planungsbasis:** `main` @ `fcc6e3f5ac194fa29b08d23a1c2b3331f8dc3453`

> Temporäres Arbeitsprotokoll für Coding-KIs.
>
> Coding-KIs dürfen diese Datei nach jeder Teilphase fortschreiben.
> `01`, `02` und `03` werden nicht selbständig geändert.
> Keine Coding-KI führt Sichtprüfungen aus oder startet dafür Browser/Dev-Server.
> Manueller Gameplay-/Sicht-Gate erfolgt grundsätzlich erst nach dem vollständigen Cutover.

---

## Statuslegende

- ⬜ offen
- 🟨 aktiv
- 🟧 blockiert
- ✅ abgeschlossen

---

## Aktueller Stand

- **Aktive Teilphase:** `1 – Baseline, Contract-Matrix und Migrationskarte`
- **Gesamtstatus:** noch nicht begonnen
- **Letzter verifizierter Repository-Stand:** `fcc6e3f5ac194fa29b08d23a1c2b3331f8dc3453`
- **Letzter vollständig grüner automatisierter Gate:** Planungsstand – noch nicht ausgeführt
- **Manueller Gate:** offen; bewusst erst nach vollständigem Refactoring
- **Projectile-/Combat-Full-Refactor:** ausdrücklich außerhalb dieses Plans

---

## Phasenstatus

| Teilphase | Status | Commit | Kurzgegenstand |
|---|---:|---|---|
| 1 | ⬜ | — | Baseline, Contracts, Migrationskarte |
| 2A | ⬜ | — | Player-Gameplay Lifecycle-Grenze |
| 2B | ⬜ | — | Player-Gameplay Read Views |
| 3A | ⬜ | — | Host-Zeit im Action-/Request-Pfad |
| 3B | ⬜ | — | Resource/Readiness mit expliziter Zeit |
| 4A | ⬜ | — | Shared Immediate Weapon Execution |
| 4B | ⬜ | — | Automated-/Non-Player-Fire Cutover |
| 4C | ⬜ | — | Spezialisierte Immediate-Execution-Adapter |
| 5 | ⬜ | — | Construction-/Management-Readiness |
| 6A | ⬜ | — | Player Action Runtime + Weapon Activation |
| 6B | ⬜ | — | RPC/Held/Weapon2-Prediction Cutover |
| 7A | ⬜ | — | Utility Activation + Temporary Utilities |
| 7B | ⬜ | — | Buff-/Armageddon-Ultimate Behavior |
| 7C | ⬜ | — | Airstrike/Tunnel/Gauss Ultimate |
| 8A | ⬜ | — | AK47 Behavior |
| 8B | ⬜ | — | Negev Behavior |
| 8C | ⬜ | — | Shotgun/generische Weapon Reactions |
| 9 | ⬜ | — | Tesla Dome / Energy Shield Behavior |
| 10A | ⬜ | — | LoadoutManager final reduzieren |
| 10B | ⬜ | — | NetworkBridge aus Loadout/Ability-Core |
| 11A | ⬜ | — | PlayerCombatIntegration Reads/Modifier |
| 11B | ⬜ | — | PlayerCombatIntegration Outcomes/Reactions |
| 12A | ⬜ | — | Host Frame Player-Gameplay-Stages |
| 12B | ⬜ | — | Client Frame/HUD/Prediction Reads |
| 12C | ⬜ | — | Activity/Support/Construction Cleanup |
| 13 | ⬜ | — | Final Cleanup, Ratchets, Gesamtverifikation |

---

## Initiale Migrationsschuld

Diese Liste wird während der Umsetzung **ersetzt/gekürzt**, nicht chronologisch erweitert.

- `WorldPlayerGameplayRuntime` veröffentlicht aktuell einen kompletten `systems`-Graph.
- `LoadoutManager` vereint Loadout, Action Dispatch, Resource/Readiness, Ultimates, mehrere Weapon-Behaviors, Construction-/Management-Cooldowns und Execution.
- `LoadoutManager` ist aktuell konkreter `NetworkBridge`-Consumer.
- `RpcCoordinator` enthält neben Wire-Adapter-Aufgaben noch hostautoritative Ability-/Held-Action-Orchestrierung.
- `ResourceSystem` und mehrere Player-Gameplay-Pfade nutzen versteckte Wanduhr-Zugriffe.
- `HostUpdateCoordinator` taktet zahlreiche Player-Gameplay-Child-Systeme einzeln.
- `ClientUpdateCoordinator` liest konkrete Player-Gameplay-Children.
- `WorldCombatGameplayBinding` konsumiert den vollständigen `WorldPlayerGameplaySystems`-Typ.
- `WorldSupportGameplayRuntime` und `ConstructionWorldRuntime` konfigurieren heute Handler direkt im `LoadoutManager`.
- Activity-/Enemy-Systeme verwenden `LoadoutManager` als Shared Fire Service.
- Source-Contract-Tests schützen teilweise noch alte Quellcodepositionen statt der neuen Zielgrenzen.

---

## Test-Migrationskarte

Wird in Phase 1 vervollständigt.

| Semantik | Bestehender/zu ergänzender Test | Zielstatus |
|---|---|---|
| Held Action duplicate-safe / stale | `HostHeldActionSystem.test.ts` | prüfen |
| Weapon2 Retry/Dedupe | `Weapon2PredictionDedupe.test.ts` | prüfen |
| Temporary Utility Identity | `TemporaryUtilityLifecycle.test.ts` | prüfen |
| Radial/Held RPC | `RadialActionRpc.test.ts` | prüfen |
| Shared automated fire | `AutomatedPelletWeapon.test.ts` + Consumer-Tests | prüfen |
| World Player ownership | `WorldGameplayCompositionContracts.test.ts` | migrieren |
| Combat integration | `WorldCombatGameplayBinding.test.ts` | migrieren |
| Arena source boundaries | `Phase11DependencyCutover.test.ts`, `ArenaFlowCheckpointC.test.ts` | migrieren |
| AK47 | Phase 1 konkretisieren | offen |
| Negev | Phase 1 konkretisieren | offen |
| Shotgun reaction | Phase 1 konkretisieren | offen |
| Ultimates | Phase 1 konkretisieren | offen |
| Tesla/Shield | Phase 1 konkretisieren | offen |
| Construction/PB cooldown | Phase 1 konkretisieren | offen |

---

## Bewusste Übergänge / bekannte Regressionen

Aktuell keine Implementierungsübergänge – Refactoring noch nicht begonnen.

Regel für Updates:

- nur aktive, noch relevante Transitionen hier aufführen,
- exakten alten und neuen Writer nennen,
- wenn ausnahmsweise ein Integrationstest bewusst rot ist: Testname + Grund + alter/neuer Writer + unmittelbar folgende Teilphase, die ihn schließen muss; Build/TypeScript und die verpflichtenden Phase-Gates bleiben grün,
- abgeschlossene Transitionen löschen.

---

## Architektur-/Dokumentations-Review-Kandidaten

Aktuell:

- `docs/ai/networking.md` wird nach Phase 10B voraussichtlich die konkrete Legacy-Consumer-Liste anpassen müssen.
- `docs/ai/gameplay.md` nach finalem Player-Action-/Loadout-Cutover gegen die neue öffentliche Boundary prüfen.
- Normative `01`/`02` nur nach menschlicher Entscheidung ändern.

---

## Realisierte Contract-Namen

Diese Tabelle dokumentiert **nur die im Code tatsächlich eingeführten Namen** der im Plan vorgegebenen Contract-Familien. Sie definiert keine neue Architektur. Die einführende Teilphase trägt den finalen Namen ein; spätere Coding-KIs verwenden ihn weiter.

| Contract-Familie aus 03 | Realisierter Type/API | Eingeführt in |
|---|---|---|
| `PlayerGameplayLifecyclePort` | — | — |
| `PlayerGameplayReadViews` | — | — |
| `PlayerActionRequest` | — | — |
| `WeaponExecutionCapability` | — | — |
| `PlayerRelationshipPort` | — | — |
| `PlayerCombatIntegrationPort` | — | — |
| `PlayerGameplayFrameStages` | — | — |

---

## Nächster konkreter Schritt

**Teilphase 1 umsetzen.**

Dabei:

1. komplette Consumer-/Contract-Matrix erstellen,
2. Test-Migrationskarte vervollständigen,
3. riskante Semantik per Characterization-Test absichern,
4. noch keine neue Gameplay-Runtime-Architektur bauen.

---

## Update-Format nach jeder Teilphase

Die Coding-KI aktualisiert ausschließlich die folgenden Punkte:

- aktive Teilphase
- Phasenstatus
- letzter Repository-Stand
- letzter vollständig grüner automatisierter Gate
- Commit-Hash der abgeschlossenen Teilphase
- realisierte Contract-Namen, falls die Phase eine Contract-Familie erstmals materialisiert
- noch offene Transitionen/Regressionen
- Test-Migrationskarte, falls betroffen
- Dokumentations-Review-Kandidaten
- nächster konkreter Schritt

Keine Historie und keine ausführliche Zusammenfassung bereits abgeschlossener Arbeit pflegen.
