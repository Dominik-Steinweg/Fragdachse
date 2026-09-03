# Fragdachse – Gameplay Runtime Architecture Core

**Status:** Normative Architekturgrundlage – immer zu laden  
**Geltungsbereich:** Player Action, Loadout, Ability, Resource, Execution sowie die Grenzen zu Projectile, Impact, Combat, Enemy, Turret, World, Activity, Network, Presentation und Persistence  
**Repository-Abgleich:** Architektur gegen den aktuellen Migrationsstand bis `fcc6e3f5` vom 03.09.2026 gegengeprüft  
**Detaildokument:** `02_Gameplay_Runtime_Architecture_Details.md`

> Dieses Dokument ist die kompakte, immer zu ladende Architekturgrundlage. Das Detaildokument präzisiert die hier verkürzte Darstellung. Konkrete Klassen- und Type-Namen werden erst im jeweiligen Implementierungsplan verbindlich.

---

## 1. Zweck und Dokumentenvertrag

Ziel ist **keine maximale Abstraktion**, sondern eine Gameplay-Architektur, in der neue Features überwiegend lokal implementiert werden können und Ownership, Authority, Lifetime und Reihenfolge schnell erkennbar bleiben.

Zentraler Grundsatz:

> **Action Initiator und – wo vorhanden – Loadout-Kategorie bestimmen, wann und in welchem fachlichen Kontext eine Action beginnt. Die zugrunde liegenden Gameplay-Mechaniken werden unabhängig davon modelliert und nur dort geteilt, wo tatsächlich dieselbe Semantik vorliegt.**

Für Coding-KIs gilt:

1. Dieses Core-Dokument wird bei jeder Gameplay-Runtime-Phase gelesen.
2. Aus dem Detaildokument werden nur die für die Aufgabe referenzierten Abschnitte zusätzlich geladen. Für Implementierungsphasen ist die phasenspezifische §-Zuordnung aus `03_Gameplay_Runtime_Implementation_Plan.md` maßgeblich.
3. Bei Änderungen über mehrere Gameplay-Grenzen wird zusätzlich immer § 15 `Gesamtbild` des Detaildokuments geladen.
4. Detailverträge präzisieren den Core; Validierungsfälle erzeugen keine zusätzlichen Architekturpflichten.
5. Der Implementierungsplan legt die cross-phase stabilen Contract-Familien und die Migrationsreihenfolge fest, darf die Architektur aber nicht überschreiben. Der Migration-Status protokolliert nur den realisierten Zwischenstand, konkrete aufgelöste Contract-Namen und zugehörige Commits.

---

## 2. Zwölf Kernprinzipien

1. **Ownership folgt Lifetime; pro fachlichem State existiert genau eine Authority und nach dem Cutover genau ein Writer.**
2. **World-, Activity-, Player-in-World-, Action- und Effect-Lifetimes bleiben explizit und werden an ihrer tatsächlichen Grenze beendet.**
3. **Action Initiator, Loadout-Kategorie und zugrunde liegende Mechanik werden getrennt; Fragdachse nutzt ein Hybridmodell statt eines Universal-Ability-Systems.**
4. **Commit ist ability-spezifisch; Pre-Commit-Behavior, Immediate Execution, Deferred One-shot und Sustained Runtime sind unterschiedliche Semantiken und Lifetimes.**
5. **Loadout besitzt Ausstattung und die dort zu resolvierende Config-Sicht; Resources, Readiness, dynamische Modifier-Zeitpunkte und spezielle Behaviors besitzen den kleinsten passenden Owner.**
6. **Execution ist eine Menge schmaler Capabilities, kein Universal-Executor; gemeinsame Mechanik wird nur bei echter gemeinsamer Semantik geteilt.**
7. **Projectile Flight, Interaction und direkte Domain-Mutation sind getrennte Pfade; nicht jede Execution muss durch Impact/Interaction laufen.**
8. **Combat besitzt gemeinsame Combat-/Damage-Resolution-Semantik, aber nicht automatisch den Health-/Armor-State jedes Targets; dessen kanonischer Owner mutiert den State und erkennt Death/Destroyed-Transitions atomar.**
9. **Execution Actor, Controller, Gameplay Source, Attribution, Allegiance, Lineage und Correlation bleiben bei Bedarf unterscheidbar; `Faction` ist keine Synonymbezeichnung für Allegiance.**
10. **Network, Presentation und Persistence transportieren oder projizieren State, treffen aber keine neue Gameplay-Authority; Relationship-Entscheidungen sind Domain-Semantik.**
11. **Autoritative Semantik ist sichtbar und testbar: fachliche Zeit, gameplay-relevante Randomness, Modifier-Resolution, Duplicate-Semantik berührter Commands, At-most-once-Commit pro Attempt und Reaction-Chains sind explizit.**
12. **Erweiterbarkeit ist kein Implementierungsauftrag: keine generischen Router, Contexts, Event-Busse, Scheduler, Registries oder Manager ohne aktuellen semantischen Druck.**

---

## 3. Zentrale Begriffe

| Begriff | Bedeutung |
|---|---|
| **Action Initiator** | Quelle, die eine semantische Action beginnt, z. B. Player-Input, Enemy AI, Turret-Logik oder World-Trigger. |
| **Action** | Semantische Absicht, z. B. Weapon 1 aktivieren oder Utility loslassen. |
| **Activation** | Auslöseform wie `instant`, `held`, `charged`, `placement`, `toggle` oder `channelled`. |
| **Action Receiver** | Gameplay-fähiger Actor, der die Action fachlich empfängt. Im normalen Player-Pfad ist dies der Player. |
| **Execution Actor** | Actor, der eine actor-gebundene Gameplay-Ausführung fachlich besitzt, z. B. Player, Enemy oder Turret. Ein reiner World-Effect benötigt nicht zwingend einen Execution Actor. |
| **Controller** | Optionaler Actor/Player, der Intent für einen anderen Actor liefert. |
| **Gameplay Source** | Fachliche Mechanik, durch die eine Wirkung entsteht, z. B. konkrete Weapon, Ability, Utility, Construction-Weapon oder World-Effect. |
| **Attribution Owner** | Identität, der Damage, Kill, Reward oder vergleichbare Wirkung aktuell zugerechnet wird. |
| **Allegiance** | Aktuelle Friendly-/Hostile-/Neutral-Semantik. |
| **Faction** | Optionale taxonomische Zugehörigkeit; nicht dasselbe wie Allegiance. |
| **Lineage** | Kausale Gameplay-Abstammung, z. B. Root-/Parent-Projectile und Child-/Split-Wirkungen. |
| **Correlation** | Zuordnung für Request, Prediction, Reconciliation, Diagnose oder einzelne Executions. |
| **Commit** | Erster autoritativer Punkt, ab dem eine Action fachlich als erfolgreich begonnen gilt. |
| **Execution Capability** | Schmaler Ausführungspfad wie Projectile Spawn, Hitscan, Melee, Placement, Deferred Strike oder Sustained Effect. |
| **Impact / Interaction** | Semantische Auflösung einer tatsächlichen Interaktion; nicht jede Execution benötigt diesen Pfad. |
| **Outcome** | Autoritatives Ergebnis einer aufgelösten Regel oder Mutation. |

Wichtig:

- `Action Initiator`, `Execution Actor` und `Gameplay Source` sind unterschiedliche Dimensionen.
- Unqualifiziertes `Owner` soll in neuen fachlichen Contracts vermieden werden, wenn State Owner, Execution Actor oder Attribution Owner gemeint sein könnte.
- Diese Dimensionen sind **keine Pflichtfelder eines universellen Context-Objekts**. Ein Contract trägt nur, was Downstream-Regeln tatsächlich benötigen.

---

## 4. Ownership und Lifetimes

> **Ownership folgt Lifetime. Update folgt Ownership. Teardown folgt tatsächlichem Besitz.**

| Bereich | Ziel-Owner | fachliche Lifetime | Authority |
|---|---|---|---|
| Player Loadout / Ability State / Resources | Player-/World-Gameplay | World / Player-in-World | Host |
| optionale Player→Actor Control Session | passender Player-/Actor-Binding-Owner | Control Session innerhalb der World | Host |
| Projectile Simulation | World-Gameplay | World | Host |
| committed Deferred One-shot Effects | kleinster semantisch passender World-/Activity-Owner | bis Trigger / Scope-Teardown | Host |
| gemeinsame Combat-/Damage-Resolution-Regeln | Combat / World-Gameplay | World | Host |
| Player-/Enemy-Health und Armor | jeweiliger kanonischer Combatant-/Entity-Owner | Actor-in-World | Host |
| Base-/Construction-/Rock-/Train-Health | jeweiliger World-/Entity-Owner | World / Entity | Host |
| allgemeiner Target-/World-Status | kleinster fachlich passender Target-/World-Owner | World / Target-Lifetime | Host |
| allgemeine Turret-Mechanik | Construction / World | World | Host |
| activity-spezifisches Enemy Behavior | Activity | Activity | Host |
| Missionsregeln / Objectives | Activity | Activity | Host |
| World-Geometrie / Placeables | World | World | Host |
| World-/Activity-Presentation | jeweiliger Presentation-Owner | World / Activity | keine Gameplay-Authority |
| Replication | Network-Adapter | Lifetime des replizierten Owners | keine Gameplay-Authority |
| dauerhafte Progression | Meta / Persistence | außerhalb der Gameplay-World | persistenter Owner |

Zusätzliche Invarianten:

- Fachliche und physische Objekt-Lifetime dürfen verschieden sein; entscheidend ist vollständiges Binding/Teardown.
- World-scoped bedeutet nicht global.
- Player-in-World ist eine eigene Lifetime: Join/Leave/Disconnect sind nicht dasselbe wie Respawn.
- Der kanonische Health-/Integrity-Owner erkennt `becameDead`/`becameDestroyed` atomar mit seiner Mutation; Kill Attribution konsumiert dieses Outcome, statt Death erneut zu entscheiden.

---

## 5. Gesamtbild

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

Der Player-Normalpfad bleibt:

```text
Input → Player Action → Loadout → Activation
      → optional Behavior → ability-spezifischer Commit
      → passende Execution Capability
```

Einfache Enemies und Turrets müssen nicht durch Player-Loadout oder Player-Activation laufen. Control Delegation ist ein optionaler Erweiterungsfall und keine obligatorische Pipeline-Stufe.

---

## 6. Scope des ersten großen Refactorings

Der erste große Gameplay-Refactor umfasst:

1. Action-/Activation-Grenze schaffen.
2. `WorldPlayerGameplayRuntime` als echte öffentliche Player-Gameplay-Boundary etablieren.
3. `LoadoutManager` auf Ausstattung und Orchestrierung reduzieren.
4. Activation-, Resource-, Readiness- und Commit-Semantik stabilisieren.
5. Execution Capabilities konsolidieren und spezielle Player-Behaviors modularisieren.
6. Network-/Activity-/Consumer-Grenzen stabilisieren und direkte `NetworkBridge`-Abhängigkeit aus dem Loadout-/Ability-Core entfernen.
7. Host-/Client-Update und Activity-Boundary nach dem Cutover gezielt bereinigen.

**Nicht Bestandteil dieses ersten großen Refactorings:**

- vollständiger Projectile-Runtime-Refactor,
- vollständiger Combat-Runtime-Refactor,
- vorsorgliche Control-Session-, Scheduler-, Attribution- oder Universal-Context-Infrastruktur,
- vollständige Neugestaltung aller bestehenden Weapon-Configs.

Die unteren Projectile-/Combat-Pfade werden in dieser Phase über stabilisierte Contracts konsumiert, aber intern noch nicht vollständig umgebaut.

---

## 7. Abstraktions- und Architektur-No-Gos

Nicht einführen, solange kein konkreter semantischer Druck besteht:

- Universal Ability System,
- Universal `ExecutionManager` oder Universal-Executor,
- universelles `ExecutionContext`-/`GameplayContext`-Pflichtobjekt,
- globaler Event-Bus für autoritative Gameplay-Reihenfolge,
- globaler Allzweck-Scheduler,
- zentraler Readiness-/Status-/Relationship-/Random-/Time-Manager,
- generischer Action-/Control-Router allein für hypothetische Features,
- neuer Service Locator oder `ArenaContext` in World-/Activity-Domain-Ownern,
- globaler Health-Storage nur aus Symmetriegründen,
- neuer wachsender Config-Sack mit beliebigen optionalen Ability-Sonderfeldern.

Koordinatoren werden nach **Verantwortung, Authority, Lifetime und Änderungsgrund** bewertet – nicht nach LOC.

---

## 8. Kontext-Router zum Detaildokument

Zusätzlich zu diesem Core gezielt laden:

| Aufgabe | `02_Gameplay_Runtime_Architecture_Details.md` |
|---|---|
| Player-Waffe / Utility / Ability | §§ 8–13 sowie tatsächlich berührte §§ 16–20 |
| Enemy Ability / Special | §§ 13–14, 17–21 |
| Turret / externe Commands / Control | §§ 8.2, 13, 21, 23.1 |
| Projectile-Refactoring | §§ 13, 15–18, 23–24 sowie bei Migration §§ 26–30 |
| Combat-Refactoring | §§ 15, 17–20 sowie bei Migration §§ 26–30 |
| Network / RPC / Prediction | §§ 2.7, 8.1, 23 sowie bei Migration §§ 27–29 |
| World-/Activity-/Player-Lifecycle | §§ 3, 22 sowie bei Migration §§ 27–29 |
| Architektur-Review | § 37 plus betroffene Fachabschnitte |

**Cross-Layer-Regel:** Sobald eine Änderung mehr als eine Gameplay-Grenze berührt, zusätzlich § 15 `Gesamtbild` laden.

---

## 9. Zehn globale Abnahme-Gates

Die Architektur gilt als erfolgreich, wenn diese Gates überwiegend erfüllt sind:

1. **Lokale Feature-Erweiterung:** Neue einfache Waffen/Abilities benötigen keine neue globale Runtime und keine konkrete Weapon-ID im Combat-Core.
2. **Geteilte Mechanik ohne Universal-System:** Enemy und Turret nutzen gemeinsame Primitiven ohne Player-Loadout oder Universal-Ability-/Execution-System.
3. **Saubere Player-Boundary:** Host/RPC/Input traversieren nicht dauerhaft `WorldPlayerGameplayRuntime.systems.*`; Loadout-/Ability-Core kennt keinen direkten `NetworkBridge`.
4. **Korrekte Lifetimes:** World/Activity, Player-in-World, Respawn, Deferred Effects und optionale Sessions räumen genau ihren eigenen State stale-sicher auf.
5. **Duplicate-safe Commands:** Neu eingeführte oder im jeweiligen Cutover veränderte retriable state-changing Commands definieren Duplicate-Semantik; derselbe commit-tragende Attempt darf höchstens einmal committen, während eine Action mehrere explizite Executions enthalten darf.
6. **Explizite Resolution-Zeitpunkte:** Modifier, fachliche Zeit und gameplay-relevante Randomness werden am authored Zeitpunkt aufgelöst und sind deterministisch testbar.
7. **Projectile-/Interaction-Trennung:** Flight, Interaction und direkte Domain-Actions bleiben getrennt; Reflection darf Attribution/Allegiance transformieren und benötigte Lineage erhalten.
8. **Combat ohne globalen State-Sack:** Combat-Resolution ist vom kanonischen Health-/Integrity-Storage getrennt; Death/Destroyed wird atomar beim State-Owner erkannt.
9. **Explizite autoritative Reactions:** Gameplay-Reactions besitzen deterministische Reihenfolge; passive Observations entscheiden keine Gameplay-Regel; Reentrancy erzeugt keine doppelte Verarbeitung.
10. **Architektur bleibt klein und auffindbar:** Kein Refactoring ersetzt eine God-Class durch einen neuen Manager/Event-Bus/Context/Scheduler; Coding-KIs können Owner, Lifetime, Config-Bereich, Capability und relevante Detailverträge schnell finden.

---

## 10. Präzedenz und Schlussbild

Die vier geplanten Refactoring-Dokumente haben folgende Rollen:

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

- **Core + Details** bilden gemeinsam die normative Architektur.
- Bei einer verkürzten Core-Aussage präzisiert der fachlich zuständige Detailvertrag die Semantik.
- Der **Implementation Plan** beschreibt die Migrationsreihenfolge und darf Architektur nicht überschreiben.
- Der **Migration Status** beschreibt den aktuellen Zwischenstand, die realisierten Contract-Namen und Phase-Commits; er darf weder Architektur noch Plan neu definieren.

Bevorzugter Aufbau:

> **klare Owner + klare Lifetimes + ein Writer pro State + lokale Config + explizite Commit-/Modifier-/Duplicate-Semantik + schmale Execution Capabilities + optionaler Interaction-Pfad + Combat-Resolution getrennt vom State-Storage + klare Attribution/Allegiance/Lineage/Correlation + Domain-Regeln außerhalb des Transports + keine Vorab-Frameworks.**
