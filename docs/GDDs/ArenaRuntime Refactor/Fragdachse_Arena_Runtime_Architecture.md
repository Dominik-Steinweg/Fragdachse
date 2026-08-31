# Fragdachse – Arena Runtime Architecture

**Status:** Verbindliche Zielarchitektur für das Arena-/World-/Activity-Refactoring  
**Repository-Basis:** `Dominik-Steinweg/Fragdachse`, Branch `main`, Rebaseline nach Phase 9 auf Commit `324fee4ae2952f12077f6053bd6119c8a7aa8eee`

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
    ├── WorldPresentationHandoff
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

### 3.4 Lifetime-Ownership und Composition sind getrennte Verantwortungen

Ein Runtime-Owner beantwortet **wer den entstandenen mutable State besitzt und wann er endet**. Die
konkrete Erzeugung eines größeren Runtime-Graphs ist eine davon getrennte Composition-Aufgabe.

Verbindlich:

```text
Flow / Lifecycle
    ↓ fordert Instanz an
konkrete Composition-Grenze
    ↓ erzeugt und verdrahtet
Runtime-Owner
    ↓ besitzt State, Update-Vertrag und Teardown
```

Eine Composition-Grenze kann eine kleine Factory, ein Materializer, ein Builder oder eine bereits
vorhandene konkrete Funktion sein. Der Klassenname ist nicht Teil des Vertrags. Eine neue Klasse
entsteht nur, wenn der reale Aufbau dadurch lokaler und verständlicher wird.

Beispiele für den Zielzustand:

- World-Flow kennt `WorldDescriptor`, Readiness und Übergänge, aber nicht die konkrete Liste aus
  Placement, Bases, Rock Registry, Light Occluders oder Shared-Service-Callbacks;
- Coop-Flow kennt `ActivityDescriptor` und den Activity-Lifecycle, aber nicht die konkrete Liste aus
  Flowfields, Encounter, Boss, Objectives und Enemy-Behaviour;
- `PersistentBaseWorldBinding` besitzt seine world-lokale Runtime-Realisierung; Composite-/Reward-
  Materialisierung und World-Konflikte dürfen nicht als fachfremde Flow-Logik verbleiben;
- Shared-Service-Bindings werden als konkrete scoped Bindings erzeugt und vom passenden Runtime-
  Owner wieder gelöst.

Der Composer selbst besitzt keinen langlebigen Gameplay-State und wird nicht als Service Locator
weitergereicht. Ein monolithischer `WorldComposer`, der nur den bisherigen God-Coordinator unter
neuem Namen reproduziert, erfüllt dieses Ziel ausdrücklich nicht.

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
- direkte Referenzen und Callbacks auf Activity-Owner werden vor deren Teardown gelöst;
- der Container selbst wird nicht als Dependency weitergereicht.

`SharedRuntimeServices` ist ein **architektonischer Scope-Begriff**, keine Pflicht zu einem großen
Container. Wenn konkrete World-/Activity-Bindings die reale Abhängigkeit klarer ausdrücken, sind
sie einem neuen Sammelobjekt vorzuziehen. Insbesondere darf `ArenaContext` nicht lediglich unter
einem neuen Namen reproduziert werden.

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
- wirklich world-scoped Navigation, falls sie unabhängig von einer Activity existiert;
- Bases;
- World-scoped Bindings;
- `PlayerWorldRuntime`;
- `PersistentBaseWorldBinding`;
- optionales `WorldPresentationBinding` (siehe 6.1);
- `ActivityRuntimeHost`.

`WorldRuntime.update()` tickt nur eigene direkte Child-Owner.  
`WorldRuntime.destroy()` räumt den kompletten materialisierten World-State idempotent ab.

Mutabler World-Gameplay-State überlebt die `WorldRuntime` nicht. Die einzige Ausnahme ist die
lokale Darstellung, und sie überlebt nur über den ausdrücklichen Handoff aus 6.1 – nicht dadurch,
dass ein Feld beim Teardown stehenbleibt.

Die konkrete World-Composition darf aus `WorldRuntime` heraus an eine kleine Composition-Grenze
delegiert werden, wenn der Aufbau viele konkrete Domain-Systeme verbindet. Diese Grenze erzeugt
den Runtime-Graph; `WorldRuntime` bleibt dessen Lifetime-Owner und darf nicht zum Dependency-Bag
für seine Consumer werden.

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

Ein Wechsel `Activity A → Activity B` innerhalb derselben World muss B vollständig neu
materialisieren. Ein leerer Runtime-Wrapper ohne seine Child-Owner erfüllt den Attach-Vertrag
nicht. A wird einschließlich aller Bindings und Child-Owner gelöst, bevor B veröffentlicht und
getickt werden darf; ein World-Rebuild ist dafür weder erforderlich noch zulässig.

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
- ihre Enemy-/Ally-/Boss-Flowfields und die zugehörige Navigation, solange diese ausschließlich
  der Coop-Activity dienen;
- activity-scoped Enemy Behaviour;
- Boss Runtime;
- Objectives;
- Mission Progress;
- Completion State;
- `PlayerActivityRuntime`;
- `ActivityPresentationBinding`.

Eine neue Activity erzeugt keine neue globale Update-Liste und keine neuen Lifecycle-Sonderpfade in `ArenaScene`.

Die konkrete Activity-Composition darf in einer activity-spezifischen Factory/Materializer-Grenze
liegen. Für Coop bedeutet das insbesondere: Navigation/Flowfields, Encounter, Objectives,
Enemy-Behaviour und Specials werden nicht im globalen Flow materialisiert. Der `ActivityRuntimeHost`
kennt weiterhin nur den Lifecycle-Vertrag der fertigen Runtime.

---

## 5. Player-Lifetimes

### `PlayerWorldRuntime`

Enthält nur State, der einen Activity-Wechsel innerhalb derselben World überleben soll.

Beispiele:
- Player Entity;
- wirklich world-scoped Player-Navigation, falls sie einen Activity-Wechsel fachlich überlebt;
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

### 6.1 World Presentation Lifetime und Transition Handoff

World-Gameplay-Lifetime und World-Presentation-Lifetime sind **nicht** identisch.

Der Grund ist fachlich, nicht technisch: Ein Übergang zwischen zwei World-Instanzen ist für den
Spieler ein Bild und nicht ein Schnitt. Ein Match-Exit blendet die zuletzt gesehene World aus,
nachdem ihre Instanz beendet ist; ein Wechsel innerhalb derselben authored World kann dieselbe
gebaute Darstellung weiterverwenden, statt sie identisch neu zu bauen.

Verbindlich:

```text
World-Instanz beendet
      ↓
World-Gameplay-Runtime endet sofort
      ↓
World Presentation endet erst mit ihrem Handoff
```

Die Gameplay-Seite darf daraus keinen Aufschub ableiten. Simulation, Bau-Runtime, Basen,
Navigation und abgeleitete Indizes enden mit der `WorldRuntime`, auch wenn die Darstellung noch
steht.

**`WorldPresentationBinding`** ist die lokale Darstellung genau einer `WorldRuntime`. Es trägt die
gebaute Darstellung samt des Geometriepuffers, den sie adressiert – beides zusammen, weil die
gebauten Objekte in diesen Puffer indexieren. Es trägt ausdrücklich keine Gameplay-/Physics-
Container, keine Collision-Proxies, keinen Runtime-Spatial-Index und keine Entity-Manager. Eine
gemeinsame Builder-Rückgabe darf im aktiven Aufbau als Fassade existieren, muss vor dem Handoff
aber in eine reine Presentation-Projektion und eine mit der `WorldRuntime` fallende Gameplay-
Runtime getrennt werden.

**`WorldPresentationHandoff`** liegt oberhalb der `WorldRuntime` und hält höchstens eine
freigegebene Presentation. Sein Vertrag ist klein und terminal:

```text
release   – die endende WorldRuntime gibt ihre Presentation ab
adopt     – die nächste WorldRuntime übernimmt sie und setzt ihren Geometriepuffer neu
discard   – niemand übernimmt sie; sie wird zerstört
```

Regeln:
- eine freigegebene Presentation hat genau einen terminalen Ausgang: `adopt` oder `discard`;
- solange sie im Handoff liegt, gehört sie keiner `WorldRuntime`; World-scoped Consumer sehen
  deshalb **keine** Presentation mehr;
- der Handoff trägt keinen Gameplay-State und keine World-Identität, sondern nur die Darstellung,
  die ein Übergang weiterzeigt oder weiterverwendet;
- eine Presentation im Handoff wird nicht getickt und nicht simuliert. Sie steht nur noch da.

Ein sichtbarer Exit-Fade verlängert keine Gameplay-Lifetime. Player- und Enemy-Runtimes enden am
Beginn des Fades; falls ihre letzte Darstellung sichtbar bleiben soll, wird sie zuvor als
eingefrorene, physik- und managerfreie Entity-Presentation projiziert und am Fade-Ende verworfen.
Die World-Darstellung folgt währenddessen ausschließlich dem normalen Handoff-Vertrag.

Visuelle Transitionen werden nach den automatisierten Contracts manuell durch den User im
Browser abgenommen. Coding-KIs starten für dieses Refactoring keinen Browser und melden die
konkrete manuelle Prüfliste im Abschluss.

Der letzte Punkt ist zugleich die Teardown-Sicherung: Ein Aufräumschritt der Gameplay-Seite kann
eine übergebene Darstellung nicht mehr erreichen und deshalb auch nicht mehr verändern.

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

Die zugehörige world-lokale Materialisierungslogik – insbesondere Composite-/Reward-Realisierung,
Runtime-Bindings und Konfliktbehandlung – liegt am Binding oder an einem unmittelbar von diesem
Scope besessenen konkreten Collaborator. Der Top-Level-Flow darf diese PB-Details nicht selbst
implementieren.

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

Ownership bestimmt **wer die Update-Semantik eines Scopes besitzt**. Sie erzwingt nicht, dass jede
Runtime mit genau einem beliebigen `update()` an irgendeiner Frame-Stelle vollständig simuliert
werden kann.

Standardfall:

```text
ArenaRuntime.update()
└── direkte Top-Level-Owner

WorldRuntime.update()
└── world-scoped Child-Owner
```

Für fachlich frame-positionierte Activity-Schritte gilt zusätzlich:

```text
ArenaRuntime / bestehender Frame-Owner
    └── benannter Activity-Step an definierter Frame-Position
            └── ActivityRuntime besitzt interne Reihenfolge und Child-Systeme
```

Das ist insbesondere für die aktuelle Coop-Simulation verbindlich: Netzwerk-Synchronisation,
Countdown-/Gameplay-Gates, World-Anteile wie `decoySystem.hostUpdateLifecycle()` und Physik geben
eine reale Frame-Position vor. Der globale Frame-Owner darf deshalb benannte Activity-Schritte wie
`hostSimulationStep` oder `hostPrePhysicsStep` aufrufen, kennt aber **keine** Enemy-, Objective-,
Navigation- oder sonstige interne Systemliste.

`ActivityRuntime.update()` darf für eine Activity leer oder nur für generische Lifetime-Ticks
zuständig sein, wenn ihre reale Simulation über solche benannten Schritte läuft. Entscheidend ist:
Die Activity besitzt die Reihenfolge innerhalb ihres Schritts und eine neue Coop-Mechanik erzeugt
keinen neuen globalen Update-Branch.

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
- nach Teardown bleiben keine alten Timer, Listener, Callbacks, Runtime IDs, scoped Bindings oder Referenzen aktiv;
- was einen Owner überleben soll, wird vor dessen Teardown ausdrücklich übergeben. Ein Teardown, der
  einen Teil bewusst nicht abräumt, ist keine Übergabe, sondern ein unbenannter Besitzer.

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
18. Mutabler World-Gameplay-State überlebt seine `WorldRuntime` nicht. Nur die World Presentation kann länger leben, und ausschließlich über den Handoff aus 6.1.
19. Ein Activity-Attach materialisiert den vollständigen Runtime-Graph; Detach löst alle scoped Bindings und Referenzen vor den Child-Ownern.
20. Ein sichtbarer Exit-Fade verlängert keine World-, Player- oder Enemy-Gameplay-Lifetime, sondern verwendet ausschließlich Presentation-Projektionen.
21. Flow/Lifecycle entscheidet **wann** World oder Activity entsteht; konkrete Gameplay-Runtime-Graphs werden an fachlich passende Composition-Grenzen delegiert.
22. Ein finaler Flow-Owner importiert oder materialisiert keine konkreten Enemy-, Objective-, Flowfield-, Persistent-Base-Composite-, Construction- oder Train-Systemlisten.
23. Composition-Extraktion darf keinen neuen monolithischen Dependency-Bag erzeugen; Ziel ist Context Locality, nicht bloße Dateiverschiebung.
24. Frame-positionierte Activity-Schritte sind zulässig, solange der Frame-Owner nur den benannten Activity-Vertrag kennt und die interne Reihenfolge beim Activity-Owner bleibt.

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
- ein World-Übergang seine Darstellung weiterzeigen oder weiterverwenden kann, ohne dass dafür mutabler World-Gameplay-State stehen bleibt;
- `PlayerWorldRuntime` den Activity-Wechsel überlebt, `PlayerActivityRuntime` nicht;
- PB RoomSession einen World-Wechsel überlebt, WorldBinding nicht;
- stale Completion-/Transaction-Daten keine Progression oder Commits auslösen;
- Host-Simulation ohne lokale Presentation und Preview ohne WorldParticipation weiterhin möglich sind;
- globale nullable Runtime-Felder und manuelle Teardown-/Update-Listen nicht mehr die primäre Lifecycle-Modellierung bilden;
- der Top-Level-Flow keine konkreten World-/Coop-/PB-/Construction-Systemgraphs mehr materialisiert;
- große Composition-Blöcke nicht lediglich in einen neuen God-Composer verschoben wurden, sondern über kleine fachliche Grenzen lokal verständlich sind.

Qualitative Context-Locality-Probe:

> **Muss eine typische Feature-Änderung fachfremde globale Arena-Dateien verstehen oder ändern?**

Wenn regelmäßig ja, ist die Ownership-Grenze noch nicht sauber genug.
