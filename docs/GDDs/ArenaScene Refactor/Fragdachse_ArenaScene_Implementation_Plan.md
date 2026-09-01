# Fragdachse – ArenaScene Refactoring: Implementierungsplan

**Status:** Verbindlicher Migrationsplan  
**Repository-Basis:** `Dominik-Steinweg/Fragdachse`, Branch `main`, Commit `39677c149ff44ebb8c3071b6bb18fede4bbb8013`  
**Architekturvorgabe:** `Fragdachse_ArenaScene_Architecture.md`  
**Laufendes Protokoll:** `Fragdachse_ArenaScene_Migration_Status.md`

> **Jede nummerierte Teilphase (`2A`, `2B`, `6A.1`, …) ist als einzelner Coding-KI-Auftrag geschnitten.**

## 1. Arbeitsweise für Coding-KIs

Vor jeder Teilphase:

1. `Fragdachse_ArenaScene_Architecture.md` lesen.
2. Nur die aktuelle Teilphase dieses Plans als Implementierungsauftrag behandeln.
3. `Fragdachse_ArenaScene_Migration_Status.md` lesen und offene Debt/Risiken berücksichtigen.
4. `AGENTS.md`, `docs/ai/architecture-principles.md` und nur die für die Phase relevanten Fachseiten lesen.
5. Mit `rg` die realen Symbole, Aufrufer und Tests verifizieren; Pfade/Klassennamen dieses Plans nicht blind voraussetzen.
6. Vor einer Extraktion klären: **Owner, Lifetime, Authority, Source of Truth, Teardown, Frame-Position.**
7. Bestehende Owner-/Lifecycle-/Frame-Verträge zuerst prüfen und wiederverwenden; keinen parallelen Vertrag nur für einen sauber wirkenden Cutover einführen.
8. Die eingefrorene Legacy-Menge konkreter `NetworkBridge`-Consumer nicht als Nebenauftrag dieses Refactorings umbauen oder erweitern.

Nach jeder Teilphase:

1. passende gezielte Tests ausführen;
2. bei mehreren Modulen/Lifecycle-/Presentation-Eingriffen `npm run check` ausführen;
3. Transitional Debt und Risiken im Status aktualisieren;
4. konkret nächsten Schritt eintragen;
5. Architektur-/Plan-Abweichungen nur unter **Dokument-Review-Kandidaten** notieren;
6. Architektur- und Plan-Dokument **nicht automatisch ändern**.

Browser-/Sichtprüfungen führt der User manuell aus. Coding-KIs starten ohne ausdrückliche Aufforderung keinen Dev-Server, Browser oder Screenshot-Workflow.

### Stop/Go-Regel

Eine neue Klasse oder Abstraktion wird nur gebaut, wenn sie einen realen Owner oder Vertrag trägt. Wenn ein bestehender Owner nach der Analyse bereits die Zielverantwortung sauber übernehmen kann, wird er bevorzugt erweitert/reduziert statt mit einem Wrapper umgeben.

### Migrationsprinzip

Temporäre Compatibility ist erlaubt, wenn:

- neue Source of Truth eindeutig ist;
- alter Zugriff nur gerichtet auf den neuen Owner delegiert;
- Entfernung einer späteren Teilphase zugeordnet und im Status dokumentiert wird.

Keine parallelen gleichwertigen State-Repräsentationen und keine großen Adapter nur für einen künstlich sauberen Zwischenstand.

---

## 2. Prüfstrategie

### Nach jeder Teilphase

Mindestens:

- TypeScript-/Build-Check gemäß `AGENTS.md`;
- relevante bestehende Tests;
- neue Contract-Tests für neue Ownership-/Teardown-Semantik;
- keine neue zweite mutable Wahrheit;
- keine unbeabsichtigte Änderung an Host-/Client-Authority oder Wire-Verträgen;
- kein zerstörter world-/activity-scoped Binding verändert später erneut scene-langlebige Consumer;
- kein bereits vorhandener Activity-/Client-Presentation-Step wird parallel ein zweites Mal eingeführt.

### Checkpoint A – nach Phase 2B (Diagnostics)

Prüft:

- Diagnose an/aus;
- Performance-Overlay und Ablation;
- Semantic Events aus ArenaRuntime/Flow;
- Scene-/Transport-/Flowfield-/Rock-/VFX-Sampling;
- kein Gameplay-Verhalten hängt vom Diagnosezustand ab;
- Shutdown löst alle Diagnose-Subscriptions.

### Checkpoint B – nach Phase 4C (Input + Meta)

Prüft zusätzlich:

- normale Waffen-/Utility-/Ultimate-Eingabe Host und Client;
- Inspector-Radialmenü, Placement, Dismantle, Repositioning und Persistent-Base-Rewards;
- Spectator-Kamera;
- Options-/Escape-/Debug-Hotkeys;
- Upgrades, Respec, Klassenwahl, Loadout;
- Items: Equip/Unequip/Salvage/Pending Reward;
- Match-Result-Anwendung und Replay;
- Dateiimport-/Lobby-Projektion;
- Ready-State wird durch Meta-/Lobby-Aktionen weiterhin korrekt zurückgesetzt;
- `ArenaScene` importiert keine persönliche Persistence-API mehr direkt.

### Checkpoint C – nach Phase 6B (World-Presentation)

Prüft zusätzlich:

- LobbyWorld ohne Activity;
- Preview ohne Participation;
- Interactive World;
- World create/detach/reattach;
- Kamera, Shadows, Lighting, Canopy;
- Persistent-Base-Visuals;
- Host- und Client-World-Projektion;
- `WorldPresentationBinding` bleibt gameplay-frei;
- `WorldPresentationFrameBinding` wird **vor** `WorldPresentationHandoff.release(...)` gelöst;
- die Reihenfolge `FrameBinding.destroy → Presentation release → Runtime destroy` ist abgesichert;
- stale Aufrufe auf zerstörte World-Bindings verändern keine Shared-Consumer einer nachfolgenden World;
- Exit-Fade kann keine WorldRuntime-Referenz aus dem Handoff erreichen.

### Checkpoint D – nach Phase 7B (Coop-Presentation)

Prüft zusätzlich:

- Coop create/update/destroy;
- Activity A → B in derselben World;
- Map-/Encounter-Announcements;
- Haupt-/Nebenziele, Mission Progress, Carry/Repair/Reward-Marker;
- Boss-/Hostile-Base-/Tutorial-Präsentation;
- Host- und Client-Projektion;
- keine Coop-Presentation bleibt nach Activity-Detach aktiv;
- vorhandener `CoopMissionScopedBinding`-/`clientPresentationStep`-Pfad wird wiederverwendet und nicht parallel dupliziert;
- World ohne Activity zeigt keine Coop-Flächen;
- `ArenaScene` kennt keine konkrete Coop-Presentation-Systemliste mehr.

### Finaler Gate – nach Phase 9

- `npm run check`;
- relevante Architecture-/Source-Ratchet-Tests;
- Multiplayer Host/Client;
- LobbyWorld und World ohne Activity;
- Matchstart/Countdown;
- Activity-Wechsel;
- Persistent Base;
- Spectator;
- Matchende/Exit-Fade/Lobby-Rückkehr;
- Meta/Items/Upgrades/Resultate;
- Diagnostics;
- Teardown-/Listener-Leaks.

---

# 3. Implementierungsphasen

## Phase 1 – Baseline, Contracts und Test-Migrationskarte

### Ziel

Vor strukturellen Änderungen die Verhaltens- und Reihenfolgeverträge sichern und die heute an `ArenaScene.ts` gekoppelten Source-Tests klassifizieren.

### Umsetzen

- alle Tests suchen, die `src/scenes/ArenaScene.ts` als Text lesen;
- im Status eine kompakte Test-Migrationskarte führen mit mindestens: `Test | schützt | heutiger Source-Ort | Ziel-Owner | Migration in Phase`;
- pro Test festhalten, ob er:
  - echtes Verhalten schützt;
  - einen Architektur-Ratchet schützt;
  - nur historischen Quellort schützt;
- kritische Verhaltensverträge bei Bedarf auf behavior-/owner-nahe Tests verstärken;
- insbesondere absichern:
  - World ohne Activity;
  - Preview vs. Interactive;
  - InputPolicy/Capabilities;
  - Host-/Client-Frame-Position;
  - Exit-Presentation vor World-Ende;
  - WorldPresentation-Handoff;
  - LobbyWorld-Readiness;
  - Meta-Resultat wird nicht doppelt angewendet;
  - Listener-/Teardown-Idempotenz der späteren scene-langlebigen Owner;
  - `WorldPresentationFrameBinding` fällt vor dem Presentation-Handoff;
  - zerstörte World-Bindings dürfen keine scene-langlebigen Shared-Consumer einer nachfolgenden World verändern;
  - Activity-Presentation wird nicht über einen zweiten parallelen Client-Step getaktet.

### Nicht tun

- noch keine große Extraktion;
- keine Source-Tests nur deshalb löschen, weil sie unbequem werden;
- keinen künstlichen Test für jede private Methode erzeugen.

### Endzustand

Es existiert ein belastbares Sicherheitsnetz und im Status eine kompakte Liste der Source-Tests, die beim späteren Cutover zum neuen Owner umziehen müssen.

---

## Phase 2A – Diagnostics-Owner: Lifecycle und UI

### Ziel

Den klarsten risikoarmen Block zuerst aus der Scene lösen.

### Umsetzen

Einen scene-langlebigen Diagnose-Owner einführen, bevorzugt `ArenaDiagnosticsController` oder einen gleichwertig klaren Namen.

Aus `ArenaScene` verschieben:

- Ownership/Erzeugung von `ArenaRuntimeProfiler`;
- `PerformanceAblationController`;
- `PerformanceDiagnosticsOverlay`;
- Diagnose-Subscriptions;
- Diagnose-Hotkey-Ziele;
- Environment-/Renderer-Beschreibung;
- eigener Shutdown/Destroy.

Die bestehende Runtime-Semantic-Event-Sink-Anbindung wird auf einen kleinen Diagnose-Port gerichtet.

### Nicht tun

- noch nicht sämtliche Frame-Timer und Companion-Counter verschieben;
- keine generische Telemetrieplattform;
- keine Gameplay-Systeme in den Diagnose-Owner ziehen.

### Endzustand

`ArenaScene` besitzt die Diagnoseobjekte nicht mehr einzeln und kennt nur noch den Diagnose-Owner bzw. kleine Diagnose-Aufrufe.

---

## Phase 2B – Diagnostics-Owner: Frame-Messung und Sampler

### Ziel

Die umfangreiche Performance-Messlogik und ihre Counter vollständig aus `ArenaScene` entfernen.

### Umsetzen

Verschieben:

- Scene-Display-Object-Counts;
- Transport-Performance-Sampling;
- Byte-/RTT-/Backpressure-Intervalle;
- Flowfield-Companion-Counter;
- Rock-GPU-Companion-Counter;
- VFX-Companion-Counter;
- zugehörige Scratch-/Baseline-Zustände;
- Frame-/Abschnittsmessung aus `update()`.

Der Scene-Frame verwendet danach nur kleine Diagnoseaufrufe, z. B. `beginFrame`, benannte Messpunkte und `endFrame` – ohne Diagnose-Details zu kennen.

Vorhandene `setPerformanceMetricsEnabled`-Subscriptions bleiben beim Diagnose-Owner.

### Nicht tun

- Frame-Reihenfolge verändern;
- Messung als Voraussetzung für Gameplay machen;
- unnötige Allokationen im normalen Diagnose-aus-Pfad einführen.

### Endzustand

Keine großen Performance-Counter-/Sampler-Blöcke mehr in `ArenaScene`.

**Danach: Checkpoint A.**

---

## Phase 3A – `ArenaInputBindings`: Setup, Hotkeys und Teardown

### Ziel

Die lokale Eingabe-Verdrahtung als scene-langlebigen Owner etablieren.

### Umsetzen

`ArenaInputBindings` oder äquivalent einführen und dorthin verschieben:

- Spectator-WASD-Key-Ownership;
- Arena-Panel-/Debug-Key-Ownership;
- Escape/Options/Net-/Performance-/Time-of-Day-/Weapon-Lab-Hotkey-Handler;
- Registrierung und symmetrischer Teardown;
- statische `InputSystem.setup...`-Provider, soweit sie keine umfangreiche Action-Logik enthalten;
- Debug-Hotkeys als Aufrufe kleiner Ports zu Diagnostics/Debug-UI.

Der heutige Shutdown-Pfad rund um die Hotkey-Registrierung ist gemischt: Er räumt neben Keys/Listenern auch Lobby-, Persistent-Base-, Objective-, HUD- und andere Presentation-Objekte ab. Beim Extrahieren wird dieser Block **nach Ownership getrennt**. `ArenaInputBindings` übernimmt nur eigenen Input-/Listener-/Key-Teardown; fremde Teardowns bleiben bei ihrem bisherigen Owner bzw. werden erst in der dafür vorgesehenen Phase migriert.

### Verträge

- Owner ist scene-langlebig;
- InputSystem bleibt vorhandene scene-langlebige Infrastruktur;
- keine Host-Authority wird lokal dupliziert;
- Hotkey-Blockierung durch Options/Text-Inputs bleibt identisch.

### Nicht tun

- noch nicht alle Placement-/Action-Callbacks in einem Big-Bang verschieben;
- kein neues Event-Bus-System;
- keinen gemischten Scene-Shutdown-Block vollständig in `ArenaInputBindings` verschieben.

### Endzustand

Keys und Listener besitzen einen eindeutigen Owner und verschwinden nicht mehr als verstreute Felder aus der Scene.

---

## Phase 3B – `ArenaInputBindings`: Actions, Previews und lokales Feedback

### Ziel

Den großen `InputSystem`-Callback-Baum und lokales Action-Feedback aus `ArenaScene` lösen.

### Umsetzen

Verschieben:

- Utility-/Construction-/Ultimate-Placement-Provider;
- Radial-Action-Provider;
- Dismantle/Reposition/Persistent-Reward-Provider;
- Scope-Start-Prüfung;
- lokale Cooldown-/Adrenalin-/Rage-/Failure-Rückmeldung;
- lokale Action-Request-Auswertung;
- Spectator-Pan-Eingabe bzw. dessen kleines Frame-Interface.

Dependencies als kleine Ports einspeisen:

- Capabilities/InputPolicy;
- World-Pointer;
- Client-Loadout-/Resource-Reads;
- Construction-/Persistent-Base-Requests;
- UI-/Audio-Feedback;
- Diagnostics-/Debug-Ziele.

`InputSystem` darf seine bestehende konkrete `NetworkBridge`-Constructor-Injection behalten. Diese eingefrorene Legacy-Grenze wird weder durch `ArenaInputBindings` erweitert noch in dieser Phase auf Ports umgebaut; der neue Binding-Owner selbst bevorzugt kleine Ports/Callbacks.

### Nicht tun

- keine Hostvalidierung lokal nachbauen;
- keine Gameplay-Regeln aus Construction/Persistent Base in den Input-Owner kopieren;
- nicht den gesamten `ArenaRuntime` oder die gesamte `ArenaScene` einspeisen.

### Endzustand

`ArenaScene` konfiguriert den Input-Owner, besitzt aber keine große Liste aus `inputSystem.setup...` und Action-Callbacks mehr.

---

## Phase 4A – `ArenaMetaController`: Progression, Upgrades und Loadout

### Ziel

Persönliche, world-/activity-unabhängige Meta-Use-Cases aus der Scene lösen.

### Umsetzen

`ArenaMetaController` als **scene-langlebigen** Use-Case-Owner etablieren. Persistierte Daten und room-langlebige Persistent-Base-Zustände besitzen ausdrücklich andere Owner.

Verschieben:

- gespeicherten/validierten Coop-Progress-Read-Stand;
- `refreshStoredCoopDefenseProgress` und Loadout-Reconciliation;
- Level Up/Down;
- Category/Class/Full Respec;
- Klassenwahl;
- Tool-Slots;
- Loadout-Slot-Auswahl;
- Upgrade-Overlay Apply/Cancel;
- persönliche Debug-Progress-Mutationen über klaren Debug-Port.

Persistence bleibt Adapter/Source of Truth außerhalb des Controllers.

### Nicht tun

- kein neues Save-Format;
- Activity-/World-State in den Meta-Owner ziehen;
- `ResultApplication` ersetzen, umschließen oder dessen Deduplication/Completion-Anwendung duplizieren;
- `ArenaPersistentBaseSession`-Verantwortung für Working-State, Grants oder Management-Anfragen in Meta ziehen.

### Endzustand

Persönliche Progressions-/Upgrade-/Loadout-Regeln und Cache-Felder liegen nicht mehr in `ArenaScene`.

---

## Phase 4B – `ArenaMetaController`: Items und Pending Rewards

### Ziel

Item-/Reward-Use-Cases demselben persönlichen Meta-Scope zuordnen.

### Umsetzen

Verschieben:

- Items-Unlock-/Unseen-/Pending-State;
- Item-Overlay-State;
- Equip/Unequip/Salvage;
- Claim eines Pending Rewards;
- Aufbau der Reward-Präsentation;
- automatische Anzeige des Rewards der gerade abgeschlossenen Runde;
- Refresh des Lobby-Item-Buttons.

Overlays bleiben Presentation-Infrastruktur; ihre Use-Case-Callbacks zeigen auf den Meta-Owner.

### Endzustand

`ArenaScene` enthält keine Item-Persistence-Mutationen mehr.

---

## Phase 4C – `ArenaMetaController`: Match Results und Lobby-Projektion

### Ziel

Die verbleibenden persönlichen Meta-/Lobby-Abläufe aus `ArenaScene` lösen.

### Umsetzen

Verschieben, soweit sie persönliche Meta-Use-Cases sind:

- lokale Match-Result-Präsentation;
- Progress-Delta/Reward-Verarbeitung auf Basis autoritativer Resultdaten;
- `lastMatchResultsPresentation` und Replay;
- `matchResultsPending` und zugehörige lokale Result-Gates;
- Dateiimport-Nachzug;
- Default-Coop-Map-Auswahl aus persönlicher Freischaltung;
- Lobby-Projektion persönlicher Progressions-/Item-Daten;
- Ready-Reset nach Meta-Änderungen.

Klar trennen:

- `ArenaRuntime`/Flow entscheidet Activity-Abschluss; bestehende `ResultApplication` bleibt Owner für Deduplication und Anwendung des Abschlusses;
- `ArenaPersistentBaseSession` bleibt room-langlebiger Owner für Persistent-Base-Working-State, Grants und Management-Anfragen;
- `ArenaMetaController` verarbeitet nur den persönlichen persistenten/lokalen Use-Case bzw. die Lobby-/UI-Projektion danach.

### Nicht tun

- Exit-Fade-/World-Handoff-Lifecycle in Meta ziehen;
- Round-State selbst interpretieren, wenn bereits ein kanonisches Result-Read-Model existiert;
- zweite Reward-/XP-Authority erzeugen.

### Endzustand

`ArenaScene` importiert keine `localPreferences`-/Item-Progression-Mutations-API mehr direkt und besitzt keinen persönlichen Progress-/Item-/Result-State mehr.

**Danach: Checkpoint B.**

---

## Phase 5 – Presentation-Lifetime-Fundament

### Ziel

Vor dem Verschieben großer Renderblöcke die richtigen Lifetimes, Teardown-Reihenfolgen und vorhandenen Presentation-Verträge festziehen.

### Umsetzen

#### World

Einen `WorldPresentationFrameBinding` oder gleichwertigen world-scoped Owner einführen.

Vertrag:

- gehört der aktiven `WorldRuntime`;
- besitzt aktive Renderer-/World-Read-Bindings;
- wird **vor** der Freigabe der handoffbaren `WorldPresentationBinding` vollständig gelöst;
- wird **nicht** in `WorldPresentationHandoff` freigegeben;
- die bestehende `WorldPresentationBinding` bleibt reine handoffbare Fläche;
- nach `destroy()` ist der Frame-Binding vollständig inert und darf keine scene-langlebigen Shared-Consumer mehr verändern.

Die reale bestehende Reihenfolge ist zu berücksichtigen: Der Flow ruft heute `runtime.releasePresentation()` vor `runtime.destroy()`. Ein lediglich über den gewöhnlichen `WorldRuntime.bind(...)`-Teardown registrierter Frame-Binding würde deshalb zu spät fallen, solange dessen Destroy erst in `WorldRuntime.destroy()` läuft.

Die Implementation muss daher explizit die Reihenfolge sichern:

```text
WorldPresentationFrameBinding.destroy
→ WorldPresentationHandoff.release(runtime.releasePresentation())
→ runtime.destroy()
```

Der konkrete Mechanismus bleibt klein und darf z. B. ein dedizierter Slot oder ein expliziter Detach-Schritt sein. Kein zweiter allgemeiner World-Lifecycle nur für Presentation.

Der Frame-Binding-Owner kann über `WorldRuntime`/`ArenaRuntime` einen kleinen Presentation-Step anbieten, damit die Scene die grobe Frame-Position bestimmt, ohne konkrete World-Systeme zu kennen.

#### Activity

Vor einer neuen Activity-Presentation-Abstraktion die vorhandenen Verträge verwenden:

- `CoopMissionScopedBinding` bindet langlebigere Consumer an genau eine Coop-Activity und detached sie vor deren Child-Teardown;
- `CoopMissionActivityStep.clientPresentationStep()` ist bereits der kanonische Client-Presentation-Schritt der Mission;
- `ClientUpdateCoordinator` ruft diesen Schritt bereits im Client-Frame auf.

`CoopMissionPresentationBinding` wird deshalb bevorzugt als konkreter `CoopMissionScopedBinding` bzw. über den bestehenden Activity-Step angebunden. Es entsteht **kein paralleler Activity-Presentation-Lifecycle und kein zweiter Client-Presentation-Step**.

Nur wenn der bestehende Vertrag nach realer Codeanalyse nicht ausreicht, darf er minimal erweitert werden. Keine Registry und keine generische Plugin-Infrastruktur.

### Tests

- World Frame Binding fällt vor `WorldPresentationHandoff.release(...)`;
- Reihenfolge `FrameBinding.destroy → Presentation release → Runtime destroy` ist als Verhalten abgesichert;
- stale Aufruf auf zerstörtem World Frame Binding verändert keine Renderer-/Lighting-/Occluder-/Listener-Consumer einer nachfolgenden World;
- reine `WorldPresentationBinding` enthält weiterhin keine Gameplay-/Physics-Referenzen;
- Activity Presentation fällt mit Activity A und wird für B frisch erzeugt;
- Activity-Presentation verwendet den vorhandenen `CoopMissionScopedBinding`-/Activity-Step-Pfad ohne Doppel-Tick;
- World ohne Activity benötigt keinen Dummy-Binding.

### Endzustand

Die Lifetime-Grenzen sind vorhanden, bevor große Rendering-Logik verschoben wird.

---

## Phase 6A.1 – World Surface, Kamera und Residency

### Ziel

Den ersten klaren activity-unabhängigen Presentation-Block aus `ArenaScene` an den world-scoped Presentation-Owner geben, ohne Lighting-/Renderer-Interleaving gleichzeitig umzubauen.

### Vor Beginn

Den heutigen `update()`-Block in **world-scoped**, **activity-scoped** und **echt scene-global** klassifizieren. Nur eindeutig world-scoped Logik verschieben. Bestehende Reihenfolgetests für Kamera, unerschütterte Pointerkoordinaten, Residency, Loading/Readiness und Exit-Fade lesen.

### Umsetzen

Typische Kandidaten:

- World-Surface-/Canopy-Sync;
- Main-Camera-World-Bindung und worldbezogene Kameraableitungen;
- Surface-/Chunk-Residency rund um die sichtbare World;
- worldbezogene Player-/Persistent-Base-Flächen, soweit sie unmittelbar an Surface/Kamera hängen und activity-unabhängig sind;
- World Grade Inputs, soweit sie aus World-/Player-Presentation entstehen und noch keinen Lighting-/FX-Cutover erzwingen.

### Verträge

- Gameplay-/Pointer-Rechnung verwendet weiterhin die unerschütterte Kamerageometrie;
- Camera-Feedback bleibt an seiner bisherigen relativen Frame-Position;
- Loading/Boot-Reveal und `syncArenaLoadReady` beobachten weiterhin den vollständig vorbereiteten sichtbaren World-Zustand;
- Preview ohne Participation bleibt sichtbar, ohne Input/PlayerRuntime zu erzeugen.

### Nicht tun

- Shadows/Lighting/Light-Occluder in derselben Teilphase migrieren;
- Coop-Ziele/Encounter/Boss-UI mitnehmen;
- Activity-spezifische Enemy-Projektion als „World“ deklarieren;
- Handoff-Fläche mit Runtime-Closures anreichern.

### Endzustand

World Surface, Kamera und Residency hängen am world-scoped Presentation-Owner; `ArenaScene` kennt dafür keine langen world-spezifischen Sync-Blöcke mehr.

---

## Phase 6A.2 – World Lighting, Shadows und übrige World-Renderer

### Ziel

Die verbleibende activity-unabhängige World-Darstellung an denselben world-scoped Owner geben, nachdem Surface/Kamera bereits stabil migriert sind.

### Umsetzen

Typische Kandidaten:

- World Shadows;
- World Lighting und Light-Occluder-Bindung;
- Train-/Projectile-Lights, soweit sie World-Darstellung und nicht Activity-Regel sind;
- world-scoped Persistent-Base-Visuals;
- worldbezogene Player-/PowerUp-/Construction-Präsentation;
- übrige activity-unabhängige Renderer-Synchronisation.

Scene-langlebige Renderer-/GPU-Systeme selbst dürfen scene-langlebig bleiben. Der neue Owner verwaltet nur ihre World-Bindung und ihren world-spezifischen Zustand.

### Verträge

- zerstörter World-Presentation-Binding ist inert; stale Calls dürfen insbesondere Lighting-/Occluder-State einer nachfolgenden World nicht zurücksetzen;
- Static-Residency, Camera-Feedback, Shadows und Lighting behalten die verifizierte relative Reihenfolge;
- der aktive Presentation-Binding fällt weiterhin vor dem Handoff.

### Nicht tun

- Coop-Ziele/Encounter/Boss-/Objective-Presentation mitnehmen;
- scene-langlebige Renderer nur wegen Ownership-Ästhetik neu erzeugen;
- die eingefrorene `NetworkBridge`-Legacy-Grenze als Nebenrefactoring anfassen.

### Endzustand

Eine World ohne Activity besitzt ihre vollständige allgemeine Darstellung, ohne dass `ArenaScene` die einzelnen World-Renderer synchronisieren muss.

---

## Phase 6B – Clientseitige World-Projektion verschieben

### Ziel

Die world-spezifischen Teile von `syncClientWorldSnapshotPresentation(...)` dem World-Presentation-Owner zuordnen.

### Umsetzen

Die Methode anhand Ownership aufteilen:

- generische World-/Player-/Projectile-/PowerUp-/Construction-/Persistent-Base-Projektion → World Presentation;
- Coop-/Mission-/Enemy-/Objective-spezifische Projektion → **noch nicht verschieben**, sondern für Phase 7 markieren.

Preview muss weiterhin replizierte World-Darstellung ohne PlayerRuntime/Input zeigen können.

Bestehende `ClientUpdateCoordinator`-Aufgaben nicht duplizieren: Wo er bereits kanonischer Client-Projection-Owner ist, verwendet der Presentation-Binding dessen Read-/Step-Vertrag statt Logik zu kopieren.

### Endzustand

Client-World-Projektion liegt nicht mehr als großer Scene-Helper vor; World ohne Activity und Preview bleiben funktionsfähig.

**Danach: Checkpoint C.**

---

## Phase 7A.1 – `CoopMissionPresentationBinding`: HUD und Announcements

### Ziel

Die screen-/HUD-seitige Coop-Missionsdarstellung als ersten, klar abgegrenzten activity-scoped Block aus `ArenaScene` lösen.

### Umsetzen

Konkreten `CoopMissionPresentationBinding` über die in Phase 5 festgelegte bestehende Activity-Bindung etablieren und zunächst verschieben:

- Map-Event-Announcements;
- Encounter-Presentation im HUD;
- Main Objective ViewModel/HUD;
- Secondary Objective HUD;
- Coop-Tutorial-HUD/-Projektion, soweit sie nicht an World-Space-Occlusion gekoppelt ist;
- Boss-/Hostile-Base-Statusanteile, soweit sie reine HUD-/ViewModel-Darstellung sind.

Der Binding-Owner erhält kleine Ports für replizierte Presentation-States, `CoopMissionRuntime`-Reads, Base-/Enemy-Read-Modelle und UI-Presentation.

### Schichtregel

Wenn der Binding im `activity`-Layer liegt, importiert er das `bridge`-Singleton nicht direkt. Network-Reads werden an der Composition-/Adapter-Grenze als Presentation-Port eingespeist. Die eingefrorenen älteren konkreten `NetworkBridge`-Consumer sind hiervon unberührt.

### Nicht tun

- World-space Objective-/Carry-/Repair-Marker gleichzeitig migrieren;
- Gameplay-/Objective-Authority verschieben;
- allgemeine World-Presentation in Coop ziehen;
- hypothetische Activity-Registry bauen.

### Endzustand

Coop-HUD, ViewModels und Announcements hängen an der laufenden Coop-Activity und nicht mehr an konkreter Systemlogik in `ArenaScene`.

---

## Phase 7A.2 – `CoopMissionPresentationBinding`: World-space Objectives und Mission-Renderer

### Ziel

Die verbleibende world-space Coop-Missionsdarstellung an denselben activity-scoped Binding-Owner geben.

### Umsetzen

Verschieben:

- Secondary Objective Marker;
- Mission-Progress-/Checkpoint-Marker;
- Carry Zones;
- Objective Repair-/Reward-Präsentation;
- Hostile-Base-Indikator, soweit world-space;
- Encounter-Telegraphs und activity-spezifische Enemy-/Objective-Projektion;
- Coop-Tutorial-World-Projektion;
- Boss-/activity-spezifische lokale Darstellung, soweit sie eindeutig Mission ist.

Die bestehende Activity-Lifetime bleibt kanonisch: `CoopMissionScopedBinding` detached den Presentation-Consumer vor Child-Teardown. Kein eigener zweiter Activity-Host.

### Verträge

- A → B in derselben World entfernt sämtliche A-Marker/-Renderer, bevor B bindet;
- World ohne Activity zeigt keinerlei Coop-Flächen;
- World-Presentation bleibt unabhängig und überlebt einen reinen Activity-Wechsel;
- Renderer erhalten nur Reads/Presentation-State und keine Mission-Authority.

### Nicht tun

- Client-Projektions-Cutover aus Phase 7B vorziehen, wenn dadurch zwei parallele Pfade entstehen;
- allgemeine World-/Player-/PowerUp-Präsentation in Coop ziehen.

### Endzustand

Die vollständige lokale Coop-Missionsdarstellung besitzt einen konkreten activity-scoped Owner; die Scene kennt keine Coop-Rendererliste mehr.

---

## Phase 7B – Coop Client-Projektion und Activity-Lifecycle-Cutover

### Ziel

Die verbleibende Coop-/Enemy-/Objective-Projektion aus Scene und Client-World-Helper lösen und die Activity-Presentation vollständig über ihre Lifetime führen.

### Umsetzen

- activity-spezifische Teile der bisherigen Client-Projektion in `CoopMissionPresentationBinding` verschieben;
- Bindung in der realen Coop-Composition über den bestehenden `CoopMissionScopedBinding`-Pfad erzeugen;
- beim Activity-Detach vor Child-Teardown sauber lösen;
- A → B in derselben World erzeugt einen frischen Presentation-Binding;
- den vorhandenen `CoopMissionActivityStep.clientPresentationStep()` für den clientseitigen Activity-Presentation-Anteil verwenden bzw. minimal erweitern;
- `ClientUpdateCoordinator` bleibt der bestehende Aufrufort dieses Client-Steps, solange die verifizierte Frame-Reihenfolge das verlangt;
- keinen zweiten direkten Activity-Presentation-Aufruf aus `ArenaScene` ergänzen; die Scene kennt keine Coop-Rendererliste.

### Endzustand

Eine neue Activity kann ihren eigenen Presentation-Binding bereitstellen, ohne dass `ArenaScene.update()` einen neuen fachlichen Branch benötigt.

**Danach: Checkpoint D.**

---

## Phase 8 – ArenaScene-Frame-Cutover und Orchestrierungs-Cleanup

### Ziel

Nach den Ownership-Verschiebungen den verbleibenden `update()`-Pfad auf echte Top-Level-Orchestrierung reduzieren.

### Umsetzen

Den Frame so formen, dass nur die grobe Reihenfolge sichtbar bleibt:

- Diagnostics begin;
- Network;
- Phase-/World-/Participation-Orchestrierung;
- ArenaRuntime-/WorldRuntime-Step;
- Input-/Policy-Step;
- Host-/Client-Frame einschließlich des dort bereits kanonisch liegenden Activity-Client-Steps;
- World-Presentation-Step an seiner verifizierten Position;
- nur falls fachlich erforderlich ein zusätzlicher **nicht duplizierender** Activity-Presentation-Step;
- echte scene-globale FX/UI;
- Meta-/Lobby-Step;
- Diagnostics end.

Vor jeder Verschiebung vorhandene Reihenfolgetests prüfen. Die heutige Reihenfolge darf nur geändert werden, wenn fachliche Gleichwertigkeit nachgewiesen und abgesichert ist. Insbesondere darf der bereits im `ClientUpdateCoordinator` liegende Activity-`clientPresentationStep()` nicht zusätzlich aus der Scene aufgerufen werden.

Kleine immutable Frame-Inputs sind erlaubt. Kein universeller `ArenaFrameContext` und kein `ArenaSceneController`.

### Endzustand

`ArenaScene.update()` ist wieder als Orchestrierungsablauf lesbar und enthält keine langen fachlichen Update-Blöcke.

---

## Phase 9 – Legacy-/Compatibility-Cleanup und finaler Architektur-Gate

### Ziel

Alle nur für die Migration verbliebenen Scene-Fassaden, Felder, Imports und Source-Test-Annahmen entfernen.

### Umsetzen

- obsolete Compatibility-Getter/Callbacks entfernen;
- unbenutzte Scene-Felder/Imports löschen;
- Source-Structure-Tests auf den neuen tatsächlichen Owner umstellen;
- bewusst dauerhafte Architektur-Ratchets ergänzen, nur wo sie echten Schutz bieten.

### Finale Ratchets

Mindestens prüfen:

- `ArenaScene` importiert keine persönliche Progression-/Item-Persistence-Mutations-API;
- `ArenaScene` besitzt keine Diagnose-Counter-/Transport-Sampler;
- `ArenaScene` besitzt keine verstreuten Hotkey-Handler-/Key-Felder;
- `ArenaScene` besitzt keine konkrete Coop-Objective-/Map-Event-/Activity-Presentation-Systemliste;
- `WorldPresentationBinding` bleibt gameplay-/physics-frei;
- aktiver World-Presentation-Binding fällt vor `WorldPresentationHandoff.release(...)`;
- stale/destroyed World-Bindings verändern keine Shared-Consumer einer späteren World;
- Activity Presentation fällt mit Activity-Lifetime und nutzt den bestehenden `CoopMissionScopedBinding`-/Activity-Step-Pfad ohne Doppel-Tick;
- die eingefrorene Liste konkreter `NetworkBridge`-Legacy-Consumer ist unverändert bzw. höchstens kleiner, niemals größer;
- kein neuer `ArenaSceneController`/God-Composer wurde eingeführt.

### Dokumentation

Erst nach verifiziertem finalem Code prüfen, ob `docs/ai/architecture.md` oder `docs/ai/rendering.md` einen langlebigen neuen Ist-Vertrag aufnehmen müssen. Knowledge Writeback folgt `AGENTS.md`; die GDD-Migrationsdokumente sind keine dauerhafte AI-Wissensbasis.

### Finaler Gate

`npm run check` vollständig grün.

Coding-KI nennt anschließend die manuelle User-Prüfliste, startet sie aber nicht selbst.

---

# 4. Empfohlene manuelle Sichtprüfung nach dem finalen automatisierten Gate

Der User prüft mindestens:

1. Boot → fertige LobbyWorld ohne sichtbaren Aufbau.
2. LobbyWorld betreten/verlassen und Ready-Verhalten.
3. Matchstart inkl. Loading/Countdown.
4. Host und Client: Waffen, Utility, Ultimate, Inspector-Radialmenü.
5. Spectator-Kamera.
6. Coop-HUD: Hauptziel, Nebenziele, Encounter, Map-Events, Boss/Hostile Base, Tutorial.
7. Persistent-Base-Visuals, Placement, Dismantle, Repositioning.
8. Licht, Schatten, Canopy, Kamera und Post-FX.
9. Items, Upgrades, Klassen-/Loadout-Wechsel.
10. Sieg/Niederlage → Exit-Fade → Match Results → Item Reward → Lobby.
11. Replay der letzten Ergebnisse und Raumstatistik.
12. Diagnose-/Net-/Performance-Hotkeys.

---

# 5. Risikoprofil der Phasen

| Phase | Risiko | Begründung |
|---|---|---|
| 1 | niedrig | Tests/Contracts, kaum Produktionslogik |
| 2A–2B | niedrig–mittel | Diagnostics ist fachlich orthogonal; Hotpath-Messung muss billig bleiben |
| 3A–3B | mittel | viele Callbacks, InputPolicy und lokales Feedback; Host-Authority darf nicht dupliziert werden |
| 4A–4C | mittel | viel State/Persistence, aber klare persönliche Lifetime; Doppelverarbeitung von Results vermeiden |
| 5 | mittel–hoch | neue Lifetime-Verträge; Handoff-Reihenfolge ist kritisch |
| 6A.1–6B | hoch | World-Presentation wird bewusst in kleinere Cutovers geteilt; Kamera/Residency, Lighting/Shared-Consumer und Preview bleiben reihenfolgekritisch |
| 7A.1–7B | hoch | Activity-Lifetime, bestehender Client-Presentation-Step, Host/Client-Projektion und Activity-Wechsel |
| 8 | hoch | finaler Frame-Cutover; Interleaving kann Verhalten ändern |
| 9 | mittel | Cleanup, Source-Ratchets und vollständige Regression |

Die Reihenfolge ist absichtlich von risikoarm nach gekoppelt gewählt. Presentation wird zuletzt migriert, weil dort Runtime-, Netzwerk-, Kamera-, Renderer- und Transition-Reihenfolgen zusammenlaufen.
