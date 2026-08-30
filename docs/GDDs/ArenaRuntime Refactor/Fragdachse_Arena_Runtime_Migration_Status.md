# Fragdachse – Arena Runtime Refactoring: Migration Status

**Zweck:** Extrem kompaktes, temporäres Arbeitsprotokoll der laufenden Migration.  
**Architektur:** `Fragdachse_Arena_Runtime_Architecture.md`  
**Plan:** `Fragdachse_Arena_Runtime_Implementation_Plan.md`

> **Dieses Dokument darf von Coding-KIs fortgeschrieben werden. Architektur und Implementierungsplan dürfen nicht automatisch geändert werden.**

## 1. Regeln für die Fortschreibung

Nach einem Implementierungsschritt nur festhalten, was für die nächste KI relevant ist:

- aktueller Phasenstatus;
- offene Transitional Debt;
- bekannte Regressionen / Risiken;
- letzter relevanter Check;
- konkret nächster Schritt;
- erkannter Änderungsbedarf an Architektur oder Plan.

Keine Chronik, keine ausführlichen Implementierungsberichte, keine Wiederholung des Plans.

Erledigte Detailnotizen löschen oder stark verdichten, sobald sie für Folgeschritte keinen Nutzen mehr haben.

Wenn Code und Dokumentvorgabe nicht mehr sinnvoll zusammenpassen:

1. Architektur/Plan **nicht** selbst ändern;
2. unter **Dokument-Review-Kandidaten** den Konflikt und einen Änderungsvorschlag eintragen;
3. bestehende verbindliche Vorgaben weiter respektieren, soweit dadurch kein inkonsistenter oder unsicherer Zustand erzeugt wird.

---

## 2. Aktueller Stand

**Aktive Phase:** `Phase 6 – Coop Objectives, Progress, Update und Presentation`
**Gesamtstatus:** `Phase 5 abgeschlossen; RK-2 in der Coop-Activity-Lifetime umgesetzt, RK-3 bleibt für Phase 7 offen`
**Letzter Integrations-Checkpoint:** `npm run check`
**Nächster Schritt:** Phase 6 anhand der verbleibenden Coop-Objective-/Update-/Presentation-Consumer analysieren.

| Phase | Status | Kurznotiz |
|---|---|---|
| 1 Contracts | ✅ abgeschlossen | Lifecycle-/World-/Activity-/Persistent-Base-Contracts gezielt abgesichert. |
| 2 WorldRuntime-Fundament | ✅ abgeschlossen | `WorldRuntime` + `ActivityRuntimeHost`, erzeugt/zerstört im `WorldLifecycle`-Sink. |
| 3 World-Materialisierung | ✅ abgeschlossen | Gebauter World-Zustand als ein Owner; `ArenaContext`-Felder sind readonly Lesefassaden. |
| – Architektur-Review | ✅ abgeschlossen | Presentation-Lifetime als eigener Begriff (Architektur 6.1, harte Regel 18). |
| 4 World Bindings / PlayerWorld | ✅ abgeschlossen (Rest siehe RK-2, RK-3) | Presentation-Split + Handoff, Gameplay-State an die `WorldRuntime`-Lifetime gebunden, `PersistentBaseWorldBinding`, world-scoped Bindings der Shared Services. |
| 5 Coop Encounter / Enemy Ownership | ✅ abgeschlossen | `CoopMissionRuntime` besitzt Enemy, Navigation/Flowfields (RK-2), Encounter/Spawn, Boss, Enemy-Behaviour und Map-Directors. |
| 6 Coop Objectives / Update / Presentation | ⬜ offen | |
| 7 Player-Lifetimes | ⬜ offen | Übernimmt zusätzlich die `PlayerWorldRuntime`-Ownership (RK-3). |
| 8 Persistent Base Lifetimes | ⬜ offen | |
| 9 Completion / ResultApplication | ⬜ offen | |
| 10 Flow / ArenaRuntime | ⬜ offen | Übernimmt den `WorldPresentationHandoff`. |
| 11 Context / Dependency Cutover | ⬜ offen | |
| 12 Legacy Removal | ⬜ offen | |

Statuswerte: `⬜ offen` · `🟨 aktiv` · `🟧 blockiert` · `✅ abgeschlossen`

---

## 3. Transitional Debt

Nur temporäre Migrationspfade eintragen.

| ID | Seit Phase | Temporärer Pfad / Debt | Source of Truth | Entfernen bis |
|---|---:|---|---|---:|
| TD-1 | 2 | Der Lifecycle-Sink setzt `ArenaContext.world` weiterhin parallel zur `WorldRuntime`; alle bestehenden Consumer lesen den World-Kontext darüber. | `WorldRuntime.context` | Phase 11 |
| TD-2 | 2 | `WorldRuntime.update()` wird über `ArenaLifecycleCoordinator.updateWorldRuntime()` aus `ArenaScene.update()` getaktet. | Zielpfad `ArenaRuntime.update()` | Phase 10 |
| TD-4 | 3 | `ArenaContext.worldMaterialization` / `.worldPresentation` plus die sechs readonly Lesefassaden (`arenaResult`, `currentLayout`, `placementSystem`, `rockRegistry`, `baseManager`, `lightOccluderIndex`) als Zugriffspfad der noch nicht migrierten Consumer. | `WorldRuntime` | Phase 11 |
| TD-5 | 4 | Der `WorldPresentationHandoff` liegt am `ArenaLifecycleCoordinator` statt am Flow-Owner. | `WorldPresentationHandoff` | Phase 10 |
| TD-6 | 5 | Migrierte Enemy-/Encounter-/Boss-/Flowfield-Felder im `ArenaContext` sind gerichtete Compatibility-Fassaden für Scene, Host- und Client-Update. Nur `syncCoopMissionCompatibilityBindings()` schreibt sie. | `CoopMissionRuntime` | Phase 11 |
| TD-7 | 5 | Die fachliche Coop-Update-Reihenfolge liest die Runtime-Child-Owner noch über `HostUpdateCoordinator`/`ClientUpdateCoordinator`; `CoopMissionRuntime.update()` ist bis zum Phase-6-Cutover nur der angebundene Lifecycle-Tick. | `CoopMissionRuntime` | Phase 6 |

`TD-3` ist mit Phase 4 entfallen: Der Gameplay-State wird nicht mehr über das Instanzende hinweg freigegeben.

---

## 4. Offene Regressionen / Risiken

| ID | Bereich | Problem / Risiko | Relevanz für nächste Phase |
|---|---|---|---|
| R-2 | World-Teardown | Der Abbau hat eine Reihenfolge mit fachlichem Grund: Darstellung geht zuerst (Handoff), dann der Abschluss des persistenten Basisbestands (braucht lebende Bau-Runtime, darf keine Darstellung mehr sehen), dann die Bau-Runtime. `WorldRuntime.destroy()` hält sie; Vertrag in `tests/WorldMaterializationOwnership.test.ts`. | Phase 5–8 dürfen diese Reihenfolge nicht umsortieren. |
| R-3 | Exit-Fade | Der Exit-Fade zeigt die letzte Arenaansicht **einschließlich ihrer Spielerfiguren**, während die World-Instanz auf dem Host bereits beendet ist. Player-Detach entfernt die Figur; ein Detach am Instanzende leert die Ansicht sichtbar. | Phase 7 muss die Player-Presentation von der Player-World-Lifetime trennen, bevor sie die Ownership verschiebt (RK-3). |

`R-1` ist mit Phase 4 entfallen: Die Reihenfolge ist keine Zeilenfolge mehr, sondern folgt aus der Ownership (siehe R-2).

---

## 5. Letzte relevante Checks

| Check | Ergebnis | Bezug |
|---|---|---|
| `npm run check` + `git diff --check` | grün | 322 Testdateien, 2702 Tests bestanden, 15 übersprungen; Build erfolgreich. Bekannte Font-Auflösungswarnungen sind nicht blockierend. Keine Browser-/Sichtprüfung durchgeführt. |

Nur den letzten aussagekräftigen Stand behalten; keine Testhistorie führen.

---

## 6. Dokument-Review-Kandidaten

Coding-KIs tragen hier Änderungsbedarf ein, ändern aber die beiden kanonischen Dokumente nicht selbst.

| ID | Ziel | Beobachtung | Vorgeschlagene Änderung | Status |
|---|---|---|---|---|
| RK-1 | Architektur 6.1 / Plan Phase 4, Checkpoint A, Phase 10 | Die World-Materialisierung teilt sich in mutablen Gameplay-State (fällt mit der Runtime) und Darstellung (überlebt Übergänge). | Presentation-Lifetime mit ausdrücklichem Transition-Handoff. | extern umgesetzt |
| RK-2 | Plan Phase 4 → Phase 5 | Phase 4 nennt „World Navigation / Flowfield-Lifetime anbinden". Im Ist-Code entstehen `FlowFieldCoordinator`, alle `EnemyFlowFieldService` und die Ally-Felder ausschließlich im `isCoopMission`-Zweig; ihre Lifetime ist damit die der Activity, nicht die der World. Phase 5 hat diese Lifetime nun unter `CoopMissionRuntime` umgesetzt; der Plantext bleibt unverändert reviewbedürftig. | Navigation/Flowfield der Activity-Ownership in Phase 5 zuordnen („activity-scoped Enemy Behaviour"). Falls später eine world-scoped Navigation ohne Activity entsteht, dort erneut prüfen. | offen |
| RK-3 | Plan Phase 4 → Phase 7 | Phase 4 nennt „Ownership des bestehenden `PlayerWorldRuntime` zum `WorldRuntime`". Der Detach-Schritt `player-entity` entfernt die Spielfigur, und `playerManager.setVisualsEnabledResolver()` bindet die Sichtbarkeit an einen beim Aufbau erfassten Wert. Ein Detach am Instanzende würde deshalb die Figuren im laufenden Exit-Fade entfernen (siehe R-3). | `PlayerWorldRuntime`-Ownership zusammen mit der Trennung von Player-World- und Player-Presentation-Lifetime in Phase 7 verschieben. | offen |

Statuswerte: `offen` · `manuell geprüft` · `abgelehnt` · `extern umgesetzt`

Ein Kandidat ist sinnvoll, wenn z. B.:
- eine geplante Klasse nach realer Codeanalyse keinen Zweck mehr hat;
- eine Ownership-Grenze fachlich falsch oder unvollständig beschrieben ist;
- eine Phase deutlich zu groß oder von einer nicht dokumentierten Voraussetzung abhängig ist;
- ein notwendiger Architekturvertrag im Zielbild fehlt;
- die Implementierung eine Annahme des Plans widerlegt.

---

## 7. Übergabe an die nächste KI

**Aktuell relevant:**
- Architektur-Dokument und Implementierungsplan: nur aktive Phase plus direkte Voraussetzungen lesen.
- Transitional Debt TD-6/TD-7, R-2/R-3 und RK-3 berücksichtigen.

**Owner-Landkarte nach Phase 4:**
- `src/world/WorldRuntime.ts` – Slots: `materialization`, `presentation`, `persistentBase`, `activity`, plus `bind()` für world-scoped Bindings scene-langlebiger Systeme.
- `src/world/WorldMaterialization.ts` – mutabler Gameplay-State: Bau-Runtime, Basen, Felsdaten, Verdeckungsindex.
- `src/world/WorldPresentationBinding.ts` – gebaute Darstellung plus ihr Geometriepuffer.
- `src/world/WorldPresentationHandoff.ts` – `release` / `adopt` / `discard`, am Coordinator (TD-5).
- `src/world/PersistentBaseWorldBinding.ts` – Site, Build Area, Reward-Runtime-IDs, Composite-Signaturen; ihr Abbau schließt den Bestand ab.
- Verträge: `tests/WorldRuntimeOwnership.test.ts`, `tests/WorldMaterializationOwnership.test.ts`.

**Owner-Landkarte nach Phase 5:**
- `src/activity/CoopMissionRuntime.ts` – konkrete Activity-Runtime für EnemyManager, Navigation/Flowfields, Encounter/Spawn, Boss, Enemy-Behaviour, Necromancy und Map-Directors; idempotenter Teardown in Abhängigkeitsreihenfolge.
- `ActivityLifecycle` bindet sie über `WorldRuntime.activity`; eine World ohne Coop-Activity materialisiert sie nicht.
- `ArenaContext`-Felder der übernommenen Systeme sind nur Compatibility-Fassaden (TD-6); ihre Updates laufen noch über die bisherigen Coordinator-Phasen (TD-7).
- Vertrag: `tests/CoopMissionRuntimeOwnership.test.ts`; der Source-Ratchet in `tests/ArenaRoundLifecycleContracts.test.ts` kennt den delegierten Owner-Teardown.

**Noch beim Coordinator (Stoff der Phasen 6–8):** Coop Objectives/Progress/Presentation und Update-Orchestrierung, `PlayerWorldRuntime`, Persistent-Base Session- und Transaction-State, `persistentBaseVisualSite`.

**Nächste konkrete Aktion:**  
`Phase 6 analysieren; dabei TD-7 durch die Activity-interne Update-Reihenfolge ablösen.`

**Nicht automatisch tun:**  
`Architektur- oder Implementierungsplan ändern.`
