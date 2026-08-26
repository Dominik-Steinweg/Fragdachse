# Fragdachse – Runtime-Architektur-Refactoring vor Persistent-Base-Phase 3

**Status:** Architekturkonzept / Work in Progress  
**Ziel:** Belastbare Runtime-Grundlage für Persistent-Base-Phase 3 und zukünftige Runtime-Modi  
**Ausgangspunkt:** stabiler Stand nach Persistent-Base-Phase 2  
**Referenz:** bestehender Phase-3-Stand dient als funktionale, fachliche und teilweise technische Referenz, nicht als unveränderte Architekturgrundlage

---

# 1. Entscheidung

Vor der erneuten Umsetzung von Persistent-Base-Phase 3 wird eine eigenständige Architektur-Refactoring-Stufe durchgeführt.

Das Refactoring ist nicht ausschließlich durch den Base Editor motiviert.

Der bestehende Phase-3-Versuch hat mehrere allgemeine Architekturgrenzen sichtbar gemacht, die auch zukünftige Runtime-Modi betreffen:

- Room-State und World-State sind nicht ausreichend getrennt.
- World und laufende Mission bzw. Runde werden noch zu häufig gemeinsam modelliert.
- Player-Teilnahme an einer World ist nicht eigenständig genug modelliert.
- World-Definition und Mission-/Activity-Definition sind auch im Authoring miteinander vermischt.
- World-Metriken und weitere abgeleitete Zustände hängen teilweise an mutablem globalem Zustand.
- Netzwerkseitig existieren mehrere konkurrierende World-Beschreibungen.
- Host-Simulation ist noch zu stark an den lokal aufgebauten Arena-/Presentation-Stack gekoppelt.
- `ArenaContext`, `ArenaLifecycleCoordinator` und `HostUpdateCoordinator` bündeln weiterhin sehr viele Runtime-Verantwortlichkeiten.

Das Refactoring soll diese Grenzen gezielt korrigieren, ohne Fragdachse grundlegend neu zu schreiben.

---

# 2. Aktueller Zustand der Codebase

Der bestehende Phase-3-Stand enthält bereits mehrere sinnvolle Architekturansätze. Diese sollen nicht verworfen, sondern in ein konsistenteres Zielmodell überführt werden.

## 2.1 Bereits vorhandener gemeinsamer World-Core

Mit `ArenaWorldDescriptor` existiert bereits ein interner gemeinsamer Weltvertrag.

Aktuell wird er aus zwei verschiedenen Netzwerkmodellen erzeugt:

```text
ArenaDescriptor
→ toMissionWorldDescriptor()
→ ArenaWorldDescriptor
```

und:

```text
PersistentBaseEditorWorld
→ toPersistentBaseEditorWorldDescriptor()
→ ArenaWorldDescriptor
```

Damit wurde bereits erkannt, dass Mission und Editor dieselbe grundlegende World-Erzeugung verwenden können. Gleichzeitig existieren dadurch weiterhin mehrere Beschreibungen derselben konzeptionellen Ebene.

### Konsequenz für das Refactoring

Der gemeinsame World-Vertrag wird beibehalten.

Die vorgelagerte Doppelstruktur wird jedoch entfernt:

> Es gibt künftig genau einen kanonischen replizierten `WorldDescriptor`.

Mission und Editor erhalten keine getrennten World-Kanäle mehr.

---

## 2.2 Bestehendes `ArenaRuntimeProfile`

Der Phase-3-Stand besitzt bereits:

```typescript
ArenaRuntimeProfile {
  enemies
  objectives
  roundConclusion
  worldEvents
  combatSimulation
  roundLifecycle
  missionPersistentBaseSession
}
```

Mission und Editor verwenden unterschiedliche Profile.

Dies war ein sinnvoller Zwischenschritt, weil missionsbezogene Systeme nicht mehr über verstreute Editor-Abfragen aktiviert werden müssen.

Langfristig ist dieses Modell jedoch nicht das Ziel.

Ein immer größer werdendes Boolean-Profil würde lediglich eine neue Variante desselben Problems erzeugen:

```typescript
if (profile.enemies) ...
if (profile.objectives) ...
if (profile.roundLifecycle) ...
```

Das Ziel lautet stattdessen:

```text
World Runtime
+
optionale Activity Runtime
```

Missionssysteme existieren nicht deshalb nicht, weil mehrere Flags `false` sind.

Sie existieren nicht, weil keine entsprechende Activity Runtime aktiv ist.

---

## 2.3 Player-Lifecycle wurde bereits teilweise vereinheitlicht

Der aktuelle Architekturstand verwendet für Mission und Editor bereits denselben:

```text
activatePlayerRuntime()
deactivatePlayerRuntime()
```

Pfad.

Diese Richtung wird ausdrücklich beibehalten.

Allerdings wird der Vertrag verschärft:

> Ein gemeinsamer Lifecycle bedeutet nicht, dass jede World automatisch den vollständigen Mission-Player-Stack initialisiert.

Der Lifecycle wird deshalb künftig durch einen expliziten Runtime-Kontext und benötigte Player-Features gesteuert.

---

## 2.4 Editor-Authoring ist weiterhin missionsförmig

Der aktuelle Base Editor wird als interne Coop-Defense-Map authoriert.

Die Datei enthält unter anderem:

```json
"surviveDurationSec": 3600,
"balanceReferenceDurationSec": 3600,
"objective": "survive",
"respawnsPerPlayer": 0,
"encounters": [],
"persistentSpawns": [],
"mapEvents": []
```

obwohl der Editor ausdrücklich keine Mission besitzt.

Dies ist ein klares Architekturleck.

Der Editor ist derzeit auf Authoring-Ebene weiterhin:

> eine Mission, deren Missionsinhalte künstlich leer gemacht wurden.

Das Refactoring muss deshalb World und Activity nicht nur zur Laufzeit, sondern auch in Konfiguration und Authoring trennen.

---

## 2.5 Netzwerk besitzt mehrere World-Verträge

`NetworkBridge` besitzt aktuell unter anderem:

```text
KEY_GAME_PHASE
KEY_ARENA_DESCRIPTOR
KEY_PERSISTENT_BASE_EDITOR_ACTIVE
KEY_PERSISTENT_BASE_EDITOR_WORLD
KEY_PERSISTENT_BASE_EDITOR_LOADOUT
KEY_ROUND_STATE
KEY_ROUND_PARTICIPATION
```

und importiert sowohl `ArenaDescriptor` als auch `PersistentBaseEditorWorld`.

Damit ist die World-Identität abhängig davon, welchen Runtime-Pfad ein Verbraucher betrachtet.

Das Refactoring führt deshalb ein verbindliches Prinzip ein:

> **Genau ein WorldDescriptor, genau ein World-Kanal.**

Activity- und Round-State werden davon separat repliziert.

---

## 2.6 World-Metriken sind aktuell mutable globale Zustände

`src/config.ts` hält unter anderem mutable Werte wie:

```typescript
ACTIVE_ARENA_METRICS_PROFILE
ARENA_WIDTH
ARENA_HEIGHT
ARENA_OFFSET_X
ARENA_OFFSET_Y
ARENA_VIEWPORT_WIDTH
ARENA_VIEWPORT_HEIGHT
ARENA_MAX_X
ARENA_MAX_Y
```

Diese werden abhängig von der aktiven Arena umgestellt.

Der heutige Editor musste deshalb ausdrücklich die Arena-Metrik aktivieren, obwohl `GamePhase === LOBBY`, weil Generator, Spawn und Rasterprüfungen auf diese globalen Werte zugreifen.

Das ist mit dem zukünftigen härtesten Architekturfall nicht kompatibel:

```yaml
Host Local Presentation:
  Lobby Metrics

Shared World Simulation:
  Persistent Base World Metrics
```

Beide Kontexte müssen gleichzeitig existieren können.

---

## 2.7 Basen besitzen ebenfalls mutable globale World-Bindung

`BaseRegistry` besitzt aktuell:

```typescript
let activeCoopDefenseBases: readonly BaseSpec[] | null = null;
```

mit:

```typescript
setActiveCoopDefenseBases(...)
getCoopDefenseBases(...)
```

Falls keine aktive Menge vorhanden ist, kann `getCoopDefenseBases()` die aktuell gewählte Coop-Map erneut aus `NetworkBridge` lesen.

Dieser Mechanismus wurde eingeführt, weil ein erneutes Auflösen aus der Lobby-Map bereits zu falschen Basen in der Editor-World geführt hatte.

Das löst das unmittelbare Problem, ist aber weiterhin globaler mutable World-State.

Künftig gilt:

> World-Systeme lesen weder aktive Lobby-Konfiguration noch globale „aktuelle Basen“.

Die aktuelle Basenmenge gehört zur konkreten `WorldRuntimeContext`-Instanz.

---

## 2.8 Host und lokale World-Presentation sind noch gekoppelt

Die aktuelle Architektur beschreibt:

> Der Host hält die Editor-Runtime, solange Teilnehmer vorhanden sind.

und:

> Solange lokal eine World steht, müssen Lobby-Vorschau und Lobby-Ambient weichen, weil World und Lobby dieselben Darstellungsebenen verwenden.

Das ist für den endgültigen Zielzustand nicht ausreichend.

Der neue Vertrag lautet ausdrücklich:

> **Host ohne World Participation bedeutet Simulation ohne lokale World-Presentation.**

Nicht:

> Die World wird lokal vollständig aufgebaut und lediglich hinter der Lobby-Oberfläche verborgen.

---

# 3. Zentrale Architekturerkenntnis

Der erste Phase-3-Versuch hat folgende historische Annahme sichtbar gemacht:

```text
Room ist in Arena
≈
World existiert
≈
Round läuft
≈
Mission läuft
≈
Player besitzt WorldRuntime
≈
Player darf handeln
≈
lokale World wird dargestellt
```

Diese Zusammenhänge gelten künftig nicht mehr automatisch.

Das Refactoring trennt stattdessen folgende Konzepte:

```text
Room / Membership
World
Activity
Player World Participation
Activity / Round Role
Local Presentation
Input / Capabilities
```

---

# 4. Ziele

Die Refactoring-Stufe besitzt drei gleichwertige Ziele.

## 4.1 Persistent-Base-Phase 3 ermöglichen

Der Base Editor soll anschließend ohne folgende Sonderarchitekturen umgesetzt werden können:

```text
Dummy-Mission
Pseudo-Survive-Objective
eigener WorldDescriptor
eigener World-Kanal
eigener Player-Lifecycle
eigener Host-Tick
Editor-spezifische Arena-Lifecycle-Interpretation
GamePhase-Sonderlogik
leere Missionskonfiguration
lokal unsichtbar gemachte Host-Arena
```

---

## 4.2 Allgemeine Runtime-Architektur verbessern

Neue Modi sollen sich zukünftig zusammensetzen lassen aus:

```text
World
+
optionalen World Components
+
optionaler Activity
+
Player Participation
```

anstatt immer neue Sonderpfade in:

```text
ArenaScene
ArenaLifecycleCoordinator
HostUpdateCoordinator
NetworkBridge
```

einzubauen.

---

## 4.3 Coding-KI-Freundlichkeit verbessern

Eine Coding-KI soll für eine Änderung möglichst eindeutig beantworten können:

```text
Welche World existiert?
Welche Activity existiert?
Welche Runtime gehört wem?
Welche Systeme sind aktiv?
Welche Player nehmen teil?
Was darf dieser Player?
Welche Konfiguration ist kanonisch?
Welche Daten gehören zu genau dieser World?
```

Diese Informationen sollen nicht aus mehreren Nullable-Feldern, Bridge-Flags und impliziten `GamePhase`-Abfragen rekonstruiert werden müssen.

---

# 5. Nicht-Ziele

Dieses Refactoring ist kein Rewrite.

Nicht Teil der Pflichtstufe sind:

- Phaser ersetzen,
- PeerJS ersetzen,
- WebRTC ersetzen,
- kompletten `NetworkBridge` neu schreiben,
- ECS einführen,
- `CombatSystem` vollständig zerlegen,
- `ProjectileManager` vollständig zerlegen,
- UI komplett umbauen,
- Persistenz neu entwickeln,
- sämtliche Scene-Lifetime-Systeme neu instanziieren,
- maximale Dateigrößen erzwingen.

Große Klassen dürfen bestehen bleiben, wenn ihre Verantwortung eindeutig ist.

---

# 6. Kanonisches Zielmodell

Das Zielmodell lautet:

```text
Application
│
└── Room
    │
    ├── Membership
    ├── Lobby Configuration
    │
    └── Shared World 0..1
        │
        ├── WorldDescriptor
        ├── WorldRuntimeContext
        ├── World Lifecycle
        ├── PlayerRuntimeRegistry
        ├── World Simulation
        │
        ├── optionale World Components
        │   ├── ConstructionRuntime
        │   └── PersistentBaseRuntime
        │
        └── Activity Runtime 0..1
            ├── Coop Mission
            ├── Deathmatch
            ├── Team Deathmatch
            └── Capture the Beer
```

Pro Spieler existiert separat:

```text
World Participation
├── none
├── joining
├── interactive
├── observer
└── leaving
```

und gegebenenfalls innerhalb der Activity:

```text
Activity / Round Role
├── participant
├── spectator
└── weitere activity-spezifische Rollen
```

---

# 7. Room und Lobby

Room beschreibt:

- Netzwerkmitgliedschaft,
- Host,
- verbundene Spieler,
- Lobby-Auswahl,
- Ready-State,
- Teams,
- Lobby-Loadout,
- Room Quality,
- allgemeine Room-Persistenz.

Room beschreibt ausdrücklich nicht:

> ob eine Shared World existiert.

Damit ist folgender Zustand normal:

```yaml
Room:
  Lobby Configuration: Active

World:
  Active

Activity:
  None
```

---

## 7.1 Umgang mit `GamePhase`

Das bestehende:

```typescript
GamePhase = 'LOBBY' | 'ARENA'
```

muss nicht sofort entfernt werden.

Es darf während der Migration als Kompatibilitäts- bzw. Presentation-/Match-State bestehen bleiben.

Es ist jedoch künftig **keine kanonische Quelle** für:

```text
World existiert
World darf simuliert werden
Player nimmt an World teil
Player darf bauen
Player darf sich bewegen
World Metrics
World Bases
World Visibility
```

Neue World-Systeme dürfen keine fachliche Entscheidung mehr aus `GamePhase` ableiten.

---

# 8. World Lifecycle

Eine Shared World besitzt einen eigenen Lifecycle:

```text
None
Creating
Active
Destroying
```

Eine World besitzt genau eine stabile Instanzidentität.

Konzeptionell:

```typescript
interface WorldDescriptor {
  readonly worldRevision: number;
  readonly definitionId: string;
  readonly seed: number;
  readonly generatorVersion: number;
  readonly layoutFingerprint: string;

  // ausschließlich echte World-Parameter
  readonly parameters?: WorldParameters;
}
```

Die endgültige Feldstruktur ist WIP.

Verbindlich ist jedoch:

> `WorldDescriptor` enthält ausschließlich World-Identität und World-Konfiguration.

Nicht hinein gehören beispielsweise:

```text
Mission Objective
Round Role
Victory Conditions
Respawn Budget
GameMode als Ersatz für Activity
```

---

## 8.1 Genau ein kanonischer WorldDescriptor

Der heutige Zustand:

```text
ArenaDescriptor
PersistentBaseEditorWorld
ArenaWorldDescriptor
```

wird konsolidiert.

Ziel:

```text
WorldDescriptor
```

Dieser Descriptor wird sowohl von:

```text
Mission
Persistent Base Editor
PvP
```

verwendet.

`PersistentBaseEditorWorld` entfällt als separater Netzwerkvertrag.

`ArenaDescriptor` wird entweder:

- zu einem Activity-/Round-Vertrag reduziert,

oder:

- vollständig durch `WorldDescriptor` + `ActivityDescriptor` ersetzt.

---

## 8.2 World Revision

`worldRevision` identifiziert genau eine World-Instanz.

Eine neue World erhält immer eine neue Revision.

Damit können insbesondere verworfen werden:

- alte Snapshots,
- alte Placement Requests,
- alte World RPCs,
- alte Load-Ready-Nachrichten,
- alte Mutationen,
- alte Player-Join-Transitions.

`roundRevision` bzw. `activityRevision` bleibt davon semantisch getrennt.

Eine Mission kann besitzen:

```text
worldRevision = 12
roundRevision = 31
```

Eine friedliche Base World besitzt:

```text
worldRevision = 13
Activity = None
```

Die Zähler dürfen technisch aus derselben monotonen Quelle erzeugt werden.

Sie sind jedoch unterschiedliche Identitäten.

---

# 9. Activity Lifecycle

Eine World besitzt optional eine Activity.

Konzeptionell:

```text
None
Creating
Active
Ending
```

Eine Activity setzt zwingend eine aktive World voraus.

Eine World setzt keine Activity voraus.

---

## 9.1 Beispiele

Persistent Base Editor:

```text
World Runtime
+
Persistent Base Runtime
+
Construction Runtime
+
Activity = None
```

Coop-Mission:

```text
World Runtime
+
Persistent Base Runtime optional
+
Coop Mission Activity
```

Deathmatch:

```text
World Runtime
+
Deathmatch Activity
```

---

## 9.2 ActivityDescriptor

Activity-State wird getrennt von World-State repliziert.

Beispielsweise:

```typescript
interface ActivityDescriptor {
  readonly activityRevision: number;
  readonly worldRevision: number;
  readonly kind:
    | 'coop-mission'
    | 'deathmatch'
    | 'team-deathmatch'
    | 'capture-the-beer';

  readonly definitionId: string;
}
```

Round-spezifische Informationen bleiben anschließend in:

```text
RoundState
RoundParticipation
MissionProgress
Activity-specific snapshots
```

Die genaue Aufteilung bleibt Implementierungsdetail.

Verbindlich ist:

> World-Identität wird nicht nochmals durch einen activity-spezifischen WorldDescriptor dupliziert.

---

# 10. World- und Activity-Authoring trennen

Diese Trennung ist Teil der Pflichtstufe.

Der heutige `CoopDefenseMapConfig` enthält sowohl:

- Arena-Geometrie,
- Terrain,
- Basen,
- Persistent-Base-Anker,

als auch:

- Objectives,
- Respawns,
- Encounter,
- Mission Events,
- Mission Progression,
- Boss-/Survival-Logik.

Der Base Editor muss deshalb aktuell eine künstliche `survive`-Mission authoren.

Das wird aufgelöst.

---

## 10.1 WorldDefinition

Eine `WorldDefinition` beschreibt ausschließlich die Welt.

Beispielsweise:

```typescript
interface WorldDefinition {
  readonly id: string;

  readonly metrics: WorldMetricsDefinition;

  readonly terrain: WorldTerrainDefinition;

  readonly staticGeometry: ...;

  readonly bases?: ...;

  readonly tracks?: ...;

  readonly persistentBaseSite?: ...;

  readonly initialTimeOfDay?: ...;
}
```

Typische World-Inhalte:

```text
Breite / Höhe
Raster
Terrain
Felsen
Bäume
statische Geometrie
Gleisgeometrie
Basisgeometrie
Persistent-Base-Site
statische Spawn-/Anchor-Punkte
grundlegende World-Presentation-Parameter
```

---

## 10.2 ActivityDefinition

Eine Activity Definition beschreibt ausschließlich Gameplay innerhalb einer World.

Für Coop Defense beispielsweise:

```typescript
interface CoopMissionDefinition {
  readonly id: string;
  readonly worldDefinitionId: string;

  readonly objective: ...;
  readonly encounters: ...;
  readonly persistentSpawns: ...;
  readonly mapEvents: ...;
  readonly secondaryObjectives: ...;
  readonly respawnsPerPlayer: ...;
  readonly rewards: ...;
  readonly missionProgress: ...;
}
```

Dazu gehören:

```text
Mission Objective
Victory / Defeat
Respawn Budget
Enemies
Encounters
Boss
Map Events
Mission Timer
Mission Progress
Secondary Objectives
Mission Rewards
activity-getriggerte World-Veränderungen
```

---

## 10.3 Physische Authoring-Struktur

Langfristig sollte die Trennung auch in den Dateien sichtbar sein.

Beispielsweise:

```text
src/config/worlds/
    coop-01.world.json
    coop-02.world.json
    persistent-base-editor.world.json

src/config/activities/
    coop/
        coop-01.activity.json
        coop-02.activity.json
```

Der Base Editor besitzt dann nur:

```text
persistent-base-editor.world.json
```

und ausdrücklich keine:

```text
persistent-base-editor.activity.json
```

Eine Übergangsphase mit Adaptern aus bestehenden Map-Dateien ist zulässig.

Stop-Punkt 1 verlangt jedoch:

> Der Base Editor benötigt keine künstlichen Missionsfelder mehr.

---

# 11. WorldRuntimeContext

Jede aktive World erhält einen kanonischen Runtime Context.

Beispielsweise:

```typescript
interface WorldRuntimeContext {
  readonly descriptor: WorldDescriptor;
  readonly definition: WorldDefinition;

  readonly metrics: WorldMetrics;
  readonly layout: ArenaLayout;
  readonly grid: WorldGrid;

  readonly bases: readonly BaseSpec[];
  readonly persistentBaseSite: PersistentBaseSite | null;

  readonly playerRuntimeRegistry: PlayerRuntimeRegistry;

  readonly components: WorldComponents;
}
```

Die exakte Struktur ist WIP.

Der zentrale Zweck ist verbindlich:

> Alle Daten, die zu genau einer World gehören, werden über genau diese World gebunden.

---

## 11.1 `WorldRuntimeContext` darf kein neuer God-Context werden

Nicht jedes System wird in diesen Context kopiert.

Er enthält primär:

- World-Identität,
- unveränderliche World-Grundlage,
- World-scoped Derived State,
- klar gruppierte World Components.

Activity-spezifische Systeme gehören nicht als flache Nullable-Felder hinein.

Statt:

```typescript
ctx.enemyManager
ctx.coopDefenseBossSystem
ctx.coopDefenseMapDirector
ctx.coopDefenseMissionProgressSystem
ctx.coopDefenseSecondaryObjectiveSystem
...
```

soll konzeptionell eher gelten:

```typescript
world.activity === null
```

oder:

```typescript
world.activity.kind === 'coop-mission'
```

und die dazugehörigen Systeme liegen innerhalb dieser Runtime.

---

# 12. World-Metriken aus mutablem globalem Zustand lösen

Dies ist Teil der Pflichtstufe.

Simulation und World-Auflösung dürfen künftig nicht mehr von globalen:

```text
ARENA_WIDTH
ARENA_HEIGHT
ARENA_OFFSET_X
ARENA_OFFSET_Y
GRID_COLS
GRID_ROWS
ACTIVE_ARENA_METRICS_PROFILE
```

als aktueller World-Identität abhängen.

Stattdessen:

```text
WorldDefinition
↓
resolveWorldMetrics()
↓
WorldRuntimeContext.metrics
```

---

## 12.1 Verbindliche Regel

Folgende Systeme müssen ihre World-Metrik über den aktiven World-Kontext erhalten:

- World Generation,
- Spawn-Berechnung,
- Grid-Auflösung,
- Physics Bounds,
- Collision,
- Placement,
- Persistent-Base-Zone,
- Base-Auflösung,
- World Bounds,
- simulation-relevante räumliche Resolver.

Globale Kompatibilitätsvariablen dürfen während der Migration vorübergehend bestehen.

Sie dürfen jedoch nach Stop-Punkt 1 keine kanonische Quelle für die autoritative World-Simulation mehr sein.

---

## 12.2 Warum dies zwingend ist

Der härteste Zielzustand besitzt gleichzeitig:

```yaml
Host Local Presentation:
  Lobby Metrics

Shared World Simulation:
  Persistent Base World Metrics
```

Eine einzelne mutable globale „aktive Arena-Metrik“ kann diesen Zustand prinzipiell nicht sauber repräsentieren.

---

# 13. Basen und weitere Derived States an die World binden

Die heutige globale:

```typescript
activeCoopDefenseBases
```

Bindung wird durch einen World-scoped Zustand ersetzt.

Statt:

```typescript
getCoopDefenseBases()
```

mit impliziter aktueller World soll World-Code beispielsweise lesen:

```typescript
world.bases
```

oder:

```typescript
resolveBases(world.definition, world.metrics, ...)
```

---

## 13.1 Kein Fallback auf Lobby-Konfiguration

Besonders verbindlich:

> Ein aktives World-System darf niemals die aktuell in der Lobby ausgewählte Map erneut aus `NetworkBridge` lesen.

Eine World wird erstellt aus einem immutable Snapshot:

```text
Lobby Selection
↓
World Creation
↓
WorldDescriptor
↓
WorldDefinition
↓
WorldRuntimeContext
```

Nach diesem Zeitpunkt dürfen Änderungen an:

```text
Lobby Map
Lobby Mode
Lobby Loadout
Lobby Ready
```

die bestehende World nicht verändern.

---

## 13.2 Weitere World-scoped Derived States

Dasselbe Prinzip gilt schrittweise für beispielsweise:

```text
World Bounds
Grid
Persistent Base Site
aktive Basenmenge
statische Obstacle Sources
Track Geometry
resolved Layout
resolved World Metrics
```

Nicht jeder globale Helper muss sofort verschwinden.

Aber:

> Es darf immer genau eine kanonische World-Quelle geben.

---

# 14. Netzwerkmodell

Transport und PeerJS bleiben unangetastet.

Refactored wird die Domänenschicht oberhalb des Transports.

---

## 14.1 Ein kanonischer World-Kanal

Künftig existiert konzeptionell:

```text
KEY_WORLD_DESCRIPTOR
```

mit:

```typescript
WorldDescriptor | null
```

Dieser Kanal ersetzt die World-Funktion von:

```text
KEY_ARENA_DESCRIPTOR
KEY_PERSISTENT_BASE_EDITOR_WORLD
```

Es gibt nicht mehr:

```text
Mission World Channel
Editor World Channel
```

sondern:

```text
World Channel
```

---

## 14.2 Activity wird separat repliziert

Daneben existiert beispielsweise:

```text
KEY_ACTIVITY_DESCRIPTOR
```

oder eine entsprechend klar definierte bestehende Round-/Activity-Struktur.

Damit gilt:

```text
WorldDescriptor
≠
ActivityDescriptor
```

---

## 14.3 World Loading

Das bestehende `ArenaLoadReadyState` ist heute über `roundRevision` an eine Runde gebunden.

Künftig benötigt die grundlegende World-Ladebarriere eine World-Identität:

```typescript
interface WorldLoadReadyState {
  readonly worldRevision: number;
  readonly progress: number;
  readonly stage: WorldLoadStage;
  readonly ready: boolean;
}
```

Eine Activity kann anschließend zusätzliche Startbedingungen besitzen.

---

## 14.4 World-scoped Nachrichten

Alle worldbezogenen Nachrichten müssen einer World zugeordnet sein.

Dies wird möglichst zentral gelöst.

Nicht jeder neue Entwickler bzw. jede Coding-KI soll manuell daran denken müssen:

```typescript
if (request.worldRevision !== currentWorldRevision) ...
```

Bevorzugt wird ein gemeinsamer Mechanismus wie:

```typescript
sendWorldRpc(...)
registerWorldRpc(...)
publishWorldState(...)
```

oder ein äquivalenter Wrapper:

```typescript
interface WorldScoped<T> {
  readonly worldRevision: number;
  readonly payload: T;
}
```

Die Netzwerkgrenze verwirft falsche World-Instanzen zentral.

---

## 14.5 Verbindliche Invariante

Eine Nachricht der World:

```text
Revision 12
```

darf niemals auf:

```text
Revision 13
```

angewendet werden.

Dies gilt unter anderem für:

- Placement,
- Construction Mutation,
- Occupancy,
- World Snapshot,
- Initial Baseline,
- Load Ready,
- Player Runtime Join,
- worldbezogene RPCs.

---

# 15. Player World Participation

World Participation ist ein eigener host-autoritärer Lifecycle.

```typescript
type WorldParticipation =
  | 'none'
  | 'joining'
  | 'interactive'
  | 'observer'
  | 'leaving';
```

`Lobby` ist ausdrücklich **kein** Participation-State.

---

## 15.1 Bedeutung

Participation beantwortet:

```text
Besitzt der Spieler einen Runtime-Eintrag in dieser World?
Darf er World Input senden?
Konsumiert er World Replication?
Welche PlayerRuntime-Module benötigt er?
Ist lokale World-Presentation erforderlich?
```

---

## 15.2 Activity-/Round-Rolle bleibt separat

Beispiel Mission-Spectator:

```yaml
World Participation:
  observer

Round Role:
  spectator
```

Round Participation wird nicht durch World Participation ersetzt.

---

# 16. Gemeinsamer Player-Runtime-Lifecycle

Es existiert genau ein grundlegender Lifecycle:

```text
attachPlayerToWorld()
activatePlayerRuntime()
updatePlayerRuntime()
deactivatePlayerRuntime()
detachPlayerFromWorld()
```

Die Namen sind nicht verbindlich.

Der Vertrag ist verbindlich.

---

## 16.1 Kontextgesteuerte Initialisierung

Der Lifecycle erhält einen expliziten Kontext.

Beispielsweise:

```typescript
interface PlayerWorldRuntimeContext {
  readonly worldRevision: number;
  readonly participation: WorldParticipation;

  readonly features: PlayerRuntimeFeatures;
  readonly capabilities: PlayerCapabilities;

  readonly loadoutSource: PlayerLoadoutSource;
  readonly constructionAccessSource?: ...;
}
```

---

## 16.2 PlayerRuntimeFeatures

Ein Player benötigt nicht in jeder World dieselben Runtime-Systeme.

Beispielsweise:

```typescript
interface PlayerRuntimeFeatures {
  movement: boolean;
  physics: boolean;

  combat: boolean;
  combatResources: boolean;
  missionStatus: boolean;

  construction: boolean;
  occupancy: boolean;
  loadoutTools: boolean;
}
```

Dies ist nur ein konzeptionelles Beispiel.

### Persistent Base Editor

Beispielsweise:

```text
Player Entity        yes
Movement             yes
Physics              yes
Construction         yes
Occupancy            yes
Construction Tools   yes

Combat               no
Mission Resources    no
Mission Status       no
Respawn Budget       no
Mission Buffs        no
```

### Coop Mission

Beispielsweise:

```text
Player Entity        yes
Movement             yes
Physics              yes
Construction         abhängig vom Build
Combat               yes
Resources            yes
Loadout              yes
Mission Status       yes
```

---

## 16.3 Verbindliche Regel

> Der gemeinsame Player-Lifecycle darf nicht automatisch den vollständigen Mission-Player-Stack initialisieren.

Neue Player-Subsysteme dürfen außerdem nicht getrennte:

```text
Mission Init
Editor Init
PvP Init
```

Pflegepfade benötigen.

Sie müssen an einer gemeinsamen Lifecycle-Grenze eingebunden werden können.

---

## 16.4 Atomarer Attach

Ein Player darf nicht dauerhaft in einem halb initialisierten Zustand verbleiben.

Konzeptionell:

```text
Joining
↓
alle erforderlichen Module erfolgreich attached
↓
Baseline vollständig
↓
Interactive
```

Schlägt ein Schritt fehl:

```text
Rollback Attach
↓
Participation = none
```

---

# 17. Capability Policy

`canPlayerAct()` ist langfristig zu grob.

Stattdessen wird aus dem autoritativen Runtime-State eine spezifische Capability Policy aufgelöst.

Beispielsweise:

```typescript
interface PlayerCapabilities {
  readonly canMove: boolean;
  readonly canPlace: boolean;
  readonly canDismantle: boolean;
  readonly canInteract: boolean;
  readonly canUseCombat: boolean;
  readonly canUseMissionActions: boolean;
}
```

### Persistent Base

```text
Move             true
Place            true
Dismantle        true
Interact         true
Combat           false
Mission Actions  false
```

### Mission Participant

```text
Move             true
Combat           true
Mission Actions  true
Placement        loadout-/regelabhängig
```

### Observer

```text
Player Movement  false
Combat           false
Placement        false
Camera Control   true
```

---

## 17.1 Gemeinsamer Resolver, getrennte Authority

Host und Client dürfen dieselbe reine Regel verwenden:

```text
resolvePlayerCapabilities(...)
```

Aber:

### Client

berechnet daraus lediglich:

```text
Input UX
Preview
lokale Freigabe
```

### Host

berechnet Capabilities erneut aus seinem autoritativen State und verwendet sie für:

```text
RPC Validation
Placement Validation
Combat Validation
Movement/Input Acceptance
```

Client-seitig übermittelte Capabilities besitzen keine Autorität.

---

# 18. World Lifecycle und Activity Lifecycle trennen

Die aktuelle `ArenaLifecycleCoordinator`-Verantwortung wird logisch getrennt.

Konzeptionell:

```text
RoomRuntimeCoordinator
│
└── WorldRuntimeCoordinator
    │
    ├── WorldRuntime
    │
    └── ActivityRuntime
```

Eine Klassenhierarchie ist nicht vorgeschrieben.

Interfaces und Composition werden bevorzugt.

---

## 18.1 World Runtime

World Runtime besitzt beispielsweise:

```text
World Identity
World Definition
Metrics
Layout
Geometry
Grid
Players
Physics Foundation
Collision
Construction Runtime optional
Persistent Base Runtime optional
World Replication
```

---

## 18.2 Activity Runtime

Eine Coop Mission Runtime besitzt beispielsweise:

```text
Enemies
Enemy AI
Flowfields für Mission AI
Objectives
Mission Events
Boss
Mission Progress
Respawn Budget
Victory / Defeat
Mission Rewards
```

---

## 18.3 Verbindliche Regel

> Eine World ohne Activity instanziiert keine Activity-Systeme.

Nicht:

```text
EnemyManager = null
BossSystem = null
ObjectiveSystem = null
MapDirector = null
...
```

innerhalb eines großen flachen Containers.

Sondern konzeptionell:

```typescript
world.activity === null
```

---

# 19. `ArenaContext` strukturell entschärfen

Der heutige `ArenaContext` hält eine sehr große Anzahl Scene- und Round-Systeme als flache Struktur, wobei viele Round-Systeme außerhalb einer Mission `null` sind.

Dieses Muster soll im Rahmen der Pflichtstufe zumindest für World und Activity aufgebrochen werden.

Konzeptionell:

```typescript
interface ArenaContext {
  readonly scene: SceneServices;

  world: WorldRuntime | null;

  localPresentation: WorldPresentationRuntime | null;
}
```

und:

```typescript
interface WorldRuntime {
  readonly context: WorldRuntimeContext;
  readonly players: PlayerRuntimeRegistry;
  readonly activity: ActivityRuntime | null;
}
```

Die bestehenden Scene-Lifetime-Objekte dürfen ihre Identität behalten.

Sie werden nicht unnötig neu erzeugt.

---

# 20. World Update und Activity Update trennen

Der aktuelle `HostUpdateCoordinator` besitzt weiterhin einen sehr umfangreichen gemeinsamen Host-Tick.

Die Pflichtstufe führt deshalb eine eindeutige Aktivierungsgrenze ein.

Konzeptionell:

```text
Host Runtime Update
│
├── World Update
│
└── Activity Update, falls vorhanden
```

---

## 20.1 World Update

Beispielsweise:

```text
Player Runtime
Movement
Physics
Collision
Placement
Construction
Occupancy
World Interaction
World Replication
```

---

## 20.2 Activity Update

Bei Coop:

```text
Mission Progress
Objectives
Enemy Navigation
Enemy Movement
Enemy Combat
Map Events
Boss
Round Conclusion
Activity Replication
```

---

## 20.3 Reihenfolge bleibt expliziter Vertrag

Das Refactoring darf bestehende Simulationsreihenfolgen nicht leichtfertig verändern.

Deshalb ist nicht zwingend vorgeschrieben:

```typescript
world.update();
activity.update();
```

als ein einziger grober Block.

Falls Activity und World Phasen ineinandergreifen müssen, dürfen klare Phasen bestehen.

Beispielsweise:

```text
Pre Simulation
Player / World Input
Activity Navigation
Movement
Combat
World Interaction
Conclusion
Replication
```

Verbindlich ist:

> Activity-Systeme werden durch die Activity aktiviert und gruppiert, nicht durch verstreute Nullable-Abfragen.

Ein vollständiger generischer Scheduler ist für Stop-Punkt 1 nicht erforderlich.

---

# 21. World Simulation und lokale Presentation trennen

Dies ist eines der wichtigsten Pflichtziele.

Es existieren künftig konzeptionell getrennt:

```text
World Simulation Runtime
```

und:

```text
World Presentation Runtime
```

---

## 21.1 Host ohne Participation

Folgender Zustand muss normal sein:

```yaml
Shared World:
  Active

Host:
  Participation: none
  World Simulation: active
  World Presentation: absent

Client A:
  Participation: interactive
  World Presentation: active
```

---

## 21.2 Verbindliche Verschärfung

„Host bleibt in Lobby“ bedeutet ausdrücklich nicht:

```text
World wird lokal vollständig gerendert
+
Lobby Overlay liegt darüber
```

oder:

```text
World Render Tree existiert unsichtbar
```

Sondern:

> Auf dem Host wird keine lokale World-Presentation erzeugt.

Dazu gehören insbesondere keine für diese World benötigten:

```text
Terrain Render Surfaces
World Sprites
World Camera
World HUD
Aim Presentation
World Overlays
lokale Player-Visuals
```

Nicht-rendernde Infrastruktur, die die Host-Simulation technisch benötigt, darf bestehen.

Beispielsweise können Physics-Daten weiterhin Phaser-gebunden sein, solange daraus keine lokale World-Darstellung entsteht.

---

## 21.3 Presentation darf Simulation nicht besitzen

Presentation darf:

- Simulation beobachten,
- replizierte Zustände darstellen,
- Kamera steuern,
- HUD darstellen.

Presentation darf nicht Voraussetzung sein für:

- Physics,
- Collision,
- Placement,
- Authority,
- Mutationen,
- Player Runtime,
- World Replication.

---

# 22. Lobby Presentation

Die Lobby ist weiterhin lokale Presentation innerhalb derselben Phaser Scene.

`LobbyAmbientRuntime` ist bereits als eigenständiger lokal deaktivierbarer Lifecycle implementiert.

Für Stop-Punkt 1 ist zulässig:

> `LobbyAmbientRuntime` auf dem Host zu deaktivieren, während eine unsichtbare Shared World simuliert wird.

Nicht zulässig ist:

> deshalb die gesamte Shared World lokal zu rendern und lediglich die Lobby darüberzulegen.

Der Host muss weiterhin eine echte Lobby-Presentation besitzen.

---

# 23. Presentation Policy

Die lokale Scene soll nicht selbst zahlreiche Zustandskombinationen interpretieren.

Stattdessen:

```text
Room State
+
World State
+
Local World Participation
+
Activity State
+
Round Role
↓
Presentation Policy
```

Beispielsweise:

```typescript
interface PresentationPolicy {
  readonly showLobby: boolean;
  readonly showWorld: boolean;
  readonly showHud: boolean;
  readonly showAim: boolean;
  readonly useWorldCamera: boolean;
  readonly useSpectatorCamera: boolean;
}
```

---

# 24. Input Policy

Analog wird lokale Eingabe abgeleitet aus:

```text
Participation
+
Capabilities
+
UI State
+
Activity State
```

Beispielsweise:

```typescript
interface InputPolicy {
  readonly movement: boolean;
  readonly combat: boolean;
  readonly placement: boolean;
  readonly worldInteraction: boolean;
  readonly cameraNavigation: boolean;
}
```

Langfristig kann daraus entstehen:

```text
Physical Input
↓
Gameplay Intent
↓
Capability Policy
↓
Action
```

Die vollständige Intent-Abstraktion ist nicht zwingend Teil von Stop-Punkt 1.

---

# 25. Persistent Base als optionale World Component

Persistent Base ist weder eine Mission noch ein World Type, der Missionen ausschließt.

Sie ist eine optionale World-Komponente.

```text
World
├── PersistentBaseRuntime optional
└── ActivityRuntime optional
```

Damit sind beide Fälle natürlich:

### Editor

```text
World
+ PersistentBaseRuntime
+ keine Activity
```

### Kampagne

```text
World
+ PersistentBaseRuntime
+ CoopMissionActivity
```

---

# 26. Persistent-Base-Lifetime

Die Regel:

```text
letzter Participant verlässt
→ World zerstören
```

ist keine allgemeine World-Regel.

Sie gehört beispielsweise in:

```typescript
PersistentBaseWorldLifetimePolicy
```

Andere World-Arten dürfen andere Lebenszeiten besitzen.

---

# 27. Room Membership und Persistent Contributions

Persistent Contributions sind nicht an World Participation gekoppelt.

Ein Spieler kann:

```text
Room Member = yes
World Participation = none
```

und trotzdem Bestandteil der Composite Base sein.

Daher:

```text
Room Membership
↓
Composite Contribution Input
```

aber:

```text
World Participation
↓
aktive PlayerRuntime
```

Diese Verträge bleiben getrennt.

---

# 28. Persistenz und World Lifecycle

World Destroy bedeutet weder automatisch:

```text
Commit
```

noch:

```text
Rollback
```

Persistenz besitzt eine eigene Policy.

## Editor

```text
Host akzeptiert Mutation
→ Commit
→ Replication
```

## Mission

```text
Host akzeptiert Mutation
→ Working State

Victory
→ Commit

Defeat / Abort
→ Rollback
```

---

# 29. World-Systeme dürfen keine mutable Lobby-Konfiguration lesen

Dies ist eine neue harte Architekturgrenze.

Sobald eine World erzeugt wurde, darf kein World-System direkt lesen:

```text
aktuell ausgewählte Lobby Map
aktuell ausgewählter Lobby Mode
Lobby Ready State
Lobby Loadout
sonstige mutable Lobby-Auswahl
```

Benötigte Informationen werden beim World Create in:

```text
WorldDescriptor
WorldDefinition
WorldRuntimeContext
```

gebunden.

---

## 29.1 Verbindlicher Test

Während eine World aktiv ist:

```text
Lobby Map ändern
Lobby Mode ändern
```

darf keinerlei Einfluss haben auf:

```text
World Metrics
World Layout
World Bases
Persistent Base Site
Physics Bounds
Placement
Simulation
```

---

# 30. Runtime Transitions

Transitions werden zentral modelliert.

## Persistent Base – erster Teilnehmer

```text
Player requests join
↓
Participation = joining
↓
kein World vorhanden
↓
World = creating
↓
WorldDescriptor publizieren
↓
WorldRuntime erstellen
↓
World = active
↓
PlayerRuntime attach
↓
World baseline complete
↓
Participation = interactive
```

Activity bleibt:

```text
None
```

---

## Weiterer Teilnehmer

```text
Participation = joining
↓
bestehende World verwenden
↓
World laden
↓
PlayerRuntime attach
↓
Baseline
↓
interactive
```

---

## Verlassen

```text
interactive
↓
leaving
↓
PlayerRuntime detach
↓
none
```

---

## Letzter Teilnehmer

Falls Lifetime Policy dies verlangt:

```text
World active
↓
destroying
↓
WorldRuntime teardown
↓
WorldDescriptor = null
↓
none
```

Room bleibt bestehen.

---

# 31. Mission Transition

```text
Lobby
↓
World creating
↓
WorldDescriptor
↓
World active
↓
Player joining
↓
WorldLoadReady
↓
Activity creating
↓
ActivityDescriptor
↓
Mission countdown/start
↓
Activity active
```

Beim Ende:

```text
Activity active
↓
Activity ending
↓
Commit / Rollback
↓
Activity none
↓
Player detach
↓
World destroying
↓
World none
↓
Lobby
```

---

# 32. Race Cases

Folgende Fälle müssen deterministisch definiert sein:

- zwei Spieler fordern gleichzeitig die erste World an,
- Spieler disconnectet während `joining`,
- letzter Spieler verlässt während ein neuer Join eingeht,
- schneller Leave → Re-enter,
- World Destroy läuft während ein Join angefragt wird,
- Activity endet während Player `joining` ist,
- alte World-Baseline trifft nach neuer World ein,
- alter Placement Request trifft nach World Restart ein.

Diese Zustände dürfen nicht über eine wachsende Menge unabhängiger `pending...`-Flags rekonstruiert werden.

---

# 33. Zentrale Invarianten

Mindestens folgende Regeln gelten:

- Eine Activity benötigt genau eine aktive World.
- Eine World benötigt keine Activity.
- Es existiert höchstens eine Shared World pro Room.
- Eine World besitzt genau eine aktuelle `worldRevision`.
- Ein PlayerRuntime gehört genau einer World-Instanz.
- Ein Player ist nicht gleichzeitig `joining` und `interactive`.
- World Participation und Round Participation sind getrennt.
- Room Membership und World Participation sind getrennt.
- `GamePhase` bestimmt nicht World-Existenz.
- World-Existenz bestimmt nicht lokale Participation.
- lokale Participation bestimmt nicht Host-Simulation.
- World Simulation bestimmt nicht lokale World-Presentation.
- Activity-Systeme existieren nur bei entsprechender Activity.
- World-Systeme lesen keine mutable Lobby-Konfiguration.
- World-Nachrichten gehören genau einer World-Instanz.
- Persistenz wird nicht durch World Destroy entschieden.
- ein gemeinsamer Player Lifecycle bedeutet nicht vollständige Mission-Initialisierung.

---

# 34. Umgang mit bestehenden Scene-Lifetime-Systemen

Die logische Zuordnung zu World oder Activity zwingt nicht automatisch zu neuer Objekt-Lifetime.

Bestehende Scene-Lifetime-Systeme dürfen weiterleben, wenn:

- World-State vollständig resetbar ist,
- Activity-State vollständig resetbar ist,
- Player sauber attached/detached werden,
- keine alte World-Referenz gecaptured wird,
- keine Activity vorausgesetzt wird,
- parallele Lobby Presentation dadurch nicht verfälscht wird.

Dadurch wird ein unnötiger DI-/Lifetime-Rewrite vermieden.

---

# 35. Umgang mit `ArenaRuntimeProfile`

Das bestehende Profil ist während der Migration weiterhin nützlich.

Es darf als Compatibility Layer bestehen.

Langfristiges Ziel ist jedoch:

```text
World Components
+
Activity Runtime
```

anstatt:

```text
RuntimeKind
+
viele Boolean Flags
```

Nach Stop-Punkt 1 darf `ArenaRuntimeProfile` nicht mehr die kanonische Quelle dafür sein, ob eine Mission existiert.

---

# 36. Regression vor Umbau

Vor strukturellen Änderungen wird der stabile Phase-2-Zustand abgesichert.

Mindestens:

- Lobby → Mission,
- vollständiger Player-Spawn,
- Host-/Client-State,
- Mission Start,
- Victory,
- Defeat,
- technischer Abort,
- Rückkehr Lobby,
- Persistent-Base-Restore,
- Persistent-Base-Working-State,
- Commit,
- Rollback.

Tests sind Sicherheitsnetz des Refactorings, kein separates Großprojekt.

---

# 37. Neue Contract-Tests

Zusätzlich werden gezielt neue Architekturverträge getestet.

## World

- World ohne Activity erzeugen.
- World ohne Activity zerstören.
- neue World erhält neue Revision.
- alter World Snapshot wird verworfen.
- World Definition bleibt nach Erstellung stabil.
- Lobby Map Change verändert aktive World nicht.
- Lobby Mode Change verändert aktive World nicht.

## Authoring

- `persistent-base-editor` besitzt ausschließlich WorldDefinition.
- Editor besitzt keine Mission Objective.
- Editor besitzt keinen Dummy-Timer.
- ActivityDefinition referenziert gültige WorldDefinition.
- WorldDefinition enthält keine Victory-/Defeat-Regeln.

## Player

- gemeinsamer Attach/Detach-Pfad funktioniert in Mission und Editor.
- Editor initialisiert keine mission-only Player-Module.
- Disconnect während Joining räumt vollständig auf.
- Attach-Fehler erzeugt keinen Partial Runtime State.

## Networking

- genau ein WorldDescriptor ist kanonisch.
- ActivityDescriptor ist separat.
- WorldLoadReady verwendet `worldRevision`.
- World-scoped RPC alter Revision wird verworfen.

## Presentation

- Host ohne Participation besitzt keine WorldPresentationRuntime.
- Host simuliert World trotzdem.
- lokale Lobby bleibt sichtbar.
- Client Participant besitzt WorldPresentationRuntime.

---

# 38. Multiplayer-Test-Harness

Der bestehende In-Memory-Netzwerk-Testansatz kann für die neuen Lifecycle-Contracts erweitert werden.

Zusätzlich bleibt mindestens ein realer Browser-Smoke-Test mit Host und Client erforderlich.

Dieser deckt unter anderem ab:

- Phaser-Lifecycle,
- Camera,
- Physics,
- Rendering,
- Lobby Presentation,
- World Visibility,
- echte Netzwerkreihenfolge,
- Initial Baseline,
- Join/Leave.

---

# 39. Technischer Proof „World ohne Activity“

Vor der erneuten Phase 3 muss die Architektur praktisch beweisen:

```text
World erzeugen
Player hinzufügen
Movement
Physics
Collision
Placement
Construction Mutation
World Replication
Player entfernen
World zerstören
```

ohne:

```text
Mission Activity
Enemy Manager
Mission Objectives
Mission Events
Boss
Mission Progress
Victory / Defeat
Mission Timer
Mission Rewards
Respawn Budget
```

---

# 40. Härtester Pflicht-Proof

```yaml
Room:
  Lobby

Shared World:
  Persistent Base
  Active

Activity:
  None

Host:
  World Participation: none
  World Simulation: active
  World Presentation: absent
  Local Presentation: Lobby

Client A:
  World Participation: interactive
  World Presentation: active
```

## Host muss

- World aus genau einem `WorldDescriptor` erstellen,
- `WorldRuntimeContext` erzeugen,
- keine lokale World-Presentation erzeugen,
- keinen eigenen World-Player erzeugen,
- Client A vollständig attachen,
- Client Movement simulieren,
- Physics ausführen,
- Placement validieren,
- Persistent Mutations verarbeiten,
- World Snapshots replizieren,
- keine Activity Runtime instanziieren,
- lokal weiterhin Lobby darstellen.

## Client A muss

- WorldDescriptor empfangen,
- korrekte WorldDefinition auflösen,
- World lokal laden,
- vollständige Baseline erhalten,
- erst danach `interactive` werden,
- Movement ausführen,
- bauen,
- abbauen bzw. repositionieren,
- sauber verlassen.

## Beim letzten Leave

```text
PlayerRuntime detach
↓
Participation none
↓
Persistent Base Lifetime Policy
↓
World destroying
↓
World none
```

Room bleibt bestehen.

---

# 41. Stop-Punkt 1

Phase 3 darf erneut begonnen werden, wenn alle folgenden Bedingungen erfüllt sind.

## Kanonische Zustände

- World Lifecycle ist explizit.
- Activity Lifecycle ist explizit.
- Player World Participation ist explizit.
- Round Participation bleibt separat.
- Room Membership bleibt separat.
- `GamePhase` ist keine World-Truth mehr.

## Netzwerk

- genau ein kanonischer WorldDescriptor existiert,
- genau ein kanonischer World-Kanal existiert,
- Editor besitzt keinen eigenen WorldDescriptor-Typ,
- Activity wird separat repliziert,
- WorldLoadReady ist world-scoped,
- verspätete Nachrichten alter World-Instanzen werden zentral verworfen.

## Authoring

- WorldDefinition und ActivityDefinition sind getrennt,
- Base Editor ist eine reine WorldDefinition,
- keine Dummy-Mission ist erforderlich,
- keine künstlichen `survive`-/Timer-/Respawn-Felder sind erforderlich.

## World Context

- World besitzt `WorldRuntimeContext`,
- simulation-relevante Metrics sind World-scoped,
- Basen sind World-scoped,
- Persistent-Base-Site ist World-scoped,
- World-Code liest keine mutable Lobby-Konfiguration,
- globale aktive Map-/Base-Fallbacks sind keine kanonische World-Quelle mehr.

## Player

- Mission und Editor verwenden denselben Lifecycle,
- Lifecycle ist kontextgesteuert,
- Editor initialisiert nicht automatisch Mission-Player-Systeme,
- Attach/Detach ist deterministisch,
- Partial Runtime States werden verhindert.

## Activity

- World kann ohne Activity existieren,
- Missionssysteme existieren nur innerhalb der Mission Activity,
- friedliche World benötigt kein Runtime-Profil mit künstlich deaktivierten Missionssystemen.

## Host

- Host simuliert Shared World ohne eigene Participation,
- Host besitzt dabei keine lokale World-Presentation,
- Host benötigt keinen lokalen World-Player,
- lokale Lobby Presentation bleibt möglich.

## Input / Authority

- spezifische Capabilities existieren,
- Client verwendet sie für lokale UX,
- Host löst sie autoritativ selbst auf,
- `canPlayerAct()` ist nicht mehr der einzige universelle Action-Vertrag.

## Regression

- normale Missionen starten,
- Missionen enden,
- Victory funktioniert,
- Defeat funktioniert,
- Abort funktioniert,
- Lobby Return funktioniert,
- Persistent Base Phase 1/2 funktioniert,
- Netzwerk bleibt stabil.

---

# 42. Wiederverwendung aus dem aktuellen Phase-3-Stand

Der bestehende Phase-3-Stand ist nicht pauschal zu verwerfen.

Folgende Ansätze sind ausdrücklich Kandidaten zur Übernahme:

### Direkt weiterverwendbare Ideen

```text
gemeinsamer ArenaWorld-Core
gemeinsamer Player-Aktivierungspfad
PersistentBaseCompositeService
PersistentBaseRewardState
Mutation-/Reposition-Regeln
Ownership-Regeln
Occupancy
Composite-Base-Auflösung
Commit-/Rollback-Domainlogik
PersistentBaseSite
```

### Als Migrationselement weiterverwendbar

```text
ArenaWorldDescriptor
ArenaRuntimeProfile
```

### Im Zielmodell zu ersetzen

```text
PersistentBaseEditorWorld als eigener Netzwerkvertrag
KEY_PERSISTENT_BASE_EDITOR_WORLD
Editor als CoopDefenseMapConfig mit Dummy-Mission
globale aktive Arena-Metrik als World-Quelle
globale aktive Basenmenge als World-Quelle
Editor-spezifische Participation-Flags
World-Aufbau als Voraussetzung lokaler Presentation
```

---

# 43. Git-/Branch-Strategie

Der heutige Phase-3-Stand wird dauerhaft als Referenz gesichert.

Beispielsweise:

```text
phase3-reference
```

oder entsprechender Tag.

Danach:

```text
stabiler Phase-2-Endstand
↓
architecture-refactor-pre-phase3
```

Änderungen nach Phase 2 werden klassifiziert als:

```text
Domain-/Fachlogik
→ übernehmen

unabhängige technische Verbesserung
→ übernehmen

bereits bewährte Architektur-Seam
→ gezielt übernehmen

Runtime-/Lifecycle-Sonderpfad
→ nicht übernehmen

gemischter Commit
→ fachlich zerlegen
```

Cherry-Picks gemischter Phase-3-Commits sind zu vermeiden.

---

# 44. Vorgeschlagene Implementierungsreihenfolge

```text
0. Phase-3-Referenzstand dauerhaft sichern
                    ↓
1. Refactoring-Branch vom stabilen Phase-2-Endstand
                    ↓
2. Phase-2-Regression absichern
                    ↓
3. WorldDefinition / ActivityDefinition definieren
                    ↓
4. bestehenden Content über Adapter darauf abbilden
                    ↓
5. einen kanonischen WorldDescriptor definieren
                    ↓
6. einen kanonischen World-Netzwerkkanal einführen
                    ↓
7. ActivityDescriptor / Activity-State separat binden
                    ↓
8. WorldRuntimeContext einführen
                    ↓
9. Metrics / Grid / Bounds world-scoped machen
                    ↓
10. Bases / PersistentBaseSite world-scoped machen
                    ↓
11. World-Code von Lobby-Konfiguration entkoppeln
                    ↓
12. World Loading von Round Loading trennen
                    ↓
13. World Lifecycle zentralisieren
                    ↓
14. Activity Lifecycle aus World Lifecycle lösen
                    ↓
15. gemeinsamen kontextgesteuerten Player-Lifecycle schaffen
                    ↓
16. World Participation einführen
                    ↓
17. Capability Policy einführen
                    ↓
18. World Update / Activity Update trennen
                    ↓
19. World Simulation / World Presentation trennen
                    ↓
20. Presentation / Input Policy zentral ableiten
                    ↓
21. Transition-/Race-Case-Tests
                    ↓
22. härtesten „World ohne Activity“-Proof durchführen
                    ↓

                STOP-PUNKT 1

                    ↓
23. Persistent-Base-Phase 3 erneut integrieren
                    ↓
24. ArenaScene weiter auf Composition reduzieren
                    ↓
25. NetworkBridge APIs stärker nach Domänen gruppieren
                    ↓
26. Input → Intent weiter vereinheitlichen
                    ↓
27. HostUpdate-Pipeline weiter explizit strukturieren
                    ↓

                STOP-PUNKT 2

                    ↓
28+. optionale Fachsystem-Refactorings
```

---

# 45. Refactorings nach Stop-Punkt 1

Diese Punkte sind sinnvoll, aber keine Voraussetzung für Phase 3.

## `ArenaScene`

Weiter Richtung Composition Root reduzieren.

## `NetworkBridge`

Domänenbezogene Fassaden:

```text
Room
World
Participation
Activity
Player
Combat
Construction
Persistent Base
```

Kein Transport-Rewrite.

## Host Update

Explizitere Simulationsphasen.

## Input

```text
Physical Input
→ Gameplay Intent
→ Capability
→ Action
```

## Presentation

Deklarativer statt verstreuter `show()`-/`hide()`-Logik.

---

# 46. Optionale spätere Refactorings

Nicht Bestandteil des kritischen Pfads:

```text
CombatSystem modularisieren

ProjectileManager:
Simulation
Replication
Presentation

LoadoutManager stärker modularisieren

große Renderer teilen

große UI-Komponenten teilen
```

Diese werden nur bei tatsächlichem Wartungsdruck durchgeführt.

---

# 47. Architektur-Guardrails

Folgende Regeln sollen nach dem Refactoring dauerhaft gelten:

> Activity darf World verwenden. World kennt keine Activity-Regeln.

> WorldDefinition enthält keine Victory-/Defeat-Regeln.

> ActivityDefinition besitzt keine eigene konkurrierende World-Geometrie.

> Es existiert genau ein kanonischer WorldDescriptor.

> World-Systeme lesen keine mutable Lobby-Konfiguration.

> World-scoped Derived State gehört zur WorldRuntimeContext.

> Player Runtime hängt nicht von einer konkreten Mission ab.

> Gemeinsamer Player-Lifecycle bedeutet nicht vollständigen Mission-Stack.

> World-Existenz bestimmt nicht Player Participation.

> Player Participation bestimmt nicht Host-Simulation.

> Host-Simulation bestimmt nicht lokale World-Presentation.

> Local World Participation `none` erzeugt keine lokale World-Presentation.

> Presentation besitzt keine Gameplay Authority.

> Persistent-Base-Domain besitzt keine Phaser-Authority.

> Transport kennt keine UI.

> World-Nachrichten gehören eindeutig einer World-Instanz.

> Persistenz folgt fachlichen Commit-Regeln, nicht World Teardown.

---

# 48. Zielbild Persistent Base Editor

Beim ersten Teilnehmer:

```text
Room bleibt bestehen
↓
Participation = joining
↓
World = creating
↓
WorldDescriptor:
    persistent-base-editor.world
↓
WorldRuntimeContext
↓
PersistentBaseRuntime
↓
ConstructionRuntime
↓
Activity = none
↓
PlayerRuntime attach
↓
WorldLoadReady
↓
Participation = interactive
```

Weitere Teilnehmer:

```text
bestehende World
↓
joining
↓
lokaler World Load
↓
PlayerRuntime attach
↓
interactive
```

Beim Verlassen:

```text
interactive
↓
leaving
↓
PlayerRuntime detach
↓
none
```

Letzter Participant:

```text
Lifetime Policy
↓
World destroying
↓
World none
```

---

# 49. Zielbild Kampagnenmission

```text
Lobby
↓
WorldDefinition auswählen
↓
WorldDescriptor
↓
WorldRuntimeContext
↓
World active
↓
Player attach
↓
PersistentBaseRuntime optional
↓
CoopMission Activity erstellen
↓
ActivityDescriptor
↓
Countdown
↓
Mission active
↓
Mission Ende
↓
Commit / Rollback
↓
Activity destroy
↓
Player detach
↓
World destroy
↓
Lobby
```

Persistent Base und Coop Mission sind damit zwei voneinander unabhängige Bestandteile derselben World.

---

# 50. Kernaussage

Der Phase-3-Versuch hat nicht gezeigt, dass die Persistent Base fachlich zu komplex für Fragdachse ist.

Er hat gezeigt, dass die bestehende Architektur noch zu stark von folgender historischen Gleichsetzung ausgeht:

```text
Arena
=
World
=
Round
=
Mission
=
Player Participation
=
Presentation
```

Das Refactoring ersetzt diese Gleichsetzung durch:

```text
Room
   │
   └── World 0..1
          │
          ├── World Components
          ├── Player Participation
          └── Activity 0..1
```

Die World besitzt dabei:

```text
genau einen Descriptor
genau eine Revision
genau einen Runtime Context
```

und weder World-Systeme noch ihre Derived States hängen nach ihrer Erstellung von mutablem Lobby-State ab.

Der wichtigste Architektur-Proof lautet:

> **Der Host simuliert eine autoritative Shared World für andere Spieler, obwohl er selbst keine World Participation und keine lokale World-Presentation besitzt.**

Der Persistent-Base-Editor ist danach kein technischer Sondermodus mehr.

Er ist schlicht:

> **eine Shared World mit Persistent-Base- und Construction-Runtime, teilnehmenden PlayerRuntimes und ohne Activity.**

Und eine Kampagnenmission ist:

> **eine Shared World, auf der zusätzlich eine Coop-Mission-Activity aktiv ist.**
