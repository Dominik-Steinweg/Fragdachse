# Fragdachse – Combat Runtime Architecture Core

**Status:** Normative Zielarchitektur; keine Aussage über bereits erfolgte Umsetzung.\
**Dokument:** `01_Combat_Runtime_Architecture_Core.md`\
**Repository-Abgleich:** `main` @ `d5cb4519fb06dd74e22d21e8d63e635ea75bbc26`, 06.09.2026. Quellcode- und Dokumentanalyse, keine Laufzeitabnahme.\
**Ausgangslage:** Das Projectile-Statusdokument meldet das Refactoring einschließlich C8 als architektonisch und technisch abgeschlossen. Seine realisierten Grenzen sind verbindliche Nachbarverträge. Die nachfolgenden Sweep-/Flight-Signature-Änderungen sind im Repository-Abgleich berücksichtigt. Eine menschliche Gameplay-/Sichtabnahme wird damit nicht behauptet.[^projectile][^delta]

> **Combat löst gemeinsame Treffer- und Zustandsänderungsregeln auf. Der jeweilige State-Owner bestätigt die Mutation. Explizite Reaktionen verarbeiten das Ergebnis; Network und Presentation projizieren es.**

## 1. Geltung und Dokumentverbund

Dieser Core legt dauerhafte Verantwortungen, Ownership, Authority, Lifetimes und Abhängigkeiten fest. Er ist kein Klassenentwurf oder Implementierungsplan. Die beschriebenen Grenzen sind normativ; bestehende Dateien sind Migrationsanker, keine vorgeschriebene Ziel-Dateistruktur.

Der Verbund besteht aus **[01 Core](01_Combat_Runtime_Architecture_Core.md)**, **[02 Detailverträgen](02_Combat_Runtime_Architecture_Details.md)**, **[03 Implementierungsplan](03_Combat_Runtime_Implementation_Plan.md)**, **[04 Migrationsstatus](04_Combat_Runtime_Migration_Status.md)** und **[05 Arbeits-/Review-Spickzettel](05_Combat_Runtime_Implementation_Cheatsheet.md)**. 02 definiert normative Detailcontracts, Daten- und Sonderfallsemantik. 03 leitet daraus Migrationsphasen, Gates und Cutover-Reihenfolge ab; es plant die Umsetzung der definierten Contracts, nicht neue Architektur. 04 dokumentiert den tatsächlichen Stand. 05 führt durch diese Dokumente, ohne zusätzliche Architekturpflichten. Die operative Phasenführung einschließlich orchestrierter Arbeitsblöcke, Review-Stopps und Nutzerfreigaben steht ausschließlich in 03–05; sie verändert keine fachliche Authority.

Dieser Core präzisiert das Gameplay-Combat-Zielbild (§§ 17–20) und konkretisiert in § 4 die World-Ownership des veränderlichen Combat-States und seines Lifecycles, nicht die physische Lebensdauer zustandsloser Helfer. Die Projectile-Verträge bleiben verbindliche Nachbarverträge. Weder Folgedokumente noch Adapter dürfen Grenzkonflikte durch eine zweite Authority verdecken.[^principles][^gameplay]

## 2. Architekturentscheidung nach dem Projectile-Refactoring

**Das bisherige Grundmodell bleibt richtig: gemeinsame Combat-Regeln, verteilte kanonische State-Owner und explizite Gameplay-Reaktionen.** Nicht mehr passend ist, das alte `CombatSystem` als zukünftiges Zentrum sämtlicher trefferbezogener Systeme zu behandeln.

| Befund am geprüften Stand | Konsequenz für das Zielbild |
|---|---|
| Projectile-Lifecycle und Collision sind bereits ausgegliedert; Combat implementiert semantische Impact-/Explosion-Grenzen. | Keine erneute Projectile-Zerlegung. Ein Adapter hinter den vorhandenen Ports verbindet diese mit Combat-internen Verträgen. |
| Player-Vitals, Attribution, Status, unmittelbare Angriffe, Respawn und FX-/Network-Aufgaben liegen weiterhin zusammen. | Eine tatsächlich world-owned Combat-Boundary; State, Resolution, Lifecycle und Ausgabe erhalten unterschiedliche Zuständigkeiten. |
| Reaktionen können während der Damage-Verarbeitung erneut Damage auslösen. Mehrere Rückgaben werden noch aus nachträglichen HP-/Alive-Abfragen oder Erfolgs-Flags rekonstruiert. | Belastbare Mutation-Outcomes und explizite Reentrancy sind Kernverträge, nicht optionales Aufräumen. |
| World-Bindings enthalten neben Verdrahtung auch Kill-, Reward-, Support- und Modifier-Regeln. Der Hindernisindex wird von Combat und Projectile gemeinsam genutzt. | Keine Verlagerung der God Class in ein Binding. Fachliche Regeln gehen zu ihren Ownern; gemeinsame Geometrie bleibt eine gemeinsame World-Capability. |

Diese Befunde ergeben sich aus `CombatSystem`, `WorldCombatGameplayBinding`, den Projectile-Ports und dem Host-Fan-out.[^combat][^binding][^ports][^host]

Die Architektur wird **nicht mechanisch aus Projectile kopiert**: Combat benötigt weder einen zentralen Store aller beschädigbaren Entities noch ein Processor-System, eine eigene vollständige Client-Replica oder einen neuen Explosion-Manager.

## 3. Verantwortungsgrenzen

`WorldCombatRuntime` bezeichnet die öffentliche, world-owned Combat-Boundary: Sie besitzt ihren Combat-State/Lifecycle, bietet schmale Consumer-Capabilities und ordnet die lokale Resolution. Das verpflichtet weder zu einer großen Klasse noch zu einer Klasse pro Verantwortung.

```text
Player / Enemy / Turret / World
        │ aufgelöste Execution bzw. fachlicher Wirkungsauftrag
        ├── eigenständige Domain-Status-Action → zuständiger Owner
        ├── Projectile Runtime ── bestehender Combat-Port/Adapter ─┐
        ├── unmittelbarer Hitscan / Melee ─────────────────────────┤
        └── direkte Damage-/Heal-/Armor-Aufträge ──────────────────┤
                                      ┌────────────────────────────┘
                                      ▼
                         Combat-Resolution + schmale Domain-Ports
                                      │
                         kanonischer State-Owner
                                      │ bestätigtes Outcome
                         geordnete Gameplay-Reaktionen
                                      │
                    passive Observation / Replication / Presentation
```

**Combat** verantwortet gemeinsame Resolution, Outcomes, Attribution und die Anbindung passender Target-/Reaktions-Owner. Hitscan, Melee und Combat-AoE sind unmittelbare Capabilities dieser Grenze, nicht Teile des Damage-Regelkerns. Gemeinsame Regeln konsumieren semantische Daten statt Waffen-ID-Sonderzweige.

Statusanteile einer Combat-/Hit-Auflösung werden über Combat beim zuständigen Status-Owner beauftragt. Eigenständige Domain-Status-Actions dürfen ihn nach eigener Validierung direkt beauftragen. Beide Wege nutzen denselben Status-Writer; Combat ist kein allgemeiner Status-Router.

**Execution und Ability** behalten Aktivierung, Zielabsicht, Ressourcen-Commit, Cooldowns, Windups und laufende Waffen-/Utility-Lifecycles. Einfache Enemy- oder Turret-Angriffe müssen nicht durch Player-Loadout laufen. Die vorhandene gemeinsame Weapon-Execution bleibt erhalten.[^execution]

**World-/Support-Domains** behalten Reparatur, Construction-/Base-/Train-/Environment-Mutation, Felder und Spawns. Sie dürfen Combat-Regeln nutzen, ohne ihren State abzugeben. Support wird nicht als Damage-Aufruf mit Sonderwerten erzwungen.

## 4. Ownership, Lifetime und Lifecycle

| Zustand oder Verantwortung | Fachlicher Owner | Lifetime / Grenze |
|---|---|---|
| Combat-Boundary, Combat-State und World-Bindings | `WorldRuntime` besitzt `WorldCombatRuntime` | Genau eine lokale World-Runtime |
| Player-HP, Armor und Lebendzustand | Ein Player-Vitals-Owner innerhalb Combat | Player-in-World mit expliziter Life-/Respawn-Grenze |
| Enemy-/Decoy-Health und deren Tod/Entfernung | Jeweiliger Enemy-/Decoy-Owner | Konkrete Entity-Instanz; bei Activity-Entities deren Activity |
| Base-, Rock-, Construction- und Train-Health/Integrity | Jeweiliger World-/Entity-Owner | Konkrete World-Entity |
| Combat-Attribution und Combat-eigener Status gemäß § 9.1 | Combat | Betroffene Target-Lifetime; Quellen behalten benötigte Herkunft |
| Allgemeiner Target-Status, etwa Vulnerability | Target-/World-Status-Owner | Betroffene Target-Lifetime innerhalb der World |
| Waffen-/Item-Stacks und spezielle Reaktionszustände | Zuständiger Mechanik-Owner | Player-, Ausrüstungs-, Target- oder Effekt-Lifetime gemäß Mechanik |
| Schild-/Dome-Zustand, Ressourcen und Ability-Lifecycle | Bestehende Defense-/Gameplay-Owner | Zugehörige Ability-/Actor-/World-Lifetime |
| Respawn-Zulassung, Teilnahme, Spawn-Ort und Actor-Reaktivierung | Player-/World-Lifecycle mit Activity-Policy | Player-in-World bzw. einzelner Life-Übergang |
| Round-Rewards, Objectives und persistenter Fortschritt | Activity-/Reward- bzw. Meta-Owner | Eigener fachlicher Scope, nicht Combat-Lifetime |
| Hindernis-/Target-Geometrie und abgeleitete Indizes | World-/Target-Owner | Gebundene World bzw. Entity |
| Replizierte Kopien und lokale Darstellung | Bestehende Replication-/Presentation-Owner | Scope der jeweiligen Projektion |

### 4.1 World statt Scene

Mutable Combat-Daten und ihr Lifecycle gehören einer konkreten World-Runtime; damit ist Teardown eine Besitzgrenze statt einer Reset-Konvention eines Scene-Owners. Eine scene-langlebige Übergangsfassade darf nur weiterleiten, keine eigenen Combat-Daten, Timer oder alternativen Writer behalten. Zustandslose Engine-/Geometry-/Adapter-Helfer dürfen länger leben, sofern ihre World-Bindings vollständig gelöst werden; ihr Neuaufbau ist nicht aus formaler Symmetrie erforderlich.

Combat funktioniert ohne Activity und lokale Presentation. Activity-Wechsel ersetzen kurzlebige Target-/Policy-Bindings, nicht fortbestehenden Player-/World-State. Fachliche Resets benötigen eine ausdrückliche Policy. Die bestehende World-/Player-Composition bleibt Lifecycle-Anschluss; kein paralleler Aufbaupfad entsteht.[^world]

### 4.2 Player-in-World ist nicht ein einzelnes Leben

Attach, Tod, Respawn, Reconnect und Detach sind verschiedene Übergänge. Respawn initialisiert Life-State, nicht die gesamte Player-Gameplay-Runtime. Reconnect gewährt nicht automatisch ein neues Leben und verbraucht dieselbe Respawn-Berechtigung nicht zweimal.

Despawn/Teardown ohne Kill erzeugt keine Kill-Rewards oder Death-Spawns. Der jeweilige kanonische State-Owner bestätigt `becameDead`/`becameDestroyed` atomar; Combat leitet daraus Attribution und Combat-Reaktionen ab. Zuständige Lifecycle-/Gameplay-Owner führen Deaktivierung, Cleanup, Drops und erlaubte Wiederkehr aus.

### 4.3 Identität und Teardown

Target-Referenzen unterscheiden Art und Identität. Gespeicherte Referenzen müssen außerdem ihren gültigen World-, Activity-/Entity- und gegebenenfalls Life-Kontext bestimmen. `worldRevision` allein schützt nicht gegen eine neue Activity oder lokale Runtime derselben World. Die Darstellung dieser Identität gehört in 02; kein globales ID-Register ist vorgeschrieben.

World-Runtime-Ende beendet sämtlichen Combat-State, Aufträge und Bindings. Kürzere Actor-/Activity-Scopes werden separat invalidiert; ein bereits committed Effekt darf nur bei weiterhin gültiger World und ausdrücklich eigenständiger Effekt-Lifetime fortbestehen. Alte Calls bleiben inert oder werden abgelehnt; alte Teardowns lösen keine neue Bindung. Presentation-Handoff überträgt keinen Combat-State.

## 5. Authority und erlaubte Abhängigkeiten

**Nur der Host entscheidet Combat-Mutationen und Gameplay-Folgen.** Clients liefern Eingaben und optische Vorhersage, keine verbindlichen Treffer, Health- oder Reward-Entscheidungen. Autorisierte Entry-Points und gültige Runtime-Bindings sichern diese Grenze; implizite Host-Annahmen reichen nicht.

| Grenze | Erlaubt | Nicht erlaubt |
|---|---|---|
| Composition / Frame-Orchestrierung | Owner erzeugen, passende Ports verdrahten, Reihenfolge und Publish-Punkte ordnen | Eigene Damage-/Kill-/Waffenregeln in Callbacks verstecken |
| Combat-Runtime | Semantische Target-, Modifier-, Defense-, Status- und Reaktions-Ports | `ArenaContext`/`WorldRuntime` als Service Locator, konkrete Activity-Runtime oder Transportobjekte |
| Gemeinsamer Regel-/Resolution-Core | Neutrale Contracts, aufgelöste Daten, kleine testbare Regeln | `NetworkBridge`, Phaser-/Sprite-APIs, Renderer, Audio, Save-Schema oder Loadout-Interna |
| Target-/State-Owner | Eigene Zustandsmutation und Transition bestätigen | Zweiten Health-/Armor-Writer neben einem anderen Owner etablieren |
| Projectile-Adapter | Bestehende Projectile-Verträge in Combat-Aufträge und Ergebnisse übersetzen | Projectile-Records, Flight-State oder Contact-Memory lesen/mutieren |
| Gameplay-Reaktionen | Über semantische Commands weitere Wirkungen beauftragen | Direkte Writes fremder Maps/Entities oder unkontrollierte Rückkopplung |
| Read-/Ausgabe-Consumer | Unveränderliche Ergebnisse und abgeleitete Reads konsumieren | Gameplay durch Lesen, Rendern oder Netzwerkempfang erneut auslösen |

Combat-Vertragstypen liegen außerhalb der Implementierung. Consumer erhalten ihre benötigte Sicht, nicht den kompletten Owner oder einen dauerhaften `Pick<CombatSystem, …>`-Ersatz. Weder ein Port pro Methode noch ein universelles `CombatContext` ist Ziel.

Relationship, Selbst-/Teamschaden, Support-Berechtigung und Teilnahme sind **Domain-Regeln**. Network transportiert die zugrunde liegenden Deskriptoren, entscheidet diese Regeln aber nicht. „Nicht beschädigbar“ bedeutet weder automatisch „befreundet“ noch „heilbar“. Geometrische Blockade, Targetability und Wirkungsberechtigung bleiben unterscheidbar.[^network]

Gameplay-Quelle, Actor, Attribution, Allegiance, Lineage und Correlation sind nicht eine universelle `ownerId`. Benötigte Herkunft muss Reflection, verbündete Gegner, Konstrukte und entfernte Quellen überstehen. Action-Zulassung darf nicht ungeprüft zur erneuten Zulassungsprüfung bereits committed Folgeeffekte werden.

## 6. Mutation und bestätigte Outcomes

Die verbindliche Grenze lautet:

```text
Auftrag / Interaktion
→ Berechtigung und aufgelöste Regeln
→ kanonische Mutation einschließlich Transition-Entscheidung
→ unveränderliches Mutation-Outcome
→ ausdrücklich geordnete Folgeoperationen
```

**Ein Writer, kein globaler Speicher.** Player, Enemy, Decoy und World-Target nutzen gemeinsame Regeln, mutieren aber bei ihrem kanonischen Owner. Auch Initialisierung, Heilung, Regeneration, Armor-Gain/-Verlust und Cap-Anpassung umgehen ihn nicht. Fehlende erforderliche Ports erlauben keinen stillen Direktzugriff.

**Gültige Vitals.** HP, Armor und Caps bleiben endlich und innerhalb ihrer fachlich gültigen Grenzen. Heilung und Regeneration beleben Tote nicht implizit wieder; Wiederbelebung ist ein ausdrücklicher Life-Übergang. Armor-Gain, Armor-Verlust und Regeneration behalten ihre unterschiedliche Semantik. Negative Armor-Änderung ist nicht automatisch negativer Damage.

**Jeder Modifier einmal am definierten Punkt.** Quellen-/Slot-Faktoren, Crit, Falloff, Vulnerability, Defense, Damage Reduction und Armor haben explizite Resolution-Zeitpunkte. Bereits skalierte Werte werden nicht erneut skaliert. 02 legt Reihenfolge, Rundung und Auflösungszeitpunkt je Wirkungspfad fest, statt pauschal alles auf Snapshot-at-fire oder Read-at-hit umzustellen.

**Ergebnis statt Nachberechnung.** Ein Outcome unterscheidet, soweit für Consumer erforderlich: abgelehnt, akzeptiert, geblockt, tatsächlich verlorene HP/Armor, tatsächlich erhaltene Heilung/Armor sowie bestätigte Life-/Destruction-Transition. Es enthält belastbare Herkunft und Target-Identität. Weder angeforderter Schaden noch ein Boolean-Erfolg noch ein späteres `before − currentHP` ersetzen diese Aussage.

**Tod wird atomar entschieden.** Der State-Owner bestätigt `becameDead`/`becameDestroyed` höchstens einmal für die betroffene Instanz bzw. das Leben. Externe Reaktionen sehen keinen halb abgeschlossenen Life-Übergang. Tödlicher Damage mit zulässiger Rettung ist nicht automatisch Tod: Damage und Rettungsheilung müssen unterscheidbar bleiben, statt als Netto-HP-Differenz zu verschwinden. Der vorhandene Enemy-Lethal-Guard macht diese Unterscheidung bereits notwendig.[^enemy]

**Treffer ist nicht gleich Schaden.** Geometrischer Kontakt, akzeptierte Interaktion, effektiver Schaden, Status-Anwendung, Heilung und Kill sind verschiedene Trigger. Support oder ein ausdrücklich erlaubter Status kann bei null Damage gültig sein. Schadensabhängige Rewards benutzen tatsächlichen Schaden; akzeptierte Treffer dürfen nicht pauschal in solche Rewards umgedeutet werden.

**Atomarität gilt lokal.** Das Target-Outcome steht vor Folgemutationen fest. Compound-Wirkungen behalten ihre Einzel-Outcomes und eine explizite Reihenfolge; eine globale Rollback-Transaktion über alle Targets und World-Domains ist nicht Ziel.

## 7. Stabile Projectile↔Combat-Grenze

Die vorhandenen `ProjectileCombatPort`, `ProjectileDirectImpactRequest/Outcome` und `ProjectileCombatExplosionRequest/Outcome` bleiben die Integrationsgrenze. Der Adapter darf noch Projectile-spezifische Payloads kennen; der gemeinsame Damage-/Health-Core wird deshalb nicht von `ProjectileSpawnRequest`, Waffen-Sonderfeldern oder Presentation-Metadaten abhängig.[^ports]

**Direct Impact:** Projectile liefert das bereits ausgewählte Target und den Kontakt. Für den bestehenden Direct-Port ist die Target-Teilmenge **Player, Enemy, Decoy**. Combat löst deren fachliche Wirkung einschließlich target-lokaler Defense auf. Collision-Reihenfolge, Kontaktgedächtnis, Durchschlag, Verbrauch, Lifetime und tatsächliche Projectile-Mutation bleiben ausschließlich bei Projectile.

**Defense:** World-space Barrieren werden über den bestehenden Barrier-Port am dafür vorgesehenen Projectile-Aufrufpunkt ausgewertet. Target-lokale Defense wird innerhalb der Target-Interaction entschieden. Aktive externe Deflection bleibt ein Command an Projectile. Combat liefert gegebenenfalls ein Defense-Ergebnis, mutiert aber weder Velocity noch Attribution des Projectile-Records. Dieselbe Defense darf nicht in zwei Ebenen erneut verbraucht werden.

**Explosion:** `ProjectileExplosionResolutionPort` bleibt außerhalb des gemeinsamen Combat-Cores für den vorhandenen Domain-Fan-out zuständig. Combat löst nur seinen Anteil auf; Environment, Ground Fire, Knockback, Felder und Spawns bleiben bei ihren Ownern. Gemeinsame Basisschadensregeln dürfen Combat nutzen, ohne Base-Health zu übernehmen; aus dem heutigen Base-Anteil der Combat-AoE folgt keine Erweiterung des Direct-Target-Ports. Standalone-Wirkungen benötigen kein künstliches Projectile.[^host][^projectile-details]

**Rückkanal:** Ergebnisse für Projectile-Continuation entstehen aus bestätigten Wirkungen. `damagedTargetKeys` darf kein ungeprüftes Verzeichnis bloßer Kandidaten oder Damage-Versuche sein. Benötigt eine Mechanik zusätzlich Kontakt-/Ausschlussgedächtnis, ist das gesonderte Semantik. Bestehende Same-Frame-Rückmeldungen und Spawn-/Continuation-Phasen bleiben erhalten. Callback und Outcome-Metadatum dürfen dieselbe autoritative Reaktion nicht zweimal auslösen.

02 weist notwendige Outcome-Korrekturen ausdrücklich nach. Unschärfen heutiger Produzenten sind kein Zielvertrag und kein Auftrag für einen erneuten Projectile-Umbau.

## 8. Hitscan, Melee, AoE und gemeinsame Geometrie

Hitscan und Melee bleiben **unmittelbare Execution-Capabilities**. Sie bestimmen ihre Treffer mit passenden Geometrie-/Target-Reads und beauftragen danach die gemeinsame Wirkungsauflösung. Sie werden weder als kurzlebige Projectiles simuliert noch mit Flight-/Replication-State ausgestattet.

Die World stellt gemeinsame Geometrie-Capabilities bereit. Der geteilte Hindernisindex bleibt abgeleitete Geometrie, keine zweite Wahrheit und kein Combat-Health-State. Ein Sichtlinien-Consumer benötigt kein vollständiges Combat-System.[^geometry]

Sichtlinie und Schusslinie bleiben semantisch verschieden, insbesondere bei dynamischen Blockern wie dem Zug. Gameplay-Mündung, rein visuelle Mündung, Trefferbreite, Zielradius, Arc, Oberflächenabstand und Blocker-Toleranz behalten ihre ausdrückliche Bedeutung. Die vorhandene Favor-the-Shooter-Semantik bleibt Host-Resolution; eine lokale Vorschau ist keine Hit-Authority. Dieses Refactoring führt kein neues Lag-Compensation-Modell ein.

Eine physische Entity wird innerhalb derselben Wirkung nicht wegen mehrerer Collider, Train-Segmente, Base-Zellen oder Rock-/Construction-Aliase mehrfach geschädigt. Mehrfachtreffer durch verschiedene Pellets, Pulse, Swings oder ausdrücklich getrennte Teilwirkungen bleiben möglich. Dedupe folgt der fachlichen Wirkung und Target-Instanz, nicht pauschal einer Projectile- oder Actor-ID.

Auswahl, Reihenfolge und Teilnahme neuer Entities an Mehrzielwirkungen sind explizit. Death-Spawns geraten nicht zufällig durch Collection-Mutation in denselben Durchlauf. Ob Direct-Hit, Folgeexplosion, Cluster oder Chain sie treffen dürfen, entscheidet 02 anhand der Wirkungseinheiten, nicht durch pauschale neue Immunität.

## 9. Status, Reaktionen, Death und Kill

### 9.1 Status nach Semantik, nicht nach Auslöser

Status gehört zum kleinsten fachlich passenden Owner. Combat darf Brand-/Status-State besitzen, wenn Regeln und Lifetime tatsächlich Combatant-spezifisch sind; weder ein Damage-Trigger noch der heutige Speicherort allein begründen diese Ownership. Bodenfeuer, Wolken und Felder behalten ihre eigenen World-Owner und beauftragen Kontakt-/Statuswirkungen.

Allgemeine Target-Modifikatoren werden über den Target-/World-Status-Owner angewendet und gelesen; `WorldTargetingRuntime` ist dafür der vorhandene Anschluss. Bewegungsstatus wie Slow erhält genau einen zuständigen Status-Writer und eine abgeleitete Movement-Sicht, keinen parallelen Damage-Core-Cache. Waffenbezogene Ladungen, AK47-Rückkopplung und Plasma-Procs gehören zum zuständigen Mechanik-/Reaktions-Owner, nicht in den allgemeinen Damage-Core. Konkrete Status-Zuordnung und Detailverträge stehen in 02.[^status][^reactions]

Statusregeln bestimmen ausdrücklich Anwendung vor/nach Damage, Stacking, Refresh, Tick-Fälligkeit und Source-Ende. Reine Reads oder Presentation dürfen weder Gameplay-Ticks noch Status-Mutationen auslösen. Tod, Despawn und Activity-Detach räumen den betroffenen Status auf; das Ende eines Angreifers beendet einen bereits committed Effekt nur nach der dafür definierten Regel.

### 9.2 Autoritative Reaktionen sind keine Beobachter

Life-Leech, Ressourcenänderung, Culling, Reflect-Damage, Kettenwirkungen, On-Kill-Mechanik, Death-Spawns und Rewards sind autoritative Folgeoperationen. Ihre Owner erhalten bestätigte Ergebnisse und benötigte Herkunft über kleine semantische Grenzen. Bestehende `PlayerCombatIntegrationPort`- und `WeaponReactionRuntime`-Muster werden genutzt, ohne alle Reaktionen ausschließlich dem Player zuzuordnen.[^reactions]

Reaktionen haben ausdrückliche Trigger und Auflösungs-/Flush-Punkte. Verschachtelte Mutationen verändern das ursprüngliche Outcome nicht. Chains benötigen nachvollziehbaren Fortschritt, begrenzte Arbeit je Ausführung und definierte Fortsetzung statt doppelter oder endloser Callback-Rekursion. Sync-/Queue-Entscheidungen gehören in 02, kein universeller Reaction-Bus in 01.

Passive Beobachter dürfen Statistik, Diagnose und Präsentation ableiten, aber keine Gameplay-Reaktion verstecken oder eine bereits bestätigte Mutation verhindern. Sobald eine Statistik Rewards oder Spielregeln beeinflusst, gehört dieser Teil zur autoritativen Domain. Spätere Adrenalin-Orbs wären entsprechend eine Gameplay-/Loot-Reaktion, kein Nebenprodukt eines VFX-Callbacks.

### 9.3 Transition, Attribution und Folgen bleiben getrennt

Der State-Owner bestätigt Tod/Zerstörung; Attribution-Regeln bestimmen die Zurechnung. Activity-, Reward-, Mechanik- und Lifecycle-Owner entscheiden die Folgen. Derselbe bestätigte Übergang löst denselben Kill-/Reward-Pfad nicht erneut aus. XP, Drops und Respawn sind weder Damage-Core- noch Transportregeln.

Benötigte Victim-, Source- und Status-Daten stehen vor Entity-Entfernung fest. Consumer rekonstruieren Fraktion, Herkunft oder Tod nicht aus fehlenden oder wiederverwendeten Einträgen. Visuelle Death-Daten werden an der Target-/Presentation-Adaptergrenze gesichert und bleiben für Regeln opak.

## 10. Frame, Network und Presentation

Der Host-Frame bleibt Sequencing-Owner. Combat kann in mehreren Stages unmittelbar wirken; ein neuer zentraler Combat-Tick ist nicht vorgeschrieben. Periodische Arbeit erhält explizite Schritte und wird nicht zusätzlich durch World-Update, Scene-Timer oder weitere Coordinatoren getaktet.

Autoritative Zeit und Zufall werden an den passenden Host-Grenzen bereitgestellt. Neue Combat-Regeln, Status- und Modifier-Resolver lesen keine versteckten `Date.now()`-/`Math.random()`-Quellen. Zeitbasis, Countdown-/Pause-Verhalten, Tick-Nachholung und zeitversetzte Reaktionen werden in 02 festgelegt. Kein verspäteter Timer darf eine abgelöste World, Activity oder ein neues Leben beeinflussen.

Network-Adapter übersetzen autoritative Reads und Outcomes in die bestehenden State-/RPC-Formate. Die direkte `NetworkBridge`-Abhängigkeit des Combat-Kerns entfällt. World-/Activity-Revisionen, vollständiger Bootstrap, Delta-/Removal-Semantik und bestehende Korrelation für vorhergesagte Schüsse bleiben erhalten. Wiederholung eines retriable Requests oder Empfang replizierten Zustands darf keine zweite Gameplay-Ausführung erzeugen.[^network]

**Kein paralleler Replikationsstack:** Target-Kopien bleiben bei bestehenden Replica-/Snapshot-Ownern. Nur fehlende benötigte Daten rechtfertigen Erweiterungen. Clients können Geometrie für Vorschauen wiederverwenden, nicht die autoritative Damage-Pipeline.

Presentation nutzt Outcomes/Read Models und den bestehenden World-Presentation-Lifecycle. Hit-/Death-Effekte, Traces, HP-Trails, Audio und Kamera sind Ausgabe; lokale Wiedergabe und Netzwerkempfang verdoppeln sie nicht unkontrolliert. Ausgabe wartet nicht auf das Ende frameübergreifender Reaktionsketten. Assets, Sichtbarkeit und Renderer-Existenz entscheiden keinen Schaden; Visual-Tuning verändert keine kanonische Treffergeometrie.

## 11. Refactoring-Scope und Qualitätsgrenze

**Im Scope** liegen der verbleibende Combat-State/-Regelkern, seine World-/Player-/Activity-Anbindung, unmittelbare Hitscan-/Melee-/Combat-AoE-Auflösung, Damage/Heal/Armor einschließlich Regeneration, Attribution und bestätigte Life-Outcomes, Combat-Status sowie die notwendigen Reaktions-, Target-, Defense-, Network- und Presentation-Adapter. Dazu gehört die Migration betroffener Consumer: Execution, Player-Gameplay, Enemy-/Turret-/World-Wirkungen, Physics-/Targeting-Reads, Support/Pickups und diagnostische Reads. Regelhaltige Combat-Callbacks in Bindings sind ebenfalls Refactoring-Ziel. Die Qualitätsgrenze ist der vollständige betroffene Wirkungspfad: Auch fachliche Schaden-/Reparatur-/Zerstörungsfolgen in vermeintlichen Presentation-Helfern müssen beim passenden World-/Entity-Owner landen. Das ist ein begrenzter Ownership-Cut, kein allgemeiner World- oder Renderer-Rewrite.[^obstacles]

**Nicht im Scope** liegen ein allgemeiner `HostUpdateCoordinator`-/World-/Enemy-Rewrite, erneutes Projectile-Flight-/Store-/Codec-Refactoring, ECS, globale Target-/Status-/Effect-Registries, ein universelles Ability-/Impact-/Reward-System, neue Transport- oder Prediction-Technologie, zentrale Speicherung aller Health-Werte sowie Änderungen an Progressions-/Save-Modellen. Adrenalin-Orbs, neue Juice-Effekte und Balancing werden nicht implementiert.

Verhalten bleibt grundsätzlich erhalten, Fehler werden aber nicht zu Zielinvarianten. Notwendige Korrekturen brauchen einen benannten Ist-/Soll-Unterschied in 02 und daraus abgeleitete Nachweis-/Cutover-Gates in 03. Damage-Multiplikatoren, Defense, Trigger und Kill-Zurechnung werden nicht stillschweigend „vereinheitlicht“.

Cutover entfernt oder deaktiviert alte Writer/Regelpfade; Compatibility übersetzt einseitig, ohne Legacy-Fallback. World-/Activity-/Life-Wechsel, reentrante Damage-/Death-Fälle und Projectile-Rückkanäle müssen über öffentliche Verträge prüfbar sein. Tests folgen `docs/ai/testing.md`: Semantik und Grenzen statt Klassenanzahl, privater Sourceform oder duplizierter Balance-Literale.[^testing]

Hot Paths behalten nachvollziehbare Kosten: keine wiederholten vollständigen World-Scans pro Einzeltreffer, keine unbeschränkten Historien und keine neue Allocation-Kette je Modifier oder Observer. Kleine Pure Rules, bestehende Indizes und gezielte lokale Datenstrukturen reichen; ein Framework ist kein Qualitätsnachweis.

## 12. Kontext-Router zu Dokument 02

Der normative Teil von 01 wird in jeder neuen Implementierungs- oder Reviewsitzung gelesen; unveränderte Quellenanhänge müssen nicht erneut geladen werden. Zusätzlich werden nur die in 03 der aktuellen Phase zugeordneten Detailabschnitte geladen; 02 ist kein Pflicht-Vollkontext.

| Aufgabe | Verbindliche Abschnitte in 02 |
|---|---|
| Gesamtintegration / öffentliche Grenzen | §§ 2–4; bei Cross-Domain-Änderungen zusätzlich § 16 |
| State-Owner, Mutation, Damage/Heal/Armor | §§ 5–7 |
| Hitscan/Melee, Geometrie und Vorschau | § 8 |
| Status, Reaktionen und ihre Lifetimes | §§ 9–10 |
| Death, Attribution, Respawn und Activity | § 11 |
| Projectile-Adapter und Mehrzielwirkungen | §§ 12–13 |
| Zeit, Host-Stages, Network und Presentation | §§ 14–15 |
| Charakterisierung, bewusste Korrekturen und Qualitätsnachweise | §§ 17–18 |

02 präzisiert diese Architektur, 03 plant ihren Cutover. Ein Implementierungsbefund darf lokale Ausgestaltung verbessern, aber keine zweite Authority oder abweichende Nachbargrenze legitimieren. Echte Vertragskonflikte werden am Review-Punkt ausdrücklich entschieden, nicht durch undokumentierte Fallbacks verdeckt.

---

## Quellen des Architekturabgleichs

Die Links fixieren den analysierten Stand. Sie begründen den Ist-Befund und die gewählten Grenzen, nicht eine dauerhafte Verpflichtung zu heutigen Dateipfaden.

[^principles]: [Architektur-Leitbild](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/ai/architecture-principles.md) und [etablierte Architektur](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/ai/architecture.md).
[^gameplay]: [Gameplay Architecture Core](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/GDDs/Gameplay%20Runtime%20Refactor/01_Gameplay_Runtime_Architecture_Core.md) und [Gameplay Architecture Details, insbesondere §§ 3, 15–20, 22–24 und 27](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/GDDs/Gameplay%20Runtime%20Refactor/02_Gameplay_Runtime_Architecture_Details.md).
[^projectile]: [Projectile Architecture Core](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/GDDs/Projectile%20Runtime%20Refactor/01_Projectile_Runtime_Architecture_Core.md) und [Projectile Migration Status](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/GDDs/Projectile%20Runtime%20Refactor/04_Projectile_Runtime_Migration_Status.md).
[^projectile-details]: [Projectile Architecture Details, insbesondere §§ 12–19 und 24](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/GDDs/Projectile%20Runtime%20Refactor/02_Projectile_Runtime_Architecture_Details.md).
[^combat]: [`CombatSystem.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/systems/CombatSystem.ts).
[^binding]: [`WorldCombatGameplayBinding.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldCombatGameplayBinding.ts).
[^ports]: [`ProjectileCombatPort.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/projectile/ProjectileCombatPort.ts) und [`ProjectileExplosionPort.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/projectile/ProjectileExplosionPort.ts).
[^host]: [`HostUpdateCoordinator.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/scenes/arena/HostUpdateCoordinator.ts), insbesondere Host-Stages, `resolveProjectileExplosion` und `resolveGrenadePayload`.
[^execution]: [`WeaponFireExecutor.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/loadout/WeaponFireExecutor.ts).
[^world]: [`WorldRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldRuntime.ts) und [`PlayerWorldRuntimeComposition.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/PlayerWorldRuntimeComposition.ts).
[^enemy]: [`EnemyManager.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/entities/EnemyManager.ts), insbesondere `applyDamage`, `EnemyLethalDamageGuard`, `EnemyDeathInfo` und Entfernung ohne Kill.
[^geometry]: [`WorldGeometryBinding.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldGeometryBinding.ts) sowie Hitscan-, Melee- und Line-of-Fire-Auflösung in `CombatSystem.ts`.
[^status]: [`WorldTargetingRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WorldTargetingRuntime.ts) sowie Brand-, Slow- und Plasma-State in `CombatSystem.ts`.
[^reactions]: [`PlayerCombatIntegrationPort.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/PlayerCombatIntegrationPort.ts) und [`WeaponReactionRuntime.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/world/WeaponReactionRuntime.ts).
[^network]: [Networking-Verträge](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/ai/networking.md) sowie die Combat-/Host-/World-Bindings oben.
[^testing]: [Testpolicy](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/docs/ai/testing.md).

[^obstacles]: [`RockVisualHelper.ts`, insbesondere Damage/Repair/Destroyed-Pfade](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/scenes/arena/RockVisualHelper.ts) und [`RockHpRegistry.ts`](https://github.com/Dominik-Steinweg/Fragdachse/blob/d5cb4519fb06dd74e22d21e8d63e635ea75bbc26/src/arena/RockHpRegistry.ts).

[^delta]: [Delta seit der vorherigen Dokumentbasis](https://github.com/Dominik-Steinweg/Fragdachse/compare/53fc19bfdf19ff9930a1b08ac71a3af8f57e3ee1...d5cb4519fb06dd74e22d21e8d63e635ea75bbc26): Sweep-Endpunkterhalt und Projectile Flight Signature; die zu schützenden Nachbarverträge sind in 02 §§ 12 und 15 konkretisiert.
