# Fragdachse – ArenaScene Refactoring: Migration Status

**Zweck:** Extrem kompaktes, temporäres Arbeitsprotokoll der laufenden Migration.  
**Architektur:** `Fragdachse_ArenaScene_Architecture.md`  
**Plan:** `Fragdachse_ArenaScene_Implementation_Plan.md`  
**Repository-Basis der Planung:** `main` @ `39677c149ff44ebb8c3071b6bb18fede4bbb8013`

> **Dieses Dokument darf von Coding-KIs fortgeschrieben werden. Architektur und Implementierungsplan dürfen nicht automatisch geändert werden.**

Browser-/Sichtprüfungen führt der User manuell nach den automatisierten Gates durch. Coding-KIs starten ohne ausdrückliche Aufforderung keinen Dev-Server oder Browser.

## 1. Regeln für die Fortschreibung

Nach einem Implementierungsschritt nur festhalten, was für die nächste KI relevant ist:

- aktueller Phasenstatus;
- offene Transitional Debt;
- bekannte Regressionen / Risiken;
- letzter relevanter Check;
- konkret nächster Schritt;
- erkannter Änderungsbedarf an Architektur oder Plan.

Keine Chronik und keine Wiederholung des Implementierungsplans.

Wenn Code und Dokumentvorgabe nicht sinnvoll zusammenpassen:

1. Architektur/Plan nicht selbst ändern;
2. unter **Dokument-Review-Kandidaten** Konflikt + Änderungsvorschlag eintragen;
3. bestehende Vorgaben weiter respektieren, soweit kein inkonsistenter Zustand entsteht.

---

## 2. Aktueller Stand

**Aktive Phase:** `6A.2 – World Lighting, Shadows und übrige World-Renderer`
**Gesamtstatus:** `🟨 Phase 6A.1 abgeschlossen – World-Kamera und Surface-Residency hängen am world-scoped Presentation-Owner; Lighting/Shadows folgen in 6A.2. Checkpoint A/B warten weiterhin auf manuelle Sichtprüfung`
**Letzter verifizierter Repository-Stand:** `main` nach Phase 6A.1
**Automatisierter Gate für dieses Refactoring:** `npm run check` grün (339 Testdateien, 2870 Tests, 15 skipped; `tsc` + `vite build` erfolgreich)
**Manueller Gate:** `offen – visuelle Prüfung nicht ausgeführt (Browser ist opt-in); automatisierte Checkpoint-A/B- und Phase-3A–6A.1-Verträge grün. Kamera und Residency sind sichtprüfungsrelevant (Checkpoint C).`

| Teilphase | Status | Kurznotiz |
|---|---|---|
| 1 Baseline / Contracts | ✅ abgeschlossen | 21 Source-Assertions in 13 Dateien inventarisiert; 4 Vertragslücken geschlossen. |
| 2A Diagnostics Lifecycle/UI | ✅ abgeschlossen | `ArenaDiagnosticsController` besitzt Profiler, Ablation, beide Debug-Overlays und die Attribution; `ArenaScene` −115 Zeilen. |
| 2B Diagnostics Frame/Sampler | ✅ abgeschlossen | `ArenaDiagnosticsController` besitzt Scene-/Transport-/Companion-Sampling, Counter und Frame-Messung; `ArenaScene` liefert nur benannte Messpunkte plus Read-only-Snapshot. |
| – Checkpoint A | 🟨 aktiv | Automatisierte Prüfungen grün; manuelle Sichtprüfung von Diagnose an/aus, Overlay, Ablation und Sampling noch offen. |
| 3A Input Setup/Hotkeys | ✅ abgeschlossen | `ArenaInputBindings` besitzt statische Provider, Spectator-/Arena-Panel-/Debug-Keys, sieben lokale Hotkeys und idempotentes eigenes Teardown. |
| 3B Input Actions/Feedback | ✅ abgeschlossen | Radial-/Placement-/Management-Provider, Scope-Start, InputPolicy, Aim-/Cursor-Freigabe, lokale Requests und Cooldown-/Ressourcen-/Failure-Feedback liegen hinter kleinen Read-/Request-/Feedback-Ports im Owner; keine Hostvalidierung verschoben. |
| 4A Meta Progress/Upgrades/Loadout | ✅ abgeschlossen | `ArenaMetaController` besitzt validierten Read-/Arbeitsstand, Reconciliation, Klassen-/Upgrade-/Respec-/Tool-/Loadout-Use-Cases und persönliche Debug-Mutationen; Persistenz bleibt Adapter. |
| 4B Meta Items/Rewards | ✅ abgeschlossen | `ArenaMetaController` besitzt Item-Unlock-/Unseen-/Pending-State, Equip/Unequip/Salvage, Claim, Reward-Präsentation, automatische Reward-Anzeige und Lobby-Button-Projektion; Persistenz bleibt Adapter. |
| 4C Meta Results/Lobby | ✅ abgeschlossen | `ArenaMetaController` besitzt Result-Read-Verarbeitung, persönliche XP-/Unlock-/Reward-Verbuchung mit lokaler Deduplizierung, Result-Präsentation/Replay, Import-Follow-up, Default-Map, Ready-Reset und persönliche Lobby-Projektion; `ArenaScene` besitzt keinen persönlichen Result-/Progress-/Item-State und keine direkten persönlichen Persistence-Mutationen mehr. `ResultApplication` und `ArenaPersistentBaseSession` bleiben unverändert ihre jeweiligen Owner. |
| – Checkpoint B | 🟨 aktiv | Automatisierte Prüfungen grün; manuelle Prüfung von Input, Persistent Base, Spectator, Options/Debug, Meta/Items/Upgrades/Results, Dateiimport/Lobby-Projektion und Ready-State noch offen. |
| 5 Presentation-Lifetime-Fundament | ✅ abgeschlossen | `WorldPresentationFrameBinding` + dedizierter `WorldRuntime`-Slot; der Detach läuft garantiert vor dem Handoff-Release. Activity-Seite bewusst unverändert (reuse-first: vorhandene Verträge reichen, nur festgeschrieben). |
| 6A.1 World Surface/Camera | ✅ abgeschlossen | `syncMainCamera` (beide Frame-Positionen) und World-Surface-Residency liegen im `WorldPresentationFrameBinding`; TD-5 aufgelöst. Shadow-Residency, Canopy, World Grade und Camera-Feedback bewusst zurückgestellt. |
| 6A.2 World Lighting/Renderer | ⬜ offen | Shadows, Lighting, Shared-Consumer und übrige World-Renderer. |
| 6B Client World Projection | ⬜ offen | world-spezifische replizierte Client-Projektion. |
| – Checkpoint C | ⬜ offen | World ohne Activity, Preview und Handoff. |
| 7A.1 Coop HUD/Announcements | ⬜ offen | HUD, ViewModels und Announcements an Activity-Lifetime. |
| 7A.2 Coop World-space Presentation | ⬜ offen | Objective-/Carry-/Repair-/Mission-Renderer an Activity-Lifetime. |
| 7B Coop Client/Lifecycle Cutover | ⬜ offen | Client-Projektion über bestehenden Activity-Step vollständig cutovern. |
| – Checkpoint D | ⬜ offen | Activity A→B, Host/Client, kein Presentation-Leak. |
| 8 Scene Frame Cutover | ⬜ offen | `update()` auf Top-Level-Orchestrierung reduzieren. |
| 9 Cleanup / Final Gate | ⬜ offen | Compatibility, Imports, Source-Ratchets, `npm run check`. |

Statuswerte: `⬜ offen` · `🟨 aktiv` · `🟧 blockiert` · `✅ abgeschlossen`

---

## 3. Test-Migrationskarte

Vollständiges Inventar aller Tests, die `src/scenes/ArenaScene.ts` als **Text** lesen und darauf asserten.
Stand: 14 Dateien, 26 Assertion-Stellen. Weitere Pfadschreibweisen, Glob- oder Verzeichnis-Scans auf die Scene existieren nicht (per `rg` über `readFileSync`, `readdirSync`, `src/scenes` in `tests/` verifiziert).

Klassen: **B** = schützt echtes Verhalten (nur zufällig per Quelltext geprüft) · **R** = Architektur-/Ownership-Ratchet · **S** = schützt nur den historischen Quellort.
Beim Cutover gilt: **B** wird zum Verhaltens-Test des neuen Owners, **R** zieht als Architektur-Test zum neuen Owner um, **S** entfällt.

| # | Test | Kl. | Schützt | Heutiger Source-Ort | Ziel-Owner | Migration in Phase |
|---:|---|:--:|---|---|---|:--:|
| 1 | `ArenaExitEntityPresentation` · beendet Gameplay vor dem Fade | B | Exit-Fade startet nach Gameplay-Ende; `worldVisible`-Formel | `ArenaScene` Exit-/Sichtbarkeitsblock | `WorldPresentationFrameBinding` | 6A.2 |
| 2 | `ArenaFlowCheckpointC` · Coop-Simulation an ihrer Frame-Position (R-4) | R | Scene taktet nur die `arenaRuntime`-Fassade, nie Host-/ClientUpdate direkt; **Phase 1 ergänzt:** Reihenfolge `syncRoomOwners → update → runHost/ClientFrame` | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |
| 3 | `ArenaFlowCheckpointC` · kein Top-Level-Owner selbst getaktet | R | Persistent-Base-Owner wird nur vom Frame-Owner getaktet | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |
| 4 | `ArenaTransitionReadiness` · Host-Lobby-Sync während Exit-Fade | B | `deferArenaExit → detectPhaseChange → hostSyncLobbyWorld → detectWorldChange`; genau ein `hostSyncLobbyWorld()` | `ArenaScene.update()` | `ArenaScene` (Frame-Orchestrierung) | 8 |
| 5 | `ArenaTransitionReadiness` · Deferred-Exit-Fenster bis World-Erkennung | R | `deferArenaExit` erreicht `detectWorldChange` | `ArenaScene.update()` | `ArenaScene` (Frame-Orchestrierung) | 8 |
| 6 | `LobbyWorldContracts` · Systemcursor nur mit Zielhilfe | B | Cursor/Fadenkreuz nur bei `worldMode === 'interactive'`, nicht in Vorschau | `ArenaScene` Input-/Cursor-Block | `ArenaInputBindings` | 3B |
| 7 | `LobbyWorldContracts` · Lobby über World-Lifecycle statt Vorschau | R | Kein `MenuArenaPreview`/`LobbyAmbient`; `hostSyncLobbyWorld()` | `ArenaScene` (Abwesenheits-Ratchet) | `ArenaScene` (bleibt) | 9 |
| 8 | `LobbyWorldInteractive` · Testgelände-Entry/Exit/Optionen | B | `canEnter` nur solange Spieler nicht ready | `ArenaScene` Lobby-Overlay-Verdrahtung | `ArenaMetaController` | 4C |
| 9 | `LobbyWorldInteractive` · ESC behandelt Modals vor World-Leave | B | ESC-Reihenfolge Options → Hotkey-Block → Leave | `ArenaScene` Hotkey-Handler | `ArenaInputBindings` | 3A |
| 10 | `LobbyWorldInteractive` · Lobby-Oberfläche folgt der Presentation | B | `syncLobbySurface(presentationPolicy.showLobby)`, `inRoundWorld`-Ableitung | `ArenaScene.update()` Presentation-Block | `WorldPresentationFrameBinding` | 6A.2 |
| 11 | `LobbyWorldInteractive` · Ladescreen bis gebackener Weltausschnitt | B | Boot-Reveal an `getWorldRevealState`, nicht an `POST_RENDER` | `ArenaScene` Boot-Reveal | `ArenaScene` (Boot) + `WorldPresentationFrameBinding` | 6A.2 |
| 12 | `LobbyWorldL3` · lokale Player-Presentation nur mit Surface + Runtime | B | `playerStatusRing` an `localPlayerVisuals`, nicht an `inArena` | `ArenaScene.update()` Presentation-Block | `WorldPresentationFrameBinding` | 6A.2 |
| 13 | `LobbyWorldL3` · derselbe Client-Renderer-Consumer mit/ohne Activity | R | Activity-lose World nutzt denselben Client-Pfad (`runClientFrame` + `syncClientWorldSnapshotPresentation`) | `ArenaScene.update()` Client-Zweig | `WorldPresentationFrameBinding` (+ `ArenaRuntime`) | 6B |
| 14 | `PersistentBaseManagementAllClasses` · Rückbau unterdrückt Aim | B | `showAim` respektiert `isDismantlePlacementActive()`; Basis-Visuals folgen dem Modus | `ArenaScene` Aim-/Visuals-Block | `ArenaInputBindings` (Aim) + `WorldPresentationFrameBinding` (Visuals) | 3B / 6A.2 |
| 15 | `Phase11DependencyCutover` · Construction-RPCs am World-Owner | R | RPC ruft `getConstructionWorldRuntime()` direkt, nicht über den Flow | `ArenaScene` RPC-Verdrahtung | `ArenaScene` / `ArenaRuntime` | 9 |
| 16 | `PresentationInputPolicyContracts` · Eingabe aus der Policy | R | `resolveInputPolicy()` statt handgebauter Bedingungskette | `ArenaScene.update()` Input-Block | `ArenaInputBindings` | 3B |
| 17 | `WorldMaterializationOwnership` · Gameplay-State über seine Owner | R | Die 5 Scene-Getter delegieren an `worldRuntime.materialization/.presentation` | `ArenaScene` Getter | `ArenaScene` (dünne Delegation) | 9 |
| 18 | `WorldMetricsScopeContracts` · Basen/Basisstelle am World-Kontext | R | `persistentBaseSite` kommt aus `activeWorld`, nicht global | `ArenaScene.update()` | `WorldPresentationFrameBinding` | 6A.2 |
| 19 | `WorldMetricsScopeContracts` · Respawn-Kontext aus der aktiven World | B | Spawn-Map aus `world.descriptor.definitionId`, nicht aus Rundenstate | `ArenaScene:1054` Spawn-Provider | `ArenaRuntime`/`WorldRuntime` | 9 |
| 20 | `WorldPresentationContracts` · Darstellungsentscheidung am richtigen Ort | R | Weltkamera über `allowsWorldPresentationSurface(..., 'worldCamera')` | **migriert (6A.1)**: prüft jetzt `WorldPresentationFrameBinding` | `WorldPresentationFrameBinding` | ✅ 
| 21 | `WorldRuntimeOwnership` · World-Runtime hinter dem WorldLifecycle | R | Scene taktet nur `arenaRuntime.update(delta)`, nie `updateWorldRuntime` | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |
| 22 | `ArenaMetaController` · Meta-Ownership und Teardown | R | Progress-/Upgrade-/Loadout-Mutationen liegen im scene-langlebigen Owner; Persistence bleibt Adapter; `destroy()` ist idempotent und danach inert | `ArenaScene` + `ArenaMetaController` | `ArenaMetaController` | 4A |

**Korrektur der Phasenprognose (6A.1).** Die Phase-1-Karte hatte die Einträge 1, 10, 11, 12, 14 und 18 ebenfalls für 6A.1 vorgesehen. Der reale 6A.1-Schnitt fiel bewusst enger aus (nur Kamera + Surface-Residency), weil alle übrigen Kandidaten `renderers.shadow`/`renderers.lighting` berühren oder activity-gegatet sind. Diese Einträge sind auf **6A.2** umdatiert; nur Eintrag 20 ist tatsächlich migriert.

**Kein Test der Klasse S.** Jede geprüfte Formel bzw. jeder geprüfte Aufruf trägt entweder echtes Verhalten (Aufrufreihenfolge = Ausführungsreihenfolge, verhaltenssteuernde Bedingungen) oder eine bewusste Ownership-Grenze. Beim Cutover darf daher **kein** Eintrag ersatzlos gelöscht werden.

**Inventar-Nebenbefund:** `tests/ArenaRoundLifecycleContracts.test.ts` deklarierte eine ungenutzte Konstante `SCENE_PATH = 'src/scenes/ArenaScene.ts'` ohne jede Assertion. Sie wurde in Phase 1 entfernt, damit spätere Inventare kein falsches Signal erhalten; die Datei enthält keine ArenaScene-Assertion.

---

## 4. Transitional Debt

| ID | Seit Phase | Temporärer Pfad / Debt | Source of Truth | Entfernen bis |
|---|---:|---|---|---:|
| TD-6 | 6A.1 | `getVisibleWorldView(this.cameras.main)` wird an der Residency-Stelle jetzt **zweimal** ausgewertet: einmal im Frame-Binding für die Surface-Residency, einmal in der Scene für `renderers.shadow.updateStaticResidency`. Die Funktion ist rein (nur Kamera-Arithmetik), beide Aufrufe im selben Moment liefern identische Werte – es ist verdoppelte Rechnung, kein zweiter Zustand. | `WorldPresentationFrameBinding` | 6A.2 (mit dem Umzug der Shadow-Residency) |

---

## 5. Bekannte Risiken / Schutzverträge

### 5.1 Abdeckungsstand der in Phase 1 geforderten kritischen Verträge

| Vertrag | Abdeckung | Beleg |
|---|---|---|
| World ohne Activity | ✅ voll | `WorldRuntimeOwnership`, `SharedWorldWithoutActivity`, `WorldWithoutActivityProof` |
| Preview vs. Interactive | ✅ voll | `WorldPresentationContracts`, `LobbyWorldInteractive`, `PresentationInputPolicyContracts` |
| InputPolicy / Capabilities | ✅ voll | `PresentationInputPolicyContracts` (reine Funktionstests, alle Branches) |
| Host-/Client-Frame-Position | ✅ voll *(Phase 1 ergänzt)* | `ArenaFlowCheckpointC` R-4 jetzt mit `indexOf`-Reihenfolge statt nur `toContain` |
| Exit-Presentation vor World-Ende | ✅ voll | `ArenaFlowCheckpointC` R-5 (drei Reihenfolge-Assertions), `ArenaExitEntityPresentation` |
| WorldPresentation-Handoff | ✅ voll | `WorldMaterializationOwnership` (release→adopt/discard, Verdrängung), `ArenaFlowCheckpointC` |
| LobbyWorld-Readiness | ✅ voll *(Phase 1 ergänzt)* | `ArenaTransitionReadiness`: Readiness ohne Activity ist unabhängig von `participation` und `worldParticipationState`, mit ARENA-Gegenprobe |
| Meta-Resultat nicht doppelt angewendet | ✅ voll | `ActivityResultApplication` (zweiter `apply()` → `false`), `ArenaRoundLifecycleContracts` |
| Stale World-Binding inert | ✅ voll für Geometry + Combat *(Phase 1 ergänzt)* | `WorldGeometryBindingLifecycle`; neu `ActivityRebindingContracts` für `WorldCombatGameplayBinding` |
| Genau ein Activity-Client-Presentation-Step | ✅ voll *(Phase 1 ergänzt)* | Neuer Ratchet in `CoopMissionRuntimeOwnership`, spiegelbildlich zum Host-Pendant in `HostUpdatePhaseContracts` |
| Teardown-Idempotenz scene-langlebiger Owner | ✅ für neue Refactoring-Owner | `ArenaDiagnosticsController`, `ArenaInputBindings` und `ArenaMetaController` liefern idempotentes `destroy()` mit Tests; die übrigen bestehenden Owner bleiben außerhalb dieser Phasen unverändert. |
| Frame-Binding fällt vor Handoff | ✅ voll *(Phase 5)* | `WorldPresentationFrameLifetime`: Reihenfolge `FrameBinding.destroy → handoff.release → runtime.destroy` als beobachtetes Aufrufprotokoll, plus Sicherheitsnetz-, Idempotenz-, Stale- und End-zu-Ende-Tests über `WorldLifecycle` |

### 5.2 Risikoregister

| ID | Bereich | Risiko / Vertrag | Schutz |
|---|---|---|---|
| R-1 | Source-Tests | Zahlreiche Tests prüfen konkrete Strings in `ArenaScene.ts`; sie dürfen die alte Ownership nicht konservieren. | **Inventarisiert** (Abschnitt 3, 21 Einträge). Beim Cutover jeder Teilphase die dort gelisteten Einträge zum neuen Owner mitnehmen, nicht löschen. |
| R-2 | World Handoff | `WorldPresentationBinding` darf beim Handoff keine Gameplay-/Physics-Referenzen tragen; der aktive Frame-Binding darf nicht erst nach dem Release fallen. | **Geschlossen (Phase 5).** `WorldRuntime` führt den Frame-Binding in einem **eigenen** Slot, nicht in `worldScopedBindings` (deren Teardown liefe erst in `destroy()` und damit zu spät – genau der von Architektur §4.5 beschriebene Fall). `ArenaLifecycleCoordinator.detach()` ruft jetzt `runtime.detachPresentationFrame()` **vor** `worldPresentationHandoff.release(runtime.releasePresentation())`; `WorldRuntime.destroy()` wiederholt den Detach als idempotentes Sicherheitsnetz zuerst. Alle Teardown-Pfade laufen über diesen einen Sink. |
| R-3 | Stale World Binding | Ein bereits zerstörter Binding darf keine scene-langlebigen Renderer-/Lighting-/Occluder-/Listener-Consumer einer nachfolgenden World verändern. | `WorldGeometryBindingLifecycle` (Fire-Resolver, `movementBlockedResolver`, Map-Grid-Listener, `lighting.occluderIndex`) + neuer Combat-Binding-Test. **Offener Befund:** `WorldCombatGameplayBinding.setPowerUpSystem()` und `.updateEnemyManager()` haben **keinen** `destroyed`-Guard, schreiben aber auf scene-langlebige Systeme (`src/world/WorldCombatGameplayBinding.ts:227,242`). Heute unerreichbar, weil kein Aufrufer sie nach dem Detach ruft. In Phase 5 bewerten und ggf. schließen – Phase 1 ändert dafür bewusst keinen Produktionscode. |
| R-4 | Frame-Reihenfolge | Network, Input/Pointers, Host-/Client-Step, Camera-Feedback, Residency, Lighting und Renderer besitzen relevante Reihenfolgen. | Top-Level-Reihenfolge `syncRoomOwners → arenaRuntime.update → runHost/ClientFrame` ist ab Phase 1 als Reihenfolge festgeschrieben; Host-interne Phasen über `HostUpdatePhaseContracts`. Phase 8 kein blindes Reordering. |
| R-5 | World ohne Activity | LobbyWorld bzw. World ohne Activity darf keine Dummy-Coop-Presentation benötigen. | Voll abgedeckt (5.1); Checkpoint C/D bestätigt erneut. |
| R-6 | Preview | Replizierte World-Presentation darf ohne lokale Participation existieren; Input/PlayerRuntime daraus nicht ableiten. | Strukturell belegt: `resolveInputPolicy`/`resolvePlayerRuntimeFeatures` nehmen `participation`, nie ein `WorldPresentationRequirement`. |
| R-7 | Exit-Fade | Gameplay endet vor dem Fade; nur reine/frozen Presentation darf weiterleben. | `ArenaFlowCheckpointC` R-5 + `ArenaExitEntityPresentation`; aktiven Frame Binding in Phase 5 vor Handoff lösen. |
| R-8 | Meta Authority | `ArenaMetaController` darf weder `ResultApplication` noch `ArenaPersistentBaseSession` duplizieren/umschließen und Results nicht doppelt anwenden. | `ArenaMetaController.test.ts` prüft die einmalige persönliche XP-/Round-Marker-Verbuchung bei wiederholter Auswertung; `ActivityResultApplication` prüft weiterhin die unabhängige Activity-Deduplizierung. |
| R-9 | Activity Presentation | `CoopMissionScopedBinding` und `clientPresentationStep()` existieren bereits; ein paralleler Lifecycle oder Doppel-Tick wäre eine Regression. | Ab Phase 1 als Ratchet festgeschrieben: genau ein Aufruf von `clientPresentationStep(` in `src/scenes/arena/ClientUpdateCoordinator.ts`, keiner sonst unter `src/scenes/` und `src/world/`. Deklaration/Impl liegen in `src/activity/CoopMissionRuntime.ts` und sind bewusst ausgenommen. |
| R-10 | Network Boundary | Neue Runtime-/Domain-Owner dürfen das `bridge`-Singleton nicht zurückführen; die eingefrorene Legacy-Menge konkreter `NetworkBridge`-Consumer darf nicht wachsen. | Bestehenden `WorldGameplayCompositionContracts`-Ratchet respektieren; kein Nebenrefactoring der acht Legacy-Consumer. |
| R-11 | Listener-Leaks | Neue scene-langlebige Diagnostics-/Input-Owner sammeln viele Subscriptions/Keys; der heutige Hotkey-Shutdown enthält zugleich fremde Teardowns. | **Für Diagnostics (2A), Input (3A/3B) und Meta (4A) geschlossen:** `ArenaDiagnosticsController.destroy()` ist idempotent, löst alle eigenen Subscriptions und ist danach inert (`attachGpuVfx` nimmt keine Bindung mehr an); die vier `subscribeDiagnostics`-Listener, die zuvor **nie** abbestellt wurden, gehören jetzt dem Owner. Drei reine Diagnose-SHUTDOWN-Handler entfielen, der gemischte GPU-VFX-Handler wurde aufgespalten (15 → 13 Handler). `ArenaInputBindings.destroy()` ist idempotent, löst sieben eigene Hotkey-Listener und sechs eigene Keyboard-Keys; Provider und Action-Callbacks werden vom bestehenden `InputSystem` an die scene-langlebige Owner-Lifetime gebunden, ein Contract-Test bestätigt die Inertheit des Debug-Ports danach. `ArenaMetaController.destroy()` ist idempotent und macht danach Progress-/Debug-Mutationen sowie Presentation-Refreshes wirkungslos; ein Contract-Test deckt den Teardown ab. **Weiter offen:** `ArenaRuntime`, `ArenaLifecycleCoordinator`, `ArenaPersistentBaseSession`, `HostUpdateCoordinator`, `ClientUpdateCoordinator`, `RpcCoordinator` haben weiterhin **kein eigenes `destroy()`**. |

---

## 6. Letzte relevante Checks / Befunde

| Check / Quelle | Ergebnis |
|---|---|
| `npm run check` (nach Phase 4C) | grün – 338 Testdateien, 2851 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Bekannte unveränderte Vite-Font-Auflösungswarnungen für drei Chakra-/JetBrains-Dateien. |
| `ArenaScene.ts` Umfang | Phase 2A: 5685 → 5570 (−115); Phase 2B: 5570 → 4715 (−855); Phase 3A: 4715 → 4530 (−185); Phase 3B: 4530 → 4204 (−326); Phase 4A: 4204 → 3782 (−422); Phase 4B: 3782 → 3670 (−112); Phase 4C: 3670 → 3466 (−204). `ArenaDiagnosticsController.ts`: 1326 Zeilen; `ArenaInputBindings.ts`: 1000 Zeilen; `ArenaMetaController.ts`: 1046 Zeilen; `ArenaMetaPersistence.ts`: 68 Zeilen; `ArenaMetaController.test.ts`: 219 Zeilen. |
| Aus der Scene entfernt (2B) | Scene-Display-Counts, Transport-Sampling, Byte-/RTT-/Backpressure-Intervalle, Flowfield-/Rock-GPU-/VFX-Companion-Counter, Scratch-/Baseline-Zustände und die Frame-/Abschnittsmessung; `profiler`-/`ablation`-Accessoren sowie `captureSceneInspection`-/`onRecordingStart`-Ports entfallen. |
| Aus der Scene entfernt (2A) | Felder `runtimeProfiler`, `visualAttribution`, `performanceAblation`, `performanceDiagnosticsOverlay`, `netDebugOverlay` → ein Feld `diagnostics`; Imports `ArenaRuntimeProfiler`, `PerformanceAblationController`, `PerformanceDiagnosticsOverlay`, `NetDebugOverlay`, `getArenaVisualAttribution`, `getWebGLRendererType`; Methode `describePerformanceEnvironment()` |
| Toter Teardown-Pfad entfernt | Der gemischte SHUTDOWN-Handler rief `runtimeProfiler?.setGpuVfxSource(null)` erst, **nachdem** ein früher registrierter Handler `runtimeProfiler` bereits genullt hatte – schon vor der Extraktion ein No-op. Nur der wirksame Teil (`gpuVfx.setDiagnosticEventSink(null)`) blieb erhalten. |
| Aus der Scene entfernt (3B) | Alle verbliebenen `InputSystem.setup...`-Provider und der Loadout-Callback-Baum inklusive lokaler Prediction-/Failure-Auswertung; Placement-/Persistent-Base-Requests laufen über explizite Ports. Die Frame-Scene liefert nur den InputPolicy-Kontext sowie Presentation-Daten für den weiterhin orchestrierten Aim-/Renderer-Durchlauf. |
| Aus der Scene entfernt (4A) | Validierter Coop-Progress-Read-Stand, Upgrade-/Klassen-/Respec-/Tool-/Loadout-Use-Cases, Loadout-Reconciliation und persönliche Debug-Progress-Mutationen; die Persistence-Anbindung liegt im separaten `ArenaMetaPersistence`-Adapter. |
| Aus der Scene entfernt (4B) | Item-Unlock-/Unseen-/Pending-Mutationen, Equip/Unequip/Salvage, Claim-Logik, Item-Overlay-State, Reward-Präsentationsaufbau, automatische Reward-Anzeige und Lobby-Item-Button-Refresh. |
| Aus der Scene entfernt (4C) | Match-Result-Gate/-Präsentation/-Replay, persönliche Progress-/XP-/Unlock-/Reward-Verarbeitung, Import-Nachzug, Default-Coop-Map-Auswahl, persönliche Lobby-Projektion und Result-/Item-State; autoritative Result-Reads kommen über einen kleinen `resultRead`-Port. Balance-Diagnose bleibt als optionaler Presentation-Hook in der Scene. `ResultApplication` und `ArenaPersistentBaseSession` wurden nicht verschoben. |
| Source-Test-Inventar `rg` über `tests/` | 14 Dateien / 26 Assertion-Stellen lesen `src/scenes/ArenaScene.ts` als Text; keine weiteren Pfadschreibweisen oder Verzeichnis-Scans. |
| `ArenaInputBindings` | Scene-langlebiger Owner für Keyboard-Setup, alle `InputSystem`-Provider und Action-Callbacks, InputPolicy, Aim-/Cursor-/Spectator-Frame-Interface, lokale Placement-/Management-Weiterleitung und lokales Feedback; `destroy()` löst sieben Listener und sechs eigene Keys idempotent. |
| `ArenaMetaController` | Scene-langlebiger Owner für validierten Coop-Progress-Read-Stand, Loadout-Reconciliation, Level Up/Down, Category/Class/Full Respec, Klassenwahl, Inspector-Tool-Slots, Loadout-Slot-Auswahl, Upgrade-Overlay-Apply/Cancel, Item-Unlock-/Unseen-/Pending-State, Equip/Unequip/Salvage, Claim, Reward-Präsentation/-Anzeige, persönliche Debug-Progress-/Persistent-Base-Entitlements, Result-Read-Verarbeitung, persönliche Deduplizierung, Match-Result-Präsentation/-Replay, Import-Nachzug, Default-Map und Lobby-Projektion; `ArenaMetaPersistence` kapselt die bestehende Persistence-Grenze, ein `resultRead`-Port kapselt autoritative Resultdaten; `destroy()` ist idempotent und danach inert. Keine ResultApplication-, Activity-, World- oder Persistent-Base-Working-State-Verantwortung verschoben. |
| `npm run check` (nach Phase 6A.1) | grün – 339 Testdateien, 2870 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. |
| `ArenaScene.ts` Umfang (6A.1) | 3466 → 3379 Zeilen (−87). Entfallen: Methode `syncMainCamera`, Felder `lastCameraScrollX/Y`, `spectatorCameraScrollX/Y`, Imports `ACTIVE_ARENA_METRICS_PROFILE`, `advanceSpectatorCameraScroll`, `setCameraBaseScroll`. `WorldPresentationFrameBinding.ts`: 51 → ~195 Zeilen. |
| `WorldPresentationFrameBinding` | Trägt seit 6A.1 die World-Kamera-Positionierung (`syncCamera`, pro Frame zweimal) und die World-Surface-Residency (`syncSurfaceResidency`). Der Phase-5-Platzhalterport `WorldPresentationFrameConsumers` ist durch echten Inhalt ersetzt und entfernt. |
| Behobene Regression im 6A.1-Review | Ohne aktive `WorldRuntime` (zwischen zwei Instanzen, vor der ersten) lief der Kamera-Sync nach dem Umzug gar nicht mehr, während der alte Scene-Code dort jeden Frame den neutralen Stand setzte. Das Kamera-Feedback hätte am Frame-Ende auf der Basis der vergangenen World weitergerechnet. `ArenaRuntime.syncWorldCamera()` ruft in diesem Fall jetzt `resetWorldCameraBase(scene)` – dieselbe Funktion, die auch der Early-Return des Bindings nutzt, also eine Quelle. |
| Zwei Kamera-Syncs pro Frame | Bleiben unverändert: Aufruf 1 positioniert die Kamera **vor** der Simulation (das Startbild definiert das Working Set der Ladebarriere), Aufruf 2 danach auf die finale Spielerposition, beim Spectator mit `delta = 0` gegen doppelte Pan-Geschwindigkeit. Die drei `getVisibleWorldView`-Zeitpunkte (Residency vor dem Feedback, `syncArenaLoadReady` und Boot-Reveal danach) bleiben getrennt. |
| Neuer Reihenfolge-Ratchet | `ArenaFlowCheckpointC` schreibt jetzt die volle Presentation-Frame-Kette per `indexOf` fest: Kamera 1 → Residency → `inputBindings.updateFrame` → Kamera 2 → `applyCameraFeedback` → `flushBakeBudget` → `syncArenaLoadReady` → `syncBootReveal`. Diese Reihenfolge stand vorher **nur in Kommentaren**. |
| `ArenaLifecycleCoordinator.detach()` | Neue Reihenfolge: `detachPresentationFrame()` → `handoff.release(runtime.releasePresentation())` → `runtime.destroy()` → `persistentBase.useWorldRuntimes(null)`. Der Sink ist der **einzige** Ausführungsort des lokalen Teardowns; alle Pfade (Match-Exit, Lobby-Rückkehr, Fast-Reinstance, Rundenende, technischer Abbruch, Diagnose-Abbruch) laufen darüber. |
| Bewusst **nicht** in Phase 5 verschoben | `resetRenderersForWorldPresentationTeardown` läuft heute **nach** `runtime.destroy()`. Ein Vorziehen in den Frame-Binding würde die Reihenfolge gegenüber den World-Gameplay-Ownern ändern (Renderer-Reset vor deren Teardown) – das ist Phase 6A.2, nicht Phase 5. |
| Activity-Seite in Phase 5 | Keine Änderung. Verifiziert: `CoopMissionRuntime.bind({attach, detach})` wird bereits an sechs Stellen genutzt und löst scoped Bindings in umgekehrter Reihenfolge **vor** allen Activity-Child-Ownern; `clientPresentationStep()` hat weiterhin genau einen Aufrufer. Der vorhandene Vertrag reicht für Phase 7A – kein `CoopMissionPresentationBinding` und kein zweiter Client-Step vorgezogen. |
| `clientPresentationStep` | Deklaration/Impl in `src/activity/CoopMissionRuntime.ts:137,416`; genau ein Aufrufer `src/scenes/arena/ClientUpdateCoordinator.ts:317`. |
| Scene-langlebige Owner ohne `destroy()` | `ArenaRuntime`, `ArenaLifecycleCoordinator`, `ArenaPersistentBaseSession`, `HostUpdateCoordinator`, `ClientUpdateCoordinator`, `RpcCoordinator` (grep-verifiziert). |
| Diagnostics-Vorprüfung für Phase 2A | Für Diagnostics existiert **kein** Eintrag in der Test-Migrationskarte – der Bereich ist heute nicht über Source-Assertions geschützt. Die Verträge entstehen in Phase 2A neu am Owner. |

---

## 7. Konkret nächster Schritt

**Phase 6A.2 – World Lighting, Shadows und übrige World-Renderer** (Checkpoint A/B bleiben parallel für die manuelle Sichtprüfung offen).

- Die in 6A.1 bewusst zurückgestellten Blöcke aus `ArenaScene` nachziehen: `renderers.shadow.updateStaticResidency` (löst TD-6 auf), Canopy-Transparenz (zieht `renderers.lighting.resolveCanopyTint` als Callback durch), `syncWorldShadows`, `syncWorldLighting` und die übrigen World-Renderer-Consumer.
- `resetRenderersForWorldPresentationTeardown` jetzt bewerten: Es läuft heute **nach** `runtime.destroy()`. Ein Vorziehen in den Frame-Binding-Detach ändert die Reihenfolge gegenüber den World-Gameplay-Ownern (Renderer-Reset vor deren Teardown) – nur mit belegter Unbedenklichkeit verschieben.
- `applyCameraFeedback` und `resolveWorldGradeInputs` prüfen, aber nicht vorschnell mitnehmen: Beide sind mit `VisualFeedbackDirector`/PostFX verzahnt, und `resolveWorldGradeInputs` liest activity-spezifischen Zustand (Boss-Phase, Void-Map).
- Die Test-Migrationskarte weist die Einträge 1, 10, 11, 12, 14 und 18 jetzt dieser Phase zu.
- Frame-Reihenfolge nicht umsortieren – seit 6A.1 ist die volle Presentation-Kette per `indexOf` festgeschrieben (siehe Abschnitt 6); `CameraFeedbackController` verlangt ausdrücklich, dass das Feedback **vor** der Lichtberechnung läuft.
- Keinen zweiten `clientPresentationStep(`-Aufruf einführen – der Regex-Ratchet in `CoopMissionRuntimeOwnership` scannt `src/scenes` und `src/world`.
- Offener Befund ohne eigene Phase: `resolvePresentationPolicy` berechnet ein `useWorldCamera`, das nirgends konsumiert wird, während `syncCamera` dieselbe Entscheidung über `allowsWorldPresentationSurface(..., 'worldCamera')` erneut ableitet. Zwei Quellen derselben Wahrheit – in 6A.2 oder Phase 9 zusammenführen, nicht nebenbei.
- Die automatisierten Checkpoint-A-Prüfungen sind mit `npm run check` grün.
- Offen bleibt die manuelle Sichtprüfung von Diagnose an/aus, Performance-/Netzwerk-Overlay, Ablation, Semantic Events, Sampling und Shutdown-Verhalten sowie der Checkpoint-B-Umfang (Input, Persistent Base, Spectator, Options/Debug, Meta/Items/Upgrades/Results, Dateiimport/Lobby-Projektion und Ready-State).
- Phase 3A ist automatisiert abgeschlossen: Input-Setup, statische Provider, Hotkeys, sechs eigene Keys und die Ownership-getrennte Scene-Bereinigung sind verifiziert.
- Phase 3B ist automatisiert abgeschlossen: Action-/Placement-/Preview-/Feedback-Callbacks, InputPolicy sowie das kleine Spectator-/Aim-Interface liegen im Input-Owner; keine Phase-3A-Teardown- oder Hotkey-Logik wurde erneut verschoben.
- Phase 4A ist automatisiert abgeschlossen: Progress-/Upgrade-/Klassen-/Loadout-Use-Cases, Reconciliation und persönliche Debug-Mutationen liegen im Meta-Owner; Persistence bleibt Adapter und Results/PersistentBase bleiben außerhalb dieses Owners.
- Phase 4B ist automatisiert abgeschlossen: Item-Unlock-/Unseen-/Pending-State, Equip/Unequip/Salvage, Claim, Reward-Präsentation/-Anzeige und Lobby-Item-Projektion liegen im Meta-Owner.
- Phase 4C ist automatisiert abgeschlossen: persönliche Result-Verarbeitung, lokale Deduplizierung, Match-Result-Präsentation/Replay, Import-Nachzug, Default-Map und Lobby-Projektion liegen im Meta-Owner; `ResultApplication`, `ArenaPersistentBaseSession` und Exit-Fade/Lifecycle bleiben außerhalb dieses Owners.

---

## 8. Dokument-Review-Kandidaten

| ID | Konflikt | Vorschlag |
|---|---|---|
| D-2 | Die 2A-Liste im Plan nennt nur `ArenaRuntimeProfiler`, `PerformanceAblationController` und `PerformanceDiagnosticsOverlay`, spricht aber zugleich von „Diagnose-Hotkey-Zielen“. `NetDebugOverlay` ist das zweite Diagnose-Overlay (Hotkey `P`, ESC-Kaskade, Lobby-Callback) und in Architektur §4.2 als „Performance-/**Netzwerk**-Diagnose-Overlay“ ausdrücklich Teil der Diagnose-Ownership. Umgesetzt wurde die Architektur-Lesart: `NetDebugOverlay` gehört dem Controller. | Die 2A-Liste im Plan um `NetDebugOverlay` ergänzen, damit Plan und Architektur denselben Ownership-Umfang nennen. Nebenwirkung der Umsetzung: Das Overlay wird jetzt an der Position des früheren Profiler-Blocks statt später in `create()` erzeugt – verhaltensneutral, da sein Konstruktor ausschließlich `bridge`-Closures entgegennimmt und keinen Scene-Zustand liest. |
| D-1 | Phase 1 verlangt, „Listener-/Teardown-Idempotenz der späteren scene-langlebigen Owner“ abzusichern. Diese Owner (`ArenaDiagnosticsController`, `ArenaInputBindings`, `ArenaMetaController`) existieren in Phase 1 noch nicht, und die heutigen scene-langlebigen Owner besitzen gar kein `destroy()`. Der Punkt ist in Phase 1 nicht erfüllbar. | Den Punkt im Plan von Phase 1 zu einem Abnahmekriterium der Phasen 2A/3A/4A verschieben: „Jeder neue scene-langlebige Owner liefert ein idempotentes `destroy()` plus Teardown-Test.“ Phase 1 hält stattdessen nur den Ausgangsbefund fest (R-11). |
