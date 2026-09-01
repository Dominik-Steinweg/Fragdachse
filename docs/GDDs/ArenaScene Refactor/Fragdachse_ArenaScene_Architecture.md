# Fragdachse – ArenaScene Refactoring: Zielarchitektur

**Status:** Verbindliche Zielarchitektur für das ArenaScene-Refactoring  
**Repository-Basis:** `Dominik-Steinweg/Fragdachse`, Branch `main`, Commit `39677c149ff44ebb8c3071b6bb18fede4bbb8013`  
**Implementierungsplan:** `Fragdachse_ArenaScene_Implementation_Plan.md`  
**Laufendes Protokoll:** `Fragdachse_ArenaScene_Migration_Status.md`

## 1. Ziel

`ArenaScene` bleibt die **dünne Phaser-Kompositions- und Frame-Orchestrierungsgrenze**.

Sie besitzt weiterhin:

- den Phaser-Lifecycle (`preload`, `create`, `update`, `shutdown`);
- die Erzeugung scene-langlebiger Top-Level-Owner und Phaser-Infrastruktur;
- die sichtbare grobe Frame-Reihenfolge;
- wenige echte Übergangsaufgaben, die bewusst an der Scene-Grenze liegen.

Sie besitzt langfristig **keine umfangreiche fachliche oder presentation-spezifische Logik** mehr.

Leitgedanke:

> **Die Scene ordnet. Owner entscheiden und besitzen. Presentation folgt ihrer tatsächlichen Lifetime.**

Das Refactoring soll vor allem zwei Dinge verbessern:

1. Änderungen an Progression, Eingabe, Diagnostik oder einer konkreten Activity benötigen nicht mehr den Kontext der gesamten `ArenaScene`.
2. Neue Activities können eigene Runtime- und Presentation-Owner ergänzen, ohne neue fachliche Systemlisten oder große Mode-Branches in `ArenaScene` zu erzeugen.

---

## 2. Verifizierter Ist-Befund

Das Zielbild ist mit dem aktuellen Repository konsistent.

`ArenaScene` enthält heute neben legitimer Phaser-Composition mindestens vier unabhängig änderbare Blöcke:

| Bereich | Heutiger Inhalt in `ArenaScene` | Ziel-Owner |
|---|---|---|
| Diagnostics | Profiler, Ablation, Scene-/Transport-/Companion-Metriken, Performance-Overlay, Messlogik | `ArenaDiagnosticsController` |
| Input-Bindings | Keyboard-/DOM-Hotkeys, `InputSystem`-Verdrahtung, Placement-/Action-Callbacks, lokales Failure-Feedback | `ArenaInputBindings` |
| Meta / Lobby | persönliche Progression, Upgrades, Klassen/Loadout, Items, Rewards, Match-Result-Präsentation und persistente Lobby-Use-Cases | `ArenaMetaController` |
| Presentation | Kamera-/World-Sync, Licht/Schatten, World-Projektion, Coop-Ziele/HUD/Marker, replizierte Client-Projektion | World-/Activity-Presentation-Bindings |

Zusätzlich existieren viele Source-Structure-Tests, die konkrete Strings in `ArenaScene.ts` prüfen. Diese Tests sind während der Migration ein relevantes Sicherheitsnetz, dürfen aber die alte Ownership nicht konservieren. Ein Vertrag muss nach einer Extraktion am neuen Owner geprüft werden.

Die bestehenden Architekturregeln bestätigen die Richtung:

- Ownership folgt Authority, Lifetime und unabhängigem Änderungsgrund, nicht Dateigröße.
- Scenes und Coordinatoren orchestrieren; Regeln gehören tiefer.
- World und Activity besitzen getrennte Lifetimes.
- Presentation hat keine Gameplay-Authority.
- `WorldPresentationBinding` darf beim Handoff reine Darstellung tragen, aber keine Gameplay-/Physics-Abhängigkeiten.
- Ein bereits zerstörtes world-scoped Binding darf keine scene-langlebigen Consumer mehr verändern; stale Aufrufe sind wirkungslos.
- Neue Runtime-/Owner-Grenzen verwenden kleine fachliche Ports. Die bestehende eingefrorene Menge älterer Kernsysteme mit konkreter `NetworkBridge`-Constructor-Injection ist kein Nebenauftrag dieses Refactorings und darf nicht wachsen.

---

## 3. Zielstruktur

```text
ArenaScene
│
├── Phaser / Scene Infrastructure
│   ├── ArenaContext (bestehende scene-langlebige Systeme)
│   ├── RendererBundle / scene-langlebige Renderer-Infrastruktur
│   ├── UI-/Camera-Infrastruktur
│   └── ArenaBuilder / Asset- und Scene-Aufbau
│
├── ArenaDiagnosticsController
│
├── ArenaInputBindings
│
├── ArenaMetaController
│
└── ArenaRuntime
    ├── Arena Flow / World-/Activity-Lifecycle
    ├── Persistent-Base Room Owner
    ├── WorldRuntime
    │   ├── WorldMaterialization
    │   ├── WorldPresentationBinding          ← handoffbare reine Fläche
    │   ├── WorldPresentationFrameBinding     ← aktive world-scoped Verdrahtung
    │   └── ActivityRuntimeHost
    │       └── CoopMissionRuntime
    │           └── CoopMissionPresentationBinding
    └── benannte Host-/Client-Frame-Schritte
```

`Scene Infrastructure` ist ein **Scope-Begriff**, keine Pflicht zu einer neuen Sammelklasse.

---

## 4. Owner und Verantwortungen

### 4.1 `ArenaScene`

`ArenaScene` ist Composition Root und äußerster Frame-Orchestrator.

Sie darf:

- Phaser-Objekte erzeugen, deren Lifecycle unmittelbar an die Scene gebunden ist;
- Top-Level-Owner miteinander verbinden;
- den groben Frame-Ablauf sichtbar halten;
- kleine lokale Werte für den aktuellen Frame ableiten;
- Übergänge koordinieren, wenn deren Reihenfolge mehrere Top-Level-Owner betrifft.

Sie darf nicht:

- persönliche Progressionsregeln oder Persistenz-Use-Cases implementieren;
- große Input-Callback-Bäume besitzen;
- Performance-Sampler und Diagnose-Counter selbst führen;
- konkrete Coop-Systemlisten oder Coop-Presentation-Details kennen;
- als allgemeiner Service Locator für World-/Activity-Systeme dienen.

Ein verbleibender breiter `create()`-Block ist nicht automatisch falsch: Composition Roots dürfen breit sein. Problematisch ist nur dauerhaft dort verbleibende **eigene Logik**.

### 4.2 `ArenaDiagnosticsController`

Scene-langlebiger Owner der Arena-Diagnostik.

Typische Ownership:

- `ArenaRuntimeProfiler`;
- `PerformanceAblationController`;
- Performance-/Netzwerk-Diagnose-Overlay;
- Scene-Display-Object-Sampling;
- Transport-Metriken;
- Flowfield-/Rock-/VFX-Companion-Sampling;
- Environment-/Renderer-Beschreibung;
- Diagnose-Subscriptions und deren Teardown.

Der Owner darf kleine Messports auf Runtime, Renderer und Netzwerk verwenden. Er verändert keine Gameplay-Authority.

Bevorzugter Frame-Vertrag:

```text
beginFrame(...)
record/measure benannte Abschnitte
endFrame(...)
```

Die konkrete API darf einfacher sein, wenn dadurch weniger Boilerplate entsteht.

### 4.3 `ArenaInputBindings`

Scene-langlebiger Owner der lokalen Eingabe-Verdrahtung.

Typische Ownership:

- Keyboard-Key-Objekte und DOM-Hotkey-Handler;
- Setup/Teardown der `InputSystem`-Provider und Callbacks;
- Spectator-Kamera-Eingabe;
- lokale Placement-/Management-Preview-Weiterleitung;
- lokales Cooldown-/Ressourcen-/Failure-Feedback;
- Debug-Hotkeys als Aufruf kleiner Diagnose-/Debug-Ports.

`InputSystem` selbst bleibt scene-langlebige Infrastruktur, sofern der Ist-Code keinen besseren Owner zeigt.

Verbindlich:

- `ArenaInputBindings` entscheidet keine hostautoritative Gameplay-Regel;
- Capabilities/InputPolicy werden konsumiert, nicht neu erfunden;
- Netzwerkrequests und Persistenzmutationen laufen über die dafür existierenden Ports/Owner;
- alle eigenen Listener und Keys werden symmetrisch gelöst.

### 4.4 `ArenaMetaController`

Scene-langlebiger Use-Case-Owner für persönliche Meta- und Lobby-Funktionalität.

Typische Ownership:

- validierter persönlicher Coop-Fortschritts-Snapshot;
- Upgrade-/Respec-/Klassen-/Loadout-Use-Cases;
- Item-Inventar, Pending Rewards, Equip/Unequip/Salvage;
- Ableitung und Präsentationsdaten persönlicher Match-Ergebnisse;
- Replay des letzten lokalen Ergebnis-Snapshots;
- Lobby-seitige Synchronisation persönlicher Freischaltungen;
- Dateiimport-Nachzug und Default-Auswahl, soweit dies persönliche Meta-Use-Cases sind.

Wichtig:

```text
ArenaMetaController
≠ dauerhafte Progression selbst
≠ Activity Result Authority / ResultApplication
≠ Persistent-Base Room Owner / ArenaPersistentBaseSession
≠ LocalStorage als Runtime-State
```

Dauerhafte Progression bleibt in der bestehenden Persistence-/Preference-Grenze. Der Controller führt Use-Cases aus und hält nur den scene-lokalen validierten Arbeits-/Read-Stand.

Die Activity produziert weiterhin nur ihr fachliches Ergebnis. `ResultApplication` bleibt der bestehende Owner für Deduplication und Anwendung des Activity-Abschlusses; `ArenaPersistentBaseSession` bleibt der bestehende room-langlebige Owner für Persistent-Base-Working-State, Grants und Management-Anfragen. Der Meta-Owner konsumiert nur die autoritativ verfügbaren Result-/Progressionsdaten für persönliche Use-Cases und darf weder diese Owner umschließen noch eine zweite Ergebnis-, Reward- oder Persistent-Base-Authority erzeugen.

### 4.5 World-Presentation: Fläche und aktive Verdrahtung sind getrennt

Die bestehende `WorldPresentationBinding` ist handoffbar. Sie trägt reine gebaute Darstellung plus Layout und darf eine WorldRuntime überleben.

Deshalb darf die neue per-Frame-Logik **nicht** einfach Gameplay-Referenzen in diese handoffbare Instanz einbauen.

Verbindliches Modell:

```text
WorldRuntime
│
├── WorldPresentationFrameBinding
│   ├── aktive World-/Player-/Renderer-Reads
│   ├── Kamera-/Licht-/Schatten-/World-Sync
│   └── stirbt vor bzw. mit Runtime-Detach
│
└── WorldPresentationBinding
    ├── reine gebaute Fläche + Layout
    └── kann via Handoff release → adopt/discard überleben
```

`WorldPresentationFrameBinding` wird beim World-Detach vollständig gelöst, **bevor** die reine Fläche in den Handoff geht. Diese Reihenfolge ist ein eigener Vertrag: Ein gewöhnlicher `WorldRuntime.bind(...)`-Teardown reicht nicht aus, solange dieser erst in `WorldRuntime.destroy()` läuft, nachdem der Flow die `WorldPresentationBinding` bereits per `releasePresentation()` in den Handoff gegeben hat. Der konkrete Mechanismus darf klein bleiben, muss aber die Reihenfolge **aktive Presentation lösen → reine Fläche freigeben → Runtime zerstören** garantieren.

Nach seinem Destroy ist der aktive Binding vollständig inert. Insbesondere darf ein verspäteter/staler Aufruf keine scene-langlebigen Renderer-, Lighting-, Occluder-, Listener- oder sonstigen Shared-Consumer einer bereits nachfolgenden World mehr verändern.

World-Presentation umfasst nur activity-unabhängige Darstellung, z. B.:

- World-Surface/Canopy;
- Kamera-World-Bindung;
- World-Licht und Schatten;
- world-scoped Player-/Projectile-/PowerUp-/Persistent-Base-Projektion, soweit fachlich unabhängig von einer Activity;
- clientseitige Projektion replizierter World-Zustände.

Scene-langlebige Renderer-/GPU-Infrastruktur darf scene-langlebig bleiben. Nur ihr **world-spezifischer Zustand und ihre Verdrahtung** folgen der World-Lifetime.

### 4.6 `CoopMissionPresentationBinding`

Konkreter activity-scoped Presentation-Owner der Coop-Mission.

Typische Ownership:

- Encounter-/Map-Event-Präsentation;
- Hauptziel-/Nebenziel-HUD;
- Mission-Progress-/Checkpoint-/Carry-/Repair-Marker;
- Boss-/hostile-base-bezogene Präsentation;
- Coop-Tutorial-Projektion;
- activity-spezifische Enemy-/Objective-Projektion;
- clientseitige Projektion replizierten Coop-Zustands.

Der Binding-Owner:

- besitzt keine Simulation;
- schreibt keine Mission-Authority;
- endet vollständig mit der Activity;
- erhält kleine Presentation-/Read-Ports aus der Composition-Grenze;
- importiert in Domain-/Activity-Schichten nicht direkt das `bridge`-Singleton.

Für Lifecycle und Frame-Anbindung werden die bereits vorhandenen Verträge bevorzugt weiterverwendet: `CoopMissionScopedBinding` löst langlebigere Consumer vor den Activity-Child-Ownern, und `CoopMissionActivityStep.clientPresentationStep()` besitzt bereits einen kanonischen Client-Presentation-Schritt. Das Refactoring baut **keinen zweiten parallelen Activity-Presentation-Lifecycle und keinen doppelten Client-Presentation-Step**. Nur wenn die bestehenden Verträge nachweislich nicht ausreichen, darf die kleinste nötige Erweiterung ergänzt werden.

Neue Activities dürfen einen eigenen konkreten Presentation-Owner bereitstellen. Dafür ist höchstens ein kleiner gemeinsamer Lifecycle-/Frame-Vertrag gerechtfertigt, **keine Registry, Plugin-Plattform oder generische Activity-Metadatenarchitektur**.

---

## 5. Frame-Vertrag

Die grobe Reihenfolge bleibt in `ArenaScene.update()` sichtbar.

Zielbild, schematisch:

```text
ArenaScene.update(delta)
│
├── Diagnostics: Frame beginnen
├── Network aktualisieren
├── Phase-/World-/Participation-Orchestrierung
├── ArenaRuntime / WorldRuntime ticken
├── lokale Input-/Policy-Bindings aktualisieren
├── Host- oder Client-Runtime-Frame
├── World-Presentation aktualisieren
├── Activity-Presentation am kanonischen Activity-/Client-Step aktualisieren, falls nicht bereits im Role-Frame enthalten
├── echte scene-globale FX/UI aktualisieren
├── Meta-/Lobby-Projektion aktualisieren
└── Diagnostics: Frame abschließen
```

Die exakte bestehende Reihenfolge ist vor jeder Verschiebung gegen Code und Tests zu verifizieren. Das Diagramm ist keine Erlaubnis, fachlich relevante Reihenfolgen neu zu sortieren.

Insbesondere bleiben geschützt:

- Network-Sync vor davon abhängigen Client-Projektionen;
- unerschütterte Pointer-/Gameplay-Koordinaten vor visuellem Camera-Feedback;
- Host-/Client-Frame-Reihenfolge der Arena Runtime;
- keine doppelte Activity-Presentation: ein bestehender kanonischer `clientPresentationStep` wird wiederverwendet statt parallel erneut aufgerufen;
- World-/Activity-Teardown vor reinem Exit-Handoff;
- World ohne Activity;
- Preview ohne Participation.

Es entsteht **kein universeller `ArenaFrameContext` als Dependency-Bag**. Owner erhalten kleine immutable Frame-Inputs oder benannte Ports.

---

## 6. Abhängigkeitsrichtung

Bevorzugt:

```text
ArenaScene / Composition
        ↓
scene-langlebige Owner
        ↓
kleine Runtime-/Presentation-/Persistence-Ports
        ↓
fachliche Owner
```

Beispiele:

```ts
new ArenaInputBindings(inputSystem, capabilityPort, placementPort, feedbackPort)
new ArenaMetaController(progressStore, lobbyPort, resultReadPort)
new CoopMissionPresentationBinding(rendererPort, missionReadPort, uiPort)
```

Nicht:

```ts
new ArenaMetaController(arenaScene)
new CoopMissionPresentationBinding(arenaRuntime)
new WorldPresentationFrameBinding(arenaScene)
```

Ein Owner darf Phaser-Objekte erhalten, wenn er ausdrücklich Presentation-/Scene-Infrastruktur besitzt. Er erhält aber nicht die gesamte Scene nur als bequemen Service Locator.

Die Netzwerkgrenze bleibt pragmatisch: Neue Runtime-/Domain-Owner importieren das `bridge`-Singleton nicht und erhalten kleine Ports. Die bestehende eingefrorene Legacy-Menge `CombatSystem`, `InputSystem`, `HostPhysicsSystem`, `DecoySystem`, `EffectSystem`, `EnergyShieldSystem`, `LoadoutManager` und `BurrowSystem` darf weiterhin eine konkrete `NetworkBridge` per Constructor-Injection erhalten. Dieses Refactoring erweitert diese Menge nicht und baut sie nicht allein aus Gründen architektonischer Reinheit um.

---

## 7. Harte Regeln

1. `ArenaScene` bleibt die einzige zentrale Phaser-Scene.
2. Kein neuer zentraler `ArenaSceneController`.
3. Keine Extraktion nur in statische Helper-Dateien ohne eigenen Owner/Vertrag.
4. Keine neue zweite mutable Wahrheit für Progression, Resultate, World- oder Activity-State.
5. Dauerhafte Progression bleibt außerhalb der Runtime-/Presentation-Hierarchie.
6. World-Presentation und Activity-Presentation bleiben getrennt.
7. `WorldPresentationBinding` bleibt handoffbar und gameplay-frei.
8. Aktive World-Presentation-Reads werden **vor** `WorldPresentationHandoff.release(...)` gelöst und nicht in den Handoff getragen.
9. Ein zerstörter world-scoped Binding ist inert und darf keine scene-langlebigen Consumer einer späteren World verändern.
10. Coop-Presentation stirbt mit der Coop-Activity und verwendet vorhandene `CoopMissionScopedBinding`-/Activity-Step-Verträge statt eines parallelen Lifecycles.
11. Eine World ohne Activity benötigt keinen Dummy-Activity-Presentation-Owner.
12. Eine neue Activity erzeugt keinen neuen großen Branch in `ArenaScene`.
13. Renderer haben keine Gameplay-Authority.
14. Input-Bindings validieren keine hostautoritative Regel erneut.
15. Die eingefrorene Legacy-Menge konkreter `NetworkBridge`-Consumer wird in diesem Refactoring weder erweitert noch als Nebenprojekt auf Ports umgebaut.
16. Architektur- und Implementierungsplan werden während der Migration nicht automatisch von Coding-KIs umgeschrieben; Abweichungen kommen in den Status als Review-Kandidat.
17. LOC ist ein Warnsignal, kein Erfolgskriterium. Eine kleinere Scene durch Verschieben in eine neue God-Class ist kein Erfolg.

---

## 8. Nicht-Ziele

Nicht Teil dieses Refactorings:

- Gameplay-Balance oder neue Features;
- neue Netzwerk-/Wire-Protokolle;
- Umbau der bereits etablierten ArenaRuntime-Lifetime-Architektur ohne konkreten Zwang;
- generische Activity-Plugin-Architektur;
- komplette UI-Neuentwicklung;
- Persistenzformat-Migration;
- Renderer-Neuschreibung;
- Browser-/Visual-Redesign.

---

## 9. Erfolgskriterien

Das Refactoring ist architektonisch erfolgreich, wenn:

- `ArenaScene` ihren Zweck wieder in einem Satz beschreiben kann: **Phaser-Komposition und grobe Frame-Orchestrierung**;
- Diagnostics, Input und Meta eigene scene-langlebige Owner besitzen;
- `ArenaScene` keine direkten persönlichen Progressions-/Item-/Upgrade-Mutationen mehr enthält;
- `ArenaScene` keine umfangreichen Diagnose-Counter/Sampler mehr besitzt;
- `ArenaScene` keine großen `InputSystem.setup...`-Callback-Bäume mehr enthält;
- allgemeine World-Presentation über einen world-scoped Binding-Owner läuft;
- Coop-spezifische Presentation an der Coop-Activity-Lifetime hängt;
- clientseitige replizierte Projektion beim passenden World-/Activity-Presentation-Owner liegt;
- Activity-Wechsel innerhalb derselben World keine alte Presentation zurücklässt;
- World-Handoff weiterhin ausschließlich reine Darstellung überlebt und der aktive Frame-Binding nachweislich davor fällt;
- stale/destroyed World-Bindings keine Shared-Consumer einer nachfolgenden World verändern;
- Coop-Presentation den bestehenden Activity-Lifecycle/Client-Presentation-Step nutzt und nicht doppelt getaktet wird;
- bestehende Lifecycle-, Preview-, Host-/Client- und Exit-Fade-Verträge grün bleiben;
- neue Activities keinen fachlichen Systemzweig in `ArenaScene` benötigen.

Eine feste Zielzeilenzahl für `ArenaScene.ts` ist bewusst **kein** Gate. Bleiben nach dem Cutover jedoch erneut mehrere unabhängige große Verantwortungsblöcke in der Scene, ist ein Review erforderlich.
