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

**Aktive Phase:** `10B.4 – Persistent-Base World Materialization abgeschlossen; 10B.5 nicht begonnen`
**Gesamtstatus:** `Phasen 1–10A sowie 10B.1–10B.4 abgeschlossen; Checkpoints A/B automatisiert abgeschlossen; Phase-9-Baseline vom User manuell erfolgreich geprüft; Checkpoint C folgt nach 10C.`
**Letzter Integrations-Checkpoint:** `Phase 10B.4: npm run check grün; manuelle Browserprüfung bleibt User-Aufgabe.`
**Nächster Schritt:** `Phase 10B.5 – Construction / Inspector / restliche Gameplay-Composition`; 10C und 11 nicht vorziehen.

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
| 10B Activity/PB/Gameplay Composition | 🟨 aktiv | 10B.1–10B.4 abgeschlossen: Base-Activity-Lifetime, Coop-Composition und Persistent-Base-World-Materialisierung sind delegiert; Construction-/Inspector-/weitere Gameplay-Composition bleibt 10B.5. |
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
| TD-9 | 9/Rebaseline | World-, Coop-Activity- und Persistent-Base-World-Composition sind delegiert. Im `ArenaLifecycleCoordinator` verbleiben noch Construction-/Train-/weitere Gameplay-Composition und Teile des globalen Teardowns. | `CoopMissionRuntime` / `PersistentBaseWorldBinding` plus fachliche Domain-Owner; Composition-Grenzen bauen nur den Graph. | Phase 10B.5 |
| TD-10 | 10B.3 | Freie/mapweite Activity-PowerUps werden über die bestehende World-Layout-Generierung aus dem transitional `CoopDefenseMapConfig` in `ArenaLayout.powerUpPedestals` gebacken. Das Activity-Binding korrigiert nur die linked Base-Podeste; ein Wechsel A→B in derselben World kann freie PowerUps ohne größeren Generator-/Placement-Umbau nicht sauber austauschen. | Eigene Activity-PowerUp-/Placement-Composition mit World-Geometrie als Input; kein World-Rebuild als Workaround. | eigener Folgeentscheid vor dem Authoring-Cutover |

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
| `npm run check` | grün | Phase-10B.4: 329 Testdateien, 2782 Tests bestanden, 15 übersprungen; Build mit 620 transformierten Modulen erfolgreich. Bekannte Font-Auflösungswarnungen sind nicht blockierend. |
| `git diff --check` | grün | Phase-10B.4-Stand ohne Whitespace-Fehler. |
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
- Architektur-Dokument und Implementierungsplan wurden nach Phase 9 manuell rebaselined; 10A sowie 10B.1–10B.4 sind abgeschlossen, 10B.5/10C bleiben getrennte Phasen.
- Transitional Debt TD-1/TD-2/TD-4/TD-5/TD-6/TD-8/TD-9/TD-10 sowie R-2/R-4/R-5 berücksichtigen.
- Phase 9 liefert `ActivityCompletion` und `ResultApplication`; deren fachliche Outcome-Anwendung ist aus dem Completion-Pfad getrennt.
- Der `ArenaLifecycleCoordinator` enthält weiterhin Construction-/Train-/weitere Gameplay-Composition und ist noch kein nahezu fertiger Flow-Owner; World-, Coop-Activity- und PB-World-Materialisierung sind delegiert.

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
- `ActivityLifecycle` bindet sie über `WorldRuntime.activity`; same-world A→B zerstört A und materialisiert B über die fokussierten Activity-Compositions vollständig frisch.
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
- Keine neue Transitional Debt in 10B.1; die restliche 10B-Composition blieb bis 10B.3 unter TD-9.

**Phase-10B.2-Ergebnis – Coop Navigation/Encounter-Composition:**
- `CoopMissionCombatComposition` baut und verdrahtet EnemyManager, FlowFieldCoordinator mit Enemy-/Player-/Strategic-/Boss-Feldern, Strategic-Target-Services sowie SpawnExecutor, PersistentPressure, BossSystem und MapDirector. `CoopMissionRuntime` bleibt der alleinige Activity-Lifetime-Owner; der Coordinator liefert nur aktuelle World-/Base-Ports.
- Activity A→B materialisiert diese Composition frisch aus der aktuellen Activity und liest die aktuelle `BaseManager`-Projektion. Flowfield-Grid-Listener und Strategic-Activation-Listener werden mit der jeweiligen Activity gebunden und beim Runtime-Teardown gelöst.
- World ohne Activity registriert keine missionsabhängigen linked Pedestals. Die Activity bindet ihre Pedestal-Spezifikation tokenisiert; A→B entfernt A, ein verspätetes A-Detach entfernt B nicht, B→none entfernt nur B. Construction- und Persistent-Reward-Podeste bleiben separat.
- `ArenaLifecycleCoordinator`: 7.214 Zeilen vor 10B.2, 7.073 Zeilen danach (−141); die neue fokussierte Composition umfasst 254 Zeilen.
- Vertragsabdeckung: `tests/CoopDefenseDormantBases.test.ts` schützt Pedestal-Lifetime und die getrennten Podestalpfade; `tests/CoopMissionRuntimeOwnership.test.ts` schützt die 10B.2-Composition-Grenze und die Activity-Ownership.
- TD-9 bleibt für Construction-/Train- und weitere Gameplay-Composition bestehen. Phase 10B.3 und 10B.4 sind umgesetzt; 10B.5 und 10C bleiben getrennte nächste Schritte.

**Phase-10B.3-Ergebnis – restliche Coop-Activity-Composition und Review-Korrekturen:**
- `CoopMissionActivityConfig` löst `ActivityDescriptor.definitionId` über `getActivityDefinition()` auf, validiert Coop-Kind und World-Zuordnung und nutzt den vorhandenen Authoring-Adapter nur als temporären `CoopDefenseMapConfig`-Vertrag. Die Activity-Definition ist damit für Combat-, Objective-, Player- und Event-Composition die Quelle; `WorldDefinition` liefert weiterhin Metrik, Layout, Geometrie und Basen.
- `PowerUpSystem.createActivityPedestalBinding(specs, activityStartTime)` führt linked Activity-Podeste über einen eigenen Activity-Zeitursprung. Ein Attach ohne autoritativen Startanker bleibt pending und wird erst durch `setArenaStartTime()` gebunden; `spawnOnArenaStart=false` plant dann den ersten Spawn bei `T_activity + respawnMs`. Reset neutralisiert IDs, Specs, Token und Zeitbasis, ohne Construction-/Persistent-Reward-Podeste in diesen Lifecycle zu ziehen.
- Die fünf ergänzenden fokussierten Grenzen sind `CoopMissionEnemyBehaviourComposition` (Train-Awareness, Burrow, Dodge, Combat-Positioning, Ability, Attack und Spawn-/Rock-Callbacks), `CoopMissionEnemySupportComposition` (Timebomb, VoidHunter, Necromancy sowie Action-/Corpse-/Lethal-Bindings), `CoopMissionObjectiveComposition` (Objectives, Progress, Barriers, Carry, Repair, Placement-Reward, Round-State), `CoopMissionPlayerComposition` (Respawn-Budget, bestehende World-Spieler, Objective-Freigabe, Ally-Felder) und `CoopMissionMapEventComposition` (authored Train, Airstrike, Ground Hazard, Event-Director); zusammen mit der fokussierten `CoopMissionCombatComposition` bleiben alle Grenzen konkrete Builder ohne eigenen Lifetime-State.
- `CoopMissionRuntime` bleibt der einzige Activity-Lifetime-Owner. A→B zerstört alle A-Child-Owner und scoped Callbacks/Listener vor dem frischen B-Aufbau; `WorldRuntime` und `PlayerWorldRuntime` bleiben. Eine World ohne Activity materialisiert keinen Coop-Child-Graphen und kann später ohne World-Rebuild eine Activity aufnehmen. Der round-lokale `CoopDefenseTeamBuffSystem` gehört jetzt zum Objective-Owner, wird für B frisch erzeugt und über `syncCoopMissionCompatibilityBindings()` nur lesend als Compatibility-Fassade gespiegelt.
- Der generische `CoopMissionRuntime`-Materialisierungsmechanismus (`addMaterializationStep`, `exportMaterialization`, `materialize`) ist entfallen. Im vorherigen Stand war die konkrete 10B.3-Composer-Liste dennoch noch im globalen Coordinator verdrahtet; die Review-Korrektur führt sie jetzt über die activity-spezifische `CoopMissionComposition`, ohne neue Runtime-Wahrheit oder generische Registry.
- A3/A4 sind durch `CoopMissionComposition` und die Contracts in `tests/CoopMissionRuntimeOwnership.test.ts` sowie `tests/CoopMissionObjectiveOwnership.test.ts` ergänzt: der Coordinator kennt keine konkrete Composer-Liste, A und B tragen getrennte Child-Owner, und der Objective-Owner besitzt den frisch erzeugten TeamBuff. `tests/CoopMissionActivityConfig.test.ts` schützt Activity-Source-of-Truth und falsche World-Zuordnung; `tests/CoopDefenseDormantBases.test.ts` schützt den pending T+29.999/T+30.000-Pedestal-Fall und den frischen B-Anker.
- `ArenaLifecycleCoordinator`: 7.073 Zeilen vor 10B.3, 6.651 danach; nach 10B.4 6.506 Zeilen. `CoopMissionComposition` (292 Zeilen) koordiniert die fokussierten Activity-Composer, ohne ein neuer God-Composer zu sein.
- TD-10 bleibt bewusst offen: freie/mapweite Activity-PowerUps sind weiterhin Bestandteil der transitional World-Layout-/Generator-Schicht und wurden nicht halb migriert. Ein größerer Activity-PowerUp-/Placement-Entwurf ist als RK-6 notiert; ein World-Rebuild wurde nicht als Workaround eingeführt.

**Phase-10B.4-Ergebnis – Persistent-Base World Materialization:**
- `PersistentBaseWorldBinding` bleibt der world-lokale Owner von Anchor, Build Area, Construction-/Reward-Runtime-Bindings und Composite-Signaturen. Der unmittelbar gebundene `PersistentBaseWorldMaterializer` hält keinen Room- oder Transaction-State; er liest die bestehenden Stores und übersetzt sie ausschließlich in die aktuelle World-Repräsentation.
- Aus dem Coordinator herausgezogen sind Composite-Merge/Reconciliation, Reward-Placement und -Reconciliation, Reward-Turret-/Pedestal-Runtimes, Konflikt-Dematerialisierung, persönliche Runtime-Wiederherstellung sowie Finalize-/Release-Hilfen. Der Coordinator ruft nur kleine World-APIs (`reconcile`, `refreshForRelevantBuildChanges`, `materializeRewardPlacement`, `relocateRewardRuntime`, `onRewardRemoved`, `finalizeWorldRuntimeObjects`) und behält die Network-/Projection-Signatur.
- Reconciliation ist inkrementell: unveränderte Blueprints behalten ihre Runtime-ID; verdrängte Runtimes werden gelöst, der Blueprint bleibt im Store; neu aktive Einträge werden materialisiert. Reward-Zellen haben Vorrang vor persönlichen Konstruktionen, ein Reward-Fehler rollt ohne Teilbindung zurück, ein inaktiver Persistent Core lässt die Platzierung im Store und entfernt nur seine Turret-Runtime.
- Alle bestehenden Trigger laufen über dieselbe World-Grenze: initialer World-Aufbau, Contribution-/Owner-Änderung, relevante Loadout-/Kapazitätsänderung, Reward-Platzierung/Move/Dismantle/Outcome sowie Core-Aktivierung/-Zerstörung. A→B in derselben World behält WorldRuntime, Binding und Materializer; nur der Transaction-State wechselt. Eine activity-lose LobbyWorld materialisiert den committed Stand ohne künstliche Activity/Transaction.
- Der bestehende R-2-Abbau bleibt unverändert: Presentation-Handoff → PB-Finalisierung bei lebender Construction-Runtime → Freigabe der PB-World-Materialisierung → übriger World-Gameplay-Abbau. Ohne World-Binding entstehen keine mutable PB-Fallback-Maps.
- Vertragsabdeckung: `tests/PersistentBaseLifetimeSeparation.test.ts`, `tests/PersistentBaseComposite.test.ts`, `tests/PersistentBaseRewardCorrections.test.ts`, `tests/PersistentBaseManagementAllClasses.test.ts`, `tests/WorldMaterializationOwnership.test.ts` sowie die World-/Lobby-Contracts.

**Owner-Landkarte nach Phase 10B.4:**
- `src/activity/CoopMissionComposition.ts` – activity-spezifische Orchestrierungsgrenze für die fokussierten Coop-Composer; kein Lifetime-State.
- `src/world/PersistentBaseWorldBinding.ts` – world-lokale PB-Bindings und Lifecycle; `src/world/PersistentBaseWorldMaterializer.ts` – reine Ableitung der Room-/Transaction-Stores in die aktuelle World.
- `ArenaLifecycleCoordinator` – World-/Activity-Übergang, Compatibility-Sync, Network-/Projection-Ports und fachliche Mutation-Validierung; keine konkrete Coop-Composer-Liste und keine PB-World-Algorithmen mehr.

**Historische Owner-Landkarte nach Phase 10B.3 (vor 10B.4):**
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

`persistentBaseRewardProjectionRevision` und `persistentBaseRewardProjectionSignature` bleiben
bewusst im Coordinator: Sie sind ausschließlich monotone Network-/Projection-Publishing- und
Dedup-Caches für `PersistentBaseRewardSessionState`; die fachliche Reward-Revision bleibt im
`PersistentBaseRewardStore`. `persistentBaseVisualSite` bleibt Presentation-State. Die
world-lokale Referenz `persistentBaseWorldBinding` sowie Runtime-/Composite-Bindings bleiben
Compatibility-/Orchestrierungspfade auf `WorldRuntime`/`PersistentBaseWorldBinding` und sind keine
zweite Room-State-Quelle. Verbleibende Transitional Debt ist in TD-1, TD-2, TD-4, TD-5, TD-6,
TD-8, TD-9 und TD-10 aufgeführt.

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
`Phase 10B.5 – Construction / Inspector / restliche Gameplay-Composition`

**Nicht automatisch tun:**  
`Architektur- oder Implementierungsplan ändern.`
