# Fragdachse – Combat Runtime Architecture Details

**Status:** Normative Zielverträge; noch nicht implementiert.\
**Core:** [01_Combat_Runtime_Architecture_Core.md](01_Combat_Runtime_Architecture_Core.md)\
**Plan / Ist-Status:** [03](03_Combat_Runtime_Implementation_Plan.md) / [04](04_Combat_Runtime_Migration_Status.md)\
**Analysebasis:** `main` @ `d5cb4519fb06dd74e22d21e8d63e635ea75bbc26`, 06.09.2026. Statischer Repository-Abgleich; keine hier ausgeführte technische oder manuelle Spielabnahme.

> **Dieses Dokument definiert das Was. 03 definiert den Umbauweg.** Normative Semantik wird nicht während jeder Implementierungsphase neu erfunden. Module und Type-Namen unten sind Zielbezeichnungen, sofern sie nicht ausdrücklich als bestehend markiert sind. Ein benannter Verantwortungsbereich verlangt nicht automatisch eine neue Klasse.

## 1. Nutzung und Quellenrang

Den normativen Teil von 01 und den aktuellen Kurzstatus 04 lesen, danach die Phasenkarte in 03 und nur deren Abschnitte aus diesem Dokument. Für Orchestrator, Worker und Reviewer gilt der unterschiedliche Lesevertrag aus 03 § 1; unveränderte Abschnitte werden innerhalb einer Sitzung nicht erneut geladen. Die Quellenliste am Ende dient zum Nachschlagen, nicht als Auftrag, sämtliche Vorgängerdokumente erneut einzulesen. Bei einer bereits fortgeschrittenen Implementierung gelten die in 04 vermerkten **realisierten** Contract-Namen; keine parallelen Types einführen.

01 + 02 bilden die Zielarchitektur. Produktivcode beschreibt das Ist, Tests liefern vorhandene Belege, nicht automatisch das fachliche Soll. Die in § 17 benannten Abweichungen werden bewusst korrigiert; außerhalb davon bleibt Verhalten erhalten. Eine neu entdeckte, nicht eindeutig auflösbare Semantikfrage wird mit kleinem Befund am Review-Gate entschieden. Ein möglicher Fehler ist kein Freibrief für Balancing.

| Arbeitsbereich | Laden |
|---|---|
| Grundverträge / Composition | §§ 2–4, 16 |
| Vitals / Entity-Mutation / Strukturwirkung | §§ 4–7, 11.1, 16 |
| Damage / Relationship / Defense | §§ 4, 6–7, 10.1 |
| Status / Reaktionen / Tod | §§ 9–11, 14 |
| Projectile / Explosion | §§ 6, 10, 12–13 |
| Hitscan / Melee / Preview | §§ 6–8, 10.3, 13.1 |
| Frame / Network / Presentation | §§ 14–16 |
| Review / Abnahme | §§ 17–18 sowie betroffene Fachabschnitte |

## 2. Gesamtziel und Einordnung ins Repository

**Aktualisierter Ist-Abgleich:** Die Detailanalyse der vorherigen Basis wurde gegen den neuen Stand einschließlich `09524fd6` (Sweep-Endpunkterhalt) und `d5cb4519` (Flight Signature) ergänzt. Die direkte Combat-API bleibt bestehen; hinzugekommen sind passive Flight-Profile, Pfadhistorien, Movement-Observation und zeitversetzte Projectile-Präsentation. Diese Änderungen werden erhalten, nicht als neue Combat-Arbeit neu implementiert. Die frühere C8-Abnahme ersetzt keinen P0-Testlauf auf diesem neueren Stand.[^flight-delta]

### 2.1 Zielgraph

```text
Scene / ArenaWorldGameplayComposition
  └─ WorldRuntime                         Besitz und Teardown
       ├─ World-Geometrie / Materialisierung / Construction
       ├─ WorldProjectileRuntime           vorhandene Registry und Stages
       ├─ WorldCombatRuntime               Combat-Lifecycle und öffentliche Capabilities
       ├─ WorldPlayerGameplayRuntime       Loadout, Resources, Items, Mechanik-Reaktionen
       ├─ WorldTargetingRuntime            allgemeiner Target-/Feldstatus
       ├─ WorldSupportGameplayRuntime      vorhandene deferred/sustained World-Wirkungen
       ├─ WorldPowerUpRuntime / WorldTrainRuntime
       └─ Activity                         austauschbare Targets, Regeln und Rewards

Execution ──→ Projectile / Hitscan / Melee / direkte Domain-Action
Combat-Regeln ──→ kanonische Mutation ──→ bestätigtes Outcome
              ──→ passende autoritative Folgeowner ──→ passive Ausgabe
```

`WorldCombatRuntime` ist der fachliche Einstieg in Combat, kein Eigentümer aller dargestellten oder beschädigbaren Objekte. Nach dem Cutover gibt es keinen parallel aktiven `CombatSystem`-Kern und keinen dauerhaften `ctx.combatSystem`-Service-Locator. Eine kleine öffentliche Boundary darf intern Funktionen oder wenige private Komponenten verwenden. Sie darf weder `systems.*` exponieren noch fremde Child-Owner nur weiterreichen.

**Keine Symmetriepflicht:** Projectile braucht seine Registry/Replica; Combat braucht keine zweite Entity-Registry und keinen eigenen vollständigen Snapshot-Stack. Der Host-Frame darf breit bleiben, solange er Stages ordnet statt Treffer-, Reward- oder Reparaturregeln selbst zu entscheiden.

### 2.2 Verbindliche Zuständigkeiten

| Verantwortung | Zielort / Anschluss | Darf dort nicht mitwandern |
|---|---|---|
| Player-Vitals einschließlich atomarem Lebenswechsel | Privater Player-Vitals-Owner von Combat | Player-Loadout, Actor-Positionierung, Respawn-Budget |
| Gemeinsame Damage-/Heal-/Armor-Resolution | Combat, kleine Phaser-freie Regeln | konkrete Waffen-Configs, Entity-Storage anderer Domains |
| Enemy-/Decoy-HP und Entfernung | Vorhandene Entity-/Decoy-Owner, erweiterter Mutation-Vertrag | Combat-eigene Kopie ihrer HP |
| Statische Felsen | `RockRegistry` / `RockHpRegistry` im World-Bestand | Entscheidung durch Erfolg eines Render-Aufrufs |
| Materialisierte Placeables | `PlacementSystem` / `ConstructionWorldRuntime` | zweiter HP-Writer im Fels-/Visual-Adapter |
| Base / Train | Bestehende Base-/Train-Owner | zentrale Speicherung unter Combat |
| Allgemeine Vulnerability / Slow | `WorldTargetingRuntime`, bestehendes `TargetStatusSystem` bzw. fokussierter Slow-State | parallele Modifier-/Movement-Caches mit eigener Semantik |
| Combatant-Burn | Combat-eigener zielgebundener Status; vorhandene `BurnStateMachine` wiederverwenden | Ground-Fire-Grid oder Wolken-Lifetime |
| Waffenbezogene Proc-/Stack-Zustände | Mechanik-/Reaktionsbereich des Player-/World-Gameplays | Waffen-Switch im generischen Damage-Core |
| Combat-Attribution | Combat, aus Source und bestätigtem Target-Outcome | XP-/Drop-/Persistenzregeln |
| Tod-Folgen / Respawn-Commit | Player-/World-Lifecycle und jeweilige Activity-Policy | `setTimeout` und Actor-Manipulation im Damage-Core |
| World-Explosion-Fan-out / Support-Impact | Schmale world-composed Orchestrierung bestehender Owner | universeller Effect-/Explosion-/Support-Manager |
| Kill-Rewards und Missionsfortschritt | Activity-/Reward-Owner; World-Pickups bei `WorldPowerUpRuntime` | Regelentscheidung in Network oder Presentation |
| Combat-Ausgabe | Adapter auf vorhandene RPCs/Read Models/Renderer | zweite Simulation oder erneute Trefferentscheidung |

Diese Zuordnung schließt die fachlichen Teile von `WorldCombatGameplayBinding`, `HostUpdateCoordinator`, `RockVisualHelper` und `arenaWorldQueries` ausdrücklich ein. Eine reine Port-Verkleidung ihrer bisherigen Regelblöcke erfüllt das Ziel nicht. Bestehende fachlich korrekte Owner bleiben dagegen bestehen.[^composition][^world-edges]

## 3. Öffentliche Contract-Familien

### 3.1 Einmal materialisieren, danach wiederverwenden

Die Familien und ihre Semantik sind hier verbindlich festgelegt. Bei der Umsetzung von P1 werden ihre konkreten Type-/Dateinamen einmal materialisiert; 04 führt die tatsächlichen Fundstellen und gegebenenfalls abweichenden Namen. Nachfolgende Phasen erweitern den kleinsten passenden Contract statt einen zweiten ähnlichen Port zu erfinden.

| ID | Familie / vorgesehene Namen | Ein- bzw. Ausgang / Verantwortlichkeit |
|---|---|---|
| CF-SCOPE | `CombatScope`, `CombatTargetRef`, `CombatSource` | Identität, Gültigkeit und mehrdimensionale Herkunft; § 4 |
| CF-MUTATION | `TargetMutationOutcome`, zielbezogene Mutation-Ports | Commit beim jeweiligen State-Owner; § 5 |
| CF-RESOLVE | `CombatDamagePort`, `CombatSupportPort` | Damage, Heal, Armor und kontrollierte fachliche Cap-Anpassung; §§ 6–7 |
| CF-READ | `CombatVitalsReadPort`, `CombatOutcomeReadPort` | read-only Vitals, abgeschlossene Outcomes und Diagnose; keine Child-Traversierung |
| CF-QUERY | World-Geometrie-, Target- und Relationship-Reads | Sicht-/Schusslinie, Hitboxen, Eligibility; §§ 4, 8 |
| CF-ATTACK | `CombatImmediateAttackPort` | aufgelöste Hitscan-/Melee-Aufträge; bestehende Execution-Requests adaptieren |
| CF-STATUS | fachlich getrennte Burn-/Slow-/Target-Status-Ports | Anwendung, explizites Advance, reine Reads und Cleanup; § 9 |
| CF-REACTION | kleine bestätigte Hit-/Damage-/Death-/Kill-Verträge | Anbindung bestehender Mechanik-Owner; §§ 10–11 |
| CF-LIFE | Player-Combat-Lifecycle und Respawn-Commit-Port | Attach/Life/Detach getrennt von Activity-Budget; § 11 |
| CF-FRAME | Combat-Frame-Schritte und Ausgabeprojektion | explizite Zeit, Advance und Publish; §§ 14–15 |
| CF-WORLD | Target-Mutation-/Support-/Domain-Effect-Adapter | fremde Writer und World-Fan-out; §§ 5, 7, 13, 16 |
| CF-PROJECTILE | vorhandene `ProjectileCombatPort`-/Explosion-/Barrier-Familien | unveränderte Nachbargrenze; § 12 |

Nicht jeder Consumer bekommt alle Familien. Ein Turm-Targeting-Consumer benötigt z. B. Read/Relationship/Schusslinie, kein Respawn-, Mutation- oder Reaction-Interface. Ein `Pick<CombatSystem, …>` ist höchstens eine explizit befristete Migration, kein Zielcontract. Keine generische Plugin-/Resolver-Registry.

### 3.2 Boundary und Abhängigkeiten

Neutrale Combat-Verträge und Pure Rules dürfen keine Concrete-Runtime importieren. Die öffentlichen Ports liegen nicht in der Datei einer Implementierung. Imports aus `src/projectile/` sind im Projectile-Adapter erlaubt, nicht im gemeinsamen Damage-/Vitals-Core. Alte Type-Reexports aus `CombatSystem.ts` werden mitsamt ihren Consumern entfernt.

Domain-Owner erhalten semantische Reads/Commands. `NetworkBridge`, `ArenaContext`, `Phaser.Scene`, Sprites und technische Physics-Handles bleiben an Adaptergrenzen. Ein Geometry-Adapter darf Phaser verwenden; dieselbe Dependency ist im numerischen Hit-/Damage-Regelkern nicht zulässig. Eine lokale Anpassung bestehender Neutraltypes ist einem großflächigen Umzug aus `src/types.ts` vorzuziehen.

## 4. Scope, Identität, Source und Zulassung

### 4.1 Scope-Vertrag

Eine lokale Combat-Instanz wird genau einer `WorldRuntime` zugeordnet. Ihre Scope-Gültigkeit endet **vor** dem Abbau ihrer Dependencies. Bereits ausgegebene Ports prüfen diese Gültigkeit; ein späterer Aufruf kann keine Nachfolger-World beeinflussen.

Eine gespeicherte Target-Referenz muss Art, ID und konkrete Instanz bestimmen. Dafür werden vorhandene World-/Activity-Identitäten und ein lokaler Binding-/Incarnation-Nachweis genutzt. Eine einfache Reference kann am synchronen Eintritt normalisiert werden; über Ticks, Queues, Respawn oder Reconnect gespeicherte Referenzen brauchen den vollständigen Nachweis. Dieser kann ein kleiner Generation-/Lease-Token sein; kein globales ID-Register und keine pauschale neue Wire-ID.

Player-in-World und Player-Life besitzen getrennte Gültigkeit. Activity-Targets erhalten zusätzlich die Activity-/Enemy-Owner-Generation, weil Enemy-IDs nach Neuaufbau wieder auftreten können. Bereits abgeschlossene Outcomes speichern Werte, keine lebenden Entity-/Sprite-Referenzen.

### 4.2 Physische Identität und Kategorien

Die Projectile-Kanonisierung bleibt erhalten: Placeables erscheinen als `rock` mit `obstacleKind`; dieselbe Konstruktion wird nicht zusätzlich als `construction` zu einem zweiten Trefferziel. Intern wird diese physische Identität auf den zuständigen Writer und die fachliche Statuskategorie abgebildet. Status-Key, Target-Key und Wire-Key dürfen unterschiedliche Adapterformate haben, müssen aber eindeutig dieselbe Instanz meinen.

Base-Zellen und Train-Segmente sind Geometrie einer Entity, nicht zusätzliche Damage-Targets. Collision-freie Podeste/Konstrukte werden nicht zur Vereinheitlichung plötzlich physische Blocker. Ihre Targetability bleibt mechanikspezifisch.

### 4.3 Source-Vertrag

Ein fachlicher Wirkungsauftrag trägt die tatsächlich benötigten Dimensionen: Gameplay-Quelle, optional ausführender Actor, Attribution, Allegiance, Source-Slot und Herkunftsart; Lineage/Correlation nur, wenn eine Folgeregel sie benötigt. Projectile-Provenance wird verlustfrei in diese Sicht adaptiert. Attribution wird **nicht** aus `allegiance.ownerId` zurückgerechnet.

Für gespeicherte Wirkungen werden relevante Quellenfakten vor Source-Despawn gesichert. Ein entfernter Enemy darf später nicht aufgrund einer fehlgeschlagenen Enemy-Suche als Player interpretiert werden. Summon-/Turret-/Base-Quelle bleibt von ihrem Reward-Empfänger unterscheidbar. Legacy-Sonder-IDs werden genau am Source-Adapter normalisiert, nicht als neue String-Switches über Combat verteilt.

Neue Requests klassifizieren direkte Waffenwirkung, Explosion, Burn, Ground/DoT, Chain und Reflect ausdrücklich. Ein fehlendes `damageKind` darf nicht unbemerkt On-Primary-Hit auslösen. Historische Defaults werden nur an der befristeten Legacy-Grenze erhalten; § 17 regelt die Bereinigung tatsächlich falsch klassifizierter Folgeschäden.

### 4.4 Zulassung ist nicht Relationship

Die Domain-Policy beantwortet getrennt: Darf eine neue Action beginnen? Ist das Ziel geometrisch präsent? Ist die konkrete Wirkung Damage/Support gegen dieses Ziel zulässig? Welche Selbst-/Team-/Faction-Regel gilt? Burrow, Inert/Unzerstörbarkeit, feindliche Basen, verbündete Enemies und neutrale Ziele bleiben unterscheidbar.

`canDamage === false` ist kein Beweis für Freundschaft. Heal/Repair/Injector erhalten ihre eigene Zulassung. Die bestehende World-/Player-Relationship-Sicht wird wiederverwendet und bei Bedarf fachlich vervollständigt; kein neuer globaler Relationship-Manager.

Neu beginnende Player-Actions benötigen gültige Participation/Capabilities. Bereits committed, eigenständig weiterlebende Projectiles/World-Effekte werden nicht allein wegen späterem Tod oder fehlendem `canUseCombat` rückwirkend annulliert. Explizite Source-End-Regeln einzelner Mechaniken bleiben möglich. Der Host validiert Mutationen; ein Client-Preview-Port bietet keine mutierenden Methoden.

## 5. Kanonische Mutation und Outcome

### 5.1 Minimaler Ergebnisvertrag

Ein Mutation-Outcome beschreibt **diese** Mutation, nicht einen später nachgelesenen Weltzustand. Die Typeform soll ungültige Kombinationen vermeiden. Semantisch benötigt werden:

| Ergebnis | Benötigte Aussage |
|---|---|
| Abgelehnt | Grund wie stale, Target fehlt/tot, unzulässig oder ungültiger Wert; kein erfundener Default-HP-Stand |
| Akzeptiert ohne Verlust | Block/Immunität oder erlaubter Null-Effekt; von tatsächlichem Schaden verschieden |
| Damage angewandt | tatsächlicher HP-/Armor-/Integrity-Verlust; resultierender State; bestätigte Transition; Critical/Herkunft aus Resolution |
| Heal/Armor/Repair angewandt | tatsächlich zugeführter Betrag; resultierender State; keine implizite Wiederbelebung |
| Lethal verhindert | tatsächlicher Schaden und gesonderte Rettungsheilung; endgültig lebender State, kein Death-/Kill-Outcome |

Nicht jede Variante braucht alle Felder. `actualDamage` ist die Summe tatsächlich verbrauchter HP/Armor bzw. Integrity, nicht Overkill, Sollschaden oder eine nach Reaction gemessene Nettoänderung. Reine Support-Wirkung kann akzeptiert sein, ohne Damage zu melden.

**Synthetischer Vertragsfall, kein Balancing:** Ein Ziel mit 40 HP erhält 100 aufgelösten Schaden und wird durch seinen Lethal-Guard mit 20 HP gerettet. Der Receipt meldet 40 HP-Verlust, 20 gesonderte Rettungsheilung und einen lebenden Endzustand mit 20 HP, aber keinen Tod. Ein nachfolgender Cull oder anderes Child liefert einen eigenen Receipt. Der Direct-Adapter darf weder Nettoverlust 20 noch den Child-Tod rückwirkend als Ergebnis des ursprünglichen Treffers ausgeben.

### 5.2 Commit-Vertrag

Der State-Owner prüft seine Instanz, schreibt endliche begrenzte Werte und bestätigt `becameDead`/`becameDestroyed` atomar. Er erzeugt höchstens eine Transition je Leben/Entity. Eine bereits terminale Instanz erhält weder weiteren Schaden noch eine zweite Death-/Destroyed-Transition. Reguläre wiederholte Treffer auf ein lebendes Ziel bleiben eigenständige Mutationen; Retries an Command-Grenzen folgen § 15.

Das Outcome und benötigte Death-Fakten stehen fest, bevor externe Gameplay-Callbacks laufen. Bei Enemy/Decoy/Base/Train darf technisches Entfernen intern bleiben, sofern der vollständige Death-Snapshot zuvor existiert und kein Folgeowner daraus fehlende Domain-Fakten rekonstruieren muss. Death-Spawns und andere fachliche Folgeaktionen werden nicht innerhalb eines noch offenen HP-Commits ausgeführt.

Der bestehende Enemy-Lethal-Guard wird zu einer schmalen Rettungsentscheidung: Der Guard liefert die erlaubte Rettung und verbraucht gegebenenfalls seine eigene Ladung, der Enemy-Vitals-Writer führt die HP-Mutation aus. Der Guard ist kein allgemeiner Reaction-Hook und löst während dieses Commits keine reentranten Damage-/Spawn-Aktionen aus. Ein Callback, der ein `EnemyEntity` erhält und direkt `setHp` schreibt, ist kein endgültiger Vertrag. Schaden und anschließende Rettung bleiben getrennt messbar.[^mutations]

### 5.3 Fremde World-Writer

Statische Felsen mutiert der Felsbestand; Placeables mutiert Placement/Construction; Base und Train behalten ihre eigenen Writer. Dispatch kann ein kleiner statischer Adapter sein. Er enthält keine konkurrierenden HP-Maps. `RockHpRegistry.getHP`-Fallbacks dürfen ein fehlendes Target nicht als reparierbaren vollen Felsen erscheinen lassen.

Damage, Repair, Decay, authored Removal und World-Teardown sind unterschiedliche Ursachen. Nur der bestätigte Übergang löst seine passende Konsequenz aus. Bereits zerstörte Felsen werden durch Repair nicht wiederhergestellt; Neubau ist eine neue Instanz. Inert/Unzerstörbarkeit bleibt beim Target-Owner.

`RockVisualHelper` wird im berührten Pfad zum Consumer: Er erhält bestätigte HP-/Removal-/FX-Daten. Physische/Grid-/Navigation-Entfernung, Status-Cleanup, Podest-Deregistrierung, Rock-Collapse-Explosion und Armor-Drop werden vom World-/Construction-Lifecycle beauftragt. Der Erfolg einer Animation oder `rockPresentation.destroyRock()` darf diese Arbeit nicht autorisieren oder verhindern. Keine doppelte Zerstörung über Callback plus nachträgliches `hp <= 0`.[^world-edges]

## 6. Damage-Resolution, Modifier und Defense

### 6.1 Auflösungsmodell

Ein aufgelöster Auftrag trifft auf aktuelle Target-/Policy-Daten. Fachlich unterscheidbar bleiben Quellpayload, bereits eingeflossene Quellfaktoren, noch zu lesende Modifier, Zielmodifikatoren, Defense, Reduktion und Vitals-Verteilung. Das ist **keine generische Pipeline-Engine**: wenige konkrete Funktionen und explizite Aufrufe reichen.

Für Player-/Enemy-Damage gilt grundsätzlich der bisherige Ablauf:

```text
Instanz / Wirkungserlaubnis
→ quellseitige Payload-/Runtime-Auflösung des Eintrittspfads
→ gegebenenfalls richtungs-/kategoriebezogene Defense
→ ausgehende Modifier / erlaubter Crit
→ eingehender Target-Multiplikator
→ gegebenenfalls schützende World-Fläche am Ziel
→ Player-Damage-Reduction
→ Armor-Absorption, HP-Overflow bzw. Entity-Integrity
→ atomarer Commit und Outcome
```

Defense-Arten haben heute unterschiedliche Aufrufpunkte und Schadensbasen. Diese werden nicht durch das Einführen einer allgemeinen Funktion verschoben. Ein Block verbraucht die betreffende Defense genau einmal. Verschiedene Mechaniken dürfen nacheinander prüfen; ein und dieselbe Dome-/Shield-Entscheidung darf nicht auf zwei Ebenen denselben Kontakt verbrauchen.

### 6.2 Scaling-Verhaltensmatrix

`P` bezeichnet den im bestehenden Pfad aufgelösten Loadout-/Power-up-Runtime-Faktor; `M` den ausgehenden Item-/Klassen-/Crit-Resolver; `T` eingehende Target-Modifier. Unterschiedliche Namen bedeuten nicht automatisch unterschiedliche fachliche Faktoren.

| Quelle / Pfad | Zu erhaltender Auflösungspunkt / Besonderheit |
|---|---|
| Projectile Direct gegen Combatant | Direct-Payload und lokale AK47-/Nähe-Faktoren; `P` am Hit; `M/T` am Damage-Commit; keine Flight-Abfrage im Damage-Core |
| Hitscan / Melee gegen Combatant | Aufgelöster Angriff; `P` am unmittelbaren Treffer, danach `M/T`; eigener Defense-Kategoriepfad |
| Combat-AoE / Projectile-Explosion | Payload, Falloff, Selbstfaktor und vorhandene Rundung pro Target; `P`, `M/T` wie charakterisiert; explizite Target-Masken |
| Base | Base-Faktor, bestehender `P/M`-Pfad und `T`; Oberflächenabstand statt bloß Base-Zentrum |
| Rock / Construction / Train | Quellpfad liefert Damage einschließlich seiner Objektfaktoren; vorhandene externe Modifier anwenden. Nicht neu pauschal `P` hinzufügen |
| Burn / Ground / andere DoTs | Bereits bestimmter Tick-Payload; keine erneute Direct-Weapon-Runtime-Skalierung; vorhandene `M/T`-Regeln und Critical-Zulassung bleiben explizit |
| Abgeleitete Reaction, etwa Anteil am tatsächlichen Damage | Ausgangswert ist das bestätigte Parent-Outcome; bereits enthaltene Quellfaktoren werden nicht ein zweites Mal angewandt; Target-Defense/-Modifier der neuen Wirkung bleiben eigenständig |
| Turret-/automatisches Payload-Scaling | Bei Execution eingefrorene Faktoren und später gelesene Faktoren mit ihrer Herkunft unterscheiden; derselbe Besitzerbonus darf nicht unbemerkt zweimal einfließen |

Diese Matrix verpflichtet zur Herkunftskennzeichnung, nicht zu einer neuen universellen Formel. Ein kleiner diskriminierter Damage-Basis-Vertrag unterscheidet authored, quellseitig voraufgelöste und aus einem Outcome abgeleitete Beträge. Welche Stufen bereits enthalten sind, wird nicht aus `sourceId`, Betragshöhe oder einem unklaren `damageAlreadyScaled` erraten. Die in P0/P1 erzeugte Faktorzuordnung wird durch kleine Tests mit unterschiedlichen synthetischen Faktoren geschützt. Identische Faktoren werden nur bei nachgewiesener Doppelanwendung korrigiert; unterschiedliche beabsichtigte Faktoren werden nicht entfernt. Eine neue Reaction-Quelle kann eigene neue Source-Faktoren besitzen: etwa Reflect-Damage des Verteidigers. Dies ist keine erneute Anwendung desselben Angreiferbonus.[^combat][^execution]

### 6.3 Numerik und spezielle Wirkungserlaubnis

Nicht-endliche Beträge und Geometriewerte werden am Eintritt zurückgewiesen. Negative Damage-Beträge sind keine Heilung. Player-Reduction bleibt begrenzt; Armor wird vor HP verbraucht. Overkill erzeugt keinen zusätzlichen Leech, Rage, Statistik-Damage oder Orb-Vorgriff.

Source-Slot und Damage-Art werden unabhängig ausgewertet. Burn/Chain/Explosion mit `weapon1` ist kein direkter Primärtreffer. Crit-Randomness wird als Host-Quelle übergeben, höchstens einmal pro dafür definierter Target-Wirkung gezogen und nicht für vollständig vorab abgelehnte Kandidaten erzeugt. Kritische Treffer dürfen nicht im Darstellungsadapter entschieden werden.

Telefrag und Burrow-Stuck-Damage behalten eine explizit benannte Ausnahme für die Burrow-Prüfung. Diese wird nicht zu einem allgemeinen `ignoreAllDefense` erweitert. Knockback ist eine eigene Wirkung: ein abgewehrter Damage-Request sagt nicht automatisch, ob ein Impuls erlaubt oder verboten ist.

### 6.4 Defense-Anschluss

Shield-/Dome-State bleibt beim bestehenden Defense-/Gameplay-Owner. Combat erhält semantische Block-/Schutz-Operationen, nicht Zugriff auf dessen Aktivierung, Ressourcenmaps oder Renderer. World-space Projectile-Barriere, target-lokaler Shield und aktive Deflection behalten die in Projectile 01/02 festgelegten unterschiedlichen Einstiegspunkte.

Schutz von Players, verbündeten Enemies und freundlichen Base-Oberflächen wird nicht durch generische Faction-Strings vereinheitlicht. Reflection erzeugt ein Ergebnis bzw. eine neue Damage-Reaction gemäß Mechanik; die tatsächliche Projektiländerung gehört weiterhin Projectile.

## 7. Heal, Armor, Repair und Caps

| Operation | Normative Semantik |
|---|---|
| Heal / Heal-to-full / Leech | Nur lebendes zulässiges Ziel, auf Max-HP begrenzt; Rückgabe enthält tatsächlich geheilte HP und resultierenden State |
| Armor-Gain | Positive Quelle verwendet den dafür aufgelösten Armor-Gain-Multiplikator; Cap begrenzt tatsächlichen Gewinn |
| Armor-Verlust | Explizite Operation für bisherige negative Armor-Anwendung; kein Gain-Multiplikator, keine erfundene Damage-/Kill-Reaction |
| HP-Regeneration | Rate × übergebenes Delta; lebend, nicht pausiert und gemäß bestehender Burrow-Regel; kein verdeckter Timer |
| Armor-Regeneration | Grundrate plus bedingte Bonusrate; nicht zusätzlich durch Armor-Gain-Multiplikator skalieren |
| Cap-Reconciliation | Live-Build-/Cap-Änderung aktualisiert vorhandenen State und begrenzt Überschüsse; keine Heilung und kein Respawn durch Neuinitialisierung |
| Repair | Beim zuständigen Base-/Construction-/Rock-Owner, begrenzt auf tatsächliche Integrity; keine Resurrection zerstörter Targets |
| Support-Impact | Relationship und konkrete Support-Fähigkeit entscheiden Damage, Heal, Repair oder Status; nicht `!canDamage` |

Bestehende Aufrufer haben unterschiedliche Zahl-Rückgaben (`heal` liefert heute einen Stand, andere Methoden einen Delta-Wert). Der neue Vertrag ist eindeutig; jeder Consumer wird semantisch migriert, nicht nur umbenannt. VFX/Statistik dürfen aus Cap-Clamping keine Heilung ableiten.

Plasmabrenner und Energy-Injector bleiben typisierte Support-Mechaniken. Sie nutzen gemeinsame Geometrie, aber eigene Target- und Wirkungsregeln. Selbstheilung beim Support-Hitscan bleibt möglich; offensive Injector-Wirkung und Struktur-/Turret-Buffs laufen zum jeweiligen Status-/Support-Owner. Geheilt/repariert wird höchstens einmal, auch wenn Impact- und Outcome-Callbacks parallel existieren.

Power-up-Aufnahme, Drohnen, Auren, Mini-Rocket-Rückgabe und Kill-Heal verwenden dieselben passenden Ports. Item-/Pickup-Lifetime und Respawn-Timer der Podeste bleiben bei `WorldPowerUpRuntime`/`PowerUpSystem`. Der neue World-Podest-Fix wird nicht durch einen allgemeinen Round-Reset rückgängig gemacht; der offene Layout-Authoring-Cutover TD-10/RK-6 wird durch dieses Refactoring nicht übernommen.[^pedestals]

## 8. Geometrie, Hitscan, Melee und Client-Vorschau

### 8.1 Gemeinsame World-Geometrie

Der bisher gemeinsam genutzte `ArenaObstacleIndex` wird unter World-Ownership gebunden. Combat, Projectile, Turret-Targeting und andere Sichtlinien-Consumer erhalten ihre benötigte Query-Sicht; sie greifen nicht mehr über `CombatSystem.getObstacleIndex()` auf fremde Interna zu. Der bestehende Index wird weiterverwendet, nicht durch einen neuen parallelen Combat-Index ersetzt. Fire-/Light-Indizes haben andere Aufgaben und werden nicht aus formaler Einheitlichkeit zusammengelegt.

World-Metrics, aktive Felsen, Base-Zellen, Barrieren und Train-Geometrie stammen von ihren jeweiligen kanonischen Ownern. Topologieänderung invalidiert die betroffenen abgeleiteten Indizes am World-Anschluss. Eine zerstörte oder deaktivierte Entity bleibt nicht wegen ihres weiter vorhandenen Renderobjekts ein Blocker.

Queries liefern numerische Geometrie und Target-Identität. Für Player wird der kanonische Body genutzt. Die heute teilweise sprite-geführte Enemy-/Decoy-Geometrie wird an deren Target-Adapter durch explizite Gameplay-Maße ersetzt. Dabei werden die vorhandenen **Combat-Maße** erhalten; ein beliebiger anderer Collision-Radius darf nicht ohne Paritätsbeleg eingesetzt werden. Kein vollständiger Enemy-Movement-/Renderer-Rewrite.[^geometry]

### 8.2 Hitscan-Vertrag

Die bestehende `HitscanShotRequest`-Semantik aus `WeaponFireExecutor` bleibt Eingangsgrundlage: Source, Gameplay-Ursprung, Winkel, Reichweite, Trefferbreite, mögliche Cursorbegrenzung, Gameplay-Payload und getrennte Visual-Metadaten. Die lange positional-Argument-Liste wird am Consumer durch diesen bzw. einen schmalen neutralen Request ersetzt.

Ablauf: sicheren Gameplay-Mündungsstart auflösen; effektive Reichweite bestimmen; nächsten Blocker/Target-Treffer ermitteln; Detonator- und Target-Wirkung gemäß bestehender Reihenfolge beauftragen; Trace-Ergebnis passiv projizieren. Weapon-ID-spezifische Config-Auflösung bleibt bei Execution, nicht im numerischen Trace-Core.

Favor-the-Shooter nutzt weiterhin die vorhandene begrenzte Swept-Circle-/Geschwindigkeits-Semantik mit den bestehenden Config-Werten. Es wird kein Rewind-/History-/Netcode-System eingeführt. Ein Support-Hitscan darf den Schützen treffen, ohne dessen eigene rückwärts kompensierte Trefferkapsel vor die Mündung zu ziehen.

Nächster Treffer und bisherige Gleichstandsregeln werden charakterisiert und explizit übernommen. Ein Freund kann je nach Mechanik geometrisch blockieren, ohne beschädigbar zu sein. Trace, Damage und Support beantworten deshalb unterschiedliche Fragen. Ein zerstörbares World-Target am Trace-Ende wird nicht nochmals über eine zweite ungefähre Endpunktsuche unabhängig ausgewählt.

### 8.3 Melee-Vertrag

Melee bleibt ein unmittelbarer Bogenangriff mit aufgelöster Reichweite, Arc, Target-Kategorien, Objektfaktoren und optionalen Rewards/Chains. Die Auswahl für den Grund-Swing wird vor dessen Mutationen bestimmt; dieselbe physische Entity wird pro Swing-Grundwirkung einmal verarbeitet. Reichweiten-/Radius-Toleranzen, Blockade und Base-Oberflächenabstand werden nicht durch einen simplen Kreis-AoE ersetzt.

Melee-Chain und Hitscan-Chain bleiben unterscheidbar: Die vorhandene Hitscan-Chain verlangt eine freie Schuss-/Sichtverbindung nach ihrem bisherigen Contract; die Melee-Chain erhält nicht allein wegen Wiederverwendung eine zusätzliche LoS-Regel. Gemeinsame Traversal-Mathematik ist erlaubt, unterschiedliche Mechanik bleibt parametrisiert oder lokal.

### 8.4 Prediction und Ausgabe

Der Client darf dieselben **reinen** Trace-Regeln mit lokalen Replica-Reads für eine Vorschau verwenden. Dieser Port kann weder mutieren noch den Host-Resolver aufrufen. Seine Geometrie kann zeitbedingt vom Host abweichen; nur das Host-Ergebnis entscheidet Damage/Death.

Gameplay-Mündung und visuelle Mündung bleiben getrennt. Bestehende Shot-Korrelation und Unterdrückung doppelter lokaler/empfangener Traces werden erhalten. Preview erfordert keine zweite autoritative Combat-Instanz und darf auch bei passiver World-Presentation keine Participation erzeugen.

## 9. Statuszustände und ihre konkreten Lifetimes

### 9.1 Zuordnung für dieses Refactoring

| Mechanik | State / Anwendung | Advance, Reads und Ende |
|---|---|---|
| Burn an Combatants | Combat; bestehende `BurnStateMachine` als privater Regel-/State-Baustein | expliziter Host-Advance; Target-/Life-Ende entfernt Brand; Quellenherkunft bleibt gesichert |
| Allgemeine Vulnerability | bestehendes `TargetStatusSystem` unter `WorldTargetingRuntime` | explizites Prune; Reads berechnen Ablaufwirkung ohne State-Mutation |
| Allgemeiner Enemy-Slow | ein fokussierter zielgebundener State unter World-Targeting | stärkster Faktor und spätester Ablauf gemäß `mergeEnemySlow`; keine zweite Map in Combat |
| Plasma-Ladungen / Swarm-Proc | zielbezogenes Mechanik-Reaktionsmodul mit bestehendem `PlasmaChargeTracker` | gemeinsame Ziel-Ladungen nicht pro Schütze duplizieren; Ende/Expiry explizit, Visuals nur Projektion |
| AK47-Fokus, Item-Stacks, Shotgun-/NEGEV-Ketten | bestehende zuständige Gameplay-/Mechanik-Owner | ihre Player-/Equipment-/Target-Lifetimes behalten; kein Umzug allein wegen On-Hit |
| Ground Fire, Wolken, Felder, Slime-Trail | jeweilige vorhandene World-/Gameplay-Owner | Kontakt/Tick erzeugt Request; Combat übernimmt nicht das Feld/Quellen-Grid |
| Burrow, Stun, Weapon-Block, Shield-Aktivierung | bestehende Player-/Enemy-/Defense-Owner | Combat konsumiert semantische Eligibility/Defense-Reads |

Diese Zuordnung ist eine konkrete Anwendung des Ownership-Prinzips aus 01, keine generelle Aussage, jeder Brand oder jede Verlangsamung müsse für immer unter Combat/Targeting liegen. Plasma darf als privates Mechanikmodul in den bestehenden Reaktionsbereich eingebettet werden; keine zusätzliche öffentliche Runtime nur für den Klassennamen.

### 9.2 Erhaltene Burn-Semantik

Die vorhandene `BurnStateMachine` bleibt maßgeblich für: einen Stack je Anwendung; Bucket-Zusammenfassung gleicher Ablauf-/Damage-Werte; globale Tick-Ausrichtung; gerundete Expiration; begrenztes Catch-up; stabile Beitragsreihenfolge. Die Werte kommen aus der bestehenden Config bzw. dem bestehenden Regelkern und werden nicht als zweite Balance-Wahrheit in Tests kopiert.[^burn]

Burn-Ticks beauftragen normalen Damage mit Burn-Herkunft und ohne Direct-Primary-Trigger. Bereits tote/ungültige Targets werden nicht erneut verarbeitet. Burrow beendet die bisher dadurch ungültigen Burn-Ziele gemäß bestehender Mechanik. Ein Source-Tod löscht bestehende Burns nicht pauschal. Der heutige endgültige Player-in-World-Detach entfernt dessen Burn-Quellen ausdrücklich; diese spezifische Regel wird erhalten, nicht zu einer generellen Cancellation sämtlicher committed Effekte erweitert.

### 9.3 Anwendung und reine Reads

Vulnerability eines direkten Projectile-Hits wird, soweit die Payload dies vorsieht, vor dessen Damage gelesen/angewandt; ein durch einen Direct-Primary-Affix erst ausgelöster Debuff wirkt dagegen auf nachfolgende Treffer. Burn-/Slow-Reihenfolgen bleiben am konkreten Impact verankert, siehe § 10.1. Null-Damage-Support und erlaubte Status-Actions bleiben möglich.

Unzulässige, stale oder bereits abgewiesene Targets erhalten nicht über einen Nebenhook trotzdem Status. `getEnemyMovementFactor`, HUD-/Burn-Reads und Snapshot-Build dürfen weder Ticks auslösen noch Mechanik-State weiterschalten. Abgelaufener Status kann im Read bereits neutral erscheinen; physisches Prune erfolgt im benannten Advance. Keine Simulation durch Renderhäufigkeit.

## 10. Reaktionen und kontrollierte Reentrancy

### 10.1 Trigger-Matrix

| Mechanik | Auslöser / Zeitpunkt | Abgrenzung |
|---|---|---|
| Quellenfaktoren, AK47-Strategic-Target-Vorbereitung | Geeigneter aufgelöster Direct-Hit vor Damage-Commit | Bestehender Mechanik-Owner liefert Faktor/Plan; kein freier Target-HP-Write |
| Projectile-Burn/Enemy-Slow/Vulnerability | Akzeptierter passender Kontakt; vor Damage entsprechend bisherigem Direct-/Explosion-Pfad | Aktuelle Zielart-/Payload-Filter bleiben; kein Status an stale/abgewiesene Targets |
| Hitscan-/Melee-Burn | Bestätigte geeignete Interaktion nach ihrer Damage-Anwendung wie bisher | Kein automatischer Auftrag für bereits gestorbene Targets |
| Direkte Projectile-Adrenalingabe | Tatsächlicher eigener Target-Damage; Decoy-Sonderfall aus akzeptiertem Decoy-Hit | Nicht Parent- plus Chain-Damage zusammenrechnen |
| Bestehende Hitscan-/Melee-/Chain-Hit-Rewards | Bestätigter geeigneter Hit gemäß bisheriger Mechanik | Nicht pauschal alle Rewards auf `damage > 0` umbauen; kein Reward für abgelehnte/ungültige Treffer |
| Rage / Damage-Taken-Affixe | Bestätigter tatsächlicher HP-/Armor-Verlust | Armor-Rage nur bei passender Regel; keine Rage aus Overkill/Block |
| Life-Leech | Tatsächlicher Verlust, geeignete lebende Quelle | Culling-Sonderfall ohne Leech; keine Heilung aus Sollschaden |
| Direct-Primary-Affixe / Culling | Tatsächlicher direkter Weapon-1-Damage gegen noch lebenden geeigneten Enemy | Kein Trigger aus Explosion/Burn/Chain/Reflect oder reaktionsbedingter Hinrichtung |
| Plasma-Charge / Swarm | Geeigneter bestätigter Direct-Kontakt; nicht zwingend HP-Verlust | Vorhandene Filter; Swarm-Children lösen keinen neuen Swarm aus; genau ein Spawn-Pfad |
| Gauss-/andere abgeleitete Entladung | Bestätigtes Parent-Outcome und dafür definierte Payload | Parent-Outcome bleibt unverändert; neue Targets eigene Outcomes |
| On-Kill / Death-Folgen | Bestätigte Transition plus Attribution | Kein Kill aus Despawn, Timeout-Removal oder verhinderter Lethality |

Ein geometrischer Kandidat, ein akzeptierter Hit und effektiver Damage sind drei verschiedene Belege. Die Matrix bewahrt bestehende unterschiedliche Reward-Semantik; nur echte falsche Erfolgsmeldungen werden korrigiert. Es wird weder Adrenalin-Orb-Gameplay implementiert noch dessen spätere Tuning-Entscheidung vorweggenommen.

### 10.2 Lokale Reihenfolge

Der grundlegende Vertrag ist synchron: Der mutierende Aufruf liefert ein festes eigenes Outcome. Benötigte unmittelbare Reaktionen werden vor dem nächsten expliziten Verarbeitungsschritt abgeschlossen, aber niemals während eines halbfertigen Vitals-Commits. Ein späterer Child-Request darf das Parent-Outcome nicht verändern.

Die bestehenden relativen fachlichen Reihenfolgen werden beibehalten, soweit keine benannte Korrektur nötig ist:

- **Player-Damage:** Vitals-/Life-Commit; Rage und Damage-Taken-Reaktion einschließlich ausdrücklich erlaubtem Reflect; Quellen-Leech; gegebenenfalls Player-Death-/Kill-Folgen. Passive Messung benutzt den vorher festgehaltenen Verlust, unabhängig von verschachteltem Damage.
- **Enemy-Damage:** Vitals-/Rettungs-/Death-Commit; Quellen-Leech; bei überlebendem Ziel Direct-Primary-Reaktion; gegebenenfalls Enemy-Death-/Kill-Folgen. Culling ist eine eigenständige Folgemutation, nicht rückwirkend ein anderes Parent-Outcome.
- **Projectile-Envelope:** Hit-Vorbereitung/erlaubte Statusanteile; eigener Direct-Commit; direkte Immediate-Reaktionen, z. B. AK47-Zielexplosion/Gauss und passende Hit-Rewards. Der genaue bestehende relative Punkt des jeweiligen Hooks wird bei seiner Adaptermigration charakterisiert; es entsteht kein zweiter Callback neben derselben Outcome-Reaktion.

Attribution für die eigene Mutation wird spätestens mit ihrem Outcome gesichert, **bevor** verschachtelte Mutationen deren Quelle überschreiben können. Bereits tödlich getroffene Targets sind für solche Children nicht mehr lebend. Technische Beobachter dürfen die Reihenfolge dieser Domain-Schritte nicht bestimmen.

### 10.3 Chains und Folgearbeit

Reflect-Damage trägt Reflect-Herkunft und darf denselben Damage-Taken-Reflect nicht rekursiv erneut anstoßen. Culling trägt eine explizite Reaction-Herkunft/Triggerbeschränkung, keinen normalen neuen Direct-Primary-Hit. Plasma-Child-Lineage bleibt erhalten. Endliche Chain-Länge, besuchte Target-Instanzen und vorhandene Schadens-/Radiusabnahme gewährleisten Fortschritt.

Die bestehende Shotgun-Lightning-Queue bleibt eine mechanikspezifische Queue und wird weiter in ihrem Player-Gameplay-Stage verarbeitet. Ein begrenztes Arbeitsbudget verschiebt übrige gültige Einträge, verwirft sie nicht still und verschiebt nicht beliebige andere Combat-Mutationen auf einen neuen Frame. Budgets bleiben im bestehenden Mechanik-Code, keine globale Reaction-Scheduler-Infrastruktur.

Gegen reentranten World-/Activity-/Life-Teardown wird nach einem externen autoritativen Hook und vor weiterer Arbeit die relevante Scope-Gültigkeit geprüft. Bereits bestätigte Mutation bleibt bestätigt; nachgelagerte stale Arbeit bleibt inert. Passive Beobachterfehler dürfen einen bestätigten Commit nicht zurücknehmen; autoritative Fehler werden dagegen sichtbar gemeldet und nicht durch Default-Erfolge kaschiert.

## 11. Death, Kill, Rewards und Player-Lifecycle

### 11.1 Transition und terminale Fakten

Vor Target-Entfernung werden die für Consumer nötigen Fakten gesichert: Target-Instanz/Art, fachliche Fraktion/Allegiance, relevante Attribution, Position, Enemy-Art bzw. Reward-Eligibility-Fakten, tödliche Damage-Art/Slot, benötigte aktive Statusquellen und opake Death-Presentation-Daten. Keine vollständige Kopie der Entity.

State-Owner meldet Death/Destroyed einmal. Combat ermittelt Attribution aus diesem Snapshot und dem gültigen Trefferverlauf, nicht aus späteren Entity-Maps. Dadurch funktionieren auch Enemy-Entfernung, gerettete Lethality, verbündete Enemies und Source-Despawn korrekt.

### 11.2 Attribution und Folgen

Die bisherige letzte gültige Fremdtreffer-Zurechnung bleibt, einschließlich ihrer ausdrücklich charakterisierten Behandlung von Selbst-/Umweltschaden. Ein vollständig verworfener oder geblockter Damage-Versuch darf keinen tatsächlichen Angreifer überschreiben. Zielbezogene Erinnerung endet mit der Target-/Life-Instanz; kein erfundener globaler Assist-/Damage-Log.

Für Summons und Konstrukte bleiben ausführende Quelle, Allegiance und Reward-Empfänger getrennt. Kill-/Roomstatistik kann einen Player zurechnen, ohne den ausführenden Enemy/Turm aus der Herkunft zu löschen. Fehlende oder nicht reward-berechtigte Empfänger werden nicht durch einen beliebigen verbundenen Player ersetzt.

Fachliche Verarbeitung nach bestätigtem Tod:

```text
Transition und benötigte Facts stehen fest
→ terminale Target-/Life-Deaktivierung und notwendiger Cleanup
→ passende Death-Mechanik, einschließlich Enemy-Death-Spawns/Timebomb/Necromancy
→ Kill-Attribution und passende Weapon-/Item-On-Kill-Reaktionen
→ Activity-/Reward-/Drop-Policy
→ passive Kill-/Death-/XP-Präsentation
```

Die jeweiligen konkreten Mechaniken bleiben bei ihren bisherigen zuständigen Ownern. Timebomb darf den normalen Death-Effekt ersetzen, nicht eine neue Death-Authority werden. Death-Statusquellen werden vor Cleanup als Werte weitergegeben. Enemy-Death-Spawns gehören zur Enemy-/Activity-Lifecycle-Verarbeitung und nicht mehr mitten in den offenen HP-Commit.

XP und Frags werden nicht unabhängig sowohl in `CombatSystem` als auch in einem World-Kill-Callback vergeben. Activity-Budget, Rewards, Objectives, Carry und Beer-Drops werden über detachbare Activity-/World-Ports angesprochen. Statistik, die Rewards beeinflusst, ist autoritative Domain, nicht passiver Observer. Persistenz bleibt unverändert.[^combat][^reactions]

### 11.3 Player-Lifecycle und Respawn

**Initial-Attach:** Participation/Initial-Spawn-Policy prüfen, Player-Vitals einmal initialisieren; Player-in-World-Komposition weiterhin maßgeblich. Ein Activity-Attach erzeugt nicht erneut Vitals oder World-Pickups.

**Tod:** Vitals-Owner setzt den terminalen Life-State. Player-Lifecycle deaktiviert Body/Interaktion und beauftragt die vorhandenen Life-Cleanups. Er führt nicht pauschal einen Player-in-World-Detach aus. Bereits committed, world-eigene Effekte folgen ihren eigenen Regeln.

**Respawn:** Ein kleiner world-lokaler Player-Lifecycle-Owner hält die fällige Deadline samt Life-/Policy-Kontext. Beim erlaubten Host-Lifecycle-Schritt werden Existenz, aktuelle Teilnahme, altes totes Leben und Respawn-Zulassung geprüft. Erst der tatsächliche Commit konsumiert das Activity-Budget einmal; Vitals/Actor werden anschließend konsistent reaktiviert. Keine asynchronen `setTimeout`-Mutationen im Damage-Core. Vor Budgetverbrauch müssen die benötigten Actor-/Spawn-Voraussetzungen gesichert sein.

**Reconnect:** Derselbe Respawn-Commit-Vertrag, kein separater kostenloser Leben-Pfad. `CoopMissionPlayerRuntime.handlePlayerDeath` und `consumeRespawn` bleiben fachlich getrennt. Ein Tod verbraucht nicht bereits den späteren Respawn; ein fehlgeschlagener/duplizierter Reconnect verbraucht ihn nicht doppelt.[^player-life]

**Detach/Activity-Wechsel:** Ausstehende Arbeit des beendeten Lebens bzw. seiner Activity-Policy wird invalidiert. Fortbestehende World-Player behalten ihren World-State. Eine neue Activity entscheidet ihre Regeln neu; ein alter Callback darf deren neues Budget nicht konsumieren. Entfernung ohne Kill erzeugt weder Death-Spawns noch Kill-Rewards.

## 12. Stabile Projectile-Adapter

### 12.1 Zu erhaltende Verträge

Bestehend bleiben `ProjectileCombatPort.resolveDirectImpact`, `resolveExplosionCombat`, ihre Request-/Outcome-Types sowie `ProjectileExplosionResolutionPort`. Target-/Barrier-/Geometry-Ports werden mit neuen Implementierungen gebunden, nicht durch neue parallele Projectile-Technologie ersetzt. Das abgeschlossene C8 darf nicht als offene Combat-Phase wiederaufgenommen werden.[^projectile]

Der Direct-Adapter akzeptiert weiterhin nur Player, Enemy und Decoy. Er übersetzt Provenance, Direct-Payload und Augments in Combat-/Mechanik-Operationen. World-Targets behalten ihren eigenen bestehenden Pfad. Combat erhält keinen `ProjectileRuntimeRecord`, keine Physics-Handles und keine Contact-Memory.

### 12.2 Verbindliche Outcome-Auslegung

`accepted` bezeichnet eine fachlich angenommene Target-Interaction, nicht bloß ein vorhandenes Target. Block/Defense und reine Support-Wirkung können akzeptiert sein. `actualDamage` stammt aus der eigenen bestätigten Target-Mutation, nicht aus spätem HP-Vergleich, Parent plus Children oder angefordertem Damage. `becameDead` stammt aus deren bestätigter Transition, nicht aus einer anschließenden `isAlive`-Abfrage. Eine separate Culling-/Chain-Mutation bleibt separat zurechenbar.

Das bestehende schmale Ergebnis darf nicht zu einem universellen Damage-/Reaction-Megaobjekt wachsen. Nur ein tatsächlich benötigter zusätzlicher Rückkanal rechtfertigt eine kleine Contract-Ergänzung mit Consumer-Migration und Test.

AK47-, Plasma-, Injector- und Adrenalin-Mechaniken erhalten **einen** autoritativen Pfad. Ein Callback, der bereits die Wirkung ausgeführt hat, darf nicht über dasselbe Outcome erneut verarbeitet werden. Rückgabemetadaten für passive Zwecke werden ausdrücklich von auszuführenden Commands unterschieden.

**Sweep-Nachbarvertrag:** Ein vom Combat-Port abgelehnter Kandidat und ein akzeptierter nichtterminaler Piercing-Hit dürfen die bereits simulierte restliche Frame-Bewegung nicht verlieren. Ein verbrauchtes Projectile bleibt dagegen am bestätigten Impact-Punkt; Redirect/Lifecycle-Mutation wird nicht durch eine Endpunkt-Restaurierung überschrieben. Diese Kinematikentscheidung verbleibt vollständig bei Projectile. Die bestehende Regression in `ProjectileTargetPiercing.test.ts` bleibt beim Adapter-Cutover geschützt.[^flight-delta]

### 12.3 Explosion und Continuation

Der World-Resolver führt Combat-Anteil, Environment, Impulse und authored World-Effekte an ihren bestehenden Ownern zusammen. `damagedTargetKeys` enthält nur Targets mit tatsächlichem Verlust. Ein Base-Anteil darf dort gemeldet werden, ohne Base-Storage nach Combat oder Base in die Direct-Port-Teilmenge zu verschieben.

Die am bestehenden Continuation-Consumer erwarteten Key-Formate und dessen benötigte Target-Abdeckung werden **am Adapter** erhalten. Nicht automatisch weitere Environment-Target-Kategorien in dieses Ergebnis aufnehmen. Insbesondere sind die heutigen Damage-Listenformate nicht mechanisch mit Collision-Key-Strings austauschbar. Interne physische Identität und externe Schlüssel werden an genau einer Grenze übersetzt.

`completeProjectileExplosion` erhält das passende Outcome im bisherigen Same-Frame-Flush. Projectile entscheidet selbst über Coast, nächste Stage, Rückkehr, Ausschlussgedächtnis oder Ende. Ein anderer Zeitpunkt oder eine andere Bedeutung von `damagedTargetKeys` benötigt einen expliziten §-17-Nachweis, keinen stillen Fallback. Bounce-Retention, Replica, Identity, Reflection/Deflection und Flight bleiben unangetastet.

## 13. Mehrzielwirkungen, Support und World-Fan-out

### 13.1 Wirkungseinheiten und neue Entities

Eine **Wirkungseinheit** ist eine fachlich einmalige Target-Auswahl samt ihren Mutationen, nicht automatisch der gesamte Schuss oder das gesamte Frame.

| Mechanik | Auswahl-/Dedupe-Vertrag |
|---|---|
| Direct Projectile-Hit | Projectile wählt Kontakt; Combat validiert diese Target-Instanz erneut, keine neue Collision-Auswahl |
| Ein Melee-Grund-Swing | Zielmenge vor erster Mutation; jede physische Entity einmal |
| Eine Explosion / ein radialer Pulse | Kandidaten der betroffenen Domains vor erster Mutation der Einheit festlegen; zum Commit Instanz/Eligibility revalidieren |
| Direct-Hit plus nachfolgende Explosion | Zwei explizite Einheiten; erst danach entstandene gültige Targets dürfen an der späteren Explosion teilnehmen |
| Cluster-/Mehrfach-/Mini-Rocket-Stage | Jede tatsächlich ausgeführte Teilwirkung eigene Einheit; keine künstliche schussweite Immunität |
| Chain | Pro ausdrücklich ausgeführtem Hop neue Suche im dann gültigen Zustand; besuchte Target-Instanzen bleiben ausgeschlossen; definierte Hop-/LoS-Regeln |
| Wiederholter DoT-/Feld-Pulse | Jeder fällige Tick/Pulse eigene Einheit, Quellen-/Target-Identität und Catch-up beibehalten |

Ein Death-Spawn wird deshalb nicht durch Mutation einer iterierten Map überraschend Teil **derselben** bereits begonnenen Explosion. Er darf sehr wohl durch eine nachfolgende getrennte Explosion oder einen zulässigen Chain-Hop getroffen werden. Kein pauschales Schutzfenster und kein Frame-weites Damage-Dedupe.

Die Auswahl kopiert nur benötigte Kandidaten/Geometriefakten der Wirkung, nicht die gesamte World. Ein Cross-Domain-Resolver darf dafür kleine vorbereitete Target-Listen an seine internen Combat-/World-Operationen übergeben. Das erweitert weder den öffentlichen Projectile-Request um einen Runtime-Context noch verlangt es eine globale Snapshot-Registry. Ein inzwischen entferntes Target wird vor seinem Commit abgewiesen; ein bereits bestätigtes Outcome wird dadurch nicht nachträglich ungültig.

### 13.2 World-Wirkungsanbindung

Projectile-/Grenade-Payloads, Detonationen, Meteore, Nukes, Turret-/Tesla-Pulse und standalone Explosions verwenden vorhandene kleine Resolver und fachliche Owner. Wo wiederholt dieselbe Fan-out-Reihenfolge existiert, darf ein schmaler konkreter World-Adapter sie zusammenführen. Keine universelle Effect-Registry oder zweite Explosion-Authority.

Combat-AoE bedeutet nicht automatisch Knockback, Fire-Zone, Reparatur oder Spawn. Eine Matrix-/Time-Bubble-Payload wird nicht durch ein Dummy-Damage-Result geführt. Ein Support-Impact beauftragt den passenden vorhandenen Owner. Die vollständige Source-Provenance bleibt bis zum letzten zuständigen Owner verfügbar, nicht nur bis zum ersten Combat-Aufruf.

Rock-Collapse, Base-Zerstörung, Train-Schaden und Construction-Expiry behalten Ursache, Attribution und fachliche Folgen. Enemy-/Activity-Anteile bleiben detachbar. Required Domain-Bindings fehlen nicht stillschweigend hinter optionalen No-op-Callbacks; nicht vorhandene optionale Mechanik wird dagegen ausdrücklich als nicht verfügbar modelliert.

## 14. Host-Zeit, Stages und Bindings

### 14.1 Zeitbasis

Der Host übernimmt den vorhandenen absoluten Zeitkontext an der Frame-/Action-Grenze und gibt `nowMs`/`deltaMs` weiter. Bestehende absolute Expiry-Werte werden nicht ohne Umstellung in eine andere Epoch übersetzt. Lokale Gameplay-Resolver verwenden keine verborgene Wall Clock oder eigene Zufallsquelle. Diagnostics-Zeitmessung ist davon getrennt.

Immediate Actions außerhalb des regelmäßigen Frame-Aufrufs bekommen ihren Host-Zeitkontext ebenfalls am Entry, nicht den zufällig zuletzt gesetzten Projectile-Zeitwert. Innerhalb eines Aufrufs teilen Modifier, Defense, Status und Reaktionen denselben fachlichen Zeitpunkt. Unscaled Host-Zeit und Projectile-simulierte Time-Bubble-Zeit bleiben getrennt.

Countdown/Pause verhindert die bisher dafür gesperrte periodische Simulation, nicht automatisch das Ablaufen absoluter Deadlines. Burn behält begrenztes Catch-up; Regen holt keine beliebige pausierte Zeit nach. Fälliger Respawn wird beim nächsten zulässigen Lifecycle-Schritt geprüft, nicht während einer Browser-Timer-Unterbrechung. Eine neue Pause-/Zeitdilatationsmechanik ist nicht Teil des Refactorings.

### 14.2 Verbindliche Einordnung, kein neuer Alles-Tick

Die bestehende Host-Reihenfolge ist Migrationsgrundlage:[^frame]

| Stelle | Combat-relevanter Vertrag |
|---|---|
| Frame-/Action-Eintritt | gültigen Host-Zeit-/Scope-Kontext setzen; fällige erlaubte Player-Lifecycle-Commits vor Nutzung dieser Figuren abschließen |
| Activity-Simulation | Enemy-/Objective-Aktionen dürfen unmittelbar Combat beauftragen; Activity besitzt ihren Ablauf |
| Player-PrePhysics | Item-/Resource-/Ability-Verarbeitung; Vitals-Regen an derselben relativen Stelle; bestehende Weapon-Reaction-Queue bleibt hier |
| Physics und Target-Felder | technische Kontakte, Bewegung und Matrix-/Injector-Aktualisierung; keine Combat-Regel im Physics-Binding |
| PreCombat / Projectile-Interaction | vorhandene Detonation-/Travel-/Upgrade-Schritte; danach Projectile-Interaction und Burn-Advance wie bisher |
| Projectile-Finalisierung | vorhandener Projectile-Stage; keine parallele Combat-Finalisierung aktiver Records |
| Player-PostProjectile | bestehende Guardian-/Repair-/Slime- und Gameplay-Verarbeitung |
| Deferred Domain-Flush | Detonationen, Projectile-/Standalone-Explosionen, Grenade-Payloads; Same-Frame-Continuation bleibt hier |
| Weitere World-Felder / Turrets / Train | ihre vorhandenen Stages beauftragen dieselben Combat-/World-Ports |
| Projektion / FX-Flush / Netz-Tick | nur fertige Outcomes und kanonischen State lesen; Netzwerk-Throttle darf Simulation nicht takten |

Eine Stage-Migration verschiebt keine Quelle nur deshalb, weil ihre neue Methode in einer anderen Klasse liegt. Die beiden bestehenden Projectile-Stages bleiben erhalten. Regeneration wird nicht zusätzlich sowohl von Combat-World-Update als auch Player-PrePhysics getaktet. Konkret liegt die bestehende Vitals-Regeneration nach dem Item-Update und vor Burrow-/Loadout-/Weapon-Reaction-Verarbeitung; die Burrow-Prüfung bleibt maßgeblich. Ein pauschales Verschieben an den Frame-Anfang würde bedingte Modifier oder Reaktionsfolgen verändern und ist kein bloßer Ownership-Cut. Expiry-Prune von Status erhält einen expliziten zuständigen Schritt vor seinen relevanten Reads.

### 14.3 Composition und Teardown

Zuerst werden neutrale World-Geometrie und Combat-Lifecycle/Ports erzeugt, dann die benötigten Gameplay-/Defense-/Target-Owner konstruiert und anschließend ihre zyklischen **fachlichen Verbindungen** an der Composition-Grenze geschlossen. Erst die vollständig gebundene World darf Host-Aktionen verarbeiten. Das ist keine globale Setter-Registry; ein begrenztes explizites Attach genügt.

Player-Gameplay darf Combat-Capabilities konsumieren und gleichzeitig Modifier-/Reaction-Ports bereitstellen. Der Zyklus wird durch neutrale Interfaces und klaren Build/Bind/Activate-Ablauf aufgelöst, nicht durch `ArenaContext` in Domain-Code. Required Ports werden vor Aktivierung geprüft. Nach Cutover keine permanenten optionalen Legacy-Fallbacks.

Teardown invalidiert Eingänge/ausstehende Arbeit zuerst, löst dann eigene Bindings und zerstört nur tatsächlich besessenen State. Ein altes Binding darf keinen inzwischen neu installierten Port nullen. Vorhandene Player-/Activity-Detach-Abhängigkeiten und World-Presentation-Handoff bleiben maßgeblich; kein pauschaler neuer Destroy-Loop entgegen deren Besitzreihenfolge.

## 15. Network, Presentation und Diagnose

Der Host entscheidet, der Adapter publiziert. Player-Vitals gehen in die bestehenden Player-Snapshots; Enemy/Base/Train/Placeables behalten ihre bestehenden Replica-/Delta-Owner. Combat-Outcomes speisen vorhandene Hit-/Death-/Hitscan-/Melee-/Kill-RPCs, nicht eine neue Netzwerk-Combat-Runtime.

World-/Activity-Revision, Bootstrap, explizite Empty-/Removal-Semantik, Loss-Recovery und Shot-Korrelation bleiben erhalten. Neue oder veränderte retriable Commands benötigen einen gültigen Attempt-/Source-Scope und at-most-once-Commit; interne normale Damage-Aufrufe erhalten dafür keinen globalen Dedupe-Cache. Wiederholte normale Pulse/Pellets dürfen weiter Schaden machen.

Host und Client nutzen passive Outcome-/Read-Projektionen. FX, Sound und Kamera dürfen während eines laufenden Frames ausgegeben werden, sobald das jeweilige Outcome abgeschlossen ist; sie müssen nicht auf das Ende frameübergreifender Ketten warten. Ein Snapshot setzt eine Baseline und spielt nicht rückwirkend alle vergangenen Hit-/Death-Ereignisse ab. Host-lokale und empfangene Ausgabe werden über die bestehende Korrelationssemantik entdoppelt.

Ein Host ohne lokale World-Presentation produziert dieselben Domain-Ergebnisse. Vorhandene technische Body-Proxies bleiben zulässig; Combat liest deren kanonische Runtime-Geometrie, nicht die Existenz oder Größe einer Darstellung. Target-/Death-Visualdaten werden früh genug als opake Werte erfasst; fehlende Assets dürfen keinen Damage-, Drop- oder Teardown-Pfad blockieren. Der Combat-Kern baut keine `SyncedDeathEffect`-Payload aus einem Sprite zusammen.

Diagnose-Observer erhalten abgeschlossene immutable Daten. Anzahl/Existenz eines Observers darf weder RNG-Reihenfolge noch Damage oder Tick-Verhalten verändern. Read-APIs mutieren keinen Status. Bestehendes Hit-Feedback bleibt optisch unverändert; neue HP-Trails, Farben, Muzzle-Effekte oder Orbs sind kein Arbeitsauftrag.

### 15.1 Bestehende Flight Signature als geschützter Nachbar

`ProjectileFlightPath`/`ProjectileFlightPlayback` und die Profile in `FlightSignature` sind bestehende Projectile-Presentation-Verträge. Sequenzierte Pfadhistorie, Breaks, Bounces und nachgelieferte terminale Segmente bleiben Projektionen; sie werden weder Collider-Quelle noch Damage-/Target-/Life-State. Der Combat-Cutover darf weder alte Tracer-Feldformen noch einen älteren Codec-/Protokollstand wieder einführen.

Der Client spielt betroffene Köpfe, Trails und Bounce-Feedback auf einer gemeinsamen verzögerten Präsentationszeit ab. Diese Zeit darf keine Host-Resolution, Modifier, Trefferabfrage oder Respawn-Zeit ersetzen. Terminale Nachlieferungen ergänzen ausklingendes Material, ohne einen aktiven Kopf oder eine Gameplay-Entity wiederzubeleben. World-Teardown beendet Playback/Cursor; weiterhin ein vorhandener Projectile-Presentation-Lifecycle, kein zweiter Combat-Renderer-Owner.[^flight-delta]

Diese Aussagen werden mit den vorhandenen `ProjectileFlightPath`, `ProjectilePresentationRuntime`, `ProjectileSnapshotCodec`- und `RocketSmokeGpuParticles`-Tests im relevanten V10/V12-Abgleich geprüft. Keine neue visuelle Gestaltung oder Browserkampagne gehört deshalb zum Combat-Refactoring.

## 16. Consumer- und Ownership-Cutover-Matrix

Diese Matrix benennt **Integrationsverantwortungen**, keine vollständige eingefrorene Dateiliste. P0 ergänzt reale Treffer aus der Symbolsuchen-Ausgabe; neue Consumer müssen einer Zeile zugeordnet werden, statt den Plan still zu erweitern.

| Cluster / aktuelle Einstiege | Ziel / notwendiger Cut |
|---|---|
| `ArenaScene`, `ArenaContext`, `ArenaLifecycleCoordinator`, `ArenaWorldGameplayComposition`, `ArenaWorldCombatComposition` | Scene-eigenen Combat-Kern entfernen; tatsächliche World-Boundary, geordneter Aufbau und stale-sicherer Teardown |
| `WorldCombatGameplayBinding` | Verdrahtung behalten bzw. vereinfachen; Damage-/Kill-/Modifier-/Reward-/Support-Regeln zu ihren fachlichen Ownern verlagern; nicht in Callback-Dateien verstecken |
| `WorldPlayerGameplayRuntime`, `PlayerCombatIntegrationPort`, `WeaponReactionPort` | schmale neutrale Combat-Ports; Herkunft im Kill-Outcome statt `getLastDamageOrigin`-Nachlesen; Player-Resources/Mechaniken bleiben dort |
| `WorldWeaponExecutionRuntime`, `WeaponFireExecutor`, automatisierte Execution | gemeinsame Fire-Capability beibehalten; Hitscan/Melee an neuen Combat-Vertrag binden; Projectile-Spawn nicht neu bauen |
| `WorldGeometryBinding`, `CombatGeometry`, `ArenaObstacleIndex`, `arenaWorldQueries` | gemeinsame World-Query-Capabilities; Target-Maße kanonisch; keine Combat-Authority im Geometry- oder Visual-Adapter |
| `EnemyManager`, `DecoySystem`, Base-/Rock-/Placement-/Train-Owner | kanonische Mutation-Outcomes, atomare Transitions, vor Removal gesicherte Fakten; keine zweiten HP-Writer |
| `RockVisualHelper`, `ConstructionWorldRuntime` | Damage/Repair/Destroyed-Folgen und Cleanup vom Renderpfad lösen; physische Materialisierung bleibt fachlich gebunden |
| `WorldPowerUpRuntime`, `PowerUpSystem`, RepairDrone, GuardianSpirit, Auren | passende Damage/Heal/Armor-/Read-Ports; eigene Pickup-/Effect-Lifetimes behalten; World-Podest-Fix schützen |
| `WorldSupportGameplayRuntime`, `WorldTrainRuntime`, Host-Explosion-/Environment-/Injector-/Support-Pfade | semantische World-Effekt-Anbindung; eigentliche Regeln nicht im Host-Frame oder im Combat-Core sammeln |
| `HostPhysicsSystem`, Burrow, Tunnel, Translocator, Turret, Tesla/EnergyShield | benötigte Read-/Relationship-/Defense-/Damage-/Geometry-Ports; Physics-/Ability-Ownership behalten |
| `CoopMission*Composition`, EnemyAttack/Ability/Support/Timebomb/Necromancy/VoidHunter, Activity-Player | detachbare Entity-/Policy-/Reaction-Ports; Respawn-Budget/Rewards/Spawns bleiben Activity-fachlich |
| AK47/NEGEV, WeaponUpgrade, FlamethrowerUpgrade, SlimeTrail, ItemRuntime | Quellen und Trigger sauber klassifizieren; spezialisierte State-Machines nicht in Damage-Core ziehen |
| `HostUpdateCoordinator`, `ClientUpdateCoordinator`, `RpcCoordinator` | Stage-/Read-/Command-/Ausgabe-Sichten; Vorschau ohne Host-Authority; berührte fachliche Regeln herauslösen |
| `WeaponBalanceLabRuntime` und vorhandene Headless-/Contract-Harnesses | neue öffentliche Regeln/Ports konsumieren; keine dritte Combat-Formel im Testlab |

Nicht berührte World-/Activity-/Renderer-Fachgebiete werden nicht vorsorglich neu entworfen. Offene ältere Architektur-/Authoring-Themen werden nicht allein wegen räumlicher Nähe Bestandteil. Für jede berührte Mutation gilt jedoch der vollständige Pfad einschließlich Cleanup und Ausgabe, nicht nur der Aufruf in `CombatSystem`.

## 17. Bewusste Korrekturen und Charakterisierung

### 17.1 Änderungsregister

Die folgenden Änderungen sind begründete Vertragskorrekturen. Sie sind keine Bestätigung, dass alle denkbaren Ausprägungen bereits reproduziert wurden. Die konkrete Regression wird vor dem produktiven Cutover durch den kleinsten passenden Test sichtbar gemacht.

| ID | Ist-Risiko / belegter Migrationsdruck | Normatives Soll / Beleg vor Abschluss |
|---|---|---|
| D1 | Direct-/Explosion-Ergebnis teilweise aus HP-Nachlesen, angenommenem Damage oder Kandidatenlisten | Eigener Mutation-Receipt; Block/Null/Overkill/Rettung/Culling nicht falsch als Damage/Death melden |
| D2 | Player-Death erst nach externen Damage-Reaktionen; Enemy-Lethal-Guard mutiert HP im Callback | Atomarer Life-Commit; Rettungsheilung separat, kein doppelter Tod bei Reflect/Cull |
| D3 | Bereits skalierte Damage-Werte und verschiedene Quell-/Payload-Faktoren schwer unterscheidbar | Jede gleiche Faktorherkunft einmal; reale Dublette korrigieren, keine pauschale neue Balanceformel |
| D4 | Lebender Entity-Lookup nach Enemy-Removal bzw. Gleichsetzung Allegiance/Attribution | Gesicherte terminale Facts und vollständige Source-Dimensionen; richtige Reward-/Kill-Zurechnung |
| D5 | Eigenständige Status-/Support-Wirkung aus `!canDamage` bzw. Status vor endgültiger Gültigkeitsprüfung | Eigene Support-/Status-Eligibility und ein Writer; Null-Damage-Support bleibt zulässig |
| D6 | Neue Entities können abhängig von Query-/Callback-Zeitpunkten in laufende Wirkung geraten | Explizite Einheiten und Startmengen; spätere Teilwirkungen dürfen neue Targets regulär treffen |
| D7 | Timer, mutable Status-Reads und stale Binding-/Life-Referenzen | Explizite Host-Zeit/Advance, reine Reads, keine Arbeit in Nachfolger-Scopes |
| D8 | World-Damage/Repair/Destroyed-Folgen in `RockVisualHelper` | Kanonische World-Mutation/Transition und fachlicher Cleanup unabhängig vom Renderer |
| D9 | Legacy-Default `direct` bei Quellen ohne Waffen-Direct-Semantik | Explizite Herkunft; keine fälschlichen Direct-Primary-/Kill-Affixe; echte Direct-Angriffe bleiben Direct |
| D10 | Mehrere Callback-/Metadatenpfade für Reaktionen und Rewards | Ein ausführender Pfad; gleiche Mutation/Transition löst dieselbe Folge nicht zweimal aus |

Für D3 und jeden numerisch wirksamen Befund werden vor Änderung konkrete Herkunftsfaktoren und ein synthetisches Beispiel notiert. Kann der Unterschied nicht eindeutig einer oben definierten Regel zugeordnet werden, wird er am Review-Gate entschieden. In 04 bleibt dazu nur der offene Befund, nicht ein dauerhaft wachsendes Fehlerarchiv.

### 17.2 Nicht versehentlich vereinheitlichen

Zu schützen sind insbesondere: Unterschiede zwischen Treffer- und Damage-Rewards; Burrow-/Telefrag-Ausnahmen; Armor-Gain gegenüber Regen; dynamische und eingefrorene Modifier; Player- gegenüber Enemy-/Base-Defense; Direct-Port-Target-Teilmenge; LoS gegenüber Schusslinie; Hitscan- gegenüber Melee-Chain; Damage- gegenüber Support-Payload; Direct-Hit gegenüber nachfolgender Explosion; Initialspawn gegenüber Respawn/Reconnect; World-Podeste gegenüber Activity-Podesten.

Die geschützte Aussage ist die Relation zwischen authored Config, Request, Runtime und Outcome. Aktuelle Zahlen, Waffenlisten, Farben oder private Dateiform sind keine zweite Wahrheit.

## 18. Nachweisverträge und Abschlussgrenze

| ID | Nachweis über öffentliche Verträge | Vorhandene Einstiegspunkte / kleinste Ebene |
|---|---|---|
| V1 | Host-only, World ohne Activity/Presentation, doppelfreier Attach/Detach und alter Callback nach Rebuild | bestehende World-/Activity-Integrationstests; kleine Fake-Ports |
| V2 | finite/capped Vitals, HP-/Armor-Verteilung, Leech/Overkill, Rettung, kein impliziter Respawn | fokussierte Mutation-/Combat-Regeltests |
| V3 | Faktorherkunft, Crit-Zulassung, Target-Defense, Relationship und Support unabhängig | synthetische Faktoren/Targets, keine Config-Literalsnapshots |
| V4 | Reentrant Reflect/Cull/Tod/Despawn/World-Teardown; Parent-Outcome unverändert, keine Doppelrewards | kleine deterministische Public-Runtime-Tests |
| V5 | Burn-Tick/Expiry/Catch-up, Slow-Merge, reine Reads und Scope-Ende | `CombatSystemBurnParity` / `BurnStateMachine` und Status-Tests erweitern/migrieren |
| V6 | Hitscan/Melee/LoF mit World-Blockern, Gameplay-Mündung, Favor-the-Shooter, passive Client-Vorschau | bestehende Combat-/LineOfFire-/Execution-Parität |
| V7 | Direct-Port-Outcomes, Zero/Blocked/Support, Explosion-Key-Feedback, Same-Frame-Continuation | bestehende Projectile-/Combat-Runtime-Verträge |
| V8 | Death-Spawns, separate Cluster-/Folgeexplosion, keine Doppelhits bei Base-/Train-/Rock-Alias | kleine Mehrziel- und Domain-Fan-out-Fälle |
| V9 | Repair/Destroyed/Drop/Podest-Cleanup ohne Renderer; Player-/Activity-Respawn-Budget und Reconnect | bestehende World-/Construction-/Power-up-/Respawn-Tests |
| V10 | Bootstrap/Delta/Removal, Outcome-/Trace-Korrelation, keine neue Client-Authority | vorhandene Network-/Presentation-/Client-Verträge |
| V11 | keine produktiven Combat-Legacy-Imports/Writer, keine Core→Phaser/Network/Scene-Abhängigkeit | Types/Compiler und kleine vorhandene Architecture-Suite |
| V12 | allokationsarme Hot Paths, bounded History/Queues, Last-/Balance-Parität | vorhandene Stress-/Balance-Lab-Suites, gleiche reproduzierbare Szenarien |

Ein Test muss nicht je Tabellenzeile neu entstehen. Vorhandene passende Tests werden erweitert; nur echte Lücken benötigen neue fokussierte Fälle. Die Fälle V4/V7/V9 müssen zusammen mindestens die reale Kette Resolution → kanonischer Writer → Receipt → Reaktion/Adapter abdecken; werden alle diese Stufen unabhängig gemockt, kann eine falsche HP-Rückrechnung unentdeckt bleiben. Engine-/Transport-Ränder dürfen weiterhin gefakt sein. Bestehende Respawn-Tests werden auf explizite Host-Zeit umgehängt, nicht parallel als zweite Timer-Implementierung erhalten.[^respawn-test] Architecture-Ratchets schützen Dependency-/Writer-Grenzen, nicht private Methoden oder eine historische Consumer-Liste. Keine Screenshot-, E2E- oder Browser-Infrastruktur für dieses Refactoring.

Technischer Abschluss verlangt die in 03 zusammengeführten Gates und keine offene fachliche Integration aus § 16. Die menschliche Gameplay-/Sichtabnahme ist ein eigener abschließender Gate. Hier genannte bestehende Testergebnisse aus Nachbarrefactorings ersetzen keinen Nachweis für den später veränderten Combat-Code.[^testing]

---

## Quellen des Repository-Abgleichs

Alle Links fixieren die oben genannte Analysebasis. Die Codepfade in den Abschnitten sind Migrationsanker, keine vorgeschriebene zukünftige Dateistruktur.

[^combat]: [`CombatSystem.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/systems/CombatSystem.ts) und [`WorldCombatGameplayBinding.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldCombatGameplayBinding.ts).
[^composition]: [`ArenaWorldGameplayComposition.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/scenes/arena/ArenaWorldGameplayComposition.ts), [`ArenaWorldCombatComposition.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/scenes/arena/ArenaWorldCombatComposition.ts), [`WorldRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldRuntime.ts).
[^world-edges]: [`RockVisualHelper.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/scenes/arena/RockVisualHelper.ts), [`arenaWorldQueries.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/scenes/arena/arenaWorldQueries.ts) und [`WorldSupportGameplayRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldSupportGameplayRuntime.ts).
[^mutations]: [`EnemyManager.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/entities/EnemyManager.ts), [`DecoySystem.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/systems/DecoySystem.ts), [`RockHpRegistry.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/arena/RockHpRegistry.ts).
[^execution]: [`WeaponFireExecutor.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/loadout/WeaponFireExecutor.ts) und [`WorldWeaponExecutionRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldWeaponExecutionRuntime.ts).
[^geometry]: [`WorldGeometryBinding.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldGeometryBinding.ts), [`CombatGeometry.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/systems/CombatGeometry.ts), [`DirectCombatHitResolver.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/combat/rules/DirectCombatHitResolver.ts).
[^burn]: [`BurnStateMachine.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/combat/rules/BurnStateMachine.ts).
[^reactions]: [`PlayerCombatIntegrationPort.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/PlayerCombatIntegrationPort.ts), [`WeaponReactionRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WeaponReactionRuntime.ts) und [`WorldPlayerGameplayRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldPlayerGameplayRuntime.ts).
[^player-life]: [`PlayerWorldRuntimeComposition.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/PlayerWorldRuntimeComposition.ts) und [`CoopMissionPlayerRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/activity/CoopMissionPlayerRuntime.ts).
[^projectile]: [`ProjectileCombatPort.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/projectile/ProjectileCombatPort.ts), [`ProjectileExplosionPort.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/projectile/ProjectileExplosionPort.ts) und [Projectile-Abschlussstatus einschließlich C8](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/GDDs/Projectile%20Runtime%20Refactor/04_Projectile_Runtime_Migration_Status.md).
[^frame]: [`HostUpdateCoordinator.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/scenes/arena/HostUpdateCoordinator.ts) und die Host-Stages in `WorldPlayerGameplayRuntime.ts`.
[^pedestals]: [World-Podest-Lifecycle-Korrektur](https://github.com/Dominik-Steinweg/Fragdachse/commit/53fc19bfdf19ff9930a1b08ac71a3af8f57e3ee1).
[^testing]: [Testpolicy](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/ai/testing.md), [Agenten-Router](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/AGENTS.md), [Runner](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/package.json).

[^respawn-test]: [`tests/CombatSystemRespawn.test.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/tests/CombatSystemRespawn.test.ts): vorhandene Budget-, Participation- und World-ohne-Activity-Verträge; heutige Timer-/private-Methoden-Testform ist kein Zielcontract.

[^flight-delta]: [Sweep-Korrektur](https://github.com/Dominik-Steinweg/Fragdachse/commit/09524fd6fd07ffd6bb19c9f5522f34ba37ad445d), [Flight-Signature-Delta](https://github.com/Dominik-Steinweg/Fragdachse/commit/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26), [`ProjectileFlightPlayback.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/projectile/ProjectileFlightPlayback.ts), [`ProjectilePhysicsBinding.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/projectile/ProjectilePhysicsBinding.ts) und [Flight-Replikationsvertrag](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/ai/networking.md). Analyse der produktiven Änderungen und vorhandenen Testverträge, keine hier ausgeführte Testabnahme.
