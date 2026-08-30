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
**Gesamtstatus:** `Phase 3 abgeschlossen`
**Letzter Integrations-Checkpoint:** `npm run check`
**Nächster Schritt:** Phase 4 gegen aktuellen Branch verifizieren und umsetzen; danach Integrations-Checkpoint A.

| Phase | Status | Kurznotiz |
|---|---|---|
| 1 Contracts | ✅ abgeschlossen | Lifecycle-/World-/Activity-/Persistent-Base-Contracts gezielt abgesichert. |
| 2 WorldRuntime-Fundament | ✅ abgeschlossen | `WorldRuntime` + `ActivityRuntimeHost`, erzeugt/zerstört im `WorldLifecycle`-Sink. Presentation-/Persistent-Base-Slots sind Verträge und noch unbelegt. |
| 3 World-Materialisierung | ✅ abgeschlossen | `WorldMaterialization` besitzt Layout, Presentation, Fels-/Bau-Runtime, Basen und Verdeckungsindex; `WorldRuntime` besitzt sie. Die sechs alten `ArenaContext`-Felder sind readonly Lesefassaden. |
| 4 World Bindings / PlayerWorld | ⬜ offen | |
| 5 Coop Encounter / Enemy Ownership | ⬜ offen | |
| 6 Coop Objectives / Update / Presentation | ⬜ offen | |
| 7 Player-Lifetimes | ⬜ offen | |
| 8 Persistent Base Lifetimes | ⬜ offen | |
| 9 Completion / ResultApplication | ⬜ offen | |
| 10 Flow / ArenaRuntime | ⬜ offen | |
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
| TD-3 | 3 | Der Sink gibt die `WorldMaterialization` beim Instanzende frei (`releaseMaterialization()`), weil die gebaute Arena das Ende ihrer World-Instanz überlebt; abgeräumt wird sie erst in `tearDownArena()`. Siehe Review-Kandidat RK-1. | `WorldMaterialization` | Phase 10 |
| TD-4 | 3 | `ArenaContext.worldMaterialization` plus die sechs readonly Lesefassaden (`arenaResult`, `currentLayout`, `placementSystem`, `rockRegistry`, `baseManager`, `lightOccluderIndex`) als Zugriffspfad der noch nicht migrierten Consumer. | `WorldRuntime.materialization` | Phase 11 |

---

## 4. Offene Regressionen / Risiken

| ID | Bereich | Problem / Risiko | Relevanz für nächste Phase |
|---|---|---|---|
| R-1 | World-Teardown | `WorldMaterialization.destroy()` hat eine harte Reihenfolge: erst Geometrie/Presentation abmelden, dann `beforePlacementRelease` (Persistent-Base-Abschluss), dann Bau-Runtime freigeben. Zu früh freigegebene Runtime-Objekte löschen den persistenten Basis-Arbeitsstand; zu spät abgemeldete Geometrie verändert eine für den Fast-Reinstance erhaltene Presentation. Vertrag liegt in `tests/WorldMaterializationOwnership.test.ts`. | Phase 4 und Phase 8 dürfen diese Reihenfolge nicht umsortieren. |

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
| RK-1 | Plan, Phase 3 / Phase 10 | Phase 3 setzt voraus, dass die World-Materialisierung dieselbe Lifetime wie die `WorldRuntime` hat. Im Ist-Code endet die World-Instanz an mehreren Stellen, bevor die Arena abgebaut wird: Rundenstart (`hostCheckReadyToStart`), Rundenende/Discard (Exit-Fade), Lobby-Fast-Reinstance und `onTransitionToLobby`. Ein Abbau am Instanzende würde die Exit-Fade-Darstellung und die Wiederverwendung der Lobby-Presentation zerstören. | Phase 3 auf den Owner-Schnitt beschränken (umgesetzt) und die Angleichung der Lifetimes ausdrücklich Phase 10 zuordnen: Der Flow-Owner besitzt die Übergangsreihenfolge und kann `tearDownArena()` und `endInstance()` zusammenführen. Danach entfällt TD-3. | offen |

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
- Architektur-Dokument lesen.
- Implementierungsplan: nur aktive Phase plus direkte Voraussetzungen lesen.
- Transitional Debt, R-1 und RK-1 oben berücksichtigen.
- Ownership-Anker der World: `src/world/WorldRuntime.ts` (Slots `activity`, `materialization`, Presentation- und Persistent-Base-Binding), `src/world/WorldMaterialization.ts` und `src/world/ActivityRuntimeHost.ts`. Erzeugung im `buildWorld()`-Pass, Abbau in `tearDownArena()` über `destroyWorldMaterialization()`.
- Verträge: `tests/WorldRuntimeOwnership.test.ts` und `tests/WorldMaterializationOwnership.test.ts`.
- Noch beim Coordinator: World-Navigation/Flowfields, `PlayerWorldRuntime`, Persistent-Base-Anker/Build-Area und die World-Presentation-Synchronisation. Das ist der Stoff von Phase 4.

**Nächste konkrete Aktion:**  
`Phase 4 analysieren und gegen den aktuellen Stand verifizieren.`

**Nicht automatisch tun:**  
`Architektur- oder Implementierungsplan ändern.`
