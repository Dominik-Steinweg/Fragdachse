# Fragdachse – Arena Runtime Refactoring: Migration Status

**Zweck:** Extrem kompaktes, temporäres Arbeitsprotokoll der laufenden Migration.  
**Architektur:** `Fragdachse_Arena_Runtime_Architecture.md`  
**Plan:** `Fragdachse_Arena_Runtime_Implementation_Plan.md`

> **Dieses Dokument darf von Coding-KIs fortgeschrieben werden. Architektur und Implementierungsplan dürfen nicht automatisch geändert werden.**

Browser-/Sichtprüfungen dieses Refactorings führt der User manuell nach Abschluss der
automatisierten Gates durch. Coding-KIs starten dafür keinen Dev-Server oder Browser und geben
stattdessen eine konkrete Prüfliste aus.

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

**Aktive Phase:** `12B.1 – Runtime-/Legacy-Cleanup abgeschlossen`
**Gesamtstatus:** `Phasen 1–11, 12A und 12B.1 abgeschlossen; Checkpoint C wurde vom User manuell erfolgreich abgenommen.`
**Letzter Integrations-Checkpoint:** `Phase 12B.1: npm run check grün (334 Testdateien, 2.824 Tests bestanden, 15 übersprungen, Build ok).`
**Nächster Schritt:** `Phase 12B.2 – Contract-/Source-Test-Cleanup und finaler Acceptance Gate.`

| Phase | Status | Kurznotiz |
|---|---|---|
| 1 Contracts | ✅ abgeschlossen | Lifecycle-/World-/Activity-/Persistent-Base-Contracts gezielt abgesichert. |
| 2 WorldRuntime-Fundament | ✅ abgeschlossen | `WorldRuntime` + `ActivityRuntimeHost`, erzeugt/zerstört im `WorldLifecycle`-Sink. |
| 3 World-Materialisierung | ✅ abgeschlossen | Gebauter World-Zustand als ein Owner; `ArenaContext`-Felder sind readonly Lesefassaden. |
| – Architektur-Review | ✅ abgeschlossen | Presentation-Lifetime als eigener Begriff (Architektur 6.1, harte Regel 18). |
| 4 World Bindings / Materialisierung | ✅ abgeschlossen | Handoff trägt nur `ArenaPresentationResult`; Physics/Gameplay fallen mit `WorldMaterialization`. Exit-Fade nutzt reine Entity-Presentation. |
| 5 Coop Encounter / Enemy Ownership | ✅ abgeschlossen | `CoopMissionRuntime` besitzt Enemy, Coop-Navigation/Flowfields, Encounter/Spawn, Boss, Enemy-Behaviour und Map-Directors; A→B materialisiert alle Child-Owner frisch. |
| – Stabilisierung / Checkpoint A | ✅ automatisiert abgeschlossen | Host-/Client-Lifecycle, same-world Activity-Wechsel, scoped Detach, reiner Handoff und Exit-Presentation vertraglich geprüft. Browser-Sichtprüfung ist User-Abnahme. |
| 6 Coop Objectives / Update / Presentation | ✅ abgeschlossen | `CoopMissionRuntime` besitzt zusätzlich Objectives, Mission Progress, Barrieren, Carry, Repair/Placement-Reward und die Abschlussermittlung. Host- und Client-Frame kennen nur benannte Activity-Schritte; sieben Felder sind aus `ArenaContext` verschwunden. |
| 7 Player-Lifetimes | ✅ abgeschlossen | `PlayerWorldRuntime` gehört der `WorldRuntime` und kennt nur world-scoped Module; Detach folgt einem Materialisierungs-Ledger. `CoopMissionPlayerRuntime` trägt Lebensbudget, Zielfreigabe und das activity-scoped Ally-Flowfield seiner Mission. |
| – Checkpoint B | ✅ automatisiert abgeschlossen | Coop create/update/destroy, Activity-Wechsel in derselben World, `PlayerWorldRuntime` bleibt / `PlayerActivityRuntime` wird ersetzt, Activity-Presentation folgt der Activity-Lifetime. Browser-Sichtprüfung ist User-Abnahme. |
| 8 Persistent Base Lifetimes | ✅ abgeschlossen | `PersistentBaseRoomSession` (committed Raumstand, Player↔Owner-Bindungen, angenommene Contribution-Revisionsstände) · `PersistentBaseTransaction` (Arbeitsstand, Identität, genau ein terminaler Abschluss) · `PersistentBaseRuntimeBindings` am `PersistentBaseWorldBinding` (Runtime-Objekte). Die Transaction folgt jetzt der Activity-Identity; Runtime-Detach/Reattach und World-Rebuild öffnen oder beenden sie nicht. |
| 9 Completion / ResultApplication | ✅ abgeschlossen | `ActivityCompletion` bindet Coop-Result/Abort an World-/Activity-Revision. `ResultApplication` verwirft stale/doppelte Abschlüsse und besitzt Victory-Reward, Persistent-Base-Outcome sowie die Publikation an Progression/Statistik. |
| 10A World Composition | ✅ abgeschlossen | World-Kontext/-Materialisierung, Presentation/PB-Child, Player-Rezept und Geometrie-/Shared-Service-Bindings an konkrete Composition-Grenzen delegiert; `WorldRuntime` besitzt den symmetrischen Teardown. |
| 10B Activity/PB/Gameplay Composition | ✅ abgeschlossen | 10B.1–10B.7 abgeschlossen: Base-Activity-Lifetime, Coop-/PB-Composition, World-Gameplay-Bindings und Activity-Rebinding/Lifetime-Closure sind umgesetzt; TD-10 bleibt bewusst offen. |
| 10C Flow / ArenaRuntime | ✅ abgeschlossen | `ArenaRuntime` ist der Top-Level-Owner (Flow, raumlanglebiger Persistent-Base-Owner, Frame-Orchestrierung); der reduzierte `ArenaLifecycleCoordinator` ist der Flow und behält den `WorldPresentationHandoff`. World-Gameplay-Composition und Persistent-Base-Management liegen bei eigenen Grenzen bzw. Ownern. |
| – Checkpoint C | ✅ automatisiert abgeschlossen | World-/Activity-Transitions, Completion/`ResultApplication`, stale Completion, PB Commit/Rollback, Matchstart, Host-/Client-Matchende, Exit-Fade und Presentation-Handoff, Lobby-Rückkehr, Lobby-Fast-Reinstance, Frame-Position der Coop-Simulation und owner-getriebener Teardown sind vertraglich geprüft. Browser-Sichtprüfung ist User-Abnahme. |
| 11A ArenaContext Runtime Facade Cutover | ✅ abgeschlossen | Migrierter World-/Activity-State und Compatibility-Fassaden aus `ArenaContext` entfernt; Consumer lesen konkrete Owner oder kleine fachliche Ports. TD-1, TD-4 und TD-6 geschlossen. |
| 11B Coordinator / RPC / Network Dependency Cutover | ✅ abgeschlossen | `RpcCoordinator` von Context/Flow/PB-Klasse und Runtime-Gettern entkoppelt; Held Actions beim World-Player-Owner; Frame-Reads auf kleine Ports reduziert; TD-9 geschlossen. |
| 12A Transitional Debt / Compatibility Cleanup | ✅ abgeschlossen | Held-Action-State an Activity-Identity und Player-Leave gebunden; Activity-/PB-Runtime-Mirrors, obsolete Destroy-/Fallback-Adapter und zwei Domain→Network-Typabhängigkeiten entfernt. |
| 12B.1 Runtime-/Legacy-Cleanup | ✅ abgeschlossen | Obsolete Decoy-Kompatibilitätsmethode, dead projection fields, unbenutzte Imports/Types in Flow, Composition und Coordinatoren entfernt; Teardown und Frame-Ownership sauber verifiziert. |
| 12B.2 Contract-/Source-Test-Cleanup | ⬜ offen | Source-Structure-Tests, Contract-Tests und finaler Acceptance Gate; TD-10 bleibt eigener Folgeentscheid. |

Statuswerte: `⬜ offen` · `🟨 aktiv` · `🟧 blockiert` · `✅ abgeschlossen`

---

## 3. Transitional Debt

Nur temporäre Migrationspfade eintragen.

| ID | Seit Phase | Temporärer Pfad / Debt | Source of Truth | Entfernen bis |
|---|---:|---|---|---:|
| TD-10 | 10B.3 | Freie/mapweite Activity-PowerUps werden über die bestehende World-Layout-Generierung aus dem transitional `CoopDefenseMapConfig` in `ArenaLayout.powerUpPedestals` gebacken. Das Activity-Binding korrigiert nur die linked Base-Podeste; ein Wechsel A→B in derselben World kann freie PowerUps ohne größeren Generator-/Placement-Umbau nicht sauber austauschen. | Eigene Activity-PowerUp-/Placement-Composition mit World-Geometrie als Input; kein World-Rebuild als Workaround. | eigener Folgeentscheid vor dem Authoring-Cutover |

`TD-3` ist mit Phase 4 entfallen: Der Gameplay-State wird nicht mehr über das Instanzende hinweg freigegeben.

`TD-7` ist mit Phase 6 entfallen: Die fachliche Coop-Update-Reihenfolge liegt in
`src/activity/CoopMissionHostUpdate.ts`.

`TD-2`, `TD-5` und `TD-8` sind mit Phase 10C entfallen:

- **TD-2** – Der World-Tick läuft über `ArenaRuntime.update()`; die Scene ruft nur den Frame-Owner.
- **TD-5** – Der `WorldPresentationHandoff` liegt beim tatsächlichen Flow-Owner; weder
  `ArenaRuntime` noch eine Composition-Grenze kennt ihn.
- **TD-8** – Die Frame-Position der benannten Activity-Schritte gehört dem Frame-Owner: Er
  stellt den Schritt beiden Frame-Phasen über ihren Activity-Port bereit und ruft Completion sowie Debug-Schritt
  selbst; die Scene resolved keinen Activity-Schritt mehr. Die Ausführung von
  `hostSimulationStep`/`hostPrePhysicsStep` bleibt bewusst an ihrer fachlichen Stelle im Host-Frame
  (R-4) – verschoben ist der Besitz, nicht die Reihenfolge.

`TD-1`, `TD-4` und `TD-6` sind mit Phase 11A entfallen: `ArenaContext` enthält keinen
migrierten World-/Activity-Runtime-State mehr. World-/Activity-Consumer lesen `WorldRuntime`,
die fokussierten World-Owner oder `CoopMissionRuntime` direkt; der Compatibility-Sync ist entfernt.

`TD-9` ist mit Phase 11B entfallen: Die vier Construction-RPC-Adapter sind aus dem Flow entfernt;
`RpcCoordinator` konsumiert Participation, Capabilities, Construction, Persistent Base,
Player/Loadout, Held Actions und Train über fachliche Ports und kennt weder `ArenaContext` noch den
gesamten Flow oder den konkreten Persistent-Base-Owner. Host-/Client-Frame-Reads sind in kleine
World-, Player-, Combat- und Activity-Ports gegliedert.

Phase 12A hat die geschlossenen TDs auch physisch nachgeprüft: Für TD-1/TD-4/TD-6 existieren keine
Context-Projektionen oder Runtime-Mirrors mehr; für TD-9 existieren keine Construction-RPC-
Forwarder oder Runtime-Getter im `RpcCoordinator`. Die letzten doppelten Activity-Referenzen im
Flow lesen jetzt direkt aus `ActivityRuntimeHost`, das PB-World-Binding direkt aus `WorldRuntime`.
`PersistentBaseRoundOutcome` und `CoopDefenseRoundStateSystem` importieren fachliche Abschluss-
typen aus `types.ts` statt aus `NetworkBridge`. TD-2/TD-5/TD-8 bleiben als echte finale Owner-
Verträge bestehen und hatten keine nachweislich obsoleten physischen Compatibility-Reste.

Die in der Phase-8-Prüfung erkannte implizite Kopplung des Transaction-Starts an `buildWorld()`
ist behoben; daraus entsteht keine neue Transitional Debt.

Problem 2 aus dem Phase-8-Review ist behoben: PB-Mutationsrequests tragen die kanonische
Activity-/World-Identity (`worldRevision` + `activityRevision`), und der Host prüft sie vor
Placement, Move/Repositioning und Dismantle einschließlich generischer Construction-RPCs gegen
die offene `PersistentBaseTransaction`. Ohne Activity/Transaction bleibt der Activity-Identifier
weg; Lobby-Operationen dürfen den committed Stand direkt ändern. Tests decken A→B, A→keine
Activity, aktuelle B-Operation, Lobby und manipulierte Wire-Werte ab. Der generische Loadout-RPC
führt das Feld fachlich unverändert über den `ConstructionRpcPort` weiter.

---

## 4. Offene Regressionen / Risiken

| ID | Bereich | Problem / Risiko | Relevanz für nächste Phase |
|---|---|---|---|
| R-2 | World-Teardown | Der Abbau hat eine Reihenfolge mit fachlichem Grund: Darstellung geht zuerst (Handoff), dann der Abschluss des persistenten Basisbestands (braucht lebende Bau-Runtime, darf keine Darstellung mehr sehen), dann die Bau-Runtime. `WorldRuntime.destroy()` hält sie; Vertrag in `tests/WorldMaterializationOwnership.test.ts`. | Nach 10C zusätzlich in `tests/ArenaFlowCheckpointC.test.ts` verankert; Phase 11 darf die Reihenfolge nicht umsortieren. |
| R-4 | Host-Frame | Der Weltanteil `decoySystem.hostUpdateLifecycle()` steht seit Phase 6 **vor** dem Missionsschritt statt zwischen zwei Coop-Phasen; nur so ist die Activity-Reihenfolge zusammenhängend. Fachlich gleichwertig, weil ausschließlich die Navigation und die Kampfphase Köder und Tarnung lesen. Vertrag in `tests/HostUpdatePhaseContracts.test.ts`. | Mit 10C besitzt `ArenaRuntime` die Aufrufstelle; die Ausführungsreihenfolge im Host-Frame bleibt unverändert. |
| R-5 | Exit-Fade | Player- und Enemy-Runtime fallen mit der World-Instanz. Das eingefrorene Entity-Bild muss deshalb **vor** `worldLifecycle.endInstance()` stehen; auf dem Host geschieht das im Completion-/Exit-Pfad, auf dem Client in `beginArenaExitPresentation`. Wer eine neue Stelle einführt, an der eine World-Instanz endet, muss diese Reihenfolge mitführen. | Nach 10C zusätzlich in `tests/ArenaFlowCheckpointC.test.ts` verankert. |

Phase 12B.1 hat keine neue fachliche Regression oder Transitional Debt erzeugt. Unbenutzte Imports,
Projektions-Cache-Felder und die obsolete DecoySystem.hostUpdate-Kompatibilitätsmethode wurden bereinigt.
TD-10 bleibt unverändert; R-2, R-4 und R-5 gelten unverändert.

`R-1` ist mit Phase 4 entfallen: Die Reihenfolge ist keine Zeilenfolge mehr, sondern folgt aus der Ownership (siehe R-2).

`R-3` ist mit Phase 7 endgültig entfallen: Die Player-Runtime fällt jetzt mit ihrer `WorldRuntime`.
Das eingefrorene Entity-Bild entsteht deshalb **vor** dem Ende der World-Instanz – auf dem Client
beim Fade-Start, auf dem Host schon beim Rundenabschluss (`hostCompleteRound`). Vertrag in
`tests/ArenaExitEntityPresentation.test.ts`.

---

## 5. Letzte relevante Checks

| Check | Ergebnis | Bezug |
|---|---|---|
| `npm run check` | grün | Phase 12B.1: 334 Testdateien, 2.824 Tests bestanden, 15 übersprungen; Build mit 638 transformierten Modulen erfolgreich. |
| `git diff --check` | grün | Phase-12B.1-Stand ohne Whitespace-Fehler. |
| Browser-/Sichtprüfung | offen | Checkpoint C ist die manuell erfolgreiche Baseline. |

Nur den letzten aussagekräftigen Stand behalten; keine Testhistorie führen.

---

## 6. Dokument-Review-Kandidaten

Coding-KIs tragen hier Änderungsbedarf ein, ändern aber die beiden kanonischen Dokumente nicht selbst.

| ID | Ziel | Beobachtung | Vorgeschlagene Änderung | Status |
|---|---|---|---|---|
| RK-1 | Architektur 6.1 / Plan Phase 4, Checkpoint A, Phase 10 | Die World-Materialisierung teilt sich in mutablen Gameplay-State (fällt mit der Runtime) und Darstellung (überlebt Übergänge). | Presentation-Lifetime mit ausdrücklichem Transition-Handoff. | extern umgesetzt |
| RK-2 | Plan Phase 4 → Phase 5 | Die heutige `FlowFieldCoordinator`-/Enemy-/Ally-/Boss-Navigation entsteht ausschließlich für Coop-Missionen und überlebt keinen Activity-Wechsel. Eine künftig echte activity-unabhängige World-Navigation bliebe dagegen world-scoped. | Aktuelle Coop-Navigation Phase 5 zuordnen; Phase 4 nur für nachweislich world-scoped Navigation formulieren. | extern umgesetzt |
| RK-3 | Plan Phase 4 → Phase 7 | `PlayerWorldRuntime`-Detach entfernt die Player-Entity. Der Exit-Fade braucht dafür keinen längeren Gameplay-Owner, sondern eine getrennte Entity-Presentation. Die Ownership-Verschiebung bleibt dennoch Teil der Player-Lifetime-Trennung. | `PlayerWorldRuntime`-Ownership in Phase 7 verschieben; Exit-Darstellung schon vorher als reine Transition-Presentation absichern. | extern umgesetzt |
| RK-4 | Plan Phase 6 / Phase 10C, Architektur 10 | Die Coop-Simulation hat eine fachlich notwendige Frame-Position nach Netzwerksync und innerhalb der Countdown-/Gameplay-Gates. `CoopMissionRuntime.update()` ist deshalb bewusst kein vollständiger Simulationsschritt; der Frame-Owner ruft benannte Activity-Schritte. | Architektur beschreibt jetzt frame-positionierte Activity-Steps; 10C verschiebt nur die Aufrufstelle auf den Arena-Runtime-/Frame-Owner, nicht die interne Missionsreihenfolge. | Dokument-Rebaseline umgesetzt; Code in 10C |
| RK-5 | Architektur 3.4 / Plan Phase 10 | Nach Phase 9 besitzt der richtige Runtime-Owner häufig bereits den State, während der `ArenaLifecycleCoordinator` weiterhin den konkreten Runtime-Graph baut und verdrahtet. Dadurch ist der Coordinator mit 7.856 LOC größer als vor dem Refactor. | Lifetime-Ownership und Composition explizit trennen; Phase 10 in 10A World-Composition, 10B Activity/PB/Gameplay-Composition und 10C Flow/ArenaRuntime teilen. | Dokument-Rebaseline umgesetzt |
| RK-6 | Architektur 3.4 / Plan Phase 10B | Freie/mapweite Activity-PowerUps werden aktuell zusammen mit der World-Geometrie in `ArenaLayout` erzeugt, obwohl ihr Inhalt an der Activity hängt. Der linked-Base-Pfad ist separat activity-scoped, der freie Pfad noch nicht. | Activity-spezifische PowerUp-/Placement-Materialisierung auf World-Geometrie aufsetzen und erst danach den Authoring-/Generator-Cutover entscheiden; keinen World-Rebuild als Ersatzlösung verwenden. | offen |

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
- Architektur-Dokument und Implementierungsplan wurden nach Phase 9 manuell rebaselined; Phase 10,
  11A, 11B und 12A sind abgeschlossen. Checkpoint C wurde vom User manuell erfolgreich abgenommen.
- Offene Transitional Debt: nur TD-10; R-2/R-4/R-5 weiter berücksichtigen. TD-1, TD-4, TD-6 und
  TD-9 sind geschlossen.
- Der Top-Level-Owner ist `ArenaRuntime`; der `ArenaLifecycleCoordinator` ist der Arena-Flow und
  materialisiert keinen Gameplay-Graphen mehr.
- `ArenaContext` enthält ausschließlich scene-langlebige Infrastruktur. `hostHeldActionSystem`
  gehört jetzt der `WorldPlayerGameplayRuntime`; es gibt keinen Runtime-Übergang mehr im Context.

**Endgültige Top-Level-Owner nach Phase 10C:**
- `src/scenes/arena/ArenaRuntime.ts` (159 LOC) – scene-langlebiger Top-Level-Owner: er besitzt den
  Flow und den raumlanglebigen Persistent-Base-Owner und taktet beide selbst – die World-Runtime
  über `update()`, die raumlanglebigen Owner über `syncRoomOwners()`. Er treibt die beiden
  Frame-Phasen (`runHostFrame` / `runClientFrame`) und kennt von einer Activity nur ihre benannten
  Schritte (Abschlussermittlung im Host-Frame, `applyDebugBaseDamage`, kleine World-/Player-/
  Combat-/Activity-Ports für beide Frame-Phasen). Die *Anwendung* eines Abschlusses bleibt beim Aufrufer, weil sie die
  World-Instanz beendet und die letzte Momentaufnahme der Runde davor entstehen muss. Kein
  Dependency-Container, kein Gameplay-State.
- `src/scenes/arena/ArenaLifecycleCoordinator.ts` (3.104 LOC) – der Arena-Flow: World-/Activity-
  Identität und Übergänge, Readiness/Loading, Participation, Completion und Aufruf der
  `ResultApplication`, Lobby-/Next-World-Transitions, `WorldPresentationHandoff`, Exit-Presentation
  und die Orchestrierung von `buildWorld()`/`tearDownArena()`.
- `src/scenes/arena/ArenaPersistentBaseSession.ts` (1.143 LOC) – raumlanglebiger Persistent-Base-
  Owner: `PersistentBaseRoomSession`, Transaction-Gate an der Activity-Identity, Rundenabschluss
  (`applyRoundOutcome` / `applyRoundConclusion`), Reward-Vergabe und -Projection, Contribution-
  Abgleich sowie alle host-seitigen Management-Anfragen (Platzieren, Verschieben, Vorschauen,
  Gast-Austritt). Der Flow beantwortet ihm nur World-Fragen (`persistentBaseWorldPorts`).
- World-Gameplay-Composition (zusammen 880 LOC, keine Lifetime): `ArenaWorldGameplayComposition.ts`
  orchestriert die fokussierten Grenzen `ArenaWorldEnvironmentComposition` (Geometrie, Targeting,
  Train, Support), `ArenaWorldPlayerComposition`, `ArenaWorldCombatComposition` und
  `ArenaWorldConstructionComposition` (PowerUp, Construction, PB-Materializer). Lifetime-Owner
  bleibt in jedem Fall die `WorldRuntime`.
- `src/scenes/arena/rendererWorldTeardown.ts` – der Renderer-Bundle-Besitzer räumt seine
  world-scoped Effekt- und Darstellungsbestände selbst ab; `src/scenes/arena/arenaWorldQueries.ts`
  hält die gemeinsamen Weltabfragen (Bodenfreiheit, Hindernisschaden, Zielflächen).

**Phase-10C-Ergebnis:**
- LOC: `ArenaLifecycleCoordinator` 4.840 → 3.197; zusammen mit `ArenaRuntime` (131) liegt der Flow
  bei **3.328 LOC** und damit im Zielbereich von ≤ 3.000–3.500. Aus dem Flow verschwanden die
  World-Gameplay-Composition (~500), die Persistent-Base-Management-Regeln (~1.000) und der
  manuelle Renderer-/Kontext-Teardown.
- Kein neuer God-Composer: die größte Composition-Datei hat 206 LOC; die größte neue Klasse ist der
  Persistent-Base-Owner (Domain, keine Composition).
- Frame-Grenze nachgezogen: Die Scene taktet keinen Top-Level-Owner der `ArenaRuntime` mehr selbst.
  Sie bestimmt weiterhin die fachlich notwendige Frame-Position und bleibt Owner von Phaser, Input,
  Presentation, HUD und Diagnostics; Vorschau-, Radial- und RPC-Pfade dürfen den
  Persistent-Base-Owner weiterhin fragen. R-4 bleibt unverändert: Die Host-Phase läuft an
  derselben Stelle, die Abschlussermittlung unmittelbar danach.
- `tearDownArena()` ist owner-getrieben: Player, Activity und `WorldRuntime` fallen als Owner, die
  Renderer räumen ihren eigenen Bestand ab. Seit 11A existieren die früheren
  Compatibility-Projektionen im `ArenaContext` nicht mehr; der Contract in
  `tests/ArenaRoundLifecycleContracts.test.ts` verhindert ihre Wiedereinführung.
- R-2/R-4/R-5 unverändert: Presentation-Handoff vor PB-Finalisierung vor World-Gameplay-Teardown;
  Coop-Simulation an ihrer Position im Host-Frame; Exit-Entity-Bild vor `endInstance()`.
- Checkpoint-C-Verträge: `tests/ArenaFlowCheckpointC.test.ts` (Frame-Owner, Handoff-Besitz,
  Transitions, R-2/R-5-Reihenfolge, Matchstart/Fast-Reinstance/Lobby-Rückkehr, owner-getriebener
  Teardown) plus die bestehenden Verträge für Completion/stale Completion
  (`tests/ActivityResultApplication.test.ts`), PB Commit/Rollback
  (`tests/PersistentBaseLifetimeSeparation.test.ts`, `tests/PersistentBaseManagementAllClasses.test.ts`),
  Exit-Fade (`tests/ArenaExitEntityPresentation.test.ts`) und Host-Frame-Phasen
  (`tests/HostUpdatePhaseContracts.test.ts`).

**Phase-11B-Ergebnis:**
- Carry-Regression aus 11A behoben: Host-Marker lesen live aus `CoopDefenseCarrySystem`, Client-
  Marker aus dem replizierten Snapshot; kein Context-Feld und keine zweite mutable Wahrheit.
- `RpcCoordinator` (645 LOC) kennt weder `ArenaContext`, `ArenaLifecycleCoordinator`, den konkreten
  Persistent-Base-Owner noch konkrete Runtime-Getter. `ArenaRpcPorts.ts` (72 LOC) definiert die
  fachlichen RPC-Grenzen; die Scene adaptiert sie an die bestehenden Owner.
- `hostHeldActionSystem` liegt als `heldAction` beim bestehenden `WorldPlayerGameplayRuntime`, wird
  bei Activity-Identity-Ende/-Wechsel invalidiert, beim Player-Leave selektiv bereinigt und mit der
  World-Lifetime zerstört. Die vier Construction-RPC-Adapter sind aus dem Flow
  entfernt; `ArenaLifecycleCoordinator` liegt bei 3.104 LOC, zusammen mit `ArenaRuntime` (159 LOC)
  bei 3.263 LOC.
- Host-Frame: vier kleine World-/Player-/Combat-/Activity-Ports statt zehn Runtime-Resolvern;
  Client-Frame: drei World-/Player-/Activity-Ports statt sechs Runtime-Resolvern. Keine globale
  Dependency Bag, kein neues Ownership-Modell und keine Wire-/Authority-Änderung.
- Verträge: `tests/CoopDefenseCarryPresentation.test.ts`, `tests/RadialActionRpc.test.ts`,
  `tests/Phase11DependencyCutover.test.ts` sowie Checkpoint-C-, Activity-Rebinding-,
  World-ohne-Activity-, Participation-, PB- und Teardown-Verträge.

**Phase-12A-Ergebnis:**
- Held-Action-Verträge decken normalen Charge-/Consume-Pfad, stale Action, Temporary Utility,
  Construction/global dismantle, A→B, A→keine Activity, technischen Runtime-Rebind und
  Player-Leave ab.
- `ArenaLifecycleCoordinator` hält keine mutable Coop-/Capture-the-Beer-Runtime und kein nullable
  PB-World-Binding-Mirror mehr. Der `ActivityRuntimeHost` beziehungsweise `WorldRuntime` ist die
  einzige Source of Truth; der obsolete CTB-`onDestroy`-Adapter und der unerreichbare Activity-
  Fallback-Teardown sind entfernt.
- Stale Transitional-Kommentare und die direkten Domain-Typimporte aus `NetworkBridge` sind
  entfernt. `ArenaContext` bleibt ein kleiner readonly Scene-Infrastructure-Context; die
  fachlichen RPC-/Frame-Ports bleiben unverändert.
- Noch offen für 12B: globale Teardown-Reste, obsolete Update-Branches, Feature Flags,
  Source-Structure-Test-Cleanup und weitere nur nach finalem Consumer-Review beweisbare Legacy-/
  Dead-Code-Kandidaten. TD-10 bleibt ausdrücklich offen und wird nicht in 12B implizit gelöst.

**Manuelle Prüfliste für die 11B-Abnahme (User, im Browser):**
- Matchstart aus der LobbyWorld inklusive Ladeschirm und Countdown;
- Carry-Nebenmission auf Host und Client: liegende Items, Delivery-Zone und Edge-Arrows sichtbar;
- aufladbare Utility starten/abbrechen/auslösen sowie Construction platzieren/einzeln und global
  zurückbauen; World-Leave/-Rejoin auf Host und Client;
- Match-Exit auf Host und Client: Exit-Fade zeigt das eingefrorene Bild, danach Lobby;
- Lobby-Rückkehr mit Rundenergebnis und Raumstatistik;
- Lobby-Fast-Reinstance (Modus-/Basis-Wechsel in der Lobby) ohne sichtbaren Neuaufbau;
- zweiter Matchstart direkt danach;
- Persistent-Base-Pfad: Bauen/Verschieben/Rückbau in der Lobby, ein Reward platzieren, Sieg und
  Niederlage je einmal gegen den Bestand prüfen.

**Owner-Landkarte nach Phase 4:**
- `src/world/WorldRuntime.ts` – Slots: `materialization`, `presentation`, `persistentBase`, `activity`, plus `bind()` für world-scoped Bindings scene-langlebiger Systeme.
- `src/world/WorldMaterialization.ts` – mutabler Gameplay-State: Arena-Physics/-Indizes, Bau-Runtime, Basen, Felsdaten, Verdeckungsindex.
- `src/world/WorldPresentationBinding.ts` – ausschließlich `ArenaPresentationResult` plus Geometriepuffer; keine Physics-/Gameplay-Container.
- `src/world/WorldPresentationHandoff.ts` – `release` / `adopt` / `discard`, am Flow-Owner.
- `src/world/ArenaExitEntityPresentation.ts` – eingefrorene Player-/Enemy-Darstellung ohne Manager oder Physics für den Exit-Fade.
- `src/world/PersistentBaseWorldBinding.ts` – Site, Build Area, Reward-Runtime-IDs, Composite-Signaturen; ihr Abbau schließt den Bestand ab.
- Verträge: `tests/WorldRuntimeOwnership.test.ts`, `tests/WorldMaterializationOwnership.test.ts`.

**Owner-Landkarte nach Phase 5:**
- `src/activity/CoopMissionRuntime.ts` – konkrete Activity-Runtime für EnemyManager, Navigation/Flowfields, Encounter/Spawn, Boss, Enemy-Behaviour, Necromancy und Map-Directors; idempotenter Teardown in Abhängigkeitsreihenfolge.
- `ActivityLifecycle` bindet sie über `WorldRuntime.activity`; same-world A→B zerstört A und materialisiert B über die fokussierten Activity-Compositions vollständig frisch.
- Activity-scoped Bindings lösen Combat, Physics, Train, Energy Shield sowie die langlebigen Enemy-Consumer vor dem Child-Teardown; Map-Event-Handler und Train-Runtime werden für B frisch erzeugt.
- Consumer lesen den übernommenen Runtime-Graphen direkt aus `CoopMissionRuntime`; die früheren
  `ArenaContext`-Compatibility-Fassaden und ihr Sync sind entfernt.
- Vertrag: `tests/CoopMissionRuntimeOwnership.test.ts`; der Source-Ratchet in `tests/ArenaRoundLifecycleContracts.test.ts` kennt den delegierten Owner-Teardown.

**Owner-Landkarte nach Phase 6:**
- `CoopMissionRuntime` besitzt zusätzlich einen `objectives`-Slot: Secondary Objectives, Mission
  Progress, Fortschrittsbarrieren, Carry, Objective-Repair, Placement-Reward und die
  host-autoritative Abschlussermittlung. Teardown: Ziele zuerst, dann Directors, Gegner, Navigation.
- `src/activity/CoopMissionHostUpdate.ts` – die activity-interne Host-Reihenfolge (Fortschritt →
  Navigation/Flowfields → Gegnerkampf) samt Presentation-Publikation. Sie liest ausschließlich
  eigene Child-Owner und den `CoopMissionHostUpdatePort`; kein `ArenaContext`, kein `bridge`.
- `CoopMissionRuntimePorts` werden mit der Runtime übergeben (Closures am Coordinator), damit ein
  Activity-Wechsel in derselben World dieselben Fragen ohne Neuverkabelung stellt.
- Frame-Owner kennen nur `CoopMissionActivityStep` (`hostPrepareStartupCaches`, `hostSimulationStep`,
  `hostPrePhysicsStep`, `hostCarrySnapshot`, `hostResolveCompletion`, `hostApplyDebugBaseDamage`,
  `clientPresentationStep`); seit 10C verteilt der Frame-Owner `ArenaRuntime` sie.
- Das Missionsergebnis ist `CoopMissionOutcome`; die Runtime ermittelt es und wendet es nicht an –
  die Folgen gehören seit Phase 9 dem `ResultApplication`-Owner.
- Verträge: `tests/CoopMissionObjectiveOwnership.test.ts`, `tests/HostUpdatePhaseContracts.test.ts`.

**Owner-Landkarte nach Phase 7:**
- `src/world/PlayerWorldRuntime.ts` – nur noch world-scoped Module (`entity`, `worldTargeting`,
  `navigation`, `combat`, `combatResources`, `loadoutTools`, `playerBuild`). Ihr Kontext kennt
  die Activity nicht mehr; `resolvePlayerRuntimeFeatures` liest Rolle und Teilnahme.
- Materialisierungs-Ledger: `attach()` merkt die tatsächlich vergebenen Module, `detach(playerId)`
  liest ausschließlich dieses Ledger. Es gibt keinen Feature-Parameter beim Detach mehr.
- Ownership: `WorldRuntime.players`, erzeugt im World-Lifecycle-Sink. `WorldRuntime.destroy()`
  löst die Spieler **vor** `activity.close()` – ihr Abbau gibt gehaltene Missionsziele frei.
- `src/activity/CoopMissionPlayerRuntime.ts` – activity-scoped Spielerzustand: authored
  Respawn-Budget, Zielfreigabe und Ally-Flowfield-Ensure/Remove über das eigene Ledger.
  `src/activity/CoopMissionRuntime.ts` hält die konkrete Feld-/Coordinator-Registrierung und
  räumt sie einzeln auf. Erreichbar über `CoopMissionRuntime.playerActivity`.
- Attach/Detach-Reihenfolge im Koordinator: World zuerst hinein, Activity zuerst hinaus.
- Verträge: `tests/PlayerLifetimeSeparation.test.ts`, `tests/PlayerWorldRuntimeContracts.test.ts`,
  `tests/AllyFlowFieldLifetime.test.ts` (Join, Doppel-Ensure, Leave, Rejoin, Activity A→B,
  Activity-Destroy nach Leave und World ohne Activity).

**Owner-Landkarte nach Phase 8:**
- `src/persistentBase/PersistentBaseRoomSession.ts` – der raumlanglebige Owner. Er hält die
  committed Beiträge und Belohnungen und ist die **einzige** Stelle, die einen Arbeitsstand
  öffnet (`beginTransaction`) und abschließt (`completeTransaction`).
- `src/persistentBase/PersistentBaseTransaction.ts` – Baseline, Working State, World-/Activity-
  Identität und ID. `close()` ist terminal: Ein zweiter oder verspäteter Abschluss läuft ins
  Leere. `beginTransaction` einer anderen Instanz verwirft einen noch offenen zuvor.
- `src/persistentBase/PersistentBaseRuntimeBindings.ts` – die Runtime-Objekte einer World,
  gehalten von `PersistentBaseWorldBinding.constructionRuntimes` und mit ihr abgeräumt.
- `ActivityLifecycle`/`WorldLifecycle` – der getrennte `activityIdentity`-Sink öffnet und beendet
  die PB-Transaction an der Activity-Identity; der `ActivityRuntimeHost` bleibt für lokale
  Runtime-Materialisierung und Runtime-Detach/Reattach zuständig.
- Beitrags- und Reward-Speicher sind die Lesefassaden auf genau eine Lifetime (committed);
  Arbeitsstand und Runtime-Objekte werden ihnen über `useTransaction` / `useWorldRuntimes`
  geliehen. `hasActiveMission` bleibt als Prädikat erhalten.
- `applyPersistentBaseRoundOutcome` nimmt jetzt `{ session, isRuntimeObjectAlive, identity }`;
  der Koordinator übergibt die Identität der endenden Activity.
- Verträge: `tests/PersistentBaseLifetimeSeparation.test.ts` schützt A→B, A→keine Activity,
  Runtime-Detach/Reattach und idempotente Synchronisierung über den echten `WorldLifecycle`;
  `tests/PersistentBaseRoundOutcome.test.ts` schützt weiterhin Ergebnis- und stale-Identity-
  Semantik.

**Owner-Landkarte nach Phase 9:**
- `src/activity/ActivityCompletion.ts` – revisionsgebundener Coop-Abschluss mit getrenntem
  fachlichem Result (`victory` / `defeat`) oder Abort.
- `src/activity/ResultApplication.ts` – genau ein aktueller Abschluss; stale und doppelte
  Completions bleiben vor allen Folgen wirkungslos. Reihenfolge: Victory-Rewards →
  Persistent-Base Commit/Rollback → Activity-Presentation lösen → Result publizieren.
- `ArenaLifecycleCoordinator` adaptiert die realen Infrastrukturfolgen: authored Rewards aus der
  Activity-Definition, raumlanglebige PB-Session und bestehende RoundState-/RoundResults-Kanäle.
  Lokale XP, Unlocks und Item-Rewards bleiben der vorhandene Consumer des publizierten Snapshots;
  PvP und Diagnose erhalten keine leeren Phase-9-Abstraktionen.
- Vertrag: `tests/ActivityResultApplication.test.ts`; der Source-Ratchet in
  `tests/ArenaRoundLifecycleContracts.test.ts` schützt Anwendung vor World-Ende und verbietet die
  direkten Coop-Folgen wieder in `hostCompleteRound`.

**Owner-Landkarte nach Phase 10A:**
- `src/world/WorldComposition.ts` – löst World-Profil, Kontext, Layout und Basen auf und baut den
  konkreten `WorldRuntime`-Graph aus `WorldMaterialization`, Presentation, PB-Child, Placement,
  Bases und hostseitiger Rock-Registry; die Grenze hält keinen eigenen Runtime-State.
- `src/world/WorldGeometryBinding.ts` – world-scoped Anbindung scene-langlebiger Geometry-Consumer
  einschließlich Fire-/Light-Indices; symmetrischer, idempotenter Detach über `WorldRuntime.bind()`.
- `src/world/PlayerWorldRuntimeComposition.ts` – festes world-scoped Player-Rezept ohne
  `ArenaContext`; der erzeugte `PlayerWorldRuntime` bleibt Owner.
- `ArenaLifecycleCoordinator.buildWorld()` adaptiert Flow-/Scene-Ports und behält bis 10B die
  Activity-/PB-/Gameplay-Composition; konkrete World-Kinder und Shared-Geometry-Cleanup kennt er
  nicht mehr. R-2 bleibt durch die bestehende `WorldRuntime.destroy()`-Reihenfolge erhalten.
- Verträge: `tests/WorldMaterializationOwnership.test.ts`, `tests/PlayerWorldRuntimeContracts.test.ts`,
  `tests/WorldMetricsScopeContracts.test.ts`, Lobby-/Activity-/Lifetime-Source-Ratchets.

**Owner-Landkarte nach Phase 10B.6:**
- `src/activity/CoopMissionComposition.ts` – activity-spezifische Orchestrierungsgrenze für die fokussierten Coop-Composer; kein Lifetime-State.
- `src/world/PersistentBaseWorldBinding.ts` – world-lokale PB-Bindings und Lifecycle; `src/world/PersistentBaseWorldMaterializer.ts` – reine Ableitung der Room-/Transaction-Stores in die aktuelle World.
- `src/world/ConstructionWorldRuntime.ts` – World-Construction und Loadout-Handler; `src/world/WorldTrainRuntime.ts` – World-Train plus Activity-Train-Child über `WorldTrainNetworkPort`; `src/world/WorldPowerUpRuntime.ts` – World-PowerUp-Composition.
- `src/world/WorldTargetingRuntime.ts` – World-Targeting; `src/world/WorldPlayerGameplayRuntime.ts` – World-Player-/Loadout-/Build-Gameplay; `src/world/WorldCombatGameplayBinding.ts` – World-Combat-/Physics-/Projectile-/Base-/Turret-/Tesla-Projektionen; `src/world/WorldSupportGameplayRuntime.ts` – World-Support-Systeme.
- `ArenaLifecycleCoordinator` – World-/Activity-Übergang, direkte Owner-Zugriffe,
  Network-/Projection-Ports und fachliche Mutation-Validierung; keine konkrete Coop-Composer-Liste,
  Construction-Implementierung, Train-Runtime, PowerUp-System-Konfiguration oder große
  World-Gameplay-Binding-Liste mehr.


**Phase-10B-Ergebnis (verdichtet):** 10B.1–10B.7 haben Base-Activity-Lifetime, Coop-Composition,
Persistent-Base-World-Materialisierung, Construction/Train/PowerUp, die restlichen World-Gameplay-
Bindings und das Activity-Rebinding an ihre Owner gebracht. Die Owner-Landkarte oben gilt
unverändert; `CaptureTheBeerActivityRuntime` besitzt das CTB-System für die Activity-Lifetime, und
`WorldPlayerGameplayRuntime`/`WorldCombatGameplayBinding` lesen die laufende Activity dynamisch
(Verträge in `tests/ActivityRebindingContracts.test.ts`).

**Owner-Landkarte der Coop-Activity-Composition:**
- `src/activity/CoopMissionActivityConfig.ts` – eine validierte Activity-Sicht; `getActivityDefinition()` ist die Quelle, der bestehende Adapter nur die Compatibility-Form.
- `src/activity/CoopMissionCombatComposition.ts` – EnemyManager, Navigation und Encounter/Spawn/Boss/Director.
- `src/activity/CoopMissionEnemyBehaviourComposition.ts` – sechs Enemy-Behaviour-Systeme und die Spawn-/Rock-Callbacks.
- `src/activity/CoopMissionEnemySupportComposition.ts` – Timebomb, VoidHunter, Necromancy und deren stale-callback Guards.
- `src/activity/CoopMissionObjectiveComposition.ts` – Objectives, Progress, Barriers, Carry, Repair, Placement-Reward und Round-State.
- `src/activity/CoopMissionPlayerComposition.ts` – Respawn-Budget, Attach der bestehenden World-Spieler, Objective-Freigabe und Ally-Felder.
- `src/activity/CoopMissionMapEventComposition.ts` – authored Coop-Train, Airstrike, Ground Hazard und Map-Event-Director.
- `CoopMissionRuntime` besitzt sämtliche genannten Activity-Children; der Coordinator materialisiert sie nur über aktuelle World-/Scene-/Netzwerk-Ports. Der A→B-Contract und die World-ohne-Activity-Grenze sind in `tests/CoopMissionRuntimeOwnership.test.ts` sowie den Lifecycle- und Player-Contracts verankert.

**Phase-8-Review Problem 3 (korrigiert):** `persistentBaseOwnerByPlayerId` und
`ingestedContributionRevisions` waren fachlicher room-langlebiger State und liegen jetzt gemeinsam
mit der Gegenrichtung `playerIdByPersistentBaseOwnerId` in `PersistentBaseRoomSession`. Die Session
validiert und registriert Player↔Owner-Claims, nimmt Contribution-Stände revisionsgebunden an und
löst Bindung, Room-Contribution und Ingest-Stand beim Leave; der persönliche Save bleibt unangetastet
und kann beim Rejoin erneut angeboten werden. Dadurch bleiben Bindungen über World- und
Activity-Wechsel bei genau einem Owner erhalten. Collision-/stale-/Dedup-Verträge sowie World-,
Activity- und Leave/Rejoin-Lifetimes schützt `tests/PersistentBaseLifetimeSeparation.test.ts`;
`tests/PersistentBaseComposite.test.ts` schützt zusätzlich den Coordinator-Ownership-Ratchet.

Die Projection-Caches `projectionRevision` und `projectionSignature` liegen seit 10C beim
raumlanglebigen Persistent-Base-Owner: Sie sind ausschließlich monotone Network-/Projection-
Publishing- und Dedup-Caches für `PersistentBaseRewardSessionState`; die fachliche Reward-Revision
bleibt im `PersistentBaseRewardStore`. `persistentBaseVisualSite` bleibt Presentation-State im
Flow. Das world-lokale Binding wird seit 12A ausschließlich über `WorldRuntime.persistentBase`
gelesen; Runtime-/Composite-Bindings gehören dem `PersistentBaseWorldBinding` und sind keine
zweite Room-State-Quelle. Verbleibende Transitional Debt ist ausschließlich TD-10.

Der offene Ally-Flowfield-Lifetime-Punkt aus Phase 7 ist behoben: `CoopMissionPlayerRuntime`
verantwortet den activity-scoped Attach/Detach-Aufruf, `CoopMissionRuntime` erzeugt und entfernt
das persönliche Feld samt `FlowFieldCoordinator`-Registrierung. Der individuelle Leave-Pfad und
der Activity-Destroy sind idempotent; die bestehende Transitional Debt bleibt unverändert, neue
Debt entsteht nicht.

**Manuelle Baseline / Checkpoint C:**
- Phase-9-Stand wurde am 31.08.2026 vom User erfolgreich im Browser getestet.
- Diese erfolgreiche Baseline ist die Referenz für die große strukturelle Phase 10.
- Der User hat den Phase-10-Checkpoint C vor 11A manuell erfolgreich abgenommen.

**Phase-10-GO/NO-GO – Ergebnis:**
- LOC-Gate erfüllt: Flow (3.061) plus `ArenaRuntime` (159) liegen bei 3.220 LOC; Ziel war
  ≤ 3.000–3.500.
- Keine Enemy-/Objective-/Flowfield-/PB-Composite-/Construction-/Train-Systemliste mehr im Flow,
  kein großer globaler manueller Teardown, kein neuer God-Composer (größte Composition-Datei
  186 LOC, verteilt auf fünf fokussierte Grenzen).
- TD-1, TD-2, TD-4, TD-5, TD-6, TD-8 und TD-9 sind geschlossen; TD-10 bleibt für den eigenen
  Folgeentscheid offen.
- `Phase 12A abgeschlossen: JA`; `Phase 12B.1 abgeschlossen: JA`;
  `Phase 12B.2 kann begonnen werden: JA`.

**Nächste konkrete Aktion:**
`Phase 12B.2 – Contract-/Source-Test-Cleanup und finaler Acceptance Gate.`

**Nicht automatisch tun:**  
`Architektur- oder Implementierungsplan ändern.`
