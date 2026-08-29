# Fragdachse – Persistente Basis
## Implementierungs-GDD Phase 3D – Permanent Rewards & Special Placement Framework (V4)

**Status:** Ready for Implementation  
**Zielgruppe:** Coding-KIs und Entwickler  
**Dokumenttyp:** Delta-orientiertes Implementierungs-GDD  
**Code-Basis:** Phase 3C vollständig umgesetzt (`PB 3C-4`)

---

# 1. Ziel

Phase 3D ergänzt die Persistent Base um **dauerhafte, basisgebundene Kampagnen-Rewards**.

Die Rewards:

- werden durch Map-Siege oder Secondary Objectives dauerhaft freigeschaltet,
- besitzen stabile Reward-IDs,
- werden für reward-berechtigte Spieler als persönlicher Campaign-Unlock gespeichert,
- gehören in einer Session nur dann zur Persistent Base, wenn der Host sie freigeschaltet hat,
- besitzen einen eigenen Host-Base-Placement-State,
- sind keine persönlichen Konstruktionen,
- verbrauchen keine persönliche Construction Capacity,
- verwenden bestehende Runtime-/Gameplay-Definitionen, soweit möglich,
- nutzen die bestehende Placement-/Dismantle-Infrastruktur, statt parallele Sonderpfade zu erzeugen.

Phase 3D ist bewusst **Inspector-first**:

- Der Inspector kann die neuen Rewards über die bestehende bzw. minimal erweiterte Bau-/Radial-UX auswählen.
- Andere Klassen müssen Permanent Base Rewards in 3D noch nicht auswählen oder platzieren können.
- Der universelle Zugriff für alle Klassen folgt mit **Radial Menu V2 in Phase 3F**.

Nicht Bestandteil von 3D:

- universelles Radial Menu V2,
- globale R-/E-Neudefinition,
- Repositioning,
- Wiederplatzierung nach Rückbau.

Ein in 3D zurückgebauter Reward darf bis 3F bewusst nicht erneut platziert werden.

---

# 2. Zentrale Architektur

Map-Siege und Secondary Objectives verwenden denselben generischen Grant-Pfad.

```text
Campaign Event
    -> Persistent Base Reward Grant
        |
        +-> Personal Campaign Unlock
        |      für jeden reward-berechtigten Teilnehmer
        |
        +-> Host Capability Update
               nur relevant, wenn der Host den Reward besitzt
               -> Host Base Reward State
                    -> Runtime / Placement
```

Wichtig:

- Ein Gast-Unlock erweitert niemals die Host-Basis.
- Ein Gast kann keinen Reward aus seinem eigenen Progress in eine Host-Basis importieren.
- Ein persönlicher Unlock wird relevant, wenn der Spieler später selbst Host ist.
- Die Host-Campaign ist die einzige Quelle für gemeinsame Base Capabilities.

Nicht erwünscht:

```text
if mapId === '12'
    unlockHolyHandGrenade()
```

Erwünscht:

```text
authored trigger
    -> stable PersistentBaseRewardId
    -> generic grant service
```

---

# 3. Fachliche Domänen

## 3.1 Persistent Base Reward Definition

Beschreibt statisch, **was** ein Reward ist.

Mindestens:

- stabile Reward-ID,
- Kategorie,
- Runtime-/Gameplay-Referenz,
- Darstellung,
- Placement-Regel,
- Runtime-Initialzustand.

Beispielhafte IDs:

```text
base_adrenaline_pedestal
base_health_pedestal
base_spore_turret
base_rocket_turret
base_holy_hand_grenade_pedestal
```

Die Reward-ID ist strikt getrennt von:

- `ConstructionId`,
- Weapon-/Turret-ID,
- Power-up-ID,
- `LoadoutToolRef`.

Die endgültigen TypeScript-Namen dürfen sich der aktuellen Architektur anpassen.

---

## 3.2 Personal Campaign Unlock

Beschreibt, dass **ein Spieler** den Reward dauerhaft freigeschaltet hat.

```text
locked -> unlocked
unlocked -> keine Änderung
```

Eigenschaften:

- persönlicher Campaign Progress,
- idempotent,
- unabhängig vom Placement,
- niemals Teil persönlicher Persistent-Base-Contributions.

---

## 3.3 Host Base Capability

Beschreibt, welche Permanent Rewards die aktuelle Host-Basis grundsätzlich besitzen darf.

```text
Gast besitzt Reward
Host besitzt Reward nicht
-> Reward nicht verfügbar
```

```text
Host besitzt Reward
Gast besitzt Reward nicht
-> Reward gehört zur Host Base
```

Damit sind bewusst getrennt:

```text
Grant Eligibility
Placement Eligibility
```

---

## 3.4 Host Base Reward Placement State

Beschreibt den persistenten Zustand der Rewards des Hosts.

Fachlich:

```text
unplaced
placed
```

`locked` muss nicht im Placement-State gespeichert werden, weil es sich aus fehlendem Host-Unlock ergibt.

Ein platzierter Reward benötigt mindestens:

- Reward-ID,
- Placement-State,
- base-relative Position,
- Orientierung nur falls fachlich erforderlich.

Absolute Arena-Koordinaten dürfen nicht persistiert werden.

---

# 4. Persistenzgrenzen

## 4.1 Personal Campaign Progress

Speichert:

```text
Persistent Base Reward Unlocks
```

für den lokalen Spieler.

## 4.2 Personal Persistent-Base-Contributions

Der bestehende `PersistentBaseContributionStore` bleibt ausschließlich für persönliche Konstruktionen zuständig.

Base Rewards dürfen dort niemals:

- als Construction,
- als Tool,
- als Contribution,
- als Capacity-Belegung

gespeichert werden.

## 4.3 Host Persistent Base Reward State

Für Base-owned Rewards wird ein eigener persistenter Host-State eingeführt.

Konzeptionell:

```text
PersistentBaseRewardState
    schemaVersion
    revision
    placements[]
```

Ein Placement referenziert die stabile Reward-ID und base-relative Placement-Daten.

Die konkrete Storage-Struktur darf sich dem bestehenden Campaign-Save anpassen.

---

# 5. Keine Alt-Save-Migration

Bestehende Test-Saves müssen nicht unterstützt werden.

Keine:

- Backfills aus alten Siegen,
- Migration alter Campaign States,
- `highestUnlockedMap >= X`-Heuristiken,
- rückwirkenden HHG-Unlocks.

Testspieler beginnen nach Einführung von 3D mit einem neuen Save.

Neue 3D-Saves benötigen weiterhin:

- Validation,
- Sanitizing,
- Import,
- Export.

---

# 6. Reward-Katalog

| Trigger | Reward | Kategorie |
| --- | --- | --- |
| Sieg Map 4 | Adrenalin-Podest | Base Pedestal |
| Sieg Map 6 | Fliegenpilzturm | Base Turret |
| Sieg Map 7 | HP-Podest | Base Pedestal |
| Sieg Map 8 | Raketenturm | Base Turret |
| `hold-supply-base` auf Map 12 | Holy-Hand-Grenade-Podest | Base Pedestal |

Map 9:

- besitzt keine Persistent Base,
- vergibt keinen Rocket-Turret-Reward.

---

# 7. Wiederverwendung vorhandener Gameplay-Definitionen

Keine parallelen Gameplay-Kopien.

## 7.1 Fliegenpilzturm

Verwendet die bestehende `spore_turret`-Gameplay-/Weapon-/Visual-Definition.

## 7.2 Raketenturm

Verwendet die bestehende `rocket_turret`-Gameplay-/Weapon-/Visual-Definition.

## 7.3 HP-Podest

Verwendet die vorhandene Health-Power-up-Mechanik.

Initial:

```text
Respawn 5 Sekunden
```

## 7.4 Adrenalin-Podest

Verwendet die vorhandene Adrenalin-Power-up-Mechanik.

Initial:

```text
Respawn 10 Sekunden
```

## 7.5 Holy-Hand-Grenade-Podest

Verwendet die vorhandene HHG-Power-up-Logik.

Initial:

```text
erste Holy Hand Grenade sofort verfügbar
danach 30 Sekunden Respawn
```

---

# 8. Persistenter State vs Runtime State

Persistiert:

- Personal Unlock,
- Host Reward Placement,
- base-relative Position,
- ggf. stabile Placement-Metadaten.

Nicht persistiert:

- Turret-Cooldowns,
- Targets,
- aktuelle Schusszustände,
- Power-up-Respawn-Timer,
- bereits verstrichene Respawn-Zeit,
- Base-HP,
- sonstiger Mission-Runtime-State.

Nach Materialisierung beginnt ein Reward aus seinem definierten Runtime-Initialzustand.

Für das HHG-Podest gilt:

```text
Materialisierung
-> erste HHG sofort verfügbar
-> danach normaler 30-Sekunden-Zyklus
```

Ein laufender Respawn-Timer wird nicht zwischen Maps oder Sessions gespeichert.

---

# 9. Base Turrets – Placement auf der Base Surface

Der kanonische Persistent-Base-Core besitzt bereits die Domain:

```text
base-surface
```

Diese vorhandene Domain ist der Placement-Vertrag für Base Turrets.

## 9.1 Keine dedizierten Mounts

Es werden **keine separaten Turret-Mount-Objekte oder festen Slots** eingeführt.

Stattdessen gilt:

```text
jede freie base-surface Rasterzelle
-> gültige Base-Turret-Position
```

Der aktuelle kanonische 5x5-Core besitzt 12 `base-surface`-Zellen.

Nicht gültig für Base Turrets:

- `courtyard-build-area`,
- `entrance`,
- übrige Persistent-Base-Build-Area außerhalb der Base Surface.

## 9.2 Freie Wahl

Jeder freigeschaltete Base Turret darf auf **jede freie gültige `base-surface`-Zelle** gesetzt werden.

Es gibt keine Typbindung:

```text
Zelle A nur Rocket
Zelle B nur Spore
```

ist ausdrücklich unerwünscht.

Beispiel:

```text
base_spore_turret
-> beliebige freie base-surface-Zelle

base_rocket_turret
-> beliebige freie base-surface-Zelle
```

Pro Rasterzelle darf höchstens ein Base Turret stehen.

## 9.3 Runtime-Eigenschaften

Base Turrets besitzen:

- kein eigenes Fundament,
- keinen eigenen kollidierenden Fundament-/Turm-Body,
- keine eigenen HP,
- kein separat zerstörbares Construction-Objekt.

Die Basis selbst stellt das Fundament bereit.

```text
Base aktiv -> Turm aktiv
Base im Kampf zerstört -> Turm fällt mit aus
```

Die Runtime-Zerstörung der Base entfernt den persistenten Placement-State nicht.

---

# 10. Base Pedestals

Base Pedestals dürfen **frei innerhalb der normalen Persistent-Base-Build-Area** platziert werden.

Dies gilt für:

- Adrenalin-Podest,
- HP-Podest,
- HHG-Podest.

Sie sind:

- nicht kollidierend,
- überlaufbar,
- nicht separat zerstörbar,
- nicht blockierend für Spieler oder Projektile.

Trotz fehlender Runtime-Kollision darf ihre Placement-Zelle nicht gleichzeitig von einem anderen persistenten Placement belegt werden.

Damit bleibt die visuelle Basisbelegung eindeutig.

---

# 11. Composite- und Konfliktpriorität

Der bestehende 3C-Composite-Vertrag bleibt erhalten:

- Merge ist deterministisch,
- Konflikte löschen keine persönlichen Saves.

Für 3D wird die fachliche Priorität erweitert:

```text
1. authored World / kanonischer Basiskern
2. Base-owned Reward Placements
3. Host Contribution
4. Guest Contributions
```

Base Rewards werden **nicht** zu Fake-Contributions umgebaut.

Empfohlene Integration:

1. Base-owned Rewards gegen Core/World validieren.
2. Reward-belegte Zellen als reserviert behandeln.
3. Erst danach den bestehenden Contribution-Composite ausführen.
4. Reward-Reservierungen fließen in dessen bestehende Blocked-/Collision-Prüfung ein.

Kollidiert eine persönliche Contribution mit einem Base Reward:

- Base Reward gewinnt,
- persönliche Construction wird dormant/nicht materialisiert,
- ihr Save bleibt vollständig erhalten.

---

# 12. Map-Victory-Grants

```text
Map 4 Victory -> Adrenalin-Podest
Map 6 Victory -> Fliegenpilzturm
Map 7 Victory -> HP-Podest
Map 8 Victory -> Raketenturm
```

Grant Eligibility verwendet die bereits vorhandene zentrale Round-Participation-/Reward-Policy.

Keine zweite Definition für:

- Spectators,
- Latejoiner,
- aktive Teilnehmer.

Der Grant wird für jeden berechtigten Spieler persönlich gespeichert.

---

# 13. Map 8 / Map 9

Map 8:

```text
Persistent Base aktiv
Victory
-> Rocket Turret Personal Unlock
-> bei Host zusätzlich neue Host Capability
```

Map 9:

```text
Persistent Base inaktiv
```

Der vorherige Rocket-Unlock darf Map 9 nicht indirekt zu einer Persistent-Base-Map machen.

Keine numerische Map-ID-Heuristik.

---

# 14. Secondary-Objective-Grants

Secondary Objectives verwenden denselben generischen Grant-Pfad wie Map Victories.

Konzeptionell:

```text
secondaryObjective:
    rewards:
        persistentBaseRewardsOnComplete:
            - base_holy_hand_grenade_pedestal
```

Der konkrete JSON-/TypeScript-Vertrag passt sich der bestehenden Secondary-Objective-Architektur an.

Keine:

- Map-12-Sonderlogik im Grant Service,
- HHG-Sonderlogik im Objective-System.

---

# 15. Map 12 – bestehende Nebenmission wiederverwenden

Es wird **keine neue Secondary Objective erfunden**.

Die bereits vorhandene Mission:

```text
hold-supply-base
```

wird wiederverwendet.

Der aktuelle 3C-Endstand enthält diese Objective nicht mehr im Map-12-JSON, obwohl:

- generische Objective-Systeme sie weiterhin unterstützen,
- i18n-Texte weiterhin vorhanden sind,
- Tests den bestehenden `hold-supply-base`-/HHG-Placement-Vertrag abdecken.

Phase 3D muss die bestehende Mission deshalb auf Map 12 wieder authoren.

## 15.1 Bisherige temporäre Reward-Mechanik

Aktuell enthält Map 12 noch:

```text
HOLY_HAND_GRENADE
region = rear
respawnMs = 30000
spawnOnArenaStart = false
```

Diese direkte map-authored HHG wird entfernt.

## 15.2 Neue Reward-Semantik derselben Mission

```text
hold-supply-base erfolgreich
    -> base_holy_hand_grenade_pedestal dauerhaft unlocken
```

Nicht mehr:

```text
hold-supply-base
    -> temporären HHG-Placement-Reward tragen
    -> einmalig platzieren
```

Die Nebenmission selbst bleibt erhalten; nur ihr Reward-Vertrag wird auf Permanent Base Reward umgestellt.

---

# 16. Sofortiger Objective-Grant

Der Reward wird direkt bei erfolgreichem Abschluss von `hold-supply-base` vergeben.

```text
Objective erfolgreich
-> HHG-Podest dauerhaft unlocked
-> Hauptmission später verloren
-> Unlock bleibt
```

Der Unlock ist Meta-Progression und gehört nicht zum Mission Working State.

---

# 17. Nutzung in derselben Mission

Ist der Host Teilnehmer des erfolgreichen Grants:

```text
hold-supply-base complete
-> Host Personal Unlock
-> Host Capability aktualisiert
-> HHG-Podest im aktuellen Match auswählbar
-> Inspector kann es sofort platzieren
```

Die Hauptmission muss dafür nicht erst beendet werden.

Dies ist der zentrale End-to-End-Test für:

- Immediate Grant,
- Host Capability Update,
- Session State,
- Runtime-Integration,
- Placement Working State.

---

# 18. Grant-Berechtigung

Grant-Berechtigung verwendet ausschließlich die zentrale bestehende Round-Participation-/Reward-Policy.

```text
eligible participant -> Personal Unlock
spectator -> kein Unlock
nicht berechtigter Latejoiner -> kein Unlock
```

Der Grant Service erfindet keine eigene Participation-Logik.

---

# 19. Placement-Berechtigung in 3D

Phase 3D ist Inspector-first.

Ein Base Reward kann in 3D platziert werden, wenn:

- der Host den Reward besitzt,
- der Reward aktuell erstmalig platzierbar ist,
- der Spieler aktiver Gameplay-Teilnehmer ist,
- der Spieler über die bestehende Inspector-Bau-/Radial-UX auf Reward Placement zugreifen kann,
- die Position gültig ist,
- der Host das Placement bestätigt.

Andere Klassen benötigen in 3D noch keinen Zugriff.

Ab Phase 3F wird der allgemeine Zugriff über Radial Menu V2 geöffnet.

Placement erzeugt keine persönliche Ownership:

```text
owner / provenance = host persistent base
```

---

# 20. Inspector-UX in 3D

Es wird **keine Übergangs-UX für andere Klassen** gebaut.

Der Inspector erhält eine minimale Integration der verfügbaren Host Rewards in seine bestehende Construction-/Radial-Auswahl.

Anforderungen:

- alle aktuell erstmalig platzierbaren Host Rewards werden angeboten,
- bei mehreren unplatzierten Rewards sind alle auswählbar,
- persönliche Inspector-Konstruktionen bleiben unverändert verfügbar,
- Reward-Auswahl verbraucht keinen Loadout-Slot,
- Reward Placement verbraucht keine persönliche Capacity.

Nicht in 3D:

- globales Radial für Nukem/Steel,
- generische Action Registry,
- allgemeines Utility-/Cooldown-Refactoring.

---

# 21. Mehrere unplatzierte Rewards

Sind mehrere Rewards freigeschaltet und noch nie platziert:

```text
alle gleichzeitig auswählbar
```

Es gibt keinen:

- Active-Reward-Slot,
- Reward-Queue-Zwang,
- vorgeschriebenen Placement-Reihenfolge.

Der Spieler entscheidet selbst.

---

# 22. Rückbau

Base Rewards verwenden die **normale bestehende Dismantle-Möglichkeit**.

Kein eigener Reward-Dismantle-Modus.

Der Host erkennt anhand der Provenienz des Zielobjekts, ob eine persönliche Construction oder ein Base-owned Reward zurückgebaut wird.

Für Reward:

```text
placed -> unplaced
```

Der Reward:

- bleibt dauerhaft unlocked,
- bleibt Host Capability,
- wird nicht vernichtet.

---

# 23. Kein Re-Place in 3D

Nach Dismantle ist der Reward in 3D nicht erneut platzierbar.

Es muss dafür **kein sauberer UI-Zwischenzustand** gebaut werden.

Der Reward kann aus der 3D-Auswahl vollständig verschwinden.

Phase 3F übernimmt:

- Wiederplatzierung,
- Repositioning,
- saubere Management-UX.

Dieser bewusst unvollständige Zwischenstand ist akzeptiert, da produktive Playtests erst nach Abschluss aller Phase-3-Schritte vorgesehen sind.

---

# 24. Working-State-Architektur nach Phase 3C

Phase 3C hat den Campaign-Vertrag finalisiert:

```text
committed
    -> beginMission()
        baseline
        working
```

Außerhalb einer Mission:

```text
Mutation
-> sofort committed
```

In einer Campaign Activity:

```text
Mutation
-> working
```

Round Outcome:

```text
Victory -> commit
Defeat / Abort -> rollback
```

Technischer World-Teardown:

```text
offener Mission State
-> rollback vor Teardown
```

Base Rewards sollen exakt dieselbe Lifecycle-Semantik verwenden.

---

# 25. Separater PersistentBaseRewardStore

Die 3C-Struktur des `PersistentBaseContributionStore` dient als Vorbild, wird aber **nicht** um Base Rewards erweitert.

Empfohlen ist ein eigener Host-seitiger Store, konzeptionell:

```text
PersistentBaseRewardStore

committed
baseline
working
hasActiveMission

beginMission()
placeReward()
dismantleReward()
commit()
rollback()
```

Unterschied zum ContributionStore:

- nur ein gemeinsamer Host-Base-State,
- keine `ownerId -> contribution`-Map,
- keine persönliche Capacity,
- keine per-player Revision,
- keine Runtime-HP-/Construction-Semantik.

Die Stores bleiben fachlich getrennt.

---

# 26. Gemeinsame Round-Outcome-Orchestrierung

Obwohl Contributions und Rewards getrennte Stores sind, dürfen sie nicht getrennt über den World-Lifecycle verteilt finalisiert werden.

Der bestehende zentrale Abschluss in `ArenaLifecycleCoordinator` wird erweitert.

Konzeptionell:

```text
finalizePersistentBaseMission(outcome)
    -> ContributionStore commit/rollback
    -> RewardStore commit/rollback
    -> bestätigte Zustände publizieren
```

Bei Victory:

```text
Contribution Working State -> commit
Reward Working State -> commit
```

Bei Defeat/Abort:

```text
Contribution Working State -> rollback
Reward Working State -> rollback
```

Der bestehende technische Teardown-Rollback muss ebenfalls **beide Stores** zurücksetzen.

Wichtig:

Base Rewards werden dadurch nicht Teil des ContributionStores; nur der Lifecycle wird gemeinsam orchestriert.

---

# 27. Campaign Placement

## Erstplatzierung

```text
vorher: unplaced
working: placed
```

Victory:

```text
commit placed
```

Defeat/Abort:

```text
rollback -> unplaced
```

## Dismantle

```text
vorher: placed
working: unplaced
```

Victory:

```text
commit unplaced
```

Defeat/Abort:

```text
rollback -> placed
```

Personal Unlock bleibt in allen Fällen unangetastet.

---

# 28. Lobby / Testgelände

Der 3C-Vertrag lautet außerhalb einer Campaign Activity:

```text
kein Mission Working State
```

Daher gilt auch für Base Rewards:

```text
validiertes Placement / Dismantle
-> committed Host Reward State sofort ändern
-> lokalen Host-Save sofort aktualisieren
-> Session State sofort publizieren
```

Kein künstlicher Round Outcome.

---

# 29. Multiplayer – Personal Grants

Personal Reward Unlocks sind Spielerfortschritt.

Für Immediate Grants wird ein reliable, idempotenter Host->Player-Vertrag benötigt.

Empfohlene Form:

```text
per-player reliable confirmed reward-grant state
```

nicht ein flüchtiges einmaliges Gameplay-RPC als einzige Wahrheit.

Der Client persistiert nur Grants, die vom Host bestätigt wurden.

Anforderungen:

- stabile Reward-ID,
- idempotent,
- Reconnect/Wiederholung unschädlich,
- keine doppelte Freischaltung.

Der konkrete NetworkBridge-Key/Typ darf analog zum bestehenden host-confirmed Contribution-State aufgebaut werden.

---

# 30. Multiplayer – gemeinsamer Host Reward Session State

Der gemeinsame Base Reward State ist **kein per-player State**.

Er erhält einen eigenen:

```text
global reliable host-authoritative state
```

Konzeptionell:

```text
PersistentBaseRewardSessionState
    revision
    availableRewardIds
    placements
```

`availableRewardIds` wird aus den Host Unlocks abgeleitet.

`placements` basiert auf dem aktuellen:

- committed State außerhalb Missionen,
- working State innerhalb einer Mission.

Dadurch sehen Clients sofort:

- neue Host Capability nach einem Immediate Grant,
- neues Placement,
- Dismantle,
- Rollback,
- Commit.

---

# 31. Latejoin / Reconnect

Clients dürfen nicht auf historische Placement-RPCs angewiesen sein.

Der reliable gemeinsame State muss ausreichen:

```text
Latejoin nach Placement
-> aktuellen Reward Session State lesen
-> genau ein korrektes Runtime-Objekt materialisieren
```

```text
Reconnect
-> State erneut lesen
-> kein Duplikat
-> kein verlorenes Placement
```

Bei parallelen Requests:

```text
zwei Clients wollen denselben Reward platzieren
-> Host validiert seriell
-> erster gültiger Request gewinnt
-> zweiter wird abgelehnt
```

---

# 32. World-Wechsel und technischer Abort

Vor technischem World-Teardown:

```text
Contribution Working State rollback
Reward Working State rollback
```

Danach wird der bestätigte Reward Session State erneut publiziert, falls der vorherige Working State bereits Clients angezeigt wurde.

Damit darf kein nicht bestätigtes Reward Placement in die nächste World leaken.

---

# 33. Base-relative Restore

Reward Placements werden relativ zum Persistent-Base-Anchor gespeichert.

## Pedestal

```text
relativeGridX
relativeGridY
```

## Base Turret

Ebenfalls base-relative Rasterkoordinate.

Zusätzlich muss bei Restore validiert werden:

```text
Zelle gehört aktuell zu domain = base-surface
```

Dadurch folgt dasselbe Placement der Persistent Base auf Maps mit unterschiedlichen Anchors.

---

# 34. Special Placement Framework

Keine isolierten Funktionen wie:

```text
placeHolyHandGrenadePedestal()
placeBaseRocketTurret()
```

Das vorhandene Placement-System wird um eine generische Provenienz/Placement-Kategorie erweitert.

Mindestens:

```text
personal construction
persistent base reward
```

Reward Definition entscheidet:

```text
baseTurret
-> target cell muss base-surface sein

basePedestal
-> target cell muss in Persistent Build Area sein
```

Diese Abstraktion darf 3F vorbereiten, soll aber noch keine vollständige Universal-Action-Architektur einführen.

---

# 35. Nicht Bestandteil von Phase 3D

- Build-Area-Progression → 3E
- Wiederplatzierung nach Reward-Dismantle → 3F
- Repositioning → 3F
- Radial Menu V2 → 3F
- Zugriff anderer Klassen auf Base Rewards → 3F
- universelle R-/E-Semantik → 3F
- generisches Cooldown-/Disabled-State-System → 3F
- Structure Occupancy
- Wachturm
- Dachsbau
- Alt-Save-Migration
- großes Reward-Balancing

---

# 36. Implementierungsschritte

## 3D-1 – Reward Domain, Persistence & Grant Contract

**Ziel:** Neue Domain und Persistenzgrenzen etablieren.

Scope:

- stabile `PersistentBaseRewardId`,
- Reward-Katalog,
- Personal Campaign Unlock Set,
- Host Persistent Base Reward State,
- `PersistentBaseRewardStore`,
- committed/baseline/working-Vertrag analog 3C,
- Save Validation/Sanitizing,
- Map-/Objective-Reward-Authoring,
- generischer idempotenter Grant Service,
- Grant Eligibility über bestehende zentrale Policy,
- reliable Personal-Grant-Vertrag,
- keine Alt-Save-Migration.

Noch nicht:

- keine produktiven Map-Rewards aktivieren,
- keine konkrete Runtime-Placement-Integration.

Akzeptanz:

- Guest Unlock erweitert Host Base nicht,
- Host Unlock definiert Capability,
- Personal Unlock und Host Placement sind getrennt,
- Reward State liegt nicht im ContributionStore,
- doppelte Grants sind idempotent.

---

## 3D-2 – Reward Runtime, Placement & Working State

**Ziel:** Base-owned Rewards erstmalig materialisieren und persistent platzieren.

Scope:

- bestehende Turret-/Power-up-Definitionen anbinden,
- generic Reward Placement,
- base-relative Persistenz,
- Base Turret nur auf `base-surface`,
- jede freie `base-surface`-Zelle gültig,
- Turret-Typ frei wählbar,
- Pedestals frei in Persistent Build Area,
- keine persönliche Capacity,
- keine eigenen Turret-HP/Bodies/Fundamente,
- RewardStore Mission Lifecycle,
- gemeinsamer Round-Outcome-Pfad,
- Immediate Lobby Commit,
- Composite Priority / Reservation,
- global reliable Reward Session State,
- Latejoin / Reconnect.

Akzeptanz:

- Turret Placement außerhalb `base-surface` wird abgelehnt,
- zwei Base Turrets können auf zwei frei gewählten Surface-Zellen stehen,
- Podest kann in freier gültiger Build-Area-Zelle stehen,
- Reward kollidiert nicht mit persönlicher Construction,
- persönliche Konflikt-Contribution wird nicht gelöscht,
- Victory/Defeat/Abort funktionieren analog 3C,
- technische Teardowns leaken keinen Working State.

---

## 3D-3 – Inspector Integration & Dismantle

**Ziel:** Neue Rewards über die bestehende Inspector-UX nutzbar machen.

Scope:

- alle erstmals platzierbaren Host Rewards in Inspector-Auswahl,
- mehrere unplatzierte Rewards gleichzeitig auswählbar,
- persönliche Inspector-Constructions unverändert,
- Reward Placement ohne Loadout-Slot/Capacity,
- normale Dismantle-Funktion erkennt Base Rewards,
- Reward Dismantle `placed -> unplaced`,
- kein Re-Place,
- kein Repositioning,
- keine Unterstützung für Nukem/Steel,
- kein Radial Menu V2.

Akzeptanz:

- Inspector kann alle verfügbaren Reward-Typen auswählen,
- normaler Rückbau funktioniert,
- Reward bleibt unlocked,
- zurückgebauter Reward ist in 3D nicht erneut platzierbar,
- bestehende Construction-UX regressiert nicht.

---

## 3D-4 – Campaign Authoring & End-to-End

Aktivieren:

```text
Map 4 -> Adrenalin-Podest
Map 6 -> Spore Turret
Map 7 -> HP-Podest
Map 8 -> Rocket Turret
Map 12 hold-supply-base -> HHG-Podest
```

Map 9:

```text
keine Persistent Base
kein Rocket Reward
```

Map 12:

- `hold-supply-base` wieder authoren,
- bestehende Mission nicht neu designen,
- bisherigen temporären Objective-Placement-Reward durch Permanent Grant ersetzen,
- aktuelle direkte `HOLY_HAND_GRENADE`-Map-Power-up-Konfiguration entfernen,
- Immediate Personal Unlock,
- Host Capability sofort aktualisieren,
- Inspector kann HHG-Podest im selben Match platzieren,
- erste HHG sofort,
- danach 30 Sekunden.

---

# 37. Empfohlene Tests

## Reward Domain

- neuer Save -> keine Rewards
- doppelter Grant -> ein Unlock
- unbekannte Reward-ID -> sanitizing/reject
- Reward-ID nicht als ConstructionId behandelt

## Map Grants

- Map 4 Victory -> Adrenalin
- Map 6 Victory -> Spore Turret
- Map 7 Victory -> Health
- Map 8 Victory -> Rocket Turret
- Map 9 Victory -> kein Rocket Grant

## Host / Guest

- Gast unlocked, Host locked -> nicht verfügbar
- Host unlocked, Gast locked -> Host Capability verfügbar
- Gast kann nicht eigenen Reward in Host Base importieren

## Grant Eligibility

- Host eligible -> Unlock
- Client eligible -> Unlock
- Spectator -> kein Unlock
- unberechtigter Latejoiner -> kein Unlock
- reliable Wiederholung -> kein Duplikat

## Base Turret Placement

- jede der 12 `base-surface`-Zellen grundsätzlich gültig
- `courtyard-build-area` für Base Turret ungültig
- `entrance` für Base Turret ungültig
- Rocket auf beliebiger freier Surface-Zelle
- Spore auf beliebiger freier Surface-Zelle
- zwei Turrets können unterschiedliche freie Surface-Zellen nutzen
- belegte Surface-Zelle lehnt zweites Placement ab
- kein Turret-Fundament
- keine Turret-HP
- kein eigener Collision Body

## Pedestal Placement

- freie Build-Area-Zelle gültig
- außerhalb Build Area ungültig
- belegte Placement-Zelle ungültig
- Spieler/Projektile werden nicht blockiert

## Campaign Working State

- place + victory -> placed committed
- place + defeat -> rollback
- place + abort -> rollback
- dismantle + victory -> unplaced committed
- dismantle + defeat -> placed restored
- technical teardown -> rollback vor Cleanup

## Lobby

- place -> sofort committed
- dismantle -> sofort committed

## Composite

- Reward Placement vor Host Contribution
- Host Contribution vor Guest Contribution
- Reward-Konflikt macht persönliche Construction dormant
- persönlicher Save bleibt erhalten

## Network Session State

- Host publiziert Capability
- Host publiziert Placement
- Latejoin rekonstruiert Placement
- Reconnect rekonstruiert Placement
- Rollback publiziert bestätigten Stand erneut
- paralleles Placement -> genau ein Gewinner

## Inspector UX

- alle unplatzierten Host Rewards gleichzeitig auswählbar
- platzierter Reward nicht erneut als Placement auswählbar
- persönlicher Construction-Scope bleibt erhalten
- Dismantle über normale Dismantle-Funktion

## Other Classes

- Dachs Nukem muss Reward Placement in 3D nicht anbieten
- Dachs of Steel muss Reward Placement in 3D nicht anbieten
- kein Universal-Radial-Refactor

## Map 12

- `hold-supply-base` wieder authored
- temporärer HHG-Placement-Reward entfernt
- direkte Map-HHG entfernt
- Objective Completion -> Permanent Unlock
- spätere Niederlage -> Unlock bleibt
- Host Capability sofort aktualisiert
- Inspector kann Podest im selben Match platzieren
- erste HHG sofort
- Respawn 30 s

## Runtime State

- HHG-Respawn-Timer nicht persistiert
- Turret-Cooldown nicht persistiert
- Restore startet aus definiertem Runtime-Initialzustand

---

# 38. Technische Leitplanken

- Kein separates Map- und Objective-Reward-System.
- Keine Map-12-Sonderarchitektur.
- Bestehende `hold-supply-base`-Mission wiederverwenden.
- Keine Gameplay-Kopien bestehender Turrets/Power-ups.
- Stable Reward ID strikt von Runtime-/Construction-ID trennen.
- Base Rewards nie in persönliche Contributions schreiben.
- Base Rewards nie auf persönliche Capacity anrechnen.
- Personal Unlock und Host Placement getrennt persistieren.
- Guest Unlock erweitert Host Base nicht.
- Base Turrets nutzen vorhandene `base-surface`-Domain statt neuer Mount-Slots.
- Jede freie Base-Surface-Zelle darf jeden Base-Turret-Typ tragen.
- Pedestals nutzen die normale Persistent Build Area.
- Placement Permission ist keine persönliche Ownership.
- 3D ist Inspector-first; Universalzugriff folgt in 3F.
- Dismantle verwendet den normalen bestehenden Dismantle-Pfad.
- Kein Re-Place nach Dismantle in 3D.
- Grant Eligibility verwendet die zentrale Participation-/Reward-Policy.
- Objective Unlock ist unabhängig vom Round Outcome.
- Reward Working State bleibt separat vom ContributionStore.
- Beide Stores werden am selben Round-/Teardown-Lifecycle finalisiert.
- Keine absoluten Arena-Koordinaten persistieren.
- Base Rewards haben Composite-Priorität vor persönlichen Contributions.
- Konflikte löschen keine persönlichen Saves.
- Gemeinsamer Host Reward State wird reliable als Zustand repliziert, nicht nur als historische Events.
- Runtime-Timer/Cooldowns nicht persistieren.
- Keine Alt-Save-Migration.
- Keine numerischen Map-ID-Heuristiken.

---

# 39. Definition of Done

Phase 3D ist abgeschlossen, wenn:

1. stabile Permanent-Reward-IDs existieren,
2. Personal Unlock und Host Placement getrennte Domains sind,
3. ein eigener Host Reward Store mit 3C-kompatibler Working-State-Semantik existiert,
4. Rewards nicht im ContributionStore liegen,
5. Host Campaign Progress die Session-Capabilities bestimmt,
6. Guest Unlocks Host Base nicht erweitern,
7. Map- und Objective-Grants denselben Pfad verwenden,
8. Grant Eligibility die zentrale bestehende Policy verwendet,
9. Map 4 Adrenalin freischaltet,
10. Map 6 Spore Turret freischaltet,
11. Map 7 Health freischaltet,
12. Map 8 Rocket Turret freischaltet,
13. Map 9 ohne Persistent Base bleibt,
14. `hold-supply-base` auf Map 12 wiederverwendet wird,
15. `hold-supply-base` das HHG-Podest dauerhaft freischaltet,
16. die aktuelle direkte Map-12-HHG entfernt ist,
17. HHG-Unlock sofort und unabhängig vom späteren Round Outcome persistiert,
18. Inspector den neuen Host Reward im selben Match nutzen kann,
19. andere Klassen in 3D noch keinen Reward-Zugriff benötigen,
20. Base Turrets jede freie `base-surface`-Zelle verwenden können,
21. Rocket/Spore frei zwischen diesen Zellen gewählt werden können,
22. keine dedizierten Turret Mounts eingeführt wurden,
23. Base Turrets kein Fundament, Body oder eigene HP besitzen,
24. Pedestals frei innerhalb der Persistent Build Area platziert werden können,
25. Base Rewards keine persönliche Capacity verwenden,
26. Placement base-relative gespeichert wird,
27. Base Reward State reliable für Latejoin/Reconnect repliziert wird,
28. ein Reward höchstens einmal platziert ist,
29. Campaign Placement/Dismantle korrekt committed/rollbackt,
30. technischer Teardown Reward Working State zurückrollt,
31. Personal Unlocks durch Placement-Rollback nicht verloren gehen,
32. normaler Dismantle-Pfad Base Rewards unterstützt,
33. Dismantle `placed -> unplaced` ausführt,
34. Wiederplatzierung bis 3F gesperrt bleibt,
35. Composite-Konflikte persönliche Contributions nicht löschen,
36. Runtime-Timer/Cooldowns nicht persistiert werden,
37. kein Universal-Radial-Refactor vorweggenommen wird,
38. relevante Regressionstests grün sind.

---

# 40. Übergang zu Phase 3F

Nach 3D existiert absichtlich noch folgende Einschränkung:

```text
Reward unlocked
Reward einmal platziert
Reward dismantled
-> unplaced, aber nicht erneut platzierbar
```

Phase 3F schließt diese Lücke durch:

- Repositioning,
- Re-Place,
- Management Actions,
- Universal Action Radial,
- Zugriff aller Klassen,
- einheitliche Cooldown-/Statusdarstellung.

3D muss dafür nur sicherstellen, dass Reward-IDs, Placement-State und Provenienz stabil genug sind, um in 3F ohne Persistenzmigration weiterverwendet zu werden.
