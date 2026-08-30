# Fragdachse – Arena Runtime Architecture

**Status:** Verbindliche Zielarchitektur für das Arena-/World-/Activity-Refactoring  
**Repository-Basis:** `Dominik-Steinweg/Fragdachse`, Branch `architecture-refactor-pre-phase3`

## 1. Ziel

Der Arena-Layer soll weiteres Wachstum unterstützen, ohne dass neue Features globale Lifecycle-, Update- oder Context-Klassen immer weiter vergrößern.

Leitgedanke:

> **Ownership folgt Lifetime. Update folgt Ownership. Teardown folgt tatsächlichem Besitz.**

Qualitätsziel:

> **Neue Komplexität entsteht dort, wo das Feature fachlich lebt – nicht im globalen Arena-Lifecycle.**

Eine typische Änderung soll möglichst nur den fachlichen Owner, kleine Verträge und die zugehörigen Tests betreffen. Das reduziert Seiteneffekte und den Kontextbedarf für Entwickler und Coding-KIs.

---

## 2. Zielstruktur

```text
ArenaScene
│
├── SceneInfrastructure
│   ├── Input
│   ├── Audio / FX / UI Infrastructure
│   ├── Network / RPC Infrastructure
│   └── Diagnostics
│
└── ArenaRuntime
    ├── SharedRuntimeServices
    ├── ParticipationCoordinator
    ├── ResultApplication
    ├── PersistentBaseRoomSession
    ├── ArenaFlowCoordinator oder entsprechend reduzierter bestehender Flow-Owner
    │
    └── WorldLifecycle
        ├── World Identity / Revision
        ├── ActivityLifecycle
        │
        └── optional WorldRuntime
            ├── WorldRuntimeContext
            ├── World-scoped Systems / Bindings
            ├── PlayerWorldRuntime
            ├── PersistentBaseWorldBinding
            ├── optional WorldPresentationBinding
            │
            └── ActivityRuntimeHost
                └── optional ActivityRuntime
                    ├── optional PlayerActivityRuntime
                    └── optional ActivityPresentationBinding
```

Dauerhafte persönliche Progression liegt außerhalb der Runtime-Hierarchie.

---

## 3. Grundmodell

### 3.1 Lifecycle und Runtime

**Lifecycle**
- besitzt Identität, Revision und Übergänge einer Instanz;
- kann eine lokale Runtime überleben.

**Runtime**
- besitzt die lokale mutable Realisierung genau einer Lifetime;
- besitzt Aufbau, Update und vollständigen Teardown dieses Scopes.

Verbindlich:

```text
World Identity ≠ WorldRuntime
Activity Identity ≠ ActivityRuntime

detach lokale Runtime ≠ Ende der replizierten Instanz
```

Eine World kann ohne Activity existieren. Eine Activity benötigt eine World.

### 3.2 Runtime-Hierarchie beschreibt Lifetimes

Die Runtime-Hierarchie beantwortet:

> Wie lange lebt dieser Zustand?

Sie ist keine Feature-Hierarchie. Generische Mechaniken wie Combat, Projectile, Damage, Physics, Fire oder Navigation bleiben bei ihren fachlichen Domain-Ownern und werden nicht allein deshalb Teil einer Activity, weil diese sie verwendet.

### 3.3 Composition Owner sind keine Dependency Bags

`ArenaRuntime`, `WorldRuntime` und `SharedRuntimeServices` dürfen Child-Owner erzeugen, verbinden, ticken und zerstören.

Sie werden nicht als allgemeine Service-Container weitergereicht.

Bevorzugt:

```ts
new SomeSystem(combatPort, worldReadPort)
```

Nicht:

```ts
new SomeSystem(arenaRuntime)
new SomeSystem(worldRuntime)
new SomeSystem(sharedRuntimeServices)
```

---

## 4. Runtime-Owner

### 4.1 `ArenaScene`

Phaser-Composition-Root.

Besitzt:
- Phaser Lifecycle;
- `SceneInfrastructure`;
- `ArenaRuntime`.

Besitzt keine fachlichen Gameplay-Regeln und kennt langfristig keine einzelnen Activity-Systeme.

### 4.2 `ArenaRuntime`

Scene-langlebiger Composition Owner des Arena-Layers.

Besitzt Top-Level-Owner wie:
- Shared Runtime Services;
- Flow;
- Participation;
- Result Application;
- Persistent-Base Room Session;
- World Lifecycle.

`ArenaRuntime` ist kein Nachfolger von `ArenaContext` als globaler Dependency-Bag.

### 4.3 `SharedRuntimeServices`

Enthält technisch scene-langlebige Domain-Systeme, die nicht künstlich pro World oder Activity neu erzeugt werden sollen.

Beispiele:
- Combat;
- Projectiles;
- Physics;
- Fire.

Regeln:
- kein versteckter State alter Worlds oder Activities;
- Scope-Bindung erfolgt explizit;
- Detach entfernt den scoped State vollständig;
- der Container selbst wird nicht als Dependency weitergereicht.

### 4.4 `WorldLifecycle`

Besitzt World-Identität und Revision.

Die bestehende Semantik bleibt erhalten:

```text
lokale WorldRuntime detach
≠
World-Instanz beenden
```

### 4.5 `WorldRuntime`

Besitzt die lokale Realisierung genau einer World.

Typische direkte Ownership:
- Layout / Geometrie;
- Placement / Rocks;
- World Navigation;
- Bases;
- World-scoped Bindings;
- `PlayerWorldRuntime`;
- `PersistentBaseWorldBinding`;
- optionale World Presentation;
- `ActivityRuntimeHost`.

`WorldRuntime.update()` tickt nur eigene direkte Child-Owner.  
`WorldRuntime.destroy()` räumt den kompletten materialisierten World-State idempotent ab.

### 4.6 `WorldRuntimeContext`

Kleiner kanonischer Read-Kontext für World-Daten, z. B.:
- Descriptor / Identity;
- Definition;
- Metrics;
- Bases;
- Persistent-Base-Site.

Nicht enthalten:
- Gameplay-Systeme;
- Player Runtime;
- Activity State;
- Renderer;
- NetworkBridge;
- Service Container.

### 4.7 `ActivityLifecycle` und `ActivityRuntimeHost`

`ActivityLifecycle` besitzt Activity-Identität und Revision.

`ActivityRuntimeHost` besitzt im `WorldRuntime` genau den Slot der aktuell lokal materialisierten Activity und kennt nur deren Lifecycle-Vertrag:

```text
attach
update
detach / destroy
```

Der Host kennt keine internen Systeme einer konkreten Activity.

### 4.8 `ActivityRuntime`

Besitzt ausschließlich State und Systeme, deren Lifetime an die konkrete Activity gebunden ist.

Beispiele:

```text
CoopMissionRuntime
FromDachsTillDawnRuntime
DeathmatchRuntime
CaptureTheBeerRuntime
```

Eine Coop-Mission kann unter anderem besitzen:
- Encounter / Spawn Runtime;
- activity-scoped Enemy Behaviour;
- Boss Runtime;
- Objectives;
- Mission Progress;
- Completion State;
- `PlayerActivityRuntime`;
- `ActivityPresentationBinding`.

Eine neue Activity erzeugt keine neue globale Update-Liste und keine neuen Lifecycle-Sonderpfade in `ArenaScene`.

---

## 5. Player-Lifetimes

### `PlayerWorldRuntime`

Enthält nur State, der einen Activity-Wechsel innerhalb derselben World überleben soll.

Beispiele:
- Player Entity;
- world-scoped Navigation;
- World Targeting;
- world-scoped Build-/Loadout-/Combat-State, soweit fachlich tatsächlich world-langlebig.

### `PlayerActivityRuntime`

Enthält Activity-spezifischen Player-State.

Beispiele:
- Activity Participation;
- Respawn-/Life-State der Activity;
- Objective State;
- activity-scoped Modifiers;
- Reward Eligibility Projection.

Verbindliche Probe:

```text
Activity A endet
Activity B startet
World bleibt identisch

PlayerWorldRuntime bleibt
PlayerActivityRuntime A wird zerstört
PlayerActivityRuntime B wird erzeugt
```

### Materialization Tracking

Ein Player-Owner hält fest, welche Module tatsächlich materialisiert wurden.

Detach rekonstruiert nicht aus einer später möglicherweise geänderten Policy, was beim Attach erzeugt worden sein könnte.

---

## 6. Participation, Capabilities und Presentation

Diese Konzepte bleiben orthogonal.

```text
WorldParticipation
= Bin ich in dieser World und wie?

ActivityParticipation
= Nehme ich an dieser Activity teil?

PlayerCapabilities
= Welche Aktionen sind aus Participation + Policy erlaubt?

Presentation
= Was stellt dieser Peer lokal dar?
```

`PlayerCapabilities` sind abgeleitete Policy, keine zweite mutable Wahrheit.

Presentation besitzt keine Gameplay-Authority.

Scene-langlebig bleibt nur die Presentation-Infrastruktur.  
World- und Activity-spezifische Darstellung erfolgt über entsprechende Bindings.

---

## 7. Persistent Base und Persistenz

Persistenz wird nach echter Lifetime getrennt.

### Profile Persistence

Dauerhafter persönlicher Zustand:
- XP;
- Items;
- Upgrades;
- persönliche Persistent-Base-Blueprints;
- zukünftige Meta-Progression.

Runtime-/Domain-Code schreibt nicht direkt in Local Preferences.

### `PersistentBaseRoomSession`

Room-langlebiger, host-validierter Zustand:
- Contributions;
- committed Session State;
- Session Revisions;
- Owner-/Session-Bindings.

Enthält keine World Runtime IDs und keinen Activity Working State.

### `PersistentBaseTransaction`

Optionaler Activity-langlebiger Working State:
- Baseline;
- Working State;
- World-/Activity-Identity;
- Transaction ID;
- genau einen terminalen Abschluss: `commit` oder `rollback`.

Stale Operationen dürfen keine neuere Transaction verändern.

### `PersistentBaseWorldBinding`

World-lokale Materialisierung:
- Site / Anchor;
- Build Area;
- Runtime IDs;
- World-Konflikte;
- World-Repräsentation.

Stirbt vollständig mit der WorldRuntime. Die RoomSession darf weiterleben.

---

## 8. Activity Completion und Result Application

Eine Activity erzeugt ein fachliches, revisionsgebundenes Ergebnis und schreibt nicht direkt in Persistenz.

```text
ActivityCompletion
├── worldRevision
├── activityRevision
├── definitionId
├── kind
└── activity-spezifisches Result oder Abort
```

Danach:

```text
ActivityCompletion
      ↓
ResultApplication
      ↓
konkrete fachliche Konsequenzen
```

Mögliche Konsequenzen:
- Persistent-Base Outcome;
- Progression;
- Rewards;
- Unlocks;
- Statistics;
- Result Presentation Model.

Nur Use-Cases mit realem Consumer werden implementiert. Leere Architekturhüllen sind nicht erforderlich.

---

## 9. Network-Grenze

Gameplay- und Runtime-Code kennt keine Transportdetails.

Zielrichtung:

```text
Runtime / Domain
      ↕
kleine fachliche Ports
      ↕
Network / RPC Adapter
      ↕
NetworkBridge / bridge / Transport
```

Verbindlich:
- neuer Runtime-/Domain-Code importiert `NetworkBridge` oder `bridge` nicht direkt;
- Ports entstehen nur bei realer Infrastrukturgrenze;
- explizite Network-, RPC- oder Transport-Adapter dürfen die konkrete Netzwerk-API kennen.

Nicht Bestandteil dieses Refactorings:
- Wire Keys neu designen;
- Transport wechseln;
- Tick Rates ändern;
- Authority-Modell ändern;
- World-/Activity-Revisionssemantik ändern.

---

## 10. Update- und Teardown-Verträge

### Update

```text
ArenaRuntime.update()
└── direkte Top-Level-Owner

WorldRuntime.update()
└── world-scoped Child-Owner
    └── ActivityRuntimeHost

ActivityRuntime.update()
└── Activity-interne Child-Owner
```

Ein Parent tickt keine internen Systeme seiner Child-Owner einzeln.

### Teardown

Jeder Runtime-Owner besitzt symmetrisch:

```text
create / attach
update
destroy / detach
```

Regeln:
- `destroy()` / `detach()` ist idempotent;
- tatsächlich materialisierter State wird entfernt;
- Child-Owner werden bei Abhängigkeit in umgekehrter Aufbau-Reihenfolge zerstört;
- nach Teardown bleiben keine alten Timer, Listener, Callbacks, Runtime IDs, scoped Bindings oder Referenzen aktiv.

---

## 11. Harte Architekturregeln

1. Lifecycle-Identität und lokale Runtime sind getrennt.
2. Ein Runtime-Owner besitzt genau eine Lifetime.
3. Update Ownership folgt Runtime Ownership.
4. Teardown folgt tatsächlichem Besitz, nicht rekonstruierter Policy.
5. World, Activity, Participation, Presentation und Persistence bleiben getrennte Fragen.
6. `WorldRuntimeContext` bleibt ein kleiner Read-Kontext.
7. Composition Owner werden nicht als allgemeine Dependency Bags weitergereicht.
8. Activity-spezifischer Player-State gehört nicht in `PlayerWorldRuntime`.
9. Room-State, Activity-Transaction, World-Materialisierung und Profile-Persistenz werden nicht vermischt.
10. Eine Activity erzeugt Outcomes, schreibt aber nicht direkt in Transport oder Persistence.
11. Runtime-Hierarchie und Feature-Hierarchie bleiben getrennt.
12. Keine neue generische Abstraktion ohne realen Consumer oder eigenständigen Vertrag.
13. Kein neuer world-/activity-scoped mutable Gameplay-State wird scene-global angelegt.
14. Neue Activities erzeugen keine globalen Lifecycle- oder Update-Sonderpfade.
15. Neuer World-/Activity-Runtime-Code importiert `ArenaContext` nicht; neuer Runtime-/Domain-Code importiert `NetworkBridge` oder `bridge` nicht direkt.
16. Keine allgemeine DI-, Event-Bus-, Registry-, Service-Locator- oder Plugin-Infrastruktur ohne konkreten Bedarf.
17. Wire- und Authority-Verhalten werden während dieses Ownership-Refactorings nicht nebenbei neu designt.

### Stop/Go-Regel

Ein im Zielbild genannter Coordinator, Port, Binding oder Use-Case wird nur dann erzeugt, wenn er im aktuellen Implementierungsschritt einen realen Ownership-, Lifetime- oder Dependency-Zweck erfüllt.

Das Zielbild ist eine Architekturvorgabe, kein Auftrag zur mechanischen Erzeugung jeder denkbaren Klasse.

---

## 12. Erfolgskriterien

Das Refactoring ist architektonisch erfolgreich, wenn:

- eine neue Activity primär in ihrem eigenen Runtime-Scope wächst;
- ein neues Coop Objective keine globale Arena-Verkabelung benötigt;
- ein neuer Gegner keine Änderungen an Arena-Lifecycle, Flow oder Persistent Base benötigt;
- Activity-Wechsel innerhalb derselben World ohne künstlichen World-Rebuild möglich sind;
- lokale WorldRuntime detach/reattach kann, während die World Identity bestehen bleibt;
- `PlayerWorldRuntime` den Activity-Wechsel überlebt, `PlayerActivityRuntime` nicht;
- PB RoomSession einen World-Wechsel überlebt, WorldBinding nicht;
- stale Completion-/Transaction-Daten keine Progression oder Commits auslösen;
- Host-Simulation ohne lokale Presentation und Preview ohne WorldParticipation weiterhin möglich sind;
- globale nullable Runtime-Felder und manuelle Teardown-/Update-Listen nicht mehr die primäre Lifecycle-Modellierung bilden.

Qualitative Context-Locality-Probe:

> **Muss eine typische Feature-Änderung fachfremde globale Arena-Dateien verstehen oder ändern?**

Wenn regelmäßig ja, ist die Ownership-Grenze noch nicht sauber genug.
