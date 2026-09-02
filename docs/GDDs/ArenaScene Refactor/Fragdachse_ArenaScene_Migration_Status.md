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

**Aktive Phase:** `Finaler manueller Gate – Checkpoint A/B/C/D`
**Gesamtstatus:** `✅ Phase 9 abgeschlossen – Legacy-/Compatibility-Cleanup und finaler Architektur-Gate grün; Checkpoint A/B/C/D warten weiterhin auf manuelle Sichtprüfung`
**Letzter verifizierter Repository-Stand:** `main` nach Phase 9
**Automatisierter Gate für dieses Refactoring:** `npm run check` grün (341 Testdateien, 2879 Tests, 15 skipped; `tsc` + `vite build` erfolgreich)
**Manueller Gate:** `offen – visuelle Prüfung nicht ausgeführt (Browser ist opt-in); automatisierte Checkpoint-A/B/C/D- und Phase-3A–8-Verträge grün. World ohne Activity, Preview, Handoff und Activity-A→B-Rebinding bleiben sichtprüfungsrelevant.`

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
| 6A.1 World Surface/Camera | ✅ abgeschlossen | `syncMainCamera` (beide Frame-Positionen) und World-Surface-Residency liegen im `WorldPresentationFrameBinding`; TD-5 aufgelöst. Shadow-Residency, Canopy, World Grade und Camera-Feedback waren bewusst zurückgestellt. |
| 6A.2 World Lighting/Renderer | ✅ abgeschlossen | `WorldPresentationFrameBinding` besitzt Shadow-Residency/Readiness, Canopy, lokale Player-/Persistent-Base-Visuals sowie World-Shadows/-Lighting inklusive Zug-/Projektillichter; Handoff-Reihenfolge unverändert. |
| 6B Client World Projection | ✅ abgeschlossen | Generische replizierte World-Projektion liegt im `WorldPresentationFrameBinding`; Activity-/Coop-spezifische Projektion bleibt für Phase 7; kein zweiter `clientPresentationStep()`. |
| – Checkpoint C | 🟨 aktiv | Automatisierte Verträge grün; manuelle Prüfung von World ohne Activity, Preview und Handoff bleibt offen. |
| 7A.1 Coop HUD/Announcements | ✅ abgeschlossen | `CoopMissionPresentationBinding` bindet Map-Event-Announcements, Encounter-/Main-Objective-/Secondary-HUD, Lebensstatus und Tutorial über Activity-/Read-/UI-Ports; Detach setzt die bisherigen Activity-HUD-Zustände zurück und macht den Binding inert. |
| 7A.2 Coop World-space Presentation | ✅ abgeschlossen | `CoopMissionPresentationBinding` besitzt zusätzlich Encounter-Telegraph, Secondary-Objective-, Mission-/Checkpoint-, Carry-, Repair-/Reward- und Hostile-Base-Projektion; scene-langlebige Renderer bleiben hinter dem UI-Port, Activity-Detach setzt sämtliche World-space-Zustände zurück. |
| 7B Coop Client/Lifecycle Cutover | ✅ abgeschlossen | Clientseitige Enemy-Snapshot-/Interpolation-/Vulnerability-Projektion sowie replizierte Coop-Carry-Visuals laufen über `CoopMissionPresentationBinding` am bestehenden kanonischen Activity-Step; Capture-the-Beer bleibt separat, ohne zweiten Activity-Step. |
| – Checkpoint D | 🟨 aktiv | Activity A→B, Host/Client, kein Presentation-Leak; automatisierte Verträge grün, manuelle Sichtprüfung offen. |
| 8 Scene Frame Cutover | ✅ abgeschlossen | `ArenaScene.update()` zeigt nur noch benannte Frame-/Runtime-/Presentation-Schritte; fachliche Blöcke liegen in kleinen Scene-Orchestrierungsmethoden. |
| 9 Cleanup / Final Gate | ✅ abgeschlossen | Compatibility-Fassaden und ungenutzte Scene-Annahmen entfernt; finale Source-Ratchets und `npm run check` grün. |

Statuswerte: `⬜ offen` · `🟨 aktiv` · `🟧 blockiert` · `✅ abgeschlossen`

---

## 3. Test-Migrationskarte

Vollständiges Inventar aller Tests, die `src/scenes/ArenaScene.ts` als **Text** lesen und darauf asserten.
Stand: 15 Dateien / 29 Assertion-Stellen; die Phase-6B-Ratchetts prüfen zusätzlich den neuen `ArenaRuntime`-/`WorldPresentationFrameBinding`-Pfad und Phase 8 den Top-Level-Frame-Cutover. Weitere Pfadschreibweisen, Glob- oder Verzeichnis-Scans auf die Scene existieren nicht (per `rg` über `readFileSync`, `readdirSync`, `src/scenes` in `tests/` verifiziert).

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
| 13 | `LobbyWorldL3` · derselbe Client-Renderer-Consumer mit/ohne Activity | R | Activity-lose World nutzt denselben Client-Pfad (`runClientFrame` + `WorldPresentationFrameBinding`) | `ArenaScene.update()` / `runArenaWorldWithoutActivityFrame()` | `WorldPresentationFrameBinding` (+ `ArenaRuntime`) | 6B |
| 14 | `PersistentBaseManagementAllClasses` · Rückbau unterdrückt Aim | B | `showAim` respektiert `isDismantlePlacementActive()`; Basis-Visuals folgen dem Modus | `ArenaScene` Aim-/Visuals-Block | `ArenaInputBindings` (Aim) + `WorldPresentationFrameBinding` (Visuals) | 3B / 6A.2 |
| 15 | `Phase11DependencyCutover` · Construction-RPCs am World-Owner | R | RPC ruft `getConstructionWorldRuntime()` direkt, nicht über den Flow | `ArenaScene` RPC-Verdrahtung | `ArenaScene` / `ArenaRuntime` | 9 |
| 16 | `PresentationInputPolicyContracts` · Eingabe aus der Policy | R | `resolveInputPolicy()` statt handgebauter Bedingungskette | `ArenaScene.update()` Input-Block | `ArenaInputBindings` | 3B |
| 17 | `WorldMaterializationOwnership` · Gameplay-State über seine Owner | R | World-/Materialization-State wird an den Verwendungsstellen direkt vom kanonischen Owner gelesen; keine Scene-Kompatibilitätsgetter | `ArenaScene` World-/Materialization-Zugriffe | `ArenaRuntime` / `WorldRuntime` | 9 |
| 18 | `WorldMetricsScopeContracts` · Basen/Basisstelle am World-Kontext | R | `persistentBaseSite` kommt aus `activeWorld`, nicht global | `ArenaScene.update()` | `WorldPresentationFrameBinding` | 6A.2 |
| 19 | `WorldMetricsScopeContracts` · Respawn-Kontext aus der aktiven World | B | Spawn-Map aus `world.descriptor.definitionId`, nicht aus Rundenstate | `ArenaScene:1054` Spawn-Provider | `ArenaRuntime`/`WorldRuntime` | 9 |
| 20 | `WorldPresentationContracts` · Darstellungsentscheidung am richtigen Ort | R | Weltkamera über `allowsWorldPresentationSurface(..., 'worldCamera')` | **migriert (6A.1)**: prüft jetzt `WorldPresentationFrameBinding` | `WorldPresentationFrameBinding` | ✅ 
| 21 | `WorldRuntimeOwnership` · World-Runtime hinter dem WorldLifecycle | R | Scene taktet nur `arenaRuntime.update(delta)`, nie `updateWorldRuntime` | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |
| 22 | `ArenaMetaController` · Meta-Ownership und Teardown | R | Progress-/Upgrade-/Loadout-Mutationen liegen im scene-langlebigen Owner; Persistence bleibt Adapter; `destroy()` ist idempotent und danach inert | `ArenaScene` + `ArenaMetaController` | `ArenaMetaController` | 4A |
| 23 | `ArenaSceneFrameCutover` · keine langen fachlichen Update-Blöcke | R | `ArenaScene.update()` zeigt die grobe Frame-Reihenfolge; benannte Scene-Schritte kapseln Lobby-, Rollen-, World-ohne-Activity-, Effekt- und Aim-Orchestrierung | `ArenaScene.update()` | `ArenaScene` (bleibt) | 8 |

**Korrektur der Phasenprognose (Stand nach 6A.1).** Die Phase-1-Karte hatte die Einträge 1, 10, 11, 12, 14 und 18 ebenfalls für 6A.1 vorgesehen. Der reale 6A.1-Schnitt fiel bewusst enger aus (nur Kamera + Surface-Residency), weil alle übrigen Kandidaten `renderers.shadow`/`renderers.lighting` berühren oder activity-gegatet sind. Diese Einträge sind auf **6A.2** umdatiert; zu diesem damaligen Stand war nur Eintrag 20 tatsächlich migriert.

**Ergebnis 6A.2.** Die World-Display-Anteile von Eintrag 12 (lokale Player-Presentation), Eintrag 14 (Persistent-Base-Visuals) und Eintrag 18 (World-Kontext der Basisstelle) liegen jetzt im `WorldPresentationFrameBinding`; zusätzlich sind Shadow-Residency/Readiness, Canopy und die allgemeinen World-Lichtquellen dorthin verschoben. Einträge 1, 10 und 11 behalten ihre äußere Exit-/Lobby-/Boot-Orchestrierung in Scene bzw. Lifecycle; ihre World-Display-/Readiness-Anteile verwenden weiterhin den gemeinsamen World-Presentation-Pfad. Diese Aufteilung ist keine Vorwegnahme von Phase 8, sondern hält Policy- und Lifecycle-Ownership getrennt.

**Ergebnis 6B.** Die generische replizierte Client-Projektion (World-/Player-/PowerUp-/Construction-/Persistent-Base-nahe World-Visuals) wird jetzt über `ArenaRuntime` an das aktive `WorldPresentationFrameBinding` delegiert und läuft damit auch für eine World ohne Activity. Der Scene-Adapter behält ausschließlich Capture-the-Beer- und Coop-Defense-Carry-Projektion bis Phase 7; `ClientUpdateCoordinator.clientPresentationStep()` bleibt der einzige Activity-Client-Step.

**Ergebnis 7A.1.** `CoopMissionPresentationBinding` ist als konkreter `CoopMissionScopedBinding` über `ArenaLifecycleCoordinator` etabliert. Map-Event-Announcements, Encounter-/Main-Objective-/Secondary-HUD, Lebensstatus und Tutorial werden über kleine Activity-Read-/UI-Ports synchronisiert; Base-/Boss-Fortschritt wird an der Arena-Adaptergrenze als Read-Model geliefert. Der Binding besitzt keine Simulation, importiert kein `bridge` und setzt beim Detach die scene-langlebigen UI-Infrastruktur-Objekte vollständig auf neutral zurück.

**Ergebnis 7A.2.** Der bestehende `CoopMissionPresentationBinding` besitzt jetzt den vollständigen lokalen Coop-Missionspfad: Encounter-Telegraph, Secondary-Objective-Marker, Mission-/Checkpoint-Marker, Carry-Zonen, Repair-/Reward-Drohnen und Hostile-Base-Indikator werden aus Activity-Read-Models über benannte World-space-UI-Ports synchronisiert. Carry-Präsentationsdaten bleiben an der Composition-Grenze role-aware (Host-Runtime vs. replizierter Client-Snapshot); kein `bridge`-Import gelangt in den Activity-Binding. Die scene-langlebigen Phaser-Objekte bleiben Infrastruktur, werden aber bei Activity-Detach vor dem Child-Teardown neutralisiert; nach Destroy ist der Binding inert. `ArenaScene.update()` kennt diese Coop-Rendererliste nicht mehr, und Phase 7B/der kanonische `clientPresentationStep()` wurde nicht vorgezogen.

**Ergebnis 7B.** Die verbleibende Coop-Client-Projektion hängt jetzt vollständig an der Activity-Lifetime: `CoopMissionPresentationBinding` übernimmt über den bestehenden `CoopMissionScopedBinding`-Pfad die replizierten Enemy-Snapshots, Client-Interpolation, Vulnerability-Visuals und Coop-Carry-Visuals. Der bestehende `CoopMissionActivityStep.clientPresentationStep()` erhält dafür einen kleinen immutable Frame-Input und bleibt über `ClientUpdateCoordinator` der einzige Aufrufort; die Scene synchronisiert dort nur noch die separate Capture-the-Beer-Projektion. Activity-Detach leert Carry-/Enemy-Präsentation vor dem Child-Teardown, A→B erhält einen frischen Cache/Binding, und World ohne Activity benötigt weiterhin keinen Dummy-Owner.

**Ergebnis 8.** `ArenaScene.update()` enthält jetzt den groben Ablauf aus Network, Phase-/World-/Participation-Orchestrierung, ArenaRuntime, Input, World-ohne-Activity-/Rollen-Frame, World-Presentation, scene-globalen Effekten und Frame-Abschluss. Die fachlich längeren Lobby-, Rollen-/HUD-, World-ohne-Activity-, Effekt-, strategischen Ziel- und Aim-/Placement-Blöcke liegen in kleinen benannten Scene-Orchestrierungsmethoden; `ArenaFrameSignals` transportiert ausschließlich immutable Zustandswerte und keine Owner-/Service-Referenzen. Die bestehende Camera-/Residency-/Input-/Runtime-/Readiness-Reihenfolge bleibt ratchetiert, der Activity-Client-Step wird weiterhin nicht aus der Scene dupliziert, und kein Phase-9-Compatibility-Cleanup wurde vorgezogen.

**Ergebnis 9.** Die verbliebenen World-/Activity-Kompatibilitätsgetter und der nicht mehr verwendete `CoopDefenseProgressSnapshot`-Import wurden aus `ArenaScene` entfernt. Die Scene liest World-, Materialization-, Gameplay- und Activity-State jetzt an den jeweiligen kanonischen Runtime-Ownern; Spawn-/Metrik-Source-Tests und Ownership-Ratchets wurden auf diese tatsächlichen Pfade aktualisiert. Die finalen Architektur-Ratchets schützen weiterhin die Network-Consumer-Grenze, die World-/Activity-Binding-Lifetime, den einmaligen Activity-Client-Step, die Gameplay-/Physics-Freiheit des World-Presentation-Bindings und das Ausbleiben eines God-Composers. Verhalten, Authority und Lifetime-Grenzen wurden nicht verändert.

**Kein Test der Klasse S.** Jede geprüfte Formel bzw. jeder geprüfte Aufruf trägt entweder echtes Verhalten (Aufrufreihenfolge = Ausführungsreihenfolge, verhaltenssteuernde Bedingungen) oder eine bewusste Ownership-Grenze. Beim Cutover darf daher **kein** Eintrag ersatzlos gelöscht werden.

**Inventar-Nebenbefund:** `tests/ArenaRoundLifecycleContracts.test.ts` deklarierte eine ungenutzte Konstante `SCENE_PATH = 'src/scenes/ArenaScene.ts'` ohne jede Assertion. Sie wurde in Phase 1 entfernt, damit spätere Inventare kein falsches Signal erhalten; die Datei enthält keine ArenaScene-Assertion.

---

## 4. Transitional Debt

**TD-6 aufgelöst in Phase 6A.2.** `getVisibleWorldView(this.cameras.main)` wird an der Residency-Stelle einmal im `WorldPresentationFrameBinding` berechnet und für Surface-Residency sowie Shadow-Residency verwendet. Es gibt dort keinen zweiten Scene-Aufruf mehr.

**Phase 9 abgeschlossen.** Keine ausschließlich für die Migration verbliebenen World-/Activity-Kompatibilitätsfassaden oder ungenutzten Scene-Imports/Felder wurden im verifizierten Phase-9-Scope zurückgelassen. Die weiterhin dokumentierten offenen Punkte sind bewusste Ownership-/Teardown-Entscheidungen außerhalb dieser Phase.

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
| Stale World-Binding inert | ✅ voll für Geometry + Combat + World-Presentation-Consumer *(Phase 1 ergänzt)* | `WorldGeometryBindingLifecycle`; `ActivityRebindingContracts` für `WorldCombatGameplayBinding`; `WorldPresentationFrameLifetime` für den World-Client-Consumer |
| Genau ein Activity-Client-Presentation-Step | ✅ voll *(Phase 1 ergänzt)* | Neuer Ratchet in `CoopMissionRuntimeOwnership`, spiegelbildlich zum Host-Pendant in `HostUpdatePhaseContracts` |
| Teardown-Idempotenz scene-langlebiger Owner | ✅ für neue Refactoring-Owner | `ArenaDiagnosticsController`, `ArenaInputBindings` und `ArenaMetaController` liefern idempotentes `destroy()` mit Tests; die übrigen bestehenden Owner bleiben außerhalb dieser Phasen unverändert. |
| Frame-Binding fällt vor Handoff | ✅ voll *(Phase 5)* | `WorldPresentationFrameLifetime`: Reihenfolge `FrameBinding.destroy → handoff.release → runtime.destroy` als beobachtetes Aufrufprotokoll, plus Sicherheitsnetz-, Idempotenz-, Stale- und End-zu-Ende-Tests über `WorldLifecycle` |

### 5.2 Risikoregister

| ID | Bereich | Risiko / Vertrag | Schutz |
|---|---|---|---|
| R-1 | Source-Tests | Zahlreiche Tests prüfen konkrete Strings in `ArenaScene.ts`; sie dürfen die alte Ownership nicht konservieren. | **Inventarisiert** (Abschnitt 3, 23 Einträge). Beim Cutover jeder Teilphase die dort gelisteten Einträge zum neuen Owner mitnehmen, nicht löschen. |
| R-2 | World Handoff | `WorldPresentationBinding` darf beim Handoff keine Gameplay-/Physics-Referenzen tragen; der aktive Frame-Binding darf nicht erst nach dem Release fallen. | **Geschlossen (Phase 5).** `WorldRuntime` führt den Frame-Binding in einem **eigenen** Slot, nicht in `worldScopedBindings` (deren Teardown liefe erst in `destroy()` und damit zu spät – genau der von Architektur §4.5 beschriebene Fall). `ArenaLifecycleCoordinator.detach()` ruft jetzt `runtime.detachPresentationFrame()` **vor** `worldPresentationHandoff.release(runtime.releasePresentation())`; `WorldRuntime.destroy()` wiederholt den Detach als idempotentes Sicherheitsnetz zuerst. Alle Teardown-Pfade laufen über diesen einen Sink. |
| R-3 | Stale World Binding | Ein bereits zerstörter Binding darf keine scene-langlebigen Renderer-/Lighting-/Occluder-/Listener-Consumer einer nachfolgenden World verändern. | `WorldGeometryBindingLifecycle` (Fire-Resolver, `movementBlockedResolver`, Map-Grid-Listener, `lighting.occluderIndex`), Combat-Binding-Test und `WorldPresentationFrameLifetime`; der World-Client-Consumer-Test bestätigt die Inertheit nach `destroy()`. Der owner-sichere `LightingSystem.clearDynamicOccluderSource()` verhindert, dass ein alter World-Teardown die Occluderquelle der nächsten World entfernt. **Weiter offen:** `WorldCombatGameplayBinding.setPowerUpSystem()` und `.updateEnemyManager()` haben keinen `destroyed`-Guard; heute unerreichbar, weil kein Aufrufer sie nach dem Detach ruft. |
| R-4 | Frame-Reihenfolge | Network, Input/Pointers, Host-/Client-Step, Camera-Feedback, Residency, Lighting und Renderer besitzen relevante Reihenfolgen. | Top-Level-Reihenfolge `syncRoomOwners → arenaRuntime.update → runHost/ClientFrame` ist ab Phase 1 als Reihenfolge festgeschrieben; die Presentation-Kette hält `Camera 1 → Surface+Shadow-Residency → Input → Camera 2 → Camera-Feedback → Shadows → Lighting`; im Client-Zweig folgt die generische World-Projektion nach `runClientFrame`, ohne den kanonischen Activity-Step zu duplizieren. Host-interne Phasen über `HostUpdatePhaseContracts`. Phase 8 kein blindes Reordering. |
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
| Source-Test-Inventar `rg` über `tests/` | 15 Dateien / 29 Assertion-Stellen lesen `src/scenes/ArenaScene.ts` als Text; keine weiteren Pfadschreibweisen oder Verzeichnis-Scans. |
| `ArenaInputBindings` | Scene-langlebiger Owner für Keyboard-Setup, alle `InputSystem`-Provider und Action-Callbacks, InputPolicy, Aim-/Cursor-/Spectator-Frame-Interface, lokale Placement-/Management-Weiterleitung und lokales Feedback; `destroy()` löst sieben Listener und sechs eigene Keys idempotent. |
| `ArenaMetaController` | Scene-langlebiger Owner für validierten Coop-Progress-Read-Stand, Loadout-Reconciliation, Level Up/Down, Category/Class/Full Respec, Klassenwahl, Inspector-Tool-Slots, Loadout-Slot-Auswahl, Upgrade-Overlay-Apply/Cancel, Item-Unlock-/Unseen-/Pending-State, Equip/Unequip/Salvage, Claim, Reward-Präsentation/-Anzeige, persönliche Debug-Progress-/Persistent-Base-Entitlements, Result-Read-Verarbeitung, persönliche Deduplizierung, Match-Result-Präsentation/-Replay, Import-Nachzug, Default-Map und Lobby-Projektion; `ArenaMetaPersistence` kapselt die bestehende Persistence-Grenze, ein `resultRead`-Port kapselt autoritative Resultdaten; `destroy()` ist idempotent und danach inert. Keine ResultApplication-, Activity-, World- oder Persistent-Base-Working-State-Verantwortung verschoben. |
| `npm run check` (nach Phase 6A.1) | grün – 339 Testdateien, 2870 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. |
| `npm run check` (nach Phase 6A.2) | grün – 339 Testdateien, 2870 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Die drei bekannten Vite-Font-Auflösungswarnungen bleiben unverändert. |
| `npm run check` (nach Phase 6B) | grün – 339 Testdateien, 2872 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Die drei bekannten Vite-Font-Auflösungswarnungen bleiben unverändert. |
| `npm run check` (nach Phase 7A.1) | grün – 340 Testdateien, 2874 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Die drei bekannten Vite-Font-Auflösungswarnungen bleiben unverändert. |
| `npm run check` (nach Phase 7A.2) | grün – 340 Testdateien, 2874 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Die drei bekannten Vite-Font-Auflösungswarnungen bleiben unverändert. |
| `npm run check` (nach Phase 7B) | grün – 340 Testdateien, 2875 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Die drei bekannten Vite-Font-Auflösungswarnungen bleiben unverändert. |
| `npm run check` (nach Phase 8) | grün – 341 Testdateien, 2878 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Die drei bekannten Vite-Font-Auflösungswarnungen bleiben unverändert. |
| `npm run check` (nach Phase 9) | grün – 341 Testdateien, 2879 Tests, 15 skipped; `tsc` und `vite build` erfolgreich. Die drei bekannten Vite-Font-Auflösungswarnungen bleiben unverändert. |
| `ArenaScene.ts` Umfang | Phase 2A: 5685 → 5570 (−115); Phase 2B: 5570 → 4715 (−855); Phase 3A: 4715 → 4530 (−185); Phase 3B: 4530 → 4204 (−326); Phase 4A: 4204 → 3782 (−422); Phase 4B: 3782 → 3670 (−112); Phase 4C: 3670 → 3466 (−204); Phase 6A.1: 3466 → 3379 (−87); Phase 6A.2: 3379 → 3061 (−318); Phase 6B: 3061 → 3031 (−30); Phase 7A.1: 3031 → 2952 (−79); Phase 7A.2: 2952 → 2950 (−2); Phase 7B: 2950 → 2953 (+3); Phase 8: 2953 → 3129 (+176); Phase 9: 3129 → 3118 (−11). `ArenaScene.update()` umfasst 254 Zeilen und enthält keine langen fachlichen Update-Blöcke mehr; `WorldPresentationFrameBinding.ts`: 51 → 195 (6A.1) → 541 (6A.2) → 653 (6B); `CoopMissionPresentationBinding.ts`: 211 (7A.1) → 267 (7A.2) → 311 (7B). |
| `WorldPresentationFrameBinding` | Trägt die World-Kamera-Positionierung (pro Frame zweimal), Surface- und Shadow-Residency/Readiness, Canopy-Transparenz, lokale Player-/Persistent-Base-Visuals, die generische replizierte Client-World-Projektion sowie allgemeine World-Shadows und -Lighting inklusive Zug-/Projektillichtern. Der Binding erzeugt und räumt seine World-spezifische Zug-Occluderquelle owner-sicher auf. |
| Behobene Regression im 6A.1-Review | Ohne aktive `WorldRuntime` (zwischen zwei Instanzen, vor der ersten) lief der Kamera-Sync nach dem Umzug gar nicht mehr, während der alte Scene-Code dort jeden Frame den neutralen Stand setzte. Das Kamera-Feedback hätte am Frame-Ende auf der Basis der vergangenen World weitergerechnet. `ArenaRuntime.syncWorldCamera()` ruft in diesem Fall jetzt `resetWorldCameraBase(scene)` – dieselbe Funktion, die auch der Early-Return des Bindings nutzt, also eine Quelle. |
| Zwei Kamera-Syncs pro Frame | Bleiben unverändert: Aufruf 1 positioniert die Kamera **vor** der Simulation (das Startbild definiert das Working Set der Ladebarriere), Aufruf 2 danach auf die finale Spielerposition, beim Spectator mit `delta = 0` gegen doppelte Pan-Geschwindigkeit. `getVisibleWorldView` wird für die Residency einmal im Frame-Binding berechnet; `syncArenaLoadReady` und Boot-Reveal erhalten ihre späteren, getrennten Readiness-Views. |
| Neuer Reihenfolge-Ratchet | `ArenaFlowCheckpointC` schreibt die volle Presentation-Frame-Kette per `indexOf` fest: Kamera 1 → Surface+Shadow-Residency → `inputBindings.updateFrame` → Kamera 2 → `applyCameraFeedback` → Shadows → Lighting → `flushBakeBudget` → `syncArenaLoadReady` → `syncBootReveal`. Diese Reihenfolge stand vorher **nur in Kommentaren**. |
| `ArenaLifecycleCoordinator.detach()` | Neue Reihenfolge: `detachPresentationFrame()` → `handoff.release(runtime.releasePresentation())` → `runtime.destroy()` → `persistentBase.useWorldRuntimes(null)`. Der Sink ist der **einzige** Ausführungsort des lokalen Teardowns; alle Pfade (Match-Exit, Lobby-Rückkehr, Fast-Reinstance, Rundenende, technischer Abbruch, Diagnose-Abbruch) laufen darüber. |
| Bewusst **nicht** in Phase 6A.2 verschoben | `resetRenderersForWorldPresentationTeardown` läuft heute **nach** `runtime.destroy()`. Ein Vorziehen in den Frame-Binding würde die Reihenfolge gegenüber den World-Gameplay-Ownern ändern (Renderer-Reset vor deren Teardown); diese Ownership-/Teardown-Entscheidung bleibt für eine spätere, separat belegte Phase zurückgestellt. |
| Activity-Seite in Phase 5 | Der vorhandene Vertrag wurde in 7A.1 wiederverwendet: `CoopMissionRuntime.bind({attach, detach})` löst scoped Bindings in umgekehrter Reihenfolge **vor** allen Activity-Child-Ownern; `CoopMissionPresentationBinding` ist der konkrete HUD-/Announcement-Consumer. `clientPresentationStep()` hat weiterhin genau einen Aufrufer; kein zweiter Activity-Presentation-Lifecycle und kein zweiter Client-Step entstanden. |
| `clientPresentationStep` | Deklaration/Impl in `src/activity/CoopMissionRuntime.ts:151,432`; genau ein Aufrufer `src/scenes/arena/ClientUpdateCoordinator.ts:696`, der den immutable Client-Frame an die aktive Activity weiterreicht. |
| Scene-langlebige Owner ohne `destroy()` | `ArenaRuntime`, `ArenaLifecycleCoordinator`, `ArenaPersistentBaseSession`, `HostUpdateCoordinator`, `ClientUpdateCoordinator`, `RpcCoordinator` (grep-verifiziert). |
| Diagnostics-Vorprüfung für Phase 2A | Für Diagnostics existiert **kein** Eintrag in der Test-Migrationskarte – der Bereich ist heute nicht über Source-Assertions geschützt. Die Verträge entstehen in Phase 2A neu am Owner. |

---

## 7. Konkret nächster Schritt

**Finaler manueller Gate – Checkpoint A/B/C/D.** Die automatisierte Migration einschließlich Phase 9 ist abgeschlossen.

- Manuell prüfen: Coop create/update/destroy, Host/Client, Activity A→B, Carry-/Enemy-Projektion, World ohne Activity, Preview, Handoff und keine stale HUD-/Announcement-/World-Consumer-Effekte nach Detach.
- Browserprüfung wurde gemäß Opt-in-Regel nicht gestartet.
- `applyCameraFeedback`, `resolveWorldGradeInputs`, `resetRenderersForWorldPresentationTeardown` und das ungenutzte `useWorldCamera` bleiben als bewusste Ownership-/Teardown-Prüfpunkte außerhalb des abgeschlossenen Phase-9-Cleanup-Scope dokumentiert.

---

## 8. Dokument-Review-Kandidaten

| ID | Konflikt | Vorschlag |
|---|---|---|
| D-2 | Die 2A-Liste im Plan nennt nur `ArenaRuntimeProfiler`, `PerformanceAblationController` und `PerformanceDiagnosticsOverlay`, spricht aber zugleich von „Diagnose-Hotkey-Zielen“. `NetDebugOverlay` ist das zweite Diagnose-Overlay (Hotkey `P`, ESC-Kaskade, Lobby-Callback) und in Architektur §4.2 als „Performance-/**Netzwerk**-Diagnose-Overlay“ ausdrücklich Teil der Diagnose-Ownership. Umgesetzt wurde die Architektur-Lesart: `NetDebugOverlay` gehört dem Controller. | Die 2A-Liste im Plan um `NetDebugOverlay` ergänzen, damit Plan und Architektur denselben Ownership-Umfang nennen. Nebenwirkung der Umsetzung: Das Overlay wird jetzt an der Position des früheren Profiler-Blocks statt später in `create()` erzeugt – verhaltensneutral, da sein Konstruktor ausschließlich `bridge`-Closures entgegennimmt und keinen Scene-Zustand liest. |
| D-1 | Phase 1 verlangt, „Listener-/Teardown-Idempotenz der späteren scene-langlebigen Owner“ abzusichern. Diese Owner (`ArenaDiagnosticsController`, `ArenaInputBindings`, `ArenaMetaController`) existieren in Phase 1 noch nicht, und die heutigen scene-langlebigen Owner besitzen gar kein `destroy()`. Der Punkt ist in Phase 1 nicht erfüllbar. | Den Punkt im Plan von Phase 1 zu einem Abnahmekriterium der Phasen 2A/3A/4A verschieben: „Jeder neue scene-langlebige Owner liefert ein idempotentes `destroy()` plus Teardown-Test.“ Phase 1 hält stattdessen nur den Ausgangsbefund fest (R-11). |
