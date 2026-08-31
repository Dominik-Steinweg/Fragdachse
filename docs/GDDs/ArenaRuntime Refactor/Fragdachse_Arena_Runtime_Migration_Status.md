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

**Aktive Phase:** `10B.1 – Base-Activity-Lifetime abgeschlossen; 10B.2 nicht begonnen`
**Gesamtstatus:** `Phasen 1–10A sowie 10B.1 abgeschlossen; Checkpoints A/B automatisiert abgeschlossen; Phase-9-Baseline vom User manuell erfolgreich geprüft; Checkpoint C folgt nach 10C.`
**Letzter Integrations-Checkpoint:** `Phase 10B.1: npm run check grün; manuelle Browserprüfung bleibt User-Aufgabe.`
**Nächster Schritt:** `Phase 10B.2 – weitere Activity/PB/Gameplay-Composition` auf separatem Auftrag umsetzen; 10C nicht vorziehen.

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
| 10B Activity/PB/Gameplay Composition | 🟨 aktiv | 10B.1 Base-Activity-Lifetime abgeschlossen; Coop-Runtime-Graph, PB-World-Materialisierung sowie Construction-/weitere Domain-Composition bleiben offen. |
| 10C Flow / ArenaRuntime | ⬜ offen | Echten Flow formen, Handoff und Frame-Orchestrierung übernehmen; danach Checkpoint C und GO/NO-GO. |
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
| TD-6 | 5 | Migrierte Enemy-/Encounter-/Boss-/Flowfield-Felder im `ArenaContext` sind gerichtete Compatibility-Fassaden für Scene und Renderer. Nur `syncCoopMissionCompatibilityBindings()` schreibt sie. | `CoopMissionRuntime` | Phase 11 |
| TD-8 | 6 | Die Reihenfolge der Coop-Simulation gehört der `CoopMissionRuntime`; ihre **Frame-Position** liegt weiter bei `HostUpdateCoordinator`/`ClientUpdateCoordinator`/`ArenaScene`, die die benannten Schritte (`hostSimulationStep`, `hostPrePhysicsStep`, `hostCarrySnapshot`, `hostResolveCompletion`, `clientPresentationStep`) aufrufen. Kein Frame-Owner kennt noch ein Missionssystem. | `CoopMissionRuntime` | Phase 10 (zusammen mit TD-2) |
| TD-9 | 9/Rebaseline | Die World-Composition ist delegiert. Im `ArenaLifecycleCoordinator` verbleiben noch Coop-Materialisierung, PB-Composite/Reward-Runtime, Construction-/Train-/weitere Gameplay-Composition und Teile des globalen Teardowns. | `CoopMissionRuntime` / `PersistentBaseWorldBinding` plus fachliche Domain-Owner; Composition-Grenzen bauen nur den Graph. | Phase 10B |

`TD-3` ist mit Phase 4 entfallen: Der Gameplay-State wird nicht mehr über das Instanzende hinweg freigegeben.

`TD-7` ist mit Phase 6 entfallen: Die fachliche Coop-Update-Reihenfolge liegt in
`src/activity/CoopMissionHostUpdate.ts`; verbleibt nur noch die Frage der Aufrufstelle (TD-8).

Die in der Phase-8-Prüfung erkannte implizite Kopplung des Transaction-Starts an `buildWorld()`
ist behoben; daraus entsteht keine neue Transitional Debt.

Problem 2 aus dem Phase-8-Review ist behoben: PB-Mutationsrequests tragen die kanonische
Activity-/World-Identity (`worldRevision` + `activityRevision`), und der Host prüft sie vor
Placement, Move/Repositioning und Dismantle einschließlich generischer Construction-RPCs gegen
die offene `PersistentBaseTransaction`. Ohne Activity/Transaction bleibt der Activity-Identifier
weg; Lobby-Operationen dürfen den committed Stand direkt ändern. Tests decken A→B, A→keine
Activity, aktuelle B-Operation, Lobby und manipulierte Wire-Werte ab. Der generische Loadout-RPC
führt das Feld bis Phase 11 als fachliches Request-Parameterfeld weiter.

---

## 4. Offene Regressionen / Risiken

| ID | Bereich | Problem / Risiko | Relevanz für nächste Phase |
|---|---|---|---|
| R-2 | World-Teardown | Der Abbau hat eine Reihenfolge mit fachlichem Grund: Darstellung geht zuerst (Handoff), dann der Abschluss des persistenten Basisbestands (braucht lebende Bau-Runtime, darf keine Darstellung mehr sehen), dann die Bau-Runtime. `WorldRuntime.destroy()` hält sie; Vertrag in `tests/WorldMaterializationOwnership.test.ts`. | Phase 10A–11 dürfen diese Reihenfolge nicht umsortieren. |
| R-4 | Host-Frame | Der Weltanteil `decoySystem.hostUpdateLifecycle()` steht seit Phase 6 **vor** dem Missionsschritt statt zwischen zwei Coop-Phasen; nur so ist die Activity-Reihenfolge zusammenhängend. Fachlich gleichwertig, weil ausschließlich die Navigation und die Kampfphase Köder und Tarnung lesen. Vertrag in `tests/HostUpdatePhaseContracts.test.ts`. | Phase 10C–11: Frame-Position beibehalten; nur die Aufrufstelle darf wandern. |
| R-5 | Exit-Fade | Player- und Enemy-Runtime fallen mit der World-Instanz. Das eingefrorene Entity-Bild muss deshalb **vor** `worldLifecycle.endInstance()` stehen; auf dem Host geschieht das im Completion-/Exit-Pfad, auf dem Client in `beginArenaExitPresentation`. Wer eine neue Stelle einführt, an der eine World-Instanz endet, muss diese Reihenfolge mitführen. | Phase 10C übernimmt die Übergangsreihenfolge und damit diesen Vertrag. |

`R-1` ist mit Phase 4 entfallen: Die Reihenfolge ist keine Zeilenfolge mehr, sondern folgt aus der Ownership (siehe R-2).

`R-3` ist mit Phase 7 endgültig entfallen: Die Player-Runtime fällt jetzt mit ihrer `WorldRuntime`.
Das eingefrorene Entity-Bild entsteht deshalb **vor** dem Ende der World-Instanz – auf dem Client
beim Fade-Start, auf dem Host schon beim Rundenabschluss (`hostCompleteRound`). Vertrag in
`tests/ArenaExitEntityPresentation.test.ts`.

---

## 5. Letzte relevante Checks

| Check | Ergebnis | Bezug |
|---|---|---|
| `npm run check` | grün | Phase-10B.1: 328 Testdateien, 2772 Tests bestanden, 15 übersprungen; Build mit 611 Modulen erfolgreich. Bekannte Font-Auflösungswarnungen sind nicht blockierend. |
| `git diff --check` | grün | Phase-10B.1-Stand ohne Whitespace-Fehler. |
| Browser-/Sichtprüfung | ✅ erfolgreich | Phase-9-Baseline am 31.08.2026 vom User manuell erfolgreich geprüft. Coding-KIs führen diese Prüfung weiterhin nicht selbst aus. |

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
- Architektur-Dokument und Implementierungsplan wurden nach Phase 9 manuell rebaselined; 10A und 10B.1 sind abgeschlossen, 10B.2/10C bleiben getrennte Phasen.
- Transitional Debt TD-1/TD-2/TD-4/TD-5/TD-6/TD-8/TD-9 sowie R-2/R-4/R-5 berücksichtigen.
- Phase 9 liefert `ActivityCompletion` und `ResultApplication`; deren fachliche Outcome-Anwendung ist aus dem Completion-Pfad getrennt.
- Der `ArenaLifecycleCoordinator` enthält weiterhin große Activity-/PB-/Construction-Composition und ist noch kein nahezu fertiger Flow-Owner; die World-Composition ist seit 10A delegiert.

**Owner-Landkarte nach Phase 4:**
- `src/world/WorldRuntime.ts` – Slots: `materialization`, `presentation`, `persistentBase`, `activity`, plus `bind()` für world-scoped Bindings scene-langlebiger Systeme.
- `src/world/WorldMaterialization.ts` – mutabler Gameplay-State: Arena-Physics/-Indizes, Bau-Runtime, Basen, Felsdaten, Verdeckungsindex.
- `src/world/WorldPresentationBinding.ts` – ausschließlich `ArenaPresentationResult` plus Geometriepuffer; keine Physics-/Gameplay-Container.
- `src/world/WorldPresentationHandoff.ts` – `release` / `adopt` / `discard`, am Coordinator (TD-5).
- `src/world/ArenaExitEntityPresentation.ts` – eingefrorene Player-/Enemy-Darstellung ohne Manager oder Physics für den Exit-Fade.
- `src/world/PersistentBaseWorldBinding.ts` – Site, Build Area, Reward-Runtime-IDs, Composite-Signaturen; ihr Abbau schließt den Bestand ab.
- Verträge: `tests/WorldRuntimeOwnership.test.ts`, `tests/WorldMaterializationOwnership.test.ts`.

**Owner-Landkarte nach Phase 5:**
- `src/activity/CoopMissionRuntime.ts` – konkrete Activity-Runtime für EnemyManager, Navigation/Flowfields, Encounter/Spawn, Boss, Enemy-Behaviour, Necromancy und Map-Directors; idempotenter Teardown in Abhängigkeitsreihenfolge.
- `ActivityLifecycle` bindet sie über `WorldRuntime.activity`; same-world A→B zerstört A und führt den gespeicherten realen Materialisierungspfad für B vollständig erneut aus.
- Activity-scoped Bindings lösen Combat, Physics, Train, Energy Shield sowie die langlebigen Enemy-Consumer vor dem Child-Teardown; Map-Event-Handler und Train-Runtime werden für B frisch erzeugt.
- `ArenaContext`-Felder der übernommenen Systeme sind nur Compatibility-Fassaden (TD-6).
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
  `clientPresentationStep`) über `ArenaLifecycleCoordinator.getActivityStep()` (TD-8).
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

**Phase-10A-Ergebnis gegenüber Rebaseline `8b4e2aeb`:**
- `ArenaLifecycleCoordinator`: 7.501 statt 7.856 Zeilen (netto −355); `buildWorld()` delegiert
  World-Auflösung, -Materialisierung und Geometry-Bindings, behält aber den 10B-Scope.
- Die drei neuen Grenzen sind klein und konkret (`WorldComposition` 274,
  `WorldGeometryBinding` 269, `PlayerWorldRuntimeComposition` 102 Zeilen); kein universeller
  `WorldComposer` und keine neue zweite State-Quelle.
- Activity-/PB-/Construction-/Train-Composition und entsprechender Rest-Cleanup bleiben für 10B;
  Flow/Handoff/Frame-Orchestrierung bleiben für 10C.

Diese Restmischung ist TD-9; die 10A-Grenzen dürfen in 10B/10C nicht zu einem God-Composer
zusammengezogen werden.

**Phase-10B.1-Ergebnis – Base-Activity-Lifetime:**
- `resolveWorldBases()` liefert ausschließlich Identität, Geometrie, World-Fraktion/Rolle, fest
  verbaute Türme und Persistent-Base-Reservierung. `WorldComposition` materialisiert diese
  Grundlage mit World-only Default (`damageable = false`).
- `BaseManager` bleibt als World-Owner bestehen. `BaseActivityBinding` projiziert pro Coop-Activity
  nur HP/Start-HP, Damageability, Dormanz, Objective-Verknüpfung und missionsabhängige Podeste;
  Attach/Detach ersetzt bzw. entfernt diese Projektion ohne World-Rebuild.
- `Activity A → B` liest die aktuelle Base-View beim erneuten Materialisieren; ein verspätetes
  Detach der alten Bindung kann den neuen Overlay-State nicht entfernen. World-Geometrie-Consumer
  bleiben an `worldBases` gebunden.
- Vertragsabdeckung: `tests/CoopDefenseDormantBases.test.ts` schützt World-only, World→A, A→B,
  B→none, Overlay-Projektion, Objective-Aktivierung und idempotentes/stales Detach; ergänzend
  schützen die World-/Lobby-Ownership-Contracts die Composition-Grenze.
- Keine neue Transitional Debt; TD-9 bleibt für die noch offene restliche 10B-Composition bestehen.

**Phase-8-Review Problem 3 (korrigiert):** `persistentBaseOwnerByPlayerId` und
`ingestedContributionRevisions` waren fachlicher room-langlebiger State und liegen jetzt gemeinsam
mit der Gegenrichtung `playerIdByPersistentBaseOwnerId` in `PersistentBaseRoomSession`. Die Session
validiert und registriert Player↔Owner-Claims, nimmt Contribution-Stände revisionsgebunden an und
löst Bindung, Room-Contribution und Ingest-Stand beim Leave; der persönliche Save bleibt unangetastet
und kann beim Rejoin erneut angeboten werden. Dadurch bleiben Bindungen über World- und
Activity-Wechsel bei genau einem Owner erhalten. Collision-/stale-/Dedup-Verträge sowie World-,
Activity- und Leave/Rejoin-Lifetimes schützt `tests/PersistentBaseLifetimeSeparation.test.ts`;
`tests/PersistentBaseComposite.test.ts` schützt zusätzlich den Coordinator-Ownership-Ratchet.

`persistentBaseRewardProjectionRevision` und `persistentBaseRewardProjectionSignature` bleiben
bewusst im Coordinator: Sie sind ausschließlich monotone Network-/Projection-Publishing- und
Dedup-Caches für `PersistentBaseRewardSessionState`; die fachliche Reward-Revision bleibt im
`PersistentBaseRewardStore`. `persistentBaseVisualSite` bleibt Presentation-State. Die
world-lokale Referenz `persistentBaseWorldBinding` sowie Runtime-/Composite-Bindings bleiben
Compatibility-/Orchestrierungspfade auf `WorldRuntime`/`PersistentBaseWorldBinding` und sind keine
zweite Room-State-Quelle. Verbleibende Transitional Debt ist in TD-1, TD-2, TD-4, TD-5, TD-6,
TD-8 und TD-9 aufgeführt.

Der offene Ally-Flowfield-Lifetime-Punkt aus Phase 7 ist behoben: `CoopMissionPlayerRuntime`
verantwortet den activity-scoped Attach/Detach-Aufruf, `CoopMissionRuntime` erzeugt und entfernt
das persönliche Feld samt `FlowFieldCoordinator`-Registrierung. Der individuelle Leave-Pfad und
der Activity-Destroy sind idempotent; die bestehende Transitional Debt bleibt unverändert, neue
Debt entsteht nicht.

**Manuelle Baseline vor Phase 10:**
- Phase-9-Stand wurde am 31.08.2026 vom User erfolgreich im Browser getestet.
- Diese erfolgreiche Baseline ist die Referenz für die große strukturelle Phase 10.
- Nach 10C wird Checkpoint C erneut manuell geprüft; mindestens Matchstart, Match-Exit/Exit-Fade,
  Lobby-Rückkehr, Lobby-Fast-Reinstance sowie ein repräsentativer Persistent-Base-Commit/Rollback-
  Pfad sollen sichtbar gegen diese Baseline verglichen werden.

**Phase-10-GO/NO-GO:**
- Nach 10C sollen alter Lifecycle-Coordinator plus eventueller neuer Flow zusammen im Zielbereich
  von höchstens ca. 3.000–3.500 LOC liegen.
- Wichtiger als die Zahl: keine konkrete Enemy-/Objective-/Flowfield-/PB-Composite-/Construction-/
  Train-Systemliste im Flow, kein großer globaler manueller Teardown und kein neu entstandener
  God-Composer.
- Wird dieses Gate trotz ernsthafter 10A–10C-Umsetzung deutlich verfehlt, Phase 11 nicht automatisch
  starten, sondern Gesamtrefactoring erneut bewerten.

**Nächste konkrete Aktion:**
`Phase 10B.2 – weitere Activity/PB/Gameplay-Composition umsetzen; Phase 10C nicht vorziehen.`

**Nicht automatisch tun:**  
`Architektur- oder Implementierungsplan ändern.`
