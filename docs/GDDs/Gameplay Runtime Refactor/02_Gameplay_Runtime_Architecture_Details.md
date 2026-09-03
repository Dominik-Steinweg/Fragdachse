# Fragdachse – Gameplay Runtime Architecture Details

**Status:** Normative Detailverträge / gezielt zu laden  
**Core-Dokument:** `01_Gameplay_Runtime_Architecture_Core.md`  
**Repository-Abgleich:** Architektur gegen den aktuellen Migrationsstand bis `fcc6e3f5` vom 03.09.2026 gegengeprüft

> Dieses Dokument präzisiert den Architecture Core. Es ist nicht dafür gedacht, bei jeder Implementierungsphase vollständig geladen zu werden. Der spätere Implementierungsplan soll pro Phase die relevanten §§ dieses Dokuments referenzieren.

## 1. Nutzung durch Coding-KIs

Immer zuerst `01_Gameplay_Runtime_Architecture_Core.md` lesen. Danach nur die fachlich betroffenen Detailverträge laden. Für konkrete Implementierungsphasen ist die phasenspezifische §-Zuordnung in `03_Gameplay_Runtime_Implementation_Plan.md` maßgeblich; die folgende Tabelle bleibt der allgemeine Router für Reviews und ungeplante Einzelaufgaben.

| Aufgabe | zusätzlich aus diesem Dokument laden |
|---|---|
| Player-Waffe / Utility / Ability | §§ 8–13 sowie tatsächlich berührte §§ 16–20 |
| Enemy Ability / Special | §§ 13–14, 17–21 |
| Turret / externe Commands / Control | §§ 8.2, 13, 21, 23.1 |
| Projectile-Refactoring | §§ 13, 15–18, 23–24 und bei Migration §§ 26–30 |
| Combat-Refactoring | §§ 15, 17–20 und bei Migration §§ 26–30 |
| Network / RPC / Prediction | §§ 2.7, 8.1, 23 und bei Migration §§ 27–29 |
| World-/Activity-/Player-Lifecycle | §§ 3, 22 und bei Migration §§ 27–29 |
| Architektur-Review | § 37 plus die betroffenen Fachabschnitte |

**Cross-Layer-Regel:** Berührt eine Änderung mehr als eine Gameplay-Grenze, wird zusätzlich immer § 15 `Gesamtbild` geladen.

**Präzedenz:** Der fachlich zuständige Detailvertrag präzisiert die Kurzfassung im Core. Migrationsinvarianten gelten zusätzlich während eines Cutovers. Validierungsfälle illustrieren das Zielbild, erzeugen aber keine neue Architekturpflicht.

---

## 2. Verbindliche Grundentscheidungen

### 2.1 Gameplay-Basis ist fachlich World-scoped

Grundlegende Player-Gameplay-, Projectile- und Combat-Zustände gehören fachlich zur World und dürfen einen Activity-Wechsel innerhalb derselben World überleben.

Activity-spezifische Mechanik bleibt activity-scoped.

### 2.2 Hybrid statt Universal-Ability-System

Player, Enemy und Turret teilen Mechanik nur auf der höchsten Ebene, auf der tatsächlich gemeinsame Semantik besteht.

Einfache Enemy-/Turret-Angriffe müssen nicht durch Player-Loadout oder Player-Activation laufen.

### 2.3 Expliziter Commit Point

Nichttriviale Actions definieren einen fachlichen Commit-Punkt. Er ist der erste autoritative Punkt, ab dem die Action fachlich als erfolgreich begonnen gilt. Ressourcen, Cooldowns und andere verbindliche Folgen werden gemäß der konkreten Ability-Regel daran gekoppelt; seine Position relativ zur technischen Execution ist **nicht universell festgelegt**.

### 2.4 Normatives Zielbild statt vorgezogener Klassendesign

Dieses Dokument legt Owner, Semantik und Abhängigkeitsrichtung fest.

Konkrete Type- und Klassennamen werden erst im jeweiligen Implementierungsplan festgelegt.

### 2.5 Pre-Commit-Lifecycle und Post-Commit-Execution werden getrennt

Eine Verzögerung **vor** dem Commit gehört grundsätzlich zum vorbereitenden Action-/Behavior-Lifecycle und kann gemäß der konkreten Ability-Regel unterbrechbar sein.

Eine bereits committed, aber zeitlich verzögert eintretende One-shot-Wirkung besitzt dagegen eine eigene kleine Execution-Lifetime. Sie hängt nicht implizit davon ab, dass der ursprüngliche Actor oder sein Behavior bis zur Auslösung weiterlebt.

Dadurch gilt als Standard:

- Tod, Stun oder Despawn des ursprünglichen Actors brechen einen bereits committed Effekt nicht rückwirkend ab.
- Post-Commit-Cancellation existiert nur, wenn die konkrete Mechanik sie ausdrücklich authored.
- World-/Activity-Teardown beendet weiterhin jeden State, dessen fachliche Lifetime dort endet.
- Ein Pre-Commit-Abbruch bedeutet nicht automatisch „kostenlos sofort erneut versuchen“: Recovery-/Cooldown-Folgen sind ability-spezifische Regeln und werden explizit modelliert.

### 2.6 Control Delegation überträgt nicht automatisch Gameplay-Ownership

Control Delegation ist ein zulässiger Erweiterungsfall, aber **kein Pflichtbestandteil des ersten Player-Gameplay-Refactorings**.

Wenn Player-Input zeitweise an einen anderen steuerbaren Actor delegiert wird, z. B. an einen übernommenen Turm, wird dessen Loadout nicht in den Spieler kopiert. Der kontrollierte Actor behält seine fachliche Authority für eigene Weapon Config, Readiness, Buffs und Execution; der Player liefert als **Controller** autorisierte Intents.

Die Action-Grenze darf eine spätere Delegation nicht dadurch verbauen, dass Player-Identität, Action Initiator und ausführender Actor irreversibel zu einem einzigen technischen Konzept verschmelzen. Daraus folgt jedoch **kein Auftrag**, vorsorglich einen generischen `ControlContext`, `ActionRouter` oder eine Control-Session-Infrastruktur einzuführen.

Wo Attribution oder Friendly/Hostile-Semantik relevant sind, bleiben Controller, ausführender Actor, aktuelle Attribution, Lineage und Allegiance fachlich unterscheidbar. Sie müssen nicht als universelles Pflichtobjekt durch jeden Aufruf getragen werden.

### 2.7 Relationship und aktiver Gameplay-Kontext sind Domain-Semantik

Network darf Team-, World-, Activity- und ähnliche Deskriptoren transportieren. Es ist jedoch nicht fachliche Authority dafür, ob zwei Actors Freunde oder Gegner sind, welche Targets zulässig sind oder welcher Gameplay-Kontext eine Regel aktiviert.

Diese Entscheidungen werden an World-/Activity-/Gameplay-Grenzen aus den autoritativen Deskriptoren aufgelöst. **Allegiance** beschreibt die aktuelle Friendly-/Hostile-/Neutral-Semantik eines Actors oder Effekts; eine **Relationship-Policy** kann daraus zusammen mit World-/Activity-Regeln die Beziehung zwischen zwei Beteiligten bestimmen. `Faction` ist davon getrennt: Falls eine Mechanik eine taxonomische Zugehörigkeit wie Player, Zombie oder andere Gruppen benötigt, darf sie als eigenes Domain-Konzept existieren. Der heutige Code verwendet `faction` an einzelnen Stellen noch für Allegiance-artige Semantik; diese Benennung ist kein Zielvertrag.

Der heutige `NetworkBridge` mit `isEnemyPair()` und `getActiveGameMode()` ist dafür ein Legacy-Migrationsanker, nicht das langfristige fachliche Ziel. Daraus folgt kein Auftrag, im ersten Cutover einen neuen globalen Relationship- oder GameMode-Manager einzuführen. Neue Domain-Owner sollen solche Regeln jedoch nicht erneut als Transportverantwortung etablieren.

# Teil A – Ownership und Grundmodell

## 3. Ownership, Authority und Lifetime

Die Architektur folgt dem bereits etablierten Fragdachse-Prinzip:

> **Ownership folgt Lifetime. Update folgt Ownership. Teardown folgt tatsächlichem Besitz.**

| Bereich | Ziel-Owner | fachliche Lifetime | Authority |
|---|---|---|---|
| Player Loadout / Ability State / Resources | Player-/World-Gameplay | World / Player-in-World | Host |
| optionale Player→Actor Control Session | passender Player-/Actor-Binding-Owner | Control Session innerhalb der World | Host |
| Projectile Simulation | World-Gameplay | World | Host |
| committed Deferred One-shot Effects | kleinster semantisch passender World-/Activity-Owner | bis Trigger / Teardown des fachlichen Scopes | Host |
| gemeinsame Combat-/Damage-Resolution-Regeln | Combat / World-Gameplay | World | Host |
| Player-/Enemy-Health und Armor | jeweiliger kanonischer Combatant-/Entity-Owner | Actor-in-World | Host |
| Base-/Construction-/Rock-/Train-Health | jeweiliger World-/Entity-Owner | World / Entity | Host |
| allgemeiner Target-/World-Status | kleinster fachlich passender Target-/World-Owner | World / Target-Lifetime | Host |
| allgemeine Turret-Mechanik | Construction / World | World | Host |
| activity-spezifisches Enemy Behavior | Activity | Activity | Host |
| Missionsregeln / Objectives | Activity | Activity | Host |
| World-Geometrie / Placeables | World | World | Host |
| World-Presentation | World-Presentation | World / expliziter Handoff | keine Gameplay-Authority |
| Activity-Presentation | Activity-Presentation | Activity | keine Gameplay-Authority |
| Replication | Network-Adapter | Lifetime des replizierten Owners | keine Gameplay-Authority |
| dauerhafte Progression | Meta / Persistence | außerhalb der Gameplay-World | persistenter Owner |

### 3.1 Fachliche Lifetime ≠ zwingend physische Objekt-Lifetime

Im heutigen Code existieren scene-langlebige Core-Instanzen wie `ProjectileManager` und `CombatSystem`, deren World-spezifischer Zustand über world-scoped Bindings installiert und beim Teardown wieder entfernt wird.

Deshalb bedeutet „Projectile/Combat sind world-scoped“ **nicht zwingend**, dass jede physische Instanz bei jedem World-Wechsel neu konstruiert werden muss.

Normativ ist:

- World-spezifischer mutable State gehört genau einer World.
- Eine zerstörte World hinterlässt keine Callback-, Geometry-, Target-, Player- oder Projectile-Bindings.
- Stale Bindings sind inert.
- Ein scene-langlebiges Engine-/Facade-Objekt ist zulässig, wenn seine World-Bindings explizit und vollständig sind.
- Ob spätere Refactorings auch die physische Instanz World-owned machen, ist Implementierungsdetail.

Damit bleibt das Zielbild kompatibel mit `WorldScopedBinding`, ohne Legacy-Objektlifetimes zum fachlichen Ideal zu erklären.

### 3.2 World-scoped bedeutet nicht global

World-scoped Systeme dürfen einen Activity-Wechsel derselben World überleben.

Sie dürfen nicht:

- State zwischen World-Instanzen teilen,
- Activity-State implizit halten,
- eine zerstörte World beeinflussen.

Activity-scoped bleiben insbesondere Missionziele, Encounter, activity-spezifische Gegner und Missionsabschluss.

Innerhalb des Player-Gameplays gilt dasselbe Prinzip feiner: State gehört dem kleinsten semantisch passenden Owner – z. B. Player-in-World, Equipped Ability, einzelne Action/Activation oder ein nach Commit weiterlebender Sustained Effect. Ein kleinerer Lifetime-State wird beim Ende genau dieser Lifetime vollständig beendet.

### 3.3 Player-in-World ist eine eigene Lifetime

Join/Participation, Leave/Disconnect und Respawn sind nicht dieselbe Lifecycle-Grenze. Player-in-World-State wie Resources, Loadout-/Item-Runtime-State oder andere world-lokale Player-Bindings wird beim Eintritt gezielt attached und beim endgültigen Verlassen der World vollständig detached. Ein Respawn ersetzt dagegen grundsätzlich nur actor-/life-spezifischen Zustand und erzeugt nicht automatisch einen neuen Player-in-World.

Der bestehende `PlayerWorldRuntimeComposition`-Pfad ist dafür ein wertvoller Migrationsanker. Das Refactoring soll diese per-Player Attach-/Detach-Semantik schützen und nicht durch reinen World-Teardown ersetzen.

---

## 4. Hybrid statt Universal-Ability-System

> **Eine Quelle steigt auf der höchsten Ebene in gemeinsame Mechanik ein, auf der tatsächlich gemeinsame Semantik existiert.**

```text
Player:
Input → Player Action → Loadout → Activation
      → optional Behavior → ability-spezifische Commit-/Execution-Grenze → Execution Capability

Optional bei expliziter Control Delegation:
Player Action → kontrollierter Actor → actor-eigene Orchestrierung / Readiness → Execution Capability

Einfacher Enemy:
AI → Attack Decision → optional Readiness/Policy → Execution Capability

Komplexer Enemy:
AI → Special wählen → Enemy Behavior → Commit → Execution Capability

Turret:
Targeting / optionaler externer Command → Fire Policy / Readiness → Execution Capability

World:
Trigger → Execution Capability oder kleiner eigener Lifecycle
```

Diese Asymmetrie ist gewollt. Player, Enemy, Turret und World werden nicht für formale Einheitlichkeit in ein großes `AbilitySystem` gedrückt.

Control Delegation ist dabei ein **Erweiterungsfall der Action-Grenze**, keine obligatorische Stufe jeder Player-Action. Der normale Player-Pfad bleibt direkt und verständlich.

## 5. Stabile semantische Begriffe

### Action Initiator
Quelle, die eine semantische Action beginnt, z. B. Player-Input, Enemy AI, Turret-Logik oder ein World-Trigger. Der Initiator bestimmt den Startkontext, ist aber nicht automatisch Execution Actor, Controller, Gameplay Source oder Attribution Owner.

### Action
Semantische Absicht einer Quelle, z. B. Weapon 1 aktivieren oder Utility loslassen.

### Activation
Wie eine Action ausgelöst wird, z. B. `instant`, `held`, `charged`, `charged throw`, `targeted`, `placement`, `toggle`, `channelled`.

### Action Receiver
Der gameplay-fähige Actor, der eine semantische Action fachlich empfängt. Im normalen Player-Pfad ist dies der Player. Nur eine ausdrücklich implementierte Control Delegation kann einen anderen Receiver einsetzen.

`Action Receiver` ist ein semantischer Begriff, **kein vorgeschriebener zentraler Router oder Runtime-Owner**.

### Execution Actor
Der Actor, der eine actor-gebundene Gameplay-Ausführung fachlich besitzt, z. B. Player, Enemy oder Turret. Ein rein durch die World ausgelöster Effekt benötigt nicht zwingend einen Execution Actor. Der Execution Actor ist nicht automatisch identisch mit Controller, Gameplay Source oder Attribution Owner.

### Controller
Optionaler Actor bzw. Player, der Intent für einen anderen Gameplay-Actor liefert. Ohne Control Delegation ist kein separater Controller-Kontext nötig.

### Gameplay Source
Die fachliche Mechanik oder Quelle, durch die eine Wirkung entstanden ist, z. B. eine konkrete Weapon, Ability, Utility, Construction-Weapon oder ein World-Effect. Die Gameplay Source ist nicht automatisch der Execution Actor und nicht automatisch die Identität, der Damage oder Kill später zugerechnet wird.

### Attribution Owner
Die fachliche Identität, der eine Wirkung aktuell für Damage-, Kill-, Reward- oder vergleichbare Regeln zugerechnet wird. Welche Regeln diese Attribution konsumieren, bleibt fachlich explizit.

### Lineage
Kausale Gameplay-Abstammung einer Wirkung, z. B. Root-/Parent-Projectile, ursprüngliche Execution und daraus erzeugte Split-/Child-Wirkungen. Lineage kann erhalten bleiben, obwohl sich Attribution oder Allegiance später ändern.

### Correlation
Identität für technischen oder fachlichen Zusammenhang zwischen Requests, Prediction, Reconciliation, Diagnose oder einzelnen Executions, z. B. Attempt-/Request-, Action-, Shot-/Execution- oder Prediction-ID. Correlation ist nicht automatisch kausale Gameplay-Lineage.

### Allegiance
Aktuelle Friendly-/Hostile-/Neutral-Semantik einer Wirkung oder eines Actors. Sie ist fachlich von Attribution getrennt, auch wenn der heutige Legacy-Code beides an manchen Stellen aus derselben `ownerId` ableitet.

### Faction
Optionale fachliche Klassifikation eines Actors oder Effekts, falls eine Mechanik mehr als die aktuelle Beziehung benötigt, z. B. Player, Zombie oder eine andere Gruppe. `Faction` und `Allegiance` sind **keine Synonyme**: Ein Actor kann seine Allegiance ändern, ohne seine taxonomische Faction wechseln zu müssen.

Diese Rollen sind **semantische Dimensionen, keine Pflichtfelder eines universellen Context-Objekts**. Ein Contract trägt nur die Informationen, die Downstream-Regeln tatsächlich benötigen. Unqualifiziertes `Owner` soll in neuen fachlichen Contracts vermieden werden, wenn damit Execution Actor, State Owner oder Attribution Owner gemeint sein könnte.

### Commit
Der erste autoritative Punkt, ab dem eine Action fachlich als erfolgreich begonnen gilt. Ressourcen/Charges, Cooldowns oder andere verbindliche Folgen werden daran gekoppelt. Der Commit kann je nach Ability vor, während oder nach einem technisch akzeptierten Execution-Dispatch liegen.

### Execution Capability
Ein schmaler fachlicher Ausführungspfad für eine konkrete Mechanik, z. B. Projectile Spawn, Hitscan, Melee, Placement, Deferred/Timed Strike oder Start/Update eines sustained Effects.

`Execution` bezeichnet dabei **eine Architekturgrenze aus mehreren Capabilities**, keinen zukünftigen zentralen `ExecutionManager`.

### Deferred One-shot Execution
Eine bereits committed, einmalig eintretende Wirkung mit eigener kurzer Lifetime zwischen Commit und Trigger, z. B. ein markierter Zielpunkt, der später explodiert.

Sie ist weder vorbereitender Windup noch sustained Runtime. Nach Commit wird sie grundsätzlich unabhängig vom weiteren Lifecycle des ursprünglichen Actors aufgelöst, sofern die konkrete Mechanik keine explizite Post-Commit-Cancellation besitzt.

### Impact / Interaction
Semantische Folge einer Kollision oder direkten Execution **vor** der Annahme, dass zwingend Damage entsteht: Treffer, Block, Reflection, Deflection, Support Impact, Explosion, Attribution-/Allegiance-Änderung usw.

### Outcome
Authoritatives Ergebnis einer aufgelösten Regel: Damage, Kill, Status, Heal, Placement-Erfolg, Projectile-Reflexion, Attribution- oder Allegiance-Änderung usw. Ein Outcome kann anschließend eine **authoritative Gameplay-Reaction** auslösen oder nur passiv durch Network, Statistik und Presentation beobachtet werden.

# Teil B – Erstes Player-Gameplay-Refactoring

## 6. Umfang

Das erste Refactoring umfasst:

1. Action-/Activation-Grenze schaffen,
2. `WorldPlayerGameplayRuntime` als echte öffentliche Player-Gameplay-Grenze etablieren,
3. `LoadoutManager` auf Ausstattung und Orchestrierung reduzieren,
4. Activation-/Resource-/Commit-Semantik stabilisieren,
5. Execution-Capabilities konsolidieren und spezielle Player-Behaviors modularisieren,
6. Contracts und Übergabe an Activity, Network sowie bestehende Projectile-/Combat-Pfade stabilisieren.

> **Normative Erweiterbarkeit ist kein Implementierungsauftrag.** Control Delegation, generische Deferred-Infrastruktur und erweiterte Attribution werden im ersten Player-Gameplay-Refactoring nur dort materialisiert, wo heutige Semantik oder ein aktueller Migrationspfad sie tatsächlich benötigt. Es entstehen keine vorsorglichen Framework-Komponenten allein für mögliche spätere Features.

Projectile und Combat werden dabei noch nicht vollständig intern refactored. Externe Consumer sollen nach dem Cutover nicht dauerhaft über `playerGameplayRuntime.systems.*` in konkrete Child-Systeme traversieren.

---

## 7. Zielbild nach dem ersten Refactoring

```text
ACTION SOURCES
Player Input      Enemy AI      Turret      World
     │                │            │          │
     ▼                ▼            ▼          ▼
Player Action    Enemy Decision  Logic      Trigger
     │                │            │          │
     ▼                │            │          │
PLAYER GAMEPLAY BOUNDARY            │          │
Loadout → Activation ────────────────┤          │
          │      │                   │          │
          │      └→ optional Ability Behavior   │
          │           prepare / commit / cancel │
          └──────────────┬──────────────────────┘
                         ▼
                 EXECUTION CAPABILITIES
              Immediate / Deferred / Sustained
                         │
                         ▼
        bestehende Projectile-/Combat-/World-Pfade
        über stabilisierte Verträge
```

Die öffentliche Action-/Boundary-Struktur darf spätere Control Delegation nicht verbauen, muss dafür im ersten Refactoring aber **keinen generischen Action-Receiver-Router** einführen. Im normalen Pfad bleibt der Player selbst der fachliche Receiver seiner Actions.

## 8. Player Action

Input besitzt nur Eingabe- und lokalen Bedienzustand:

- Keyboard-/Pointer-State,
- LMB/RMB/E/Q,
- Aim-/Cursor-Information,
- Press/Hold/Release,
- lokale Bedienmodi,
- Übersetzung in semantische Actions.

Input kennt nicht Damage-Regeln, Resource-Authority oder Ability-internen State.

Ein Client kann eine Action anfordern. Ob sie gültig ist und committen darf, entscheidet der Host. Nur wenn eine konkrete Control Delegation tatsächlich aktiv ist, wird zusätzlich hostseitig aufgelöst, welcher Actor die Action empfangen darf.

Client Prediction ist dabei **keine zweite Gameplay-Authority**. Sie darf temporären lokalen Prediction-State für Responsiveness halten, muss aber über stabile Action-/Shot-/Prediction-Identitäten mit Host-Accept/Reject und autoritativem Resource-State reconciled werden. Prediction darf weder denselben Gameplay-State unabhängig mutieren noch lokale Effekte doppelt auslösen.

### 8.1 Action-, Attempt-, Execution- und Prediction-Identität

Nicht jede Identität beschreibt dieselbe Lifetime:

- **Action-/Held-Identität** kann eine länger laufende Activation beschreiben und ausdrücklich mehrere Executions enthalten, z. B. Autofire, Channel oder Salvo.
- **Attempt-/Request-Identität** bezeichnet einen commit-tragenden autoritativen Versuch. Retries desselben Attempts dürfen **höchstens einmal** dessen Commit und verbindliche Mutationen auslösen.
- **Execution-/Shot-Identität** bezeichnet – wo benötigt – eine einzelne erzeugte Wirkung innerhalb einer Action.
- **Prediction-Identität** korreliert lokalen Vorhersage-State mit dem autoritativen Ergebnis und ist nicht automatisch selbst die fachliche Action- oder Shot-ID.

Damit gilt: Transport-Retries, doppelte RPCs oder verspätete Duplikate desselben commit-tragenden Attempts erzeugen keinen zweiten Projectile-Spawn für **diesen Attempt**, keinen zweiten Resource-Verbrauch, keinen zweiten Cooldown-Start und keine zweite sonstige Commit-Mutation. Eine länger lebende Action darf dagegen mehrere ausdrücklich modellierte Executions mit eigenen Identitäten erzeugen.

Ein wiederholter Request darf ein bereits finales Accept-/Reject-Ergebnis erneut liefern oder als bereits verarbeitet erkannt werden. Attempt-/Request-Identitäten bleiben an den passenden World-/Player-/Session-Scope gebunden, damit alte IDs keine neue Runtime beeinflussen. Kontinuierliche Input-Snapshots werden nicht künstlich wie One-shot-Attempts behandelt.

Die At-most-once-Commit-Regel ist enger als die allgemeine Duplicate-Semantik autoritativer Commands: Jeder über einen retriable Transport ausgelöste **state-changing Command** definiert, was bei Duplikaten und verspäteten Wiederholungen geschieht. Er ist entweder von Natur aus idempotent oder besitzt eine stabile Action-/Command-/Session-Identität bzw. Generation. Das gilt auch für autoritative Zustandsänderungen **vor** Commit, z. B. Held-Action-Start/-Cancel oder eine später implementierte Control-Session-Start/-Stop-Semantik. Ein Duplikat darf keinen neueren State überschreiben oder eine beendete Lifetime wiederbeleben.

Dafür wird kein universeller globaler Dedupe-Manager vorgeschrieben. Der bestehende Weapon-2-Prediction-Dedupe sowie die `actionId`-gebundene stale-sichere Consume-/Cancel-Semantik des `HostHeldActionSystem` sind Migrationsanker; daraus folgt nicht, dass jeder heutige Start-/Retry-Pfad bereits vollständig idempotent ist.

### 8.2 Optionale Control Delegation

Eine spätere Turmübernahme oder vergleichbare Mechanik kann als explizite, hostautorisierte Control Session modelliert werden. Dann gilt:

- der Player bleibt Player; ein fremdes Loadout wird nicht in sein Loadout kopiert,
- der kontrollierte Actor behält Weapon Config, Readiness, Buffs und Execution-Authority,
- der Player liefert nur die autorisierten Intents,
- Session-Lifetime und Teardown sind explizit,
- wenn Sessions umgesetzt werden, besitzen sie eine stabile Session-Identität/Generation, damit verspätete Intents einer beendeten Session stale verworfen werden können,
- Exklusivität oder bewusst erlaubte Mehrfachsteuerung ist eine explizite Policy,
- die Priorität zwischen manueller Steuerung, automatischem Targeting und zeitlich begrenzten externen Commands ist explizit,
- HUD/Presentation lesen nur den für Bedienung nötigen Read State,
- Attribution und Allegiance werden durch eigene Gameplay-Regeln bestimmt.

Diese Regeln sind **Validierung des Zielbilds**, nicht Scope-Vorgabe für den ersten Player-Gameplay-Cutover.

## 9. Loadout Runtime

Loadout bleibt Owner der Ausstattung:

- weapon1 / weapon2 / utility / ultimate,
- Slot-Zuordnung,
- gültige Auswahl,
- effektive Ausstattungs-/Config-Sicht für Modifier, deren fachlicher Resolution-Zeitpunkt im Loadout liegt,
- Auflösung: welche Ability bzw. welches Tool gehört zur Action?

Loadout interpretiert keine Persistence-/Upgrade-Regel ein zweites Mal. Progression und Item-Systeme dürfen normalisierte Inputs liefern; Loadout materialisiert davon nur Modifier, deren fachlicher Resolution-Zeitpunkt tatsächlich an dieser Grenze liegt. Dynamische Runtime-, Target-, Environment- oder Reaction-Modifier verbleiben bei ihrer jeweiligen Policy und werden nicht allein deshalb ins Loadout gezogen, weil ihre ursprüngliche Konfiguration aus Items, Upgrades oder Progression stammt. Für jede fachliche Modifier-Regel existiert genau eine Authority.

Dieselbe Lokalitätsregel gilt für Konfiguration: ability-spezifische Mechanik erweitert nicht automatisch einen globalen `WeaponConfigShape` um weitere optionale Top-Level-Felder. Gemeinsame Basiswerte bleiben gemeinsam; spezielle Behavior-, Fire- oder Payload-Daten gehören in den kleinsten typisierten Config-Bereich mit tatsächlicher gemeinsamer Semantik. Das erste Refactoring muss den heutigen Config-Bestand nicht vollständig umbauen, soll aber weiteres Wachstum eines „God-Data“-Objekts verhindern.

**Konkretes Zielmuster für neue oder ohnehin berührte Config:** Die vorhandene diskriminierte `WeaponFireConfig`-Struktur ist der bevorzugte Anker für Fire-semantische Spezialwerte. Neue Fire-Typen erweitern einen kleinen typisierten Zweig statt `WeaponConfigShape` um weitere lose optionale Top-Level-Felder zu vergrößern. Behavior-spezifische oder Payload-spezifische Daten werden analog in ihrem kleinsten fachlichen Config-Bereich lokalisiert. Bestehende flache Legacy-Felder werden **nicht allein wegen dieses Refactorings** vollständig migriert; die Ratchet gilt vor allem für neue oder im jeweiligen Cutover ohnehin angefasste Semantik.

```ts
interface ExampleSpecialWeaponFireConfig {
  readonly type: 'example_special';
  readonly projectileSpeed: number;
  readonly specialRadius: number;
}

type WeaponFireConfig =
  | ProjectileWeaponFireConfig
  | HitscanWeaponFireConfig
  | ExampleSpecialWeaponFireConfig;
```

Das Beispiel ist ein Lokalitätsmuster, kein Auftrag, den heutigen gesamten Config-Bestand in dieser Phase umzubauen.

Nicht langfristige Loadout-Kernverantwortung:

- Projectile-Simulation,
- allgemeine Hitscan-/Melee-Auflösung,
- Damage-Authority,
- große Ability-Lifecycles,
- sustained World-Effects,
- Network-Transport,
- Presentation.

> **Weapon, Utility und Ultimate bleiben fachliche Kategorien, aber keine getrennten Mechanikwelten.**

### 9.1 Modifier besitzen einen expliziten Resolution-Zeitpunkt

Für jede gameplay-relevante Modifier-Regel ist festgelegt, **wann** sie ausgewertet wird. Es gibt keine implizite globale Regel, nach der alle Werte entweder beim Fire/Commit eingefroren oder erst beim Impact live gelesen werden.

Typische, aber nicht verpflichtende Muster sind:

- Source-/Weapon-/Execution-Parameter werden bei Commit oder Spawn aufgelöst und im notwendigen Contract weitergetragen, wenn ein späterer Buff-/Loadout-Wechsel die bereits gestartete Wirkung nicht rückwirkend verändern soll.
- Target-, Vulnerability-, Environment- oder andere situative Modifier werden beim Impact bzw. bei der Mutation live ausgewertet, wenn genau dieser Zeitpunkt fachlich gewollt ist.
- Deferred- und Sustained-Mechaniken definieren ausdrücklich, welche Parameter gesnapshottet und welche bei späteren Ticks erneut aufgelöst werden.

Der Resolution-Zeitpunkt gehört zur jeweiligen Regel/Policy und muss durch Tests geschützt werden. Dadurch kann ein langsames Projectile oder ein verzögerter Effekt nicht unbemerkt andere Werte erhalten, nur weil sich Loadout, Buffs oder Activity-State zwischen Commit und Impact geändert haben.

---

## 10. Activation, Held Actions und Commit

Der aktuelle `HostHeldActionSystem` ist bereits ein guter Migrationsanker: hostautoritative Action-Identität, Startzeit, Timeout und Consume-Semantik existieren.

**Abgrenzung zu Ability Behavior:** `HostHeldActionSystem` besitzt die hostseitige Held-/Charge-Input-Semantik einer Player-Action und deren stale-sichere Identität. Ein `AbilityBehavior` besitzt dagegen die mehrphasige Gameplay-Orchestrierung einer konkreten Ability, z. B. Windup, Telegraph, Aim/Positioning, Commit, Recovery oder outcome-abhängige Reaktionen. Ein Behavior darf Held-State konsumieren, ersetzt ihn aber nicht. Enemy-/Turret-Behaviors benötigen keinen `HostHeldActionSystem` nur deshalb, weil sie einen Windup besitzen.

Er muss deshalb nicht durch ein völlig neues Universal-System ersetzt werden.

Grundmodell:

```text
Begin → Prepare / Aim / Charge → Validate
                 │
                 └→ optional Behavior-Lifecycle
                        │
                 ability-spezifische Grenze
                     COMMIT
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
     Immediate Execution    Deferred/Sustained Execution
```

Commit und Execution haben **keine global feste Reihenfolge im technischen Dispatch**. Bei einer einfachen Waffe kann ein akzeptierter Fire-Dispatch den Commit auslösen; beim Placement liegt er nach erfolgreicher Host-Validierung bzw. Annahme; bei mehrstufigen Abilities sichtbar später, z. B. beim späteren Mörser `THUMP`.

Eine wichtige heutige Semantik bleibt erhalten: Viele Weapon-Ressourcen werden erst nach erfolgreichem Fire-Dispatch abgebucht. Pre-Commit-Fehler verursachen grundsätzlich keine Resource-Kosten, sofern die konkrete Ability-Regel nichts anderes definiert.

**Pre-Commit-Interrupt und Post-Commit-Lifetime werden getrennt:**

- Windup, Aim, Telegraph, Positioning und Charge vor Commit gehören zum Behavior-/Activation-Lifecycle.
- Harte Unterbrechungen wie Tod oder Stun können diesen Lifecycle gemäß Ability-Regel abbrechen.
- Ein Pre-Commit-Abbruch kann trotzdem eine explizite Recovery oder einen Cooldown auslösen; daraus wird keine globale „kostenlose Retry“-Regel abgeleitet.
- Eine nach Commit geplante Wirkung läuft grundsätzlich weiter, selbst wenn der ursprüngliche Actor danach stirbt, gestunnt wird oder despawnt.
- Eine Ausnahme benötigt eine ausdrücklich authored Post-Commit-Cancel-Regel.

### 10.1 Fachliche Zeit

Cooldowns, Held Actions, Charge, Regeneration, Windup, Commit, Deferred Trigger und Reconciliation arbeiten mit expliziter fachlicher Zeit. Domain-Code erhält `nowMs`/`deltaMs` über seinen Aufrufvertrag und leitet Gameplay-Entscheidungen nicht versteckt aus `Date.now()` ab.

Dafür wird **kein globaler `TimeService`** eingeführt. Entscheidend ist nur, dass die Zeitquelle an der Orchestrierungsgrenze sichtbar bleibt und Tests deterministische Zeit einspeisen können.

### 10.2 Authoritative Randomness

Gameplay-relevanter Zufall wird hostautoritativ entschieden und in Domain-Regeln testbar gemacht. Wo Zufall ein fachliches Outcome verändert – z. B. Crit, Proc, Streuung mit Gameplay-Wirkung oder zufällige Ziel-/Spawn-Wahl – erhält die betreffende Regel eine kontrollierbare Random-Quelle bzw. einen deterministisch testbaren Einstieg, statt versteckt von globalem `Math.random()` abzuhängen.

Dafür wird **kein globaler `RandomService`** vorgeschrieben. Rein visuelle Randomness in Presentation/VFX muss nicht zwischen Host und Clients deterministisch sein.

## 11. Resource- und Readiness-Policies

Der vorhandene `ResourceSystem` bleibt ein fokussierter Player-Resource-Owner für tatsächlich gemeinsame Player-Ressourcen wie Adrenalin und Rage.

Davon getrennt ist **Readiness** einer Ability oder eines Tools, z. B.:

- Cooldown,
- Burst-/Salvo-Bereitschaft,
- Reload / Lockout,
- Warmup,
- ability-lokale Charges.

Charges gehören nur dann in einen gemeinsamen Resource-Owner, wenn sie fachlich wirklich einen gemeinsamen Pool darstellen. Ein Cooldown ist nicht automatisch Resource-State.

Das Ziel ist **weder ein paralleles Ressourcen-Framework noch ein zentraler Readiness-Manager für alle Abilities**. Pure Policies dürfen wiederverwendet werden, ihr mutable State bleibt beim kleinsten passenden Owner.

> **Shared Policy bedeutet nicht Shared Global State.**

---

## 12. Ability Behavior

Ability Behavior ist **keine feste Pipeline-Stufe nach Commit**, sondern optionaler Orchestrator um Activation, Commit, Execution und Recovery. Eigene Behavior-Owner sind sinnvoll bei:

- mehrstufigem Lifecycle,
- persistentem Runtime-State,
- Commit-/Cancel-Lifecycle,
- Reaktion auf spätere Outcomes,
- spezieller Targeting-/Positioning-Orchestrierung,
- Zusammenspiel mehrerer Gameplay-Primitiven.

Beispiele: Translocator, Tesla Dome, Energy Shield, Armageddon, AK47-/Negev-spezifischer State.

> **Ein besonderer Projectile-Payload rechtfertigt allein noch keinen Ability-Behavior-Owner.**

### 12.1 Targeting-, Movement- und Telegraph-Phasen bleiben ability-spezifisch

Das Zielbild schreibt **keinen universellen Aim-Lock-Zeitpunkt** und keine globale Windup-Bewegungsregel vor.

Ein Behavior darf z. B.:

- einen Zielpunkt `(x, y)` zu Beginn festlegen,
- danach weiter Positioning betreiben, um Winkel oder Sichtlinie zu verbessern,
- Aim während eines Teils des Windups nachführen,
- in einer letzten Telegraph-/Commit-Phase Bewegung oder Aim einfrieren,
- oder bei einer anderen Ability das Ziel erst unmittelbar vor Commit bestimmen.

Diese Unterschiede bleiben lokaler Behavior-State bzw. lokale Policy. Gemeinsam sind lediglich explizite fachliche Zeit, Authority, Commit-/Cancel-Semantik und der Übergang in eine passende Execution Capability.

## 13. Execution Capabilities – Lifetime und Spezialisierung getrennt

Der heutige Code zeigt, dass „stateless vs. stateful Fire Type“ zu grob ist.

`Execution` ist deshalb keine einzelne Runtime-Stufe mit universellem Kontextobjekt. Player, Enemy, Turret oder World wählen die kleinste passende Capability; gemeinsame Composition darf diese Capabilities bündeln, ohne ihre fachlichen Verträge zu vereinheitlichen.

Dabei werden **zwei Achsen nicht vermischt**:

1. **Execution-Lifetime:** immediate one-shot, deferred one-shot oder sustained,
2. **Wiederverwendungsgrad:** gemeinsam genutzte Capability oder spezialisierter Adapter/Resolver.

Eine spezialisierte Execution kann also immediate, deferred oder sustained sein.

### 13.1 Immediate One-shot Execution

Einmalige Ausführung ohne eigenen langlebigen Execution-State:

```text
Projectile Spawn | Hitscan | Melee | Placement
```

`WeaponFireExecutor` ist dafür ein wichtiger Migrationsanker und bildet heute den gemeinsamen zustandsarmen Projectile-/Hitscan-/Melee-Pfad.

### 13.2 Deferred / Timed One-shot Execution

Eine Action ist bereits committed, ihre einmalige Wirkung tritt aber erst später ein:

```text
Commit
  ↓
Deferred Effect State
  ├ triggerAt / fachliche Zeit
  ├ Ziel / Zielpunkt / aufgelöste Parameter
  ├ Attribution / Correlation
  └ explizite optionale Cancel-Regel
  ↓
Trigger
  ↓
Hitscan / Explosion / World Effect / andere passende Capability
```

Typische Beispiele:

- markierter Zielpunkt explodiert nach Verzögerung ohne Projectile,
- bereits committed Artillerie-/Mörserschlag,
- verzögerter Direct-/Hitscan-Effekt nach abgeschlossenem Windup.

Normativ gilt:

- **Delay vor Commit** bleibt Behavior/Windup.
- **Delay nach Commit** ist Deferred Execution.
- Der Deferred State hängt nach Commit nicht mehr implizit am Leben oder Update des ursprünglichen Actors.
- Tod, Stun oder Despawn des ursprünglichen Actors brechen ihn standardmäßig nicht ab.
- Post-Commit-Cancellation ist möglich, aber nur als explizite Mechanik.
- Der State gehört dem kleinsten semantisch passenden World-/Activity-Owner und wird mit dessen Teardown zuverlässig beendet.
- Es wird kein globaler Allzweck-Scheduler eingeführt. Eine gemeinsame Deferred-Capability entsteht nur für tatsächlich gemeinsame Semantik.

**Minimales Owner-/Update-Muster:** Ein Deferred Effect wird vom Domain-Owner gespeichert und aktualisiert, dessen fachliche Lifetime er besitzt. Ein activity-spezifischer Mörserschlag kann deshalb z. B. als kleine Pending-Strike-Liste in einem activity-scoped Attack-/Effect-Owner liegen und aus dessen regulärem Activity-Update mit explizitem `nowMs`/`deltaMs` getriggert werden. Ein allgemeiner World-Effekt liegt entsprechend in einem world-scoped Owner und wird von dessen World-Update getaktet. Nach Commit hängt der Pending State nicht mehr am ursprünglichen Enemy-/Player-Objekt. Aus diesem Muster folgt **kein** gemeinsamer Scheduler und kein Phaser-Timer-Vertrag.

### 13.3 Sustained Effect Runtime

Ein nach Commit weiterlebender Effekt besitzt einen echten Lifecycle:

```text
start / refresh / update / stop / destroy
```

Beispiele: Energy Shield, Tesla Dome, spätere channelled/toggle-basierte Felder.

Solcher State gehört in einen klaren World-/Player-Gameplay-Owner.

Der Unterschied zur Deferred One-shot Execution ist fachlich: Deferred wartet auf **eine** bereits committed Wirkung; Sustained besitzt über Zeit fortlaufendes Verhalten.

### 13.4 Spezialisierte Execution ist eine orthogonale Eigenschaft

Einige Waffen oder Abilities erzeugen spezialisierte Payloads oder benötigen spezielle Resolver, ohne deshalb einen eigenen Ability-Lifecycle zu brauchen.

Heutige Beispiele:

- Flame-/Fireball-Projektil,
- Leaf-Blower-Projektil,
- Reinforcement-Matrix-Projektil,
- Energy-Injector-Projektil.

Diese dürfen über spezialisierte Adapter/Resolver oder später über einen passend erweiterten gemeinsamen Contract laufen.

> **Spezialisiert bedeutet nicht automatisch stateful; stateful bedeutet nicht automatisch eigener Ability-Behavior.**

### 13.5 Konsequenz für `WeaponFireExecutor`

Der Executor bleibt Migrationsanker für die heute tatsächlich gemeinsame Projectile-/Hitscan-/Melee-Semantik und wird **nicht** künstlich zum Universal-Executor erweitert.

Insbesondere weapon-spezifische Sonderlogik darf nicht allein deshalb dort landen, weil sie irgendwann ein Projectile erzeugt. Erweiterung ist nur sinnvoll, wenn reale gemeinsame Semantik und mehrere Consumer vorhanden sind und der Vertrag dadurch einfacher wird.

Gemeinsame Execution-/Impact-Verträge bewahren außerdem nur die für Downstream-Regeln nötigen semantischen Dimensionen: Execution Actor, Gameplay Source und Attribution sowie – wo relevant – Action Initiator, Controller, Lineage und passende Correlation-Identitäten wie Action-/Attempt-/Shot-/Prediction-ID. Diese Information darf auf dem Weg zu Impact, Combat, Kill Attribution oder Post-Hit-Behavior nicht verloren gehen; daraus entsteht aber kein universeller `ExecutionContext` als Pflichtobjekt.

## 14. Enemy AI vs. Ability Behavior

> **AI entscheidet, welche Action wann und warum begonnen wird. Ein Behavior besitzt den Lifecycle einer gestarteten spezialisierten Action.**

Allgemeine AI:

- Zielwahl,
- Navigation / Steering,
- allgemeines Positioning,
- Weapon-/Ability-Auswahl.

Behavior:

- ability-spezifisches Positioning,
- Target-Sampling / Aim-Lock,
- Windup / Telegraph,
- phasenweise Movement-/Aim-Einschränkungen,
- Interrupt,
- Commit,
- Recovery.

Der heutige `CoopDefenseEnemyAttackSystem` bestätigt diesen Hybrid: eigener Salvo-/Windup-/Sustained-State, aber gemeinsame Fire-Grenze für den tatsächlichen Angriff.

Ein geplanter Enemy-Angriff kann beispielsweise einen Zielpunkt früh einfrieren, sich während des Windups noch bewegen, um den Winkel anzupassen, und in den letzten Millisekunden vor Commit vollständig stehen bleiben. Diese konkrete Sequenz ist **kein globaler Vertrag**; das Zielbild verlangt nur, dass solche Phasen lokal, explizit und deterministisch im Behavior modellierbar sind.

Wird nach einem solchen Behavior eine Wirkung zeitlich verzögert **nach Commit** ausgelöst, wechselt die Verantwortung in Deferred One-shot Execution. Dadurch muss ein verstorbener Enemy nicht künstlich weiterleben, nur damit sein bereits abgeschlossener Angriff noch aufgelöst werden kann.

# Teil C – Finale Gameplay-Architektur

## 15. Gesamtbild

```text
 Player Action                Enemy AI              Turret              World Trigger
      │                          │                     │                      │
      ▼                          ▼                     ▼                      ▼
Player Gameplay              Behavior          Targeting / Readiness      Orchestration
Loadout / Activation            │               / optional Command            │
 / optional Behavior            │                     │                      │
      └──────────────────────────┴──────────┬──────────┴──────────────────────┘
                                            ▼
                                    EXECUTION CAPABILITIES
                             (immediate / deferred / sustained)
                                            │
                     ┌──────────────────────┴──────────────────────┐
                     ▼                                             ▼
          Interaction-producing                           Direct Domain Action
      Projectile / Hitscan / Melee                    Placement / authored World
                     │                                  or Target Mutation
                     ▼                                             │
            Collision / Candidate                                 ▼
                     │                                  Domain Validation /
                     ▼                                      Mutation
          Impact / Interaction                                  │
               Resolution                                       │
         ┌───────────┼───────────┐                               │
         ▼           ▼           ▼                               │
      Combat      World      Projectile                           │
      Rules       Rules       Mutation                            │
         │           │           │                               │
         └───────────┴──────┬────┴───────────────────────────────┘
                            ▼
                 Canonical Domain Mutation
                 beim tatsächlichen State-Owner
                            │
                            ▼
                 Authoritative Outcomes / Reactions
                            │
                            ▼
                 Passive Observation / Projection
```

`Impact / Interaction` ist damit eine **optionale semantische Grenze für interaktionsproduzierende Execution**, kein Pflichtknoten für jede Capability. Placement oder andere direkte Domain-Actions dürfen nach eigener Validation unmittelbar den kanonischen Domain-Owner mutieren und ein Outcome erzeugen. Ebenso darf Combat Damage auflösen, ohne dadurch automatisch Owner des betroffenen Health-State zu werden.

Eine explizite Control Delegation kann vor der actor-eigenen Orchestrierung einen anderen Action Receiver wählen. Sie verändert nicht die darunterliegenden Ownership-Regeln und ist deshalb im Kernfluss bewusst nicht als obligatorische Pipeline-Stufe dargestellt.

Sustained-Ability-Runtimes leben neben diesem Flow und nutzen bei Bedarf dieselben Execution Capabilities wiederholt. Deferred Effects besitzen nach Commit nur den für ihre einmalige spätere Auflösung nötigen State.

Network, Presentation und Persistence liegen an den jeweiligen Owner-Grenzen und übernehmen keine Gameplay-Authority.

## 16. Projectile Simulation

Projectile besitzt fachlich:

- Spawn aus aufgelöstem Execution-Contract,
- stabile Identität,
- Position / Geschwindigkeit,
- Lifetime,
- Homing,
- Bounce / Penetration,
- projectile-spezifischen Flight-State,
- Collision Detection,
- Erzeugung eines Impact Candidates.

Nicht ihre fachliche Verantwortung:

- Input / Loadout,
- Resource-Verbrauch,
- Progression,
- allgemeine Damage-Regeln,
- Network-Codec,
- Client-Interpolation als Authority,
- konkrete Renderer / Audio.

Ein Projectile darf reichhaltige **typisierte semantische Payloads** besitzen, z. B. Explosion, Burn, Support Impact, Homing oder Split. Diese Payloads sollen jedoch nicht wieder zu einem einzelnen wachsenden Objekt mit beliebig vielen optionalen Weapon-Sonderfeldern werden.

Logisch werden mindestens drei Verantwortungen unterschieden:

```text
Projectile
├ Flight Spec
├ Gameplay Source / Attribution / Lineage / Correlation
└ Interaction Payload
```

Die konkrete Type-Struktur wird erst im Projectile-Refactoring festgelegt. Normativ ist nur: Flight-Daten, Herkunft und fachliche Interaktionsdaten bleiben erkennbar und spezielle Mechanik wird typisiert lokalisiert.

### 16.1 Projectile Mutation und Attribution

Projectile-nahe Mutation umfasst nicht nur Bounce/Penetration, sondern darf explizit auch enthalten:

- Reflection,
- Deflection / Redirect,
- Änderung aktueller Attribution,
- Änderung von Allegiance,
- Imbue / Augment,
- Flight-State-Transformation,
- Split / Child-Projectile-Erzeugung.

Dabei werden insbesondere diese Konzepte nicht vermischt:

- **Gameplay Source:** welche fachliche Mechanik die Wirkung erzeugt hat,
- **aktuelle Attribution:** wem Downstream-Regeln die Wirkung derzeit zurechnen,
- **Allegiance:** welche Friendly-/Hostile-/Neutral-Semantik gilt,
- **Lineage:** aus welcher ursprünglichen Wirkung bzw. welchem Parent/Root die Wirkung kausal hervorgegangen ist,
- **Correlation:** welche IDs Request, Prediction, Execution oder Diagnose zusammenhalten.

Eine Reflection kann je nach Interaction-Regel Attribution und/oder Allegiance verändern. Gameplay Source und benötigte Lineage können trotzdem erhalten bleiben; Correlation wird nur soweit weitergetragen, wie spätere Semantik, Prediction oder Diagnose sie tatsächlich benötigt.

Child-/Split-Projektile verlieren deshalb nicht stillschweigend ihre semantische Herkunft. Welche IDs konkret persistiert werden, legt erst der Projectile-Implementierungsplan fest; normativ ist nur, dass benötigte Information an Spawn-/Mutation-Grenzen nicht verloren geht.

### 16.2 Reflection kann auch Payload-Semantik transformieren

Ein reflektiertes Projectile muss nicht nur seine Richtung ändern. Die Interaction-Regel darf – typisiert und explizit – auch seine spätere Wirkung transformieren.

Bestehendes Fragdachse-Verhalten ist dafür ein wichtiger Referenzfall: Die Tesla-Dome-Reflection erzeugt heute ein Projectile mit dem Dome-Besitzer als `ownerId`; bei einer reflektierten Enemy-Spawn-Granate führt dies downstream zu verbündeter statt feindlicher Brut.

Das Zielbild konserviert **die fachliche Semantik**, nicht zwingend die heutige Kopplung dieser Bedeutungen an ein einzelnes `ownerId`-Feld. Künftig dürfen Attribution und Allegiance getrennt modelliert werden, wenn dies die Regeln klarer macht.

Solche Transformationen gehören an Projectile-/Impact-/Interaction-Grenzen und nicht als konkrete Weapon-ID-Sonderfälle in den Damage-Core.

Die Grenze lautet:

> **Projectile besitzt Flug und projektilnahe Interaktion; die fachliche Wirkung auf Health, Status, Construction oder World wird außerhalb des Flight-Lifecycles aufgelöst.**

## 17. Impact / Interaction als explizite Grenze

Der heutige Code vermischt Teile der Projectile-Interaktion mit `CombatSystem`.

Deshalb gilt:

> **Eine Kollision ist noch nicht automatisch Damage.**

Ein Impact kann:

- Damage anfordern,
- Explosion/AoE auslösen,
- Support-Wirkung erzeugen,
- Projectile reflektieren oder ablenken,
- aktuelle Attribution und/oder Allegiance verändern,
- Projectile imbuen/augmentieren,
- Shield-/Barrier-Semantik auslösen,
- World-Effect erzeugen,
- Spawn-/Payload-Semantik transformieren,
- Projectile fortsetzen oder beenden.

Diese Semantik gehört an eine erkennbare Impact-/Interaction-Grenze, **wenn eine Execution tatsächlich eine solche Interaktion erzeugt**. Direkte Domain-Actions wie Placement müssen nicht künstlich über Impact geroutet werden; sie können nach ihrer eigenen Validation direkt den zuständigen Domain-Owner mutieren und ein Outcome erzeugen.

Das muss **keine einzelne neue Klasse** sein. Geeignet sind kleine pure Resolver, Policies, Ports oder ein schmaler Coordinator.

`combat/rules/ProjectileImpactResolver` ist bereits ein guter Migrationsanker für diesen Stil.

Nicht gewollt: ein universelles `ImpactSystem`, das alle Sonderfälle zentral sammelt.

Attributions- und Allegiance-Änderungen sind dabei selbst fachliche Ergebnisse. Ein reflektiertes Projectile kann z. B. eine neue aktuelle Attribution und andere Friendly-/Hostile-Semantik erhalten, während benötigte Lineage und Correlation bewusst getrennt erhalten bleiben. Downstream-Systeme dürfen diese Konzepte nicht wieder zu einer einzigen undifferenzierten `ownerId`-Bedeutung verschmelzen.

## 18. Explosion / AoE

Explosion ist gemeinsame Gameplay-Wirkung und keine Projectile-Untertechnologie.

```text
Rocket / HE / Fireball / Armageddon / Mortar / World Event
                         ↓
                    Explosion / AoE
```

Typische Daten:

- radius / damage / falloff,
- self-/team-damage rules,
- target categories,
- rock/base/train multipliers,
- knockback,
- burn / ground fire / status.

### Kein vorweggenommener `ExplosionManager`

Im heutigen Code existiert kein klarer zentraler `ExplosionManager`, in den lediglich alles verschoben werden müsste.

Vorhanden sind bereits Radial-/Environment-Regeln, `DetonationResolver` und verschiedene Sinks.

Ein eigener Explosion-/Impact-Owner wird erst eingeführt, wenn die spätere Ist-Analyse einen echten gemeinsamen Änderungsgrund zeigt.

---

## 19. Host-Frame-Orchestrierung

`HostUpdateCoordinator` ist ein wichtiger Migrationsanker.

Er ordnet heute unter anderem Activity, Player-Systeme, Physics, Combat/Projectile, Detonations, Explosionen, Knockback, Environment-Damage und Publish-Schritte.

Diese Breite ist **nicht automatisch ein Architekturfehler**.

Ein echter Frame-Coordinator darf breit bleiben, wenn seine Kernverantwortung lautet:

> **Die authoritative Reihenfolge unabhängiger Owner sichtbar orchestrieren.**

Im Coordinator dürfen bleiben:

- Frame-Reihenfolge,
- Owner-Aufrufe,
- Zusammenführen von Ergebnissen,
- kontrollierte Flush-/Publish-Punkte.

Heraus gehören fachliche Regeln, die einen eigenständigen Owner oder pure Resolver verdienen.

Wichtig:

> **Kein generischer Event-Bus ersetzt die explizite synchrone Reihenfolge, wenn Interleaving Gameplay verändert.**

---

## 20. Combat Runtime

Combat wird Authority für **gemeinsame Combat-/Damage-Resolution-Semantik**, insbesondere:

- Damage-/Heal-/Armor-Gain-Regeln und deren allgemeine Modifier,
- Combatant-spezifische Hit-Semantik, Kill Attribution und nachgelagerte Combat-Reaktionen,
- semantische Combat-Outcomes,
- Combat-owned Burn/Status nur dort, wo Lifetime und Regeln tatsächlich Combatant-spezifisch sind.

Combat ist **nicht automatisch Owner des mutable Health-/Armor-State jedes Combatants oder jeder World-Entität**. Player-Health kann dort bleiben, wo es heute kanonisch liegt; Enemy-Health darf beim `EnemyManager` bzw. einem späteren expliziten Enemy-Owner bleiben; Base, Rocks/Obstacles, Constructions, Train und andere Domains behalten ebenfalls ihren kanonischen Health-/Destruction-State beim jeweiligen Owner, solange kein konkreter Migrationsgrund besteht.

Impact-/Explosion-/Combat-Regeln berechnen, validieren oder beauftragen die Wirkung. Die eigentliche Mutation erfolgt genau einmal beim **kanonischen Owner des betroffenen fachlichen States**. Combat darf dafür schmale Target-/Mutation-Ports konsumieren, ohne Storage-Ownership an sich zu ziehen.

Die Invariante lautet deshalb: **genau ein Writer pro fachlichem Health-/Damage-State; gemeinsame Combat-Regeln und Health-Storage sind getrennte Verantwortungen.** Symmetrie allein ist kein Grund, bestehenden kanonischen State in einen zentralen Combat-Owner umzuziehen.

Der kanonische State-Owner besitzt auch die **atomare Transition-Erkennung seines eigenen States**. Eine Health-/Armor-/Integrity-Mutation entscheidet in demselben fachlichen Schritt, ob daraus z. B. `becameDead` oder `becameDestroyed` entsteht, und liefert bzw. publiziert ein entsprechendes autoritatives Mutation-Outcome. Die konkrete Datenform ist Implementierungsdetail. Nachgelagerte Consumer dürfen denselben Übergang nicht durch unabhängiges erneutes Lesen und eigene Schwellenlogik ein zweites Mal entscheiden.

Damit werden **Death/Destroyed Transition** und **Kill Attribution** ausdrücklich getrennt: Der kanonische State-Owner erkennt den Zustandsübergang; Combat-/Attribution-/Reward-/Reaction-Policies dürfen das autoritative Outcome konsumieren und daraus Kill, Rewards oder Folgeeffekte ableiten. Sie werden dadurch nicht zu einem zweiten Health-/Destruction-Writer.

Langfristig nicht Combat-Kernverantwortung:

- konkrete Ability-/Weapon-Sonderfälle,
- Ability-Lifecycle,
- Projectile-Flight,
- Network-Transport,
- weapon-spezifische Post-Hit-Progression,
- rein projectile-spezifische Reflection-/Deflection-Orchestrierung.

### 20.1 Reales Refactoring-Risiko

Die heutige Kopplung ist tief: `CombatSystem` enthält neben Damage auch AK47-Rückkopplung, weapon-/slotbezogene Multiplikatoren, Projectile-Sonderregeln, Plasma-Swarm-, Shield-/Dome- und Leaf-Blower-Interaktion und hängt direkt am `ProjectileManager`.

Der Combat-Refactor ist deshalb **kein kleiner Cleanup**.

### 20.2 Bestehende Migrationspfade nutzen

Bereits vorhanden sind u. a.:

- `CombatDamageObservation`,
- Damage-Observer,
- Direct-Primary-Hit-Handler,
- AK47-/Support-Callbacks,
- pure Resolver unter `combat/rules`.

Diese Muster werden bevorzugt genutzt, bevor neue Event-Infrastruktur entsteht.

Entkopplung erfolgt nach **Semantik**:

1. allgemeine Damage-Modifikatoren,
2. Projectile-/Target-Interaction,
3. Post-Hit-/Post-Kill-Reaktionen,
4. Support-Impacts,
5. weapon-spezifische Progression/Stacks.

Nicht bloß nach Waffenname.

### 20.3 Authoritative Reactions vs. passive Observation

Nach einer Mutation werden zwei unterschiedliche Dinge nicht in einen gemeinsamen Event-Topf geworfen:

```text
Interaction Resolution
→ authoritative Mutation
→ authoritative Gameplay-Reactions
→ passive Observation / Replication / Presentation
```

Gameplay-Reactions dürfen weiteren fachlichen State verändern und benötigen deshalb eine sichtbare, testbare Reihenfolge. Passive Observations wie Statistik, Diagnose, UI oder VFX dürfen diese Authority nicht übernehmen.

Vorhandene Muster wie `CombatDamageObservation` bleiben gute passive Messpunkte. Für autoritative Reaktionen wird kein generischer Event-Bus eingeführt; synchrone Orchestrierung oder kleine typisierte Hooks sind vorzuziehen.

### 20.4 Status-State folgt Target-/Domain-Ownership

Ein Impact kann Status erzeugen, aber Combat besitzt nicht automatisch jeden Status. Mutable Status-Zustände gehören zum kleinsten fachlich passenden Target-/World-Owner. Der heutige `WorldTargetingRuntime` mit `TargetStatusSystem` für allgemeine Vulnerability ist dafür ein guter Migrationsanker: Combat darf einen solchen Status anwenden oder bei der Damage-Auflösung konsumieren, ohne dessen Storage selbst zu besitzen.

Combat-owned Burn/Status bleibt sinnvoll, wenn Lifetime und Regeln tatsächlich Combatant-spezifisch sind. Ein universeller `StatusManager`, der sämtliche Debuffs, Felder und World-Effekte zentral sammelt, ist nicht Ziel.

### 20.5 Reaction-Chains und Reentrancy sind explizit

Authoritative Gameplay-Reactions dürfen weitere autoritative Mutationen auslösen – beispielsweise Reflect-Damage oder eine Execution-Reaction nach einem Treffer. Solche Ketten benötigen eine definierte, testbare Reihenfolge und dürfen nicht durch rekursives Wiring oder passive Beobachter unbemerkt doppelt verarbeitet werden.

Ob eine konkrete Reaction synchron verschachtelt oder an einem kontrollierten lokalen Flush-Punkt verarbeitet wird, ist Mechanik-/Implementierungsdetail. Normativ ist nur: **Reentrancy und Chain-Reihenfolge sind explizit, enden deterministisch und erzeugen keine doppelte Authority.** Daraus folgt kein universeller Reaction-Queue- oder Event-Bus-Auftrag.

---

## 21. Enemy und Turret

### Enemy

Enemy AI besitzt strategische Zielwahl, Navigation, allgemeines Positioning sowie Attack-/Ability-Auswahl.

Activity-spezifische Enemy-Owner dürfen Salven, Windups, Commit/Recovery und Speziallifecycles halten.

Darunter werden gemeinsame Execution-Capabilities sowie Projectile-, Impact- und Combat-Primitiven genutzt.

Eine ASMD-artige Enemy-Combo wird deshalb nicht als eigene Detonationstechnologie implementiert: Die AI/Attack Runtime orchestriert, welche beiden Waffen wann genutzt werden; die eigentliche Detonation bleibt gemeinsame semantische Mechanik.

### Turret

Construction/Turret besitzt grundsätzlich:

- Platzierung und Construction-Ownership,
- Weapon Config / Muzzle-Semantik,
- Construction-Buffs,
- automatisches Targeting,
- Fire Rate,
- Burst-/Readiness-State,
- tatsächliche Fire-/Execution-Authority.

Nicht: eigene Projectile-, Explosion- oder Damage-Technologie.

Der aktuelle `TurretSystem` zeigt bereits das gewünschte Grundmuster:

```text
Targeting / Readiness → Fire Handler → gemeinsame Execution
```

Dieses Muster darf über **schmale externe Commands** erweitert werden. Ein Command kann für eine begrenzte Lifetime genau die fachlichen Entscheidungen überschreiben, die seine konkrete Policy ausdrücklich definiert. Er mutiert dafür nicht dauerhaft die Turret- oder Weapon-Config. Ob eine konkrete Utility Targeting, Range, Line-of-Fire, Readiness oder andere Regeln überschreiben darf, ist **Feature-Semantik und kein globaler Architekturvertrag**.

Auch eine spätere manuelle Turmübernahme bleibt ein optionaler Erweiterungsfall: Der Turm behält Weapon-/Readiness-/Execution-Authority; der Player liefert als Controller Aim-/Fire-Intent. Dafür wird kein Turm-Loadout in den Player kopiert.

Für solche Fälle bleiben bei Bedarf **Execution Actor, Controller, Attribution, Lineage und Allegiance** unterscheidbar. Die konkrete Hit-/Kill-Zuordnung ist eine darauf aufbauende Gameplay-Policy und wird nicht durch die Control-Infrastruktur fest verdrahtet.

## 22. World und Activity

### World

World besitzt bzw. bindet fachlich:

- Geometrie / Placeables,
- world-langlebige Gameplay-Systeme,
- Player-Gameplay,
- World-Bindings scene-langlebiger Legacy-Core-Systeme,
- World-Presentation-Verdrahtung.

### Activity

Activity besitzt:

- Mission / Regeln,
- Objectives / Encounter,
- activity-spezifische Enemy-Owner,
- Abschluss / Rewards,
- Activity-Presentation.

Ein Activity-Wechsel derselben World soll Player Resources, Loadout-Grundstate und allgemeine Gameplay-Basis nicht neu erzeugen. Activity-State selbst wird vollständig beendet.

World-scoped Player-Gameplay hält deshalb langfristig **keine konkrete Activity-Runtime**. Activity-spezifische Reads, Modifier und Aktionen werden über schmale attach-/detach-bare Gameplay-Bindings bzw. Ports eingespeist. Beim Activity-Wechsel wird nur dieses Binding ersetzt; Player-Gameplay-State mit längerer Lifetime bleibt bestehen.

---

## 23. Network und Projectile Replication

Network transportiert und repliziert, Domain entscheidet. Das gilt ausdrücklich auch für Relationship-/Allegiance- und aktiven Gameplay-Kontext: Transport darf Team-, World- und Activity-Daten bereitstellen, aber keine fachliche Friend/Enemy-, Target-Eligibility- oder GameMode-Regel als eigene Authority besitzen. Der heutige `NetworkBridge` ist an diesen Stellen Legacy-Migrationsanker.

```text
Gameplay Owner
↕ kleiner fachlicher Port
Network Adapter / Composition
↕
NetworkBridge / Transport
```

Neue Runtime-Owner erhalten kleine Ports/Callbacks und **keine neue direkte `NetworkBridge`-Abhängigkeit**. Im ersten Player-Gameplay-Cutover wird die heutige direkte `NetworkBridge`-Abhängigkeit aus dem Loadout-/Ability-Core entfernt; Transport und Publikation liegen an Adapter-/Composition-Grenzen.

Die eingefrorene Legacy-Consumer-Liste wächst nicht.

### 23.1 Control Sessions

Control Sessions sind ein optionaler Netzwerkfall und **kein Pflichtumfang des ersten Player-Gameplay-Refactorings**.

Wenn eine solche Session implementiert wird, autorisiert der Host sie. Repliziert wird nur der State, den Input-Routing und Presentation tatsächlich benötigen; Weapon Config, Readiness und Fire-Ergebnis bleiben autoritative Actor-/Gameplay-Daten und werden nicht vom Client entschieden. Fire-/Aim-Intents werden dabei an die aktuelle Session-Identität bzw. Generation gebunden, sofern verspätete Nachrichten sonst eine nachfolgende Session beeinflussen könnten.

### 23.2 Projectile Replication

Projectile Replication ist Projektion der Simulation:

```text
Projectile Simulation
↓
Replication Projection
↓
Snapshot / Delta / Codec
↓
Network
```

Simulation kennt keinen Codec und trifft keine Wire-Entscheidung.

Wenn sich Attribution oder Allegiance eines Projectiles durch Reflection oder andere Interaction ändern, muss die Replication den **für den Client relevanten autoritativen Zustand** transportieren können. Zusätzliche Lineage-/Controller-Correlation wird nur repliziert, wenn korrekte Darstellung oder Prediction sie tatsächlich benötigt.

World-/Activity-scoped Nachrichten bleiben revisionsgebunden; stale State darf keine neue Runtime beeinflussen.

## 24. Projectile Presentation

Der heutige `ProjectileManager` vermischt Host-Simulation, Network-State, Client-Extrapolation und zahlreiche Renderer.

Diese Achsen werden **getrennt migriert**.

Ziel:

```text
replizierter / lokaler Projectile Read State
↓
Client Projection / Interpolation
↓
Projectile Presentation
↓
Renderer
```

Fragdachse besitzt inzwischen `WorldPresentationFrameBinding`.

Daraus folgt:

- Projectile-Presentation schließt an den bestehenden World-Presentation-Lifecycle an.
- Kein paralleler Projectile-Presentation-Lifecycle.
- Kein zweiter Client-World-Presentation-Step.
- scene-langlebige Renderer dürfen hinter world-scoped Presentation-Bindings bleiben.
- Simulation hängt nicht von Renderer-Existenz ab.
- Aim-/Windup-/Telegraph-Darstellung projiziert Behavior-/Action-State und besitzt ihn nicht.
- Control-Mode-HUD projiziert den Read State des kontrollierten Actors/Turms und wird nicht zur Weapon-/Readiness-Authority.

Network- und Renderer-Entkopplung sind unterschiedliche Schritte und werden nicht als Big-Bang gekoppelt.

## 25. Persistence / Progression

Persistence speichert dauerhaften Meta-Zustand und liefert normalisierte Daten:

```text
Persistence / Progression
↓
Resolved Config / Modifiers
↓
Gameplay Runtime
```

Kein Combat-/Projectile-/Ability-System kennt Save-Schema oder LocalStorage-Modell.

Persistence und Runtime interpretieren dieselbe Unlock-/Upgrade-Regel nicht unabhängig. Loadout und Ability konsumieren aufgelöste Konfigurationen/Modifier, statt Progressionsregeln erneut zu deuten.

---

# Teil D – Migrationsanker des aktuellen Repositorys

## 26. Relevante bestehende Grenzen

| Bestehende Struktur | Rolle für das Zielbild |
|---|---|
| `WorldRuntime` | etablierter World-Lifecycle mit Activity-Slot, Bindings, Teardown und Presentation-Handoff |
| `ArenaContext` | scene-langlebige Core-Instanzen; zeigt die wichtige Trennung fachliche vs. physische Lifetime |
| `ArenaRuntime` / Ports | aktuelles Beispiel für consumer-orientierte Boundary statt Durchgriff auf interne Owner |
| `WorldPlayerGameplayRuntime` | bestehender Composition-Punkt; wird zur öffentlichen Boundary für world-scoped Player-Gameplay statt `systems.*`-Durchgriff |
| `PlayerWorldRuntimeComposition` | bestehender per-Player Attach-/Detach-Lifecycle; schützt Player-in-World gegen Join/Leave-Verwechslung mit Respawn/World-Teardown |
| `WorldCombatGameplayBinding` | kontrolliert World-Bindings des breiten Legacy-Core-Graphs; soll schrittweise kleiner werden |
| `WeaponFireExecutor` | gemeinsamer zustandsarmer Immediate-Execution-Migrationsanker |
| `CoopDefenseEnemyAttackSystem` / Enemy Ability | vorhandene Windup-/Timing-Muster; Migrationsanker für klare Pre-Commit-Behavior-Semantik |
| `ResourceSystem` | fokussierter Player-Resource-Owner |
| `HostHeldActionSystem` | hostautoritative Action-Identität und Consume-Semantik |
| `HostUpdateCoordinator` | sichtbarer Sequencing-Owner; soll Player-Gameplay über Boundary-Schritte/Ports statt konkrete Child-Systeme orchestrieren |
| `ProjectileManager` | Hauptziel späterer Trennung von Simulation, Replication und Presentation |
| `CombatSystem` | heutiger zentraler Combatant-Damage-Owner mit erheblicher Interaction-/Weapon-Kopplung; nicht Ziel-Owner für jeden World-Health-State |
| `BaseManager` / `RockHpRegistry` / World-Train | bestehende Beispiele eigener kanonischer Health-/Destruction-Writer außerhalb des Combatant-State |
| `WorldTargetingRuntime` / `TargetStatusSystem` | bestehender world-scoped Owner für allgemeinen Target-Status; Referenz für Status-Ownership außerhalb des Combat-Kerns |
| `NetworkBridge.isEnemyPair` / `getActiveGameMode` | heutige Legacy-Orte fachlicher Relationship-/Gameplay-Kontext-Auflösung; langfristig Domain-Policy statt Transport-Authority |
| Enemy Attack / Ability | bestätigt Hybrid-Modell aus activity-scoped Orchestrierung + shared Execution |
| `TurretSystem` | bestätigt Targeting/Readiness + Fire-Handler-Muster; Basis für spätere schmale Focus-/Manual-Control-Commands |
| Tesla-Dome-Reflection in `CombatSystem` | heutiger Referenzfall für Reflection mit geänderter Attribution/Allegiance; wird später an Interaction-Grenzen entkoppelt |
| Spawn-Granate + `HostUpdateCoordinator.spawnEnemiesFromGrenade` | heutiger Referenzfall für Reflection-bedingte Payload-/Allegiance-Transformation |
| `WorldPresentationFrameBinding` | bestehender Owner für World-Presentation-Verdrahtung |
| `combat/rules/*` | vorhandener Stil für kleine, headless nutzbare Regelkerne |

Diese Strukturen sind **Migrationsanker, keine Verpflichtung, ihre heutigen internen Grenzen unverändert zu konservieren**.

---

# Teil E – Ebene 3: Migration und Übergangs-Invarianten

## 27. Allgemeine Regeln während jeder Phase

1. Genau eine Authority pro fachlicher Regel.
2. Compatibility-Code übersetzt nur in eine Richtung.
3. Alte und neue Pfade mutieren nicht unabhängig denselben State.
4. Neuer State hat explizite Lifetime und vollständigen Teardown.
5. Keine neue direkte `NetworkBridge`-Abhängigkeit; Loadout-/Ability-Core verliert sie im ersten Cutover.
6. Neue World-/Activity-Owner übernehmen keinen `ArenaContext` als Service Locator.
7. Gameplay-relevante Frame-Reihenfolge bleibt erhalten oder wird bewusst als Vertragsänderung behandelt.
8. Nach Cutover wird der alte Writer entfernt oder inert.
9. Tests schützen Semantik und Grenzen, nicht historische Dateipositionen.
10. Erweiterbarkeit ist kein Implementierungsauftrag: keine Control-, Scheduler-, Attribution- oder Context-Infrastruktur ohne heutigen Migrationsdruck.
11. Jeder im jeweiligen Cutover neu eingeführte oder veränderte retriable autoritative state-changing Command besitzt definierte Duplicate-Semantik; derselbe commit-tragende Attempt/Request committet innerhalb seines fachlichen Scopes höchstens einmal, während eine länger laufende Action mehrere ausdrücklich modellierte Executions enthalten darf. Bestehende unabhängige RPCs werden nicht allein wegen dieses Refactorings migriert.
12. Gameplay-relevante Modifier besitzen einen expliziten Resolution-Zeitpunkt.
13. Authoritative Randomness ist testbar; rein visuelle Randomness bleibt Presentation-Detail.
14. „Ein Writer“ gilt pro fachlichem State; Combat wird nicht zum globalen Writer fremder World-Domains.
15. Player-in-World Attach/Detach bleibt von Respawn und reinem World-Teardown semantisch unterscheidbar.
16. Der kanonische State-Owner erkennt Health-/Armor-/Integrity-Transitions atomar mit seiner Mutation; Death/Destroyed wird nicht downstream unabhängig neu entschieden.

---

## 28. Phase-Gates

| Gate | Minimale Invarianten |
|---|---|
| **Action / Activation** | Input erzeugt semantische Actions; Host besitzt Held-/Charge-Identität; im Cutover neu eingeführte oder veränderte retriable state-changing Commands besitzen definierte Duplicate-Semantik; commit-tragende Attempt-/Request-Identitäten besitzen At-most-once-Commit, während eine länger laufende Action mehrere explizite Executions enthalten darf; normaler Player-Pfad bleibt direkt; spätere Delegation wird nicht verbaut, aber kein generischer Router vorgebaut; Client Prediction bleibt nichtautoritative Projektion mit stabiler Correlation; kein paralleler alter Input-Wirkungspfad |
| **Player-Gameplay-Boundary** | Host/RPC/Input konsumieren fachliche Schritte/Ports; kein dauerhafter Durchgriff über `WorldPlayerGameplayRuntime.systems.*`; Activity-Anbindung ist attach-/detach-bar; Player-in-World Join/Leave räumt Player-State vollständig auf, ohne Respawn damit zu vermischen |
| **Loadout** | eine Slot-/Ausstattungs-Authority; ausgelagerter State hat einen Writer; Core ohne direkte `NetworkBridge`-Abhängigkeit; Modifier werden konsumiert statt erneut interpretiert und haben explizite Resolution-Zeitpunkte; neue Spezialmechanik bläht keinen globalen Config-Sack weiter auf |
| **Resource / Readiness / Commit** | Resources und ability-lokale Readiness haben eindeutige Owner; Commit-Position ability-spezifisch; fachliche Zeit ist explizit; Pre-Commit-Fehler ohne Kosten sofern nicht anders authored; Post-Commit kein implizites Rollback |
| **Execution Capabilities** | Immediate/Deferred/Sustained-Lifetime ist semantisch klar; pro Mechanik ein autoritativer Pfad; Execution Actor, Controller, Gameplay Source, Attribution, Lineage und Correlation bleiben soweit relevant erhalten; committed Deferred Effects hängen nicht implizit am ursprünglichen Actor; keine Universal-Execution-Runtime und kein universeller Context als Pflicht |
| **Behavior** | ausgelagerter State nicht mehr gleichzeitig im Loadout; Behavior orchestriert optional Activation/Commit/Execution; Start/Cancel/Destroy eindeutig |
| **vor Projectile** | Lower Layers kennen kein Input; neue Abilities greifen nur über stabilisierte Execution-Verträge auf bestehende Projectile-/Combat-Pfade zu |
| **Projectile Simulation** | Spawn/Flight/Collision-Parität; stabile IDs; Reflection/Deflection sowie Attribution-/Allegiance-Änderungen genau einmal; notwendige Lineage und Correlation bleiben erhalten; Renderer beeinflussen Host nicht |
| **Projectile Network** | Bootstrap/Delta/Removal unverändert; Simulation kennt keinen Codec |
| **Projectile Presentation** | World-Presentation-Lifetime; kein zweiter Client-Step; Handoff/Detach bleibt korrekt |
| **Combat** | gemeinsame Combat-/Damage-Resolution ist klar von Health-/Armor-Storage getrennt; genau ein Writer je fachlichem Health-/Damage-State; Player/Enemy/Base/Rock/Train/andere Domain-States bleiben beim kanonischen Owner sofern kein konkreter Migrationsgrund besteht; der kanonische State-Owner erkennt Death/Destroyed atomar mit der Mutation und liefert ein eindeutiges Outcome; Kill Attribution und Folgeeffekte konsumieren dieses Outcome statt den Übergang neu zu entscheiden; Status-State besitzt expliziten Owner; Reaction-Chains sind deterministisch/reentrancy-sicher; aktuelle Attribution/Controller-Semantik wird korrekt konsumiert; Impact/Reflection/Deflection genau einmal |
| **Network / Domain** | Transport trifft keine Friend/Enemy-, Target-Eligibility- oder Gameplay-Kontext-Entscheidung neu; stale World-/Activity-/Session-Nachrichten können keine aktuelle Runtime mutieren |

---

## 29. Besonders zu schützende Semantik

Bei den Refactorings dürfen insbesondere nicht unbemerkt verändert werden:

- Resource-Verbrauch am fachlich korrekten Commit-Punkt,
- getrennte Held-/Action-, Attempt-/Request-, Execution-/Shot- und Prediction-Identitäten bei verspäteten Releases und Reconciliation; im jeweiligen Cutover neu eingeführte oder veränderte retriable state-changing Commands besitzen definierte Duplicate-Semantik und Retries desselben commit-tragenden Attempts erzeugen keine zweite Commit-Mutation; bestehende unabhängige RPCs werden nicht allein wegen dieser Phase migriert,
- Pre-Commit-Interrupt vs. Post-Commit-Deferred-Lifetime,
- bereits committed Deferred Effects bei Tod/Stun/Despawn des ursprünglichen Actors,
- Weapon-/Salvo-Cooldowns und explizite Forced-Fire-Overrides,
- Kill Attribution,
- getrennte Execution-Actor-/Controller-/Attribution-Semantik,
- Attribution-/Allegiance-Änderungen bei Reflection,
- getrennte Lineage und Correlation bei reflektierten und gesplitteten Projectiles,
- reflektierte Spawn-Payloads und deren allied/hostile Semantik,
- Rage-/Adrenalin-Gain,
- Item-/Upgrade-Post-Hit-Effekte und der explizite Resolution-Zeitpunkt ihrer Modifier,
- authoritative Randomness für gameplay-relevante Outcomes,
- Relationship-/Allegiance-Auflösung als Domain-Regel statt Network-Authority,
- genau ein Health-/Damage-Writer pro Target-Domain, atomare Death-/Destroyed-Transition beim kanonischen State-Owner und explizites Status-Ownership,
- deterministische Reaction-Chains ohne doppelte Verarbeitung,
- Projectile-IDs und Network-Baselines,
- Impact-Debouncing,
- Explosion → Damage → Knockback → Environment → World-Effect-Reihenfolge, soweit fachlich relevant,
- World-/Activity-Detach und stale-binding safety,
- Player-in-World Join/Leave-Detach getrennt von Respawn,
- Control-Session-Teardown, falls eine solche Session implementiert ist,
- Presentation-Handoff.

# Teil F – Refactoring-Reihenfolge

## 30. Empfohlene Sequenz

```text
ArenaRuntime                         abgeschlossen
↓
ArenaScene                          weitgehend abgeschlossen / stabilisieren
↓
Player Action / Loadout / Ability
↓
Host-/Client-Update + Activity-Boundary-Cleanup
↓
Projectile Runtime
  ├ Simulation / Impact-Seam
  ├ Replication
  └ Presentation
↓
Combat Runtime
↓
Enemy Movement / Steering
↓
Activity Authoring
↓
Meta / Persistence
↓
NetworkBridge intern
↓
inkrementelle Shared-Contract-Bereinigung
```

### Warum der Boundary-Cleanup vor Projectile?

Nach dem Player-Gameplay-Cutover sollen Host-/Client-Update und world-scoped Gameplay nicht erneut konkrete Activity-/Child-Runtimes durchreichen. Der kleine Folge-Cleanup schließt diese obere Orchestrierungsgrenze, bevor Projectile und Combat darunter verändert werden.

### Warum Projectile vor Combat?

Player-Gameplay liefert zuerst eine saubere Execution-Grenze.

Projectile kann dann Spawn, Flight und Collision isolieren sowie Network/Presentation abtrennen. Danach lässt sich Combat leichter von Projectile-Lifecycle und weapon-spezifischer Interaktion lösen.

### Warum nicht Projectile + Combat gemeinsam?

Beide sind heute tief gekoppelt. Ein gemeinsamer Umbau würde Collision, Impact, Damage, Network, Rendering und Weapon-Sonderregeln gleichzeitig verändern und wäre faktisch ein Big-Bang.

---

# Teil G – Ebene 4: Validierungsfälle und Beispiel-Flows

> Diese Flows validieren das Zielbild. Sie sind keine zusätzliche Pipeline-Spezifikation und kein Auftrag, nicht benötigte Infrastruktur vorsorglich zu implementieren.

## 31. Spieler-Rakete

```text
Input
→ Player Action
→ Loadout / Activation
→ Projectile Execution akzeptiert
→ Commit + Resource
→ Projectile Simulation
→ Impact
→ Combat-/Impact-Resolution
→ kanonische Target-Mutation
→ Outcome
→ Presentation
```

## 32. HE-Granate

```text
E held
→ Host Held Action
→ Charge
→ Release / Validate
→ Projectile-Execution akzeptiert
→ Commit: Charge + Cooldown
→ Explosion
→ Combat-/Environment-Resolution
→ kanonische Domain-Mutationen
```

## 33. Flamethrower

```text
Player Action
→ Readiness / Commit
→ specialized Immediate Execution
→ Flame Projectile
→ Projectile Simulation
→ Impact / Burn
```

Ein besonderer Payload erfordert nicht automatisch einen Ability-Behavior.

## 34. Energy Shield

```text
Player Action
→ Activation / Commit
→ Sustained Effect Runtime
   ├ refresh / update
   ├ Projectile Interaction
   ├ Resource Drain
   └ stop / destroy
```

Hier ist eigener langlebiger Runtime-State gerechtfertigt.

## 35. Enemy / Turret

```text
Enemy:
AI / Salvo / Windup → Commit → Immediate oder Deferred Execution → Projectile/Direct → Impact → Combat

Turret automatisch:
Targeting / Burst / Readiness → Execution → Projectile → Impact → Combat

Optionaler Turret Command:
Utility/Ability → zeitlich begrenzter Command → Turret-eigene Policy → gemeinsame Execution
```

Der Command mutiert die dauerhafte Turret-/Weapon-Config nicht. Welche konkreten Checks er überschreiben darf, gehört zur jeweiligen Feature-Spezifikation und nicht in den globalen Architekturvertrag.

## 36. Mörser

```text
Enemy AI
→ Mortar Behavior
   ├ ability-spezifisches Positioning
   ├ Windup / Telegraph
   ├ Interrupt
   ├ THUMP = Commit
   └ Recovery
→ Deferred Timed Strike
→ Explosion / Combat / Environment
```

Nach `THUMP` lebt der Timed Strike unabhängig vom Enemy-Behavior bis zu seiner Auflösung oder einem explizit authored Post-Commit-Cancel weiter.

### 36.1 Delayed Hitscan mit flexiblem Windup

```text
Enemy AI
→ Behavior
   ├ initialer Zielpunkt (x, y)
   ├ optionales Positioning / Winkelanpassung
   ├ optionaler finaler Movement-/Aim-Lock
   ├ harter Interrupt möglich
   └ Commit
→ Immediate Hitscan
```

Alternativ kann nach Commit noch ein eigener Deferred Trigger folgen. Wann Ziel, Aim oder Bewegung eingefroren werden, ist ability-spezifisch und kein globaler Runtime-Vertrag.

### 36.2 Manuelle Turmübernahme

```text
Player Input
→ Player Action
→ optionale hostautorisierte Control Session
→ Controlled Turret
   ├ turret-owned Weapon / Readiness / Buffs
   ├ Player liefert Aim / Fire Intent
   └ HUD liest kontrollierten Turret-State
→ Execution
→ Projectile / Impact / Combat
```

Dieser Flow ist ein **Architektur-Validierungsfall**, kein Pflichtumfang des ersten Player-Gameplay-Refactorings. Execution Actor, Controller und Attribution bleiben unterscheidbar; die Hit-/Kill-Policy kann später unabhängig davon festgelegt werden.

### 36.3 Reflection einer Enemy-Spawn-Granate

```text
Enemy Projectile
→ Tesla-Dome Interaction
→ Reflection / aktuelle Attribution und Allegiance ändern sich
→ Projectile fliegt mit neuer autoritativer Semantik weiter
→ Spawn-Payload triggert
→ allied statt hostile Spawn
```

Das bestehende Verhalten ist Zielsemantik: Reflection darf downstream Attribution und Allegiance gemäß ihrer Interaction-Regel verändern, ohne dass Combat die konkrete Waffe kennen muss. Die heutige technische Kopplung über `ownerId` ist dabei kein zwingender Bestandteil des Zielbilds.

# Teil H – Konsolidierte Review-Checkliste

## 37. Ebene-2-Detailinvarianten für Architektur-Reviews

Die Detailverträge aus §§ 2–25 werden für Reviews in sechs Prüffelder verdichtet. Diese Tabelle ist **kein zweites Regelwerk**; bei einer konkreten Änderung gilt der jeweilige Fachabschnitt.

| Prüffeld | Verdichtete Invarianten |
|---|---|
| **Ownership / Lifetime** | Owner und Authority folgen der kleinsten fachlichen Lifetime; World-/Activity-/Player-in-World-/Effect-State endet an seiner tatsächlichen Grenze; pro fachlichem State gibt es nach Cutover genau einen Writer; Health-/Status-State bleibt beim kanonischen Domain-Owner. |
| **Action / Loadout / Ability** | Action Initiator, Kategorie und Mechanik bleiben getrennt; Commit ist ability-spezifisch; Pre-Commit und Post-Commit besitzen getrennte Semantik; retriable state-changing Commands besitzen definierte Duplicate-Semantik; eine Action darf mehrere Executions enthalten, aber derselbe commit-tragende Attempt/Request committet höchstens einmal; Loadout bleibt Ausstattung/Resolution-Boundary und materialisiert nur Modifier, deren Resolution-Zeitpunkt dort liegt; dynamische Runtime-/Target-Modifier bleiben bei ihrer Policy. |
| **Execution / Projectile / Interaction** | Execution besteht aus schmalen Capabilities; Immediate/Deferred/Sustained und Spezialisierungsgrad werden nicht vermischt; Projectile besitzt Flight statt allgemeiner Damage-Authority; Attribution/Allegiance/Lineage gehen bei Mutation nicht verloren; Impact ist nur für interaktionsproduzierende Pfade Pflicht, direkte Domain-Actions dürfen unmittelbar zum kanonischen Owner gehen. |
| **Combat / Reactions** | Combat besitzt gemeinsame Combat-/Damage-Resolution-Semantik, nicht automatisch zentralen Health-Storage; der kanonische State-Owner mutiert Health/Armor/Integrity und erkennt Death/Destroyed atomar, Kill Attribution konsumiert dieses Outcome; Kollision ist nicht automatisch Damage; Status folgt seinem Domain-Owner; autoritative Reactions laufen sichtbar vor passiven Observations; Chains/Reentrancy sind deterministisch und erzeugen keine doppelte Mutation. |
| **Attribution / Relationship / Adapter** | Execution Actor, Controller, Gameplay Source, Attribution, Allegiance, Lineage und Correlation bleiben bei Bedarf unterscheidbar; `Faction` ist optional und separat; Relationship ist Domain-Semantik; Network, Presentation und Persistence transportieren/projizieren, entscheiden aber keine Gameplay-Regeln neu; Prediction bleibt nichtautoritativ. |
| **Orchestrierung / Abstraktionsdisziplin** | Frame-Reihenfolge, Zeit, gameplay-relevante Randomness und Modifier-Resolution sind testbar; keine universellen Event-Busse/Router/Contexts/Scheduler/Registries ohne konkreten Druck; `WorldPlayerGameplayRuntime` bleibt consumer-orientierte Boundary; Erweiterbarkeit ist kein Implementierungsauftrag; Coordinatoren werden nach Verantwortung statt LOC bewertet. |

# Teil I – Entscheidungslandkarte

> Für Coding-KIs ist die Entscheidungslandkarte eine **Review-Hilfe**, keine zusätzliche Regelschicht. Sie verweisen auf die Kernprinzipien und Detailverträge.

## 38. Entscheidungslandkarte

| Frage | Zielzuständigkeit |
|---|---|
| Welche Eingabe kam an? | Input |
| Wer initiiert die fachliche Action? | Action Initiator |
| Was versucht der Spieler? | Player Action |
| Welche Ability liegt auf dem Player-Slot? | Loadout |
| Wie wird sie ausgelöst? | Activation |
| Welche Action ist hostseitig aktiv? | Held/Activation State |
| Wann wird sie verbindlich? | ability-spezifische Commit Rule |
| Ist eine Verzögerung noch Windup oder bereits committed? | Behavior vor Commit / Deferred Execution nach Commit |
| Wer besitzt einen committed späteren One-shot? | kleinster semantisch passender Deferred-Effect-Owner |
| Wer reconciled lokale Vorhersage mit Host-State? | Client Prediction / Network Adapter |
| Was passiert bei einem Duplikat eines autoritativen state-changing Commands? | jeweilige Command-/Action-/Session-Grenze mit definierter Duplicate-Semantik |
| Was passiert bei einem Retry desselben commit-tragenden Attempts/Requests? | Host-Action-Grenze / At-most-once-Commit + wiederverwendbares finales Outcome |
| Welche Ressource wird verbraucht? | Resource Owner / Policy |
| Wann ist das Tool wieder bereit? | Equipped Ability / Readiness Policy |
| Wann wird ein Modifier ausgewertet? | konkrete Modifier-Policy: Commit/Spawn/Impact/Tick explizit |
| Welche fachliche Zeit gilt? | sichtbarer Orchestrierungs-/Frame-Input |
| Welche spezielle Orchestrierung läuft? | Ability Behavior |
| Wann wird Target/Aim/Movement eingefroren? | ability-spezifisches Behavior |
| Was soll ausgeführt werden? | passende Execution Capability |
| Wer führt eine Wirkung fachlich aus? | Execution Actor / passende Runtime |
| Wer liefert bei Delegation Intent? | optionaler Controller |
| Welche fachliche Mechanik hat die Wirkung erzeugt? | Gameplay Source |
| Wem wird die Wirkung aktuell zugerechnet? | Attribution Policy |
| Welche Friendly-/Hostile-/Neutral-Semantik gilt? | Allegiance Policy |
| Sind zwei Actors in diesem World-/Activity-Kontext Freunde oder Gegner? | Domain-Relationship-Policy, nicht Network |
| Welche kausale Gameplay-Abstammung muss erhalten bleiben? | Lineage |
| Welche Requests/Predictions/Executions müssen zusammengeordnet werden? | Correlation |
| Wie fliegt ein Projectile? | Projectile Simulation |
| Was wurde kollidiert? | Collision / Impact Candidate |
| Wird geblockt, reflektiert, umgeleitet, Attribution/Allegiance geändert oder Damage erzeugt? | Impact / Interaction |
| Welche Damage-Regel gilt? | Combat-/Impact-Policy |
| Wer mutiert den betroffenen Health-/Armor-State? | kanonischer Owner der Target-/Combatant-Domain |
| Wer entscheidet beim HP-/Integrity-Übergang `becameDead` / `becameDestroyed`? | derselbe kanonische State-Owner atomar mit der Mutation |
| Wer ordnet einen daraus entstandenen Kill zu? | Combat-/Attribution-/Reward-Policy auf Basis des Mutation-Outcomes |
| Wer besitzt einen allgemeinen Status? | kleinster passender Target-/World-Owner |
| Welche fachliche Reaktion mutiert danach State? | Authoritative Reaction / Behavior mit expliziter Chain-/Reentrancy-Semantik |
| Wer beobachtet das Ergebnis nur? | Observation / Network / Presentation |
| Wie wird Projectile-State repliziert? | Network Adapter |
| Wie wird Projectile-State dargestellt? | World-Presentation |
| Wann greift ein Enemy an? | Enemy AI / Attack Runtime |
| Welche Phasen hat ein Enemy-Special? | Enemy Behavior |
| Wann feuert ein Turret automatisch? | Turret Runtime |
| Wie beeinflusst ein externer Turret-Command die Regeln? | konkrete Turret-Command-Policy |
| Welche Mission ist aktiv? | Activity |
| Welche World existiert? | World Runtime |
| Ist ein Player noch Teilnehmer dieser World oder nur respawnend? | Player-in-World Lifecycle / Participation |
| Was bleibt zwischen Matches erhalten? | Meta / Persistence |
| Wer bietet world-scoped Player-Gameplay nach außen an? | Player-Gameplay-Boundary |
| Wer ordnet den Host-Frame? | Host Frame Coordinator |
