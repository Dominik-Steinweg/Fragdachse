# Fragdachse – GDD: Persistente Basis – Implementierungsphase 2 – V2

**Titel:** Shared Building, Klassen & Multiplayer  
**Status:** Implementierungs-GDD – Version 2  
**Phase:** 2 von 3
**Dokumentversion:** V2  
**Stand:** 25.08.2026  
**Projekt:** Fragdachse

---

# 1. Zweck dieses Dokuments

Dieses Dokument beschreibt ausschließlich die **Implementierungsphase 2** des Systems „Persistente Basis“.

Es baut verbindlich auf folgenden Dokumenten und dem nach Phase 1 vorhandenen Code auf:

1. `Fragdachse_GDD_Persistente_Basis_V3.md`
2. `Fragdachse – GDD_ Persistente Basis – Implementierungsphase 1.md`
3. dem Repository-Stand nach Umsetzung von Phase 1

Die Coding-KI darf davon ausgehen, dass ihr alle drei Dokumente gleichzeitig vorliegen.

Dieses Dokument wiederholt deshalb bewusst **nicht** die vollständige Vision, Save-Grundlagen, Zonenlogik oder allgemeinen Regeln der persistenten Basis. Es konkretisiert nur die Änderungen, die für Phase 2 erforderlich sind.

Bei Widersprüchen gilt:

- Dieses Dokument präzisiert die Regeln für **Phase 2**.
- Das Haupt-GDD bleibt für die Gesamtvision maßgeblich.
- Das Phase-1-GDD bleibt für die bereits implementierte Persistenz-Grundlage maßgeblich.
- Bestehende Phase-1-Architektur soll erweitert und nicht durch ein zweites System ersetzt werden.

---

# 2. Ziel der Phase

Nach Abschluss von Phase 2 können:

- Dachs Nukem,
- Dachs of Steel,
- Inspector Gadachs,
- Host,
- Clients

gemeinsam an derselben persistenten Host-Basis arbeiten.

Dabei gelten für alle Spieler dieselben grundlegenden Systeme für:

- Construction Registry / Construction-Identität,
- Placement,
- Grid,
- Capacity,
- Unlocks,
- Loadout,
- Ownership,
- Preview,
- Rückbau,
- Restore,
- Multiplayer-Validierung.

Die Klassen unterscheiden sich nur durch ihre fachlichen Daten, Zugriffsregeln, Loadouts, Capacity und Upgrades, nicht durch getrennte technische Bau-Systeme.

Phase 2 vereinheitlicht zusätzlich das historisch getrennte Construction-System:

```text
Inspector ConstructionId-Pfad
+
Placeable-Utility-Pfad für ROCK_BARRIER / SPORE_TURRET
→
gemeinsame Construction-Runtime
```

Rock Barrier, Spore Turret und die bisherigen Inspector-Konstruktionen werden nach erfolgreichem Placement technisch als dieselbe Runtime-Kategorie behandelt.

Zusätzlich erhält die persistente Basis einen **raumweiten Guest-Session-State**, der Client-Bauten über Mapwechsel hinweg erhält, ohne sie jemals in den persistenten Host-Save zu übernehmen.

Die Construction-Vereinheitlichung und die Guest-Session-Persistenz sind dabei zwei getrennte Teilvorhaben derselben Implementierungsphase:

```text
gemeinsame Runtime-Infrastruktur
→ wird zuerst vereinheitlicht

Ownership / Guest Session
→ baut anschließend darauf auf
```

---

# 3. Verbindliche Designentscheidungen dieser Phase

## 3.1 Aktive Konstruktion erfordert Unlock und Loadout

Für **alle Klassen** gilt dieselbe Grundregel:

Eine normale persönliche Konstruktion darf nur neu gebaut oder beim Restore materialisiert werden, wenn:

1. das Construction Tool für den Spieler freigeschaltet ist,
2. das Construction Tool im aktuell gültigen Construction-/Utility-Loadout des Spielers liegt,
3. die Konstruktion für die aktuelle Klasse grundsätzlich erlaubt ist,
4. ausreichend persönliche Construction Capacity vorhanden ist,
5. die normalen Placement- und Zonenregeln erfüllt sind.

Damit gilt ausdrücklich:

```text
unlocked allein
!=
aktuell aktiv baubar
```

sondern:

```text
unlocked
+ im aktuellen Loadout
+ für Klasse erlaubt
+ Capacity
+ Placement gültig
=
aktiv baubar / materialisierbar
```

Diese Regel gilt sowohl für:

- neue Placements,
- Host-Restore,
- Guest-Session-Restore.

---

## 3.2 Dormant statt Löschen

Ein bereits gespeichertes oder in der Guest Session vorhandenes Konstrukt wird **nicht gelöscht**, nur weil sein Tool aktuell nicht mehr im Loadout liegt.

Es bleibt als Blueprint-Eintrag erhalten und wird dormant.

Dormant bedeutet:

- keine Runtime-Instanz,
- keine Zellbelegung,
- kein Capacity-Verbrauch,
- weiterhin im zuständigen Blueprint/Session-State vorhanden.

Wenn das Tool später wieder ins Loadout aufgenommen wird, darf das Konstrukt beim nächsten Restore wieder aktiv werden, sofern auch alle anderen Bedingungen erfüllt sind.

Dies erweitert das bereits aus Phase 1 vorhandene Dormant-Prinzip.

---

## 3.3 Inspector-Slots bleiben relevant

Der Inspector behält sein bestehendes Construction-Loadout mit mehreren Construction-Slots.

Ein freigeschaltetes Inspector-Tool, das **nicht** in einem aktiven Construction-Slot liegt:

- erscheint nicht als aktiv nutzbares Tool,
- kann nicht neu gebaut werden,
- wird beim Restore nicht materialisiert,
- vorhandene Blueprint-Einträge bleiben dormant.

Damit können Unlocks nicht dazu verwendet werden, die Inspector-Slot-Grenzen zu umgehen.

---

## 3.4 Nicht-Inspector-Klassen

Dachs Nukem und Dachs of Steel erhalten einen bewusst kleinen Construction-Scope.

Für Phase 2 müssen mindestens folgende Construction Utilities regulär für diese Klassen nutzbar sein:

- Rock Barrier
- Spore Turret / Fliegenpilzturm

Die Freischaltung erfolgt über die bestehenden normalen Unlock-Mechanismen.

Es wird kein separater „Persistent Base Unlock“-Pfad eingeführt.

Nicht-Inspector-Klassen verwenden für diese Construction Utilities den bestehenden normalen Utility-/Loadout-Slot.

In Phase 2 gilt damit fachlich:

```text
Nicht-Inspector:
genau das aktuell ausgerüstete Construction Utility
+ Rückbau
+ globaler Rückbau
```

Wenn später weitere Construction Utilities für Nicht-Inspector-Klassen ergänzt werden, darf dies keine Architekturänderung erfordern.

---

## 3.5 Inspector-Spezialisierung bleibt bestehen

Phase 2 macht nicht alle Inspector-Konstruktionen für alle Klassen verfügbar.

Inspector-spezifisch bleiben insbesondere:

- spezialisierte Turrets,
- Support-Konstruktionen,
- Power-up-Podeste,
- Inspector-Construction-Upgrades,
- zusätzliche Construction-Slots.

Rock Barrier und Spore Turret dürfen über die normalen Unlock-Regeln für andere Klassen freigegeben werden.

Die vorhandenen Inspector-Spezialpfade sollen fachlich erhalten bleiben, technisch jedoch den gemeinsamen Construction-Unterbau verwenden.

---

## 3.6 Spielmodusübergreifende persönliche Construction Capacity

Capacity wird in Phase 2 nicht mehr als Coop-spezifische Sonderlogik verstanden.

Ein zentraler Resolver bildet die einzige Gameplay-Wahrheit, sinngemäß:

```ts
resolveConstructionCapacity({
  gameMode,
  classId,
  modifiers,
})
```

Für Coop Defense gelten verbindlich:

```text
Dachs Nukem     = 30 + Boni
Dachs of Steel  = 30 + Boni
Inspector       = 100 + Boni
```

Generische Boni wie:

```text
construction.capacity
```

werden weiterhin berücksichtigt.

Spielmodi ohne Klassen, insbesondere Deathmatch, erhalten einen eigenen konfigurierbaren Basiswert. Für diese Modi wird in diesem GDD bewusst kein neuer Zahlenwert erfunden; der Wert soll zentral in der jeweiligen GameMode-Konfiguration liegen.

Alle folgenden Systeme müssen denselben Capacity-Resolver verwenden:

- Host-Placement-Validation,
- Client-Preview,
- HUD,
- Construction Radial,
- Restore Planner,
- Guest-Session-Restore,
- Deathmatch-/sonstige Construction-Validierung,
- sonstige Capacity-Anzeigen oder Prüfungen.

Es darf keine zweite Capacity-Logik für:

- Coop,
- Inspector,
- Nicht-Inspector,
- Utility-Placeables,
- Deathmatch,
- persistente Konstruktionen

geben.

Capacity ist immer persönlich pro Spieler.

Es gibt in Phase 2 keine gemeinsame Team-Capacity.

---

# 4. Vereinheitlichung des Construction-Systems

Mit Phase 2 wird das Bausystem technisch vereinheitlicht.

Historisch existieren derzeit zwei unterschiedliche Pfade:

```text
ConstructionId-Konstruktionen
→ Inspector-System
→ Rocket Turret, MG Turret, Flame Turret, Podeste, ...

Placeable Utilities
→ älteres Utility-System
→ ROCK_BARRIER
→ SPORE_TURRET
```

Diese technische Trennung soll nicht weiter ausgebaut werden.

## 4.1 Zielmodell

Alle dauerhaft platzierten normalen Spielerbauten gelten nach erfolgreichem Placement als gemeinsame **Construction-Runtime**.

Dazu gehören insbesondere:

```text
Rock Barrier
Spore Turret
Rocket Turret
Machine Gun Turret
Flame Turret
Tesla Turret
Gravity Turret
Slow Bubble Turret
Medic Pedestal
Armor Pedestal
weitere spätere Spieler-Constructions
```

Der Unterschied zwischen Klassen und Spielmodi betrifft künftig primär:

```text
Wer darf welche Construction verwenden?
Wie wird sie ausgewählt?
Welche Capacity besitzt der Spieler?
Welche spielerspezifischen Upgrades wirken?
```

Nicht jedoch die technische Runtime-Kategorie des gebauten Objekts.

---

## 4.2 Gemeinsame Construction-Definition

`ROCK_BARRIER` und `SPORE_TURRET` werden aus ihrer historischen Sonderrolle herausgelöst und als normale Construction-Definitionen behandelt.

Sinngemäß:

```ts
interface ConstructionDefinition {
  id: ConstructionId;
  kind: ConstructionKind;
  footprint: ...;
  maxHp: number;
  placementRange: number;
  capacityCost: number;

  weaponId?: ...;
  targetRange?: number;
  powerUpDefId?: ...;
}
```

Beispielhafte kanonische IDs:

```text
rock_barrier
spore_turret
rocket_turret
machine_gun_turret
flame_turret
tesla_turret
gravity_turret
slow_bubble_turret
medic_pedestal
armor_pedestal
```

Die konkrete Schreibweise vorhandener Inspector-IDs darf aus Kompatibilitätsgründen beibehalten werden, sofern jede Construction genau eine kanonische ID besitzt.

Wichtiger als die Namenskonvention ist:

> Jede normale gebaute Spieler-Construction besitzt nach Placement eine eindeutige `constructionId`.

---

## 4.3 `kind` ist Kategorie, nicht Identität

`kind` darf weiterhin verwendet werden, um gemeinsame Verhaltenstypen zu beschreiben, beispielsweise:

```text
barrier
turret
pedestal
support
```

Nicht zulässig ist jedoch:

```text
kind === rock
→ also ROCK_BARRIER

kind === turret
→ also SPORE_TURRET
```

Ebenso darf Capacity oder Persistence nicht mehr aus `kind` auf eine konkrete Construction schließen.

Die eindeutige Identität ist ausschließlich:

```text
constructionId
```

---

## 4.4 Auswahlweg und Construction-Identität trennen

Ein Construction-Typ darf auf unterschiedliche Weise verfügbar gemacht werden.

Beispiele:

```text
Inspector
→ Construction Radial
→ spore_turret

Dachs of Steel
→ freigeschaltetes Construction Utility
→ spore_turret

Deathmatch
→ Utility-Slot
→ spore_turret
```

Nach erfolgreichem Placement entsteht in allen Fällen dieselbe Construction-Runtime:

```text
spore_turret
```

Der Auswahlweg darf keine zweite Objektart erzeugen.

Für historische Utility-Definitionen bedeutet das:

```text
Utility / Loadout Entry
→ Auswahl- und Access-Information
→ constructionId

Placement
→ gemeinsame Construction-Runtime
```

---

## 4.5 Zentrale Construction Registry

Alle normalen Spieler-Constructions werden über eine gemeinsame Registry bzw. äquivalente zentrale Definition aufgelöst.

Die Registry beantwortet:

```text
constructionId
→ ConstructionDefinition
```

Sie ist die zentrale Quelle für mindestens:

- Identität,
- Kategorie / `kind`,
- Footprint,
- Basis-HP,
- Placement Range,
- Capacity Cost,
- construction-spezifische optionale Daten.

Es darf keine zusätzliche Rock-/Spore-Registry neben einer Inspector-Registry entstehen.

---

## 4.6 Zentraler Access Resolver

Welche Construction ein Spieler verwenden darf, ist keine Eigenschaft der Runtime-Kategorie.

Ein zentraler Access Resolver bestimmt:

```text
GameMode
+ Klasse, sofern vorhanden
+ Fortschritt / Unlocks
+ Loadout
→ erlaubte constructionIds
```

Damit werden Klassen- und Modusunterschiede über **Berechtigung**, nicht über unterschiedliche Construction-Runtimes modelliert.

Beispiele:

```text
Coop / Inspector
→ großes Construction-Angebot

Coop / andere Klasse
→ begrenztes Construction-Angebot

Deathmatch ohne Klassen
→ z. B. Rock Barrier + Spore Turret
```

Die in diesem GDD festgelegte Coop-Regel bleibt bestehen:

```text
Unlock
+ aktuell im relevanten Loadout
→ Construction darf aktiv verwendet / restored werden
```

---

## 4.7 Gemeinsame Capacity

Zeitliche Lebensdauer ist nicht länger die primäre Mengenbegrenzung für normale Spieler-Constructions.

Stattdessen gilt spielmodusübergreifend:

```text
usedConstructionCapacity
+
newConstruction.capacityCost
<=
resolvedPlayerConstructionCapacity
```

Die verfügbare Capacity wird zentral aus Spielmodus, Klasse und Boni aufgelöst.

Sinngemäß:

```ts
resolveConstructionCapacity({
  gameMode,
  classId,
  modifiers,
})
```

Für Coop Defense:

```text
Inspector:       100 + Boni
andere Klassen:   30 + Boni
```

Spielmodi ohne Klassen erhalten einen eigenen konfigurierbaren Basiswert.

Host-Validation, Client-Preview, HUD, Radial und Restore verwenden dieselbe Capacity-Auflösung.

---

## 4.8 Wegfall normaler Construction-Lifetime

Normale Spieler-Constructions laufen nicht mehr automatisch durch `lifetimeMs` aus.

Normaler Lebenszyklus:

```text
Placement
→ bleibt bestehen
→ bis zerstört
   oder zurückgebaut
   oder Runde / Arena endet
```

Auf Persistent-Base-Maps kann der Blueprint nach einem gültigen Commit selbstverständlich über das Arena-Ende hinaus bestehen und die Construction auf der nächsten passenden Map wieder materialisieren.

Die Runtime-Instanz selbst wird trotzdem beim normalen Arena-Teardown entfernt.

Dadurch entfallen die Coop-Sondervarianten:

```text
ROCK_BARRIER_COOP
SPORE_TURRET_COOP
```

sowie die ausschließlich hierfür notwendige Modusumschaltung zwischen temporärer und permanenter Variante.

Falls zukünftig bewusst zeitlich begrenzte Deployables benötigt werden, sollen diese als eigener temporärer Gameplay-Typ modelliert werden und nicht die normale Construction-Lifetime wieder einführen.

---

## 4.9 Gemeinsame Runtime-Systeme

Nach der Vereinheitlichung sollen alle normalen Constructions denselben technischen Vertrag verwenden für:

```text
Placement
Collision
Capacity
Damage
Repair
Dismantle
Rendering
Turret-/Support-Systeme
Energy Injector
Networking
Persistent-Base-Klassifizierung
Restore
```

Das bedeutet nicht, dass jedes System jede Construction gleich behandeln muss.

Regeln dürfen bewusst eingeschränkt werden, müssen dann aber explizit über:

```text
constructionId
ConstructionDefinition
Kategorie / Tags / Capabilities
```

modelliert werden.

Beispiel:

```text
Repair Drone repariert alle eigenen Constructions
```

oder, falls spielerisch gewünscht:

```text
Repair Drone repariert nur Constructions mit Capability "repairable-by-drone"
```

Nicht zulässig ist eine implizite historische Unterscheidung allein über:

```text
constructionId vorhanden / nicht vorhanden
Utility-Pfad / Inspector-Pfad
kind === rock / turret als konkrete Identität
```

---

## 4.10 Spielerspezifische Werte

Die gemeinsame Construction-Identität bedeutet nicht, dass jedes Exemplar identische effektive Werte besitzen muss.

Es gilt:

```text
Construction Base Definition
+
Spieler-/Klassen-/Upgrade-Modifikatoren
=
Resolved Construction Definition
```

Ein `spore_turret`, das vom Inspector gebaut wird, kann daher andere effektive Werte besitzen als dasselbe `spore_turret` eines anderen Spielers, ohne einen eigenen Construction-Typ zu benötigen.

Persistente Blueprints speichern grundsätzlich die kanonische Identität und Platzierungsdaten.

Effektive Werte werden beim Materialisieren über die aktuellen gültigen Resolver erneut bestimmt, soweit die bestehende Gameplay-Semantik nichts anderes ausdrücklich verlangt.

---

## 4.11 Persistent Base verwendet dieselbe Identität

Das Persistent-Base-System verwendet ebenfalls die gemeinsame `constructionId`.

Normale persistente Bauten werden unabhängig davon behandelt, ob ihr Zugriffsweg ursprünglich aus:

```text
Construction Radial
oder
Utility Slot
```

kam.

Der Restore soll daher nicht einzelne IDs wie:

```text
ROCK_BARRIER
SPORE_TURRET
```

sonderbehandeln.

Stattdessen:

```text
gespeicherte ID
→ zentrale Normalisierung
→ constructionId
→ Construction Registry
→ Access Resolver
→ Capacity Resolver
→ Restore
```

Base-Owned Rewards aus Phase 3 bleiben hiervon fachlich getrennt.

---

## 4.12 Migration der historischen Utility-Constructions

Die Migration von Rock Barrier und Spore Turret soll keine zweite dauerhafte Adapterarchitektur erzeugen.

Erlaubt ist eine schmale Kompatibilitätsschicht an der Grenze:

```text
historische Utility-ID / alte Save-ID
→ kanonische constructionId
```

Nicht erlaubt ist:

```text
jede Runtime-Systemklasse
→ eigene Sonderbehandlung für ROCK_BARRIER / SPORE_TURRET
```

Bestehende Utility-/Loadout-Inhalte dürfen als Auswahlkonfiguration erhalten bleiben, solange sie auf die gemeinsame `constructionId` verweisen.

---

## 4.13 Deathmatch und andere Modi ohne Klassen

Die Construction-Vereinheitlichung ist bewusst nicht auf Coop Defense beschränkt.

Ein Modus ohne Klassen kann dieselben Constructions verwenden.

Beispiel:

```text
Deathmatch
→ Utility-Slot enthält Rock Barrier
→ Access Resolver erlaubt rock_barrier
→ Capacity Resolver liefert Deathmatch-Basiswert
→ Placement erzeugt normale rock_barrier Construction-Runtime
```

Deathmatch benötigt dafür kein künstliches Klassenmodell.

Die exakten Balancewerte für solche Modi gehören in deren GameMode-Konfiguration und nicht in die Persistent-Base-Logik.

---

## 4.14 Abgrenzung dieses Refactors

Die Construction-Vereinheitlichung selbst behandelt nicht:

```text
Base-Owned Missions-Rewards
permanente Reward-Missionen
Replay-Sperren
Guest-Session-Persistenz
Phase-3-Reward-Regeln
```

Das bedeutet **nicht**, dass Guest Session aus Phase 2 entfernt wird.

Vielmehr gilt:

```text
Construction-Vereinheitlichung
→ technische Grundlage

Guest-Session-/Ownership-Teil von Phase 2
→ baut anschließend auf dieser Grundlage auf

Phase 3
→ Base-Owned Rewards und Kampagnenintegration
```

---

# 5. Ownership-Modell

Phase 2 führt ein explizites Ownership-Modell für Construction Runtime und Session-Logik ein.

Verbindliche Ownership-Typen:

```ts
type ConstructionOwnership =
  | 'host-persistent'
  | 'guest-session'
  | 'base-owned';
```

## 5.1 host-persistent

`host-persistent` bezeichnet normale persönliche Konstruktionen des Hosts innerhalb der persistenten Basis.

Eigenschaften:

- Owner ist der Host-Spieler.
- Capacity zählt gegen die persönliche Capacity des Hosts.
- Unlock- und Loadout-Regeln des Hosts gelten.
- Änderungen werden nur über den bestehenden Victory-Commit dauerhaft gespeichert.
- Niederlage rollt auf den Missions-Baseline-State zurück.
- Persistenz erfolgt weiterhin über den bereits vorhandenen Host-Save.

---

## 5.2 guest-session

`guest-session` bezeichnet normale persönliche Konstruktionen eines Clients in der Host-Basis.

Eigenschaften:

- Owner ist genau ein Client-Spieler.
- Capacity zählt ausschließlich gegen die Capacity dieses Clients.
- Unlock-, Loadout- und Klassenregeln dieses Clients gelten.
- Guest-Bauten werden vom Host autoritativ simuliert.
- Guest-Bauten bleiben innerhalb desselben Raums über Mapwechsel erhalten.
- Guest-Bauten dürfen auch über zwischenzeitliche Nicht-Persistent-Base-Maps hinweg im Raumzustand erhalten bleiben.
- Auf Nicht-Persistent-Base-Maps werden sie nicht materialisiert.
- Guest-Bauten werden niemals in den Host-localStorage geschrieben.
- Ein Client sendet niemals seinen eigenen persistenten Basissave an den Host.
- Guest-Session-Daten existieren nur im Host-autoritativen Raumzustand.

---

## 5.3 base-owned

`base-owned` wird in Phase 2 als Ownership-Typ vorbereitet, aber noch nicht fachlich ausgebaut.

Phase 2 implementiert ausdrücklich **keine** permanenten Missions-Rewards aus Phase 3.

Für `base-owned` gilt bereits:

- keine persönliche Player-Capacity,
- kein normaler Player-Rückbau,
- kein Guest-Ownership,
- keine Speicherung über den normalen persönlichen Host-Construction-Pfad.

Wo ein gemeinsamer Ownership-Switch eingeführt wird, muss `base-owned` als expliziter Fall behandelbar sein.

Die eigentliche Erzeugung, Persistenz und Reward-Logik folgt erst in Phase 3.

---

# 6. Save-Schema bleibt unverändert

Phase 2 führt **keinen Save-Schema-Bump nur für Multiplayer-Ownership oder die Construction-Vereinheitlichung** ein.

Der vorhandene persistente Host-Save bleibt semantisch:

```text
PersistentBaseState
→ enthält ausschließlich den langfristigen Host-Blueprint
```

Ein `PersistentConstruction` im gespeicherten Host-Save ist weiterhin implizit:

```text
host-persistent
```

Guest-Session-Daten dürfen nicht in `PersistentBaseState` oder dessen localStorage-Payload aufgenommen werden.

Insbesondere darf nicht einfach ein `ownerId` für Clients in den persistenten Host-Save geschrieben werden.

## Kompatibilität der Construction-Identität

Der persistente Blueprint soll künftig dieselbe kanonische Construction-Identität verwenden wie die Runtime.

Die serialisierte Phase-1-Struktur kann dabei kompatibel bleiben:

```text
PersistentConstruction.tool.id
→ wird als kanonische constructionId interpretiert
```

Das historische `tool.kind` darf aus Kompatibilitätsgründen im Save bestehen bleiben, darf aber nicht mehr die fachliche Identität einer Construction bestimmen.

Für bestehende Saves wird eine zentrale Registry-/Normalisierungsschicht verwendet, beispielsweise:

```text
ROCK_BARRIER
ROCK_BARRIER_COOP
→ rock_barrier

SPORE_TURRET
SPORE_TURRET_COOP
→ spore_turret
```

Diese Alias-Auflösung gehört in die gemeinsame Construction Registry bzw. eine einzige Normalisierungsgrenze.

Nicht zulässig ist:

```text
PersistentBaseRestorePlanner
→ eigene Rock-/Spore-Sonderliste
```

Neue Saves schreiben die kanonische Construction-Identität in das bereits vorhandene ID-Feld.

Wenn für Host- und Guest-Blueprint intern gemeinsame Datenfelder sinnvoll sind, darf ein gemeinsamer interner Basistyp extrahiert werden.

Die serialisierte JSON-Struktur des Phase-1-Saves muss weiterhin lesbar bleiben.

---

# 7. Raumweiter Guest-Session-State

## 7.1 Notwendigkeit

Der aktuelle Phase-1-`PersistentBaseSession`-Pfad ist primär missions-/arenaorientiert.

Guest-Bauten müssen dagegen über den Lebenszyklus einer einzelnen Arena hinaus erhalten bleiben.

Daher benötigt Phase 2 einen Host-autoritativen **room-scoped State**, der länger lebt als `ArenaScene` bzw. ein einzelner Arena-Lifecycle.

Dieser State darf nicht ausschließlich in einem Objekt liegen, das beim normalen Mapwechsel zerstört wird.

---

## 7.2 Empfohlene Verantwortungstrennung

Eine saubere Zielstruktur ist sinngemäß:

```text
Room Scope
└─ PersistentBaseRoomState
   ├─ Guest-Session-Blueprint je Player
   ├─ stabile Session-Reihenfolge
   └─ Lifecycle bei Leave / Resume / Spectator

Mission Scope
└─ PersistentBaseSession
   ├─ Host-Baseline
   ├─ Guest-Baselines
   ├─ Runtime-Mappings
   ├─ Working State
   ├─ Commit bei Sieg
   └─ Rollback bei Niederlage
```

Die konkreten Klassennamen dürfen an die vorhandene Architektur angepasst werden.

Wichtig ist die Lebensdauer:

```text
ArenaScene / Map
< Mission Session
< Room Guest State
```

Der Guest-State muss Mapwechsel überleben.

Er endet spätestens mit dem Raum oder mit dem individuellen finalen Entfernen des betreffenden Spielers.

---

## 7.3 Kein Netzwerk-Transport-Owner

Der room-scoped Persistent-Base-State ist Gameplay-State.

Er soll nicht unnötig in die Low-Level-Transportlogik von `PeerRoom` verschoben werden, wenn eine höher liegende Room-/Game-Session-Verantwortung vorhanden oder mit geringem Aufwand einführbar ist.

`PeerRoom` bleibt primär verantwortlich für:

- Verbindung,
- Peer-Lifecycle,
- Resume,
- Expiry,
- Netzwerktransport.

Die Persistent-Base-Logik konsumiert diese Lifecycle-Events.

---

# 8. Guest-Session-Datenmodell

Guest-Konstruktionen benötigen einen nicht persistent serialisierten Blueprint.

Sinngemäß:

```ts
interface GuestSessionConstruction {
  sessionConstructionId: string;
  ownerId: string;

  tool: {
    kind: string;
    id: string;
  };

  relativeGridX: number;
  relativeGridY: number;
  angle: number;

  placementOrder: number;
}
```

Die exakte Struktur soll soweit möglich dieselben fachlichen Blueprint-Felder wie `PersistentConstruction` verwenden.

Wichtig:

- `ownerId` gehört zum Guest-Session-State.
- Guest-Einträge besitzen eine stabile Identität.
- Guest-Einträge besitzen eine stabile Restore-Reihenfolge.
- Der Typ darf nicht versehentlich über den Host-Persistent-Save serialisiert werden.

Ein möglicher gemeinsamer interner Blueprint-Basistyp ist erlaubt, solange der gespeicherte Phase-1-Save unverändert bleibt.

---

# 9. Stabile Reihenfolge und Restore-Priorität

Restore muss deterministisch bleiben.

Für Phase 2 gilt folgende Priorität:

```text
1. base-owned
2. host-persistent
3. guest-session
```

In Phase 2 existieren normalerweise noch keine echten `base-owned` Rewards; die Prioritätsstufe wird nur vorbereitet.

Innerhalb derselben Ownership-Gruppe wird eine stabile Reihenfolge verwendet, primär:

```text
placementOrder
```

bei Bedarf ergänzt um einen stabilen eindeutigen Tie-Breaker.

Für mehrere Guest-Spieler muss die Reihenfolge hostautoritativ und reproduzierbar sein.

Empfohlen ist eine raumweit monotone, vom Host vergebene Placement-Reihenfolge für akzeptierte Guest-Konstruktionen.

Client-Zeitstempel dürfen nicht über Zellkonflikte entscheiden.

---

# 10. Restore-Eligibility

Der bestehende `PersistentBaseRestorePlanner` soll erweitert bzw. über die gemeinsamen Construction Registry-, Access- und Capacity-Resolver gespeist werden.

Es darf **kein zweiter Guest-Restore-Algorithmus** mit eigenen Regeln entstehen.

Restore arbeitet ausschließlich mit einer kanonischen `constructionId`.

Ein Blueprint-Eintrag ist nur ein aktiver Restore-Kandidat, wenn mindestens folgende Prüfungen erfüllt sind:

```text
constructionId bekannt
AND ConstructionDefinition vorhanden
AND Access-Resolver erlaubt Construction für aktuellen GameMode / Spieler
AND für aktuelle Klasse erlaubt, sofern Modus Klassen nutzt
AND freigeschaltet
AND aktuell im relevanten Loadout
AND innerhalb aktueller Persistent Zone
AND noch keine höher priorisierte Zellkollision
AND persönliche Capacity ausreichend
```

Andernfalls bleibt der Eintrag dormant.

Dormant-Gründe dürfen intern erweitert werden, z. B.:

```text
unknown-construction
locked
not-in-loadout
class-not-allowed
mode-not-allowed
outside-zone
collision
capacity
```

Rock Barrier und Spore Turret werden hierbei nicht mehr als Sonderfälle behandelt.

Es ist nicht zwingend erforderlich, jeden Dormant-Grund im UI anzuzeigen.

Für Tests und Diagnose ist eine explizite Unterscheidung jedoch sinnvoll.

---

# 11. Gemeinsamer Eligibility-Resolver

Phase 2 führt einen zentralen **Construction Access Resolver** ein.

Seine fachliche Aufgabe ist:

```text
GameMode
+ Spieler / Klasse
+ Fortschritt / Unlocks
+ Loadout
→ aktuell erlaubte constructionIds
```

Sinngemäß:

```ts
resolveConstructionAccess({
  gameMode,
  playerId,
  classId,
  profile,
  loadout,
})
```

oder eine äquivalente API.

Der Resolver beantwortet nicht, ob eine konkrete Zelle frei ist. Er beantwortet ausschließlich die Zugriffs-/Berechtigungsseite.

Mindestens abzudecken sind:

- Construction existiert in der Registry,
- Construction ist im aktuellen GameMode grundsätzlich zulässig,
- Construction ist für die aktuelle Klasse zulässig, sofern der Modus Klassen verwendet,
- erforderlicher Unlock ist vorhanden,
- Construction ist über das aktuelle Loadout / die aktuellen Construction-Slots aktiv auswählbar.

Placement, Restore, Radial und Preview dürfen diese Regeln nicht unabhängig voneinander duplizieren.

Beispiele:

```text
Coop / Inspector
→ mehrere aktive Inspector-Construction-Slots
→ entsprechendes Construction-Angebot

Coop / Nukem oder Steel
→ normaler Utility-/Loadout-Slot
→ begrenztes Construction-Angebot

Deathmatch
→ kein Klassenmodell erforderlich
→ Utility-/Loadout-Regeln des Modus
→ z. B. rock_barrier / spore_turret
```

Damit wird die Zugriffsart von der Construction-Identität getrennt.

Eine spätere Designänderung von:

```text
Unlock + Loadout
```

auf beispielsweise:

```text
nur Unlock
```

soll mit einer lokalen Änderung am Access-Resolver möglich sein, ohne Persistenz-, Save-, Runtime- oder Multiplayer-Architektur neu zu bauen.

---

# 12. Loadout-Regeln nach Klasse

## 12.1 Inspector

Für Inspector Gadachs wird das bestehende Construction-Loadout verwendet.

Aktiv verfügbar sind nur die Construction Tools, die:

- freigeschaltet,
- klassenzulässig,
- in einem aktiven Inspector-Construction-Slot liegen.

Mehrere aktive Tools sind möglich.

---

## 12.2 Dachs Nukem und Dachs of Steel

Für Nicht-Inspector-Klassen wird der bestehende normale Utility-/Loadout-Slot verwendet.

Ist dort kein Construction Utility ausgerüstet:

- kein Construction Tool Radial für normales Bauen,
- keine neue permanente Konstruktion,
- vorhandene persönliche Blueprint-Konstruktionen bleiben dormant.

Ist beispielsweise Rock Barrier ausgerüstet:

```text
Radial:
Rock Barrier
Rückbau
Globaler Rückbau
```

Ist stattdessen Spore Turret ausgerüstet:

```text
Radial:
Spore Turret
Rückbau
Globaler Rückbau
```

Ein nicht ausgerüstetes, aber freigeschaltetes Construction Utility wird nicht aktiv materialisiert.

Der Utility-/Construction-Slot bestimmt nur den Zugriff. Nach Placement ist die Runtime ausschließlich über die kanonische `constructionId` identifiziert.

---

# 13. Unlock-Integration

Rock Barrier und Spore Turret verwenden die bestehenden normalen Unlocks; diese Unlocks schalten künftig kanonische `constructionId`s über den gemeinsamen Access Resolver frei.

Es soll keine zweite parallele Freischaltung nur für Persistent Base geben.

Die Upgrade-/Unlock-Konfiguration muss so generalisiert werden, dass die Basistools für die vorgesehenen Nicht-Inspector-Klassen freischaltbar sind, ohne den vollständigen Inspector-Construction-Baum zu öffnen.

Fachlich gilt:

```text
Rock Barrier Unlock
→ kann für vorgesehene Klassen verfügbar werden

Spore Turret Unlock
→ kann für vorgesehene Klassen verfügbar werden

Inspector-Spezialkonstruktionen
→ bleiben Inspector-spezifisch
```

Bestehende Construction-Upgrades, die ausdrücklich Teil der Inspector-Spezialisierung sind, dürfen dadurch nicht versehentlich für Nukem oder Steel aktiv werden.

---

# 14. Construction Tool Radial generalisieren

Das bestehende `InspectorToolRadialMenu` ist die Grundlage.

Es soll fachlich zu einem allgemeinen **Construction Tool Radial** werden.

Ein zweites Radialsystem ist nicht erlaubt.

Eine Umbenennung auf einen neutralen Namen wie:

```text
ConstructionToolRadialMenu
```

ist sinnvoll, sofern sie ohne unnötigen Großrefactor durchgeführt werden kann.

Dasselbe gilt für inspector-spezifisch benannte Provider oder Zustände in `InputSystem`, wenn diese nach Phase 2 tatsächlich klassenübergreifend sind.

---

# 15. Radial öffnen

Die bisherige feste Prüfung:

```text
classId === inspector_gadachs
```

soll nicht mehr die fachliche Voraussetzung für das Construction Radial sein.

Stattdessen gilt:

```text
Spieler besitzt mindestens ein aktuell aktives Construction Tool
```

Das Rad wird weiterhin über:

```text
R
```

geöffnet.

Die bestehende Steuerungslogik zum Auswählen und anschließenden Verwenden des Construction Tools soll weiterverwendet werden.

Normale Nicht-Construction-Utilities dürfen durch die Generalisierung nicht verändert werden.

---

# 16. Radial-Inhalte

Das Rad zeigt:

1. aktuell ausgerüstete und erlaubte Construction Tools,
2. gezielten Rückbau,
3. globalen Rückbau.

Für den Inspector können mehrere Construction Tools gleichzeitig erscheinen.

Für Nicht-Inspector-Klassen erscheint in Phase 2 normalerweise höchstens ein Construction Tool gleichzeitig.

Affordability-/Capacity-Anzeigen verwenden den zentralen klassenabhängigen Capacity-Resolver.

---

# 17. Rückbau

## 17.1 Für alle bauenden Klassen

Gezielter Rückbau und globaler Rückbau stehen allen Klassen zur Verfügung, sobald sie Zugriff auf das Construction Tool Radial besitzen.

Globaler Rückbau bleibt ausdrücklich **kein Inspector-Sonderrecht**.

---

## 17.2 Strikte Ownership-Regel

Jeder Spieler darf ausschließlich seine eigenen normalen Konstruktionen zurückbauen.

Verbindlich:

```text
Host
→ darf nur host-persistent Konstruktionen mit ownerId = Host entfernen

Guest A
→ darf nur guest-session Konstruktionen mit ownerId = Guest A entfernen

Guest B
→ darf nicht Konstruktionen von Guest A entfernen

Host
→ darf nicht Guest-Konstruktionen entfernen
```

Der Host erhält hier kein Sonderrecht.

`base-owned` ist über normalen Player-Rückbau grundsätzlich nicht rückbaubar.

---

## 17.3 Hostautoritative Validierung

Der Client darf beim Rückbau nicht selbst bestimmen, wem ein Ziel gehört.

Der Host ermittelt Ownership aus dem autoritativen Runtime-State.

Bei einem gezielten Dismantle-Request gilt sinngemäß:

```text
requesterId
→ Ziel auf Host auflösen
→ Ziel ist rückbaubar?
→ ownership.ownerId === requesterId?
→ nur dann ausführen
```

Ein vom Client mitgesendetes `ownerId` darf nicht als Autorität verwendet werden.

---

## 17.4 Globaler Rückbau

Globaler Rückbau bedeutet in Phase 2:

```text
entferne alle aktuell materialisierten,
normal rückbaubaren Konstruktionen
des Requesters
```

Er darf niemals Konstruktionen anderer Spieler erfassen.

Dormant-Blueprint-Einträge werden durch den normalen globalen Runtime-Rückbau **nicht implizit gelöscht**.

Begründung:

- Dormant-Einträge besitzen keine interagierbare Runtime-Instanz.
- Phase 2 enthält noch keinen Base Editor.
- Das bestehende Dormant-Prinzip soll nicht durch einen versteckten Save-Löschpfad gebrochen werden.

Eine spätere explizite Funktion „gesamten persönlichen Blueprint löschen“ wäre ein getrenntes Feature.

---

# 18. Placement-System

Alle Klassen, Spielmodi und Ownership-Typen verwenden denselben vorhandenen bzw. generalisierten `PlacementSystem`-Pfad.

Der Auswahlweg liefert vor dem Placement eine kanonische:

```text
constructionId
```

Nicht zulässig sind getrennte Placement-Arten für:

- Inspector ConstructionId,
- Rock Barrier Utility,
- Spore Turret Utility,
- Nicht-Inspector,
- Guest,
- Persistent Host,
- Deathmatch.

Der zentrale Host-Placement-Pfad muss mindestens validieren:

```text
Requester / Owner
constructionId bekannt
ConstructionDefinition
GameMode
Access Resolver
Klasse / Unlock / Loadout, soweit relevant
Zone
Grid
Kollision
persönliche Capacity
Ownership
sonstige bestehende Placement-Regeln
```

Nach erfolgreichem Placement entsteht dieselbe gemeinsame Construction-Runtime, unabhängig davon, ob die Auswahl ursprünglich über:

```text
Construction Radial
oder
Utility Slot
```

erfolgt ist.

Danach wird das Placement atomar akzeptiert oder abgelehnt.

---

# 19. Atomare Zellkonflikte

Bei konkurrierenden Platzierungen auf dieselbe Zelle gilt:

> Die erste vom Host vollständig erfolgreich akzeptierte Platzierung gewinnt.

Der Host ist die einzige Autorität.

Nicht zulässig sind:

- Client-Zeitstempel als Konfliktentscheidung,
- „beide erst validieren, später beide setzen“,
- lokale Client-Reservation als Gameplay-Wahrheit.

Der kritische Ablauf muss logisch atomar sein:

```text
Host erhält Request
→ vollständige Validierung gegen aktuellen Host-State
→ Zelle reservieren / Runtime-State aktualisieren
→ Spawn / Replikation
```

Wenn ein zweiter Request danach dieselbe Zelle beansprucht, wird er abgelehnt.

Client Preview bleibt rein UX-seitig.

---

# 20. Persönliche Capacity im Multiplayer

Capacity wird pro Owner und über denselben spielmodusübergreifenden Resolver berechnet.

Beispiel Coop:

```text
Host Inspector:
100 + Boni

Guest Nukem:
30 + Boni

Guest Steel:
30 + Boni
```

Beispiel eines Modus ohne Klassen:

```text
Deathmatch Player:
GameMode-Basiswert + anwendbare Boni
```

Der konkrete Deathmatch-Basiswert ist konfigurierbar und nicht Bestandteil der Persistent-Base-Balance dieses Dokuments.

Capacity-Werte werden nicht addiert und nicht geteilt.

Eine Construction von Guest A verbraucht keine Capacity von Guest B oder Host.

Der Restore Planner muss daher Capacity pro Owner getrennt führen.

Eine globale Map-Kollision bleibt dagegen gemeinsam.

---

# 21. Host-Persistent Working State

Der Host-Pfad aus Phase 1 bleibt grundsätzlich erhalten:

```text
Committed Host Blueprint
→ Mission Baseline
→ Runtime Working Base
→ Sieg: Commit
→ Niederlage: Rollback
```

Phase 2 ergänzt diesen Pfad um:

- klassenabhängige Capacity,
- Loadout-Eligibility,
- Ownership,
- gemeinsame Multiplayer-Kollisionen,
- Guest-Bauten.

Es darf nicht versucht werden, die Host-Persistenz durch die Guest-Session-Logik zu ersetzen.

---

# 22. Guest-Session Working State

Für jeden Guest existiert im Raum ein committed Session-Blueprint.

Beim Start einer Persistent-Base-Mission:

```text
Guest Room Blueprint
→ Guest Mission Baseline
→ Restore
→ Runtime Working State
```

Während der Mission können Guest-Konstruktionen:

- neu gebaut,
- zerstört,
- gezielt zurückgebaut,
- global zurückgebaut

werden.

Diese Änderungen sind zunächst Working State.

---

# 23. Sieg / Commit

Bei erfolgreichem Missionsabschluss werden die beiden Persistenzebenen getrennt behandelt.

## Host

```text
Host Working State
→ bestehender PersistentBase Commit
→ PersistentBaseState
→ localStorage
```

## Guests

```text
Guest Working State
→ neuer Guest Room Blueprint
→ nur Host-RAM / Room State
→ KEIN localStorage
```

Damit gilt:

- zerstörte Guest-Konstruktion + Sieg → innerhalb der aktuellen Guest Session verloren,
- zurückgebaute Guest-Konstruktion + Sieg → innerhalb der aktuellen Guest Session entfernt,
- neu gebaute Guest-Konstruktion + Sieg → über nächste Maps der aktuellen Room Session erhalten.

---

# 24. Niederlage / Rollback

Bei Niederlage werden alle normalen persönlichen Working-State-Änderungen der Mission verworfen.

## Host

Zurück auf den Host-Baseline-State vor Missionsbeginn.

## Guests

Jeder Guest wird auf seinen Guest-Session-Baseline-State vor Missionsbeginn zurückgesetzt.

Beispiele:

```text
Guest baut Turm
→ Niederlage
→ Turm ist nicht im Guest Room Blueprint
```

```text
Guest-Turm war vor Missionsstart vorhanden
→ wird zerstört
→ Niederlage
→ Turm ist beim nächsten Restore wieder vorhanden
```

```text
Guest baut vorhandene Konstruktion zurück
→ Niederlage
→ Konstruktion kehrt zurück
```

Dieses Verhalten entspricht dem bestehenden Transaktionsprinzip der persistenten Basis.

---

# 25. Mapwechsel

Nach einem erfolgreichen Commit und vor dem normalen Arena-Teardown müssen die zuständigen States vollständig aktualisiert sein.

Auf der nächsten Persistent-Base-Map wird neu materialisiert aus:

```text
base-owned      [Phase 2 nur vorbereitet]
+
Host Persistent Blueprint
+
Guest Room Blueprints
```

Dabei gelten erneut:

- aktuelle Klasse,
- aktuelle Unlocks,
- aktuelles Loadout,
- aktuelle persönliche Capacity,
- aktuelle Persistent Zone,
- aktuelle Kollisionen.

Es werden keine Runtime-Entities zwischen Maps „mitgenommen“.

Es wird immer über die normalen bestehenden Runtime-Systeme neu materialisiert.

---

# 26. Nicht-Persistent-Base-Maps innerhalb desselben Raums

Guest-Session-State ist raumweit.

Deshalb gilt:

```text
Persistent Base Map
→ Guest Blueprint vorhanden

wechsel auf normale Map
→ Guest Blueprint bleibt im Room State
→ keine Materialisierung

später wieder Persistent Base Map
→ Guest Blueprint wird erneut restored
```

Dies ist ausdrücklich gewünscht.

Der Room-State darf deshalb nicht an die Lebensdauer einer einzelnen Persistent-Base-Arena gekoppelt werden.

---

# 27. Neuer Raum

Guest-Session-State ist nicht account- oder save-persistent.

Beim Start eines neuen Raums gilt:

```text
Host Persistent Base
→ weiterhin aus Host-localStorage vorhanden

Guest Session Blueprints
→ leer
```

Auch derselbe Client darf seinen Guest-Blueprint nicht in einen neuen Raum übertragen.

---

# 28. Disconnect / Resume

Der vorhandene Reconnect-/Resume-Lifecycle ist zu respektieren.

Ein temporärer Verbindungsabbruch innerhalb des vorhandenen Resume-Fensters gilt **nicht** als finales Leave.

Während dieses Zustands:

- Guest Room Blueprint bleibt erhalten,
- bestehende Guest-Konstruktionen bleiben erhalten,
- kein Cleanup nur wegen `player-disconnected`.

Bei erfolgreichem Resume:

- derselbe Spieler übernimmt denselben Guest-Session-State,
- es wird kein zweiter Guest-Owner erzeugt.

---

# 29. Finales Leave / Resume-Expiry

Guest-Session-State wird endgültig entfernt bei einem fachlich finalen Verlassen, insbesondere:

- explizites Leave,
- Kick, sofern vorhandener Lifecycle dies als finales Entfernen behandelt,
- Ablauf des Resume-Fensters / `player-expired`,
- Wechsel in Spectator gemäß Abschnitt 30.

Beim finalen Entfernen müssen:

1. alle aktuell materialisierten Guest-Konstruktionen dieses Owners entfernt werden,
2. abhängige Runtime-Systeme sauber bereinigt werden,
3. der Guest-Blueprint aus dem Room State gelöscht werden.

Die Entfernung soll über bestehende normale Construction-Cleanup-Pfade laufen.

Es dürfen keine verwaisten:

- Collider,
- Target-Registrierungen,
- Support-Effekte,
- Timers,
- Network-States,
- Occupancy-Einträge

zurückbleiben.

---

# 30. Spectator

Ein Spectator nimmt nicht am aktiven Spiel teil.

Wechselt ein Guest in den Spectator-Zustand, gilt dies für Persistent Base bewusst wie ein finales Entfernen seiner Guest-Bauten.

Verbindliches Verhalten:

```text
Guest → Spectator
→ alle aktuellen eigenen Guest-Konstruktionen entfernen
→ Guest Room Blueprint löschen
```

Kehrt derselbe Spieler später als aktiver Spieler zurück:

```text
neue Guest Construction Session
→ leerer Guest Blueprint
```

Spectator unterscheidet sich damit ausdrücklich vom temporären Reconnect-Zustand.

---

# 31. Klassenwechsel

Beim Klassenwechsel wird ein persönlicher Blueprint nicht gelöscht.

Beim nächsten Restore entscheidet die neue Klasse über:

- verfügbare Tools,
- Loadout,
- Unlocks,
- Capacity.

Beispiel:

```text
Inspector Blueprint:
80 / 100

nächste Mission als Nukem:
30 Capacity
```

Nur der deterministisch zulässige Teil wird aktiv.

Zusätzlich gilt in Phase 2:

Ein Konstrukt wird nur aktiv, wenn sein Tool auch im **aktuellen Loadout** liegt.

Der Rest bleibt dormant.

---

# 32. Loadout-Wechsel

Dasselbe gilt bei Loadout-Wechsel.

Beispiel:

```text
Mission A:
Rock Barrier ausgerüstet
→ mehrere Rock Barriers persistent vorhanden

Mission B:
Spore Turret ausgerüstet
```

Ergebnis beim Restore:

```text
Rock Barriers
→ bleiben im Blueprint
→ dormant

Spore Turrets im Blueprint
→ dürfen materialisiert werden,
   sofern Unlock, Capacity, Zone und Kollision passen
```

Wird später Rock Barrier wieder ausgerüstet, dürfen die alten Rock Barriers wieder aktiv werden.

Phase 2 führt keinen Base Editor ein.

---

# 33. Kein erzwungener Live-Rematerialize bei Loadout-Änderung

Phase 2 muss keine neue komplexe Live-Neuberechnung aller bereits laufenden Konstruktionen einführen, nur weil sich ein Loadout während einer aktiven Arena theoretisch ändern könnte.

Die verbindlichen Eligibility-Zeitpunkte sind:

- Placement-Request,
- Restore / Materialisierung.

Bestehende Loadout-Commit- und Arena-Regeln des Spiels sollen respektiert werden.

Ein zusätzlicher Mid-Mission-Despawn-/Respawn-Mechanismus ist nicht Teil dieser Phase, sofern er nicht bereits durch vorhandene Systeme zwingend notwendig ist.

---

# 34. Restore-Konflikte zwischen Host und Guests

Da mehrere persönliche Blueprints dieselben Zellen beanspruchen können, muss Restore deterministisch sein.

Verbindliche Grundpriorität:

```text
base-owned
vor
host-persistent
vor
guest-session
```

Dadurch bleibt die langfristige Host-Basis die primäre Basis des Raums.

Wenn ein Guest-Blueprint wegen einer höher priorisierten Konstruktion nicht materialisiert werden kann:

- Guest-Eintrag nicht löschen,
- Eintrag bleibt dormant,
- keine Capacity berechnen,
- bei späterem konfliktfreien Restore darf er wieder aktiv werden.

Für Konflikte zwischen mehreren Guests wird die stabile hostautoritativ vergebene Session-Reihenfolge verwendet.

---

# 35. Neubau-Konflikte während der Mission

Während einer laufenden Mission gilt dagegen ausschließlich die tatsächliche atomare Host-Annahme.

Beispiel:

```text
Guest A Request auf Zelle X
Guest B Request auf Zelle X
```

Wenn A zuerst vollständig akzeptiert wurde:

```text
A gewinnt
B wird abgelehnt
```

Es gibt keine nachträgliche Ownership-Priorität für normale Runtime-Placements.

---

# 36. Zerstörung

Persönliche normale Konstruktionen bleiben normale Runtime-Konstruktionen.

Es entsteht keine zweite „Persistent Base Simulation“.

Wenn eine Konstruktion im normalen Gameplay zerstört wird:

- Runtime-System entfernt sie normal,
- die zuständige Mission Session erkennt den Verlust,
- bei Sieg wird der Verlust committed,
- bei Niederlage erfolgt Rollback auf Baseline.

Das gilt symmetrisch für:

- host-persistent,
- guest-session.

`base-owned` erhält seine besonderen Regeln erst vollständig in Phase 3.

---

# 37. Persistent Zone

Die Phase-1-Zonenlogik bleibt maßgeblich.

Nur Konstruktionen, die nach den bestehenden Regeln der Persistent Zone als persistent/sessionfähig gelten, gelangen in:

- Host Persistent Working State,
- Guest Session Working State.

Bauten außerhalb der Persistent Zone werden nicht dadurch persistent, dass sie einem Guest gehören.

Die bestehende normale Utility-/Runtime-Semantik außerhalb der Zone bleibt erhalten.

---

# 38. Construction Costs

`capacityCost` ist Bestandteil der gemeinsamen `ConstructionDefinition`.

Sinngemäß:

```ts
ConstructionDefinition {
  id;
  kind;
  footprint;
  maxHp;
  placementRange;
  capacityCost;
  // typabhängige optionale Felder
}
```

Damit existiert für jede `constructionId` genau eine fachliche Quelle für deren Basiskosten.

Rock Barrier und Spore Turret dürfen keine separaten Coop-Cost-Tabellen oder Utility-Sonderkosten besitzen.

Capacity-Kosten hängen an der Construction-Identität, nicht an:

- Auswahlweg,
- Ownership,
- Klasse,
- Utility-vs.-Inspector-Historie.

Falls spielerspezifische Modifikatoren Capacity-Kosten verändern sollen, müssen sie explizit über den gemeinsamen Resolution-Pfad laufen.

---

# 39. Client Preview

Der Client darf weiterhin lokal Placement Preview darstellen.

Die Preview soll dieselben gemeinsamen Resolver verwenden für:

- aktuelles Tool,
- Unlock,
- Loadout,
- persönliche Capacity,
- bekannte Placement-Regeln.

Die Preview ist trotzdem nicht autoritativ.

Verbindlich:

```text
Client Preview = UX
Host Validation = Gameplay-Wahrheit
```

Wenn sich der State zwischen Preview und Request geändert hat, darf der Host ablehnen.

---

# 40. Netzwerk

Phase 2 soll nur die Netzwerkdaten ergänzen, die für das bestehende Runtime-Gameplay tatsächlich benötigt werden.

Für normale Construction-Replikation ist die kanonische `constructionId` die fachliche Identität.

Nicht erforderlich ist:

- Übertragung eines Client-Persistent-Base-Saves,
- vollständige Replikation des Guest Room Blueprints an alle Clients,
- Client-Autorität über Guest Session,
- Client-seitiger Persistenz-Commit,
- ein eigener Netzwerkpfad für Rock Barrier oder Spore Turret.

Der Host hält die Guest-Session-Wahrheit.

Normale Runtime-Constructions werden weiter über die vorhandenen Replication-Pfade dargestellt, aber ihre Identität darf nicht mehr aus historischen Utility- oder `kind`-Sonderfällen rekonstruiert werden.

---

# 41. Request-Identität

Bei Construction-Requests ist die tatsächliche Netzwerkidentität des Requesters maßgeblich.

Ownership darf nicht durch einen frei vom Client gelieferten `ownerId` bestimmt werden.

Sinngemäß:

```text
Peer / Player Request Context
→ authoritative requesterId
→ daraus Ownership bestimmen
```

Für den Host:

```text
host-persistent
```

Für einen aktiven Client:

```text
guest-session
```

Für Spectators:

```text
kein normales Construction Placement
```

---

# 42. Bestehende Architektur-Anker

Nach Phase 1 existieren bereits geeignete Anknüpfungspunkte, insbesondere:

```text
src/persistentBase/PersistentBaseSession.ts
src/persistentBase/PersistentBaseRestorePlanner.ts
src/persistentBase/PersistentBaseTypes.ts

src/config/coopDefenseConstructions.ts
src/config/coopDefenseClasses.ts

src/systems/PlacementSystem.ts
src/systems/InputSystem.ts

src/ui/InspectorToolRadialMenu.ts

src/scenes/ArenaScene.ts
src/scenes/arena/ArenaLifecycleCoordinator.ts

src/network/NetworkBridge.ts
src/network/peer/PeerRoom.ts

src/utils/coopDefenseUpgrades.ts
src/loadout/content/data/utilities-placeables.json
```

Für die Construction-Vereinheitlichung soll aus diesen heute verteilten Informationen eine zentrale fachliche Registry-/Resolver-Schicht entstehen.

Die genaue Dateistruktur darf an den bestehenden Code angepasst werden, beispielsweise:

```text
ConstructionRegistry
ConstructionAccessResolver
ConstructionCapacityResolver
ConstructionRuntimeMeta / ConstructionRuntimeContract
```

Es ist nicht erforderlich, diese Namen exakt zu verwenden.

Entscheidend ist die Verantwortungsgrenze:

```text
Registry
→ Was ist diese Construction?

Access Resolver
→ Darf dieser Spieler sie in diesem Modus verwenden?

Capacity Resolver
→ Wie viel Capacity hat dieser Spieler?

Placement / Runtime
→ Kann sie hier jetzt gebaut werden und wie lebt sie?

Persistence
→ Soll ihre kanonische constructionId als Blueprint erhalten bleiben?
```

Die Implementierung darf Dateien sinnvoll umbenennen oder Verantwortungen extrahieren.

Ein großer unabhängiger Architektur-Refactor außerhalb des Construction-Systems ist jedoch nicht Ziel dieser Phase.

---

# 43. `coopDefenseConstructions.ts`

Die heute in `coopDefenseConstructions.ts` liegenden Construction-spezifischen Daten sollen nicht als dauerhaft Coop-spezifische Wahrheit weitergeführt werden.

Ziel ist eine gemeinsame Construction Registry.

Mindestens folgende Informationen sollen pro normaler Construction zentral auflösbar sein:

```ts
interface ConstructionDefinition {
  id: ConstructionId;
  kind: ConstructionKind;
  footprint: ...;
  maxHp: number;
  placementRange: number;
  capacityCost: number;

  weaponId?: ...;
  targetRange?: number;
  powerUpDefId?: ...;
  // weitere typabhängige Daten
}
```

Die exakten Typfelder sollen an den vorhandenen Code angepasst werden.

Die Registry muss mindestens die bisher relevanten Spieler-Constructions abbilden:

```text
rock_barrier
spore_turret
rocket_turret
machine_gun_turret
flame_turret
tesla_turret
gravity_turret
slow_bubble_turret
medic_pedestal
armor_pedestal
weitere bestehende Inspector-Constructions
```

Die bisherige `coopDefenseConstructions.ts` darf als Übergangs- oder Kompatibilitätsfassade bestehen bleiben, sofern dort keine zweite fachliche Wahrheit zurückbleibt.

Insbesondere sollen:

- Capacity-Kosten,
- Construction-Identität,
- relevante Basiseigenschaften

nicht parallel in mehreren Tabellen gepflegt werden.

Der Capacity-Resolver wird separat spieler-/modusbezogen aufgebaut:

```ts
resolveConstructionCapacity({
  gameMode,
  classId,
  modifiers,
})
```

---

# 44. `PersistentBaseRestorePlanner`

Der Planner bleibt die zentrale deterministische Materialisierungslogik.

Er soll nicht durch:

```text
HostRestorePlanner
+
GuestRestorePlanner
```

dupliziert werden.

Ebenso darf er keine historische Sonderliste enthalten wie:

```text
if rock
if spore
```

Stattdessen erhält er kanonische `constructionId`s und verwendet:

```text
Construction Registry
Construction Access Resolver
Construction Capacity Resolver
```

Die Restore-Orchestrierung darf mehrere Owner nacheinander gemäß Restore-Priorität durch den gemeinsamen Planner führen.

Globale Zellbelegung muss dabei über die bereits materialisierten höher priorisierten Constructions berücksichtigt werden.

Alle effektiven Runtime-Werte werden beim Materialisieren aus:

```text
Construction Base Definition
+
aktuelle Spieler-/Klassen-/Upgrade-Modifikatoren
=
Resolved Construction Definition
```

abgeleitet.

Der persistente Blueprint speichert grundsätzlich die Identität und Platzierungsdaten, nicht eine zweite vollständige Kopie der abgeleiteten Runtime-Stats.

---

# 45. `PersistentBaseSession`

Der vorhandene Phase-1-Session-Mechanismus soll weiterverwendet werden.

Er darf erweitert oder durch eine klar getrennte Room-State-Komponente ergänzt werden.

Wichtig ist:

- Host-Persistenz bleibt transaktional wie in Phase 1.
- Guest-Session nutzt dasselbe Working-/Baseline-Prinzip.
- Runtime-zu-Blueprint-Zuordnung bleibt zentral.
- kein paralleles Guest-Sondersystem direkt in einzelnen Construction-Klassen.

---

# 46. `InputSystem`

Inspector-spezifische Provider-/State-Namen sollen dort generalisiert werden, wo die Funktion nach Phase 2 tatsächlich klassenübergreifend ist.

Insbesondere darf das Radial nicht mehr an:

```text
isInspectorMode()
```

als einzige fachliche Voraussetzung gekoppelt sein.

Neue fachliche Frage:

```text
hasActiveConstructionTools(player)
```

oder äquivalent.

Die bestehende Inspector-Steuerung soll dadurch nicht regressieren.

---

# 47. `InspectorToolRadialMenu`

Die bestehende Komponente wird generalisiert.

Erwartetes Zielverhalten:

```text
Inspector:
mehrere ausgerüstete Tools
+ Dismantle
+ Global Dismantle

Nukem / Steel:
max. aktuelles Construction Utility
+ Dismantle
+ Global Dismantle
```

Capacity-Darstellung zeigt jeweils persönliche aktuelle Capacity.

Eine zweite Nicht-Inspector-Radial-Komponente ist nicht zulässig.

---

# 48. `PlacementSystem`

`PlacementSystem` bleibt gemeinsamer Placement-Pfad.

Seine fachliche Eingabe für normale Spielerbauten soll nach der Vereinheitlichung eine kanonische `constructionId` sein.

Selection Adapter dürfen weiterhin existieren:

```text
Inspector Radial Selection
→ constructionId

Utility Slot Selection
→ constructionId
```

Diese Adapter enden aber vor der eigentlichen Construction-Runtime.

Die Phase-2-Erweiterung darf Owner-/Access-/Capacity-Informationen einspeisen, aber nicht den Grid- oder Collision-Unterbau duplizieren.

Neue Validierungen müssen in derselben autoritativen Entscheidung enden.

---

# 49. `ArenaLifecycleCoordinator`

Der Arena-Lifecycle muss Phase 2 korrekt orchestrieren:

Bei Start einer Persistent-Base-Map:

```text
Host Save laden / Baseline herstellen
Guest Room States lesen
Restore-Reihenfolge ausführen
Runtime-Mappings registrieren
```

Bei Sieg:

```text
Host committen
Guest Room States committen
```

Bei Niederlage:

```text
Working States verwerfen
```

Beim Arena-Teardown:

```text
keinen gültigen room-scoped Guest State versehentlich löschen
```

---

# 50. Room-Lifecycle-Integration

Die Room-Komponente muss Events aus dem bestehenden Multiplayer-Lifecycle konsumieren.

Mindestens relevant:

```text
player-disconnected
player-resumed
player-expired
player-left / quit
Spectator-Wechsel
Room-Ende
```

Verhalten:

```text
disconnected
→ behalten

resumed
→ behalten / wieder zuordnen

expired
→ löschen

final quit
→ löschen

spectator
→ löschen
```

Die vorhandene ResumeSlot-Logik soll nicht umgangen werden.

---

# 51. Cleanup eines Guest Owners

Es soll einen zentralen Cleanup-Pfad geben, sinngemäß:

```ts
removeGuestSessionOwner(playerId)
```

Dieser muss sowohl:

- Room Blueprint,
- aktive Runtime-Konstruktionen

vollständig entfernen.

Dieser Pfad soll von:

- finalem Leave,
- Resume-Expiry,
- Spectator-Wechsel

wiederverwendet werden.

Keine drei unabhängigen Cleanup-Implementierungen.

---

# 52. Ownership an Runtime-Konstruktionen

Der Host muss für jede relevante Runtime-Construction zuverlässig bestimmen können:

```text
runtimeId
constructionId
ownership type
ownerId
```

Diese Informationen werden benötigt für:

- Dismantle,
- Global Dismantle,
- Capacity,
- Damage,
- Repair,
- Turret-/Support-Systeme,
- Mission Commit,
- Guest Cleanup,
- Networking,
- Persistence,
- Diagnose.

Falls bestehende Runtime-Entities bereits `ownerId` besitzen, soll dies weiterverwendet werden.

Zusätzlich muss klar unterscheidbar sein, ob ein Objekt:

- host-persistent,
- guest-session,
- base-owned

ist.

Die `constructionId` ist die einzige fachliche Construction-Identität.

Nicht zulässig ist, Identität oder Verhalten indirekt daraus abzuleiten, ob:

```text
constructionId vorhanden / nicht vorhanden
kind === rock
kind === turret
Utility-Definition verwendet wurde
```

Die konkrete Speicherung kann zentral in Construction-Metadaten oder Session-Mappings erfolgen.

Vermeide dieselbe Ownership-/Identity-Wahrheit in mehreren voneinander unabhängigen Maps.

---

# 53. Keine Übernahme von Guest-Saves

Clients schicken in Phase 2 niemals ihre lokale langfristige Basis in den Host-Raum.

Nicht implementieren:

```text
Client localStorage
→ Upload zum Host
→ Merge in Host-Basis
```

Die langfristige Basis eines Raums ist immer die Basis des Hosts.

Guest-Spieler tragen ausschließlich mit `guest-session` Bauten bei.

---

# 54. Host-Wechsel

Ein vollständiger Host-Migration-/Host-Handover-Mechanismus ist nicht Teil dieser Phase, sofern das aktuelle Multiplayer-System dies nicht bereits anbietet.

Phase 2 darf nicht für eine hypothetische spätere Host-Migration unnötig komplex werden.

Falls der Host den Raum beendet und dadurch der Raum endet:

```text
Guest Session State endet ebenfalls
```

Der persistente Host-Save bleibt gemäß bestehender Save-Regeln bestehen.

---

# 55. Fehler- und Sicherheitsverhalten

Ungültige oder veraltete Requests dürfen keinen inkonsistenten State erzeugen.

Bei Fehlern gilt:

- Placement ablehnen statt teilweise anwenden,
- Dismantle ablehnen statt fremde Ownership zu überschreiben,
- unbekanntes Tool nicht materialisieren,
- fehlender Guest Owner nicht crashen,
- mehrfacher Cleanup muss idempotent bzw. sicher sein,
- Resume nach bereits finalem Expiry darf keinen gelöschten Guest Blueprint rekonstruieren.

---

# 56. Diagnose

Für die Implementierungs- und Testphase sind kompakte Development-Logs sinnvoll.

Relevante Diagnoseinformationen:

```text
playerId
ownership
toolId
eligibility result
capacity used/max
restore/dormant reason
commit/rollback
guest cleanup reason
placement reject reason
```

Logging soll Development-/Debug-orientiert bleiben und keine dauerhafte Spam-Quelle im Release werden.

---

# 57. Bestehende Testmaps

Map 18 und Map 19 bleiben in Phase 2 die primären Integrationsmaps für Persistent Base.

Sie sollen nicht bereits als finale Kampagneninhalte behandelt werden.

Phase 3 übernimmt später die echte Reward-/Kampagnenintegration und den Rückbau der technischen Testinhalte.

---

# 58. Empfohlene Implementierungsreihenfolge

Die Umsetzung soll in kleinen, testbaren Schritten erfolgen.

## Schritt 1 – Gemeinsame Construction Registry und IDs

- kanonische `ConstructionId` definieren bzw. bestehende IDs vereinheitlichen,
- normale `ConstructionDefinition` als zentrale Datenquelle schaffen,
- Rock Barrier und Spore Turret in die Registry übernehmen,
- bestehende Inspector-Constructions über dieselbe Registry auflösen,
- Alias-/Normalisierungsschicht für historische IDs ergänzen,
- keine Runtime-Identität mehr aus `kind` ableiten.

## Schritt 2 – Rock/Spore-Runtime vereinheitlichen

- `ROCK_BARRIER` und `SPORE_TURRET` aus der Runtime-Sonderrolle des Utility-Systems lösen,
- Utility-/Loadout-Definitionen nur noch als Auswahl-/Access-Weg verwenden,
- nach Placement dieselbe Construction-Runtime wie bei Inspector-Constructions erzeugen,
- `ROCK_BARRIER_COOP` und `SPORE_TURRET_COOP` entfernen,
- normale Construction-Lifetime entfernen.

## Schritt 3 – Gemeinsame Runtime-Verträge

- Placement,
- Collision,
- Damage,
- Repair,
- Dismantle,
- Rendering,
- Turret-/Support-Systeme,
- Energy Injector,
- Networking,
- Persistent-Base-Klassifizierung
  auf `constructionId` / gemeinsamen Runtime-Vertrag ausrichten,
- historische implizite Sonderprüfungen entfernen.

## Schritt 4 – Capacity spielmodusübergreifend zentralisieren

- `resolveConstructionCapacity({ gameMode, classId, modifiers })`,
- Coop: 30 / 30 / 100 + Boni,
- Modus ohne Klassen: konfigurierbarer GameMode-Basiswert,
- alle Aufrufer auf denselben Resolver stellen,
- Capacity statt Lifetime als normale Mengenbegrenzung verwenden.

## Schritt 5 – Construction Access zentralisieren

- `GameMode + Klasse + Unlock + Loadout → allowed constructionIds`,
- Inspector Construction Slots berücksichtigen,
- Nicht-Inspector Utility-Slot berücksichtigen,
- Deathmatch ohne Klassenmodell unterstützen,
- Placement, Restore, Radial und Preview auf denselben Resolver stellen.

## Schritt 6 – Radial generalisieren

- Inspector-Hardcode entfernen,
- neutrales Construction Radial,
- R für alle bauenden Coop-Klassen,
- Dismantle und Global Dismantle für alle,
- normale Nicht-Construction-Utilities unverändert lassen.

## Schritt 7 – Persistent Restore auf constructionId umstellen

- Blueprint-ID zentral normalisieren,
- keine Rock-/Spore-Sonderliste,
- gemeinsame Registry / Access / Capacity verwenden,
- bestehendes Save-Schema kompatibel halten.

## Schritt 8 – Ownership explizit machen

- `host-persistent`,
- `guest-session`,
- `base-owned`,
- Runtime-Metadaten / zentrale Zuordnung,
- Dismantle auf Owner begrenzen.

## Schritt 9 – Room-scoped Guest State

- Host-RAM-Blueprint pro Guest,
- stabile IDs / Placement Order,
- Lebensdauer über Mapwechsel,
- keine Save-Serialisierung.

## Schritt 10 – Guest Placement

- normale Client-Requests über gemeinsamen Construction-Placement-Pfad,
- persönliche Capacity,
- atomare Zellvergabe,
- Session-Registrierung.

## Schritt 11 – Gemeinsamer Restore

- Host zuerst,
- Guests danach,
- per Owner Capacity,
- Loadout-Dormancy,
- Collision-Dormancy,
- stabile Reihenfolge.

## Schritt 12 – Commit / Rollback

- Host-Save kompatibel,
- Guest Sieg → Room Blueprint,
- Niederlage → beide Ebenen Baseline,
- Mapwechsel korrekt.

## Schritt 13 – Leave / Reconnect / Spectator

- temporärer Disconnect behalten,
- Resume behalten,
- Expiry löschen,
- finales Leave löschen,
- Spectator löschen,
- Runtime-Cleanup testen.

## Schritt 14 – Integration und Regression

- zwei oder mehr Clients,
- Map 18 ↔ 19,
- zwischenzeitliche normale Map,
- Klassen-/Loadout-Wechsel,
- Same-Cell-Race,
- Reload / neuer Raum,
- Deathmatch Rock Barrier / Spore Turret,
- keine Construction-Lifetime,
- keine historischen `_COOP`-Varianten.

---

# 59. Automatisierte Tests – Capacity

Mindestens folgende Coop-Fälle:

```text
Nukem ohne Bonus
→ 30

Steel ohne Bonus
→ 30

Inspector ohne Bonus
→ 100

Nukem + Bonus 10
→ 40

Inspector + Bonus 25
→ 125
```

Zusätzlich mindestens ein Modus ohne Klassen:

```text
Deathmatch
→ konfigurierter Construction-Basiswert
→ plus definierte Modifikatoren
```

Zusätzlich sicherstellen:

- Host Validation verwendet denselben Resolver,
- Client Preview verwendet denselben Resolver,
- Restore verwendet denselben Resolver,
- HUD und Radial verwenden denselben Resolver,
- Rock Barrier und Spore Turret benutzen keinen separaten Capacity-Pfad.

---

# 60. Automatisierte Tests – Eligibility

Mindestens:

```text
constructionId unbekannt
→ kein Placement
→ kein Restore
```

```text
Construction bekannt, aber im GameMode nicht erlaubt
→ kein Placement
→ kein Restore
```

```text
Tool / Construction locked
→ kein Placement
→ kein Restore
```

```text
Construction unlocked, aber nicht im Loadout
→ kein Placement
→ Blueprint bleibt dormant
```

```text
Construction unlocked + im Loadout
→ Placement möglich
→ Restore möglich
```

```text
Inspector Construction unlocked, Slot nicht aktiv
→ dormant / nicht baubar
```

```text
Inspector Construction unlocked + aktiver Slot
→ baubar
```

```text
Nicht-Inspector normales Construction Utility ausgerüstet
→ Radial verfügbar
```

```text
Deathmatch ohne Klassenmodell
→ erlaubte Utility-Auswahl liefert dieselbe constructionId
```

---

# 61. Automatisierte Tests – Loadout Dormancy

Beispiel:

```text
Rock Barrier persistent vorhanden
→ Rock Barrier aus Loadout entfernen
→ Restore
→ nicht materialisiert
→ Blueprint-Eintrag weiterhin vorhanden
```

Danach:

```text
Rock Barrier wieder ausrüsten
→ Restore
→ Konstruktion materialisiert wieder
```

Dasselbe Prinzip mindestens einmal für Inspector Construction Slots testen.

---

# 62. Automatisierte Tests – Ownership und Rückbau

Mindestens zwei aktive Spieler.

Testfälle:

```text
Guest A baut A1
Guest B baut B1

Guest A dismantle A1
→ erlaubt
```

```text
Guest A dismantle B1
→ abgelehnt
```

```text
Host dismantle Guest A1
→ abgelehnt
```

```text
Guest A global dismantle
→ entfernt nur eigene aktive Konstruktionen
→ Guest B und Host bleiben unverändert
```

```text
Host global dismantle
→ entfernt nur eigene aktive Konstruktionen
```

Dormant-Einträge dürfen vom normalen Global Dismantle nicht versehentlich gelöscht werden.

---

# 63. Automatisierte Tests – atomare Zellvergabe

Zwei Clients senden nahezu gleichzeitig Placement auf dieselbe freie Zelle.

Erwartung:

```text
genau eine Konstruktion wird akzeptiert
genau eine wird abgelehnt
keine Doppelbelegung
keine doppelte Capacity-Buchung
kein inkonsistenter Blueprint
```

Wiederholung mit:

- Host + Client,
- Client + Client.

---

# 64. Automatisierte Tests – Guest Mapwechsel

Ablauf:

```text
Guest baut auf Map 18
→ Sieg
→ Map 19
```

Erwartung:

```text
Guest-Konstrukt wird auf Map 19 restored
```

Danach:

```text
Map 19
→ normale Nicht-Persistent-Base-Map
→ wieder Persistent-Base-Map
```

Erwartung:

```text
Guest-Konstrukt weiterhin vorhanden
```

---

# 65. Automatisierte Tests – neuer Raum

Ablauf:

```text
Guest baut
→ Sieg
→ Guest Blueprint im Raum vorhanden
→ Raum endet
→ neuer Raum
```

Erwartung:

```text
kein Guest Blueprint
keine Guest-Konstruktion
```

Host-Persistent-Save bleibt davon unberührt.

---

# 66. Automatisierte Tests – Disconnect

Ablauf:

```text
Guest baut
→ Sieg
→ temporärer Disconnect
```

Vor Resume-Expiry:

```text
Guest Blueprint bleibt
Guest-Konstruktionen bleiben
```

Bei erfolgreichem Resume:

```text
derselbe State bleibt zugeordnet
```

---

# 67. Automatisierte Tests – Resume-Expiry

Ablauf:

```text
Guest Blueprint vorhanden
→ Disconnect
→ Resume-Fenster läuft ab
```

Erwartung:

```text
Runtime-Konstruktionen des Guests entfernt
Guest Room Blueprint entfernt
keine verwaisten Occupancy-/Systemeinträge
```

---

# 68. Automatisierte Tests – Spectator

Ablauf:

```text
Guest Blueprint vorhanden
→ Guest wechselt zu Spectator
```

Erwartung:

```text
alle aktiven Guest-Konstruktionen entfernt
Guest Room Blueprint gelöscht
```

Danach Rückkehr als aktiver Spieler:

```text
leere Guest Construction Session
```

---

# 69. Automatisierte Tests – Sieg und Niederlage

## Guest Neubau + Niederlage

```text
Baseline leer
→ Guest baut
→ Niederlage
→ Blueprint wieder leer
```

## Guest Neubau + Sieg

```text
Baseline leer
→ Guest baut
→ Sieg
→ Blueprint enthält Konstrukt
```

## Guest Zerstörung + Niederlage

```text
Baseline enthält Turm
→ Turm zerstört
→ Niederlage
→ Turm kehrt zurück
```

## Guest Zerstörung + Sieg

```text
Baseline enthält Turm
→ Turm zerstört
→ Sieg
→ Turm aus Guest Blueprint entfernt
```

Dasselbe Transaktionsprinzip für Rückbau testen.

---

# 70. Automatisierte Tests – Restore-Konflikte

Mindestens:

```text
Host Blueprint und Guest Blueprint beanspruchen gleiche Zelle
→ Host wird materialisiert
→ Guest bleibt dormant
```

Mehrere Guests:

```text
Guest A und Guest B kollidieren
→ deterministischer Gewinner nach stabiler Session-Reihenfolge
→ Verlierer bleibt dormant
```

Nach Entfernen des Konflikts und späterem Restore darf der dormante Guest-Eintrag wieder aktiv werden.

---

# 71. Automatisierte Tests – Save-Isolation

Nach Guest-Construction und Sieg:

- Host `PersistentBaseState` laden,
- sicherstellen, dass keine Guest-Construction enthalten ist,
- keine Guest-`ownerId` im Host-Persistent-Save,
- bestehende Schema-Version unverändert,
- Host-Save weiterhin nach Reload lesbar.

Zusätzlich Construction-ID-Kompatibilität testen:

```text
alter ROCK_BARRIER-Eintrag
→ zentrale Normalisierung
→ rock_barrier

alter ROCK_BARRIER_COOP-Eintrag
→ zentrale Normalisierung
→ rock_barrier

alter SPORE_TURRET-/SPORE_TURRET_COOP-Eintrag
→ zentrale Normalisierung
→ spore_turret
```

Danach:

- neuer Save verwendet die kanonische ID,
- Restore enthält keine eigene Rock-/Spore-Sonderliste,
- `tool.kind` beeinflusst nicht mehr die Construction-Identität.

---

# 72. Regressionstests

Phase 2 darf folgende Phase-1-Funktionen nicht beschädigen:

- Host baut alleine persistent,
- Sieg committed,
- Niederlage rollt zurück,
- HP-Restore,
- Radius-/Zone-Regeln,
- dormant wegen Capacity,
- dormant wegen Unlock,
- ungültiger Save crasht nicht,
- normale Runtime-Constructions außerhalb Persistenz bleiben bis zum Rundenende normale Runtime-Objekte.

Zusätzlich:

- Inspector kann weiterhin seine vorhandenen Construction Tools nutzen,
- Inspector Radial verhält sich mit mehreren Slots korrekt,
- normale Nicht-Construction-Utilities von Nukem/Steel funktionieren unverändert,
- Placement Preview funktioniert weiterhin für Host und Client,
- Rock Barrier funktioniert nach Migration spielerisch weiterhin,
- Spore Turret funktioniert nach Migration spielerisch weiterhin,
- Deathmatch kann beide über seinen Utility-/Loadout-Weg verwenden,
- Rock/Spore laufen nicht mehr über `lifetimeMs` aus,
- Rundenende räumt nicht-persistente Runtime-Constructions korrekt auf,
- `_COOP`-Varianten sind nicht mehr erforderlich,
- Repair-/Damage-/Networking-Pfade erkennen Rock/Spore über dieselbe Construction-Identität wie andere Constructions.

---

# 73. Manuelle Integrationsmatrix

Mindestens folgende Kombinationen einmal auf Map 18/19 testen:

```text
Host Inspector + Guest Nukem
Host Inspector + Guest Steel
Host Nukem + Guest Inspector
Host Steel + Guest Inspector
Host Nukem + Guest Steel
```

Mit drei Spielern zusätzlich:

```text
Host
+ Guest A
+ Guest B
```

Schwerpunkte:

- unterschiedliche Capacity,
- verschiedene Construction Tools,
- Zellkonflikte,
- Rückbau-Ownership,
- Guest Mapwechsel,
- Reconnect,
- Spectator,
- Loadout Dormancy.

---

# 74. Nicht Bestandteil von Phase 2

Nicht implementieren:

- permanente Base-Owned Missions-Rewards,
- RewardSourceMissionId-Flow,
- Kampagnen-Reward-Missionen,
- finalen Map-16-/17-Reward-Content,
- Base Editor,
- manuelle Verwaltung dormanter Blueprint-Einträge,
- Blueprint-Sharing,
- Client-Save-Merge,
- Team-Capacity,
- Host-Migration,
- freie Bearbeitung fremder Konstruktionen,
- vollständige Umgestaltung des Loadout-Systems,
- zweites Placement-System,
- zweites Radial-System,
- zweite Construction-Simulation.

Wichtig zur Abgrenzung:

Die **Guest-Session-Persistenz ist weiterhin Bestandteil von Phase 2**, aber **nicht Bestandteil des Construction-Runtime-Refactors selbst**.

Die Reihenfolge ist:

```text
Construction Runtime vereinheitlichen
→ danach Guest-Session-/Ownership-Logik darauf aufsetzen
```

Ebenso bleiben Base-Owned Rewards und Phase-3-Ownership-Regeln fachlich außerhalb des Runtime-Refactors.

Falls zukünftig bewusst zeitlich begrenzte Deployables benötigt werden, sollen diese als eigener temporärer Gameplay-Typ modelliert werden.

Nicht wieder einführen:

```text
normale Construction
+ lifetimeMs
+ Modus-Sondervariante
```

---

# 75. Architektur-Invarianten

Nach Phase 2 müssen folgende Aussagen wahr sein:

## Eine Construction-Identität

Jede normale gebaute Spieler-Construction besitzt eine kanonische `constructionId`.

## Auswahlweg ist nicht Runtime-Typ

Inspector Radial und Utility Slot dürfen dieselbe `constructionId` liefern.

Nach Placement entsteht dieselbe Construction-Runtime.

## Eine Construction Registry

Rock Barrier, Spore Turret und Inspector-Constructions werden über denselben Definition-/Registry-Vertrag aufgelöst.

## Keine historische Kind-Identität

Weder `kind === rock` noch `kind === turret` noch das Vorhandensein eines historischen Utility-Pfads bestimmt die fachliche Construction-Identität.

## Keine normale Construction-Lifetime

Normale Spieler-Constructions laufen nicht automatisch durch `lifetimeMs` aus.

Sie bestehen bis:

```text
zerstört
oder zurückgebaut
oder Runden-/Arena-Teardown
```

Persistente Blueprints können sie anschließend in einer späteren Arena erneut materialisieren.

## Eine Runtime-Simulation

Persistente Constructions sind normale Runtime-Constructions.

## Ein Placement-Pfad

Alle Klassen, Auswahlwege und Player-Ownerships verwenden denselben Placement-Unterbau.

## Ein Restore-Prinzip

Host und Guests verwenden dieselben Registry-, Access-, Capacity- und Collision-Regeln.

## Eine Capacity-Wahrheit

Capacity wird zentral aus GameMode, Klasse und Modifikatoren aufgelöst.

## Eine Access-Wahrheit

GameMode + Klasse + Unlock + Loadout bestimmen zentral die erlaubten `constructionId`s.

## Resolved Player Values

Effektive Construction-Werte entstehen aus:

```text
Construction Base Definition
+
Spieler-/Klassen-/Upgrade-Modifikatoren
=
Resolved Construction Definition
```

Dafür ist kein separater Construction-Typ pro Klasse nötig.

## Hostautorität

Der Host entscheidet über jede Gameplay-relevante Platzierung und jeden Rückbau.

## Persönliches Ownership

Spieler können nur eigene normale Constructions zurückbauen.

## Host-Save bleibt Host-Save

Guest Session wird niemals Teil des persistenten Host-Saves.

## Guest Session ist raumweit

Mapwechsel löschen Guest-Bauten nicht.

## Finales Entfernen löscht Guest State

Leave, Expiry und Spectator entfernen ihn.

## Temporärer Disconnect löscht nichts

Resume-Fenster wird respektiert.

## Dormant ist kein Verlust

Loadout-/Klassen-/Capacity-/Collision-bedingt inaktive Einträge bleiben erhalten.

---

# 76. Definition of Done

Phase 2 gilt erst als abgeschlossen, wenn alle folgenden Punkte erfüllt sind:

### Construction-Vereinheitlichung

- [ ] Rock Barrier besitzt eine normale kanonische `constructionId`.
- [ ] Spore Turret besitzt eine normale kanonische `constructionId`.
- [ ] Alle normalen Spieler-Constructions besitzen nach Placement eine eindeutige `constructionId`.
- [ ] Eine gemeinsame Construction Registry / Definition-Quelle existiert.
- [ ] `capacityCost` wird aus der gemeinsamen Construction-Definition aufgelöst.
- [ ] Rock Barrier und Spore Turret werden nicht mehr über `kind === rock/turret` identifiziert.
- [ ] Historische Utility-/Inspector-Auswahlwege erzeugen keine unterschiedlichen Runtime-Objektarten mehr.
- [ ] Inspector und andere Klassen können dieselbe Construction über unterschiedliche Access-/Selection-Wege verwenden.
- [ ] Deathmatch kann Rock Barrier und Spore Turret ohne Klassenmodell über denselben Construction-Unterbau verwenden.
- [ ] Normale Spieler-Constructions besitzen keine automatische `lifetimeMs`-Begrenzung mehr.
- [ ] Normale Constructions bleiben bis Zerstörung, Rückbau oder Runden-/Arena-Ende bestehen.
- [ ] `ROCK_BARRIER_COOP` ist als Runtime-/Lifetime-Sondervariante entfernt.
- [ ] `SPORE_TURRET_COOP` ist als Runtime-/Lifetime-Sondervariante entfernt.
- [ ] Zukünftige temporäre Deployables können als eigener Gameplay-Typ modelliert werden, ohne normale Construction-Lifetime zurückzubringen.
- [ ] Placement arbeitet auf kanonischen `constructionId`s.
- [ ] Collision arbeitet auf dem gemeinsamen Construction-Runtime-Vertrag.
- [ ] Damage arbeitet auf dem gemeinsamen Construction-Runtime-Vertrag.
- [ ] Repair arbeitet auf dem gemeinsamen Construction-Runtime-Vertrag.
- [ ] Dismantle arbeitet auf dem gemeinsamen Construction-Runtime-Vertrag.
- [ ] Rendering kann die gemeinsame Construction-Identität verwenden.
- [ ] Turret-/Support-Systeme können die gemeinsame Construction-Identität verwenden.
- [ ] Energy Injector verwendet keine historische Utility-vs.-Construction-Sonderannahme.
- [ ] Networking kann normale Constructions anhand `constructionId` replizieren.
- [ ] Persistent-Base-Klassifizierung arbeitet auf `constructionId`.
- [ ] Persistent Restore besitzt keine fest verdrahtete Rock-/Spore-Sonderliste.
- [ ] Bestehende alte Rock-/Spore-/`_COOP`-Save-IDs werden ausschließlich an einer zentralen Registry-/Normalisierungsgrenze auf kanonische IDs gemappt.
- [ ] Neue Saves verwenden die kanonische Construction-ID innerhalb des kompatiblen Phase-1-Schemas.
- [ ] Spieler-/Klassen-/Upgrade-Modifikatoren werden auf eine gemeinsame Base Definition angewandt und benötigen keinen separaten Construction-Typ.

### Capacity und Access

- [ ] `resolveConstructionCapacity({ gameMode, classId, modifiers })` oder äquivalenter zentraler Resolver existiert.
- [ ] Nukem und Steel besitzen in Coop 30 Basis-Capacity.
- [ ] Inspector besitzt in Coop 100 Basis-Capacity.
- [ ] `construction.capacity`-Boni wirken für alle relevanten Coop-Klassen.
- [ ] Spielmodi ohne Klassen können einen eigenen zentral konfigurierten Construction-Basiswert besitzen.
- [ ] Placement, Preview, HUD, Radial und Restore verwenden dieselbe Capacity-Logik.
- [ ] Ein zentraler Construction Access Resolver existiert.
- [ ] Access berücksichtigt GameMode, Klasse, Unlock und aktuelles Loadout.
- [ ] Freigeschaltete, aber nicht ausgerüstete Constructions bleiben dormant.
- [ ] Dormant-Einträge werden durch Loadout-Wechsel nicht gelöscht.
- [ ] Inspector Construction Slots bleiben fachlich relevant.
- [ ] Rock Barrier ist über normalen Unlock-/Loadout-Pfad für vorgesehene Nicht-Inspector-Klassen nutzbar.
- [ ] Spore Turret ist über normalen Unlock-/Loadout-Pfad für vorgesehene Nicht-Inspector-Klassen nutzbar.
- [ ] Inspector-Spezialconstructions bleiben Inspector-spezifisch.

### Radial und Rückbau

- [ ] Das bestehende Inspector Radial ist zu einem gemeinsamen Construction Tool Radial generalisiert.
- [ ] R öffnet das Construction Radial für alle Coop-Spieler mit aktivem Construction Tool.
- [ ] Kein zweites Radial-System existiert.
- [ ] Gezielter Rückbau ist für alle bauenden Klassen verfügbar.
- [ ] Globaler Rückbau ist für alle bauenden Klassen verfügbar.
- [ ] Jeder Spieler kann nur eigene normale Constructions zurückbauen.
- [ ] Host kann Guest-Constructions nicht über normalen Rückbau entfernen.
- [ ] Globaler Rückbau betrifft nur eigene aktuell materialisierte Constructions.

### Ownership und Guest Session

- [ ] `host-persistent`, `guest-session`, `base-owned` sind sauber unterscheidbar.
- [ ] Guest Session besitzt einen room-scoped Host-State.
- [ ] Guest-Bauten überleben Map 18 → Map 19.
- [ ] Guest-Bauten überleben zwischenzeitliche Nicht-Persistent-Base-Maps im selben Raum.
- [ ] Guest-Bauten werden auf Nicht-Persistent-Base-Maps nicht materialisiert.
- [ ] Guest-Bauten werden niemals in Host-localStorage geschrieben.
- [ ] Kein Client-Persistent-Save wird zum Host gemerged.
- [ ] Neuer Raum startet ohne Guest-Session-Bauten.
- [ ] Temporärer Disconnect innerhalb Resume-Fenster behält Guest State.
- [ ] Resume übernimmt denselben Guest State.
- [ ] Resume-Expiry entfernt Guest Runtime und Blueprint.
- [ ] Finales Leave entfernt Guest Runtime und Blueprint.
- [ ] Spectator-Wechsel entfernt Guest Runtime und Blueprint.
- [ ] Rückkehr aus Spectator startet mit leerem Guest Blueprint.
- [ ] Guest Working State wird bei Sieg in den Room State committed.
- [ ] Guest Working State wird bei Niederlage auf Mission Baseline zurückgerollt.
- [ ] Host Victory-/Rollback-Verhalten aus Phase 1 bleibt korrekt.

### Multiplayer und Restore

- [ ] Zellkonflikte werden hostautoritativ atomar entschieden.
- [ ] Zwei konkurrierende Requests können keine Doppelbelegung erzeugen.
- [ ] Restore ist deterministisch.
- [ ] Restore-Priorität berücksichtigt Host vor Guest.
- [ ] Konfliktbedingt inaktive Guest-Einträge bleiben dormant statt gelöscht.
- [ ] Persönliche Capacity wird pro Owner getrennt berechnet.
- [ ] Save-Schema aus Phase 1 bleibt kompatibel.
- [ ] `PersistentBaseState` enthält weiterhin ausschließlich langfristige Host-Basisdaten.
- [ ] Phase-1-Regressionstests bleiben erfolgreich.
- [ ] Multiplayer-Tests mit mindestens zwei Clients auf Map 18/19 sind vorhanden.
- [ ] Klassen-, Loadout-, Capacity-, Leave-, Reconnect-, Spectator-, Dismantle- und Konfliktfälle sind automatisiert abgedeckt.
- [ ] Phase 3 kann auf `base-owned` und der gemeinsamen Construction-Runtime aufsetzen, ohne Phase-2-Ownership oder Construction-Identität neu zu entwerfen.

---

# 77. Zielzustand nach Phase 2

Nach erfolgreicher Umsetzung existiert technisch nur noch **eine normale Spieler-Construction-Runtime**.

Beispiele:

```text
rock_barrier
spore_turret
rocket_turret
machine_gun_turret
flame_turret
tesla_turret
gravity_turret
slow_bubble_turret
medic_pedestal
armor_pedestal
...
```

Der Zugriffsweg ist davon getrennt:

```text
Inspector Construction Radial
→ constructionId

Nicht-Inspector Utility-/Loadout-Slot
→ constructionId

Deathmatch Utility-/Loadout-Slot
→ constructionId
```

Nach Placement entsteht jeweils dieselbe Runtime-Kategorie.

Normale Spieler-Constructions besitzen keine automatische Lifetime mehr.

Ihre normale Laufzeit ist:

```text
Placement
→ bleibt bestehen
→ bis zerstört
   oder zurückgebaut
   oder Runden-/Arena-Ende
```

Capacity ist die gemeinsame Mengenbegrenzung und wird zentral aus:

```text
GameMode
Klasse, sofern vorhanden
Modifikatoren / Boni
```

aufgelöst.

Im Multiplayer-Raum existiert weiterhin genau eine langfristig gespeicherte Basis:

```text
Host Persistent Base
```

Darauf arbeiten mehrere Spieler gemeinsam.

Der Host besitzt langfristig persistente persönliche Constructions.

Clients besitzen raumweit temporär persistente persönliche Constructions:

```text
Guest Session
```

Alle Spieler verwenden denselben technischen Construction-Unterbau.

Ihre Unterschiede entstehen nur aus:

```text
GameMode
Klasse
Unlocks
Loadout
Capacity
Upgrades
Ownership
```

Ein Loadout-Wechsel löscht keinen Basisfortschritt, sondern macht aktuell nicht verfügbare Constructions dormant.

Ein Spieler kann nur seine eigenen Constructions zurückbauen.

Guest-Bauten überleben Mapwechsel und Reconnects, verschwinden aber bei:

```text
finalem Leave
Resume-Expiry
Spectator
Room-Ende
```

Der Host-Save bleibt frei von Client-Daten.

Damit ist die persistente Basis nach Phase 2 technisch bereit für Phase 3:

```text
Base-Owned Rewards
+
Kampagnenintegration
+
permanente Missions-Rewards
```

Phase 3 kann auf einer einheitlichen Construction-Runtime, einer einheitlichen Construction-Identität und den bereits etablierten Ownership-/Session-Regeln aufbauen, ohne die Grundarchitektur erneut zu trennen.

---
