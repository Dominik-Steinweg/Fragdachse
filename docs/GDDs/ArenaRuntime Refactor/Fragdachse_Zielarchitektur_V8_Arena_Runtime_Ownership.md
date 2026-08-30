# Fragdachse – Zielarchitektur V8: Arena Runtime Ownership, Lifetimes & Continuous Migration

**Status:** Verbindliche Architekturgrundlage für das zusammenhängende Arena-Refactoring  
**Stand:** 30.08.2026  
**Repository-Basis der Analyse:** `Dominik-Steinweg/Fragdachse`, Branch `architecture-refactor-pre-phase3`

**V8-Schwerpunkt:** Die Zielarchitektur von V7 bleibt im Kern erhalten. V8 schärft vor allem die Migrationsstrategie: kleinere KI-taugliche Arbeitspakete, verbindliche Integrations-Checkpoints ohne künstliche Release-Gates, ein pragmatischer Network-Scope und ein Stop/Go-Prinzip gegen unnötige Zielabstraktionen.

---

## 1. Zweck dieses Dokuments

Dieses Dokument definiert die Zielarchitektur für den Arena-/World-/Activity-Bereich von **Fragdachse** und dient als gemeinsame Grundlage für die folgenden Refactoring-Schritte.

Das Refactoring soll die technische Basis langfristig:

- robuster,
- verständlicher,
- leichter erweiterbar,
- besser testbar,
- sicherer im Teardown,
- und für Entwickler sowie Coding-KIs mit weniger Kontext erfassbar

machen.

Historisch gewachsene Kopplungen und unklare Verantwortlichkeiten sollen reduziert werden. Neue Features sollen möglichst dort wachsen, wo sie fachlich leben, statt zusätzliche Sonderfälle in globalen Arena-Klassen zu erzeugen.

Das zentrale Qualitätsziel lautet:

> **Neue Komplexität soll dort entstehen, wo das neue Feature fachlich lebt – nicht im globalen Lifecycle.**

Und für die tägliche Arbeit:

> **Eine typische Änderung soll möglichst nur einen fachlichen Owner, wenige Verträge und die zugehörigen Tests betreffen.**

Das Refactoring selbst wird als **eine zusammenhängende Migration** verstanden. Die später beschriebenen Phasen strukturieren Arbeitsreihenfolge und Komplexität, sind aber keine Release-, Merge- oder Stabilitätsgrenzen.

> **Zwischen zwei Refactoring-Phasen muss kein vollständig stabiler, releasbarer oder bereits architektonisch sauberer Zwischenstand entstehen. Der erste verbindlich stabile Zustand ist der finale Cutover nach Abschluss der gesamten Migration.**

Dadurch dürfen temporäre Compatibility-Pfade, noch nicht vollständig migrierte Consumer und bewusst unvollständige Zwischenzustände bestehen, sofern ihre Richtung eindeutig ist und sie im selben Gesamtrefactoring wieder entfernt werden.

---

# 2. Ausgangslage im aktuellen Repository

Die aktuelle Codebasis enthält bereits mehrere wichtige Bausteine der Zielarchitektur. Das Refactoring soll diese nicht ersetzen, sondern konsequent weiterführen.

## 2.1 Bereits gute Grundlagen

### `WorldLifecycle`

`src/world/WorldLifecycle.ts` trennt bereits sauber:

```text
World Identity
≠
lokale World Runtime
```

Die replizierte World-Instanz kann bestehen bleiben, obwohl die lokale Runtime detached wurde.

Insbesondere sind heute bereits getrennt:

```text
detach local World Runtime
≠
end World instance
```

Diese Semantik bleibt erhalten.

### `ActivityLifecycle`

`src/world/ActivityLifecycle.ts` besitzt bereits einen eigenen Lifecycle innerhalb einer World.

Damit gilt bereits:

```text
World kann ohne Activity existieren
Activity kann nicht ohne World existieren
```

Auch Activity-Identität und lokale Activity-Materialisierung sind konzeptionell bereits getrennt.

### `WorldRuntimeContext`

`src/world/WorldRuntimeContext.ts` ist bereits ein kleiner, kanonischer World-Read-Kontext für:

- World Descriptor / Identity,
- Definition,
- Metrics,
- Bases,
- Persistent-Base-Site.

Diese Richtung bleibt ausdrücklich erhalten.

### World Participation / Presentation / Capabilities

Die aktuellen Verträge trennen bereits wichtige orthogonale Fragen:

```text
WorldParticipation
WorldPresentation
PlayerCapabilities
```

Damit sind unter anderem bereits folgende Fälle ausdrückbar:

- Host simuliert eine World, ohne selbst daran teilzunehmen.
- Preview ohne WorldParticipation.
- Observer ohne Gameplay-Authority.
- World ohne Activity.

Diese Konzepte sollen nicht wieder zusammengeführt werden.

---

## 2.2 Aktuelle Hauptkopplungen

### `ArenaContext`

`src/scenes/arena/ArenaContext.ts` enthält aktuell gleichzeitig:

- scene-langlebige Infrastruktur,
- World-State,
- World-Systeme,
- Activity-/Mission-Systeme,
- Enemy-Systeme,
- Persistent-Base-Zustand,
- Player-Systeme,
- Navigation,
- Objective-Systeme,
- nullable Runtime-Felder.

Damit dient `ArenaContext` heute faktisch als großer gemeinsamer Dependency- und State-Container.

Das Refactoring soll ihn nicht durch einen neuen Container gleichen Umfangs ersetzen.

### `ArenaLifecycleCoordinator`

`ArenaLifecycleCoordinator` besitzt heute bereits richtige Lifecycle-Bausteine wie:

- `WorldLifecycle`,
- `PlayerWorldRuntime`,
- Persistent-Base-Room-State,

enthält gleichzeitig aber noch große Teile von:

- World-Aufbau,
- World-Teardown,
- Activity-Aufbau,
- Coop-Mission-Aufbau,
- Participation,
- Readiness,
- Result Handling,
- Persistent-Base-Abschluss,
- Presentation-Umschaltung,
- Übergangslogik.

Das Ziel ist deshalb **nicht**, diese Klasse lediglich umzubenennen, sondern ihre unterschiedlichen Lifetimes auf echte Owner zu verteilen.

### `HostUpdateCoordinator`

`HostUpdateCoordinator` ist aktuell scene-langlebig und tickt große Teile der Host-Simulation zentral.

Er kennt unter anderem:

- Enemy AI,
- Flowfields,
- Player-Systeme,
- Physics,
- Combat,
- Projectiles,
- Explosions,
- Area Effects,
- Activity-/Mission-Zustände,
- Presentation-nahe Zustände,
- Network Tick / Snapshots.

Ein Ownership-Refactoring wäre unvollständig, wenn nur Create/Destroy verschoben würden, der globale Update-Pfad aber weiterhin jedes Activity-System einzeln kennen müsste.

### `ClientUpdateCoordinator`

Auch `ClientUpdateCoordinator` bündelt derzeit:

- Snapshot-Konsum,
- Player-Runtime-Synchronisation,
- Prediction,
- Interpolation,
- World-State,
- Coop-spezifische Auflösung,
- HUD,
- Presentation,
- direkte NetworkBridge-Zugriffe.

Diese Verantwortungen müssen nicht alle in dieser Refactoring-Phase vollständig zerlegt werden. Neue Runtime-Owner dürfen aber nicht wieder von diesem globalen Container abhängig gemacht werden.

### `RpcCoordinator`

`RpcCoordinator` hängt aktuell an:

- `NetworkBridge`,
- dem gesamten `ArenaContext`,
- `ArenaLifecycleCoordinator`,
- Renderer-/Client-Komponenten.

Langfristig sollen neue Runtime-/Domain-Komponenten stattdessen über kleine fachliche Ports angebunden werden.

### `PlayerWorldRuntime`

`PlayerWorldRuntime` enthält heute bereits Activity-Wissen, beispielsweise das Feature `missionStatus`.

Damit ist ein World-Lifetime-Owner teilweise von der laufenden Activity abhängig.

Diese Vermischung wird im Zielzustand getrennt.

### Persistent Base

`PersistentBaseContributionStore` enthält heute mehrere Lifetimes gleichzeitig:

```text
committed Room State
Mission Baseline
Mission Working State
Runtime-ID-Bindings
Commit / Rollback
```

Diese Zustände sollen zukünftig getrennte Owner erhalten.

---

# 3. Zentrale Architekturprinzipien

## 3.1 Lifecycle und Runtime sind verschiedene Konzepte

> **Ein Lifecycle besitzt Identität und Übergänge einer Instanz. Ein Runtime-Owner besitzt die lokale Realisierung genau einer Lifetime und räumt sie vollständig auf.**

Beispiel:

```text
WorldLifecycle
= World Identity / Revision / Übergänge

WorldRuntime
= lokale mutable Realisierung dieser World
```

Dasselbe gilt für Activities.

---

## 3.2 Runtime-Hierarchie beschreibt Lifetimes, nicht Features

Die Hierarchie beantwortet:

> **Wie lange lebt dieser Zustand?**

Nicht:

> **Zu welchem Feature gehört dieser Code?**

Beispiel:

```text
Combat
Projectile
Damage
Fire
Navigation
```

sind fachliche Mechaniken.

Sie werden nicht automatisch Child-Systeme einer Coop-Activity, nur weil Coop sie verwendet.

---

## 3.3 Composition Owner sind keine Dependency Bags

Ein Composition Owner darf:

- direkte Child-Owner besitzen,
- sie erzeugen,
- verbinden,
- ticken,
- zerstören.

Er darf nicht als allgemeiner Service-Container weitergereicht werden.

Also nicht:

```ts
new SomeSystem(arenaRuntime)
new SomeSystem(worldRuntime)
new SomeSystem(sharedRuntimeServices)
```

sondern:

```ts
new SomeSystem(combatPort, worldReadPort, ...)
```

und nur mit den Abhängigkeiten, die tatsächlich benötigt werden.

Diese Regel gilt ausdrücklich für:

```text
ArenaRuntime
WorldRuntime
SharedRuntimeServices
ActivityRuntime
```

---

## 3.4 Update Ownership folgt Runtime Ownership

> **Ein Parent tickt seine direkten Child-Owner. Er tickt nicht deren einzelne internen Systeme.**

Ziel:

```text
ArenaRuntime.update()
├── SharedRuntimeServices.update(...)
└── WorldRuntime?.update(...)
    ├── world-scoped Runtime
    └── ActivityRuntimeHost.update(...)
        └── ActivityRuntime?.update(...)
```

Nicht:

```text
ArenaRuntime.update()
├── coopBoss?.update()
├── encounter?.update()
├── enemyAbility?.update()
├── missionProgress?.update()
├── ftdDayNight?.update()
└── ...
```

Eine neue Activity darf deshalb keine wachsende Liste globaler Update-Branches verursachen.

---

## 3.5 Teardown folgt tatsächlichem Besitz

> **Ein Runtime-Owner räumt den Zustand ab, den er tatsächlich materialisiert hat.**

Teardown darf nicht davon abhängen, aus aktuellem Policy-State erneut herzuleiten, welche Module vermutlich einmal aufgebaut wurden.

Wenn ein Owner optionale Child-Module oder Player-Features erzeugt, muss er wissen beziehungsweise festhalten, was wirklich aktiv ist.

Damit wird verhindert:

```text
Attach mit Policy A
Policy ändert sich
Detach rekonstruiert Policy B
→ Teil des alten Zustands bleibt liegen
```

---

## 3.6 Teardown ist vollständig, symmetrisch und idempotent

Jeder Runtime-Owner besitzt:

```text
create / attach
update
destroy / detach
```

in einer geschlossenen Verantwortung.

Ein zweiter `destroy()`-Aufruf ist ein No-op.

Child-Owner werden grundsätzlich in umgekehrter Aufbau-Reihenfolge zerstört, sofern Abhängigkeiten dies verlangen.

---

## 3.7 Context Locality ist ein explizites Qualitätsziel

Architekturqualität wird nicht nur daran gemessen, ob Klassen klein sind.

Wichtiger ist:

> **Wie viel Code muss verstanden werden, um eine Änderung sicher durchzuführen?**

Eine lokale Activity-Mechanik soll möglichst nur benötigen:

```text
Activity Runtime
betroffenes Domain-System
kleine Ports
Tests
```

und nicht:

```text
ArenaScene
ArenaContext
ArenaLifecycleCoordinator
HostUpdateCoordinator
ClientUpdateCoordinator
RpcCoordinator
NetworkBridge
```

---

## 3.8 Zielbild ist Richtung, kein Klassenerzeugungsplan

> **Eine im Zielbild benannte Rolle wird nur als eigene Abstraktion materialisiert, wenn nach den vorherigen Migrationsschritten noch ein realer eigenständiger Vertrag dafür existiert.**

Das gilt insbesondere für:

```text
ArenaFlowCoordinator
fachliche Network Ports
Result-/Progression-Use-Cases
Bindings
weitere kleine Owner
```

Das Diagramm beschreibt Verantwortungs- und Dependency-Grenzen. Es verpflichtet nicht dazu, für jede dort benannte Rolle unabhängig vom verbleibenden Code eine neue Klasse oder ein neues Interface zu erzeugen.

Wenn ein bestehender Owner nach vorherigen Extraktionen bereits exakt die gewünschte Verantwortung besitzt, darf er in diese Rolle überführt beziehungsweise entsprechend benannt werden, statt einen zusätzlichen Wrapper einzuführen.

Für Coding-KIs gilt deshalb bei jedem neuen Architekturbaustein die Stop/Go-Frage:

```text
Existiert ein konkreter verbleibender Verantwortungsbereich?
Hat er eine eigenständige Lifetime, Boundary oder Orchestrierungsaufgabe?
Gibt es mindestens einen realen Consumer?
Reduziert die Abstraktion Kopplung oder Context-Bedarf tatsächlich?
```

Wenn diese Fragen nicht ausreichend mit **ja** beantwortet werden können, wird der Baustein nicht nur deshalb erzeugt, weil er im Zielbild benannt ist.

---

# 4. Zielbild

```text
ArenaScene
│
├── SceneInfrastructure
│   ├── Input
│   ├── Audio Infrastructure
│   ├── Presentation Infrastructure
│   ├── NetworkSession / Network Ports
│   │   └── heutiger NetworkBridge als Compatibility Facade
│   └── Diagnostics
│
└── ArenaRuntime
    │
    ├── SharedRuntimeServices
    │   ├── Combat
    │   ├── Projectile
    │   ├── Physics
    │   ├── Fire / Ground Fire
    │   └── weitere technisch scene-langlebige Domain-Systeme
    │
    ├── ArenaFlowCoordinator
    ├── ParticipationCoordinator
    ├── ResultApplication
    │
    ├── PersistentBaseRoomSession
    │   └── optional PersistentBaseTransaction
    │
    └── WorldLifecycle
        │
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

Dauerhafte persönliche Progression liegt außerhalb dieser Runtime-Hierarchie:

```text
Profile / Progression Persistence
├── XP
├── Items
├── Upgrades
├── persönliche Persistent-Base-Blueprints
└── zukünftige FDTD-Progression
    ├── Pfand / Ressourcen
    ├── Expansion / Threat
    └── Händler-Freischaltungen
```

---

# 5. `ArenaScene`

`ArenaScene` bleibt der Phaser-Composition-Root.

Sie besitzt:

```text
Phaser Lifecycle
SceneInfrastructure
ArenaRuntime
```

Sie kennt langfristig nicht:

```text
einzelne Mission Systems
Enemy Systems
PB Working State
Activity-spezifische Gameplay-Systeme
einzelne World-Systeme
Activity-spezifische Progressionsregeln
Activity-spezifische Result-Anwendung
```

`ArenaScene` darf Komponenten erzeugen und Top-Level-Infrastruktur verbinden.

Sie besitzt keine fachlichen Gameplay-Regeln.

Eine neue Activity darf keine neuen Lifecycle-Sonderpfade in `ArenaScene` erfordern.

---

# 6. `ArenaRuntime`

`ArenaRuntime` ist der scene-langlebige Composition Owner des Arena-Layers.

Er hält:

```text
ArenaRuntime
├── SharedRuntimeServices
├── ArenaFlowCoordinator
├── ParticipationCoordinator
├── ResultApplication
├── PersistentBaseRoomSession
└── WorldLifecycle
```

Er besitzt keine Gameplay-Regeln.

## Harte Anti-God-Object-Regel

`ArenaRuntime` darf nicht Nachfolger von `ArenaContext` werden.

Insbesondere:

```text
kein:
SomeSystem(arenaRuntime)
```

sondern:

```text
SomeSystem(specificPortA, specificPortB)
```

`ArenaRuntime` wird nicht als allgemeiner Dependency-Container an Systems, Renderer, Coordinators oder Gameplay-Code weitergereicht.

---

# 7. `SharedRuntimeServices`

Einige Systeme sind technisch derzeit scene-langlebig, obwohl sie fachlich World- oder Activity-Bezug haben.

Dazu gehören heute beispielsweise:

```text
CombatSystem
ProjectileManager
HostPhysicsSystem
FireSystem
weitere bereits langlebige Domain-Systeme
```

Diese Systeme werden in diesem Refactoring nicht künstlich neu erzeugt.

`SharedRuntimeServices` beschreibt deshalb eine **technische Übergangs-Lifetime**, keine Feature-Hierarchie.

## Regeln

Ein Shared Service:

- entscheidet nicht selbst, wann eine World beginnt oder endet;
- entscheidet nicht selbst, wann eine Activity beginnt oder endet;
- darf keinen versteckten World-/Activity-State zwischen Instanzen behalten;
- wird über explizite Bindings an einen Scope gebunden;
- wird beim Detach vollständig von diesem Scope gelöst.

Der Container `SharedRuntimeServices` selbst wird nicht als Dependency weitergereicht.

Neue world-/activity-scoped Gameplay-Systeme sollen nicht automatisch scene-langlebig angelegt werden.

---

# 8. `WorldLifecycle`

`WorldLifecycle` besitzt die Identität einer konkreten World-Instanz:

```text
WorldDescriptor
worldRevision
creating
active
destroying
publish / observe
end
```

Die bestehende Trennung bleibt verbindlich:

```text
detach local WorldRuntime
≠
end World instance
```

Eine lokal gebaute `WorldRuntime` kann entfernt und erneut angehängt werden, ohne dass die replizierte World-Instanz endet.

Die World Identity darf einen lokalen Runtime-Rebuild überleben.

Der bestehende `WorldLifecycle` wird weiterentwickelt, nicht ersetzt.

---

# 9. `ActivityLifecycle`

`ActivityLifecycle` besitzt:

```text
ActivityDescriptor
activityRevision
begin
activate
detach
end
```

Eine Activity benötigt eine World.

Eine World benötigt keine Activity.

Eine Activity derselben World darf wechseln, ohne die World neu zu erzeugen.

Die Activity Identity darf einen lokalen Runtime-Detach überleben.

Auch der bestehende `ActivityLifecycle` wird weiterentwickelt, nicht neu erfunden.

---

# 10. `WorldRuntime`

`WorldRuntime` besitzt die lokale Realisierung genau einer World-Instanz.

Dazu können gehören:

```text
WorldRuntimeContext
ArenaLayout / World-Geometrie
Placement / Rock Runtime
World Navigation
Base Runtime
PlayerWorldRuntime
World-scoped Shared-Service-Bindings
PersistentBaseWorldBinding
optionale WorldPresentationBinding
ActivityRuntimeHost
```

## Anti-God-Regel

`WorldRuntime` ist selbst primär Composition Owner.

Es implementiert nicht sämtliche World-Mechaniken direkt.

Es besitzt direkte Child-Owner und kleine Bindings.

Es wird nicht als allgemeiner Context an seine Kinder weitergereicht.

## Update

`WorldRuntime.update()` darf:

- eigene kleine world-scoped Koordination ausführen,
- direkte Child-Owner ticken,
- den `ActivityRuntimeHost` ticken.

Es darf keine Liste aller konkreten Activity-Systeme kennen.

## Destroy

`WorldRuntime.destroy()` ist vollständig und idempotent.

Es entfernt insbesondere:

```text
ActivityRuntime
PlayerWorldRuntime
WorldPresentationBinding
PersistentBaseWorldBinding
World-Bindings langlebiger Services
Navigation
Placement / Geometry Runtime
Listener
Callbacks
Timer
World-spezifische Runtime IDs
```

---

# 11. `WorldRuntimeContext`

`WorldRuntimeContext` bleibt ein kleiner kanonischer Read-Kontext.

Er enthält primär:

```text
World Identity
World Definition
World Metrics
Bases
Persistent-Base-Site
weitere unveränderliche beziehungsweise kanonisch aufgelöste World-Daten
```

Er enthält nicht:

```text
EnemyManager
Mission Systems
CombatSystem
ProjectileManager
Player Runtime
Persistent-Base Working State
Activity Progress
Renderer
NetworkBridge
Service Container
```

Die aktuelle Richtung von `src/world/WorldRuntimeContext.ts` ist ausdrücklich beizubehalten.

---

# 12. World Bindings für langlebige Systeme

Bestehende scene-langlebige Systeme müssen nicht künstlich zu World-Systemen werden.

`WorldRuntime` kann sie über kleine Bindings verwenden.

Beispiel:

```text
WorldRuntime
└── CombatWorldBinding
    ├── bind(worldContext)
    ├── update optional
    └── detach()
```

Ein Binding besitzt:

```text
Initialisierung des world-scoped Zustands
Bindung an genau diese World
Reset
Detach
Teardown-Reihenfolge
```

Der Shared Service bleibt Domain-Owner seiner Mechanik.

Der Binding-Owner besitzt die Lifetime-Verbindung.

---

# 13. `ActivityRuntimeHost`

`ActivityRuntimeHost` gehört dem `WorldRuntime`.

Er besitzt genau den lokalen Slot für die aktuell materialisierte ActivityRuntime.

Seine Verantwortung ist klein:

```text
attach ActivityRuntime
detach ActivityRuntime
update ActivityRuntime
destroy ActivityRuntime
```

Er kennt nicht die internen Systeme der konkreten Activity.

`ActivityLifecycle` steuert diesen Host über einen schmalen Vertrag.

Es wird kein generisches Plugin-/Registry-/Factory-Framework nur für diesen Zweck gebaut.

Abstraktionen entstehen erst bei realem Bedarf.

---

# 14. `ActivityRuntime`

`ActivityRuntime` besitzt ausschließlich Zustand und Systeme, deren Lifetime an eine konkrete Activity gebunden ist.

Konkrete Implementierungen können sein:

```text
CoopMissionRuntime
DeathmatchRuntime
TeamDeathmatchRuntime
CaptureTheBeerRuntime
FromDachsTillDawnRuntime
```

Beispiel:

```text
CoopMissionRuntime
├── Mission State
├── Encounter / Spawn Runtime
├── Objectives
├── Boss / Mission Progress
├── activity-scoped Enemy Behaviour
├── PlayerActivityRuntime
├── ActivityPresentationBinding
└── Completion State
```

## Update Ownership

Die Activity tickt ihre direkten Child-Owner selbst.

Beispiel:

```text
CoopMissionRuntime.update()
├── encounterRuntime.update()
├── enemyRuntime.update()
├── objectiveRuntime.update()
├── bossRuntime.update()
└── playerActivityRuntime.update()
```

Der globale Host-Update-Pfad kennt diese einzelnen Systeme anschließend nicht mehr.

---

# 15. Runtime-Hierarchie ≠ Feature-Hierarchie

Generische Mechaniken bleiben bei ihren Domain-Ownern.

Beispiele:

```text
Projectile
Combat
Damage
Detonation
Charges
Dodge
AI Geometry
Fire / Ground Fire
Navigation
```

Eine Activity verwendet diese Mechaniken.

Sie übernimmt sie nicht allein deshalb in ihre Ownership.

Ein neuer Gegner wie der Brandstifter soll hauptsächlich betreffen:

```text
Enemy
AI
Projectile
Combat
Presentation
Tests
```

Er darf keine Änderungen benötigen an:

```text
ArenaScene
ArenaRuntime
WorldLifecycle
ActivityLifecycle
ArenaFlowCoordinator
Persistent Base
```

---

# 16. Activity-interne Phasen

Gameplay-Phasen erzeugen nicht automatisch neue Runtime-Lifetimes.

Beispiel FDTD:

```text
FromDachsTillDawnRuntime

Day
→ Dusk
→ Night
→ Dawn
```

Diese Phasen gehören zunächst zum State und Flow derselben Activity.

Eine zusätzliche Sub-Runtime ist nur gerechtfertigt, wenn ein Zustand:

```text
unabhängig aufgebaut
vollständig beendet
und später neu erzeugt
```

werden kann.

Es gibt keinen Architekturzwang:

```text
World
→ Activity
→ Round
→ Phase
```

sondern:

```text
World
└── Activity
    └── optional echte subordinate Lifetimes
```

---

# 17. `PlayerWorldRuntime`

`PlayerWorldRuntime` gehört vollständig zur World-Lifetime.

Er besitzt den atomaren Aufbau und Abbau des Player-Anteils dieser World.

Dazu können gehören:

```text
Player Entity
world-scoped Player Targeting
world-scoped Navigation Binding
world-scoped Build State
world-scoped Loadout Runtime
world-scoped Combat State
```

Verbindliche Regel:

> **Ein Zustand gehört nur dann in `PlayerWorldRuntime`, wenn er einen Activity-Wechsel innerhalb derselben World überleben soll.**

## Materialization Tracking

`PlayerWorldRuntime` muss wissen, welche Module es für einen Spieler tatsächlich aufgebaut hat.

Der spätere Detach darf nicht aus der dann aktuellen Activity-/Capability-Policy rekonstruieren, was früher möglicherweise aufgebaut wurde.

---

# 18. `PlayerActivityRuntime`

Activity-spezifischer Player-State gehört nicht in `PlayerWorldRuntime`.

Dafür besitzt eine konkrete Activity optional:

```text
PlayerActivityRuntime
```

Beispiel Coop:

```text
CoopMissionRuntime
└── PlayerActivityRuntime
    ├── Activity Participation
    ├── Respawn / Life State
    ├── Objective State
    ├── activity-scoped Player Modifiers
    └── Reward Eligibility Projection
```

Bei Activity-Wechsel:

```text
PlayerWorldRuntime bleibt bestehen

PlayerActivityRuntime A
→ destroy

PlayerActivityRuntime B
→ create
```

Ein Player muss nicht vollständig aus der World entfernt und neu gespawnt werden, nur weil sich die Activity ändert.

---

# 19. Participation

Participation bleibt orthogonal zu World und Activity.

Der kanonische World-Vertrag bleibt:

```text
none
joining
interactive
observer
leaving
```

Der `ParticipationCoordinator` orchestriert:

```text
Admission
Join / Leave
WorldParticipation-Übergänge
PlayerWorldRuntime Attach / Detach
```

Er besitzt nicht sämtliche daraus abgeleiteten Zustände.

---

# 20. Activity Participation

Die Teilnehmer-/Spectator-Rolle einer konkreten Activity bleibt getrennt von `WorldParticipation`.

```text
WorldParticipation
= Bin ich in dieser World und wie?

ActivityParticipation
= Nehme ich an dieser konkreten Activity teil?
```

Daraus können abgeleitet werden:

```text
darf ich respawnen?
bin ich reward-berechtigt?
bin ich Spectator dieser Activity?
```

## Migrationsregel

Der heute vorhandene `RoundParticipationState` bleibt während der Migration die Compatibility-Repräsentation der ActivityParticipation.

Es wird nicht parallel ein zweiter mutable ActivityParticipation-State eingeführt.

Eine spätere Verallgemeinerung darf erst erfolgen, wenn der neue Activity-Owner die Semantik tatsächlich tragen kann.

---

# 21. Capabilities

`PlayerCapabilities` bleiben reine abgeleitete Policy.

Ziel:

```text
WorldParticipation
+ World Policy
+ Activity Policy
→ Capabilities
```

Sie werden nicht als zweite mutable Wahrheit gespeichert.

Beispiele:

```text
canMove
canFight
canBuild
canDismantle
canInteract
canUseActivityActions
canControlCamera
```

Host und Client dürfen dieselbe reine Policy verwenden.

Authority bleibt beim Host.

## Keine wachsenden Activity-Switches

Neue Activities sollen nicht zu einem globalen:

```ts
switch (activityKind) {
  case 'coop-mission':
  case 'from-dachs-till-dawn':
  case ...
}
```

in zentralen Capability-Resolvern führen.

Sobald mindestens zwei echte Activity-Consumer unterschiedliche Policy benötigen, liefert die Activity beziehungsweise ihre Definition eine kleine aufgelöste Activity Policy.

---

# 22. Presentation

Presentation bleibt von Simulation und Participation getrennt.

Scene-langlebig:

```text
Renderer Infrastructure
Audio Infrastructure
FX Infrastructure
UI Infrastructure
```

World-lokal:

```text
WorldPresentationBinding
```

Activity-lokal:

```text
ActivityPresentationBinding
```

---

## 22.1 `WorldPresentationBinding`

Dieses Binding repräsentiert die World-Darstellung auf diesem Peer.

Mögliche Modi:

```text
none
preview
interactive
```

Damit bleibt möglich:

```text
Host simuliert World ohne lokale Presentation

Peer sieht World als Preview ohne WorldParticipation

Observer sieht World ohne Gameplay-Authority
```

Presentation besitzt keine Gameplay-Authority.

---

## 22.2 `ActivityPresentationBinding`

Activity-spezifische UI-/FX-/Audio-Verknüpfung gehört nicht in `ArenaScene`.

Beispiele:

```text
Coop Mission
├── Objective HUD
├── Objective Announcements
├── Map Event Presentation
└── Mission-specific overlays

FDTD
├── Day/Night Presentation
├── Pfand / Ressourcen HUD
├── Activity Objectives
└── Activity Announcements
```

Das Binding verwendet nur die scene-langlebige Presentation Infrastructure.

Es besitzt keine Simulation und keine Authority.

Damit kann eine neue Activity eigene Darstellung erhalten, ohne `ArenaScene` zu erweitern.

---

# 23. Persistenz nach echter Lifetime

Persistenz wird konsequent nach tatsächlicher Lifetime getrennt.

---

## 23.1 Profile-Lifetime

Dauerhaft persönlicher Zustand:

```text
XP
Items
Upgrades
Persistent-Base-Blueprints
zukünftige FDTD-Progression
```

Dieser Zustand gehört nicht der Arena-, World- oder Activity-Runtime.

Domain-/Runtime-Code schreibt nicht direkt in Local Preferences.

Dafür werden kleine Persistence Ports beziehungsweise Use-Cases verwendet.

---

## 23.2 `PersistentBaseRoomSession`

`PersistentBaseRoomSession` besitzt den gemeinsam host-validierten room-langlebigen Persistent-Base-Zustand.

Dazu gehören:

```text
Contributions
Rewards / Session Projection
Owner-/Session-Bindings
Committed State
Session Revisions
```

Sie darf mehrere Worlds und Activities überleben.

Sie enthält keine:

```text
World Runtime IDs
World-Geometrie
Activity Working State
```

---

## 23.3 `PersistentBaseTransaction`

Activity-gebundener Working State erhält eine eigene Lifetime.

```text
PersistentBaseRoomSession
└── optional PersistentBaseTransaction
    ├── worldRevision
    ├── activityRevision
    ├── transactionId
    ├── Baseline
    ├── Working State
    ├── commit
    └── rollback
```

Eine Transaction entsteht nur, wenn eine Activity einen temporären Arbeitsstand benötigt.

Beispiel:

```text
Coop Mission startet
→ transaction.begin()

Victory
→ commit()

Defeat / Abort
→ rollback()

Transaction endet
```

## Terminale Semantik

Eine Transaction wird genau einmal terminal:

```text
commit
oder
rollback
```

Danach dürfen spätere oder stale Operationen keinen neuen Zustand mehr verändern.

Die Identity verhindert, dass ein verspäteter Abschluss einer alten Activity eine Transaction einer neuen Activity beeinflusst.

---

## 23.4 `PersistentBaseWorldBinding`

`PersistentBaseWorldBinding` gehört dem `WorldRuntime`.

Es besitzt ausschließlich die Repräsentation der Persistent Base in genau dieser World:

```text
Site / Anchor
Build Area
Composite-Materialisierung
Runtime IDs
World-Konflikte
World-Repräsentation
```

Beim World-Wechsel stirbt diese Bindung vollständig.

Die `PersistentBaseRoomSession` darf weiterleben.

Eine aktive Transaction muss fachlich abgeschlossen werden, bevor ihr Activity-Owner endgültig endet.

---

# 24. Activity Completion

Eine Activity schreibt niemals selbst direkt in Local Persistence.

Sie erzeugt ein fachliches Ergebnis.

Es gibt keine Annahme, dass jede Activity nur:

```text
victory
defeat
aborted
```

kennt.

Stattdessen gibt es eine gemeinsame Hülle:

```text
ActivityCompletion
├── worldRevision
├── activityRevision
├── definitionId
├── kind
│
├── completed
│   └── activity-specific result
│
└── aborted
    └── optional reason
```

Beispiele:

```text
CoopMissionResult
└── victory | defeat

DeathmatchResult
├── winnerIds
└── scores

CaptureTheBeerResult
├── winningTeam
└── score

FromDachsTillDawnResult
├── survivedUntil
├── collectedResources
└── retainedProgress
```

Revisionen gehören zur Completion-Hülle, damit stale Results zuverlässig verworfen werden können.

---

# 25. Result Application / Progression Use-Cases

Zwischen Activity und Persistence liegt eine explizite Anwendungsschicht:

```text
ActivityCompletion
      ↓
ResultApplication
├── PersistentBase Outcome Use Case
├── Progression Use Case
├── Reward Use Case
├── Unlock Use Case
├── Statistics Use Case
└── Result Presentation Model
```

Diese Schicht entscheidet, welche Konsequenzen ein fachliches Activity-Ergebnis hat.

Dadurch gilt:

```text
Activity
→ kennt keine Local Persistence

ArenaScene
→ kennt keine Coop-spezifische XP-/Reward-Regel

PersistentBase
→ kennt kein globales RoundConclusion
```

Neue FDTD-Progression kann später denselben Abschlussweg verwenden, ohne den Arena-Lifecycle zu erweitern.

---

# 26. Host und Client

Es gibt keine getrennten fachlichen Runtime-Hierarchien.

Dieselbe Struktur wird rollenabhängig zusammengesetzt:

```text
ActivityRuntime
├── gemeinsame fachliche Struktur
├── Host Authority Components
└── Client Replica / Prediction / Presentation Components
```

Host-only Simulation wird nur auf dem Host erzeugt.

Clients implementieren dieselbe Gameplay-Regel nicht unabhängig ein zweites Mal.

Gemeinsame deterministische Policies können auf beiden Seiten verwendet werden.

Authority bleibt eindeutig beim Host.

---

# 27. Network

Gameplay- und Runtime-Code kennen keine PeerJS-/Transportdetails.

Zielrichtung:

```text
Runtime / Domain
      ↕
kleine fachliche Network Ports, wo eine echte Boundary besteht
      ↕
Network-/RPC-Adapter / Compatibility Facade
      ↕
NetworkBridge / Transport
```

Der heutige `NetworkBridge` bleibt während der Migration als Compatibility Facade bestehen.

Während dieses Refactorings werden nicht gleichzeitig verändert:

```text
Wire Keys
World-/Activity-Revisionssemantik
Transport
Tick Rates
Authority-Modell
RPC-Grundverhalten
```

Die Trennung verfolgt **keine Bridge-freie Codebasis als Selbstzweck**. Entscheidend ist, dass fachlicher Runtime-/Domain-Code nicht an die globale Netzwerkfassade gekoppelt bleibt. Explizite Netzwerkgrenzen dürfen die konkrete Infrastruktur weiterhin kennen.

---

## 27.1 Boy-Scout-Regel für Runtime und Domain

Neuer Runtime-/Domain-Code importiert `NetworkBridge` beziehungsweise den globalen `bridge` nicht direkt.

Wenn neuer fachlicher Code Netzwerkzugriff benötigt, entsteht ein kleiner Port **nur dann**, wenn dadurch eine reale fachliche Boundary ausgedrückt wird.

Beispiele:

```text
EnemySpawnReplicationPort
PersistentBaseSessionPort
ActivityResultPublisher
WorldLifecycleNetworkPort
PlayerInputReadPort
WorldSnapshotReadPort
```

Keine allgemeine `NetworkService`-Abstraktion wird nur für das Refactoring eingeführt.

Ebenso werden nicht reflexartig Ein-Methoden-Interfaces um jeden bestehenden `bridge`-Aufruf gelegt. Ports werden nach fachlicher Grenze geschnitten, nicht nach Anzahl der API-Aufrufe.

---

## 27.2 Explizite Infrastrukturgrenzen dürfen `NetworkBridge` kennen

Folgende Arten von Code dürfen als bewusste Adapter-/Infrastrukturschicht direkt an `NetworkBridge` beziehungsweise `bridge` hängen:

```text
RPC-Registrierung / RPC-Adapter
NetworkSession / Compatibility Facade
Snapshot-Transportadapter
Transport-nahe Replikationsadapter
```

Diese Klassen dürfen jedoch keine fachlichen Gameplay-Regeln akkumulieren.

Das Ziel ist deshalb:

```text
Domain / Runtime
→ bridge-frei

explizite Network Boundary
→ darf bridge kennen

Transport
→ unverändert
```

---

## 27.3 Phasenregel

Network Ports entstehen bereits während früherer Refactoring-Phasen, sobald neu migrierter Runtime-/Domain-Code eine Netzwerkgrenze benötigt.

Die spätere Boundary-Cleanup-Phase prüft systematisch die verbliebenen Zugriffe und klassifiziert sie:

```text
fachlicher Runtime-/Domain-Zugriff
→ auf passenden Port migrieren

legitimer Infrastruktur-/Adapter-Zugriff
→ darf bestehen bleiben

unklare Mischverantwortung
→ fachliche Regel aus Adapter herauslösen
```

Damit ist die spätere Network-Arbeit ein gezielter Boundary-Cutover und kein dogmatisches Ersetzen sämtlicher `bridge`-Nutzungen.

---

# 28. Authoring

Die bestehende Trennung bleibt erhalten:

```text
WorldDefinition
= Geometrie und World-Grundlage

ActivityDefinition
= Gameplay innerhalb einer World
```

FDTD kommt später als konkrete Activity-Definition und Runtime hinzu.

Zufällige Szenarien werden aus kontrollierten authored Bausteinen aufgelöst.

Es wird zunächst kein allgemeines:

```text
Plugin-System
Activity Registry Framework
Generic GameMode Framework
Generic Runtime Factory Framework
```

gebaut.

Gemeinsame Abstraktionen entstehen erst, wenn mindestens zwei reale Consumer denselben fachlichen Vertrag benötigen.

---

# 29. Arena-Flow als Orchestrierungsrolle

Die Zielarchitektur benötigt eine klar abgegrenzte Rolle für die übergeordnete Übergangsreihenfolge. Diese Rolle wird im Dokument weiterhin als `ArenaFlowCoordinator` bezeichnet.

Sie besitzt keine Gameplay-Systeme und keine fachlichen Ergebnisregeln.

Beispiel:

```text
Ready
→ World definieren
→ World Identity veröffentlichen
→ World laden
→ WorldRuntime aktivieren
→ Activity vorbereiten
→ Participation / Readiness abgleichen
→ Activity starten
→ Completion / Abort
→ Result Application
→ nächste Activity / World / Lobby
```

Wichtig:

```text
World Loading
≠
Activity Start Readiness
≠
Participation
≠
Presentation
```

Der heutige `RoundState` kann während der Migration weiterbestehen.

Daraus folgt keine Pflicht für eine `RoundRuntime`.

Der Flow entscheidet nicht selbst über:

```text
Mission Victory
Enemy Spawn Rules
Persistent-Base Commit
Player Rewards
Combat Rules
```

Er orchestriert nur die zuständigen Owner beziehungsweise Use-Cases.

## Decision Gate

`ArenaFlowCoordinator` ist eine **Zielrolle, keine zwingend neu zu erzeugende Klasse**.

Nachdem World-, Activity-, Persistent-Base- und Result-Ownership extrahiert wurden, wird der verbleibende `ArenaLifecycleCoordinator` bewertet:

```text
Fall A:
verbleibende Verantwortung entspricht bereits dem gewünschten Flow
→ bestehenden Coordinator gezielt transformieren / umbenennen

Fall B:
LifecycleCoordinator enthält weiterhin mehrere unterschiedliche Verantwortungen
→ reine Flow-Orchestrierung extrahieren

Fall C:
kaum eigenständige Flow-Logik verbleibt
→ keinen künstlichen Wrapper erzeugen
```

Damit wird verhindert, dass nur für Diagrammreinheit eine zusätzliche Koordinatorschicht entsteht.

---

# 30. Begriffe

Die folgenden Rollen werden konsequent verwendet:

```text
Lifecycle
= besitzt Identität und Übergänge

Runtime
= besitzt veränderlichen Zustand einer Lifetime

System
= besitzt fachliches Verhalten

Coordinator
= orchestriert Reihenfolge mehrerer Owner

Policy / Resolver
= leitet deterministisch eine Entscheidung aus Inputs ab

Binding / Adapter
= verbindet einen Scope mit externer oder langlebigerer Infrastruktur

Session
= besitzt Zustand einer Room-/Verbindungs-Lifetime

Transaction
= besitzt temporären Working State mit Commit / Rollback

Context
= kleiner Read-Kontext mit kanonischen Daten, kein Service-Container

Port
= schmaler fachlicher Vertrag über eine Infrastrukturgrenze

Use Case
= wendet ein fachliches Ergebnis auf einen anderen fachlichen Bereich an
```

---

# 31. Harte Architekturregeln

1. **Lifecycle-Identität und lokale Runtime sind verschiedene Konzepte.**
2. **Ein Runtime-Owner besitzt genau eine Lifetime.**
3. **Ein Parent besitzt seinen direkten Child-Owner, nicht dessen einzelne Systeme.**
4. **Update Ownership folgt Runtime Ownership.**
5. **World, Activity, Participation, Presentation und Persistence bleiben getrennte Fragen.**
6. **`WorldRuntimeContext` bleibt ein kleiner World-Kontext und keine Service-Bag.**
7. **`ArenaRuntime`, `WorldRuntime` und `SharedRuntimeServices` werden nicht als allgemeine Dependencies weitergereicht.**
8. **`PlayerWorldRuntime` enthält nur Zustand, der einen Activity-Wechsel innerhalb derselben World überleben darf.**
9. **Activity-spezifischer Player-State gehört in die Activity-Lifetime.**
10. **Runtime-Owner räumen tatsächlich materialisierten Zustand ab; Teardown rekonstruiert Ownership nicht aus aktueller Policy.**
11. **Room-State, Activity-Transaction, World-Materialisierung und Profile-Persistenz werden nicht vermischt.**
12. **Eine Activity erzeugt fachliche Outcomes, schreibt aber nicht direkt in Transport oder Persistence.**
13. **ActivityCompletion trägt World- und Activity-Identity.**
14. **Persistent-Base-Transactions tragen World-/Activity-Identity und werden genau einmal terminal.**
15. **Die Runtime-Hierarchie wird nicht zur Feature-Hierarchie.**
16. **Neue generische Abstraktionen benötigen einen realen zweiten Consumer oder einen eigenständigen Vertrag.**
17. **Teardown ist vollständig, symmetrisch und idempotent.**
18. **Child-Owner werden in umgekehrter Aufbau-Reihenfolge abgebaut, sofern Abhängigkeiten dies verlangen.**
19. **Kein neuer world-/activity-scoped mutable Gameplay-State wird direkt scene-global angelegt.**
20. **SharedRuntimeServices dürfen keinen versteckten State einer alten World oder Activity behalten.**
21. **Neuer Runtime-/Domain-Code importiert `NetworkBridge` beziehungsweise `bridge` nicht direkt; explizite Network-/RPC-Adapter dürfen die konkrete Infrastruktur kennen.**
22. **Keine allgemeine DI-, Event-Bus-, Registry-, Service-Locator- oder Plugin-Infrastruktur ohne konkreten Bedarf.**
23. **Context Locality ist ein Qualitätsziel.**
24. **Eine neue Activity darf keine neuen Lifecycle-Sonderpfade in `ArenaScene` erfordern.**
25. **Eine neue Activity darf keine neue globale Liste von Update-Branches erzeugen.**
26. **Activity-spezifische Presentation gehört nicht in `ArenaScene`.**
27. **Während der Migration entsteht keine zweite mutable Wahrheit für ActivityParticipation.**
28. **Neue Activity-Policies dürfen nicht zu wachsenden zentralen `activityKind`-Switches führen.**
29. **Wire- und Authority-Verhalten werden während des Ownership-Refactorings nicht nebenbei neu designt.**
30. **Kompatibilitätsschichten sind temporär und erhalten ein geplantes Removal-Kriterium.**
31. **Refactoring-Phasen sind Arbeitsabschnitte, keine Release- oder Vollstabilitätsgrenzen.**
32. **Kein temporärer Adapter wird allein deshalb gebaut, um einen künstlich stabilen Phasenabschluss zu erzeugen.**
33. **Während der Migration darf der Branch bewusst unvollständig sein; dauerhaft mehrdeutige Ownership oder unmarkierte zweite mutable Wahrheiten sind trotzdem nicht erlaubt.**
34. **Verbindliche Integrations-Checkpoints prüfen kritische Invarianten bereits während der Migration; der vollständige Regressions- und Stabilitätsnachweis erfolgt nach dem finalen Cutover.**
35. **Ein im Zielbild benannter Owner, Port, Coordinator oder Use-Case wird nur materialisiert, wenn ein realer verbleibender Vertrag beziehungsweise Consumer dafür existiert.**
36. **Explizite Infrastrukturadapter dürfen konkrete Infrastruktur kennen, dürfen aber keine fachlichen Gameplay-Regeln akkumulieren.**

---

# 32. Teardown-Verträge

## 32.1 `WorldRuntime.destroy()`

Garantiert:

```text
ActivityRuntime beendet
PlayerWorldRuntime vollständig detached
WorldPresentationBinding entfernt
PersistentBaseWorldBinding entfernt
World-Bindings entfernt
Navigation gestoppt
Listener entfernt
Callbacks entfernt
Timer entfernt
Renderer-Bindings entfernt
Runtime IDs entfernt
world-scoped Shared-Service-State entfernt
direkte Child-Owner zerstört
```

Ein zweiter Aufruf ist No-op.

---

## 32.2 `ActivityRuntime.destroy()`

Garantiert:

```text
PlayerActivityRuntime entfernt
ActivityPresentationBinding entfernt
Activity Listener entfernt
Activity Timer entfernt
Enemy-/Objective-/Encounter-Referenzen entfernt
Activity-spezifische Shared-Service-Bindings gelöst
Completion nicht doppelt ausgelöst
```

---

## 32.3 Weitere Owner

Dasselbe Prinzip gilt für:

```text
PlayerWorldRuntime
PlayerActivityRuntime
PersistentBaseWorldBinding
PersistentBaseTransaction
WorldPresentationBinding
ActivityPresentationBinding
```

---

# 33. Update-Verträge

## `ArenaRuntime.update(delta)`

Darf nur direkte Top-Level-Owner anstoßen.

## `WorldRuntime.update(delta)`

Tickt world-scoped Child-Owner und `ActivityRuntimeHost`.

## `ActivityRuntime.update(delta)`

Tickt Activity-interne Child-Owner.

## Shared Services

Shared Services können weiterhin zentral technische Updates erhalten, sofern ihre Lifetime tatsächlich scene-langlebig ist.

World-/Activity-spezifische Aktivierung wird über Bindings bestimmt.

## Übergangsregel

`HostUpdateCoordinator` und `ClientUpdateCoordinator` dürfen während der Migration als Compatibility Coordinator bestehen bleiben.

Neue Activity-Systeme werden dort aber nicht mehr dauerhaft einzeln ergänzt.

Sobald ein Runtime-Owner einen fachlichen Bereich übernimmt, wandert auch dessen Update-Verantwortung zu diesem Owner.

---

# 34. Migrationsstrategie

Das Refactoring wird **inkrementell in der Bearbeitung, aber kontinuierlich in der Integration** durchgeführt.

Die Phasen sind klar begrenzte Arbeitspakete. Sie reduzieren den jeweils notwendigen Kontext für Entwickler und Coding-KIs, sind aber weiterhin **keine eigenständigen Release-Zielstände**.

V8 ergänzt gegenüber V7 drei verbindliche Integrations-Checkpoints. Diese ersetzen keine vollständige Endstabilisierung, verhindern aber, dass systemische Fehler über viele Ownership-Verschiebungen hinweg unentdeckt bleiben.

Es gilt ausdrücklich nicht:

```text
jede Phase
→ vollständig stabilisieren
→ alle Compatibility-Schichten bereinigen
→ vollständige Regression
→ erst dann nächste Phase
```

Sondern:

```text
kleine Phase
→ gezielte lokale Contracts / Checks
→ nächste Phase

nach zusammenhängenden Ownership-Blöcken
→ Integrations-Checkpoint
→ kritische Invarianten gemeinsam prüfen

finaler Cutover
→ Legacy vollständig entfernt
→ vollständige Regression
→ vollständige Stabilisierung
```

---

## 34.1 Warum weiterhin keine Vollstabilisierung pro Phase

Ein künstlich vollständig stabiler Zwischenstand nach jedem Arbeitspaket würde häufig zusätzlichen Übergangscode erzeugen:

```text
temporäre Adapter
doppelte Forwarder
zusätzliche Compatibility APIs
zusätzliche Synchronisation alter und neuer State-Pfade
Phase-spezifische Tests nur für kurzlebige Übergangszustände
```

Ein Teil dieses Codes würde bereits im nächsten Arbeitspaket wieder entfernt.

Das bleibt unerwünschter Migrationsaufwand.

Gezielte Checks sollen den realen neuen Vertrag absichern, nicht den temporären Zwischenzustand als eigene Architektur konservieren.

---

## 34.2 Integrations-Checkpoints statt Phasenstabilisierung

Ein Integrations-Checkpoint ist kleiner als eine vollständige Stabilitätsphase und größer als ein lokaler Unit-/Contract-Test.

Er verlangt insbesondere:

```text
TypeScript-/Build-Check der betroffenen Architekturpfade
gezielte relevante Vitest-Suiten
mindestens einen realen Host-/Client- oder Lifecycle-Durchstich, wenn der Block Netzwerk/Lifecycle berührt
Prüfung der für diesen Block kritischen Source-of-Truth- und Teardown-Invarianten
Aktualisierung der Transitional-Debt-Liste
```

Er verlangt ausdrücklich nicht:

```text
vollständige Gameplay-Regression
vollständiges Balancing
Releasefähigkeit
Entfernung aller später noch benötigten Compatibility-Pfade
künstliche Adapter nur für einen grünen Zwischenstand
```

Die drei verbindlichen Checkpoints liegen nach Phase 3, Phase 7 und Phase 10.

---

## 34.3 Was zwischen Phasen ausdrücklich erlaubt ist

Während des Gesamtrefactorings sind zeitweise zulässig:

```text
alter und neuer Owner existieren parallel

ein Consumer ist bereits migriert, ein anderer noch nicht

ArenaContext enthält noch Felder, deren neuer Owner bereits existiert

ein Compatibility Getter leitet vorübergehend auf den neuen Owner weiter

Update-Verantwortung ist teilweise bereits verschoben

ein neuer Port existiert, obwohl Legacy-Code an einer anderen Stelle noch direkt bridge verwendet

alte Source-Structure-Tests passen zeitweise nicht mehr zur Zielstruktur

ein Zwischenstand ist nicht releasefähig
```

Auch ein vollständig grüner Gesamt-Teststand muss nicht Abnahmekriterium jeder einzelnen Phase sein.

Gezielte lokale Tests sind dagegen Bestandteil der Phase, wenn sie den gerade verschobenen Vertrag absichern.

---

## 34.4 Was trotz fehlender Zwischenstabilität nicht aufgegeben wird

**Keine Vollstabilisierung pro Phase** bedeutet nicht **keine Sicherheitsregeln**.

Während der gesamten Migration bleiben folgende Invarianten verbindlich:

```text
keine unbeabsichtigte Änderung der Authority

keine unbeabsichtigte Änderung von Wire Keys / Revision Semantik

keine verlorene persistente Nutzerdatenmigration

keine absichtlich mehrdeutige kanonische Identity

keine unmarkierte zweite mutable Wahrheit

keine neue dauerhafte globale Dependency-Bag

keine neue Architektur, die der Zielrichtung widerspricht
```

Wenn temporär zwei Repräsentationen parallel existieren müssen, muss klar sein:

```text
welche ist aktuell Source of Truth?
welche ist Compatibility?
welcher spätere Arbeitsschritt entfernt die Compatibility?
```

---

## 34.5 Kein Compatibility-Code nur für Phasenreinheit

Temporärer Compatibility-Code ist zulässig, wenn er einen realen Migrationspfad ermöglicht.

Er soll **nicht** geschrieben werden, nur damit eine Phase für sich allein vollständig sauber oder releasbar aussieht.

Beispiel unerwünscht:

```text
neuer Runtime-Owner wird eingeführt

→ umfangreicher Adapter wird gebaut,
  damit der gesamte alte Lifecycle exakt wie vorher
  ausschließlich über die neue Fassade laufen kann

→ Adapter wird im nächsten Arbeitspaket wieder entfernt
```

Bevorzugt:

```text
neuen Owner einführen
→ erste echte Ownership direkt verschieben
→ verbleibende Legacy-Consumer bewusst markieren
→ in den nächsten Phasen weiter migrieren
→ Adapter nur dort, wo er tatsächlich benötigt wird
```

---

## 34.6 Transitional Debt wird explizit geführt

Temporäre Zwischenkopplungen sind erlaubt, aber nicht unsichtbar.

Für jede Phase beziehungsweise Implementierungsserie wird eine kleine Liste geführt:

```text
noch nicht migrierte Consumer
temporäre Forwarder
temporäre doppelte Felder
noch globale Update-Pfade
noch direkte Runtime-/Domain-bridge-Zugriffe
Legacy-Tests, die nachgezogen oder entfernt werden müssen
```

Bei Network-Zugriffen wird zusätzlich unterschieden:

```text
zu migrierender Runtime-/Domain-Zugriff
vs.
legitimer Infrastruktur-/Adapter-Zugriff
```

Diese Liste ist kein eigener Architektur-Layer und keine dauerhafte Dokumentation.

Sie dient dazu, temporären Refactoring-Code beim finalen Cutover nicht zu vergessen.

---

## 34.7 Stop/Go-Regel für Architekturbausteine

Vor der Einführung eines neuen Owners, Coordinators, Ports, Bindings oder Use-Cases wird geprüft:

```text
Welche konkrete Verantwortung verbleibt nach den bisherigen Extraktionen?
Welche Lifetime oder Boundary besitzt sie?
Wer ist ihr realer Consumer?
Welche bestehende Kopplung wird dadurch entfernt?
Reduziert der Baustein den Context-Bedarf tatsächlich?
```

Ein Baustein wird **nicht** nur deshalb erzeugt, weil er in einem Zielbild oder Beispiel benannt ist.

Insbesondere gilt:

```text
ArenaFlowCoordinator
→ Decision Gate, keine Pflicht zu einer zusätzlichen Wrapper-Klasse

Network Ports
→ nach fachlicher Boundary, nicht pro bridge-Aufruf

Result-/Progression-Use-Cases
→ nur für tatsächlich vorhandene Konsequenzen

Bindings
→ nur wenn wirklich eine Lifetime-Grenze zu langlebiger Infrastruktur verbunden wird
```

---

## 34.8 KI-taugliche Phasengröße

Die folgenden Phasen sind bewusst kleiner als in V7 geschnitten.

Eine Phase darf intern aus mehreren Implementierungsserien beziehungsweise Commits bestehen. Ein einzelner Coding-KI-Prompt soll nicht gleichzeitig mehrere voneinander unabhängige Ownership-Bereiche umziehen.

Bevorzugtes Muster:

```text
Inventar / Contract bestimmen
→ einen zusammenhängenden Owner-Slice migrieren
→ gezielte Tests
→ Transitional Debt aktualisieren
→ nächster Slice derselben Phase
```

---

## Phase 1 – Contracts & Invarianten absichern

Bestehende kritische Semantik gezielt absichern:

```text
World Identity
Activity Identity
World / Activity Revisions
World Loading
Activity Start Readiness
World Participation
Round-/Activity Participation
Presentation
Persistent Base
Race Cases
stale Network Data
Teardown Idempotenz
```

Wire-Verhalten bleibt unverändert.

Bestehende Source-Structure-Tests dürfen zunächst als Migrationsschutz dienen. Sie werden später angepasst oder entfernt, wenn sie nur die alte Struktur konservieren.

### Arbeitsziel

Die besonders riskanten Lifecycle-, Revision- und Persistence-Semantiken besitzen ausreichend Schutz für die folgenden Ownership-Verschiebungen.

### Phasengrenze

Noch keine produktive Ownership-Migration; nur Sicherheitsnetz und notwendige Contract-Lücken.

---

## Phase 2 – `WorldRuntime`-Fundament und Lifecycle-Vertrag

`WorldRuntime` wird hinter dem bestehenden `WorldLifecycle` als echter Composition Owner eingeführt, zunächst mit kleinem Scope.

Einführen beziehungsweise festziehen:

```text
WorldRuntime Lifecycle
create / attach
update contract
destroy / detach
idempotenter Teardown
WorldRuntimeContext ownership
ActivityRuntimeHost Slot
WorldPresentationBinding Slot
PersistentBaseWorldBinding Slot
World Binding contracts für langlebige Services
```

`ArenaContext` darf weiterhin Compatibility Layer sein.

In dieser Phase werden **noch nicht gleichzeitig sämtliche World-Systeme umgezogen**.

### Arbeitsziel

Die Ziel-Lifetime existiert real und kann aufgebaut, detached, erneut attached und idempotent zerstört werden, ohne bereits den gesamten World-Code zu migrieren.

### Phasengrenze

Die Phase endet beim stabilen Ownership-Gerüst; Geometrie, Navigation und weitere große World-Bereiche folgen in Phase 3.

---

## Phase 3 – World-scoped Ownership migrieren

Auf das Fundament aus Phase 2 werden die heutigen World-lokalen Bereiche in zusammenhängenden Slices verschoben:

```text
Arena Layout / World Geometry
Placement / Rocks
World Bases
Navigation / Flowfield World Binding
world-scoped Shared-Service-Bindings
PlayerWorldRuntime Ownership
WorldPresentationBinding-Materialisierung
PersistentBaseWorldBinding-Materialisierung nur soweit für World-Lifetime erforderlich
```

Create, Update und Destroy eines übernommenen Bereichs wandern möglichst gemeinsam.

Neue World-Systeme werden nicht mehr direkt im globalen `ArenaContext` materialisiert.

### Arbeitsziel

`WorldLifecycle` besitzt die Identity; `WorldRuntime` besitzt die lokale World-Realisierung. Die wichtigsten World-Ressourcen hängen nicht mehr direkt am globalen Arena-Lifecycle.

### Integrations-Checkpoint A – World Ownership

Nach Phase 3 werden gemeinsam geprüft:

```text
World ohne Activity
WorldRuntime attach / detach / reattach derselben Revision
World-Wechsel
Host-Simulation mit und ohne lokale Presentation
Navigation / Placement nach Reattach
kein alter World-Timer / Binding / Runtime-ID-Leak
```

Der Checkpoint muss die World-Invarianten tragen, ist aber kein vollständiger Release-Gate.

---

## Phase 4 – `CoopMissionRuntime` als Activity-Composition einführen

Die Coop-Mission erhält einen echten Activity-Owner hinter `ActivityRuntimeHost`.

Zunächst wandern Aufbau, Ownership und Teardown der zentralen Mission-Bausteine:

```text
Mission State
Encounter / Spawn Runtime
Objectives
Mission Progress
Boss / mission-specific Directors
activity-scoped Enemy Behaviour
Completion State als fachlicher Activity-Zustand
```

Der Fokus dieser Phase liegt auf **Composition und Lifetime**, nicht gleichzeitig auf der vollständigen Bereinigung aller globalen Update-/Presentation-Pfade.

`WorldRuntime` kennt anschließend nur noch die ActivityRuntime-Grenze und keine Liste konkreter Coop-Systeme.

### Arbeitsziel

Coop-spezifische Systeme besitzen einen klaren gemeinsamen Activity-Owner und einen geschlossenen Create-/Destroy-Pfad.

---

## Phase 5 – Activity Update, Player-Lifetime und Presentation schneiden

Auf Basis der `CoopMissionRuntime` werden die verbleibenden Activity-Lifetime-Aspekte aus globalen Pfaden gelöst.

### 5.1 Update Ownership

```text
CoopMissionRuntime.update()
→ tickt direkte Activity-Child-Owner
```

Bereits migrierte Coop-Systeme werden nicht mehr einzeln im globalen Host-Update-Pfad getickt.

### 5.2 Player-Lifetimes

`PlayerWorldRuntime` wird auf echte World-Lifetime reduziert.

Activity-spezifischer Player-State wandert in:

```text
PlayerActivityRuntime
```

oder einen konkreten Coop-Player-Owner.

Das heutige `missionStatus`-Konzept wird aus dem World-Owner entfernt.

Der jeweilige Player-Owner führt ein Materialization Ledger und räumt exakt die tatsächlich erzeugten Module ab.

### 5.3 Activity Presentation

Mission-spezifische UI-/FX-/Audio-Bindings wandern schrittweise in `ActivityPresentationBinding`, ohne Simulation oder Authority zu übernehmen.

### Arbeitsziel

Ein Activity-Wechsel kann Activity-Update, Player-Activity-State und Activity-Presentation vollständig ersetzen, während die World-Lifetime bestehen bleibt.

---

## Phase 6 – Persistent Base nach Lifetimes trennen

Der heute gemischte Persistent-Base-Zustand wird getrennt in:

```text
PersistentBaseRoomSession
PersistentBaseTransaction
PersistentBaseWorldBinding
Profile Persistence
```

Klar zugeordnet werden:

```text
Committed State
Baseline
Working State
Runtime IDs
World Conflicts
Local Save
```

### Reihenfolge innerhalb der Phase

Bevorzugt in kleinen Slices:

```text
1. RoomSession / committed State
2. Transaction / baseline + working + terminale Semantik
3. WorldBinding / Runtime IDs + Materialisierung
4. lokale Profile-Persistence über schmale Use-Case-/Persistence-Grenze
```

Alte Store-Methoden dürfen zeitweise delegieren.

Es wird kein aufwendiger bidirektionaler Parallelzustand gebaut.

### Arbeitsziel

Room-, Activity-, World- und Profile-Lifetime besitzen keine gemeinsame mutable Store-Wahrheit mehr.

---

## Phase 7 – `ActivityCompletion` und echte Result-Anwendung extrahieren

Activity-Abschluss wird von Persistenz- und Progressionsfolgen getrennt.

Verbindlich einführen:

```text
ActivityCompletion
ResultApplication-Grenze
Persistent-Base Outcome-Anwendung
heute tatsächlich vorhandene Progression-/Reward-Anwendung
```

Weitere Use-Cases entstehen **nur bei realem aktuellem Bedarf**.

Nicht automatisch erzeugen, wenn es noch keine fachliche Logik gibt:

```text
leerer StatisticsUseCase
leerer UnlockUseCase
leerer RewardUseCase
weitere hypothetische Result-Handler
```

Direkte Coop-Progression und Local-Persistence-Regeln wandern aus `ArenaScene` und Lifecycle-Code heraus.

### Arbeitsziel

Eine Activity erzeugt ein revisionsgebundenes fachliches Outcome; nachgelagerte Anwendung entscheidet über PB, Progression und Rewards.

### Integrations-Checkpoint B – Activity / Persistence / Result

Nach Phase 7 werden gemeinsam geprüft:

```text
Activity-Wechsel innerhalb derselben World
PlayerWorldRuntime bleibt bestehen
PlayerActivityRuntime wird ersetzt
ActivityPresentationBinding stirbt mit Activity
PB RoomSession überlebt World-Wechsel
PB Transaction commit / rollback genau einmal
stale Transaction Completion wird verworfen
stale ActivityCompletion erzeugt keine Rewards / Progression / PB-Änderung
```

---

## Phase 8 – Arena-Flow Decision Gate und Transition Ownership

Erst nachdem direkte Runtime- und Result-Owner existieren, wird die verbleibende Übergangslogik bewertet.

### Decision Gate

Der heutige `ArenaLifecycleCoordinator` wird gegen die Zielrolle aus Abschnitt 29 geprüft.

```text
entspricht der Rest bereits reiner Flow-Orchestrierung
→ vorhandenen Coordinator transformieren / ggf. umbenennen

enthält der Rest noch klar trennbare Nicht-Flow-Verantwortung
→ diese extrahieren und schlanken Flow-Owner behalten

würde eine neue Klasse nur einen Wrapper bilden
→ keine zusätzliche Klasse erzeugen
```

Der resultierende Flow orchestriert nur:

```text
World
Activity
Readiness
Participation
Completion
Result Application
Transitions
```

und keine Gameplay-Regeln.

### Arbeitsziel

Übergangslogik besitzt eine erkennbare Orchestrierungsgrenze ohne künstliche zusätzliche Schicht.

---

## Phase 9 – `ArenaRuntime` als kleiner Composition Owner

`ArenaRuntime` wird als scene-langlebiger Top-Level-Owner des Arena-Layers eingeführt beziehungsweise final zusammengesetzt.

Er hält die tatsächlich existierenden Top-Level-Rollen, typischerweise:

```text
SharedRuntimeServices
Flow-Orchestrierung
ParticipationCoordinator
ResultApplication
PersistentBaseRoomSession
WorldLifecycle
```

Er wird nicht als allgemeiner Context weitergereicht.

Nicht vorhandene beziehungsweise nach dem Decision Gate unnötige Rollen werden nicht künstlich erzeugt.

### Arbeitsziel

`ArenaScene` besitzt Phaser-Lifecycle und Infrastructure; `ArenaRuntime` besitzt die Top-Level-Composition, aber keine Gameplay-Regeln.

---

## Phase 10 – `ArenaContext` und globale Dependency-Pfade abbauen

Jetzt wird der große gemeinsame Dependency-/State-Container systematisch reduziert.

Schrittweise migrieren:

```text
Runtime-Consumer auf ihre echten Owner
Coordinatoren auf kleine fachliche Interfaces
nullable Activity-/World-Felder aus ArenaContext
manuelle Zugriffe auf bereits migrierte Runtime-Systeme
globale Update-Branches für bereits owner-getickte Bereiche
```

`ArenaContext` darf am Ende nur noch echte Scene-Infrastructure beziehungsweise wenige klar markierte temporäre Compatibility-Zugriffe enthalten.

### Update-Coordinatoren

`HostUpdateCoordinator` und `ClientUpdateCoordinator` behalten technisch scene-langlebige Aufgaben, verlieren aber einzeln adressierte Activity-Systeme, sobald deren Owner den Update-Pfad übernommen hat.

### Arbeitsziel

Die neue Ownership ist nicht nur beim Create/Destroy sichtbar, sondern auch im Dependency-Graph und im Update-Pfad.

### Integrations-Checkpoint C – Dependency Cutover

Nach Phase 10 werden gemeinsam geprüft:

```text
ArenaScene kennt keine neuen Activity-Systeme
WorldRuntime kennt keine Coop-Systemliste
ArenaRuntime wird nicht als Dependency Bag weitergereicht
Coop-Activity wird über ihren Owner getickt
Host / Client Multiplayer-Durchstich
Match-Ende / Lobby-Rückkehr
World-/Activity-Reconnect beziehungsweise Reattach-Pfade
keine offensichtlichen Leak-/stale-Callback-Pfade
```

---

## Phase 11 – RPC-/Network-Boundaries und Transitional Debt bereinigen

Die verbleibenden Netzwerk- und Compatibility-Pfade werden anhand der tatsächlichen Boundary klassifiziert.

### Migrieren

```text
Runtime-/Domain-Code → keine direkten bridge-/NetworkBridge-Imports
fachliche Netzwerkgrenzen → kleine Ports, wenn real benötigt
fachliche Regeln aus RPC-/Network-Adaptern herauslösen
```

### Bewusst zulässig lassen

```text
RPC-Registrierungsadapter → darf bridge kennen
NetworkSession / Compatibility Facade → darf bridge kennen
transportnahe Snapshot-/Replikationsadapter → dürfen konkrete Infrastruktur kennen
```

Zusätzlich wird die Transitional-Debt-Liste abgearbeitet:

```text
Legacy Weiterleitungen
obsolete isCoopMission-Aufbauzweige
Compatibility Getter
doppelte Lifecycle-Pfade
veraltete Runtime Feature Flags
temporäre doppelte State-Repräsentationen
obsolete Source-Structure-Tests
manuelle globale Teardown-Listen, deren Ownership inzwischen lokal ist
```

### Arbeitsziel

Nach Phase 11 steht die neue Architektur ohne unbeabsichtigte Parallelpfade. Verbleibende direkte NetworkBridge-Nutzung ist bewusst als Infrastrukturgrenze klassifiziert, nicht einfach vergessen.

---

## Phase 12 – Finaler Integrations- und Stabilitäts-Cutover

Dies ist weiterhin der **einzige vollständige Release-/Stabilitäts-Gate** des Gesamtrefactorings.

Jetzt wird die Zielarchitektur als Einheit verifiziert.

Dazu gehören:

```text
vollständiger TypeScript-/Build-Check
vollständige relevante Vitest-Suite
Multiplayer Host / Client
World-Wechsel
Activity-Wechsel
Runtime Detach / Reattach
Participation
Presentation
Persistent Base
Commit / Rollback
stale Revision Cases
Match-Ende / Lobby-Rückkehr
Reconnect / Late Join
Teardown / Leak Contracts
```

Die Transitional-Debt-Liste muss leer sein oder ausschließlich bewusst akzeptierte, **nicht temporäre** Infrastrukturgrenzen enthalten.

Erst nach diesem Schritt wird wieder ein stabiler, als Grundlage für weitere Feature-Arbeit gedachter Projektstand erwartet.

## Finales Abnahmekriterium

Nicht entscheidend ist, ob jede Zwischenphase für sich releasefähig war.

Entscheidend ist:

> **Am Ende existiert die beabsichtigte Ownership-Architektur ohne künstlich materialisierte Zielabstraktionen, alle temporären Migrationspfade sind entfernt und die relevanten Gameplay-/Multiplayer-Verträge funktionieren weiterhin.**

---

# 35. Teststrategie

Die heutigen Tests bleiben während der Migration ein Sicherheitsnetz, aber nicht jede Phase benötigt einen vollständig grünen Gesamtstand.

Während der Arbeitsphasen werden gezielt die Tests ausgeführt beziehungsweise ergänzt, die für den gerade verschobenen Vertrag besonders wertvoll sind.

Nach Phase 3, Phase 7 und Phase 10 bündeln verbindliche Integrations-Checkpoints die jeweils neu entstandenen Ownership-Grenzen und prüfen die wichtigsten systemischen Invarianten. Diese Checkpoints sind bewusst kleiner als eine vollständige Stabilisierung.

**Die vollständige Regression und der verbindliche Gesamt-Teststand gehören weiterhin in Phase 12 – Finaler Integrations- und Stabilitäts-Cutover.**

Nach dem Cutover wird dauerhaft stärker Owner-basiert getestet.

---

## 35.1 `WorldRuntime`

```text
create
→ vollständig aktiv

update
→ nur aktive Child-Owner

destroy
→ alle Child-Owner weg

destroy erneut
→ No-op
```

---

## 35.2 Activity-Wechsel

```text
WorldRuntime bleibt identisch

Activity A
→ destroy

Activity B
→ create

kein State Leak aus A
```

---

## 35.3 Runtime Reattach

```text
World Identity bleibt identisch

WorldRuntime detach
→ lokale Runtime vollständig weg

WorldRuntime attach
→ dieselbe World Revision
→ frische lokale Runtime
```

---

## 35.4 Player-Lifetimes

```text
PlayerWorldRuntime überlebt Activity-Wechsel

PlayerActivityRuntime nicht
```

Zusätzlich:

```text
Attach mit Feature Set A
Policy ändert sich
Detach
→ exakt tatsächlich materialisierte Module werden entfernt
```

---

## 35.5 Persistent Base

```text
RoomSession überlebt World-Wechsel

WorldBinding nicht

Transaction endet mit Activity

stale Transaction Completion wird verworfen

Profile Persistence bleibt außerhalb aller Runtime-Owner
```

---

## 35.6 Activity Completion

```text
Completion trägt World-/Activity-Revision

stale Completion
→ keine Progression
→ kein PB Commit
→ keine Rewards
```

---

## 35.7 Presentation

```text
Host Simulation ohne lokale Presentation

Preview ohne WorldParticipation

ActivityPresentationBinding stirbt mit Activity

WorldPresentationBinding darf World ohne Activity darstellen
```

---

## 35.8 Update Ownership

Tests beziehungsweise Architecture Contracts stellen sicher:

```text
ArenaRuntime kennt keine Coop-Mission-Systemliste
WorldRuntime kennt keine konkreten Coop-Systeme
ArenaScene tickt keine Activity-Systeme einzeln
```

---

## 35.9 Leak Contracts

Nach Teardown dürfen keine alten:

```text
Timer
Event Listener
Callbacks
Runtime IDs
Enemy References
World References
Activity References
Renderer Bindings
Network Subscriptions
Prediction Caches des alten Scopes
```

mehr aktiv sein.

---

# 36. Dependency Boundaries

Dauerhaft sinnvolle Architekturprüfungen:

```text
WorldRuntimeContext
→ importiert keine Gameplay-Systeme

neuer Activity Runtime Code
→ importiert ArenaContext nicht

neuer Runtime-/Domain-Code
→ importiert NetworkBridge / bridge nicht

explizite Network-/RPC-Adapter
→ dürfen NetworkBridge / bridge kennen, enthalten aber keine Gameplay-Regeln

ArenaScene
→ importiert keine neuen Activity-Systeme

WorldRuntime
→ importiert keine konkreten Activity-System-Interna außerhalb der Composition-Grenze

Activity Domain
→ importiert keine Local Preferences
```

Solche Regeln sollen möglichst auf Import-/Dependency-Ebene geprüft werden und nicht ausschließlich durch fragile String-Tests.

---

# 37. Nicht-Ziele dieses Refactorings

Nicht gleichzeitig neu designen:

```text
Netzwerktransport
PeerJS/WebRTC-Grundstruktur
Wire Keys
Tick Rates
Authority-Modell
World Revision Semantik
Activity Revision Semantik
Gameplay Balance
allgemeines Plugin-System
allgemeines DI-Framework
globaler Event Bus
generisches Registry Framework
```

Ebenfalls kein Selbstzweck:

- jede große Klasse sofort maximal klein machen;
- jede scene-langlebige Domain-Komponente künstlich neu instanziieren;
- abstrakte Frameworks für hypothetische spätere Features bauen;
- jeden direkten `bridge`-Aufruf unabhängig von seiner Schicht in ein eigenes Interface einwickeln;
- jede im Zielbild benannte Rolle zwingend als neue Klasse materialisieren.

---

# 38. Erfolgskriterien

Eine neue Activity soll hauptsächlich innerhalb ihres eigenen Runtime-Scopes wachsen.

Sie verursacht nicht erneut:

```text
20–30 neue ArenaContext-Felder
zahlreiche ArenaScene-Branches
manuelle globale Teardown-Listen
neue Host-/Client-Lifecycle-Sonderpfade
neue globale Update-Branches
weitere God-Class-Methoden
```

Eine neue World-Mechanik wächst primär im `WorldRuntime` beziehungsweise den zuständigen Domain-Systemen.

Eine neue Activity-Mechanik wächst primär im `ActivityRuntime`.

Eine neue Activity-Presentation wächst im `ActivityPresentationBinding`.

Eine neue Persistenzregel führt nicht automatisch zu Änderungen am Arena-Lifecycle.

Eine neue Progressionsregel wird über Result-/Progression-Use-Cases angebunden.

---

# 39. Context-Locality-Metrik

Als qualitative Architekturprobe gilt:

> **Wie viele fachfremde Dateien muss ein Entwickler oder eine Coding-KI verstehen und ändern, um ein Feature sicher anzupassen?**

Zielbeispiele:

### Neuer Gegner

```text
Enemy Definition
AI Behaviour
bestehende Domain Ports
Presentation
Tests
```

Keine Änderung an:

```text
ArenaScene
ArenaRuntime
WorldLifecycle
ActivityLifecycle
ArenaFlowCoordinator
Persistent Base
```

### Neues Coop Objective

Primär:

```text
CoopMissionRuntime
Objective Domain
Activity Presentation
Tests
```

Keine globale Arena-Verkabelung.

### Neue FDTD-Mechanik

Primär:

```text
FromDachsTillDawnRuntime
zugehöriges Domain-System
ActivityPresentationBinding
Tests
```

---

# 40. Verbindliche Architektur-Proben

Folgende Fälle bleiben ausdrücklich möglich und getestet:

```text
World ohne Activity

lokaler Runtime-Detach ohne Ende der World Identity

Activity-Wechsel innerhalb derselben World

PlayerWorldRuntime überlebt Activity-Wechsel

PlayerActivityRuntime wird beim Activity-Wechsel ersetzt

Host-Simulation ohne lokale Presentation

Preview ohne WorldParticipation

PB-Room-State überlebt World-Wechsel

PB-WorldBinding überlebt World-Wechsel nicht

PB-Transaction endet unabhängig von RoomSession

ActivityCompletion ist revisionsgebunden

stale World-/Activity-/RPC-/Completion-Daten werden verworfen
```

---

# 41. Probe: Brandstifter

Ein neuer Gegner wie der Brandstifter:

```text
Brandstifter
→ Enemy
→ AI
→ Projectile
→ Combat
→ Presentation
```

soll keine Änderungen erfordern an:

```text
ArenaScene
ArenaRuntime
WorldLifecycle
ActivityLifecycle
ArenaFlowCoordinator
Persistent Base
```

Falls seine Existenz nur innerhalb bestimmter Activities authored wird, entscheidet die Activity über Spawn/Encounter-Komposition, nicht über die generische Gegnermechanik.

---

# 42. Probe: From Dachs Till Dawn

FDTD ergänzt:

```text
FromDachsTillDawnDefinition
FromDachsTillDawnRuntime
optional PlayerActivityRuntime
FromDachsTillDawnPresentationBinding
FDTD Result
FDTD Progression Use Cases
```

Die Activity besitzt:

```text
Day / Dusk / Night / Dawn Flow
Enemy / Encounter State
Activity Objectives
Activity Result
```

Dauerhafte Progression liegt außerhalb der Activity:

```text
Pfand / Ressourcen
Expansion
Freischaltungen
Meta-Fortschritt
```

Bei Abschluss erzeugt die Activity ein revisionsgebundenes:

```text
FromDachsTillDawnResult
```

Nachgelagerte Progression-Use-Cases entscheiden, welche Ressourcen oder Freischaltungen erhalten bleiben.

Es entsteht keine FDTD-Sonderlogik in `ArenaScene`.

Es entsteht keine globale FDTD-Update-Liste im `HostUpdateCoordinator`.

---

# 43. Probe: Activity-Wechsel in derselben World

Ausgang:

```text
World A
├── PlayerWorldRuntime
├── PersistentBaseWorldBinding
├── WorldPresentationBinding
│
└── CoopMissionRuntime
    ├── PlayerActivityRuntime
    └── CoopMissionPresentationBinding
```

Coop endet.

Danach:

```text
World A
├── derselbe PlayerWorldRuntime
├── dieselbe World-Geometrie
├── dieselbe World Identity
├── dieselbe PersistentBaseWorldBinding
├── dieselbe WorldPresentationBinding
│
└── DeathmatchRuntime
    └── neuer PlayerActivityRuntime
```

Nur Activity-spezifischer State wird ersetzt.

Die World wird nicht künstlich neu aufgebaut.

---

# 44. Probe: Runtime Rebuild derselben World

```text
WorldLifecycle
└── World Identity Revision 42
```

Lokale Runtime fällt:

```text
WorldRuntime 42
→ destroy
```

Die Identity bleibt bestehen.

Später:

```text
WorldRuntime 42
→ create
```

Dabei gilt:

- frische lokale Runtime;
- keine alten Timer;
- keine alten Bindings;
- keine alten Runtime IDs;
- dieselbe World Identity;
- Activity Identity darf ebenfalls weiterbestehen und neu materialisiert werden.

---

# 45. Endzustand

Der Arena-Layer organisiert:

```text
Identitäten
Lifetimes
Transitions
Composition
```

Runtime- und Domain-Owner besitzen:

```text
ihren Zustand
ihre Regeln
ihre direkten Child-Owner
ihren Update-Pfad
ihren vollständigen Teardown
```

Persistenz, Participation, Presentation und Networking bleiben explizite Nachbarbereiche.

Sie werden nicht erneut über globale Mutable-State-Container miteinander vermischt.

Die Architektur soll weiteres Wachstum von Fragdachse unterstützen, ohne dass jede neue Mechanik den globalen Arena-Kontext vergrößert.

---

# 46. Kurzfassung der Zielregeln

Wenn bei einer zukünftigen Architekturentscheidung Unsicherheit besteht, gelten diese Fragen in Reihenfolge:

1. **Welche Lifetime besitzt der Zustand wirklich?**
2. **Welcher Owner materialisiert ihn?**
3. **Welcher Owner tickt ihn?**
4. **Welcher Owner räumt ihn vollständig auf?**
5. **Muss dieser Zustand einen World-/Activity-Wechsel überleben?**
6. **Ist die Abhängigkeit fachlich oder nur historisch vorhanden?**
7. **Kann statt eines großen Contexts ein kleiner Port verwendet werden?**
8. **Entsteht gerade eine neue mutable Wahrheit?**
9. **Wird ein globaler Switch beziehungsweise Branch durch das neue Feature größer?**
10. **Muss eine Coding-KI für diese Änderung fachfremde globale Dateien verstehen?**

Wenn die Antwort auf die letzten beiden Fragen regelmäßig **ja** lautet, ist die Ownership-Grenze wahrscheinlich noch nicht sauber genug.

---

# 47. Leitgedanke

Für die Migration gilt zusätzlich:

> **Phasen strukturieren die Arbeit, Integrations-Checkpoints begrenzen das Risiko, und vollständig stabilisiert wird die neue Architektur als Ganzes nach dem finalen Cutover.**

Dadurch soll möglichst wenig Wegwerf-Compatibility-Code entstehen, ohne systemische Fehler bis zum Ende der Migration unkontrolliert aufzustauen.

Für die Zielarchitektur selbst gilt:

> **Ownership folgt Lifetime. Update folgt Ownership. Teardown folgt tatsächlichem Besitz.**

Und daraus folgt das wichtigste Qualitätsmerkmal für Fragdachse:

> **Neue Komplexität soll dort entstehen, wo das neue Feature fachlich lebt – nicht im globalen Lifecycle.**
