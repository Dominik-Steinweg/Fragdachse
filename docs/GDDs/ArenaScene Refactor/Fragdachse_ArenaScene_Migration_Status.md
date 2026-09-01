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

**Aktive Phase:** `Checkpoint A – Diagnostics (manueller Gate offen; danach Phase 3A)`
**Gesamtstatus:** `🟨 Phase 2B abgeschlossen – Diagnostics-Owner besitzt Frame-Messung und Sampler; Checkpoint A wartet auf manuelle Sichtprüfung`
**Letzter verifizierter Repository-Stand:** `main` nach Phase 2B
**Automatisierter Gate für dieses Refactoring:** `npm run check` grün (336 Testdateien, 2843 Tests, 15 skipped; `tsc` + `vite build` erfolgreich)
**Manueller Gate:** `offen – visuelle Prüfung nicht ausgeführt (Browser ist opt-in); automatisierte Checkpoint-A-Verträge grün`

| Teilphase | Status | Kurznotiz |
|---|---|---|
| 1 Baseline / Contracts | ✅ abgeschlossen | 21 Source-Assertions in 13 Dateien inventarisiert; 4 Vertragslücken geschlossen. |
| 2A Diagnostics Lifecycle/UI | ✅ abgeschlossen | `ArenaDiagnosticsController` besitzt Profiler, Ablation, beide Debug-Overlays und die Attribution; `ArenaScene` −115 Zeilen. |
| 2B Diagnostics Frame/Sampler | ✅ abgeschlossen | `ArenaDiagnosticsController` besitzt Scene-/Transport-/Companion-Sampling, Counter und Frame-Messung; `ArenaScene` liefert nur benannte Messpunkte plus Read-only-Snapshot. |
| – Checkpoint A | 🟨 aktiv | Automatisierte Prüfungen grün; manuelle Sichtprüfung von Diagnose an/aus, Overlay, Ablation und Sampling noch offen. |
| 3A Input Setup/Hotkeys | ⬜ offen | Keys, Listener, Setup/Teardown an `ArenaInputBindings`. |
| 3B Input Actions/Feedback | ⬜ offen | Provider, Placement, Requests und lokales Feedback aus Scene. |
| 4A Meta Progress/Upgrades/Loadout | ⬜ offen | persönlicher Meta-Owner. |
| 4B Meta Items/Rewards | ⬜ offen | Item-/Pending-Reward-Use-Cases. |
| 4C Meta Results/Lobby | ⬜ offen | Match Results und persönliche Lobby-Projektion. |
| – Checkpoint B | ⬜ offen | Input + Meta vollständig regressionsfrei. |
| 5 Presentation-Lifetime-Fundament | ⬜ offen | Frame Binding vor Handoff lösen; bestehende Activity-Binding-/Step-Verträge wiederverwenden. |
| 6A.1 World Surface/Camera | ⬜ offen | Surface, Kamera und Residency aus Scene. |
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
Stand: 13 Dateien, 21 Assertion-Stellen. Weitere Pfadschreibweisen, Glob- oder Verzeichnis-Scans auf die Scene existieren nicht (per `rg` über `readFileSync`, `readdirSync`, `src/scenes` in `tests/` verifiziert).

Klassen: **B** = schützt echtes Verhalten (nur zufällig per Quelltext geprüft) · **R** = Architektur-/Ownership-Ratchet · **S** = schützt nur den historischen Quellort.
Beim Cutover gilt: **B** wird zum Verhaltens-Test des neuen Owners, **R** zieht als Architektur-Test zum neuen Owner um, **S** entfällt.

| # | Test | Kl. | Schützt | Heutiger Source-Ort | Ziel-Owner | Migration in Phase |
|---:|---|:--:|---|---|---|:--:|
| 1 | `ArenaExitEntityPresentation` · beendet Gameplay vor dem Fade | B | Exit-Fade startet nach Gameplay-Ende; `worldVisible`-Formel | `ArenaScene` Exit-/Sichtbarkeitsblock | `WorldPresentationFrameBinding` | 6A.1 |
| 2 | `ArenaFlowCheckpointC` · Coop-Simulation an ihrer Frame-Position (R-4) | R | Scene taktet nur die `arenaRuntime`-Fassade, nie Host-/ClientUpdate direkt; **Phase 1 ergänzt:** Reihenfolge `syncRoomOwners → update → runHost/ClientFrame` | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |
| 3 | `ArenaFlowCheckpointC` · kein Top-Level-Owner selbst getaktet | R | Persistent-Base-Owner wird nur vom Frame-Owner getaktet | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |
| 4 | `ArenaTransitionReadiness` · Host-Lobby-Sync während Exit-Fade | B | `deferArenaExit → detectPhaseChange → hostSyncLobbyWorld → detectWorldChange`; genau ein `hostSyncLobbyWorld()` | `ArenaScene.update()` | `ArenaScene` (Frame-Orchestrierung) | 8 |
| 5 | `ArenaTransitionReadiness` · Deferred-Exit-Fenster bis World-Erkennung | R | `deferArenaExit` erreicht `detectWorldChange` | `ArenaScene.update()` | `ArenaScene` (Frame-Orchestrierung) | 8 |
| 6 | `LobbyWorldContracts` · Systemcursor nur mit Zielhilfe | B | Cursor/Fadenkreuz nur bei `worldMode === 'interactive'`, nicht in Vorschau | `ArenaScene` Input-/Cursor-Block | `ArenaInputBindings` | 3B |
| 7 | `LobbyWorldContracts` · Lobby über World-Lifecycle statt Vorschau | R | Kein `MenuArenaPreview`/`LobbyAmbient`; `hostSyncLobbyWorld()` | `ArenaScene` (Abwesenheits-Ratchet) | `ArenaScene` (bleibt) | 9 |
| 8 | `LobbyWorldInteractive` · Testgelände-Entry/Exit/Optionen | B | `canEnter` nur solange Spieler nicht ready | `ArenaScene` Lobby-Overlay-Verdrahtung | `ArenaMetaController` | 4C |
| 9 | `LobbyWorldInteractive` · ESC behandelt Modals vor World-Leave | B | ESC-Reihenfolge Options → Hotkey-Block → Leave | `ArenaScene` Hotkey-Handler | `ArenaInputBindings` | 3A |
| 10 | `LobbyWorldInteractive` · Lobby-Oberfläche folgt der Presentation | B | `syncLobbySurface(presentationPolicy.showLobby)`, `inRoundWorld`-Ableitung | `ArenaScene.update()` Presentation-Block | `WorldPresentationFrameBinding` | 6A.1 |
| 11 | `LobbyWorldInteractive` · Ladescreen bis gebackener Weltausschnitt | B | Boot-Reveal an `getWorldRevealState`, nicht an `POST_RENDER` | `ArenaScene` Boot-Reveal | `ArenaScene` (Boot) + `WorldPresentationFrameBinding` | 6A.1 |
| 12 | `LobbyWorldL3` · lokale Player-Presentation nur mit Surface + Runtime | B | `playerStatusRing` an `localPlayerVisuals`, nicht an `inArena` | `ArenaScene.update()` Presentation-Block | `WorldPresentationFrameBinding` | 6A.1 |
| 13 | `LobbyWorldL3` · derselbe Client-Renderer-Consumer mit/ohne Activity | R | Activity-lose World nutzt denselben Client-Pfad (`runClientFrame` + `syncClientWorldSnapshotPresentation`) | `ArenaScene.update()` Client-Zweig | `WorldPresentationFrameBinding` (+ `ArenaRuntime`) | 6B |
| 14 | `PersistentBaseManagementAllClasses` · Rückbau unterdrückt Aim | B | `showAim` respektiert `isDismantlePlacementActive()`; Basis-Visuals folgen dem Modus | `ArenaScene` Aim-/Visuals-Block | `ArenaInputBindings` (Aim) + `WorldPresentationFrameBinding` (Visuals) | 3B / 6A.1 |
| 15 | `Phase11DependencyCutover` · Construction-RPCs am World-Owner | R | RPC ruft `getConstructionWorldRuntime()` direkt, nicht über den Flow | `ArenaScene` RPC-Verdrahtung | `ArenaScene` / `ArenaRuntime` | 9 |
| 16 | `PresentationInputPolicyContracts` · Eingabe aus der Policy | R | `resolveInputPolicy()` statt handgebauter Bedingungskette | `ArenaScene.update()` Input-Block | `ArenaInputBindings` | 3B |
| 17 | `WorldMaterializationOwnership` · Gameplay-State über seine Owner | R | Die 5 Scene-Getter delegieren an `worldRuntime.materialization/.presentation` | `ArenaScene` Getter | `ArenaScene` (dünne Delegation) | 9 |
| 18 | `WorldMetricsScopeContracts` · Basen/Basisstelle am World-Kontext | R | `persistentBaseSite` kommt aus `activeWorld`, nicht global | `ArenaScene.update()` | `WorldPresentationFrameBinding` | 6A.1 |
| 19 | `WorldMetricsScopeContracts` · Respawn-Kontext aus der aktiven World | B | Spawn-Map aus `world.descriptor.definitionId`, nicht aus Rundenstate | `ArenaScene:1054` Spawn-Provider | `ArenaRuntime`/`WorldRuntime` | 9 |
| 20 | `WorldPresentationContracts` · Darstellungsentscheidung am richtigen Ort | R | Weltkamera über `allowsWorldPresentationSurface(..., 'worldCamera')` | `ArenaScene.update()` Kamera-Block | `WorldPresentationFrameBinding` | 6A.1 |
| 21 | `WorldRuntimeOwnership` · World-Runtime hinter dem WorldLifecycle | R | Scene taktet nur `arenaRuntime.update(delta)`, nie `updateWorldRuntime` | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |

**Kein Test der Klasse S.** Jede geprüfte Formel bzw. jeder geprüfte Aufruf trägt entweder echtes Verhalten (Aufrufreihenfolge = Ausführungsreihenfolge, verhaltenssteuernde Bedingungen) oder eine bewusste Ownership-Grenze. Beim Cutover darf daher **kein** Eintrag ersatzlos gelöscht werden.

**Inventar-Nebenbefund:** `tests/ArenaRoundLifecycleContracts.test.ts` deklarierte eine ungenutzte Konstante `SCENE_PATH = 'src/scenes/ArenaScene.ts'` ohne jede Assertion. Sie wurde in Phase 1 entfernt, damit spätere Inventare kein falsches Signal erhalten; die Datei enthält keine ArenaScene-Assertion.

---

## 4. Transitional Debt

| ID | Seit Phase | Temporärer Pfad / Debt | Source of Truth | Entfernen bis |
|---|---:|---|---|---:|
| – | – | Keine offenen Phase-2B-Transitional-Debts. | `ArenaDiagnosticsController` | – |

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
| Teardown-Idempotenz scene-langlebiger Owner | ⛔ nicht testbar | Die betroffenen Owner existieren noch nicht (siehe R-11 und Review-Kandidat D-1) |
| Frame-Binding fällt vor Handoff | ⛔ nicht testbar | `WorldPresentationFrameBinding` existiert nicht (0 Treffer in `src/`); Vertrag entsteht erst in Phase 5 |

### 5.2 Risikoregister

| ID | Bereich | Risiko / Vertrag | Schutz |
|---|---|---|---|
| R-1 | Source-Tests | Zahlreiche Tests prüfen konkrete Strings in `ArenaScene.ts`; sie dürfen die alte Ownership nicht konservieren. | **Inventarisiert** (Abschnitt 3, 21 Einträge). Beim Cutover jeder Teilphase die dort gelisteten Einträge zum neuen Owner mitnehmen, nicht löschen. |
| R-2 | World Handoff | `WorldPresentationBinding` darf beim Handoff keine Gameplay-/Physics-Referenzen tragen; der aktive Frame-Binding darf nicht erst nach dem Release fallen. | Ist-Reihenfolge verifiziert: `ArenaLifecycleCoordinator.detach()` ruft heute `worldPresentationHandoff.release(runtime.releasePresentation())` **vor** `runtime.destroy()`. Ein nur über `WorldRuntime.bind(...)` registrierter Frame-Binding fiele damit zu spät – genau der von Architektur §4.5 beschriebene Fall. Phase 5 muss den Detach explizit vorziehen. |
| R-3 | Stale World Binding | Ein bereits zerstörter Binding darf keine scene-langlebigen Renderer-/Lighting-/Occluder-/Listener-Consumer einer nachfolgenden World verändern. | `WorldGeometryBindingLifecycle` (Fire-Resolver, `movementBlockedResolver`, Map-Grid-Listener, `lighting.occluderIndex`) + neuer Combat-Binding-Test. **Offener Befund:** `WorldCombatGameplayBinding.setPowerUpSystem()` und `.updateEnemyManager()` haben **keinen** `destroyed`-Guard, schreiben aber auf scene-langlebige Systeme (`src/world/WorldCombatGameplayBinding.ts:227,242`). Heute unerreichbar, weil kein Aufrufer sie nach dem Detach ruft. In Phase 5 bewerten und ggf. schließen – Phase 1 ändert dafür bewusst keinen Produktionscode. |
| R-4 | Frame-Reihenfolge | Network, Input/Pointers, Host-/Client-Step, Camera-Feedback, Residency, Lighting und Renderer besitzen relevante Reihenfolgen. | Top-Level-Reihenfolge `syncRoomOwners → arenaRuntime.update → runHost/ClientFrame` ist ab Phase 1 als Reihenfolge festgeschrieben; Host-interne Phasen über `HostUpdatePhaseContracts`. Phase 8 kein blindes Reordering. |
| R-5 | World ohne Activity | LobbyWorld bzw. World ohne Activity darf keine Dummy-Coop-Presentation benötigen. | Voll abgedeckt (5.1); Checkpoint C/D bestätigt erneut. |
| R-6 | Preview | Replizierte World-Presentation darf ohne lokale Participation existieren; Input/PlayerRuntime daraus nicht ableiten. | Strukturell belegt: `resolveInputPolicy`/`resolvePlayerRuntimeFeatures` nehmen `participation`, nie ein `WorldPresentationRequirement`. |
| R-7 | Exit-Fade | Gameplay endet vor dem Fade; nur reine/frozen Presentation darf weiterleben. | `ArenaFlowCheckpointC` R-5 + `ArenaExitEntityPresentation`; aktiven Frame Binding in Phase 5 vor Handoff lösen. |
| R-8 | Meta Authority | `ArenaMetaController` darf weder `ResultApplication` noch `ArenaPersistentBaseSession` duplizieren/umschließen und Results nicht doppelt anwenden. | Deduplication heute behavioral abgesichert; Phase 4C muss die Dedup-Assertion beim Owner-Wechsel mitnehmen. |
| R-9 | Activity Presentation | `CoopMissionScopedBinding` und `clientPresentationStep()` existieren bereits; ein paralleler Lifecycle oder Doppel-Tick wäre eine Regression. | Ab Phase 1 als Ratchet festgeschrieben: genau ein Aufruf von `clientPresentationStep(` in `src/scenes/arena/ClientUpdateCoordinator.ts`, keiner sonst unter `src/scenes/` und `src/world/`. Deklaration/Impl liegen in `src/activity/CoopMissionRuntime.ts` und sind bewusst ausgenommen. |
| R-10 | Network Boundary | Neue Runtime-/Domain-Owner dürfen das `bridge`-Singleton nicht zurückführen; die eingefrorene Legacy-Menge konkreter `NetworkBridge`-Consumer darf nicht wachsen. | Bestehenden `WorldGameplayCompositionContracts`-Ratchet respektieren; kein Nebenrefactoring der acht Legacy-Consumer. |
| R-11 | Listener-Leaks | Neue scene-langlebige Diagnostics-/Input-Owner sammeln viele Subscriptions/Keys; der heutige Hotkey-Shutdown enthält zugleich fremde Teardowns. | **Für Diagnostics geschlossen (2A):** `ArenaDiagnosticsController.destroy()` ist idempotent, löst alle eigenen Subscriptions und ist danach inert (`attachGpuVfx` nimmt keine Bindung mehr an); die vier `subscribeDiagnostics`-Listener, die zuvor **nie** abbestellt wurden, gehören jetzt dem Owner. Drei reine Diagnose-SHUTDOWN-Handler entfielen, der gemischte GPU-VFX-Handler wurde aufgespalten (15 → 13 Handler). **Weiter offen:** `ArenaRuntime`, `ArenaLifecycleCoordinator`, `ArenaPersistentBaseSession`, `HostUpdateCoordinator`, `ClientUpdateCoordinator`, `RpcCoordinator` haben weiterhin **kein eigenes `destroy()`**. Phase 3A/4A müssen ihren Owner ebenfalls mit idempotentem `destroy()` **und** Teardown-Test liefern. |

---

## 6. Letzte relevante Checks / Befunde

| Check / Quelle | Ergebnis |
|---|---|
| `npm run check` (nach Phase 2B) | grün – 336 Testdateien, 2843 Tests, 15 skipped; `tsc` und `vite build` erfolgreich |
| `ArenaScene.ts` Umfang | Phase 2A: 5685 → 5570 (−115); Phase 2B: 5570 → 4715 (−855). `ArenaDiagnosticsController.ts`: 331 → 1326 Zeilen; `ArenaDiagnosticsController.test.ts`: 155 → 169 Zeilen. |
| Aus der Scene entfernt (2B) | Scene-Display-Counts, Transport-Sampling, Byte-/RTT-/Backpressure-Intervalle, Flowfield-/Rock-GPU-/VFX-Companion-Counter, Scratch-/Baseline-Zustände und die Frame-/Abschnittsmessung; `profiler`-/`ablation`-Accessoren sowie `captureSceneInspection`-/`onRecordingStart`-Ports entfallen. |
| Aus der Scene entfernt (2A) | Felder `runtimeProfiler`, `visualAttribution`, `performanceAblation`, `performanceDiagnosticsOverlay`, `netDebugOverlay` → ein Feld `diagnostics`; Imports `ArenaRuntimeProfiler`, `PerformanceAblationController`, `PerformanceDiagnosticsOverlay`, `NetDebugOverlay`, `getArenaVisualAttribution`, `getWebGLRendererType`; Methode `describePerformanceEnvironment()` |
| Toter Teardown-Pfad entfernt | Der gemischte SHUTDOWN-Handler rief `runtimeProfiler?.setGpuVfxSource(null)` erst, **nachdem** ein früher registrierter Handler `runtimeProfiler` bereits genullt hatte – schon vor der Extraktion ein No-op. Nur der wirksame Teil (`gpuVfx.setDiagnosticEventSink(null)`) blieb erhalten. |
| Source-Test-Inventar `rg` über `tests/` | 13 Dateien / 21 Assertion-Stellen lesen `src/scenes/ArenaScene.ts` als Text; keine weiteren Pfadschreibweisen oder Verzeichnis-Scans. |
| `WorldPresentationFrameBinding` | Existiert weder in `src/` noch in `tests/`. Phase 5 führt ihn erstmals ein; kein bestehender Test darf als Beleg für diesen Vertrag umgedeutet werden. |
| `ArenaLifecycleCoordinator.detach()` | Ist-Reihenfolge: `handoff.release(runtime.releasePresentation())` → `runtime.destroy()` → `persistentBase.useWorldRuntimes(null)`. Deckt sich mit Architektur §4.5 und begründet den Phase-5-Auftrag. |
| `clientPresentationStep` | Deklaration/Impl in `src/activity/CoopMissionRuntime.ts:137,416`; genau ein Aufrufer `src/scenes/arena/ClientUpdateCoordinator.ts:317`. |
| Scene-langlebige Owner ohne `destroy()` | `ArenaRuntime`, `ArenaLifecycleCoordinator`, `ArenaPersistentBaseSession`, `HostUpdateCoordinator`, `ClientUpdateCoordinator`, `RpcCoordinator` (grep-verifiziert). |
| Diagnostics-Vorprüfung für Phase 2A | Für Diagnostics existiert **kein** Eintrag in der Test-Migrationskarte – der Bereich ist heute nicht über Source-Assertions geschützt. Die Verträge entstehen in Phase 2A neu am Owner. |

---

## 7. Konkret nächster Schritt

**Checkpoint A manuell abschließen, danach Phase 3A – `ArenaInputBindings`: Setup, Hotkeys und Teardown.**

- Die automatisierten Checkpoint-A-Prüfungen sind mit `npm run check` grün.
- Offen bleibt die manuelle Sichtprüfung von Diagnose an/aus, Performance-/Netzwerk-Overlay, Ablation, Semantic Events, Sampling und Shutdown-Verhalten.
- Phase 3A erst nach diesem Gate beginnen; dabei die Ownership-/Teardown-Verträge aus Architektur und Plan erneut prüfen.

---

## 8. Dokument-Review-Kandidaten

| ID | Konflikt | Vorschlag |
|---|---|---|
| D-2 | Die 2A-Liste im Plan nennt nur `ArenaRuntimeProfiler`, `PerformanceAblationController` und `PerformanceDiagnosticsOverlay`, spricht aber zugleich von „Diagnose-Hotkey-Zielen“. `NetDebugOverlay` ist das zweite Diagnose-Overlay (Hotkey `P`, ESC-Kaskade, Lobby-Callback) und in Architektur §4.2 als „Performance-/**Netzwerk**-Diagnose-Overlay“ ausdrücklich Teil der Diagnose-Ownership. Umgesetzt wurde die Architektur-Lesart: `NetDebugOverlay` gehört dem Controller. | Die 2A-Liste im Plan um `NetDebugOverlay` ergänzen, damit Plan und Architektur denselben Ownership-Umfang nennen. Nebenwirkung der Umsetzung: Das Overlay wird jetzt an der Position des früheren Profiler-Blocks statt später in `create()` erzeugt – verhaltensneutral, da sein Konstruktor ausschließlich `bridge`-Closures entgegennimmt und keinen Scene-Zustand liest. |
| D-1 | Phase 1 verlangt, „Listener-/Teardown-Idempotenz der späteren scene-langlebigen Owner“ abzusichern. Diese Owner (`ArenaDiagnosticsController`, `ArenaInputBindings`, `ArenaMetaController`) existieren in Phase 1 noch nicht, und die heutigen scene-langlebigen Owner besitzen gar kein `destroy()`. Der Punkt ist in Phase 1 nicht erfüllbar. | Den Punkt im Plan von Phase 1 zu einem Abnahmekriterium der Phasen 2A/3A/4A verschieben: „Jeder neue scene-langlebige Owner liefert ein idempotentes `destroy()` plus Teardown-Test.“ Phase 1 hält stattdessen nur den Ausgangsbefund fest (R-11). |
