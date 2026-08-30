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

**Aktive Phase:** `keine – Phase 7 abgeschlossen; Phase 8 nicht begonnen`
**Gesamtstatus:** `Phasen 1–7 abgeschlossen; Integrations-Checkpoints A und B automatisiert abgeschlossen; manuelle Browser-Abnahme durch den User ausstehend (Prüfliste in Abschnitt 7)`
**Letzter Integrations-Checkpoint:** `Checkpoint B (Coop-Lifecycle, Activity-Wechsel, getrennte Player-Lifetimes, Activity-Presentation) über npm run check`
**Nächster Schritt:** User führt die manuelle Sichtprüfung aus; Phase 8 erst mit einem neuen Auftrag beginnen.

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
| 7 Player-Lifetimes | ✅ abgeschlossen | `PlayerWorldRuntime` gehört der `WorldRuntime` und kennt nur world-scoped Module; Detach folgt einem Materialisierungs-Ledger. `CoopMissionPlayerRuntime` trägt Lebensbudget und Zielfreigabe der Mission. |
| – Checkpoint B | ✅ automatisiert abgeschlossen | Coop create/update/destroy, Activity-Wechsel in derselben World, `PlayerWorldRuntime` bleibt / `PlayerActivityRuntime` wird ersetzt, Activity-Presentation folgt der Activity-Lifetime. Browser-Sichtprüfung ist User-Abnahme. |
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
| TD-6 | 5 | Migrierte Enemy-/Encounter-/Boss-/Flowfield-Felder im `ArenaContext` sind gerichtete Compatibility-Fassaden für Scene und Renderer. Nur `syncCoopMissionCompatibilityBindings()` schreibt sie. | `CoopMissionRuntime` | Phase 11 |
| TD-8 | 6 | Die Reihenfolge der Coop-Simulation gehört der `CoopMissionRuntime`; ihre **Frame-Position** liegt weiter bei `HostUpdateCoordinator`/`ClientUpdateCoordinator`/`ArenaScene`, die die benannten Schritte (`hostSimulationStep`, `hostPrePhysicsStep`, `hostCarrySnapshot`, `hostResolveCompletion`, `clientPresentationStep`) aufrufen. Kein Frame-Owner kennt noch ein Missionssystem. | `CoopMissionRuntime` | Phase 10 (zusammen mit TD-2) |

`TD-3` ist mit Phase 4 entfallen: Der Gameplay-State wird nicht mehr über das Instanzende hinweg freigegeben.

`TD-7` ist mit Phase 6 entfallen: Die fachliche Coop-Update-Reihenfolge liegt in
`src/activity/CoopMissionHostUpdate.ts`; verbleibt nur noch die Frage der Aufrufstelle (TD-8).

---

## 4. Offene Regressionen / Risiken

| ID | Bereich | Problem / Risiko | Relevanz für nächste Phase |
|---|---|---|---|
| R-2 | World-Teardown | Der Abbau hat eine Reihenfolge mit fachlichem Grund: Darstellung geht zuerst (Handoff), dann der Abschluss des persistenten Basisbestands (braucht lebende Bau-Runtime, darf keine Darstellung mehr sehen), dann die Bau-Runtime. `WorldRuntime.destroy()` hält sie; Vertrag in `tests/WorldMaterializationOwnership.test.ts`. | Phase 5–8 dürfen diese Reihenfolge nicht umsortieren. |
| R-4 | Host-Frame | Der Weltanteil `decoySystem.hostUpdateLifecycle()` steht seit Phase 6 **vor** dem Missionsschritt statt zwischen zwei Coop-Phasen; nur so ist die Activity-Reihenfolge zusammenhängend. Fachlich gleichwertig, weil ausschließlich die Navigation und die Kampfphase Köder und Tarnung lesen. Vertrag in `tests/HostUpdatePhaseContracts.test.ts`. | Phase 8–11: Weltanteil nicht wieder in die Activity-Reihenfolge einsortieren. |
| R-5 | Exit-Fade | Player- und Enemy-Runtime fallen mit der World-Instanz. Das eingefrorene Entity-Bild muss deshalb **vor** `worldLifecycle.endInstance()` stehen; auf dem Host geschieht das in `hostCompleteRound`, auf dem Client in `beginArenaExitPresentation`. Wer eine neue Stelle einführt, an der eine World-Instanz endet, muss diese Reihenfolge mitführen. | Phase 10 übernimmt die Übergangsreihenfolge und damit diesen Vertrag. |

`R-1` ist mit Phase 4 entfallen: Die Reihenfolge ist keine Zeilenfolge mehr, sondern folgt aus der Ownership (siehe R-2).

`R-3` ist mit Phase 7 endgültig entfallen: Die Player-Runtime fällt jetzt mit ihrer `WorldRuntime`.
Das eingefrorene Entity-Bild entsteht deshalb **vor** dem Ende der World-Instanz – auf dem Client
beim Fade-Start, auf dem Host schon beim Rundenabschluss (`hostCompleteRound`). Vertrag in
`tests/ArenaExitEntityPresentation.test.ts`.

---

## 5. Letzte relevante Checks

| Check | Ergebnis | Bezug |
|---|---|---|
| `npm run check` | grün | 325 Testdateien, 2729 Tests bestanden, 15 übersprungen; Build erfolgreich. Bekannte Font-Auflösungswarnungen sind nicht blockierend. |
| `git diff --check` | grün | Keine Whitespace-Fehler. |
| Browser-/Sichtprüfung | ausstehend – User-Abnahme | Von Coding-KIs gemäß Prüfregel nicht auszuführen. Prüfliste siehe Abschnitt 7. |

Nur den letzten aussagekräftigen Stand behalten; keine Testhistorie führen.

---

## 6. Dokument-Review-Kandidaten

Coding-KIs tragen hier Änderungsbedarf ein, ändern aber die beiden kanonischen Dokumente nicht selbst.

| ID | Ziel | Beobachtung | Vorgeschlagene Änderung | Status |
|---|---|---|---|---|
| RK-1 | Architektur 6.1 / Plan Phase 4, Checkpoint A, Phase 10 | Die World-Materialisierung teilt sich in mutablen Gameplay-State (fällt mit der Runtime) und Darstellung (überlebt Übergänge). | Presentation-Lifetime mit ausdrücklichem Transition-Handoff. | extern umgesetzt |
| RK-2 | Plan Phase 4 → Phase 5 | Die heutige `FlowFieldCoordinator`-/Enemy-/Ally-/Boss-Navigation entsteht ausschließlich für Coop-Missionen und überlebt keinen Activity-Wechsel. Eine künftig echte activity-unabhängige World-Navigation bliebe dagegen world-scoped. | Aktuelle Coop-Navigation Phase 5 zuordnen; Phase 4 nur für nachweislich world-scoped Navigation formulieren. | extern umgesetzt |
| RK-3 | Plan Phase 4 → Phase 7 | `PlayerWorldRuntime`-Detach entfernt die Player-Entity. Der Exit-Fade braucht dafür keinen längeren Gameplay-Owner, sondern eine getrennte Entity-Presentation. Die Ownership-Verschiebung bleibt dennoch Teil der Player-Lifetime-Trennung. | `PlayerWorldRuntime`-Ownership in Phase 7 verschieben; Exit-Darstellung schon vorher als reine Transition-Presentation absichern. | extern umgesetzt |
| RK-4 | Plan Phase 6 / Phase 10, Architektur 10 | Die Coop-Simulation hat eine fachlich notwendige Frame-Position (nach Netzwerksync, innerhalb `gameplayActive`/`countdownActive`), die der heutige Runtime-Tick `ArenaScene.update() → updateWorldRuntime()` nicht trifft. Phase 6 konnte die Reihenfolge deshalb in den Activity-Owner verschieben, den Aufruf aber nicht in die Runtime-Kette. | Plan Phase 6 als "Reihenfolge und Systeme in den Activity-Owner" formulieren und die Aufrufstelle ausdrücklich Phase 10 (`ArenaRuntime.update()`, zusammen mit TD-2) zuordnen. | offen |

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
- Transitional Debt TD-6/TD-8 sowie R-2/R-4/R-5 berücksichtigen; RK-2/RK-3 sind in den kanonischen Dokumenten synchronisiert, RK-4 ist offen.

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
  die Folgen bleiben bis Phase 9 beim Coordinator.
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
  Respawn-Budget, Zielfreigabe, eigenes Ledger. Erreichbar über `CoopMissionRuntime.playerActivity`.
- Attach/Detach-Reihenfolge im Koordinator: World zuerst hinein, Activity zuerst hinaus.
- Verträge: `tests/PlayerLifetimeSeparation.test.ts`, `tests/PlayerWorldRuntimeContracts.test.ts`.

**Noch beim Coordinator (Stoff der Phasen 8–9):** Persistent-Base Session- und Transaction-State,
`persistentBaseVisualSite`, Team-Buff/Held-Action, sowie die Anwendung des Missionsergebnisses
(Reward, Progression, Persistent-Base-Outcome).

**Manuelle Browser-Prüfliste für den User:**
- Host und Client: Matchstart aus der LobbyWorld; keine leere oder doppelte World;
- Host und Client: Match-Exit und Lobby-Rückkehr; Exit-Fade zeigt World, Player und Gegner bis
  zum Fade-Ende, ohne sichtbares vorzeitiges Verschwinden oder Nachsimulation;
- Lobby-Fast-Reinstance bei Modus-/Map-/Persistent-Base-Änderung; Darstellung bleibt stabil,
  Physics und Interaktion stammen aus der neuen World;
- falls über Diagnose/Entwicklungsweg auslösbar: Coop-Activity A→B in derselben World; Gegner,
  Navigation und Map-Events gehören ausschließlich zu B.
- **Neu nach Phase 6 (Coop-Runde auf einer Map mit Missionsfortschritt, z. B. `advance`):**
  Checkpoints lösen aus, Fortschrittsbarrieren öffnen auf Host und Client gleichzeitig und
  blockieren vorher Weg, Schuss und Bauen; Nebenmissionen (Hold/Carry/Destroy) aktivieren sich,
  ihre Belohnungen (Pedestal, Reparatur, Team-Buff) erscheinen; Sieg und Niederlage beenden die
  Runde wie zuvor; Gegnerbewegung, Ausweichschritte und Boss-Verhalten unverändert.
- **Neu nach Phase 7 (Leben und Exit-Bild):** Auf einer Map mit Respawn-Budget (`survive`,
  `advance`) zeigt die Lebensanzeige nach Tod und Respawn denselben Stand wie zuvor, der
  Team-Wipe beendet die Runde weiterhin; Spieler, die während der Runde beitreten oder gehen,
  verlieren keine Ziele und hinterlassen keine gehaltenen Traglasten. **Besonders wichtig:** Der
  Exit-Fade muss auf **Host und Client** weiterhin Welt **und Spielfiguren** bis zum Fade-Ende
  zeigen – der Host friert sein Bild jetzt schon beim Rundenabschluss ein.

**Nächste konkrete Aktion nach User-Abnahme:**
`Phase 8 nur auf neuen Auftrag analysieren; PersistentBaseRoomSession/Transaction/WorldBinding trennen.`

**Nicht automatisch tun:**  
`Architektur- oder Implementierungsplan ändern.`
