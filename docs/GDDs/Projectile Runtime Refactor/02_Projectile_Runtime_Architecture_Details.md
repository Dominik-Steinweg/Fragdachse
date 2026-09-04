# Fragdachse – Projectile Runtime Architecture Details

**Status:** Normative Detailverträge / gezielt zu laden
**Core-Dokument:** `01_Projectile_Runtime_Architecture_Core.md`
**Repository-Basis:** `main` @ `c6f83bc864c4cf8daa98d32bd6a29ee9a8926ab5` vom 04.09.2026; der Projectile-Produktionscode ist gegenüber `2040afa7c339f68a5b35bbbd3a43e8730586d3c2` unverändert, Test-Suites/Runner und dauerhafte Testpolicy entsprechen dem abgeschlossenen Test-Refactoring
**Spätere Dokumente:** `03_Projectile_Runtime_Implementation_Plan.md`, `04_Projectile_Runtime_Migration_Status.md`

> Dieses Dokument präzisiert den Architecture Core. Es ist nicht dafür gedacht, bei jeder Implementierungsphase vollständig geladen zu werden.
> `03` soll pro Phase nur die fachlich betroffenen §§ dieses Dokuments referenzieren.
> Ziel ist eine konkrete, implementierbare Architektur ohne Vorwegnahme der Migrationsreihenfolge.

---

## 1. Nutzung durch Coding-KIs

Immer zuerst `01_Projectile_Runtime_Architecture_Core.md` lesen. Danach nur die für die aktuelle Phase relevanten Detailverträge aus diesem Dokument laden.

| Aufgabe | zusätzlich aus diesem Dokument laden |
|---|---|
| Zielmodule / Stores / Processor | §§ 3–5 |
| Spawn / Provenance / Datenmodell | §§ 6–8 |
| Flight / Lifetime / Time Bubble | §§ 9–10 |
| Homing / Guidance | § 11 |
| Collision / Target Hits | §§ 12–14 |
| Combat-Grenze / Outcomes | § 15 |
| Explosion / Domain-Effect-Fan-out / Grenade / Mini Rocket | §§ 15–16 |
| Reflection / Deflection / Detonation | §§ 14, 17 |
| Burn / AWP / Travel-Interactions | § 18 |
| Lifecycle-Reactions / AK47 | § 19 |
| Fremd-Consumer migrieren | § 20 |
| Network / Client Replica | §§ 21–22 |
| Presentation | § 22 |
| World-Lifetime / Geometry | § 23 |
| Host-Frame / Same-Frame-Verträge | § 24 |
| Sonderfälle | § 25 |
| Tests / Performance / Ratchets | §§ 26–28 |
| Erstellung von Dokument 03 | § 30 |

Regeln:

1. `TrackedProjectile` ist Migrationsquelle, **kein Zielcontract**.
2. Eine konkrete Legacy-Abhängigkeit darf temporär hinter einem Adapter bestehen, aber nicht zur neuen dauerhaften öffentlichen Boundary werden.
3. Keine Abstraktion nur deshalb einführen, weil sie nach ECS, DDD oder „Clean Architecture“ aussieht.
4. Data-Oriented-Maßnahmen benötigen einen konkreten Nutzen: klarerer State, weniger Sonderbranches, bessere Testbarkeit oder messbar sinnvollerer Hot Path.
5. `03` darf konkrete Namen, Phasen und temporäre Adapter präzisieren, aber die hier beschriebenen Zielverträge nicht überschreiben.
6. `03` führt für cross-phase relevante Grenzen ein **Contract Manifest**: Contract-Familie stabil halten, konkreten Type/API-Namen in der ersten implementierenden Phase einmal materialisieren, danach nicht parallel neu erfinden; `04` dokumentiert den realisierten Namen.
7. Für neue/geänderte Tests gilt `docs/ai/testing.md`: erst Schutzwert benennen, bestehende passende Tests bevorzugt erweitern, kleinste sinnvolle Testebene wählen und authored Tuning/private Implementierungsform nicht duplizieren. Die aktuellen Runner aus `package.json` sind maßgeblich.

---

## 2. Ist-Befund und Migrationsdruck

Der heutige `src/entities/ProjectileManager.ts` vereint gleichzeitig:

- Host-State-Owner für aktive Projectiles,
- Phaser-Physics-/Collision-Orchestrierung,
- Flight-/Homing-/Bounce-/Grenade-/Mini-Rocket-State-Machines,
- zahlreiche per-Projectile-Dedupe-Sets,
- Callbacks zu Rock, Base, Train, Support und Gameplay-Reactions,
- Explosion-/Grenade-Ausgänge,
- Host-Snapshot-Build inklusive Static-Resend-/Refresh-State,
- Client-Replica-/Extrapolation,
- Host- und Client-Presentation-Dispatch,
- Muzzle-/Impact-/Bounce-VFX und Audio,
- Lighting-/Shadow-Reads.

Zusätzlich wird der interne State außerhalb des Managers gelesen oder mutiert.

| Consumer | heutige Kopplung | Ziel |
|---|---|---|
| `WorldWeaponExecutionRuntime` | `spawnProjectile()` | `ProjectileSpawnPort` |
| `AutomatedWeaponExecutionAdapter` | `spawnProjectile()` | gleicher Spawn-Port |
| `SpecializedWeaponExecutionAdapter` | `spawnProjectile()` | gleicher Spawn-Port |
| `CombatSystem` | iteriert `TrackedProjectile`, mutiert/destroyed/spawnt | Collision raus; `ProjectileCombatPort` rein |
| `DetonationSystem` | iteriert/getById/destroy | External Interaction Port |
| `TranslocatorSystem` | spawn/getById/destroy/Position | schmale Puck-Capability |
| `FlamethrowerUpgradeSystem` | iteriert + mutiert Burn/Trail-State | Travel-/Environment-Interaction |
| `WeaponUpgradeSystem` | iteriert + mutiert AWP-State | Path-Interaction |
| `CoopDefenseEnemyDodgeSystem` | Broadphase aus `TrackedProjectile` | immutable Threat Read View |
| `WorldTrainRuntime` | Train-Gruppe + Hit-Callback | Geometry-/Domain-Port |
| `WorldGeometryBinding` | Gruppen/ObstacleIndex | Projectile Geometry Binding |
| `HostUpdateCoordinator` | Update, Snapshot, BFG-Presentation | Host Stage + Read Ports |
| `ClientUpdateCoordinator` | Client-Sync + Extrapolation + Renderer | Client Replica + Presentation |
| `WorldCombatGameplayBinding` | große Setter-/Callback-Verdrahtung | schmale Projectile-/Combat-/Domain-Ports |
| Debug/Balance | aktive Runtime-Objekte | Diagnostics Read Port |

Der Refactor muss deshalb **die offene Runtime-State-Oberfläche schließen**. Ein bloßer Dateisplit reicht nicht.

---

## 3. Zielmodule und Abhängigkeitsstruktur

Bevorzugte logische Struktur:

```text
WorldProjectileRuntime
│
├─ ProjectileSimulation / ProjectileStore
│   ├─ Identity + Core Runtime Records
│   ├─ Physics Handles
│   ├─ universeller Flight-/Lifetime-State
│   ├─ sparse Feature-State
│   └─ private Capability Indices
│
├─ wenige interne Processor
│   ├─ Flight
│   ├─ Homing / Guidance
│   ├─ Travel / Environment
│   └─ Collision Candidate Generation
│
├─ kleine Interaction Resolver / Policies
│
├─ consumes:
│   ├─ Geometry / Target Query
│   ├─ Targetability / Relationship
│   ├─ Barrier / Defense Query
│   ├─ Time Field
│   ├─ ProjectileCombatPort
│   ├─ Projectile Explosion / Domain-Effect Resolution
│   └─ World / Support Ports
│
└─ exposes:
    ├─ ProjectileSpawnPort
    ├─ Host Frame Port
    ├─ External Interaction Capabilities
    ├─ narrow Read Ports
    ├─ Replication Projection
    └─ Host Presentation Projection

ProjectileReplicationAdapter
└─ projectileSnapshotCodec / Network transport

ProjectileClientReplica
└─ decoded replicated projectile state

ProjectilePresentationRuntime
├─ Host source: authoritative presentation projection
└─ Client source: replica presentation projection
```

Dateipfade und einzelne Klassennamen sind nicht normativ. Die **Contract-Familien** sind dagegen stabil: Spawn, Host Frame, External Interaction, Domain-/Combat-Auflösung, Read/Projection, Replication, Client Replica und Presentation dürfen im Verlauf nicht durch parallele Fassaden derselben Bedeutung vervielfacht werden. `03` materialisiert die konkreten Type-/API-Namen einmalig und `04` hält die realisierten Namen fest.

### 3.1 `WorldProjectileRuntime`

Öffentliche World-Boundary. Sie:

- besitzt Lifecycle/Teardown,
- komponiert den internen Store und Processor,
- exponiert Spawn und Host-Frame,
- bindet schmale Domain-Ports,
- exponiert schmale External-/Read-Capabilities,
- liefert Replication-/Presentation-Projektionen,
- besitzt keinen Renderer und keinen `NetworkBridge`.

### 3.2 `ProjectileSimulation` / `ProjectileStore`

Privater **kanonischer State-Holder und Writer innerhalb der fachlichen Ownership von `WorldProjectileRuntime`**:

- Registry / Identity,
- Runtime Records,
- Physics Handles,
- lokaler Flight-/Interaction-State,
- optionale sparse Feature-State-Blöcke,
- Capability-Indizes,
- Removal/Cleanup,
- lokale Projectile-Mutation.

Er ist **kein öffentliches Repository** und keine globale ECS-Registry.

### 3.3 Processor

Processor sind private technische Helfer innerhalb derselben fachlichen Ownership.

Sie dürfen:

- auf eine definierte Capability-Teilmenge arbeiten,
- Scratch-/Pool-Strukturen verwenden,
- kleine spezialisierte Algorithmen kapseln.

Sie dürfen nicht:

- eigene World-Lifetime/Authority entwickeln,
- ihre Reihenfolge selbst registrieren,
- globale System-Discovery nutzen,
- fremde Domain-Mutation besitzen.

---

## 4. Data-Oriented / ECS-inspirierte Leitentscheidung

### 4.1 Was übernommen wird

Gezielt übernommen werden:

- **capability-basierte Datenkomposition**,
- **kleine spezialisierte Processor**,
- **private abgeleitete Capability-Indizes**,
- **sparse Feature-State** für komplexe optionale Multi-Frame-Behaviors,
- **Pooling / Scratch Buffer / allocation-arme Hot Paths**,
- **semantische Daten statt Type-/Style-Switches**.

### 4.2 Was nicht übernommen wird

Nicht eingeführt werden:

- globales ECS,
- generische Entity Registry,
- generische Component Registry,
- generischer System Scheduler,
- dynamische Behavior Registry,
- Component Stores für jeden simplen Wert,
- Structure-of-Arrays/TypedArray-Migration als Selbstzweck,
- datengetriebene Ablaufsteuerung, die Same-Frame-Reihenfolge versteckt.

### 4.3 Entscheidungsregel für einen separaten State Store

Ein separater Store/Index ist nur sinnvoll, wenn mindestens zwei der folgenden Punkte zutreffen:

- Feature ist sparse: nur ein kleiner Teil der Projectiles besitzt es.
- Feature besitzt echten Multi-Frame-State.
- Feature wird in einem eigenen Hot-Path-Processor verarbeitet.
- Feature-State würde den normalen Record deutlich unübersichtlicher machen.
- Feature profitiert von einer eigenen Testgrenze.
- Iteration über alle Projectiles würde unnötig viele Branches erzeugen.

Gute Kandidaten:

- Homing,
- Mini Rocket,
- ggf. komplexe Path-/Travel-State-Machines.

Schlechte Kandidaten:

- Identity,
- Position/Velocity/Physics Handle,
- Lifetime,
- grundlegender Range-State,
- Presentation-Farbe,
- einfacher Damage-Wert.

### 4.4 Verständlichkeit für Coding-KIs

Der komplette Zustand eines einzelnen Projectiles muss weiterhin mit wenigen lokalen Zugriffen rekonstruierbar bleiben.

Verbotenes Zielbild:

```text
Projectile 4711
→ PositionStore
→ VelocityStore
→ LifetimeStore
→ DamageStore
→ AllegianceStore
→ BurnStore
→ HomingStore
→ ...
```

Bevorzugt:

```text
ProjectileRuntimeRecord
├─ core / physics / lifetime
├─ resolved spec
└─ wenige optionale benannte Feature-State-Blöcke
```

---

## 5. Private Capability-Indizes und Processor

Beispielhafte interne Indizes:

```ts
interface ProjectileCapabilityIndices {
  readonly homingIds: Set<ProjectileId>;
  readonly travelEffectIds: Set<ProjectileId>;
  readonly proximityIds: Set<ProjectileId>;
  readonly detonableIds: Set<ProjectileId>;
  readonly miniRocketIds: Set<ProjectileId>;
}
```

Die konkrete Liste richtet sich nach realem Nutzen. Nicht jede optionale Eigenschaft benötigt einen Index.

Regeln:

- Indizes sind **derived state** des Store-Owners.
- Spawn/Mutation/Despawn hält sie zentral synchron.
- Indizes werden nie als öffentliche Registry exponiert.
- Der kanonische Runtime-Record bleibt die Wahrheit.
- Ein Index darf keine eigene Gameplay-Semantik besitzen.

Bevorzugte Processor:

```text
FlightProcessor
HomingProcessor
TravelInteractionProcessor
CollisionProcessor
```

Keine Waffensysteme wie:

```text
HydraSystem
BfgSystem
GaussSystem
BurningRocketSystem
```

wenn die Mechanik über kombinierbare Semantik ausgedrückt werden kann.

Komplexe State-Machines wie Mini Rocket dürfen dagegen einen benannten lokalen Processor/Resolver besitzen, weil dort die Sequenz selbst fachlich relevant ist.

---

## 6. Öffentliche Contract-Familien

Die folgenden Namen sind bevorzugte Referenznamen, solange `03` sie noch nicht materialisiert hat. Sobald eine einführende Phase einen Contract real implementiert, wird sein konkreter Type/API-Name im Contract Manifest von `03` verbindlich und in `04` als realisiert dokumentiert. Spätere Phasen erweitern oder verwenden denselben Contract statt eine gleichbedeutende Parallel-Fassade anzulegen.

### 6.1 Spawn

```ts
export type ProjectileId = number;

export interface ProjectileSpawnPort {
  spawnProjectile(request: ProjectileSpawnRequest): ProjectileId;
}
```

Alle normalen Player-, Enemy-, Turret- und World-Projectile-Spawns laufen langfristig über diese fachliche Grenze.

### 6.2 Host Frame

```ts
export interface ProjectileHostFramePort {
  runHostProjectileStage(
    deltaMs: number,
    nowMs: number,
  ): ProjectileHostStageResult;
}
```

Falls die Migration temporär mehrere benannte Stages benötigt, ist dies zulässig. Im Endzustand taktet `HostUpdateCoordinator` jedoch keine internen Processor einzeln.

### 6.3 External Interaction

```ts
export interface ProjectileExternalInteractionPort {
  resolveExternalInteraction(
    request: ProjectileExternalInteractionRequest,
  ): ProjectileExternalInteractionOutcome;
}
```

Der konkrete Contract darf für reale Fälle schmaler getrennt werden. Er muss externe Detonation/Consume/Transform ermöglichen, ohne Runtime Records offenzulegen.

### 6.4 Read Ports

Kein allgemeines:

```ts
getActiveProjectiles(): ReadonlySet<ProjectileRuntimeRecord>
```

Stattdessen anwendungsbezogene Views:

- `ProjectileThreatReadPort`,
- `ProjectilePositionReadPort`,
- `ProjectilePresentationReadPort`,
- `ProjectileReplicationReadPort`,
- `ProjectileDiagnosticsReadPort`.

---

## 7. `ProjectileSpawnRequest`

Der heutige `ProjectileSpawnConfig` vermischt Flight, Gameplay, State und Presentation.

Bevorzugte logische Form:

```ts
export interface ProjectileSpawnRequest {
  readonly origin: {
    readonly x: number;
    readonly y: number;
    readonly angle: number;
    readonly gameplayMuzzleOrigin?: { x: number; y: number };
  };

  readonly flight: ProjectileFlightSpec;
  readonly provenance: ProjectileProvenance;
  readonly interaction: ProjectileInteractionSpec;
  readonly presentation: ProjectilePresentationDescriptor;
}
```

Nicht jede Teilstruktur muss physisch exakt so umgesetzt werden.

### 7.1 Request-Erzeugung

Der Request wird an der Execution-Grenze erzeugt.

Execution-Adapter dürfen:

- Weapon-Config in Projectile-Semantik übersetzen,
- Spawn-Time-Modifier einfrieren,
- Source/Slot/Turret-Herkunft setzen.

Sie dürfen nicht:

- Projectile-Lifecycle besitzen,
- aktive Projectiles lesen,
- Collision ausführen,
- Renderer ansprechen.

`WorldProjectileRuntime` erhält kein `WeaponConfig` und keinen Loadout-Zugriff.

### 7.2 Child-Projectiles

Child-/Split-Projectiles verwenden denselben normalen Spawn-Pfad.

Sie:

- erhalten eigene ID,
- übernehmen aktuelle Attribution/Allegiance,
- führen Source/Lineage/Correlation nur soweit benötigt fort,
- starten keinen neuen Resource-/Weapon-/Ability-Commit.

---

## 8. Provenance, Interaction und Presentation

### 8.1 Provenance

Bevorzugte Minimalform:

```ts
export interface ProjectileProvenance {
  readonly gameplaySourceId: string;
  readonly attributionId: string;
  readonly allegiance: ProjectileAllegianceRef;
  readonly sourceSlot?: LoadoutSlot;
  readonly sourceTurretId?: string;
  readonly lineage?: ProjectileLineage;
  readonly correlation?: ProjectileCorrelation;
}
```

Regeln:

- Attribution und Allegiance sind getrennt.
- Source wird durch Reflection nicht automatisch überschrieben.
- Lineage/Correlation nur mit realem Consumer.
- `ownerId` darf während der Migration adaptiert werden, ist aber kein neuer Core-Mehrzweckcontract.

### 8.2 Interaction Spec

Bevorzugt benannte semantische Gruppen statt Universal-Effektliste:

```ts
export interface ProjectileInteractionSpec {
  readonly directHit?: ProjectileDirectHitSpec;
  readonly explosion?: ProjectileExplosionSpec;
  readonly enemyHitExplosion?: ProjectileExplosionSpec;
  readonly impactCloud?: ProjectileImpactCloudSpec;
  readonly support?: ProjectileSupportSpec;
  readonly detonable?: ProjectileDetonableSpec;
  readonly proximityPulse?: ProjectileProximityPulseSpec;
  readonly pathEffect?: ProjectilePathEffectSpec;
}
```

Eine Mechanik ist damit eine Kombination von Fähigkeiten, nicht ein neuer Projectile-Typ.

**Mega-Record-Ratchet:** Ein neues optionales Top-Level-Feld in `ProjectileInteractionSpec`, `ProjectileFlightSpec` oder einem äquivalenten Capability-Record ist nur zulässig, wenn es eine wiederverwendbare semantische Fähigkeit beschreibt. Weapon-spezifische Parameter erweitern den kleinsten vorhandenen typisierten Capability-Zweig oder eine kleine benannte Policy. Kein `fooWeapon?: ...`-Wachstum pro Waffe.

### 8.3 Augments / Status-Eigenschaften

Während des Flugs erworbene Interaktionseigenschaften bleiben getrennt vom Spawn-Payload:

```ts
export type ProjectileInteractionAugment =
  | ProjectileBurnAugment
  | ProjectileImbueAugment;
```

Bevorzugtes Prinzip:

```text
Projectile + Burn Augment
```

statt:

```text
BurningBullet
BurningRocket
BurningHydra
...
```

Ein Augment darf eigene Provenance besitzen.

Merge-Regeln bleiben featurebezogen. Für Fire-Imbue wird die heutige stärkster-Burn-/DPS-Semantik zunächst erhalten.

### 8.4 Passive Presentation Projection Metadata

Presentation-Daten sind **keine Gameplay-Semantik**. Sie dürfen am Spawn-/Projection-Rand transportiert und für Replication/Renderer gecacht werden, bleiben für die autoritative Gameplay-Simulation jedoch opaque. Kein Processor, Resolver oder Combat-/Targetability-Pfad darf auf einzelne Presentation-Felder verzweigen.

```ts
export interface ProjectilePresentationDescriptor {
  readonly style: ProjectileStyle;
  readonly color: number;
  readonly ownerColor?: number;
  readonly visualScale?: number;
  readonly bulletPreset?: BulletVisualPreset;
  readonly grenadePreset?: GrenadeVisualPreset;
  readonly energyBallVariant?: EnergyBallVariant;
  readonly sporeVariant?: 'spore' | 'spore_void';
  readonly smokeTrailColor?: number;
  readonly tracer?: TracerConfig;
  readonly shotAudioKey?: string;
  readonly suppressSpawnFx?: boolean;
  readonly visualMuzzleOrigin?: { x: number; y: number };
}
```

Gameplay liest diesen Descriptor nie zurück. Bevorzugt liegt er in einem separaten Projection-State bzw. wird beim Spawn an einen Presentation-/Replication-Projection-Owner übergeben. Falls die erste Migration ihn noch im Runtime-Record referenziert, ist die Referenz ausschließlich passives Transport-/Projection-Metadatum und darf nicht zur fachlichen Decision Source werden.

---

## 9. Privater Runtime-State

Referenz:

```ts
interface ProjectileRuntimeRecord {
  readonly id: ProjectileId;
  readonly spec: ProjectileResolvedSpec;
  readonly body: ProjectilePhysicsHandle;

  createdAtHostMs: number;
  simulatedAgeMs: number;
  lastX: number;
  lastY: number;

  flight: ProjectileFlightRuntimeState;
  interaction: ProjectileInteractionRuntimeState;

  pendingDestroy: boolean;
}
```

### 9.1 Phaser-Body

Phaser Arcade Physics darf bleiben.

Der Body:

- ist Simulation-Infrastruktur,
- wird nicht öffentlich exponiert,
- wird nicht von fremden Gameplay-Consumern gelesen,
- muss nicht sichtbar sein,
- trägt keine Presentation-Authority.

Ein kompletter Physics-Rewrite ist ausdrücklich nicht Ziel dieses Refactorings.

### 9.2 Sparse Feature-State

Feature-State nur bei echtem Multi-Frame-Bedarf, z. B.:

```ts
interface ProjectileSparseState {
  homing?: HomingRuntimeState;
  penetration?: PenetrationRuntimeState;
  overlap?: TargetContactMemory;
  miniRocket?: MiniRocketRuntimeState;
  splitBounce?: SplitBounceRuntimeState;
  pathEffect?: PathEffectRuntimeState;
  grenade?: GrenadeRuntimeState;
}
```

Die Namen beschreiben Semantik, nicht konkrete Waffen. `splitBounce` kann z. B. Hydra-Semantik tragen; `pathEffect` u. a. den heutigen AWP-Corridor. `MiniRocketRuntimeState` ist eine bewusst begründete Ausnahme: `attack → explosion → coast → spent → return → pickup` ist eine zusammenhängende mehrstufige State-Machine. Diese Ausnahme ist **kein Präzedenzfall** für einen weapon-spezifischen State-Block pro Waffe.

Nicht jeder Block muss im selben Objekt liegen; ein separater Store ist nach § 4.3 erlaubt.

### 9.3 Target Contact Memory

Gleiche Dedupe-Semantik darf vereinheitlicht werden.

Beispiel:

```ts
interface LifetimeTargetMemory {
  readonly hitTargets: Set<ProjectileTargetKey>;
}
```

Nicht vereinheitlichen, wenn die Semantik abweicht:

- einmal pro Projectile-Lifetime,
- einmal pro Penetration-Chain,
- einmal pro Mini-Rocket-Stage,
- bis Target verlassen wurde,
- einmal pro Flame.

---

## 10. Flight, Lifetime und Zeit

### 10.1 Flight Spec

```ts
export interface ProjectileFlightSpec {
  readonly speed: number;
  readonly lifetimeMs: number;
  readonly rangePx?: number;
  readonly body: ProjectileBodySpec;
  readonly motion?: ProjectileMotionSpec;
  readonly collision?: ProjectileCollisionSpec;
  readonly obstacleInteraction?: ProjectileObstacleFlightSpec;
  readonly homing?: ProjectileHomingSpec;
  readonly split?: ProjectileSplitSpec;
  readonly miniRocket?: MiniRocketFlightSpec;
}
```

`ProjectileStyle` ist keine Flight-Regel.

Heute style-basierte Checks für AWP/Gauss/BFG/Hydra/Energy Ball/Flame/Leaf Blower werden langfristig durch explizite Semantik ersetzt.

### 10.2 FlightProcessor

Ein kleiner `FlightProcessor` ist sinnvoll für gemeinsame wiederkehrende Operationen wie:

- simulated age,
- remaining range,
- velocity decay,
- drag,
- time-field factor,
- hitbox growth,
- grundlegendes Expiry-Bookkeeping.

Er ist kein fachlicher Owner und keine öffentliche Capability.

### 10.3 Lifetime bleibt Core-State

Lifetime besitzt praktisch jedes Projectile und wird **nicht** als separates ECS-Component-/Store-Modell aufgespalten.

Identity, Real Age, Simulated Age, Lifetime und grundlegender Range-State bleiben zusammenhängend.

### 10.4 Zeitdimensionen

Bestehende Unterscheidung erhalten:

1. **Host-Zeit**: der explizit vom `HostUpdateCoordinator`/Host-Frame übergebene `nowMs`,
2. durch Time Bubble beeinflusste simulated age.

„Real Time“ bedeutet in diesem Dokument **nicht** versteckte Browser-/Wall-Clock-Zeit. Autoritative Projectile-Logik führt kein neues `Date.now()` oder `performance.now()` ein; Zeit kommt über Host-Frame-/World-Contracts herein.

Insbesondere:

- Movement und mehrere Flight-State-Machines nutzen simulated age,
- Air-Friction-Delay nutzt simulated age,
- Homing-Suche nutzt simulated age,
- Grenade-Fuse/Countdown nutzt reale Zeit.

Grenade-Fuse darf nicht unbeabsichtigt durch Time Bubble verlangsamt werden.

### 10.5 Time Field Port

```ts
export interface ProjectileTimeFieldPort {
  getMovementFactor(
    x: number,
    y: number,
    nowMs: number,
    provenance: ProjectileProvenance,
  ): number;
}
```

Velocity-/Drag-Anpassung bleibt Runtime-Verantwortung.

---

## 11. Homing und Guidance

Der heutige `ProjectileHomingController` zeigt bereits sinnvolle Data-Oriented-Techniken:

- wiederverwendeter Candidate-Pool,
- `Uint8Array` für Rejection-Marker,
- Lock-Reuse,
- Search-Intervall,
- Search-Radius,
- Forward-Bias,
- Line-of-Fire nur wenn nötig.

Diese Eigenschaften werden erhalten.

### 11.1 Zielstruktur

```text
heute:
ProjectileHomingController
    ↔ kompletter TrackedProjectile

Ziel:
HomingProcessor
    ↔ ProjectileKinematics
    ↔ HomingSpec
    ↔ HomingRuntimeState
    ↔ Provenance
    ↔ ProjectileTargetQueryPort
    ↔ ProjectileTargetabilityPort
    ↔ LineOfFireReadPort
```

Der Processor arbeitet bevorzugt nur über `homingIds` bzw. einen äquivalenten privaten sparse Store.

### 11.2 Homing-State

```ts
interface HomingRuntimeState {
  lockedTarget?: ProjectileTargetRef;
  lastSearchAtSimulatedMs?: number;
}
```

Nur real benötigte Felder.

### 11.3 Mini Rocket

Mini-Rocket `attack / coast / return` wird nicht in generisches Homing zerlegt.

Die normale Guidance darf wiederverwendet werden; Return-Reserve, Pickup, Stage-Explosionen und Speed-Reduktion bleiben eigene Mini-Rocket-State-Machine.

---

## 12. Normalisierte Targets

```ts
export type ProjectileTargetRef =
  | { readonly kind: 'player'; readonly id: string }
  | { readonly kind: 'enemy'; readonly id: string }
  | { readonly kind: 'decoy'; readonly id: number }
  | { readonly kind: 'rock'; readonly id: number; readonly obstacleKind?: PlaceableKind }
  | { readonly kind: 'base'; readonly id: string }
  | { readonly kind: 'train'; readonly id: string }
  | { readonly kind: 'construction'; readonly id: string | number }
  | { readonly kind: 'projectile'; readonly id: ProjectileId };
```

Stabiler lokaler Key:

```text
player:<id>
enemy:<id>
decoy:<id>
rock:<id>
base:<id>
train:<id>
construction:<id>
projectile:<id>
```

Damit werden heutige inkonsistente Dedupe-Key-Formen vereinheitlicht, ohne globalen Target-Manager.

### 12.1 Kanonische Target-Identität

Dieselbe physische/domain Entity darf innerhalb eines Projectile-Stages **genau eine** `ProjectileTargetRef` besitzen. Technische Legacy-Repräsentationen dürfen nicht parallel als unterschiedliche fachliche Targets erscheinen.

Insbesondere ist bei heutigen Placeables explizit zu entscheiden, ob ein Objekt als `rock` oder `construction` normalisiert wird. Ein Runtime-Turret/Pedestal/Tunnel, das technisch über Rock-/Obstacle-Infrastruktur läuft, darf nicht gleichzeitig z. B. als `rock:42` **und** `construction:42` in Dedupe-/Penetration-Logik auftauchen.

Die konkrete Zuordnung darf Phase 6 anhand der realen Owner/IDs materialisieren; der Contract **eine Entity → eine kanonische Target Identity** ist normativ.

### 12.2 Combat-Target-Teilmenge

`ProjectileTargetRef` ist die gemeinsame Collision-/World-Sicht und deshalb bewusst breiter als Combat. Für `ProjectileCombatPort` wird eine engere Teilmenge materialisiert, z. B.:

```ts
export type ProjectileCombatTargetRef =
  | Extract<ProjectileTargetRef, { readonly kind: 'player' }>
  | Extract<ProjectileTargetRef, { readonly kind: 'enemy' }>
  | Extract<ProjectileTargetRef, { readonly kind: 'decoy' }>;
```

Die exakte Teilmenge richtet sich nach den tatsächlich Combat-owned Targets. `rock`, `base`, `train`, `construction` und `projectile` dürfen nicht allein deshalb durch `ProjectileCombatPort` laufen, weil sie in `ProjectileTargetRef` vorkommen.

---

## 13. Collision Processing

### 13.1 Collision Spec

Bevorzugt explizite Semantik:

```ts
export type ProjectileCollisionMode =
  | 'sweep'
  | 'overlap'
  | 'physics'
  | 'none';

export interface ProjectileCollisionSpec {
  readonly mode: ProjectileCollisionMode;
  readonly targetKinds: readonly ProjectileTargetRef['kind'][];
}
```

Die exakte Form kann vereinfacht werden.

### 13.2 Kleine Processor

Interne Processor dürfen u. a. sein:

```text
SweepCollisionProcessor
OverlapCollisionProcessor
WorldObstacleCollisionProcessor
```

Sie werden durch `WorldProjectileRuntime` in definierter Reihenfolge aufgerufen.

Nicht einführen:

```text
BulletCollisionSystem
FlameCollisionSystem
HydraCollisionSystem
BfgCollisionSystem
...
```

wenn sich die Mechanik über gemeinsame Collision-/Interaction-Semantik ausdrücken lässt.

### 13.3 Impact Candidate

```ts
export interface ProjectileImpactCandidate {
  readonly projectileId: ProjectileId;
  readonly target: ProjectileTargetRef;
  readonly x: number;
  readonly y: number;
  readonly distanceAlongTravel?: number;
  readonly normal?: { readonly x: number; readonly y: number };
  readonly source: 'sweep' | 'overlap' | 'physics-collider' | 'world-boundary';
}
```

Candidate enthält keine Damage-Mutation.

### 13.4 Continuous Collision

`combat/rules/ProjectileImpactResolver.ts` bleibt Migrationsanker.

Zu erhalten:

- Segment-Sweep gegen Kreisziel,
- Starting-overlap kann mit 0.01px-Epsilon ignoriert werden,
- nächster Treffer entlang Segment gewinnt,
- näherer World-Blocker verhindert Target-Hit.

Langfristig gehört diese Logik semantisch zur Projectile-Collision-Seite.

### 13.5 Deterministische Candidate-Reihenfolge

1. frühester Travel-Hit,
2. definierter Tiebreak nur falls nötig,
3. lokale Dedupe-/Penetration-Regel,
4. Result anwenden,
5. erst danach nächsten zulässigen Candidate auswerten.

Set-/Map-Iterationsreihenfolge darf kein versteckter Gameplay-Vertrag sein.

---

## 14. Targetability, Barrier, Reflection und Deflection

### 14.1 Targetability

```ts
export interface ProjectileTargetabilityPort {
  canDamage(
    provenance: ProjectileProvenance,
    target: ProjectileTargetRef,
    allowTeamDamage: boolean,
  ): boolean;

  isFriendly(
    provenance: ProjectileProvenance,
    target: ProjectileTargetRef,
  ): boolean;
}
```

Der erste Adapter darf auf heutige Combat-/Relationship-Semantik delegieren.

Die Runtime kennt keinen `NetworkBridge`.

### 14.2 Target Query

```ts
export interface ProjectileCollisionTarget {
  readonly ref: ProjectileTargetRef;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly active: boolean;
}
```

Targets werden immutable gelesen.

### 14.3 Barrier-/Defense-Abhängigkeitsrichtung

Barrier- und Defense-Semantik bleibt bei ihrem kanonischen Owner und wird Projectile über **schmale semantische Query-/Resolution-Grenzen** angeboten. Die konkrete erste Implementierung darf vorhandene Systeme adaptieren, aber `ProjectileSimulation`, Collision-Processor und Interaction-Resolver importieren weder `TeslaDomeSystem`, Player-Gameplay noch `CombatSystem` direkt.

Drei fachlich unterschiedliche Fälle bleiben explizit getrennt:

1. **World-space Barrier** – z. B. Tesla Dome. Sie wird entlang Travel/Candidate-Verarbeitung **vor** einer normalen Target-Interaction ausgewertet.
2. **Target-local Defense** – z. B. Player Energy Shield. Sie gehört zur Direct-Impact-/Target-Owner-Auflösung und wird nicht als vorgelagerte World-Barriere ein zweites Mal entschieden.
3. **Aktive externe Deflection / Transform** – z. B. Leaf Blower. Sie ist ein Command an den Projectile-Owner über `ProjectileExternalInteractionPort`.

Bevorzugtes Muster für World-space Barrier:

```text
Projectile Candidate / Travel Segment
        ↓
Projectile Barrier Port
        ↓
kanonischer Barrier-Owner
        ↓
kleines Barrier Result
        ↓
Projectile Interaction Resolution
```

Das Barrier Result enthält nur die für Projectile notwendige Semantik, z. B. `accepted`, `absorbed` oder `reflected` mit Attribution-/Allegiance-Änderung. Konkreter Dome-/Upgrade-State bleibt hinter dem Port.

Die drei Fälle **müssen nicht zwangsläufig drei physische Interfaces erzeugen**. Eine erste Implementierung darf nahe Semantik hinter wenigen passenden Ports bündeln, solange Aufrufpunkt, Authority und Writer eindeutig bleiben und dieselbe Defense-Regel nicht sowohl vor der Target-Interaction als auch im Direct-Impact-Pfad erneut entschieden wird.

**Aktive externe Deflection** wird nicht als Direktmutation eines fremden Runtime-Records umgesetzt. Sie kommt als semantischer Request über `ProjectileExternalInteractionPort` in `WorldProjectileRuntime` hinein; dort bleibt die tatsächliche Velocity-/Attribution-/Allegiance-Mutation beim Projectile-Owner.

### 14.4 Player Energy Shield

Shield-Block ist **target-lokale Target-/Combat-Semantik**. Er wird im Direct-Impact-/Target-Owner-Pfad aufgelöst und nicht zusätzlich als vorgelagerte World-space Barrier verarbeitet.

Beispiel:

```ts
type ProjectileDefenseResolution =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'absorbed' }
  | {
      readonly kind: 'reflected';
      readonly damageFactor: number;
      readonly attributionId: string;
      readonly allegiance: ProjectileAllegianceRef;
    };
```

Die resultierende Projectile-Mutation erfolgt in Projectile.

### 14.5 Tesla Dome

Vor normalen Target-Hits zu erhalten:

- normale geworfene Utilities passieren,
- capturable `spawn_enemy`-Grenade kann abgefangen werden,
- feindliches Projectile wird absorbiert oder reflektiert,
- reflektierte Spawn-Grenade behält Grenade-Semantik und Restfuse,
- Attribution/Allegiance wechseln auf Dome-Besitzer,
- Source/Lineage bleiben unterscheidbar.

Der Projectile-Code kennt dabei keine konkrete Tesla-Dome-Klasse. Die Dome-Entscheidung kommt über den Barrier-/Defense-Port; nur die resultierende Projectile-Mutation wird intern angewendet.

### 14.6 Leaf-Blower-Deflection

Projectile↔Projectile-Interaction.

Zu erhalten:

- nur geeignete gegnerische Projectiles,
- normale geworfene Utilities nicht,
- neue Richtung folgt Luftstoß,
- Attribution/Allegiance wechseln,
- Restpayload bleibt erhalten.

Bevorzugter Endzustand: vorhandenes Projectile über `ProjectileExternalInteractionPort` transformieren. Der auslösende Leaf-Blower-/Gameplay-Code erhält keinen Runtime-Record und mutiert ihn nicht direkt. Destroy+Respawn ist als temporärer Migrationsadapter zulässig, aber nicht bevorzugt, weil Identity/Lineage unnötig brechen.

---

## 15. `ProjectileCombatPort`, Domain-Effect-Grenze und authoritative Outcomes

`ProjectileCombatPort` ist die stabile Grenze zu **Combat-eigener** Semantik. Er ist ausdrücklich kein Universal-Port für den gesamten Explosion-/World-Fan-out.

```ts
export interface ProjectileCombatPort {
  resolveDirectImpact(
    request: ProjectileDirectImpactRequest,
  ): ProjectileDirectImpactOutcome;

  resolveExplosionCombat(
    request: ProjectileCombatExplosionRequest,
  ): ProjectileCombatExplosionOutcome;
}
```

Für eine Projectile-Explosion konsumiert `WorldProjectileRuntime` stattdessen eine schmale Domain-Orchestrierungsgrenze:

```ts
export interface ProjectileExplosionResolutionPort {
  resolveProjectileExplosion(
    request: ProjectileExplosionRequest,
  ): ProjectileExplosionOutcome;
}
```

Der erste Adapter darf intern noch `CombatSystem` und vorhandene World-/Environment-Owner ansprechen. Er koordiniert nur den bestehenden Fan-out; er wird **kein** generischer `ExplosionManager`, kein globaler Gameplay-Effect-Bus und kein neuer fachlicher Owner. Combat-Damage/AoE wird über `ProjectileCombatPort` bzw. dessen Legacy-Adapter aufgelöst, während Environment Damage, Ground Fire, Knockback und World Effects bei ihren kanonischen Ownern bleiben.

### 15.1 Direct Request

```ts
export interface ProjectileDirectImpactRequest {
  readonly projectileId: ProjectileId;
  readonly target: ProjectileCombatTargetRef;
  readonly impact: { readonly x: number; readonly y: number };
  readonly velocity: { readonly x: number; readonly y: number };
  readonly provenance: ProjectileProvenance;
  readonly directHit: ProjectileDirectHitSpec;
  readonly augments: readonly ProjectileInteractionAugment[];
}
```

### 15.2 Outcome

```ts
export interface ProjectileDirectImpactOutcome {
  readonly accepted: boolean;
  readonly blocked?: boolean;
  readonly actualDamage?: number;
  readonly becameDead?: boolean;
  readonly defense?: ProjectileDefenseResolution;
}
```

Nur Felder mit realem Consumer implementieren.

### 15.3 Request vs. Outcome

```text
DamageRequest(20)
    ↓
Combat / canonical State Owner
    ↓
z. B. 13 tatsächlicher Damage
    ↓
Authoritative Outcome(actualDamage=13)
    ↓
Gameplay Reaction / Hit Feedback
```

Spätere Adrenalin-Orbs reagieren auf bestätigte Hit-/Damage-Outcomes, nicht auf Collision oder Request.

### 15.4 Legacy-Adrenalin

Das Refactoring ändert die aktuelle Adrenalinmechanik nicht.

`adrenalinGain` soll jedoch aus Flight-/Physics-Semantik herausgelöst und als Hit-Reaction-Metadatum behandelt werden.

### 15.5 Explosion-/Domain-Effect-Abhängigkeitsrichtung

```text
Projectile Runtime
    ↓ ProjectileExplosionRequest
ProjectileExplosionResolutionPort
    ├─ Combat-Anteil ─────→ ProjectileCombatPort
    ├─ Environment ───────→ kanonischer Environment-Owner
    ├─ Ground Fire ───────→ Fire-/World-Owner
    ├─ Knockback ─────────→ kanonischer Physics-/Combat-Owner
    └─ World Effects ─────→ jeweiliger fachlicher Owner
    ↓
ProjectileExplosionOutcome
```

Der Orchestrierungsadapter darf Daten zusammenführen und Outcomes für Projectile-Continuation aggregieren, besitzt aber **keine** eigene allgemeine Damage-, Fire-, Train-, Matrix-, Black-Hole- oder Time-Bubble-Regel. Neue fachliche Wirkungen werden beim zuständigen Owner ergänzt, nicht als Branch im Projectile-Core oder in einem Universal-Explosion-System.

### 15.6 CombatSystem nach Projectile-Cutover

`CombatSystem` soll dann:

- keine aktiven Projectiles iterieren,
- Projectiles nicht destroyen/spawnen,
- keine Phaser-Projectile-Geometry besitzen,
- keine Reflection durch Clone-via-Spawn als Projectile-Owner implementieren,
- keine `TrackedProjectile`-Parameter als Projectile-API erhalten.

Er darf vor seinem eigenen Refactor weiterhin Damage-/Armor-/Shield-/Burn-/AoE-Regeln intern besitzen.

---

## 16. Explosion, Grenade und Mini Rocket

### 16.1 Explosion Request

```ts
export interface ProjectileExplosionRequest {
  readonly projectileId?: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly provenance: ProjectileProvenance;
  readonly effect: ProjectileExplosionSpec;
  readonly continuation?: ProjectileExplosionContinuation;
}
```

Standalone-Explosionen ohne Projectile gehören nicht in `WorldProjectileRuntime`.

### 16.2 Domain-Fan-out

Heute erzeugt Projectile-Explosion u. a.:

- Combat-AoE,
- Environment-Damage,
- Knockback,
- Ground Fire,
- Fire Chunks,
- Black Hole,
- Reinforcement Matrix,
- Time Bubble,
- Presentation.

Diese Fan-out-Semantik liegt hinter `ProjectileExplosionResolutionPort` bzw. einem äquivalenten schmalen Host-/Domain-Adapter und wandert nicht in die Projectile-Simulation. Der Adapter orchestriert bestehende Owner, besitzt deren Regeln aber nicht. `ProjectileCombatPort` verarbeitet dabei nur den Combat-Anteil.

Non-Damage-Payloads wie Reinforcement Matrix oder Time Bubble dürfen als typisierte `WorldEffectRequest`s modelliert werden.

### 16.3 Grenades

Grenade = Flight/Fuse + terminale Payload-Semantik.

Bestehende Fälle:

- Damage,
- `spawn_enemy`,
- Fire,
- Time Bubble,
- Smoke.

Diese werden nicht zu Weapon-/Style-Sonderbranches im Flight-Core.

Für `spawn_enemy` gilt bei Reflection/Deflection ein harter Provenance-Contract: Der terminal erzeugte Domain-Entity-Spawn leitet Attribution/Allegiance aus der **aktuellen `ProjectileProvenance` zum Zeitpunkt der terminalen Resolution** ab. Eine beim ursprünglichen Spawn eingefrorene hostile Faction darf eine inzwischen reflektierte friendly Grenade nicht wieder feindlich machen. Source/Lineage bleiben davon getrennt erhalten.

### 16.4 Mini Rocket

Mini Rocket bleibt explizite State-Machine:

```text
attack
  ↓
pending explosion
  ↓ Domain outcome
coast
  ↓
attack ...
  ↓ spent
return
  ↓
collected / destroyed
```

Zu erhalten:

- mehrere Explosionen,
- Cascade,
- Speed-Reduktion pro Stage,
- Coast,
- Rest-Range,
- excluded target für Folgestage,
- Return-Reserve,
- Owner-Rückflug,
- Pickup-Radius,
- spent = kein weiterer Schaden,
- Collection-/Destruction-Outcomes.

### 16.5 Mini-Rocket-State-Store

Mini Rocket ist ein guter Kandidat für sparse Feature-State oder einen separaten lokalen Store, weil:

- nur wenige Projectiles betroffen sind,
- viele Felder mehrstufigen State repräsentieren,
- ein eigener Processor die normale Flight-Schleife entlasten kann.

Trotzdem bleibt `ProjectileSimulation` kanonischer Owner und orchestriert die State-Machine.

### 16.6 Same-Frame-Rückkanal

```text
Projectile Explosion Request
    ↓
ProjectileExplosionResolutionPort
    ↓ Combat + weitere kanonische Domain-Owner
aggregated authoritative outcome / damagedTargetKeys
    ↓
Projectile continuation
```

Referenz:

```ts
export interface ProjectileExplosionOutcome {
  readonly damagedTargetKeys: readonly string[];
}

export interface ProjectileExplosionContinuationPort {
  completeProjectileExplosion(
    projectileId: ProjectileId,
    outcome: ProjectileExplosionOutcome,
  ): void;
}
```

Kein generisches Workflow-/Promise-System einführen.

---

## 17. External Interactions

External Interactions sind **Commands an den Projectile-Owner**, keine Query auf mutierbare Runtime-Records. Dazu gehören Detonation, Consume und aktive Deflection/Transform. Der auslösende Consumer liefert nur semantische Parameter; `WorldProjectileRuntime` prüft Capability/Identity und führt die autoritative Projectile-Mutation aus.

### 17.1 ASMD / Detonation

Ziel:

```text
Hitscan / gekoppelte Mechanik
    ↓
Detonation Request
    ↓
ProjectileExternalInteractionPort
    ↓
detonable capability index / query
    ↓
authoritative consume/transform
    ↓
typed Detonation Outcome
```

Wichtige Semantik:

- externe Detonation vor normalem Hit, wenn heute so,
- Tags und Cross-Team-Regeln bleiben,
- consumed Projectile wird im selben Frame nicht nochmals normal verarbeitet,
- kein Consumer bekommt die aktive Runtime-Collection.

`detonableIds` ist ein sinnvoller privater Capability-Index, falls die Query dadurch klarer/effizienter wird.

### 17.2 Aktive Deflection / Transform

Für Leaf-Blower-Deflection und vergleichbare aktive Fremdinteraktionen gilt:

```text
externer Gameplay-/Projectile-Interaction-Resolver
    ↓ typed Deflection/Transform Request
ProjectileExternalInteractionPort
    ↓
Capability-/Targetability-Prüfung im Projectile-Owner
    ↓
ChangeVelocity / ChangeAttribution / ChangeAllegiance / Consume
```

Kein externer Consumer erhält `ProjectileRuntimeRecord` oder Phaser-Body zum Mutieren.

### 17.3 Translocator

`TranslocatorSystem` bleibt Owner der Puck-Zuordnung pro Player.

Benötigte Capability:

```ts
export interface TranslocatorProjectilePort {
  spawnPuck(request: TranslocatorPuckSpawnRequest): ProjectileId;
  getPuckPosition(id: ProjectileId): { x: number; y: number } | null;
  consumePuck(id: ProjectileId): boolean;
}
```

Kein allgemeines `getProjectileById()` mit Runtime-Record.

---

## 18. Travel- und Environment-Interactions

### 18.1 Travel Sample

```ts
export interface ProjectileTravelSample {
  readonly projectileId: ProjectileId;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly provenance: ProjectileProvenance;
  readonly capabilities: ProjectileTravelCapabilities;
}
```

Diese Sicht wird nicht global veröffentlicht.

Ein `travelEffectIds`-Index ist sinnvoll, wenn nur ein kleiner Teil der Projectiles Path-/Environment-Semantik besitzt.

### 18.2 Fire Imbue

Ziel:

```text
Travel Segment
    ↓
ProjectileEnvironmentInteractionPort
    ↓
AddBurnAugment
    ↓
ProjectileSimulation wendet Augment an
    ↓
erst danach Target Impact
```

Same-Frame-Vertrag:

> Durchquert ein Projectile im selben Frame brennenden Boden und trifft danach ein Target, ist das Augment bereits wirksam.

### 18.3 Fireball Trail

`lastFireTrailCellKey` bleibt lokaler Projectile-State.

Ground-Fire-Erzeugung erfolgt beim Fire-/World-Owner über World Request.

### 18.4 AWP Corridor

Ziel:

- `pathEffect` als explizite Capability,
- Travel Segment auswerten,
- Dedupe lokal am Projectile/Path-State,
- Damage/Fire/Impulse als Domain Requests,
- `WeaponUpgradeSystem` liefert Regeln, mutiert aber keinen Runtime-Record.

### 18.5 Processing-Reihenfolge

Travel-/Environment-Augments, die einen Hit verändern, laufen vor Target Interaction.

Reine Trail-/Presentation-Ausgaben dürfen später gepuffert werden.

---

## 19. Lifecycle-Outcomes und Gameplay-Reactions

```ts
export type ProjectileLifecycleOutcome =
  | {
      kind: 'resolved';
      projectileId: ProjectileId;
      provenance: ProjectileProvenance;
      reaction?: ProjectileReactionMetadata;
    }
  | {
      kind: 'mini-rocket-collected';
      projectileId: ProjectileId;
      collectorId: string;
      pickup: MiniRocketPickupSpec;
    }
  | {
      kind: 'mini-rocket-destroyed';
      projectileId: ProjectileId;
    };
```

### 19.1 AK47

`Ak47BehaviorRuntime` soll kein komplettes `TrackedProjectile` erhalten.

Nur tatsächlich benötigte Daten:

- Shot-/Correlation-ID,
- Fire-Superiority-Metadaten,
- ggf. Hit-/Damage-Metadaten,
- resolved/ended Outcome.

### 19.2 Mini-Rocket Pickup

Projectile entscheidet nur die autoritative Collection.

Resource-/Armor-Mutation bleibt beim passenden Player-/Combat-/Resource-Owner.

### 19.3 Hit Feedback

Hit Feedback konsumiert passive authoritative Outcomes.

Es beeinflusst weder Collision noch Damage-Authority.

---

## 20. Fremd-Consumer-Migrationsmatrix

Diese Matrix ist direkter Input für `03`.

| heutiger Consumer | benötigte Information/Aktion | Zielcontract |
|---|---|---|
| `WorldWeaponExecutionRuntime` | Spawn | `ProjectileSpawnPort` |
| `AutomatedWeaponExecutionAdapter` | Spawn inkl. Gauss | `ProjectileSpawnPort` |
| `SpecializedWeaponExecutionAdapter` | Spezialpayload-Spawn | `ProjectileSpawnPort` |
| `CombatSystem` | Target-Hits, Combat-Anteil von Explosion, heutige Reflection/Destroy-Kopplung | `ProjectileCombatPort`; Collision raus; Reflection-Mutation zurück zu Projectile |
| `WorldCombatGameplayBinding` | Domain-/Homing-/Impact-/Defense-Wiring | Composition schmaler Combat-, Defense-, Domain-Effect- und Query-Ports |
| `DetonationSystem` | Search/Detonate | External Interaction Port |
| `TranslocatorSystem` | Puck spawn/position/consume | `TranslocatorProjectilePort` |
| `FlamethrowerUpgradeSystem` | Travel + Augment | Environment-Interaction-Port |
| `WeaponUpgradeSystem` | AWP Travel/Path | Path-Interaction-Port |
| `CoopDefenseEnemyDodgeSystem` | Position/Velocity/Threat | `ProjectileThreatReadPort` |
| `WorldTrainRuntime` | Train Collision + Damage | Geometry + World Damage Request |
| `WorldGeometryBinding` | Rock/Base/World Geometry | `ProjectileGeometryBindingPort` |
| `HostUpdateCoordinator` | Stage, Result Batch, Snapshot Read | Host Frame + Replication |
| `ClientUpdateCoordinator` | decoded State + Extrapolation | Client Replica |
| Renderer | Visuals | Presentation Read/Events |
| Lighting/Shadow | Samples | Presentation Read Port |
| Weapon Balance Lab | counts/ownership | Diagnostics Read Port |

### 20.1 Threat Read Port

```ts
export interface ProjectileThreatSample {
  readonly id: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly provenance: ProjectileProvenance;
  readonly dodgeRelevant: boolean;
}
```

Enemy-Dodge darf eigenen lokalen Broadphase behalten.

Kein neuer globaler Projectile-Spatial-Index nur dafür.

### 20.2 Diagnostics

Debug-/Balance-Code bekommt explizite Summary-Reads, keine mutierbaren Runtime-Objekte.

---

## 21. Replication

### 21.1 Bestehende Wire-Semantik

Zunächst erhalten:

- `s`: statische Daten, gecacht + Resend/Refresh,
- `u`: vollständiger dynamischer State aller aktiven Projectiles pro Network-Tick,
- kein Delta-Vorzustand für dynamischen Record,
- Despawn durch Abwesenheit aus `u`,
- Full Snapshot liefert Statik für alle aktiven IDs,
- verlorene Static-Daten heilen durch Resend/Refresh,
- Wire-Feldreihenfolge bleibt Protocol-Contract.

Das Refactoring ist kein Auftrag, dieses Format neu zu erfinden.

### 21.2 Replication Projection

```ts
export interface ProjectileReplicationRecord {
  readonly id: ProjectileId;
  readonly static: ProjectileReplicationStatic;
  readonly dynamic: ProjectileReplicationDynamic;
}
```

Der Adapter besitzt:

- Static-resend count,
- Refresh cursor,
- Full-snapshot request,
- Seen IDs,
- Codec-Aufruf.

Diese Zustände gehören nicht in `ProjectileSimulation`.

### 21.3 Nicht replizieren

Nicht automatisch:

- komplette Provenance,
- komplette Interaction Payloads,
- interne Dedupe-Sets,
- Homing-Locks,
- private Capability-Indizes,
- Combat Requests,
- Phaser-Body-State.

Nur Client-relevante Projection.

### 21.4 Wire-Änderungen

Nur bei konkretem Nutzen, z. B.:

- notwendige visuelle Semantik fehlt,
- bestehende Presentation-Heuristik ist unzuverlässig,
- ID-Semantik erzeugt stale State,
- Static/Dynamic-Trennung wird sonst künstlich verletzt.

Dann Codec-/Late-Join-/Loss-Tests ergänzen.

### 21.5 Identity-Scope

Eine `ProjectileId` wird innerhalb derselben `worldRevision` **nicht wiederverwendet**. Erst World-Teardown bzw. eine neue World-Revision beginnt einen neuen Identity-Scope.

Damit gilt für Replication und Client Replica:

- Removal-by-absence kann eine ID innerhalb derselben World endgültig als beendet behandeln,
- verspäteter/staler Replica-State kann nicht versehentlich eine neue Projectile-Instanz derselben World adressieren,
- es ist kein zeitbasiertes „nicht zu früh wiederverwenden“-Heuristikfenster nötig.


---

## 22. Client Replica und Presentation

### 22.1 Client Replica

Besitzt:

- decoded Server-State,
- per-ID Replica-State,
- Empfangszeit,
- Extrapolation,
- Removal,
- readonly Presentation-Projektion.

Keine Renderer.

### 22.2 Extrapolation

Erhalten:

- normale Projectiles linear,
- Flame/Leaf Blower exponentielle Velocity-Decay entsprechend Host,
- keine lokale Gameplay-Collision,
- kein Gameplay-Despawn aufgrund lokaler Geometrie.

### 22.3 Presentation Runtime

Host und Client sollen möglichst dasselbe Presentation-Read-Modell bedienen:

```text
Host authoritative projection ─┐
                               ├─> ProjectilePresentationRuntime
Client Projectile Replica ─────┘
```

Presentation besitzt Style-Dispatch zu den konkreten Renderern.

`style` darf hier zentraler Dispatch-Key bleiben.

### 22.4 Spawn Audio / Prediction

Erhalten:

- eigene vorhergesagte Shots nicht doppelt abspielen,
- Utilities ohne Prediction wie bisher,
- `suppressSpawnFx` bleibt Presentation-Semantik.

### 22.5 Impact-/Despawn-VFX

Bestehende Presentation-Heuristiken dürfen zunächst erhalten bleiben, solange sie keine Gameplay-Authority besitzen.

Hydra-Split-Erkennung aus Parent-Removal + neuen Childs ist daher kein Grund für ein Wire-Redesign während des Core-Refactors.

### 22.6 Licht / Schatten

Lighting/Shadow konsumieren ein einheitliches `ProjectilePresentationReadPort`.

---

## 23. World Composition und Geometry

### 23.1 Lifetime

Heute scene-konstruierten `ProjectileManager` durch echten world-scoped Owner ersetzen:

```text
ArenaScene
   ↓
World materialisiert
   ↓
WorldProjectileRuntime entsteht
   ↓
Bindings
   ↓
World teardown
   ↓
Runtime + Indices + Replica/Presentation State vollständig weg
```

### 23.2 Geometry Binding

```ts
export interface ProjectileGeometryBindingPort {
  bindWorldGeometry(geometry: ProjectileWorldGeometry | null): void;
}
```

Die erste Implementierung darf intern weiter Phaser Groups verwenden.

### 23.3 Shared Obstacle Index

Kein zweiter Index.

Projectile konsumiert den heutigen gemeinsamen `ArenaObstacleIndex` hinter Geometry-/Query-Port.

Ein späterer neutralerer World-Geometry-Owner darf den Adapter ersetzen, ohne Projectile-Contracts zu ändern.

### 23.4 Train

`WorldTrainRuntime` bleibt kanonischer Train-Damage-Owner.

Projectile erhält Train-Geometry / Candidate und emittiert Domain Request.

Keine dauerhafte `setTrainHitCallback()`-Kopplung.

---

## 24. Host-Frame und Same-Frame-Verträge

### 24.1 Heutige relevante Reihenfolge

```text
Physics / World movement
    ↓
DetonationSystem.checkProjectileDetonations()
    ↓
PlayerGameplay.runHostPreCombatStage()
  - Fire Imbue
  - AWP Path
    ↓
CombatSystem.update()
  - Dome / Leaf Deflection
  - Projectile→Player/Enemy/Decoy
    ↓
Combat burn update
    ↓
ProjectileManager.hostUpdate()
  - Flight bookkeeping
  - Grenade fuse
  - Mini Rocket
  - Expiry / Explosion Requests
    ↓
PlayerGameplay.runHostPostProjectileStage()
    ↓
Explosion / Grenade / Domain Resolution
    ↓
Mini-Rocket continuation
    ↓
Snapshot
```

### 24.2 Zielreihenfolge

```text
Physics Movement
    ↓
External Projectile Interactions
    ↓
Travel / Environment Augments
    ↓
Barrier / Projectile↔Projectile Interactions
    ↓
Target / Obstacle Candidate Processing
    ↓
Direct Domain Requests + authoritative Outcomes
    ↓
Flight / Fuse / Expiry / special-state finalization
    ↓
Projectile HostStageResult
    ↓
Post-Projectile Gameplay Stage
    ↓
deferred Explosion / Domain-Effect / Grenade / World-Effect Resolution
    ↓
specific continuation feedback
    ↓
Replication Snapshot
```

Die Processor-Reihenfolge wird **statisch** durch `WorldProjectileRuntime` vorgegeben. Keine Registry darf die Reihenfolge dynamisch zusammensetzen.

### 24.3 Harte Same-Frame-Verträge

1. Detonation vor normalem Hit, wenn dasselbe Projectile betroffen ist.
2. Fire-Imbue vor nachfolgendem Same-Frame-Hit.
3. Dome-/Leaf-Deflection vor normalem Target-Hit.
4. Continuous Hit berücksichtigt näheren World-Blocker.
5. Penetration verarbeitet Targets deterministisch entlang der Flugstrecke.
6. Post-Projectile-Gameplay bleibt hinter direkter Projectile-Auflösung.
7. Mini-Rocket Explosion-Outcome kann nächste Stage im selben Frame freigeben.
8. Grenade-Fuse bleibt Real-Time.
9. Time Bubble verändert nur dafür vorgesehene Zeiten.

### 24.4 Spawn während eines laufenden Projectile-Stages / Reentrancy

Child-/Split-/Interaction-Spawns dürfen die gerade laufende Iterationsmenge nicht implizit durch `Set`-/Array-/Map-Reentrancy verändern.

Vor dem ersten entsprechenden Cutover wird die bestehende Semantik charakterisiert, insbesondere für Hydra/Child-Spawns und weitere Fälle, die während eines Projectile-Stages neue Projectiles erzeugen. Danach wird pro Stage explizit festgelegt, ob neu erzeugte Projectiles noch im selben Stage oder erst im nächsten Stage verarbeitet werden.

Harte Regel:

> **Same-Frame-Verarbeitung neu gespawnter Projectiles ist nur zulässig, wenn sie ein benannter Stage-Contract ist; sie darf nie zufällig aus Collection-Iterationsverhalten entstehen.**

Eine robuste Umsetzung darf dafür z. B. eine feste Stage-Start-Menge, eine Pending-Spawn-Queue oder eine äquivalente explizite Technik verwenden. Die konkrete Datenstruktur ist nicht normativ.

---

## 25. Sonderfall-Matrix und Capability-Komposition

| Mechanik | Capability-/Zielzuordnung | Besonderheit |
|---|---|---|
| normale Bullet | Flight + Sweep Collision + DirectHit | Starting-overlap-Epsilon |
| AWP | Flight + Sweep + PathEffect + DirectHit | Corridor/Fire-Trail separat |
| Gauss | Flight + Overlap/Piercing + DirectHit | target dedupe, Chain-Reaction |
| BFG | Flight + Overlap + Proximity | je Target dedupe, Pulse |
| Flame | Decay/Grow Flight + Overlap + Burn | per-target dedupe |
| Leaf Blower | Decay/Grow + Impulse + Deflection capability | Debuff + Projectile↔Projectile |
| Hydra | Flight + Bounce + Split | Child IDs, Rest-Range |
| Rocket | Flight + Impact Explosion | Direct vs AoE nicht doppeln |
| Mini Rocket | Flight + Homing + sparse MiniRocket state + explosions | attack/coast/return/pickup |
| Grenade | Grenade Flight + terminal payload | real fuse, bounce/friction |
| Spawn Grenade | Grenade + DomainEntitySpawn | Reflection ändert Allegiance |
| ASMD Sec | Flight + Detonable + Proximity/Piercing | externe Detonation |
| Energy Injector | Flight + Support Payload | kein Damage-Umweg |
| Reinforcement Matrix | Flight + WorldEffect Payload | kein Damage nötig |
| Time Bubble Projectile | Flight + WorldEffect Payload | Feld außerhalb Projectile |
| Fireball | Flight + Explosion + PathEffect | Ground Fire / Burn |
| Burning Projectile | beliebiger Flight + Burn Augment | stärkster Burn / eigene Provenance |
| Tesla Bolt | Flight + Piercing/Direct | nicht über Style ableiten |
| Translocator Puck | Flight + Translocator capability | Position/consume |
| Plasma Swarm | Flight + Origin Exclusion | kein Origin-Selbsthit |
| AK47 | Flight + Correlation metadata | Behavior bleibt Player-Owner |
| Shotgun | Flight + resolved DirectHit | proximity damage/slow |
| Rock/Base/Train | World Candidate + Domain Request | ein Writer |
| Tesla Reflection | Barrier + Projectile Mutation | Attribution/Allegiance |
| Leaf Deflection | Projectile↔Projectile Interaction | Restpayload bleibt |

Wichtig:

> Neue Kombinationen wie `Homing + Split + Burn + Explosion` sollen möglich sein, **wenn** die einzelnen Fähigkeiten semantisch kompatibel sind. Eine Kombination erzeugt nicht automatisch einen neuen Projectile-Typ oder neuen Processor.

Wenn zwei Capabilities eine widersprüchliche Ablaufsemantik haben, wird die Kombination explizit verboten oder durch eine kleine benannte Policy aufgelöst – nicht durch zufällige Processor-Reihenfolge.

---

## 26. Tests und Characterization

Seit dem abgeschlossenen Test-Refactoring gilt die zentrale Policy aus `docs/ai/testing.md`.

### 26.1 Schutzwert und Testebene

Das Projectile-Refactoring soll **keine neue Testexplosion** erzeugen.

Priorität:

1. bestehende passende Tests erweitern oder auf langlebige Zielsemantik umstellen,
2. neue Characterization nur für riskante, heute nicht ausreichend geschützte Semantik,
3. dauerhafte Architecture-Ratchets nur für echte Ownership-/Dependency-/Boundary-Regeln,
4. temporäre Cutover-Ratchets spätestens im Final-Cleanup als `KEEP/REWRITE/DELETE` bewerten,
5. keine Tests für triviale Delegation, private Store-Aufteilung, konkrete Methodennamen oder authored Balance-/Visual-Tuningwerte.

Bevor ein neuer Test entsteht, muss klar sein:

- welche konkrete Regression er verhindert,
- warum diese Aussage langlebig ist,
- warum keine kleinere/bestehende Testebene bereits ausreicht.

### 26.2 Aktuelle Runner

`package.json` ist maßgeblich:

- `npm test` – schneller Core-Gate,
- `npm run typecheck` – TypeScript ohne Emit,
- `npm run check` – Core-Tests + Build,
- `npm run test:architecture` – dauerhafte Source-/Dependency-Grenzen,
- `npm run test:integration` – modulübergreifende World-/Composition-Verträge,
- `npm run test:stress` – große Inputs/Performance-/Stress-Harnesses,
- `npm run test:balance-lab` – Balance-/Benchmark-Parität zur aktuellen Config,
- `npm run test:assets` – nur wenn Asset-/Pixel-/Maskenverträge betroffen sind.

Spezialsuites werden phasenbezogen ausgeführt und gehören nicht reflexartig zu jedem kleinen Zwischen-Gate. Für den finalen großen Refactoring-Abschluss dürfen und sollen die relevanten Spezialsuites vollständig laufen.

### 26.3 Aktuelle Testanker

Startpunkte auf `main @ c6f83bc...`:

- `tests/ProjectileSnapshotCodec.test.ts`,
- `tests/stress/ProjectilePerformance.test.ts`,
- `tests/WorldCombatGameplayBinding.test.ts`,
- `tests/ArenaRuntimeOwnership.test.ts`,
- `tests/Ak47CoopDefenseUpgrades.test.ts`,
- `tests/balance-lab/WeaponFiveTargetBenchmark.test.ts`,
- bestehende Weapon-/Utility-/Combat-Sonderfalltests,
- aktuelle Architecture-/Integration-Suites statt gelöschter historischer Phase-/Cutover-Ratchets.

`tests/HostUpdatePhaseContracts.test.ts` und andere im Test-Refactoring entfernte historische Source-Ratchets sind **keine** Planungsanker mehr. Falls Host-Frame-Reihenfolge für den Projectile-Cutover neu geschützt werden muss, bevorzugt einen langlebigen Behavior-/Integration-Vertrag oder eine kleine dauerhafte Architecture-Regel statt den alten Source-Shape wiederzubeleben.

### 26.4 Pflicht-Characterization vor jeweiligem Cutover

Nur soweit bestehende Tests den Schutz nicht bereits ausreichend liefern:

- Bullet Sweep + Obstacle,
- Starting overlap,
- Penetration mehrerer Targets,
- BFG/Gauss Dedupe,
- Rock/Base/Train Mehrfachcollider und kanonische Target Identity,
- Hydra Split inkl. Spawn-during-stage/Reentrancy,
- Fire Imbue Same Frame,
- Tesla Reflection,
- reflected Spawn Grenade inkl. aktueller terminaler Provenance,
- Leaf Deflection,
- ASMD/Detonation,
- Energy Injector,
- Grenade real fuse,
- Time Bubble Flight,
- Mini-Rocket multi-explosion/return/pickup,
- Late Join / verlorene Static-Daten,
- Client Removal durch Abwesenheit,
- Favor the Shooter unverändert außerhalb Projectile,
- Explosion-Fan-out trennt Combat-Anteil von Environment/World-Ownern,
- Barrier-/Defense-Adapter ohne direkte System-Abhängigkeit,
- autoritative Projectile-Zeit ohne versteckte Wall Clock.

Neue Tests bevorzugt auf:

```text
Capability data / Candidate
→ typed Result
→ Domain Outcome
→ Projectile state transition
```

Nicht auf private Store-/Processor-Implementierung oder mutable authored Tuningwerte.

---

## 27. Performance- und Data-Oriented-Verträge

### 27.1 Beibehalten / bevorzugen

- stabile mutable Runtime Records,
- O(1)-ID-Lookup,
- private Capability-Indizes bei realem Nutzen,
- Scratch Collections,
- Homing Candidate Pooling,
- TypedArray-/Buffer-Nutzung lokal, wo bereits sinnvoll,
- gemeinsamer Obstacle Index,
- Network Snapshot nur am Network Tick,
- kompakte Wire-Repräsentation,
- möglichst ein Presentation-Durchlauf.

### 27.2 Vermeiden

- vollständigen Spawn Request pro Frame neu bauen,
- kompletten Runtime-State für Reads kopieren,
- Event-Objekt pro Collision nur aus Architekturgründen,
- neue Arrays pro Projectile/Target ohne Bedarf,
- mehrfach unabhängige Vollscans, wenn ein kleiner Capability-Index klarer ist,
- zweites World-Spatial-System,
- Serialisierung interner Capability-/Interaction-State,
- SoA-/TypedArray-Komplettumbau ohne gemessenen Bedarf.

### 27.3 AoS vs. SoA

Bevorzugter Ausgangspunkt bleibt ein gut strukturierter Record pro Projectile.

Structure-of-Arrays ist nur für einzelne nachgewiesene Hot-Path-Daten zulässig, wenn:

- Profiling einen echten Engpass zeigt,
- Phaser-Object-Zugriffe den Gewinn nicht ohnehin dominieren,
- Verständlichkeit und Mutation-Kohärenz nicht deutlich leiden.

Kein vorbeugender SoA-Umbau.

---

## 28. Architektur-Ratchets

Zusätzlich zu `01` bevorzugt prüfen:

1. kein produktiver Import von `ProjectileManager`,
2. `CombatSystem` importiert keinen internen Projectile-Runtime-State,
3. keine produktive API gibt `TrackedProjectile` zurück,
4. `WorldProjectileRuntime` importiert keinen `NetworkBridge`,
5. Projectile Simulation/Store importiert keine Renderer,
6. Client Replica importiert keinen Combat-/Domain-Mutation-Owner,
7. Renderer importieren keinen autoritativen Runtime-Record,
8. Execution hängt nur an `ProjectileSpawnPort`,
9. `DetonationSystem` traversiert keine aktive Runtime-Collection,
10. `TranslocatorSystem` liest kein Phaser-Projectile-Objekt,
11. Enemy-Dodge erhält nur Threat Samples,
12. Gameplay-Core verzweigt nicht auf Presentation-`projectileStyle`,
13. `CombatSystem.update()` besitzt nach Cutover keine Projectile-Target-Collision mehr,
14. nur eine autoritative Projectile-Registry pro World,
15. keine globale ECS-/Component-/System-Registry wird eingeführt,
16. Capability-Indizes bleiben private Derived State und werden nicht öffentliche Query-Infrastruktur.
17. `ProjectileCombatPort` übernimmt keinen Environment-/Support-/World-Effect-Fan-out; Explosionen laufen über die separate Domain-Effect-/Explosion-Grenze.
18. Projectile Simulation/Processor importieren keine konkreten Barrier-/Defense-Owner wie `TeslaDomeSystem`, Player-Gameplay oder `CombatSystem`.
19. aktive Deflection/Detonation mutiert Projectiles nur über `ProjectileExternalInteractionPort` oder eine äquivalente schmale Owner-Grenze.
20. neue optionale Top-Level-Capability-Felder sind wiederverwendbare Semantik, keine weapon-spezifischen Ablagefächer.
21. autoritative Projectile-Logik führt keine versteckten `Date.now()`-/`performance.now()`-Zeitquellen ein.
22. Gameplay-Core/Resolver/Processor lesen keine einzelnen Felder aus Presentation Projection Metadata.
23. pro Contract-Familie existiert nach Materialisierung genau eine produktive Type/API-Familie; parallele Fassaden gleicher Bedeutung sind Ratchet-Verstoß.

Ratchets zielen auf stabile Grenzen, nicht auf Datei-/Zeilenzahlen.

---

## 29. Bewusste Nicht-Ziele

Noch nicht festlegen:

- Phasenanzahl / Commit-Reihenfolge,
- exakte Migration jedes Testfiles,
- neue Adrenalin-Orb-Regeln,
- neues Hit-Feedback-Design,
- endgültige Combat-Runtime-Klassenstruktur,
- generisches Explosion-System,
- zukünftige Projectile-Prediction,
- neue Weapon-/Enemy-Features,
- globales ECS,
- vollständige Umgestaltung aller Loadout-Configs.

---

## 30. Anforderungen an Dokument 03

`03_Projectile_Runtime_Implementation_Plan.md` soll:

- pro Phase die relevanten §§ aus diesem Dokument referenzieren,
- temporäre Legacy-Adapter und ihre **späteste Schließphase** explizit benennen,
- pro Phase einen klaren lokalen Abschluss und angemessene fokussierte Verifikation definieren,
- **keinen global grünen Test-Gate nach jeder Phase erzwingen**: einzelne Behavior-/Integrationstests dürfen während eines benannten Cutover-Fensters vorübergehend rot sein, wenn der Bruch direkt aus einer im Plan benannten Transition entsteht und spätestens in der zugeordneten Schließphase beseitigt wird; **`npm run typecheck` muss nach jeder erfolgreich abgeschlossenen Phase grün sein** – ein nicht typkompilierender Stand ist kein abgeschlossener Phasenstand,
- keine Compatibility-Fassade, keinen dualen State und keinen zweiten Writer nur deshalb einführen, um einen vorübergehend spielbaren Zwischenstand zu erhalten,
- ein Cross-Phase-Contract-Manifest führen: stabile Contract-Familie, einführende Phase, realisierter Type/API-Name und erlaubte temporäre Adapter; spätere Phasen dürfen keine Parallel-Fassade gleicher Bedeutung einführen,
- große risikoarme mechanische Extraktionen von semantisch riskanten Cutovers trennen,
- vermeiden, dass Coding-KIs das komplette `02` in jeder Phase laden müssen,
- den Endzustand vollständig erreichen,
- die aktuelle Testarchitektur (`docs/ai/testing.md`, `package.json`) respektieren: Core/Architecture/Integration/Stress/Balance-Lab/Assets nach Schutzwert trennen und entfernte historische Test-Ratchets nicht wiederherstellen,
- `04_Projectile_Runtime_Migration_Status.md` bewusst als **kleinen aktuellen Zustandszettel** behandeln: keine Commit-SHAs, keine abgeschlossene Historie, keine vollständigen Datei-/Testinventare; Git und `03` tragen diese Informationen bereits.

Seine Phasen müssen zusammen mindestens abdecken:

- öffentliche Spawn-Grenze,
- world-owned Runtime-Lifetime,
- privater Runtime-State ohne `TrackedProjectile`-Leaks,
- capability-basierte State-Komposition,
- ggf. private Capability-Indizes und spezialisierte Processor,
- Target-Collision aus `CombatSystem`,
- Barrier-/Defense-Abhängigkeiten über schmale semantische Ports statt direkte System-Imports,
- Explosion-Fan-out über separate Domain-Effect-/Explosion-Orchestrierung bei auf Combat-Anteil begrenztem `ProjectileCombatPort`,
- Travel-/Environment-Interaction ohne externe State-Mutation,
- Detonation/Translocator ohne Manager-Durchgriff,
- Explosion-/Mini-Rocket-Continuation,
- Replication aus Simulation heraus,
- Client Replica,
- Presentation aus Simulation heraus,
- Geometry-/Train-/World-Bindings,
- Entfernung des produktiven `ProjectileManager`,
- finale Ratchets und Gesamtverifikation.

> **`03` darf keinen Endzustand planen, in dem der alte `ProjectileManager` nur dünner geworden ist, ein generisches ECS-Framework als Ersatz entstanden ist, Combat weiter aktive Projectile-Records iteriert, der `ProjectileCombatPort` zum Universal-Explosion-/World-Effect-Port wird, konkrete Defense-Systeme in die Simulation einsickern oder Presentation/Network-State im autoritativen Gameplay-Owner verbleibt.**
