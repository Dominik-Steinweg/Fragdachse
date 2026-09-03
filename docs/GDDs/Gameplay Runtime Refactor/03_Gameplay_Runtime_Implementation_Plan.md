# Fragdachse – Gameplay Runtime Refactoring: Implementierungsplan

**Status:** Planungsstand für den ersten großen Gameplay-Runtime-Cutover  
**Repository-Basis der Planung:** `main` @ `fcc6e3f5ac194fa29b08d23a1c2b3331f8dc3453`  
**Architekturvorgaben:** `01_Gameplay_Runtime_Architecture_Core.md` und `02_Gameplay_Runtime_Architecture_Details.md`  
**Laufendes Protokoll:** `04_Gameplay_Runtime_Migration_Status.md`

> Dieses Dokument plant ausschließlich den **ersten Player-Gameplay-/Action-/Loadout-/Ability-Cutover**.
> Ein vollständiges Projectile- oder Combat-Refactoring ist ausdrücklich **nicht** Bestandteil dieses Plans.
>
> Jede nummerierte Teilphase ist als eigenständiger Auftrag für eine Coding-KI geschnitten.
> Die Teilphasen müssen **nicht** jeweils einen vollständig spielbaren Zwischenstand erzeugen.
> Entscheidend ist, dass nach Abschluss des gesamten Plans wieder ein sauber integrierter, getesteter Stand entsteht.
> Künstliche Kompatibilitätsschichten nur zur Erhaltung eines vorübergehend spielbaren Zwischenstands sind zu vermeiden.

---

## 1. Zweck und Zielzustand

Das Refactoring soll den heute stark gekoppelten Player-Gameplay-Pfad in klare fachliche Grenzen zerlegen, ohne die komplette Projektil- und Schadensarchitektur gleichzeitig neu zu bauen.

Nach Abschluss dieses Plans gilt:

1. `WorldPlayerGameplayRuntime` ist die **öffentliche World-Grenze** des Player-Gameplays und kein öffentliches Verzeichnis konkreter Child-Systeme.
2. Lokale Eingabe bleibt Präsentations-/Input-Anliegen; hostautoritative Action-/Commit-Entscheidungen liegen hinter einer expliziten Player-Gameplay-Grenze.
3. `LoadoutManager` besitzt primär:
   - ausgerüstete Slots,
   - gültige Auswahl,
   - effektive Config-Auflösung,
   - ability-/tool-lokale Readiness-Zustände, soweit sie semantisch zum Item gehören,
   - temporäre Utility-Instanzen als Loadout-/Ability-Verfügbarkeit.
4. `LoadoutManager` besitzt **nicht mehr**:
   - allgemeine Action-Orchestrierung,
   - große Ultimate-Lifecycles,
   - AK47-/Negev-/Shotgun-Reaktionszustände,
   - Construction-/Management-Cooldowns,
   - Shared Weapon Execution,
   - direkte Netzwerktransporte.
5. Player-Aktionen besitzen eine explizite Identität und verwenden hostseitige Zeit.
6. Resource-Zahlung, Cooldown/Readiness und Commit erfolgen genau dort, wo die jeweilige Ability-Semantik sie verlangt.
7. Gemeinsame unmittelbare Waffen-Ausführung wird als kleine Capability hinter dem bestehenden `WeaponFireExecutor` stabilisiert.
8. Gegner, Türme, Nekromantie und andere automatische Quellen verwenden diese Execution-Capability direkt und nicht `LoadoutManager`.
9. Spezielle Player-Behaviors wie AK47, Negev, Tesla Dome und Energy Shield besitzen klar benannte Zustandsowner.
10. `WorldCombatGameplayBinding`, Host-/Client-Frame und Activity-Kompositionen greifen nicht mehr auf den kompletten `WorldPlayerGameplayRuntime.systems`-Graphen zu.
11. `LoadoutManager` ist kein konkreter `NetworkBridge`-Consumer mehr.
12. ProjectileManager und CombatSystem dürfen im Ergebnis intern weiterhin Legacy sein; sie werden nur hinter stabileren oberen Verträgen konsumiert.

---

## 2. Verbindliche Abgrenzung

### 2.1 Im Scope

- Player Action / Activation / Commit
- Held Actions und Attempt-/Request-Identität
- Host-Zeit im Player-Gameplay-Pfad
- Resource-/Readiness-Vertrag
- Loadout-Verkleinerung
- Temporary Utilities
- Shared Immediate Weapon Execution
- automatisierte Waffenquellen
- spezialisierte Weapon-Execution-Adapter
- Utility-Aktivierung
- Ultimate-Aktivierung und -Lifecycle
- AK47-, Negev- und Shotgun-bezogene Player-Behaviors
- Tesla-Dome-/Energy-Shield-Aktivierungsorchestrierung
- Player-Combat-Integrationsgrenze
- Host-/Client-Player-Gameplay-Frame-Grenzen
- World-/Activity-/Construction-/Support-Consumer-Cleanup
- Netzwerkentkopplung des Loadout-/Ability-Cores
- Architektur- und Regression-Tests für diese Grenzen

### 2.2 Nicht im Scope

Folgende Arbeiten dürfen in diesem Plan **nicht** mitgezogen werden:

- vollständiger `ProjectileManager`-Neuaufbau
- Projectile-Lifetime-/Kontakt-/Payload-Pipeline als neues Framework
- vollständiger `CombatSystem`-Neuaufbau
- globales Health-/Damage-/Attribution-Framework
- allgemeines `AbilitySystem`
- allgemeines `CooldownManager`-/`ReadinessManager`-Framework
- allgemeines `CommitManager`
- globale Scheduler-/Timeline-Abstraktion
- globale `TimeService`-/`RandomService`-Abstraktion
- vollständiges Redesign aller Weapon-/Utility-Configs
- neue Control-Session-/Actor-Session-Architektur ohne konkreten Druck
- Bereinigung aller verbliebenen `Date.now()`-/`Math.random()`-Vorkommen außerhalb des Player-Gameplay-Cutovers
- kosmetisches Umorganisieren nicht betroffener Dateien
- Balance- oder Featureänderungen

Wenn während der Umsetzung ein Problem in Projectile oder Combat sichtbar wird, wird es nur soweit angepasst, wie es für die neue obere Schnittstelle zwingend notwendig ist. Größere Folgerefactorings werden im Status als **Follow-up-Kandidat** notiert.

---

## 3. Maßgebliche Ist-Anker

Die Umsetzung soll bestehende gute Teile **weiterverwenden**, nicht parallel neu erfinden.

### 3.1 Gute Anker

- `src/systems/HostHeldActionSystem.ts`
  - explizite `actionId`
  - hostseitige Zeit
  - stale-safe Consume
  - Identity-Bindung an Tool/Temporary Utility
- `src/loadout/WeaponFireExecutor.ts`
  - zustandsarme Shared Execution für Projectile/Hitscan/Melee
  - keine Resource-/Progression-/Netzwerk-Autorität
- `src/loadout/TemporaryUtilityCollection.ts`
  - stabile Instanzidentität
  - Charges
  - per-instance Cooldown
  - Acquisition Order
- bestehende `PlayerCapabilities`-/`InputPolicy`-Trennung
- bestehende World-/Activity-Lifetime-Grenzen
- bestehende RPC-/Composition-Grenzen
- bestehende NetworkBridge-Dedupe-Semantik für Weapon2-Prediction

### 3.2 Zentrale aktuelle Kopplungspunkte

Vor dem Cutover sind insbesondere folgende Stellen relevant:

- `src/world/WorldPlayerGameplayRuntime.ts`
- `src/loadout/LoadoutManager.ts`
- `src/scenes/arena/ArenaWorldPlayerComposition.ts`
- `src/scenes/arena/ArenaRuntimeAdapters.ts`
- `src/scenes/arena/ArenaRpcPorts.ts`
- `src/scenes/arena/RpcCoordinator.ts`
- `src/scenes/arena/ArenaLifecycleCoordinator.ts`
- `src/scenes/arena/HostUpdateCoordinator.ts`
- `src/scenes/arena/ClientUpdateCoordinator.ts`
- `src/scenes/arena/ArenaPersistentBaseSession.ts`
- `src/world/WorldCombatGameplayBinding.ts`
- `src/world/WorldSupportGameplayRuntime.ts`
- `src/world/ConstructionWorldRuntime.ts`
- `src/activity/CoopMissionComposition.ts`
- `src/activity/CoopMissionEnemyBehaviourComposition.ts`
- `src/systems/CoopDefenseEnemyAttackSystem.ts`
- `src/systems/Ak47StrategicTargetSystem.ts`
- weitere direkte `LoadoutManager`-/`WorldPlayerGameplayRuntime.systems`-Consumer, die Phase 1 vollständig inventarisiert

---

## 4. Unverhandelbare Invarianten

Diese Invarianten haben Vorrang vor einer bequemen Migration.

### 4.1 Autorität

- Der Host entscheidet, ob eine Gameplay-Aktion akzeptiert und committed wird.
- Client-Prediction ist niemals Autorität.
- `clientNow` ist keine fachliche Host-Zeit.
- Lokale UI-/Input-Readiness ist kein Beweis für hostseitige Ausführbarkeit.

### 4.2 Identität

Mindestens folgende Identitäten bleiben semantisch getrennt:

- Action/Held Action
- Attempt/Request
- Execution/Shot
- Prediction
- Source/Attribution

Ein Retry desselben commit-tragenden Attempts darf nicht doppelt committen.

### 4.3 Zeit

- Neue oder migrierte Player-Gameplay-Regeln erhalten `nowMs`/`deltaMs` explizit.
- Kein neues `Date.now()` in Action-, Resource-, Readiness-, Commit- oder Behavior-Logik.
- Keine neue globale Time-Abstraktion.

### 4.4 Single Source of Truth

- Zu jedem Zeitpunkt existiert pro mutablem Zustand genau ein Writer.
- Eine Übergangsdelegation ist nur one-way zulässig.
- Kein paralleler alter und neuer Mutationspfad.
- Keine Synchronisierung zweier konkurrierender Runtime-Zustände.

### 4.5 Loadout

`LoadoutManager` beantwortet am Ende vor allem:

- Was ist ausgerüstet?
- Welche effektive Config gilt?
- Welche konkrete Ability-/Tool-Instanz ist gemeint?
- Welche item-lokale Readiness/Spread-Information gehört zum Loadout?

Er beantwortet am Ende nicht mehr:

- Wie wird eine komplette Player Action ausgeführt?
- Wie läuft eine komplexe Ability über Zeit?
- Wie feuert ein Gegner/Turm?
- Wie wird Netzwerkzustand transportiert?
- Wie wird Combat/Projectile fachlich aufgelöst?

### 4.6 Execution

- Shared Execution wird nur geteilt, wenn die Semantik wirklich gleich ist.
- `WeaponFireExecutor` bleibt ein kleiner gemeinsamer Kern.
- Spezialpfade dürfen benannte Adapter besitzen.
- Kein universeller Executor mit immer größeren optionalen Context-Feldern.

### 4.7 World / Activity

- Player-Gameplay ist World-owned.
- Mission-/Round-State ist Activity-owned.
- Player-Gameplay hält keine konkrete `CoopMissionRuntime`.
- Activity konsumiert kleine Player-/Execution-Ports.

### 4.8 Frame-Reihenfolge

Die heute sichtbare Reihenfolge von:

- Player-/Item-Update
- Resource/Burrow
- Physics
- Combat
- Projectile
- post-Projectile Behaviors
- Area Effects
- Snapshot/Presentation

darf nicht stillschweigend verändert werden.

Wenn ein neuer Runtime-Owner mehrere Frame-Zeitpunkte benötigt, erhält er **mehrere semantisch benannte Stage-Methoden** statt eines künstlichen Einheits-`update()`.

### 4.9 Keine künstliche Zwischenarchitektur

Da Zwischenphasen nicht spielbar sein müssen:

- keine Adapter nur zur Erhaltung eines alten öffentlichen API,
- keine doppelte Fassade,
- keine temporäre Universalabstraktion,
- kein dualer State.

Ein lokaler, klar markierter one-way Übergang innerhalb einer Kategorie ist zulässig, wenn die nächste Teilphase ihn entfernt.

### 4.10 Cross-Phase Contract Manifest

Die folgenden Contract-Familien sind über mehrere Teilphasen hinweg stabil zu behandeln. Sie verhindern, dass verschiedene Coding-KIs für dieselbe Grenze jeweils neue Namen oder konkurrierende Fassaden erfinden. **Keiner dieser Contracts ist ein Universal-Context:** Jede konkrete Schnittstelle enthält nur die Daten, die ihr Consumer tatsächlich benötigt.

| Contract-Familie | Verbindliche Rolle | Minimaler Zielvertrag | Einführung |
|---|---|---|---|
| `PlayerGameplayLifecyclePort` | öffentliche Player-in-World-/World-Lifecycle-Grenze | attach/init, detach/remove, Loadout-/Build-Reconcile, fachliche Held-Invalidierung, World teardown | 2A |
| `PlayerGameplayReadViews` | kleine consumer-orientierte Read-Sichten | getrennte Loadout-/Equipped-, Resource-, Player-State/Burrow-, Prediction/HUD- und nur bei Bedarf Construction-Reads | 2B |
| `PlayerActionRequest` | hostautoritatives semantisches Action-Request-Modell | Player/Actor-ID, konkrete Action-/Tool-Referenz, host `nowMs`, Attempt-ID falls vorhanden; Aim/Target nur im jeweiligen kategorietypisierten Request | 6A |
| `WeaponExecutionCapability` | gemeinsame immediate Weapon-Ausführung oberhalb von Projectile/Combat-Legacy | kleiner Fire-Contract für tatsächlich gemeinsame Projectile/Hitscan/Melee-Semantik; spezialisierte Adapter bleiben erlaubt | 4A |
| `PlayerRelationshipPort` | Domain-Sicht für Friend/Enemy-/Eligibility-Reads | z. B. `isEnemyPair(firstPlayerId, secondPlayerId): boolean`; keine Transport-Authority | 10B |
| `PlayerCombatIntegrationPort` | semantische Grenze zwischen Combat-Binding und Player-Gameplay | nur reale Reads/Mutationen/Outcomes; darf in mehrere kleine Ports geschnitten werden | 11A/11B |
| `PlayerGameplayFrameStages` | semantisch benannte Player-Gameplay-Frame-Schritte | mehrere Stage-Methoden entsprechend realer Frame-Reihenfolge, kein generisches Einheits-`update()` | 12A |

Für TypeScript gilt:

- Die **Contract-Familiennamen oben sind stabil**. Eine Phase darf sie in mehrere fachlich kleinere Interfaces aufteilen, aber nicht durch eine neue parallele Fassade ersetzen.
- Der genaue implementierte Interface-/Methodenname wird in der einführenden Phase einmal festgelegt und anschließend in `04_Gameplay_Runtime_Migration_Status.md` unter `Realisierte Contract-Namen` dokumentiert. Spätere KIs verwenden diese Namen weiter.
- `PlayerActionRequest` wird bevorzugt als diskriminierte Familie modelliert statt als Objekt mit immer mehr optionalen Feldern, z. B. Weapon-/Utility-/Ultimate-spezifische Requests mit gemeinsamem kleinen Basisanteil.
- `WeaponExecutionCapability` erhält kein unbounded `ExecutionContext`; spezialisierte Fire-Arten dürfen eigene kleine Request-Typen/Adapter besitzen.
- `PlayerCombatIntegrationPort` wird nur für tatsächlich vorhandene Consumer-Operationen materialisiert; kein vorsorgliches Mega-Interface.

Minimale Referenzformen für die drei fehleranfälligsten Cross-Phase-Grenzen:

```ts
export interface PlayerRelationshipPort {
  isEnemyPair(firstPlayerId: string, secondPlayerId: string): boolean;
}

export interface PlayerActionRequestBase {
  readonly playerId: string;
  readonly hostNowMs: number;
  readonly attemptId?: string;
}

export type PlayerActionRequest =
  | (PlayerActionRequestBase & {
      readonly kind: 'weapon';
      readonly slot: 'weapon1' | 'weapon2';
      readonly aim: { x: number; y: number };
    })
  | (PlayerActionRequestBase & {
      readonly kind: 'utility';
      readonly toolId: string;
      readonly temporaryInstanceId?: string;
      readonly target?: { x: number; y: number };
    })
  | (PlayerActionRequestBase & {
      readonly kind: 'ultimate';
      readonly toolId: string;
      readonly target?: { x: number; y: number };
    });
```

Die Union zeigt nur die **Form der Trennung**. Phase 6A/7 darf Felder an die reale Semantik anpassen, aber nicht Action-, Attempt-, Shot- und Prediction-Identität wieder vermischen. Prediction-ID gehört nur dann in einen konkreten Adapter-/Correlation-Contract, wenn der betreffende Pfad sie tatsächlich benötigt.

Für Shared Immediate Execution bleibt der bereits existierende Contract der primäre Anker:

```ts
WeaponFireExecutor.fire(config: WeaponConfig, params: WeaponFireParams): boolean
```

`WeaponExecutionCapability` kapselt/besitzt diesen bestehenden Executor für world-scoped Consumer; sie erfindet **keinen zweiten parallelen Fire-Request-Typ**, solange `WeaponFireParams` die gemeinsame Semantik korrekt trägt. Spezialisierte Adapter erhalten nur bei echter abweichender Semantik eigene kleine Request-Typen.

---

## 5. Arbeitsweise für jede Coding-KI

### 5.1 Vor jeder Teilphase

Die Coding-KI liest:

1. `01_Gameplay_Runtime_Architecture_Core.md` **vollständig**.
2. Aus `02_Gameplay_Runtime_Architecture_Details.md` **nur die unten für die aktuelle Teilphase referenzierten §§**; bei tatsächlichem Cross-Layer-Bedarf zusätzlich § 15.
3. **Nur die aktuell umzusetzende Teilphase** dieses Dokuments plus §§ 1–6 und das Cross-Phase Contract Manifest.
4. `04_Gameplay_Runtime_Migration_Status.md` **vollständig**.
5. `AGENTS.md`.
6. `docs/ai/architecture-principles.md`.
7. die für die Teilphase relevanten `docs/ai/*`-Seiten.

#### Phasenspezifischer Architektur-Router

| Teilphase | Zusätzlich aus `02_Gameplay_Runtime_Architecture_Details.md` laden |
|---|---|
| 1 | §§ 3, 6, 8–14, 19, 21–23, 26–29, 37–38 |
| 2A | §§ 3, 6, 22, 26–29 |
| 2B | §§ 3, 6–7, 22–24, 26–29 |
| 3A | §§ 8.1, 10.1, 23, 27–29 |
| 3B | §§ 9.1, 10.1, 11, 27–29 |
| 4A | §§ 13, 15–19, 26–29 |
| 4B | §§ 4, 13–15, 19, 21, 26–29 |
| 4C | §§ 9, 13, 15–18, 26–29 |
| 5 | §§ 3, 11, 22, 27–29 |
| 6A | §§ 4–13, 15, 23, 27–29 |
| 6B | §§ 8.1, 10, 23, 27–29 |
| 7A | §§ 8–13, 22–23, 27–29 |
| 7B | §§ 10–13, 22, 25, 27–29 |
| 7C | §§ 10–13, 15, 22, 27–29 |
| 8A | §§ 9–13, 20, 23, 27–29 |
| 8B | §§ 9–13, 20, 27–29 |
| 8C | §§ 9, 12–13, 20, 27–29 |
| 9 | §§ 10–13, 15–17, 23–24, 27–29 |
| 10A | §§ 6, 9–13, 26–29, 37–38 |
| 10B | §§ 2.7, 6, 8.1, 23, 25, 27–29 |
| 11A | §§ 15, 17–20, 22–23, 26–29 |
| 11B | §§ 15, 17–20, 23, 26–29 |
| 12A | §§ 3, 15, 19, 22, 27–29 |
| 12B | §§ 8.1, 23–24, 27–29 |
| 12C | §§ 3, 6, 22–25, 27–29 |
| 13 | §§ 27–30, 37–38 sowie die Fachabschnitte aller noch offenen Review-Kandidaten |

Die Tabelle ist der Standard. Wenn die reale Änderung einen zusätzlichen Fachbereich berührt, darf die KI den entsprechenden Abschnitt zusätzlich laden; sie soll aber **nicht vorsorglich das gesamte Detaildokument** in den Kontext ziehen.

Anschließend:

- relevante Symbole und alle Call-Sites per `rg`/Code Search ermitteln,
- aktuelle Tests der betroffenen Semantik finden,
- Owner/Lifetime/Authority/SSOT/Teardown bestimmen,
- existierende Ports und Resolver wiederverwenden.

### 5.2 Nach jeder Teilphase

Die Coding-KI:

1. führt die in der Teilphase genannten automatisierten Checks aus,
2. führt zusätzlich proportionale Tests gemäß `AGENTS.md` aus,
3. aktualisiert `04_Gameplay_Runtime_Migration_Status.md`,
4. dokumentiert dort:
   - Phase abgeschlossen/aktiv/blockiert,
   - bewusst verbleibende Transition,
   - aktuell bekannte Regression,
   - letzter automatisierter Gate,
   - konkreter nächster Schritt,
   - Dokumentations-Follow-ups,
5. verändert `01`, `02` und dieses Plan-Dokument **nicht** selbständig,
6. erstellt nach grünem Phase-Gate und Status-Update **genau einen Git-Commit für die abgeschlossene Teilphase** und trägt den Commit-Hash in `04` ein.

Ist die Teilphase blockiert oder der verpflichtende Gate nicht grün, wird **kein Abschluss-Commit als erledigte Phase** erzeugt; der Blocker wird stattdessen in `04` dokumentiert.

### 5.3 Sichtprüfung

Coding-KIs führen **keine** Sichtprüfung durch.

Insbesondere:

- keinen Browser starten,
- keinen Dev-Server nur für eine Sichtprüfung starten,
- keine Screenshots erzeugen,
- keine manuelle UI-/Gameplay-Prüfung simulieren.

Manuelle Gameplay-/Sichtprüfung erfolgt durch den Menschen. Der Standard-Gate liegt erst nach dem vollständigen Cutover.

### 5.4 Umgang mit absichtlich unvollständigen Zwischenständen

Ein Zwischenstand darf vorübergehend nicht vollständig spielbar sein. **TypeScript/Build und die für die Teilphase verpflichtenden Unit-/Contract-Gates bleiben nach einer als abgeschlossen markierten Teilphase grundsätzlich grün.**

Ein bewusst roter Integrationstest ist nur als enge Ausnahme zulässig, wenn:

- genau **ein konkret benannter Übergangsvertrag** die Rotphase technisch unvermeidbar macht,
- die aktuelle Teilphase ihren eigenen Zielzustand vollständig erreicht,
- die neue Source of Truth eindeutig ist,
- Testname, Grund, alter/neuer Writer und schließende direkt folgende Teilphase konkret in `04` dokumentiert sind,
- kein zweiter mutierender Pfad aktiv bleibt,
- keine andere Teilphase begonnen wird, bevor die unmittelbar folgende Schließphase den roten Test wieder grün macht.

Ein allgemeines „Zwischenstand darf rot sein“ ist ausdrücklich **nicht** zulässig. Bevorzugt werden kleine Phasen so geschnitten, dass Build/TypeScript und alle betroffenen Tests jederzeit grün bleiben.

---

## 6. Kurzprompt für die spätere Umsetzung

Wenn die Dateien im Repository liegen, soll für die nächste Teilphase grundsätzlich dieser kurze Prompt genügen:

> Implementiere die nächste offene Teilphase aus `03_Gameplay_Runtime_Implementation_Plan.md` gemäß `01_Gameplay_Runtime_Architecture_Core.md`, den für diese Phase in § 5.1 referenzierten Abschnitten aus `02_Gameplay_Runtime_Architecture_Details.md` und `04_Gameplay_Runtime_Migration_Status.md`. Führe die vorgesehenen automatisierten Checks aus, aktualisiere danach nur den Status und erstelle bei grünem Gate genau einen Commit für die abgeschlossene Teilphase. Keine Sichtprüfung und kein Dev-Server.

Die Coding-KI muss die konkrete Phase selbst aus `04` und diesem Plan auflösen.

---

# 7. Implementierungsphasen

## Phase 1 – Baseline, Contract-Matrix und Migrationskarte

### Ziel

Vor dem ersten strukturellen Cutover werden die heute tatsächlich verwendeten Verträge vollständig kartiert und die riskantesten Semantiken testseitig fixiert.

Diese Phase soll **keine neue Runtime-Architektur implementieren**.

### Aufgaben

1. Vollständige Consumer-Matrix erstellen für:
   - `WorldPlayerGameplayRuntime.systems`
   - `WorldPlayerGameplaySystems`
   - `LoadoutManager`
   - `LoadoutManager.use`
   - `fireAutomatedWeapon`
   - `fireAutomatedGaussWeapon`
   - Construction-/Management-Cooldown-Methoden
   - Temporary-Utility-Methoden
   - AK47-/Negev-/Shotgun-bezogene Methoden
   - Tesla-Dome-/Energy-Shield-Hooks
   - direkte konkrete `NetworkBridge`-Verwendung in `LoadoutManager`
   - relevante versteckte `Date.now()`-Defaults und -Reads
2. Die Matrix nach Consumer-Art klassifizieren:
   - Action
   - Read/Presentation
   - Lifecycle
   - Resource
   - Construction/Persistent Base
   - Combat integration
   - automated actor
   - Activity
   - network adapter
3. Bestehende Tests inventarisieren und im Status eine Test-Migrationskarte pflegen.
4. Vor dem Umbau gezielte Characterization-Tests ergänzen, falls nicht bereits abgedeckt:
   - Held Action stale commit / duplicate-safe At-most-once-Consume
   - Weapon2 Prediction Retry/Dedupe
   - Temporary Utility Identity/Charges/Cooldown
   - Resource Revision
   - erfolgreiche vs. abgelehnte Resource-/Cooldown-Commit-Reihenfolge
   - ausgerüstete Config-Auflösung
   - dynamischer Spread / Shot Identity
   - automated fire source metadata
   - Construction-/Management-Cooldowns
   - Ultimate-Sonderpfade
   - AK47 hit/refund identity
   - Negev streak termination
   - Shotgun lightning reaction
   - Tesla Dome / Energy Shield start-stop
5. Die heute verwendete `clientX`/`clientY`-Semantik im Loadout-Use-Pfad explizit testseitig festhalten, bevor sie umbenannt oder verschoben wird.
6. Die Source-Ratchets identifizieren, die aktuell alte Quellcodepositionen absichern und später semantisch migriert werden müssen.

### Nicht tun

- keine `PlayerActionRuntime`-Klasse anlegen
- kein neues Ability-Framework
- keine Klassen nur wegen Dateigröße aufteilen
- keine produktive Semantik ändern

### Abschlusskriterium

- Consumer-Matrix und Test-Migrationskarte stehen in `04`.
- Riskante Semantik ist ausreichend charakterisiert, damit spätere Teilphasen keine reine Blindmigration sind.
- Keine neue Architektur wurde vorweggenommen.

### Automatisierter Gate

- alle neu hinzugefügten Characterization-Tests
- relevante bestehende Tests der kartierten Pfade
- `npm run check`, falls mehrere Produktivmodule für Testbarkeit angepasst wurden

---

## Phase 2A – Öffentliche Player-Gameplay-Lifecycle-Grenze

### Ziel

`WorldPlayerGameplayRuntime` erhält eine explizite öffentliche Lifecycle-/Reconcile-API. Oberhalb der Runtime sollen Consumer nicht mehr konkrete Child-Systeme initialisieren oder abbauen müssen.

### Ziel-API

Die konkrete Benennung darf an den vorhandenen Stil angepasst werden. Semantisch benötigt die Runtime mindestens Operationen für:

- Player attach / init
- Player detach / remove
- Loadout-/Build-Reconcile
- Activity-Identity-bezogene Held-Action-Invalidierung
- World teardown / reset
- gegebenenfalls gezielte Runtime-Reconcile-Operationen

### Aufgaben

1. Die derzeit in `ArenaLifecycleCoordinator` verstreute Initialisierung von:
   - Resource
   - Burrow
   - Loadout
   - Held Action
   - weiteren Player-Gameplay-Children
   hinter Runtime-Methoden ziehen.
2. Reconcile des live/committed Loadouts hinter die Runtime-Grenze ziehen.
3. Teardown-Reihenfolge im Runtime-Owner explizit machen.
4. Idempotenz für remove/reset/destroy testen.
5. `ArenaLifecycleCoordinator` auf die neue öffentliche Lifecycle-API migrieren.
6. Direkte Lifecycle-Zugriffe auf `.systems.*` in anderen oberen Consumern migrieren.

### Invarianten

- Player-in-World-Lifecycle und Round-Respawn bleiben getrennt.
- Ein Activity-Wechsel darf World-owned Loadout-/Resource-State nur gemäß bestehender Semantik resetten.
- Held Actions werden bei der fachlich korrekten Identity-Grenze invalidiert.
- Kein zweiter Lifecycle-Owner.

### Nicht tun

- noch keine Read-Fassade für alle Consumer erzwingen
- noch kein `LoadoutManager.use` verschieben
- Projectile/Combat nicht anfassen

### Abschlusskriterium

Kein Lifecycle-Consumer außerhalb der Player-Gameplay-Runtime muss konkrete `resource`, `loadout`, `burrow` oder `heldAction`-Child-Systeme kennen.

### Automatisierter Gate

- Player-/World-Lifecycle-Tests
- Activity-Lifecycle-/Held-Action-Tests
- relevante `Phase11DependencyCutover`-/World-Ownership-Tests nach semantischer Anpassung
- TypeScript Check

---

## Phase 2B – Player-Gameplay Read Views und obere Consumer

### Ziel

Read-only Consumer erhalten kleine fachliche Sichten statt Zugriff auf `WorldPlayerGameplayRuntime.systems`.

### Aufgaben

1. Read-Contracts definieren, bevorzugt nach Verbrauchergruppe statt als neuer Mega-Port:
   - Loadout-/Equipped-Read
   - Resource-Read
   - Player-State/Burrow-Read
   - Prediction-/HUD-Read
   - Construction/Persistent-Base-relevante Read-Sicht
   - spezielle Snapshot-/Presentation-Reads nur wo tatsächlich benötigt
2. Migrieren:
   - `ArenaRuntimeAdapters`
   - `ArenaRuntime`
   - read-only Teile des `ArenaPersistentBaseSession`
   - `RockVisualHelper`
   - Weapon-Balance-Lab-Adapter
   - weitere obere Consumer aus Phase 1
3. Keine Consumer sollen neue konkrete Child-Systeme zwischenspeichern.
4. Source-Ratchet ergänzen:
   - neue direkte `.systems`-Zugriffe außerhalb des Runtime-/Composition-Inneren verboten.

### Designregel

Nicht ein `PlayerGameplayFacade` mit dutzenden Methoden für alle Verbraucher erzeugen. Kleine, benannte Views dürfen von derselben Runtime implementiert werden.

### Abschlusskriterium

Obere Scene-/Runtime-/Adapter-Consumer lesen Player-Gameplay über öffentliche fachliche Contracts.

### Automatisierter Gate

- betroffene Adapter-/Runtime-Contract-Tests
- HUD-/Prediction-Reads soweit testbar
- Source-Ratchet für neue `.systems`-Leaks
- TypeScript Check

---

## Phase 3A – Host-Zeit für Action- und Request-Pfad

### Ziel

Fachliche Player-Aktionen verwenden ausschließlich hostseitige Zeit.

### Aufgaben

1. Einen expliziten hostseitigen `nowMs`-Wert am Action-/RPC-Adapter bestimmen.
2. `RpcCoordinator` darf `clientNow` nicht mehr als autoritative Cooldown-/Commit-Zeit an den Gameplay-Core weiterreichen.
3. `clientNow` darf nur erhalten bleiben, wenn es weiterhin für:
   - Prediction,
   - Diagnose,
   - Latenzbezug
   benötigt wird.
4. Request-/Attempt-Datentypen so benennen, dass Host-Zeit nicht mit Client-Zeit verwechselt werden kann.
5. Held Actions weiter über `HostHeldActionSystem` und Host-Zeit führen.
6. Tests für Clock-Skew ergänzen:
   - extrem alte/neue Client-Zeit darf Host-Cooldown/Commit nicht manipulieren.

### Wichtig

Die aktuelle `clientX`/`clientY`-Semantik wird in dieser Phase **nicht** stillschweigend geändert. Zeit-Authority und Positions-/Latency-Semantik sind zwei verschiedene Entscheidungen.

### Nicht tun

- keine globale Clock
- kein vollständiges Networking-Redesign

### Abschlusskriterium

Kein autoritativer Player-Action-Commit hängt von `clientNow` ab.

### Automatisierter Gate

- RPC-/Weapon2-Prediction-Tests
- Held-Action-Tests
- neuer Clock-Skew-Test
- TypeScript Check

---

## Phase 3B – Resource-System und Player-Readiness auf explizite Zeit umstellen

### Ziel

Player-Gameplay-bezogene Resource-/Readiness-Logik enthält keine versteckte Wanduhr.

### Aufgaben

1. `ResourceSystem` für fachliche Zeit explizit machen:
   - Resource Drain mit `nowMs`
   - Regen-Pause mit `nowMs`
   - Regen-Tick mit `nowMs`/`deltaMs` gemäß kleinstem sinnvollen Vertrag
2. Relevante Player-Gameplay-Aufrufer migrieren.
3. Versteckte `Date.now()`-Defaults in Loadout-/Held-Item-/Behavior-Reads identifizieren und im ersten Scope durch explizite Zeit ersetzen.
4. Item-lokale Readiness dort lassen, wo sie fachlich hingehört:
   - `BaseWeapon`
   - `BaseUtility`
   - Temporary Utility Instance
   - benannter Behavior-Owner
5. Commit-Reihenfolge testseitig festhalten:
   - Check
   - Execution/Acceptance
   - Resource/Cooldown/Charge-Commit genau gemäß Ability-Semantik
6. Keine zentrale Readiness-Wahrheit einführen.

### Abschlusskriterium

Action-/Resource-/Readiness-Pfade des ersten Cutovers verwenden explizite fachliche Zeit.

### Automatisierter Gate

- ResourceSystem-Tests
- Cooldown-/Temporary-Utility-Tests
- relevante Weapon-/Utility-Use-Tests
- Source-Check auf verbotene neue `Date.now()` in den migrierten Player-Gameplay-Dateien

---

## Phase 4A – Shared Immediate Weapon Execution Capability

### Ziel

Der bestehende `WeaponFireExecutor` wird zur kleinen gemeinsamen Ausführungsgrenze für sofortige Shared-Fire-Semantik. Er bleibt oberhalb der unveränderten Projectile-/Combat-Legacy.

### Zielbild

```text
Player / Enemy / Turret / Ally source
              |
              v
      WeaponExecutionCapability
              |
      +-------+---------+
      |                 |
WeaponFireExecutor   Spezialadapter
      |                 |
      +-------> ProjectileManager / CombatSystem (Legacy)
```

### Aufgaben

1. Einen World-owned oder world-composed Execution-Owner/Port einführen, der:
   - `WeaponFireExecutor` besitzt oder bereitstellt,
   - dessen `WeaponFireSink` einmalig mit vorhandenen Projectile-/Combat-Senken verdrahtet,
   - keine Player-Resource-/Loadout-Autorität besitzt.
2. Gemeinsame Immediate-Fire-Fälle über diese Capability abbilden:
   - Projectile
   - Hitscan
   - Melee
3. Bestehende Metadaten unverändert transportieren:
   - owner/source
   - `sourceSlot`
   - `shotId`
   - muzzle origins
   - turret/source IDs
   - direct/payload damage multipliers
   - attribution-relevante Payload-Metadaten
4. `LoadoutManager` darf für Player-Fire zunächst noch delegieren, aber der Executor selbst gehört nicht mehr logisch dem Loadout.
5. Keine Projectile-internen Regeln in den neuen Owner ziehen.

### Nicht tun

- kein neuer Projectile Runtime
- kein allgemeiner `ExecutionContext` mit unbounded optional fields
- kein Universal-Ability-Executor

### Abschlusskriterium

Es existiert genau eine explizite gemeinsame Immediate-Weapon-Execution-Capability, die unabhängig vom Player-Loadout verwendbar ist.

### Automatisierter Gate

- `WeaponFireExecutor`-Tests
- Projectile/Hitscan/Melee-Contract-Tests
- Automated Pellet / Inspector Support / Reinforcement-bezogene Tests soweit betroffen
- TypeScript Check

---

## Phase 4B – Automatisierte und nicht-playergebundene Waffenquellen migrieren

### Ziel

Gegner, Türme und andere automatische Quellen feuern nicht mehr über `LoadoutManager`.

### Aufgaben

Alle Call-Sites aus Phase 1 prüfen und migrieren, mindestens:

- `CoopDefenseEnemyAttackSystem`
- Turret-Fire-Pfad in der World-/Combat-Komposition
- `NecromancySystem`
- Void-Hunter-/Gauss-Automatik
- weitere Konstrukte/Allies/automatische Quellen

### Regeln

- Enemy-eigene Cooldowns/Salven bleiben im Enemy-Owner.
- Turret-eigene Cooldowns bleiben im Turret-/Construction-Owner.
- Die Execution-Capability entscheidet nicht, **wann** eine automatische Quelle feuern darf.
- Source-/Owner-/Allegiance-/Attribution-Informationen bleiben erhalten.
- Spezialfälle, die nicht ehrlich in `WeaponFireExecutor` passen, erhalten einen benannten kleinen Adapter.

### Cleanup

Sobald alle Consumer migriert sind:

- `fireAutomatedWeapon` aus `LoadoutManager` entfernen.
- `fireAutomatedGaussWeapon` entfernen oder in den passenden spezialisierten Execution-Port verschieben.
- Activity-Kompositionen dürfen keinen `LoadoutManager` mehr nur zum Feuern automatischer Waffen erhalten.

### Abschlusskriterium

`LoadoutManager` ist kein Shared-Fire-Service für Nicht-Player mehr.

### Automatisierter Gate

- Enemy attack tests
- Turret fire tests
- Necromancy tests
- Void Hunter tests
- Automated weapon tests
- `npm run check`

---

## Phase 4C – Spezialisierte Immediate-Execution-Adapter

### Ziel

Player-spezifische oder gemeinsame Spezial-Fire-Typen verlassen schrittweise den `LoadoutManager`, ohne ein Projectile-Refactoring zu beginnen.

### Kandidaten

Mindestens prüfen:

- Flamethrower
- Leaf Blower
- Reinforcement Matrix
- Energy Injector
- weitere im `LoadoutManager` verbliebene unmittelbare Spezial-Fire-Typen

### Aufgaben

1. Für jeden Typ entscheiden:
   - passt ehrlich in Shared `WeaponFireExecutor`,
   - oder braucht einen benannten spezialisierten Execution-Adapter.
2. Spezialadapter dürfen direkt vorhandene Legacy-Senken verwenden.
3. Config → Execution-Auftrag darf verschoben werden. Für neue oder ohnehin berührte Fire-Spezialwerte gilt die Config-Lokalitätsregel aus Architektur § 9: bevorzugt typisierte diskriminierte `WeaponFireConfig`-Zweige statt weiterer loser Top-Level-Felder in `WeaponConfigShape`; bestehende unabhängige Legacy-Felder werden nicht flächig migriert.
4. Resource/Cooldown/Commit bleibt **außerhalb** der Execution-Adapter.
5. Kein Adapter hält Player-Lifecycle-State, wenn er nur einen Fire-Auftrag transformiert.

### Nicht tun

- keine Payload-Verarbeitung aus `ProjectileManager` herausziehen
- keine Treffer-/Schadenspipeline migrieren
- keine Generalisierung nur weil mehrere Adapter `spawnProjectile` aufrufen

### Abschlusskriterium

Der spätere Player-Action-Owner kann alle unmittelbaren Weapon-Fälle über kleine Execution-Capabilities auslösen, ohne selbst ProjectileManager/CombatSystem zu kennen.

### Automatisierter Gate

- spezialisierte Waffen-Tests
- Support-Weapon-Tests
- vorhandene Projectile-Contract-Tests der betroffenen Payloads
- TypeScript Check

---

## Phase 5 – Construction-/Management-Readiness aus dem Loadout lösen

### Ziel

Construction- und Management-Cooldowns gehören nicht mehr dem Player-Loadout.

### Aufgaben

1. `constructionCooldowns` aus `LoadoutManager` in den passenden World-Construction-Owner verschieben.
2. `managementActionCooldowns` ebenfalls aus dem Loadout lösen.
3. Die Lifetime ausdrücklich prüfen:
   - nicht versehentlich room-langlebig machen, wenn der Zustand bisher World-/Player-langlebig war.
4. `ConstructionWorldRuntime` oder ein kleiner, dort besessener Readiness-Owner wird Source of Truth.
5. `ArenaPersistentBaseSession` erhält nur den benötigten Construction-/Management-Port.
6. Dismantle/Reposition/Build verwenden explizite Host-Zeit.
7. Alte Loadout-Methoden nach Consumer-Cutover entfernen.

### Designregel

Persistent-Base-Session bleibt Room-Owner für persistente Basisdaten. Ein kurzfristiger Action-Cooldown wird nicht nur aus Bequemlichkeit dort gespeichert.

### Abschlusskriterium

Construction-/PB-Management-Readiness ist fachlich dort verankert, wo die Aktion lebt, und nicht im Loadout.

### Automatisierter Gate

- Construction-/Placement-Tests
- Persistent-Base-Reposition/Dismantle-Tests
- Cooldown-Tests
- TypeScript Check

---

## Phase 6A – Player Action Runtime: Request, Resolution und Weapon Activation

### Ziel

Eine World-owned Player-Action-Grenze übernimmt den hostautoritativen Start einer Player-Aktion.

### Zielverantwortung

Der neue Owner beantwortet:

- darf dieser Actor diese Kategorie aktuell versuchen?
- welche konkrete Ability-/Tool-Instanz ist gemeint?
- welcher Attempt ist das?
- welche Readiness/Resource muss geprüft werden?
- welche Execution-/Behavior-Capability wird aufgerufen?
- wann gilt die Aktion als committed?

### Aufgaben

1. Einen fokussierten Player-Action-Owner einführen.
2. Einen semantischen Request definieren mit:
   - player/actor id
   - action category / slot / tool identity
   - Attempt-Identität, soweit bereits transportiert
   - aim/target Daten
   - host `nowMs`
   - ability-spezifischen Parametern
3. Weapon1/Weapon2 als erste Kategorie vollständig migrieren.
4. Equipped Weapon über den Loadout-Read-Owner auflösen.
5. Readiness/Resource prüfen.
6. Shared/specialized Execution-Capability verwenden.
7. Weapon-spezifische Commit-Reihenfolge erhalten.
8. Slot-Claim-/Channel-Wechsel-Semantik explizit aus dem bisherigen `LoadoutManager.fireWeapon` übernehmen.
9. `shotId` bleibt Execution-/Shot-Identität und wird nicht mit Attempt/Prediction vermischt.
10. `clientX`/`clientY`-Semantik über einen explizit benannten Request-/Position-Policy-Schritt erhalten; keine unbemerkte Autoritätsänderung.

### Übergang

Utility und Ultimate dürfen nach dieser Phase noch one-way an den alten Pfad delegieren. Für Weapon1/Weapon2 existiert jedoch nur noch **ein** mutierender Action-Pfad.

### Nicht tun

- kein universeller Action-Graph
- keine Utility-/Ultimate-Generalisierung erzwingen
- keine Combat-/Projectile-Neuimplementierung

### Abschlusskriterium

Hostautoritative Player-Waffenaktionen beginnen und committen im neuen Player-Action-Owner.

### Automatisierter Gate

- Weapon1/Weapon2 use tests
- resource/cooldown tests
- spread/shot identity tests
- origin/client position characterization tests
- targeted prediction tests
- TypeScript Check

---

## Phase 6B – RPC-, Held-Action- und Weapon2-Prediction-Cutover

### Ziel

Netzwerkadapter übersetzen Wire Requests in Player Actions; fachliche Action-Orchestrierung liegt nicht mehr im `RpcCoordinator`.

### Aufgaben

1. `ArenaRpcPorts` auf einen semantischen Player-Gameplay-/Action-Port umstellen.
2. `RpcCoordinator` behält:
   - Wire Parsing
   - Sender-/World-Revision-Prüfung
   - NetworkBridge-Dedupe
   - Response Encoding
3. `RpcCoordinator` gibt ab:
   - fachliche Slot-/Ability-Entscheidung
   - Resource-/Cooldown-Entscheidung
   - Held-Action-Commitlogik soweit sie Ability-semantisch ist
4. Held Action start/cancel/consume ausschließlich über die Player-Gameplay-Grenze ansprechen.
5. `HostHeldActionSystem` bleibt interner Owner.
6. Weapon2-Prediction:
   - Prediction ID bleibt Network-/Client-Optimierungsidentität.
   - Retry desselben Requests bleibt duplicate-safe und darf höchstens einmal die zugehörige autoritative Commit-Mutation auslösen.
   - authoritative adrenaline value + revision bleiben konsistent.
7. Rejected Requests dürfen keine Resource-/Cooldown-/Charge-Mutation hinterlassen.

### Abschlusskriterium

Der RPC-Layer kennt keine konkreten Player-Gameplay-Child-Systeme mehr und entscheidet keine fachliche Weapon-Activation.

### Automatisierter Gate

- `Weapon2PredictionDedupe`
- `RadialActionRpc`
- Held Action tests
- WorldRevision/RPC tests
- `npm run check`

---

## Phase 7A – Utility Activation und Temporary Utilities

### Ziel

Utility-Aktivierung verlässt den `LoadoutManager`; Temporary Utility Identity und Bestand bleiben sauber getrennt.

### Aufgaben

1. Equipped Utility und Temporary Utility über dieselbe Player-Action-Grenze adressieren, aber ihre Identitäten getrennt halten.
2. `TemporaryUtilityCollection` als bestehenden State-Owner weiterverwenden.
3. Utility-Typen nach Semantik zu Execution-/Behavior-Capabilities routen:
   - einfache Immediate Utility
   - Charged Throw
   - Translocator
   - Decoy
   - Stink Cloud
   - Time Bubble
   - Nuke
   - Construction/Placement
   - weitere vorhandene Typen
4. Charged Utility:
   - Held Action Identity validieren,
   - hostseitig Charge bestimmen,
   - Commit ist pro Attempt-Identität at-most-once / duplicate-safe.
5. Temporary Utility:
   - Charges/Cooldown erst nach erfolgreichem Commit fortschreiben,
   - `instanceId` erhalten,
   - Objective-Placement-Instanzen nicht auf `utilityId` reduzieren.
6. Objective-Activity erhält einen kleinen Temporary-Utility-Port statt konkretem `LoadoutManager`.
7. Construction bleibt eigener Use-Case; Player Action ruft dessen Capability auf, statt Construction in Loadout zu ziehen.
8. Alte Utility-Dispatch-Hooks im `LoadoutManager` nach Cutover entfernen.

### Abschlusskriterium

Keine Utility wird fachlich über `LoadoutManager.use` ausgeführt.

### Automatisierter Gate

- TemporaryUtilityLifecycle
- Radial Action Input/RPC
- Translocator tests
- Decoy/StinkCloud/TimeBubble/Nuke tests
- Construction/Objective utility tests
- TypeScript Check

---

## Phase 7B – Ultimate Behavior: Buff-/Armageddon-Familie

### Ziel

Langlebige Buff-Ultimate-Zustände verlassen den Loadout-Owner.

### Aufgaben

1. Den bisherigen `ultimateStates`-Block nach tatsächlicher Semantik zerlegen.
2. Buff-/Armageddon-Lifecycle in einen benannten Player-Ultimate-/Behavior-Owner verschieben.
3. Explizit abbilden:
   - start
   - commit
   - Rage-Verbrauch / Drain
   - Ticks
   - Aura-Linger
   - end/cancel
   - player remove
   - world destroy
4. `WorldSupportGameplayRuntime` stellt benötigte Armageddon-Capability bereit, statt Handler in `LoadoutManager` zu setzen.
5. Activity/World-Zeit bleibt explizit.
6. HUD-/Net-State wird aus dem neuen Behavior gelesen/projiziert.

### Abschlusskriterium

Buff-/Armageddon-Ultimates besitzen keinen Lifecycle-State mehr im Loadout.

### Automatisierter Gate

- Ultimate/Buff/Armageddon tests
- resource/rage tests
- lifecycle teardown tests
- TypeScript Check

---

## Phase 7C – Ultimate Activation: Airstrike, Tunnel und Gauss

### Ziel

Die übrigen Ultimate-Typen erhalten ability-spezifische Commit-Semantik außerhalb des Loadouts.

### Aufgaben

1. Airstrike:
   - Target/Readiness prüfen
   - Support-Capability aufrufen
   - Rage erst gemäß tatsächlicher Acceptance/Commit-Semantik verbrauchen
2. Tunnel:
   - Placement bleibt Construction-/Tunnel-Owner
   - Player Action hält nur Activation/Commit
3. Gauss:
   - Charge-/Held-Semantik explizit
   - Execution über passenden Shared-/Specialized-Port
4. Cancellation/teardown pro Ability explizit.
5. `WorldSupportGameplayRuntime` und Construction/Tunnel-Runtime dürfen keine Setter in `LoadoutManager` mehr benötigen.
6. Nach Abschluss:
   - `LoadoutManager.use` entfernen, sofern keine Kategorie mehr daran hängt,
   - allgemeine Ultimate-Dispatch-/Lifecycle-Methoden aus Loadout entfernen.

### Abschlusskriterium

Alle Player-Action-Kategorien laufen über den neuen Player-Action-/Behavior-Pfad.

### Automatisierter Gate

- Airstrike tests
- Tunnel tests
- Gauss tests
- Held Action tests
- Rage/commit tests
- `npm run check`

---

## Phase 8A – AK47 Behavior extrahieren

### Ziel

AK47 Focus / Fire Superiority wird ein eigener zustandsbehafteter Weapon-Behavior-Owner.

### Aufgaben

1. Migrieren:
   - stacks
   - available/pending Fire-Superiority shots
   - shot identity
   - confirmed hits
   - strategic target refund
   - reset semantics
   - HUD buffs
2. `Ak47StrategicTargetSystem` erhält einen kleinen AK47-/Loadout-Read-Port statt konkretem `LoadoutManager`.
3. Projectile-/Combat-Callbacks melden nur semantische Outcomes an den Behavior-Owner.
4. Duplicate-safe At-most-once-Refund- und Resolve-Semantik erhalten.
5. Keine Projectile-Payload-Architektur neu bauen.

### Abschlusskriterium

Im Loadout existiert kein mutable AK47-Combat-State mehr.

### Automatisierter Gate

- AK47 focus/fire-superiority tests
- strategic target tests
- projectile hit/resolve tests
- HUD buff tests
- TypeScript Check

---

## Phase 8B – Negev Behavior extrahieren

### Ziel

Negev Killstreak und dessen End-/Explosion-Reaktion werden ein eigener Weapon-Behavior-Owner.

### Aufgaben

1. Migrieren:
   - kill count
   - last successful shot time
   - gap/termination
   - damage multiplier contribution
   - heal/armor on kill
   - final explosion
   - fire-chunk request
   - HUD state
2. Correlation/Timing verwendet explizite Host-Zeit oder lokale monotone Sequenz; kein `Date.now()` im Behavior.
3. Combat-Kill-Outcome wird als semantisches Event eingespeist.
4. Player remove / loadout switch / world teardown klären.

### Abschlusskriterium

Im Loadout existiert kein Negev-Killstreak-State mehr.

### Automatisierter Gate

- Negev behavior tests
- kill reaction tests
- explosion/fire chunk contract tests
- teardown tests
- TypeScript Check

---

## Phase 8C – Shotgun Lightning und generische Weapon-Reactions

### Ziel

Kill-/Hit-Reaktionen, die keine Loadout-Verantwortung sind, verlassen den Loadout-Owner.

### Aufgaben

1. Shotgun Lightning Queue in eigenen Behavior-/Reaction-Owner verschieben.
2. Generation-/Chain-Semantik erhalten.
3. Explosion-/Damage-Ausführung über bestehende Combat-/Effect-Capabilities.
4. Generische weapon-config-getriebene Kill-Reaktionen prüfen:
   - heal
   - adrenaline
   - weitere bestehende Trigger
5. Nur wirklich gemeinsame, config-getriebene einfache Reaktionen teilen.
6. Spezialmechaniken bleiben benannte Behaviors.

### Abschlusskriterium

`LoadoutManager.handleKill` ist entfernt oder auf reine Loadout-Verantwortung reduziert; mutable Shotgun-Reaktionsqueues liegen nicht im Loadout.

### Automatisierter Gate

- shotgun lightning tests
- kill heal/adrenaline tests
- combat kill callback tests
- TypeScript Check

---

## Phase 9 – Sustained Weapon Behavior: Tesla Dome und Energy Shield

### Ziel

Sustained/refresh/stop-Orchestrierung wird von Loadout-Auflösung getrennt.

### Aufgaben

1. Slot-Claim-/Switch-Semantik aus dem Loadout herauslösen.
2. Tesla Dome:
   - start/refresh
   - resource gate
   - stop/deactivate
   - autonomous-vs-channel Semantik
3. Energy Shield:
   - press/start/refresh
   - resource gate
   - stop/deactivate
4. Die bestehenden Tesla-/Energy-Shield-Systeme bleiben ihre fachlichen Effektowner.
5. Player Action/Behavior spricht sie über kleine Capabilities an.
6. Loadout Switch/Player Remove/World Destroy stoppt nur Effekte, deren Semantik dies verlangt.
7. Netzwerk-/Presentation-Details verbleiben in bestehenden geeigneten System-/Adapter-Grenzen; kein neues Visual-Subsystem.

### Abschlusskriterium

`LoadoutManager` orchestriert keine sustained Weapon-Lifecycles mehr.

### Automatisierter Gate

- Tesla Dome tests
- Energy Shield tests
- slot switching/channel tests
- player remove/world teardown tests
- TypeScript Check

---

## Phase 10A – LoadoutManager auf echten Loadout-Owner reduzieren

### Ziel

Nach den vorangegangenen Kategorie-Cutovers wird der `LoadoutManager` physisch und semantisch auf seine Zielverantwortung reduziert.

### Soll-Verantwortung

- equipped slot state
- selection/sanitization
- effective config resolution
- BaseWeapon/BaseUtility-Objekte, soweit sie echte item-lokale Readiness/Spread besitzen
- Temporary Utility Collection / availability
- held-item/read-only slot state, falls dieser State fachlich weiterhin hier passt
- Aim-/Spread-Read, soweit es direkt aus equipped Weapon state stammt

### Zu entfernen

Soweit nach den vorherigen Phasen noch vorhanden:

- Action dispatch
- Resource commit orchestration
- Ultimate lifecycle
- Construction-/management cooldowns
- shared automated fire
- AK47 state
- Negev state
- Shotgun reaction queue
- Tesla/EnergyShield orchestration
- WorldSupport handler setters
- Construction handler setters
- Combat-/Physics-Use-Case-Abhängigkeiten, die nur Execution dienten

### Aufgaben

1. Alle verbliebenen Felder nach Owner/Lifetime/Authority prüfen.
2. Tote Setter/Callbacks entfernen.
3. Loadout Public API auf echte Read-/Mutation-Operationen reduzieren.
4. Call-Sites und Tests auf Ziel-API migrieren.
5. Große alte private Methoden löschen, nicht als "legacy helper" behalten.

### Abschlusskriterium

Dateigröße ist kein hartes Gate; entscheidend ist, dass der Loadout-Owner nur noch seine fachliche Verantwortung besitzt.

### Automatisierter Gate

- Loadout selection/config/readiness tests
- temporary utility tests
- aim/spread tests
- Source-Ratchet auf verbotene alte Methoden
- TypeScript Check

---

## Phase 10B – Direkten NetworkBridge-Zugriff aus Loadout-/Ability-Core entfernen

### Ziel

`LoadoutManager` und neu entstandene Player-Action-/Behavior-Owner kennen keinen konkreten `NetworkBridge`.

### Aufgaben

1. `NetworkBridge` aus `LoadoutManager`-Constructor und Import entfernen.
2. Game-Mode-/Selection-Kontext über fachliche Parameter oder kleine Read-Ports liefern.
3. `WorldPlayerGameplayNetworkPort.teams.isEnemyPair` aus der Network-Port-Semantik entfernen. Gameplay konsumiert dafür den im Contract Manifest definierten `PlayerRelationshipPort`. Während dieses Refactorings darf dessen Composition-Adapter **vorläufig** auf die bestehende `NetworkBridge.isEnemyPair`-Implementierung delegieren; dadurch wird nur die fachliche Abhängigkeitsrichtung korrigiert, nicht die Relationship-Regel selbst neu erfunden. Kein neuer globaler `RelationshipManager`.
4. Projection-/Publication nach außen verlagern:
   - utility cooldown projection
   - temporary utility descriptors
   - held utility/item projection
   - sonstige verbliebene Network-State-Publikation
5. Keine fachliche Source of Truth in den Adapter verschieben.
6. Neue Action-/Behavior-Owner auf direkte Bridge-Abhängigkeiten prüfen.
7. Frozen-legacy-consumer-Ratchet aktualisieren:
   - `LoadoutManager` fällt aus der Liste.
   - Die Liste darf durch dieses Refactoring nicht wachsen.
8. `docs/ai/networking.md` erst im finalen Knowledge-Writeback aktualisieren; normative 01/02 bleiben unangetastet.

### Abschlusskriterium

Loadout-/Ability-Core ist transportagnostisch; Relationship-Reads hängen fachlich am `PlayerRelationshipPort` und nicht mehr an einem als Network-Verantwortung benannten `teams.isEnemyPair`-Port.

### Automatisierter Gate

- `WorldGameplayCompositionContracts`
- NetworkBridge consumer source-ratchet
- temporary utility projection tests
- loadout selection tests
- `npm run check`

---

## Phase 11A – PlayerCombatIntegration: Reads, Modifier und Resource-Semantik

### Ziel

`WorldCombatGameplayBinding` kennt keine `WorldPlayerGameplaySystems`-Struktur mehr.

Diese Phase refactort **nicht** den `CombatSystem`; sie ersetzt nur dessen Zugriff auf den Player-Gameplay-Graphen.

### Aufgaben

Einen expliziten `PlayerCombatIntegrationPort` oder mehrere kleine semantische Ports einführen für Reads wie:

- Player Modifier resolution
- equipped weapon-derived defense/offense values
- item-derived conditional modifiers
- Resource mutations/reads, die Combat auslösen darf
- Burrow-/Player-State reads
- class/build-derived values
- loadout/config reads, soweit Combat sie wirklich braucht

### Regeln

- Keine Getter wie `getLoadoutManager()` oder `getSystems()`.
- Der Port beschreibt Gameplay-Semantik, nicht konkrete Klassen.
- Combat bleibt Owner seiner Treffer-/Damage-Auflösung.
- Player-Gameplay bleibt Owner seiner Build-/Behavior-/Resource-Zustände.
- Kein vollständiger `Math.random`-/Combat-Time-Cutover in dieser Phase.

### Abschlusskriterium

Die Read-/Modifier-Seite des Combat-Bindings arbeitet ausschließlich über semantische Player-Gameplay-Ports.

### Automatisierter Gate

- `WorldCombatGameplayBinding.test.ts`
- modifier/resource integration tests
- world composition contract tests
- TypeScript Check

---

## Phase 11B – PlayerCombatIntegration: Hit/Kill/Outcome-Reaktionen

### Ziel

Combat meldet semantische Outcomes an Player-Behaviors, ohne konkrete Loadout-/Item-/Weapon-Behavior-Systeme zu kennen.

### Aufgaben

Ports/Events für tatsächlich benötigte Reaktionen definieren, z. B.:

- direct primary hit
- projectile resolved / specialized hit outcome
- damage taken
- damage dealt
- player kill / enemy kill
- player death/unavailable
- burn-/flame-bezogene Reaktion
- AK47 resolve/refund
- Negev/Shotgun/generic kill reaction
- item runtime reaction

### Regeln

- Nur Events einführen, die mindestens einen realen Consumer besitzen.
- Keine globale Event-Bus-Abstraktion.
- Reihenfolge gegenüber dem bestehenden Combat callback flow erhalten.
- At-most-once relevante Reaktionen explizit absichern.
- Projectile-/Combat-Interna nicht in Player-Behavior verschieben.

### Abschlusskriterium

`WorldCombatGameplayBinding` kann Player-Reaktionen auslösen, ohne den konkreten Player-System-Graphen zu kennen.

### Automatisierter Gate

- Combat binding tests
- AK47/Negev/Shotgun behavior tests
- item reaction tests
- death/kill tests
- `npm run check`

---

## Phase 12A – Host Frame auf Player-Gameplay-Stages umstellen

### Ziel

`HostUpdateCoordinator` taktet keine konkreten Player-Gameplay-Child-Systeme mehr.

### Aufgaben

1. Die tatsächliche heutige Frame-Reihenfolge nochmals gegen aktuellen Code kartieren.
2. Kleine Stage-Methoden am Player-Gameplay-Owner einführen, z. B. semantisch:
   - pre-physics player step
   - pre-combat player behavior step
   - post-projectile player behavior step
   - snapshot/read preparation
3. Die konkrete Benennung folgt der realen Reihenfolge; kein generisches Einheits-`update()` erzwingen.
4. Player-Gameplay-Stage darf:
   - Child-Systeme intern takten,
   - reine Daten/Snapshots zurückgeben.
5. Player-Gameplay-Stage darf nicht:
   - Renderer besitzen,
   - Phaser-UI ansteuern,
   - konkrete Activity-Runtime halten.
6. HostUpdate synchronisiert Visuals weiterhin im Presentation-Layer aus zurückgegebenen Read-Modellen.
7. Bestehende relative Reihenfolge zu Physics/Combat/Projectile unverändert testen.

### Abschlusskriterium

`HostUpdateCoordinator` hat keinen `playerSystems`-Getter und keine direkten Ticks konkreter Player-Gameplay-Children.

### Automatisierter Gate

- Host frame/source contract tests
- behavior update order tests
- WorldGameplay composition tests
- performance-metric contract soweit betroffen
- `npm run check`

---

## Phase 12B – Client Frame, HUD und Prediction auf stabile Player-Reads umstellen

### Ziel

`ClientUpdateCoordinator` kennt keine konkreten Player-Gameplay-Child-Systeme.

### Aufgaben

1. Lokale Loadout-/HUD-/Prediction-Reads auf:
   - replizierten Zustand,
   - PlayerGameplayReadView,
   - lokale resolved config
   umstellen – je nachdem, welche Quelle fachlich bereits korrekt ist.
2. Keine host-only Runtime auf dem Client künstlich materialisieren.
3. Weapon2-Prediction vollständig erhalten:
   - pending spends
   - retry
   - authoritative revision
   - rollback/rejection
4. Held-item-/HUD-/cooldown presentation auf stabile Read-Verträge umstellen.
5. `ClientUpdateCoordinator.playerSystems` entfernen.

### Abschlusskriterium

Client-Presentation und Prediction funktionieren ohne Zugriff auf konkrete Player-Gameplay-Owner.

### Automatisierter Gate

- Client prediction tests
- HUD data tests
- held-item tests
- snapshot/interpolation tests soweit betroffen
- TypeScript Check

---

## Phase 12C – Activity-, Support- und Construction-Richtung bereinigen

### Ziel

Nach Player-/Combat-/Frame-Cutover werden die verbliebenen konkreten Abhängigkeiten an den World-/Activity-Grenzen entfernt.

### Aufgaben

1. `CoopMissionComposition` und Sub-Compositions prüfen:
   - kein konkreter `LoadoutManager`, wenn nur Temporary Utility oder Execution benötigt wird.
   - stattdessen kleine Capabilities.
2. `CoopMissionObjectiveComposition` auf Temporary-Utility-Port umstellen.
3. Enemy-Behavior/-Support-Compositions nur mit benötigten Execution-/Read-Ports versorgen.
4. `WorldSupportGameplayRuntime` darf keine Loadout-Setter mehr konfigurieren.
5. `ConstructionWorldRuntime` darf keine Action-Handler in den Loadout injizieren.
6. `ArenaWorldConstructionComposition` darf nicht über `gameplay.player?.systems` an konkrete Children gelangen.
7. `ArenaPersistentBaseSession` benötigt keinen kompletten Player-Gameplay-Systemgraph.
8. Verbliebene externe `WorldPlayerGameplayRuntime.systems`-Zugriffe beseitigen.
9. Wenn `WorldPlayerGameplaySystems` nur noch runtime-intern ist:
   - nicht exportieren oder vollständig durch private interne Struktur ersetzen.

### Abschlusskriterium

Die Player-Gameplay-Runtime ist eine echte Boundary. Kein Activity-/World-/Scene-Consumer behandelt sie als Service Locator.

### Automatisierter Gate

- Activity composition tests
- Objective/Temporary Utility tests
- Construction/Persistent Base tests
- WorldGameplay composition tests
- Source-Ratchet: keine externen `.systems`
- `npm run check`

---

## Phase 13 – Finaler Cleanup, Architektur-Ratchets und Gesamtverifikation

### Ziel

Alle Übergangsreste entfernen und den ersten großen Gameplay-Runtime-Cutover als abgeschlossen verifizieren.

### 13.1 Cleanup

Entfernen:

- tote Loadout-Setter
- tote Callback-Registrierungen
- alte `useLoadout`-Benennung, falls semantisch nur noch historisch
- alte automated-fire APIs im Loadout
- alte `WorldPlayerGameplaySystems`-Exports
- one-way Übergangsdelegationen
- veraltete Tests, die nur die alte Quellcodeposition schützen
- unbeabsichtigte `Date.now()` im migrierten Player-Gameplay-Core
- nicht mehr benötigte direkte konkrete Systemimports in oberen Layern

### 13.2 Architektur-Ratchets

Mindestens absichern:

1. Kein externer Zugriff auf `WorldPlayerGameplayRuntime.systems`.
2. `LoadoutManager` importiert/akzeptiert keinen konkreten `NetworkBridge`.
3. Kein neuer konkreter `NetworkBridge`-Consumer im Domain-Layer.
4. `LoadoutManager` besitzt keine:
   - Ultimate-Lifecycle-Map
   - AK47-State-Map
   - Negev-State-Map
   - Shotgun-Reaction-Queue
   - Construction-/Management-Cooldowns
   - Automated-Weapon-API
5. Activity-Kompositionen erhalten keinen `LoadoutManager` nur für Fire-/Temporary-Utility-Funktionen.
6. Host/Client Coordinator kennen keinen konkreten Player-Child-Systemgraph.
7. Neue Player-Action-/Behavior-Dateien verwenden explizite Host-Zeit.
8. Keine speculative Universal-Ability-/Cooldown-/Commit-Frameworks wurden eingeführt.

### 13.3 Testmigration

Source-Tests werden auf **Zielverträge** umgestellt.

Ein Test wird nicht ersatzlos gelöscht, wenn seine eigentliche Schutzwirkung weiter relevant ist. Beispiel:

- alt: "`ArenaLifecycleCoordinator` enthält keinen konkreten `new ResourceSystem`"
- neu: "`WorldPlayerGameplayRuntime` besitzt Lifecycle und externe Consumer greifen nicht auf Child-Systeme zu"

### 13.4 Knowledge Writeback

Prüfen und bei Bedarf aktualisieren:

- `docs/ai/gameplay.md`
- `docs/ai/networking.md`
- eventuell weitere rein beschreibende `docs/ai/*`

Nicht automatisch ändern:

- `01_Gameplay_Runtime_Architecture_Core.md`
- `02_Gameplay_Runtime_Architecture_Details.md`
- `03_Gameplay_Runtime_Implementation_Plan.md`

Abweichungen von den normativen Dokumenten werden im Status als Review-Kandidat dokumentiert.

### 13.5 Automatisierter Final-Gate

Mindestens:

```bash
npm run check
```

Zusätzlich alle relevanten gezielten Testgruppen für:

- Player Actions
- Held Actions
- Weapon2 Prediction/Dedupe
- Resource/Readiness
- Temporary Utilities
- automated weapons
- Construction/Persistent Base
- Ultimates
- AK47
- Negev
- Shotgun
- Tesla Dome
- Energy Shield
- WorldCombatGameplayBinding
- Host frame
- Client frame
- Activity lifecycle
- World ohne Activity
- World/Activity transitions

### 13.6 Manueller Gate

Die Coding-KI führt ihn **nicht** aus.

Der Status wird auf:

`Automatisierter Cutover abgeschlossen – manueller Gameplay-/Sicht-Gate ausstehend`

gesetzt.

Erst nach der manuellen Prüfung wird das Refactoring vollständig als abgeschlossen markiert.

---

# 8. Test-Migrationsstrategie

## 8.1 Tests nach Semantik statt Quellcodeposition

Bestehende Source-Contract-Tests sind wertvoll, dürfen aber nicht zum Erhalt der alten Architektur zwingen.

Für jede migrierte Regel gilt:

1. Schutzwirkung bestimmen.
2. Neue Zielgrenze bestimmen.
3. Test an neue Grenze verschieben.
4. Erst danach alte Source-Erwartung entfernen.

## 8.2 Besonders schützenswerte Verhaltensverträge

| Vertrag | Warum kritisch |
|---|---|
| Weapon2 retry/dedupe | doppelte Resource-/Shot-Commits |
| Held Action stale consume | verspätete Commit-Nachrichten |
| Temporary Utility `instanceId` | mehrere gleiche Utilities |
| Resource revision | Prediction/Reconciliation |
| host time | Client clock manipulation |
| client position/origin semantics | Latenz-/Authority-Verhalten |
| automated fire metadata | Gegner/Türme/Attribution |
| AK47 shot/refund identity | at-most-once reaction |
| Negev streak end | tatsächlicher erfolgreicher Fire vs. Held Input |
| Ultimate commit | Rage-Verlust bei abgelehnter Ausführung |
| Tesla/Shield stop | langlebige World-Effekte |
| Player lifecycle | World join/leave vs. round respawn |
| Activity transition | World-owned Gameplay darf Activity-Wechsel überleben, wo vorgesehen |

---

# 9. Erwartete Zielabhängigkeiten

Nach Phase 13 soll die Richtung grob so aussehen:

```text
Input / UI
   |
   v
Network/RPC Adapter
   |
   v
WorldPlayerGameplayRuntime
   |
   +--> PlayerActionRuntime
   |       |
   |       +--> Loadout Read/Selection
   |       +--> ResourceSystem
   |       +--> HeldActionSystem
   |       +--> Ability Behaviors
   |       +--> Execution Capabilities
   |
   +--> Player Behaviors
   |       +--> AK47
   |       +--> Negev
   |       +--> Shotgun Reaction
   |       +--> Ultimate Behavior
   |       +--> sustained Weapon Activation
   |
   +--> Player Read / Combat Integration Ports
           |
           +--> Host/Client Frame
           +--> WorldCombatGameplayBinding
           +--> Activity/Construction/Support Adapters

Execution Capabilities
   |
   +--> WeaponFireExecutor
   +--> specialized immediate adapters
   |
   v
ProjectileManager / CombatSystem   [Legacy in diesem Refactoring]
```

---

# 10. Explizite Stop-Kriterien für Coding-KIs

Eine Coding-KI soll die Teilphase beenden und den Sachverhalt in `04` dokumentieren, statt den Scope auszuweiten, wenn:

- ein sauberer Cutover ein vollständiges Projectile-Redesign verlangen würde,
- ein sauberer Cutover ein vollständiges Combat-Redesign verlangen würde,
- eine neue Universalabstraktion nur für einen einzigen echten Consumer nötig wäre,
- die bestehende Semantik ohne Produktentscheidung nicht eindeutig rekonstruierbar ist,
- eine Änderung `clientX`/`clientY`-Authority oder andere Sicherheits-/Latenzsemantik verändern würde,
- eine Activity-/World-Lifetime-Entscheidung nicht aus bestehenden Verträgen/Tests ableitbar ist.

In solchen Fällen wird **kein spekulativer Fix** erfunden. Die KI implementiert den sicheren Teil und dokumentiert den offenen Punkt präzise.

---

# 11. Definition of Done des ersten Gameplay-Refactorings

Der Plan gilt als technisch abgeschlossen, wenn:

- alle Teilphasen 1–13 in `04` als abgeschlossen markiert sind,
- alle Übergangsdelegationen entfernt sind,
- `npm run check` grün ist,
- die Ziel-Ratchets grün sind,
- `LoadoutManager` kein Gameplay-God-Object mehr ist,
- `WorldPlayerGameplayRuntime` kein öffentliches Systemverzeichnis mehr ist,
- Player Action/Commit hostautoritative explizite Zeit verwendet,
- automatische Quellen nicht über Player-Loadout feuern,
- Player-Behaviors eigene Owner besitzen,
- Combat/Projectile nur über stabilisierte obere Verträge konsumiert werden,
- kein vollständiges Projectile-/Combat-Refactoring in diesen Scope gerutscht ist,
- der abschließende manuelle Gameplay-/Sicht-Gate durch den Menschen erfolgt ist.

Danach ist die Architektur bereit für ein **separat geplantes** Projectile-Refactoring und anschließend ein separates Combat-Refactoring.
