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

**Aktive Phase:** `Phase 4`
**Gesamtstatus:** `Phase 3 abgeschlossen; Architektur-Review zum Presentation-Lifetime durchgeführt und eingearbeitet`
**Letzter Integrations-Checkpoint:** `npm run check`
**Nächster Schritt:** Phase 4 umsetzen – zuerst die Presentation-Lifetime trennen (Architektur 6.1), danach die übrigen World-Bindings. Anschließend Integrations-Checkpoint A.

| Phase | Status | Kurznotiz |
|---|---|---|
| 1 Contracts | ✅ abgeschlossen | Lifecycle-/World-/Activity-/Persistent-Base-Contracts gezielt abgesichert. |
| 2 WorldRuntime-Fundament | ✅ abgeschlossen | `WorldRuntime` + `ActivityRuntimeHost`, erzeugt/zerstört im `WorldLifecycle`-Sink. |
| 3 World-Materialisierung | ✅ abgeschlossen | `WorldMaterialization` besitzt Layout, Presentation, Bau-Runtime, Basen und Verdeckungsindex; `WorldRuntime` besitzt sie. Die sechs alten `ArenaContext`-Felder sind readonly Lesefassaden. |
| – Architektur-Review | ✅ abgeschlossen | Presentation-Lifetime von der World-Gameplay-Lifetime getrennt: Architektur 6.1 (`WorldPresentationBinding`, `WorldPresentationHandoff`, harte Regel 18), Plan Phase 4 / Checkpoint A / Phase 10 präzisiert. Kein Produktionscode geändert. |
| 4 World Bindings / PlayerWorld | ⬜ offen | Beginnt mit dem Presentation-Split; löst TD-3 und R-1 auf. |
| 5 Coop Encounter / Enemy Ownership | ⬜ offen | |
| 6 Coop Objectives / Update / Presentation | ⬜ offen | |
| 7 Player-Lifetimes | ⬜ offen | |
| 8 Persistent Base Lifetimes | ⬜ offen | |
| 9 Completion / ResultApplication | ⬜ offen | |
| 10 Flow / ArenaRuntime | ⬜ offen | Übernimmt zusätzlich den `WorldPresentationHandoff`. |
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
| TD-3 | 3 | Der Sink gibt beim Instanzende die **gesamte** `WorldMaterialization` frei (`releaseMaterialization()`), obwohl nur die Darstellung länger leben muss; abgeräumt wird sie erst in `tearDownArena()`. | `WorldMaterialization` | **Phase 4** (Presentation-Handoff ersetzt die Freigabe) |
| TD-4 | 3 | `ArenaContext.worldMaterialization` plus die sechs readonly Lesefassaden (`arenaResult`, `currentLayout`, `placementSystem`, `rockRegistry`, `baseManager`, `lightOccluderIndex`) als Zugriffspfad der noch nicht migrierten Consumer. | `WorldRuntime.materialization` | Phase 11 |

---

## 4. Offene Regressionen / Risiken

| ID | Bereich | Problem / Risiko | Relevanz für nächste Phase |
|---|---|---|---|
| R-1 | World-Teardown | `WorldMaterialization.destroy()` hält die Reihenfolge heute als Zeilenfolge: erst Geometrie/Presentation abmelden, dann `beforePlacementRelease` (Abschluss des persistenten Basisbestands), dann Bau-Runtime freigeben. Zu früh freigegebene Runtime-Objekte löschen den persistenten Basis-Arbeitsstand; zu spät abgemeldete Geometrie verändert eine für den nächsten Aufbau erhaltene Darstellung. | Phase 4 löst das strukturell: Der Handoff liegt vor dem Gameplay-Teardown, danach ist keine Darstellung mehr erreichbar. Bis dahin Reihenfolge nicht umsortieren; Vertrag in `tests/WorldMaterializationOwnership.test.ts`. |

---

## 5. Letzte relevante Checks

| Check | Ergebnis | Bezug |
|---|---|---|
| `npm run check` + `git diff --check` | grün | 321 Testdateien, 2694 Tests bestanden, 15 übersprungen; Build erfolgreich. Bekannte Font-Auflösungswarnungen sind nicht blockierend. Keine Browser-/Sichtprüfung durchgeführt. |

Nur den letzten aussagekräftigen Stand behalten; keine Testhistorie führen.

---

## 6. Dokument-Review-Kandidaten

Coding-KIs tragen hier Änderungsbedarf ein, ändern aber die beiden kanonischen Dokumente nicht selbst.

| ID | Ziel | Beobachtung | Vorgeschlagene Änderung | Status |
|---|---|---|---|---|
| RK-1 | Architektur 6.1 / Plan Phase 4, Checkpoint A, Phase 10 | Phase 3 setzte voraus, dass die World-Materialisierung dieselbe Lifetime wie die `WorldRuntime` hat. Die Codeanalyse zeigt: Das gilt für den mutablen Gameplay-State bereits heute (Host- und Client-Update steigen bei `ctx.world === null` sofort aus), **nicht** aber für die gebaute Darstellung – Match-Exit und Lobby-Fast-Reinstance brauchen sie über das Instanzende hinaus. | Presentation-Lifetime als eigenen Begriff mit ausdrücklichem Transition-Handoff einführen; Phase 4 beginnt damit. | extern umgesetzt |

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
- Architektur-Dokument lesen, insbesondere 6.1 (Presentation Lifetime und Transition Handoff) und Regel 18.
- Implementierungsplan: nur aktive Phase plus direkte Voraussetzungen lesen.
- Transitional Debt, R-1 und RK-1 oben berücksichtigen.
- Ownership-Anker der World: `src/world/WorldRuntime.ts`, `src/world/WorldMaterialization.ts`, `src/world/ActivityRuntimeHost.ts`. Erzeugung im `buildWorld()`-Pass, Abbau in `tearDownArena()` über `destroyWorldMaterialization()`.
- Verträge: `tests/WorldRuntimeOwnership.test.ts` und `tests/WorldMaterializationOwnership.test.ts`.

**Belegte Ausgangslage für den Presentation-Split (verifiziert, nicht erneut herleiten):**
- `HostUpdateCoordinator.runHostUpdate()` und `ClientUpdateCoordinator.runClientUpdate()` steigen bei `ctx.world === null` sofort aus; ebenso sind `syncPersistentBaseRewards()`, `hostRefreshPersistentBaseComposite()` und `materializePersistentBaseComposite()` ohne `ctx.world` bzw. ohne Bau-Runtime wirkungslos. Nach dem Instanzende wird also kein Gameplay-State mehr gelesen oder simuliert.
- Die gebaute Darstellung wird von `showWorld === false` **nicht** ausgeblendet: `ArenaBuilder.syncStaticBackdrop()` schaltet nur Seitenrahmen und Hintergründe. Sichtbar bleibt sie bis `ArenaBuilder.destroyDynamic()`. `ArenaExitFadeOverlay` legt sich als Wash bis Alpha 0.9 über genau dieses stehende Bild.
- Match-Exit: Der Host beendet die Instanz in `hostCompleteRound()` und braucht die Darstellung danach noch für den Fade. Ein Client beendet seine lokale Instanz während des Fades gar nicht – `detectWorldChange()` steigt bei `deferredMatchToLobby` vorher aus.
- Matchstart aus der LobbyWorld: `hostCheckReadyToStart()` beendet die Instanz, danach deckt die opake Ladeblende (`arenaCountdown.showLoading()`) den Übergang ab.
- Lobby-Fast-Reinstance: Wiederverwendet ausschließlich `arenaResult` und `layout` (`reusableArenaResult`, `reusableLayout` → `builder.rebindWorldRuntime()`); Bau-Runtime, Basen, Felsregistry und Verdeckungsindex werden neu gebaut.
- Der Handoff muss `arenaResult` **und** `layout` gemeinsam tragen: `RockVisualHelper` schreibt Runtime-Objekte nach `currentLayout.rocks[id]`, und `replaceArenaLayoutContents()` setzt genau diesen Puffer beim Übernehmen neu. Die gebauten Objekte adressieren ihn per Index.
- `canFastReinstance` in `detectWorldChange()` prüft heute `ctx.arenaResult !== null && ctx.currentLayout !== null`. Auf dem Client läuft diese Prüfung, während die alte Runtime noch steht; nach dem Split muss sie Runtime-Presentation **und** Handoff berücksichtigen.

**Nächste konkrete Aktion:**  
`Phase 4 umsetzen, beginnend mit WorldPresentationBinding und WorldPresentationHandoff.`

**Nicht automatisch tun:**  
`Architektur- oder Implementierungsplan ändern.`
