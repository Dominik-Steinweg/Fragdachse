# Fragdachse – Projectile Runtime Architecture Core

**Status:** Normative Architekturgrundlage – immer zu laden
**Geltungsbereich:** Projectile Spawn, autoritative Simulation, Flight, Collision/Interaction, Domain-Grenzen, Replication, Client-Replica und Presentation
**Repository-Abgleich:** `main` @ `c6f83bc864c4cf8daa98d32bd6a29ee9a8926ab5` vom 04.09.2026; der Projectile-Produktionscode ist gegenüber `2040afa7c339f68a5b35bbbd3a43e8730586d3c2` unverändert, die Testarchitektur wurde inzwischen separat refactored
**Detaildokument:** `02_Projectile_Runtime_Architecture_Details.md`
**Spätere Dokumente:** `03_Projectile_Runtime_Implementation_Plan.md`, `04_Projectile_Runtime_Migration_Status.md`

> `01` enthält nur dauerhaft gültige Architekturregeln und wird bei jeder Implementierungsphase geladen.
> `02` präzisiert Zielcontracts, Datenzuschnitt, Processing, Sonderfälle und Migrationsseams und wird nur abschnittsweise geladen.
> `03` beschreibt Reihenfolge, Phasen und Gates. `04` beschreibt ausschließlich den realisierten Zwischenstand.
> Kein späteres Dokument darf die hier definierten Authority-, Ownership-, Lifetime- oder Abhängigkeitsregeln aufweichen.

---

## 1. Ziel

Das Projectile-Runtime-Refactoring ist ein **Architektur- und Ownership-Refactoring**. Bestehende Gameplay-Semantik bleibt grundsätzlich erhalten; neue Gameplay-Features sind nicht Bestandteil.

Ziel ist eine Architektur, in der:

- autoritativer Projectile-State klar world-owned ist,
- Flight, Collision und fachliche Wirkung unterscheidbar bleiben,
- Projectile-Interaktion von fremder Domain-Mutation getrennt ist,
- Spezialmechaniken durch explizite kombinierbare Semantik statt durch Mega-State oder Type-Switches beschrieben werden,
- Replication und Client-Replica keine Gameplay-Authority besitzen,
- Presentation vollständig außerhalb der autoritativen Simulation liegt,
- ein späterer Combat-Refactor unterhalb einer stabilen Projectile↔Combat-Grenze stattfinden kann.

> **`WorldProjectileRuntime` besitzt die Projectile-Lifetime und autoritative Projectile-Authority. Daten dürfen kompositorisch und data-oriented organisiert werden; fachliche Ownership und die autoritative Ablaufreihenfolge bleiben explizit.**

---

## 2. Dokumentenrollen

```text
01 Architecture Core
       +
02 Architecture Details
       │
       ▼
03 Implementation Plan
       │
       ▼
04 Migration Status
```

- **01 + 02** bilden gemeinsam die Zielarchitektur.
- **01** enthält nur Regeln, die jede Phase kennen muss.
- **02** ist gezielt zu laden und darf konkrete Contracts/Sonderfälle enthalten.
- **03** referenziert pro Phase die relevanten §§ aus `02`, legt aber keine neue Architektur fest. Es führt ein Cross-Phase-Contract-Manifest: stabile Contract-Familien werden einmal materialisiert und danach wiederverwendet.
- **04** enthält nur Status, realisierte Contract-Namen, offene Migrationen und die nächste Phase. Commit-Historie und Commit-SHAs bleiben ausschließlich in Git. Realisierte Type-/API-Namen aus dem Contract-Manifest werden dort dokumentiert.
- Coding-KIs dürfen `04` fortschreiben, `01`–`03` aber nicht selbständig umdefinieren.

---

## 3. Kernprinzipien

1. **World-owned / Host-authoritative**
   Autoritative Projectiles gehören zur World und leben höchstens so lange wie diese World.

2. **Eine öffentliche Boundary**
   `WorldProjectileRuntime` ist die einzige öffentliche world-owned Projectile-Gameplay-Grenze. Obere Consumer traversieren keine internen Komponenten.

3. **Execution endet vor Projectile**
   Player-/Enemy-/Turret-/World-Execution übergibt einen fachlich aufgelösten `ProjectileSpawnRequest`. Loadout, Resource, Readiness, Ability-Commit und Player-Behavior bleiben außerhalb.

4. **Flight, Collision und Wirkung sind getrennt**
   Eine Collision ist Geometrie, keine automatische Domain-Mutation.

5. **Normative Interaction-Kette**
   Kollisionsbasierte Wirkung folgt fachlich:
   `Collision → Impact Candidate → Interaction Resolution → typisierte Resultate`.

6. **Andere Trigger bleiben explizit**
   Expiry, Proximity und externe/gekuppelte Detonation werden nicht künstlich als Collision modelliert.

7. **Daten komponieren, Abläufe explizit orchestrieren**
   Projectile-Behavior darf aus kleinen Flight-/Interaction-/Augment-/Capability-Daten zusammengesetzt werden. Die autoritative Processing-Reihenfolge bleibt sichtbar in der Runtime.

8. **Lokale Data-Oriented-Optimierungen nur bei konkretem Nutzen**
   Kleine spezialisierte Processor, private Capability-Indizes, Pooling und sparse Feature-State sind erlaubt, wenn sie Ownership, Verständlichkeit, Testbarkeit oder einen nachgewiesenen Hot Path verbessern. Sie sind Optimierungswerkzeuge, nicht das Zielarchitekturmodell. Fragdachse wird **nicht** auf ein globales ECS-Modell umgestellt.

9. **Kein generischer ECS-Unterbau**
   Keine globale Entity-/Component-/System-Registry, kein generischer Scheduler, keine Behavior-Registry und keine Component-Stores für triviale/universelle Daten ohne realen Nutzen.

10. **Semantik statt Presentation-Type**
    `projectileStyle` klassifiziert Darstellung. Gameplay-Behavior wird aus expliziten Flight-, Collision-, Interaction-, Homing-, Path-/Status- und Augment-Daten abgeleitet.

11. **Provenance ist mehrdimensional**
    `Gameplay Source`, `Attribution`, `Allegiance`, `Lineage` und `Correlation` bleiben unterscheidbar. Ein einzelnes `ownerId` darf sie nicht wieder vermischen.

12. **Ein Writer pro Domain-State**
    Projectile darf Damage, Support oder World-Wirkung anfordern, mutiert aber fremden Health-/Armor-/Integrity-/Progression-State nicht selbst.

13. **Request und Outcome sind verschieden**
    Interaction Results beschreiben, was angewendet werden soll. Reactions, die vom tatsächlichen Effekt abhängen, konsumieren das bestätigte authoritative Outcome.

14. **Replication ist Adapter, nicht Authority**
    Netzwerkzustand projiziert autoritativen State. Client-Replica entscheidet keine Treffer, Reflection, Explosion oder Gameplay-Removal-Regeln.

15. **Presentation ist passiv**
    Renderer, VFX, Audio, Licht und Schatten konsumieren State/Outcomes, erzeugen aber keine Gameplay-Wahrheit. Presentation-Metadaten sind für die Simulation opaque: Gameplay darf sie speichern oder projizieren, aber niemals interpretieren.

16. **Explizite Zeit und Reihenfolge**
    Gameplay-relevante Zeit kommt ausschließlich aus explizit übergebenem hostautoritativem Frame-/World-Kontext (`nowMs`, `deltaMs`). Versteckte Wall-Clock-Zugriffe wie neues `Date.now()` oder `performance.now()` in autoritativer Projectile-Logik sind verboten. Same-Frame-Interactions besitzen eine deterministische, nachvollziehbare Reihenfolge.

17. **Stabile Combat- und Domain-Effect-Grenzen**
    `ProjectileCombatPort` löst ausschließlich Combat-eigene Regeln auf. Cross-Domain-Explosion-Fan-out zu Combat, Environment, Ground Fire, Knockback oder World Effects läuft über eine separate schmale Projectile→Domain-Effect-/Explosion-Grenze. Ein späterer Combat-Refactor darf darunter stattfinden, ohne Projectile strukturell umzubauen.

18. **Kanonische Target-Identität**
    Dieselbe physische/domain Entity besitzt innerhalb der Projectile-Runtime genau eine kanonische Target-Identität. Technische Collider- oder Legacy-Kategorien dürfen nicht zu doppelten fachlichen Targets und damit zu mehrfacher Wirkung führen.

19. **Explizite Stage-Reentrancy**
    Während eines laufenden Projectile-Stages neu erzeugte Projectiles werden nicht implizit durch Collection-Iterationsverhalten verarbeitet. Ob Same-Frame- oder Next-Stage-Verarbeitung gilt, ist ein expliziter, charakterisierter Stage-Contract.

20. **Tests schützen dauerhafte Semantik**
    Characterization- und Architecture-Tests folgen `docs/ai/testing.md`: langlebige Regeln und Grenzen schützen, bestehende passende Tests bevorzugt erweitern, authored Tuning und private Implementierungsform nicht als zweite Wahrheit einfrieren.

---

## 4. Ownership und Lifetime

> **Ownership folgt fachlicher Verantwortung und Lifetime. State gehört dem kleinsten fachlich passenden Owner, der seine Invarianten verantwortet und seine vollständige Lifetime abdeckt. Update folgt Ownership. Teardown folgt tatsächlichem Besitz. Authority folgt fachlicher Entscheidung, nicht Darstellung oder Transport. Gleiche Lifetime allein begründet keinen gemeinsamen Owner.**

| Bereich | Owner | Lifetime | Authority |
|---|---|---|---|
| öffentliche Projectile-Boundary | `WorldProjectileRuntime` | World | Host |
| Identity / aktiver Projectile-State | interne Projectile-Simulation | Projectile / World | Host |
| Flight / Guidance / lokale State-Machines | interne Projectile-Simulation | Projectile / World | Host |
| Collision | Projectile-Simulation + Geometry-Ports | Projectile / World | Host |
| projektilnahe Interaction | passende interne Resolver/Processor | Interaction / Projectile | Host |
| Projectile-Mutation | Projectile-Simulation | Projectile | Host |
| allgemeine Combat-Regeln | `ProjectileCombatPort` / Combat-Domain | World | Host |
| Cross-Domain-Explosion-/World-Effect-Fan-out | schmaler Domain-Effect-/Explosion-Orchestrierungsadapter | World | Host |
| fremder Health-/Integrity-State | kanonischer Domain-Owner | Entity / World | Host |
| Replication | Replication Adapter | World | keine neue Gameplay-Authority |
| Client Projectile State | Client Replica | Replica / World | keine Gameplay-Authority |
| Presentation | Presentation Owner | Visual / World | keine Gameplay-Authority |

Interne Processor, Capability-Indizes oder State Stores sind **keine zusätzlichen fachlichen Owner**. Sie bleiben Implementierungsdetails des `WorldProjectileRuntime`.

World-Teardown entfernt autoritativen Projectile-State, private Indizes, Replication-Baselines, Client-Replica und Presentation-State stale-sicher.

---

## 5. Zielbild und Runtime-Grenze

```text
Execution Capabilities
        ↓
ProjectileSpawnRequest
        ↓
WorldProjectileRuntime
        │
        ├─ private Projectile State / Store
        ├─ private specialized Processors
        ├─ private Capability Indices
        └─ small Interaction Resolvers
        ↓
Collision / Interaction
        ↓
typed Results
   ├─ Projectile Mutation
   ├─ Combat Request
   ├─ Explosion / Domain-Effect Request
   └─ World / Support Request
        ↓
Canonical Domain Mutation / schmale Domain-Orchestrierung
        ↓
Authoritative Outcomes
   ├─ Gameplay Reactions
   └─ Replication / Presentation
```

`WorldProjectileRuntime` besitzt:

- World-Lifecycle und Teardown,
- Composition der internen Projectile-Verantwortlichkeiten,
- Spawn-Grenze,
- notwendige Host-Frame-Schritte,
- schmale Domain-/External-Interaction-Ports,
- schmale Read-/Projection-Grenzen.

Es darf nicht zum neuen God-Manager werden.

---

## 6. Semantisches Daten- und Processing-Modell

Das zukünftige Projectile-Modell trennt logisch:

```text
Projectile Gameplay State
├─ Core / Identity
├─ Flight
├─ Provenance
└─ Interaction
   ├─ Base Payload
   ├─ Augments
   └─ lokaler Interaction-State

Passive Presentation Projection
└─ renderer-/replica-relevante Metadaten, vom Gameplay nicht interpretiert
```

Neue Behaviors werden bevorzugt kompositorisch beschrieben:

```text
Flight + Homing + Penetration + BurnAugment + ExplosionOnImpact
```

statt durch:

- neue Projectile-Subklassen,
- Weapon-ID-Sonderzweige,
- Presentation-Styles als Gameplay-Schalter,
- wachsende optionale Mega-Records.

Ein neues optionales Top-Level-Capability-Feld ist nur dann zulässig, wenn es eine **wiederverwendbare semantische Fähigkeit** beschreibt. Weapon-spezifische Details erweitern den kleinsten passenden typisierten Zweig; sie erzeugen weder ein neues Top-Level-Feld pro Waffe noch einen neuen Mega-Record.

Universelle Daten wie Identity, Physics/Transform, Lifetime und grundlegender Flight-State bleiben zusammenhängend.

Separate sparse State-Blöcke/Stores sind nur für echte optionale Multi-Frame-Behaviors sinnvoll, wenn sie die Implementierung klarer machen.

Wenige spezialisierte interne Processor sind zulässig, insbesondere für:

- Flight,
- Homing/Guidance,
- Travel-/Environment-Interaction,
- Collision Candidate Generation.

Processor arbeiten auf Semantik/Capabilities, nicht auf Presentation-Style. Ihre Reihenfolge wird statisch durch `WorldProjectileRuntime` orchestriert.

Private Indizes wie `homingIds` sind erlaubt, aber nur derived state des Projectile-Owners und keine öffentliche Registry.

---

## 7. Interaction und Domain-Grenze

> **Collision ist Geometrie. Impact Candidate ist fachliche Eingabe. Interaction Resolution erzeugt kleine typisierte Resultate.**

Eine Interaction darf mehrere kleine Resultate erzeugen, z. B.:

```text
DamageRequest
BurnRequest
ExplosionRequest
StopProjectile
```

oder:

```text
ChangeVelocity
ChangeAttribution
ChangeAllegiance
ContinueProjectile
```

Kein universelles `InteractionOutcome` oder `ProjectileContext` mit vielen optionalen Feldern.

```text
Interaction Result
      ├─ Projectile Mutation ───────→ Projectile Simulation
      ├─ Combat Request ────────────→ ProjectileCombatPort
      ├─ Explosion/Domain-Effect ───→ schmale Domain-Orchestrierungsgrenze
      ├─ World Request ─────────────→ kanonischer World-/Entity-Owner
      └─ Support Request ───────────→ passender fachlicher Owner
```

`ProjectileCombatPort` ist **kein** Universal-Fan-out-Port für Explosionen. Er löst nur Combat-eigene Direct-/AoE-Regeln auf; nicht-Combat-Wirkungen bleiben bei ihren kanonischen Ownern.

Relationship/Targetability sowie Barrier-/Defense-Semantik kommen über schmale semantische Ports/Queries. Dabei bleiben drei fachlich verschiedene Pfade unterscheidbar: **World-space Barrier** (z. B. Tesla Dome) greift vor normaler Target-Interaction ein; **target-local Defense** (z. B. Player Energy Shield) wird im Direct-Impact-/Target-Owner-Pfad aufgelöst; **aktive externe Deflection** (z. B. Leaf Blower) kommt als Command über die External-Interaction-Grenze in `WorldProjectileRuntime`. Eine erste Implementierung darf nahe Semantik hinter wenigen passend geschnittenen Ports bündeln, darf die drei Entscheidungen aber nicht doppelt oder an der falschen Stelle treffen. Projectile importiert dafür weder `TeslaDomeSystem`, Player-Gameplay noch `CombatSystem` direkt. Die tatsächliche Projectile-Mutation bleibt beim Projectile-Owner. Projectile kennt keinen `NetworkBridge` und inferiert Friendly/Hostile nicht aus Presentation- oder Transportdaten.

---

## 8. Gameplay Reactions

```text
Interaction Result
    = was soll angewendet werden?
          ↓
Projectile- oder Domain-Mutation
          ↓
Authoritative Outcome
    = was ist tatsächlich passiert?
          ↓
Gameplay Reaction
```

Hit-/Kill-Reactions, spätere Adrenalin-Orbs und Hit-Feedback-Projektion bauen auf authoritative Outcomes auf.

Projectile hängt nicht von diesen Consumer-Systemen ab.

Kein globaler Gameplay-Event-Bus wird als Authority eingeführt.

---

## 9. Replication, Client und Presentation

Replication projiziert nur notwendige Host-Semantik. Das bestehende Wire-Format wird nur bei konkretem Architektur-/Robustheitsgewinn geändert.

Projectile Identity bleibt während der Lifetime stabil. **Eine `ProjectileId` wird innerhalb derselben `worldRevision` nicht wiederverwendet; erst World-Teardown bzw. der Wechsel in eine neue World-Revision beendet diesen Identity-Scope.** Dadurch kann stale Replica-State keine neue Projectile-Instanz derselben World mit einer alten ID verwechseln.

Client-Replica darf:

- replizierten State halten,
- interpolieren/extrapolieren,
- Presentation-relevante Daten cachen.

Sie darf keine Gameplay-Entscheidung treffen.

Presentation liegt vollständig außerhalb der fachlichen autoritativen Simulation. Ein Spawn darf passive/opaque Presentation-Projektionsmetadaten mitführen, damit Replica/Renderer sie erhalten; die Simulation darf diese Daten jedoch niemals zur Gameplay-Entscheidung lesen. `projectileStyle` darf ausschließlich auf der Presentation-Seite als Renderer-/Visual-Dispatch-Key dienen.

---

## 10. Autoritative Reihenfolge

Die fachliche Zielreihenfolge bleibt sichtbar:

```text
Execution
    ↓
External Projectile Interactions
    ↓
Travel / Environment Mutations
    ↓
Barrier / Projectile Interactions
    ↓
Collision / Target Interaction
    ↓
Domain Requests + Outcomes
    ↓
Flight / Expiry / special-state finalization
    ↓
Post-Projectile Gameplay Reactions
    ↓
deferred World-/Explosion-Resolution
    ↓
Replication
```

Die genaue Same-Frame-Semantik steht in `02` und wird in `03` als Gate abgesichert.

Kein Scheduler/Event-Bus darf diese Reihenfolge verstecken.

---

## 11. Scope und No-Gos

### Bestandteil

- echte world-owned `WorldProjectileRuntime`,
- privater autoritativer Projectile-State,
- capability-basierte Datenkomposition,
- gezielte interne Processor/Indices bei realem Nutzen,
- Flight / Guidance / Collision / Interaction,
- Provenance,
- `ProjectileCombatPort`,
- schmale Projectile→Domain-Effect-/Explosion-Orchestrierungsgrenze,
- External Projectile Interaction einschließlich aktiver Deflection/Detonation,
- Replication Adapter,
- Client Replica,
- Projectile Presentation,
- Entfernung des produktiven Legacy-`ProjectileManager`,
- Architektur-Ratchets.

### Nicht Bestandteil / nicht einführen

- globales ECS-Framework,
- globale Entity-/Component-/System-Registry,
- generischer System-Scheduler oder Behavior-Registry,
- Component-Stores für triviale/universelle Daten ohne konkreten Nutzen,
- neuen Universal-ProjectileManager,
- Universal-Impact-/GameplayEffect-System,
- Universal-ProjectileContext,
- Weapon-ID- oder `projectileStyle`-Gameplay-Switch-Zentralen,
- globalen Event-Bus,
- zweiten Spatial Index nur aus Symmetrie,
- direkten `NetworkBridge` in Simulation/Interaction,
- Renderer/Audio in autoritativer Simulation,
- clientseitige Gameplay-Authority,
- direkte fremde Health-/Integrity-Mutation,
- dauerhafte `ProjectileManager`-Compatibility-Fassade,
- neues Adrenalin-Orb- oder Hit-Feedback-Feature,
- vollständigen Combat-Refactor,
- Universal-ExplosionManager oder einen `ProjectileCombatPort`, der fachfremden World-/Support-/Environment-Fan-out übernimmt,
- direkte Projectile-Abhängigkeiten auf konkrete Barrier-/Defense-Systeme wie `TeslaDomeSystem`.

---

## 12. Globale Abnahme-Gates

Das Refactoring ist erfolgreich, wenn:

1. `WorldProjectileRuntime` die einzige öffentliche world-owned Projectile-Grenze ist.
2. `ProjectileManager` aus produktivem Code verschwunden ist.
3. Execution über stabile Spawn-Capabilities arbeitet.
4. Host-Simulation die einzige Projectile-Gameplay-Authority ist.
5. Gameplay-Behavior aus expliziter Semantik statt aus Weapon-/Presentation-Type abgeleitet wird.
6. Spezialmechaniken lokal und kompositorisch bleiben; data-oriented Optimierungen nur dort eingesetzt werden, wo sie einen konkreten Nutzen haben.
7. interne Processor/Indices Ownership und Ablauf nicht verdecken.
8. Collision und Interaction klar getrennt sind.
9. fremder Domain-State nur beim kanonischen Owner mutiert wird.
10. Explosion-Fan-out über eine schmale Domain-Orchestrierungsgrenze läuft und `ProjectileCombatPort` auf Combat-eigene Regeln begrenzt bleibt.
11. Provenance Reflection und Folge-Spawns korrekt ausdrücken kann.
12. externe Projectile-Interaktionen keine Runtime-Interna exponieren und konkrete Barrier-/Defense-Systeme nicht in die Simulation hineinziehen.
13. Multiplayer-Spawn/Bootstrap/Removal/Late-Join/Teardown stabil bleiben.
14. Presentation vollständig außerhalb der fachlichen autoritativen Simulation liegt und ihre Metadaten für Gameplay opaque bleiben.
15. Host-Frame-Zeit und -Reihenfolge explizit, deterministisch und ohne versteckte Wall Clock bleiben.
16. der spätere Combat-Refactor unterhalb stabiler Combat-/Domain-Effect-Grenzen stattfinden kann.
17. fokussierte Characterization-/Contract-Tests die riskante Semantik gemäß `docs/ai/testing.md` absichern, ohne Testballast oder Tuning-Snapshots neu aufzubauen.
18. Target-Identitäten kanonisch sind und Spawn-during-stage/Reentrancy nicht von zufälligem Collection-Verhalten abhängt.
19. Ratchets Rückfälle in Legacy-, Capability-Mega-Record-, ECS- oder God-Manager-Strukturen verhindern.

> **Harter Architektur-Erfolg:** `WorldProjectileRuntime` besitzt klar und ausschließlich die world-scoped Projectile-Authority; seine interne Runtime-State-Oberfläche ist geschlossen, Spezialmechaniken bleiben lokal und typisiert, fremde Domain-Mutation läuft über stabile schmale Grenzen und Replication/Client/Presentation erzeugen keine neue Gameplay-Authority. Data-Oriented-/ECS-inspirierte Techniken sind dabei nur lokale Werkzeuge, wo sie dieses Ziel nachweisbar verbessern.
