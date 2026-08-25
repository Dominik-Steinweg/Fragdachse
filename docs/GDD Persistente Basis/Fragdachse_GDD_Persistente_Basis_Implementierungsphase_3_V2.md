# Fragdachse – GDD: Persistente Basis – Implementierungsphase 3

**Status:** Implementierungsbereit – V2  
**Zielgruppe:** Coding-KI / Implementierung  
**Projekt:** Fragdachse  
**Phase:** Persistente Basis – Phase 3  
**Save-Kompatibilität:** Clean Cut auf neues Progress-Schema  
**Abhängigkeiten:** Haupt-GDD Persistente Basis, Implementierungsphase 1 und 2

---

## 1. Zweck dieses Dokuments

Dieses Dokument beschreibt ausschließlich die Änderungen und Erweiterungen für **Implementierungsphase 3** der persistenten Basis.

Die in Phase 1 und 2 bereits implementierten technischen Grundlagen – insbesondere persistente Konstruktionen, anchor-relative Speicherung, Restore-Planung, Working-/Committed-State, host-authoritative Platzierung, Placement-Validierung und bestehende Construction-Systeme – sollen **nicht neu erfunden**, sondern soweit sinnvoll weiterverwendet werden.

Phase 3 macht aus dem bisherigen technischen Persistent-Base-Prototyp ein produktionsnahes Gameplay-System:

- persistente Beiträge aller Spieler statt nur hostgebundener Gastzustände,
- lokal persistierte persönliche Beiträge aller aktuell verbundenen Spieler,
- eigener Basis-Editor aus der Lobby,
- Verschieben persistenter Konstrukte,
- permanente, durch Kampagnenfortschritt freigeschaltete Basis-Belohnungen,
- Wachturm und Dachsbau als betretbare Basis-Strukturen,
- Integration der persistenten Basis ab Map 11,
- neue Item-Progression ab Map 15,
- Entfernung der technischen Maps 18 und 19.

Das Dokument ist bewusst **delta-orientiert**. Wo Phase 1/2 weiterhin gelten, werden ihre Regeln nicht erneut vollständig beschrieben.

---

# 2. Verbindliche Designentscheidungen

## 2.1 Unlock-Zeitpunkt

Die persistente Basis wird nach dem ersten Sieg auf **Map 10** freigeschaltet.

Ab diesem Zeitpunkt:

- erscheint in der Lobby **zwischen „Upgrades“ und „Items“** ein Button **„Basis“**; vor der Freischaltung wird er analog zu „Items“ sichtbar, aber locked dargestellt,
- darf der Spieler den Basis-Editor betreten,
- wird die persistente Basis ab Map 11 in produktiven Kampagnenmaps wiederhergestellt,
- beginnt die neue Basis-Belohnungsprogression.

Der Basis-Editor ist kein eigenständiger Kampagnenfortschritt und keine nummerierte Kampagnenmap.

## 2.2 Kampagnen-Belohnungen

Die Phase-3-Progression lautet:

| Sieg auf Map | Neue dauerhafte Freischaltung |
|---|---|
| 10 | Persistente Basis + Basis-Editor |
| 11 | Wachturm |
| 12 | Holy-Hand-Grenade-Podest |
| 13 | Dachsbau |
| 14 | Erweiterung des Persistent-Base-Radius |
| 15 | Item-System + Item-Drop Level 1 |
| 16 | Item-Drop Level 1 |
| 17 | Item-Drop Level 2 |

Map 18 und Map 19 werden entfernt.

Belohnungen werden **durch Missionssieg freigeschaltet**, nicht erst durch Platzierung.

Eine freigeschaltete, noch nicht platzierte permanente Basis-Belohnung bleibt erhalten und kann später im Basis-Editor platziert werden.

## 2.3 Kein starkes Redesign von Maps 11–14 in Phase 3

Maps 11–14 werden in dieser Implementierungsphase **nicht umfassend neu gestaltet**.

Bestehende Elemente bleiben grundsätzlich erhalten:

- Objective,
- Encounter-Struktur,
- Gegnerwellen,
- Map-Events,
- Secondary Objectives,
- bestehende Missionsbelohnungen,
- grundlegendes Layout,
- bestehende Power-ups.

Änderungen am authored Map-Content sind nur erlaubt, wenn sie technisch notwendig sind, um:

1. einen gültigen Persistent-Base-Anchor zu definieren,
2. die Persistent-Base-Zone konfliktfrei nutzbar zu machen,
3. zwingende Kollisionen mit authored Content zu vermeiden.

Finales Leveldesign und Balance erfolgen erst nach einem spielbaren End-to-End-Prototyp.

---

# 3. Save-Schema V4

## 3.1 Clean Cut

Die vorhandene lokale Progress-Struktur wird auf eine neue Schema-Version angehoben.

Bestehende V3-Saves müssen **nicht migriert** werden.

Bei veraltetem Schema darf der bestehende Progress sauber verworfen bzw. mit einem neuen V4-Default ersetzt werden.

Es dürfen keine parallelen alten und neuen Persistent-Base-Speicherpfade entstehen.

## 3.2 Persönlicher persistenter Basisbeitrag

Jeder Spieler besitzt einen dauerhaft lokal gespeicherten persönlichen Beitrag zur Basis.

Konzeptionell:

```ts
interface PersistentPlayerBaseContribution {
  schemaVersion: number;
  ownerId: string;
  revision: number;
  constructions: PersistentConstruction[];
}
```

`ownerId` muss geräte-/profilstabil sein und darf nicht nur aus einer temporären Room-/Peer-ID bestehen.

Falls noch keine persistente lokale Spieler-ID existiert, wird einmalig eine ID erzeugt und in den lokalen Preferences gespeichert.

### Eigenschaften

- Ein Spieler nimmt seine eigenen persistenten Konstruktionen zu anderen Hosts mit.
- Die Konstruktionen bleiben anchor-relative gespeichert.
- Ein Client darf seinen lokalen State niemals eigenmächtig als autoritativen Room-State durchsetzen.
- Der Host validiert, merged und löst Konflikte.
- Nur vom Host bestätigte Änderungen erhöhen die akzeptierte Revision.
- Clients persistieren nur bestätigte Zustände.


## 3.3 Kein Seamless Host Migration in Phase 3

Phase 3 implementiert **keinen automatischen Host-Wechsel während einer laufenden Session**.

Bei Hostverlust endet die aktuelle Netzwerk-Session. Persistente persönliche Konstruktionen bleiben ausschließlich in den jeweiligen lokalen Spieler-Saves erhalten. Ein neuer Raum wird aus dem Kampagnenstand des neuen Hosts und den persönlichen Beiträgen der aktuell verbundenen Spieler neu aufgebaut.

Es gibt **keinen Room-Recovery-Snapshot** und keinen persistierten Gesamtzustand des alten Raums.

Seamless Host Migration ist ein separates Netzwerk-Feature und ausdrücklich nicht Bestandteil dieser Phase.

---

# 4. Autorität und Merge

## 4.1 Host bleibt autoritativ

Der Host entscheidet weiterhin über:

- akzeptierte Platzierungen,
- Rückbau,
- Verschieben,
- Konfliktauflösung,
- Reward-Platzierung,
- Radius,
- Occupancy,
- Runtime-Zerstörung und Reconstruction-Cooldown,
- Mission Commit/Rollback.

Clients senden ausschließlich Requests.

## 4.2 Composite Base

Die im Raum sichtbare Basis entsteht aus:

1. authored Map-Basis / reservierter Map-Geometrie,
2. base-owned permanent rewards,
3. persönlichem Beitrag des Hosts,
4. persönlichen Beiträgen der Gäste.

Der Host erzeugt daraus einen deterministischen Composite-State.

Nur Beiträge **aktuell verbundener Spieler** werden materialisiert. Verlässt ein Spieler den Raum, verschwinden seine persönlichen Konstruktionen aus der aktiven Composite Base; sein lokaler persönlicher Blueprint bleibt unverändert erhalten und wird bei einem späteren Join erneut angeboten.

Radius und base-owned Reward-Unlocks stammen ausschließlich aus dem Kampagnenstand des aktuellen Hosts. Eigene Radius-/Reward-Unlocks eines Gastes erweitern die Host-Basis nicht.

## 4.3 Deterministische Konfliktpriorität

Bei Konflikten gilt:

1. authored / nicht verschiebbare Map-Geometrie,
2. platzierte base-owned rewards,
3. persönliche Konstruktionen des Hosts,
4. Gastbeiträge.

Gastbeiträge werden deterministisch sortiert, z. B. nach:

1. stabiler `ownerId`,
2. `placementOrder`,
3. `persistentId`.

Innerhalb eines Spielerbeitrags bleibt die bestehende Placement-Reihenfolge maßgeblich.

Ein durch Konflikt unterdrücktes Objekt wird **nicht aus dem persönlichen Save gelöscht**.

Es bleibt als ungelöster Eintrag vorhanden und wird im Basis-Editor als Konflikt angeboten.

## 4.4 Konfliktliste im Basis-Editor

Der Basis-Editor zeigt jedem Spieler ausschließlich Konflikte an, die **seinen eigenen persönlichen Beitrag** betreffen.

Die Anzeige ist rein informativ und soll kompakt zusammenfassen, welche Konstruktionstypen dieses Spielers im aktuellen Host-/Room-Setup aufgrund von Konflikten nicht materialisiert werden konnten.

Beispiel:

```text
Wegen Konflikten nicht aufgebaut:
- 7× Felsen
- 1× Fliegenpilz
```

Es werden keine Ghosts oder sonstigen Weltobjekte für diese Konstruktionen erzeugt.

Nicht materialisierte Konfliktobjekte können im Editor **nicht verschoben oder zurückgebaut werden**, da sie nicht Teil der aktuellen Spielwelt sind. Der zugrunde liegende persönliche Blueprint bleibt unverändert im lokalen Save erhalten.

Konflikte anderer Spieler werden dem lokalen Spieler nicht angezeigt.


# 5. Commit- und Rollback-Grenzen

## 5.1 Kampagnenmap

Das aus Phase 1/2 bekannte Working-/Committed-Prinzip bleibt bestehen.

Während einer Mission:

- angenommene Änderungen gehen zunächst in den Working-State,
- ein Missionssieg committed den Working-State,
- Niederlage oder Abbruch verwirft nicht bestätigte Missionsänderungen.

Dies gilt für normale persistente Konstruktionen.

## 5.2 Basis-Editor

Der Basis-Editor besitzt keinen Missions-Rollback.

Eine vom Host akzeptierte Änderung wird direkt committed und verteilt.

Das gilt für:

- Neubau,
- Rückbau,
- Verschieben,
- Platzierung einer permanenten Reward-Struktur,
- Zurücknehmen einer Reward-Struktur in den unplatzierten Zustand.

Damit ist der Editor die sichere Verwaltungsoberfläche für die Basis.

---

# 6. Basis-Editor

## 6.1 Einstieg

In der Coop-Lobby wird der Button **„Basis“** dauerhaft zwischen **„Upgrades“** und **„Items“** angezeigt.

Darstellung und Unlock-Verhalten sollen sich am bestehenden Items-Button orientieren:

- vor Freischaltung sichtbar, aber als **locked** dargestellt,
- nach Freischaltung normal verfügbar,
- Freischaltung nach Sieg auf Map 10.

Beim Öffnen:

- wechselt die laufende Arena-Darstellung in einen neutralen Basis-Editor-Modus,
- alle Spieler im Raum sehen dieselbe autoritativ aufgelöste Basis,
- es gibt keine Gegner,
- keine Mission läuft,
- es gibt keinen Kampagnenfortschritt,
- es gibt einen deutlich sichtbaren Button **„Zurück zur Lobby“**.

## 6.2 Readiness

Für den Basis-Button gilt dieselbe Ready-State-Regel wie bereits für **Upgrades** und **Items**:

- ist der lokale Spieler **not ready**, kann der Basis-Editor geöffnet werden,
- ist der lokale Spieler **ready**, ist der Basis-Button ausgegraut / nicht anklickbar.

Es wird **keine zusätzliche Editor-spezifische Ready-Logik** benötigt.

Insbesondere:

- das Öffnen des Editors setzt den Spieler nicht automatisch auf `not ready`,
- der Missionsstart muss nicht zusätzlich wegen eines aktiven Editors blockiert werden,
- stattdessen verhindert bereits die bestehende Lobby-Regel, dass ein `ready` Spieler den Editor öffnet.

## 6.3 Gemeinsame Systeme

Der Basis-Editor darf **kein zweites Bausystem** implementieren.

Er muss dieselben Systeme verwenden wie die Kampagnenmaps:

- Grid,
- Placement Preview,
- Placement-Validierung,
- Collision,
- Kapazität,
- Ownership,
- Host-Requests,
- Persistenz,
- Owner-Tint,
- Rückbau.

Nur die Laufzeitumgebung ist friedlich.

## 6.4 Baurechte

Normale Konstruktionen:

- jeder Spieler darf seine eigenen normalen persistenten Konstruktionen platzieren, verschieben oder zurückbauen,
- normale Construction-Tools bleiben an die bestehenden Klassen-/Unlock-Regeln gebunden,
- jede Mutation bleibt host-validiert.

Base-owned Rewards:

- ein aktuell verfügbarer, unplatzierter Reward darf von **jedem verbundenen Spieler** platziert werden,
- benutzen dürfen ihn alle Spieler,
- nach erfolgreicher Erstplatzierung gehört das Objekt weiterhin der **Host-Basis**, nicht dem platzierenden Client,
- nur der Host darf einen bereits platzierten base-owned Reward verschieben oder bewusst zurückbauen / in `unplaced` überführen,
- der platzierende Client schreibt dafür keinen base-owned Reward in seinen persönlichen LocalStorage.

Damit werden **Owner**, **Placer** und **Persistenzort** getrennt: Base-owned Rewards werden ausschließlich im Host-Kampagnenstand gespeichert.

---

# 7.
---

# 7. Verschieben persistenter Konstrukte

## 7.1 Allgemein

Neben den bestehenden Bau-/Rückbau-Aktionen wird eine generische **Verschieben-Aktion** eingeführt.

Sie gilt gleichermaßen:

- im Basis-Editor,
- in allen Kampagnenmaps, in denen die Persistent Base aktiv ist.

Sie muss mit allen aktuell materialisierten persistenten Konstruktionen funktionieren, sofern der lokale Spieler die nötigen Rechte besitzt.


## 7.2 Keine Implementierung als Rückbau + Neubau

Verschieben ist ein atomarer Vorgang:

```ts
repositionPersistentConstruction(
  persistentId,
  targetRelativeGridX,
  targetRelativeGridY,
  angle
)
```

Der Host validiert den Zielzustand vollständig.

Nur wenn der Zielzustand gültig ist, wird die bestehende Konstruktion umpositioniert.

Bei ungültigem Ziel bleibt die ursprüngliche Konstruktion unverändert.

Folgende Daten müssen erhalten bleiben:

- `persistentId`,
- Besitzer,
- `placementOrder`,
- Reward-Definition / Provenienz,
- sonstige persistente Metadaten.

## 7.3 Gültigkeit in Editor und Kampagnenmaps

Die generische Verschieben-Funktion gilt **überall dort, wo persistente Konstruktionen aktiv sind**:

- im Basis-Editor,
- in laufenden Persistent-Base-Kampagnenmaps.

Es soll keine getrennte Move-Implementierung für Editor und Mission geben.

Es gelten überall dieselben Grundregeln:

- host-authoritativ,
- atomare Repositionierung,
- vollständige Zielvalidierung,
- ungültiges Ziel verändert die Quelle nicht,
- `persistentId`, Owner und `placementOrder` bleiben erhalten,
- vorhandener Runtime-State wie HP und Cooldowns bleibt erhalten,
- besetzte Wachtürme/Dachsbauten dürfen nicht verschoben werden.

Im Basis-Editor wird eine akzeptierte Verschiebung sofort committed.

In einer Kampagnenmap folgt die Verschiebung dem normalen Working-/Committed-Modell:
- Sieg -> persistieren,
- Niederlage/Abbruch -> Rollback auf die Missionsbaseline.

# 8. Permanentes Reward-System

## 8.1 Definition statt Missions-Speziallogik

Permanente Basisbelohnungen werden zentral definiert.

Konzeptionell:

```ts
interface PersistentBaseRewardDefinition {
  id: string;
  constructionType: string;
  unlockAfterMapId: string;
  unique: boolean;
  footprint: { widthCells: number; heightCells: number };
  rebuildCooldownMs: number;
  runtimeDestructible: boolean;
}
```

Reward-Logik darf nicht individuell in jede Map eingebaut werden.

## 8.2 Unlock-Zustand und Placement-Zustand getrennt

Ein Reward besitzt mindestens drei logisch getrennte Zustände:

- **locked**
- **unlocked, unplaced**
- **unlocked, placed**

Ein platzierter Reward kann im Basis-Editor zurückgenommen werden.

Dadurch wird er wieder **unlocked, unplaced** und erscheint erneut im Reward-Baumenü.

Die Freischaltung selbst kann nicht verloren gehen.

## 8.3 Reward-Auswahl im Radialmenü

Freigeschaltete, aktuell unplatzierte Rewards werden in die bestehende Radial-/Build-Auswahl integriert.

Sie müssen sowohl:

- im Basis-Editor,
- als auch in laufenden Kampagnenmaps mit aktiver Persistent Base

platzierbar sein.

Die Reward-Auswahl ist klassenunabhängig: Ein verfügbarer base-owned Reward kann von jedem verbundenen Spieler platziert werden; die Platzierung bleibt host-validiert und der Reward bleibt Eigentum der Host-Basis.

Es wird **keine separate Reward-Liste als zwingende neue UI** benötigt.

Nach erfolgreicher Platzierung ist der unique Reward nicht erneut platzierbar. Nach bewusstem Rückbau durch den Host wird er ohne Cooldown sofort wieder verfügbar.


## 8.4 Runtime-Zerstörung und Reconstruction-Cooldown

Diese Regel gilt nur für **zerstörbare strukturelle base-owned Rewards** wie Wachturm und Dachsbau.

Wird ein solcher Reward in einer Kampagnenmap zerstört:

1. die Runtime-Instanz wird zerstört,
2. die persistente **Freischaltung** bleibt erhalten,
3. die bisherige Placement-Position gilt für den aktuellen Working-State als nicht mehr platziert,
4. ein **5-Sekunden-Reconstruction-Cooldown** startet,
5. der Reward bleibt während des Cooldowns im Radialmenü sichtbar, aber nicht auswählbar,
6. nach Ablauf wird er wieder auswählbar und kann von einem Spieler **neu platziert** werden.

Es erfolgt **kein automatischer Wiederaufbau an der alten Position**.

Wird der Reward bis zu einem Missionssieg nicht neu platziert, wird der Sieg mit dem Zustand `unlocked, unplaced` committed. Auf der nächsten Persistent-Base-Map ist er sofort wieder ohne Rest-Cooldown platzierbar.

Bei Niederlage oder Missionsabbruch greift der normale Rollback auf die Missionsbaseline.

Ein bewusster Rückbau durch den Host löst **keinen** Reconstruction-Cooldown aus; der Reward wird sofort wieder platzierbar.

Das **Holy-Hand-Grenade-Podest** ist hiervon ausgenommen: Es ist wie die bestehenden Power-up-Podeste nicht als Gegnerziel registriert und nicht zerstörbar.

Normale persönliche Konstruktionen folgen weiterhin ihren bisherigen Persistenz-/Zerstörungsregeln.

---

# 9. Structure Occupancy
---

# 9. Structure Occupancy

## 9.1 Gemeinsames System

Wachturm und Dachsbau verwenden ein neues generisches `StructureOccupancySystem`.

Es darf nicht direkt das bestehende `BurrowSystem` wiederverwenden, da dieses zusätzliche Mechaniken besitzt:

- Adrenalinverbrauch,
- Untergrundbewegung,
- Tunneltransit,
- Windup/Recovery,
- Exit-Schockwelle.

Wiederverwendet werden dürfen dagegen generische Player-Locks, Targeting- und Damage-Primitives.

## 9.2 Betreten

Zum Betreten einer geeigneten Struktur:

- Spieler befindet sich in Interaktionsreichweite,
- Spieler drückt **Shift**,
- Host validiert den Request.

Auswahlregel:

1. Gibt es **keine** betretbare Struktur in Reichweite, bleibt `Shift` das normale Einbuddeln.
2. Gibt es **genau eine** betretbare Struktur in Reichweite, wird diese gewählt; die Aim-Richtung spielt keine Rolle.
3. Gibt es **mehrere** betretbare Strukturen in Reichweite, entscheidet die Aim-/Mausrichtung, welche Struktur gewählt wird.
4. Bei nahezu gleicher Aim-Abweichung dient Distanz als sekundärer Tie-Breaker.
5. Ein Kontext-Hinweis zeigt vor dem Tastendruck die aktuell ausgewählte Struktur, z. B. `SHIFT – Wachturm betreten`.

Ist der Spieler bereits in einer Struktur, verlässt `Shift` diese; dafür ist keine Aim-Auswahl erforderlich.

## 9.3 Occupancy-State

Der Host verwaltet mindestens:

```ts
structureId -> occupantPlayerIds[]
playerId -> occupiedStructureId | null
```

Beim:

- Tod,
- Disconnect,
- Map-Wechsel,
- Editor-Wechsel,
- Zerstören,
- Verschieben,
- Entfernen

muss Occupancy sauber aufgelöst werden.

---

# 10. Wachturm

## 10.1 Footprint und Kapazität

Der Wachturm ist eine permanente Base-Owned-Reward-Struktur.

- Footprint: **2 × 2 Zellen**
- maximale Occupants: **4 Spieler**
- initialer Balancewert: **1.500 HP**

Alle vier Spieler dürfen gleichzeitig den Turm benutzen.

## 10.2 Gameplay

Während ein Spieler im Wachturm ist:

- Bewegung ist blockiert,
- normale Waffen dürfen verwendet werden,
- Aim bleibt erlaubt,
- Dash ist blockiert,
- andere inkompatible Movement-/Occupancy-Aktionen sind blockiert,
- der Spieler profitiert von konfigurierbaren Wachturm-Modifikatoren.

Der Spieler darf jederzeit aktiv aussteigen, sofern kein anderer harter Player-State dies verhindert.

## 10.3 Defensive Funktion

Solange ein Spieler im Wachturm sitzt:

- Gegner sollen nicht den Spieler als primäres direktes Bodenziel behandeln,
- der Wachturm übernimmt die Target-/Damage-Proxy-Rolle,
- Schaden, der logisch den Occupant treffen würde, wird nicht zusätzlich noch einmal auf den Spieler angewendet.

AoE-Schaden darf nicht pro Occupant vervielfacht auf den Turm angewendet werden.

Wird der Wachturm zerstört, während er besetzt ist, **sterben alle Occupants sofort**. Es gibt keinen sicheren Eject als Folge der Zerstörung.

## 10.4 Wachturm-Boni

Die genaue finale Balance ist nicht Teil der technischen Abnahme.

Die Architektur muss jedoch mindestens folgende Modifier unterstützen:

- Weapon Range Multiplikator,
- Adrenalin-Regeneration,
- später leicht ergänzbare weitere Waffen-/Player-Modifikatoren.

Prototype-Werte werden zentral konfiguriert und dürfen nicht über mehrere Waffenklassen verteilt hardcodiert werden.

Empfohlene Initialwerte für den ersten spielbaren Build:

```ts
watchtower.weaponRangeMultiplier = 1.25
watchtower.adrenalineRegenMultiplier = 1.50
```

Diese Werte sind explizit als Tuning-Parameter zu behandeln.

Die Wachturm-Wirkung muss als erweiterbares Modifier-/Effect-Modell aufgebaut sein. Spätere Kampagnenbelohnungen müssen zusätzliche Wachturm-Boni hinzufügen oder bestehende Werte verstärken können, ohne Wachturm-spezifische Sonderpfade in Waffenklassen einzubauen.

---

# 11. Dachsbau

## 11.1 Footprint und Kapazität

Der Dachsbau ist eine permanente Base-Owned-Reward-Struktur.

- Footprint: **1 × 1 Zelle**
- Kapazität: **gesamtes aktuelle Team**
- initialer Balancewert: **2.000 HP**

Mehrere Spieler dürfen gleichzeitig denselben Dachsbau betreten.

## 11.2 Gameplay

Während ein Spieler im Dachsbau ist:

- Bewegung blockiert,
- Waffen blockiert,
- Utility blockiert,
- Dash blockiert,
- Bauen blockiert,
- Interaktionen außer Ausstieg blockiert,
- Spieler kann keinen direkten Schaden erhalten.

Der Dachsbau ist damit ein temporärer Schutzraum, kein alternatives Bewegungssystem.

## 11.3 Enemy Target Proxy

Gegner dürfen sich nicht einfach vollständig desinteressieren, sobald Spieler im Dachsbau verschwinden.

Wenn Spieler im Dachsbau sind:

- der Dachsbau wird als gültiges relevantes Gegnerziel behandelt,
- Gegner dürfen den Bau angreifen,
- der Bau nimmt Schaden.

Dadurch entsteht ein echter defensiver Trade-off statt unbegrenzter kostenloser Unverwundbarkeit.

Wird der Dachsbau zerstört, während er besetzt ist, **sterben alle darin befindlichen Spieler sofort**. Anschließend gilt für den zerstörten Reward der normale 5-Sekunden-Reconstruction-Cooldown.

---

# 12. Holy-Hand-Grenade-Podest

Das bereits vorhandene Holy-Hand-Grenade-Power-up wird als permanentes Base-Owned-Podest unterstützt.

Freischaltung: **Sieg Map 12**

Die bestehende Power-up-/Pedestal-Logik soll soweit möglich wiederverwendet werden.

Das Podest ist – analog zu den bestehenden Power-up-Podesten – **nicht als Gegnerziel registriert und unzerstörbar**. Es besitzt daher keinen Reconstruction-Cooldown. Die Holy Hand Grenade selbst verwendet weiterhin die bestehende **30-Sekunden-Power-up-Respawnzeit**.

Der Reward definiert:

- eindeutige Reward-ID,
- eindeutige persistente Placement-ID,
- Footprint,
- Power-up `HOLY_HAND_GRENADE`,
- Respawn-Verhalten über die bestehende Power-up-Definition.

Die Reward-Persistenz darf nicht an das bestehende einmalige Missions-Placement-System gekoppelt bleiben.

Das bestehende System kann als technische Grundlage dienen, aber die neue dauerhafte Unlock-/Placement-Logik ist zentral im Persistent-Base-Reward-System abzubilden.

---

# 13. Radius-Progression

## 13.1 Radius wächst nur durch Kampagnenfortschritt

Der Radius der persistenten Basis darf sich nicht während einer Mission dynamisch vergrößern.

Die erste Erweiterung wird nach dem Sieg auf **Map 14** committed.

Das vermeidet:

- plötzlich neu gültige Bauplätze während eines Kampfes,
- unklare Rollback-Semantik,
- Unterschied zwischen Clients während derselben Mission.

## 13.2 Datenhaltung

Der aktuell freigeschaltete Radius ist Teil des autoritativen Persistent-Base-/Progress-State.

Er darf nicht aus dem aktuell geöffneten Map-Config implizit berechnet werden.

Maps definieren lediglich den Anchor und die maximal nutzbare technische Fläche.

---

# 14. Produktionsintegration Maps 11–17

## 14.1 Allgemeine Regel

Maps **11–14** verwenden die Persistent Base verpflichtend.

Ab **Map 15** ist die Persistent Base kein globaler Kampagnenstandard mehr. Jede Map entscheidet explizit per Config, ob die Heimatbasis aktiv ist. Dadurch bleiben spätere Expedition-, Boss-, Escape- oder andere Map-Typen unabhängig vom Basislayout möglich.

Für Phase 3 gilt:

- Maps 11–14: Persistent Base aktiv,
- Map 15: Persistent Base **nicht aktiv**,
- Maps 16–17: bestehendes Missionsdesign beibehalten; keine automatische Persistent-Base-Aktivierung erzwingen.

Auf Maps 11–14 wird der bestehende freundliche Hauptstützpunkt als primärer Persistent-Base-Anchor verwendet, sofern keine zwingenden technischen Gründe dagegen sprechen.

Der Anchor muss stabil und deterministisch sein.

Bereits authored Base-Geometrie bleibt höher priorisiert als Spieler-Konstruktionen.


## 14.2 Map 11 – Bombergeschwader

Bestehendes Gameplay bleibt bestehen.

Insbesondere beibehalten:

- Objective `repel-assault`,
- Airstrike-Events,
- Encounters,
- bestehende Power-ups,
- bestehende Hauptbasis.

Die vorhandene `coop-base-middle` wird als Persistent-Base-Anchor genutzt.

Sieg:

- normaler Kampagnenfortschritt,
- **Wachturm wird dauerhaft freigeschaltet**.

Item-Drops sind auf Map 11 deaktiviert.

## 14.3 Map 12 – Gegenschlag

Bestehendes Gameplay bleibt bestehen.

Insbesondere beibehalten:

- Objective `destroy-hostile-bases`,
- hostile base,
- bestehende freundliche Basen,
- Zug-/Airstrike-Events,
- bestehende Power-ups,
- bestehende Holy-Hand-Grenade als normales Map-Power-up.

Die `coop-base-rear` wird bevorzugt als Persistent-Base-Anchor genutzt.

Sieg:

- **Holy-Hand-Grenade-Podest wird dauerhaft freigeschaltet**.

Item-Drops sind auf Map 12 deaktiviert.

## 14.4 Map 13 – Brutbomben

Bestehendes Gameplay bleibt bestehen.

Insbesondere beibehalten:

- Objective `destroy-hostile-bases`,
- Spawn-Point-/Brutbomben-Strukturen,
- bestehende Persistent Spawns,
- Secondary Objective,
- **50 XP pro Secondary-Objective-Ziel**,
- BFG-Power-up.

Die `coop-base-rear` wird bevorzugt als Persistent-Base-Anchor genutzt.

Sieg:

- **Dachsbau wird dauerhaft freigeschaltet**.

Item-Drops sind auf Map 13 deaktiviert.

## 14.5 Map 14 – Brandschneise

Bestehendes Gameplay bleibt bestehen.

Insbesondere beibehalten:

- Objective `survive`,
- Void-Fire-Corridor,
- Rock-Field/Corridor-Layout,
- Encounters,
- Persistent Spawns,
- bestehende Basen.

Die `coop-base-rear` wird bevorzugt als Persistent-Base-Anchor genutzt.

Sieg:

- **Persistent-Base-Radius wird erweitert**.

Item-Drops sind auf Map 14 deaktiviert.

## 14.6 Map 15 – Leerenjäger

Map 15 bleibt in Phase 3 **ohne aktive Persistent Base**.

Die bestehende Bossmission und ihr authored Content werden grundsätzlich nicht im Rahmen von Phase 3 redesigniert.

Sieg:

- Item-System wird freigeschaltet,
- erster Item-Reward benutzt **Item-Level 1**.

Die bisherige Item-Level-3-Konfiguration von Map 15 wird entsprechend auf Level 1 geändert.


## 14.7 Map 16

Bestehendes Missionsdesign bleibt für den Phase-3-Prototyp grundsätzlich erhalten.

Die Persistent Base wird nicht automatisch aktiviert; Map 16 folgt der expliziten per-map Opt-in-Regel.

Item-Drop:

- **Item-Level 1**

Kein zusätzlicher neuer permanenter Basis-Reward ist in Phase 3 erforderlich.


## 14.8 Map 17

Bestehendes Missionsdesign bleibt für den Phase-3-Prototyp grundsätzlich erhalten.

Die Persistent Base wird nicht automatisch aktiviert; Map 17 folgt der expliziten per-map Opt-in-Regel.

Item-Drop:

- **Item-Level 2**

Kein zusätzlicher neuer permanenter Basis-Reward ist in Phase 3 erforderlich.

---

# 15. Item-System-Änderung
---

# 15. Item-System-Änderung

## 15.1 Unlock verschieben

Die bisherige Item-Freischaltung nach Map 10 wird entfernt.

Neue Regel:

```ts
COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID = '15'
```

## 15.2 Item-Drops vor Map 15

Maps 10–14 dürfen nach Phase 3 keine Item-Belohnung mehr erzeugen.

Vorhandene `itemDrop`-Config auf diesen Maps wird entfernt oder von der Reward-Auswertung eindeutig ignoriert.

Es darf nicht nur die UI versteckt werden; der Reward darf auch nicht unsichtbar erzeugt oder gespeichert werden.

## 15.3 Neue Item-Level-Kurve

Verbindlich:

```text
Map 15 -> Item-Level 1
Map 16 -> Item-Level 1
Map 17 -> Item-Level 2
```

Spätere Maps sind nicht Bestandteil dieser Phase.

---

# 16. Maps 18 und 19 entfernen

Die technischen Persistent-Base-Testmaps 18 und 19 werden aus der normalen Map-Registry entfernt.

Zu entfernen bzw. anzupassen:

- Map-JSONs,
- Imports/Registry,
- Tests mit hartem Bezug auf Map 18/19,
- Debug-/Navigationseinträge,
- eventuell vorhandene Progress-/Unlock-Annahmen.

Ihre technische Testfunktion wird ab Phase 3 durch:

- Basis-Editor,
- Maps 11–17,
- automatisierte Persistent-Base-Tests

abgedeckt.

Tests sollen nicht ersatzlos entfallen, sondern auf neutrale Test-Fixtures oder produktive Map-Anker umgestellt werden.

---

# 17. Presentation und UX

## 17.1 Ownership

Die vorhandene Owner-Tint-Logik bleibt bestehen und soll auch im Basis-Editor verwendet werden.

Die Phase-3-Implementierung darf für neue Systeme keine zweite Ownership-Darstellung erfinden.

## 17.2 Generischer Availability-/Cooldown-State im Radialmenü

Die Cooldown-Darstellung wird nicht nur für permanente Base-Rewards implementiert, sondern als **generische Radialmenü-Funktion**.

Jeder relevante Radial-Eintrag kann einen Runtime-Availability-State liefern, sinngemäß:

```ts
interface RadialAvailabilityState {
  available: boolean;
  cooldownRemainingMs: number;
  cooldownTotalMs: number;
}
```

Damit wird derselbe visuelle Mechanismus unter anderem für folgende Fälle verwendet:

- HE-Granate im Cooldown,
- sonstige Utility-/Construction-Cooldowns,
- 5-Sekunden-Reconstruction-Cooldown von Wachturm/Dachsbau,
- spätere Radial-Tools mit Cooldown.

Während eines Cooldowns:

- bleibt das Segment sichtbar,
- ist es nicht auswählbar,
- zeigt eine radiale Füllung / Maske den verbleibenden Cooldown,
- optional darf zusätzlich eine numerische Restzeit angezeigt werden.

Cooldown und andere Sperrgründe wie fehlende Kapazität / nicht erfüllbare Placement-Bedingungen bleiben logisch getrennte Availability-Ursachen.

Für base-owned Rewards muss außerdem unterscheidbar sein:

- locked,
- verfügbar/unplatziert,
- platziert,
- Reconstruction-Cooldown.


## 17.3 Prototyp-Visuals

Wachturm und Dachsbau benötigen für die technische Phase eine klar erkennbare Runtime-Darstellung.

Finale Art Assets, Shader-Polish und Detailanimationen sind **kein Blocker** für die Implementierung.

Die Presentation muss jedoch bereits:

- Footprint klar zeigen,
- Occupancy erkennbar machen,
- Damage/Destroyed-State visualisieren,
- Owner-/Base-Owned-Zugehörigkeit verständlich darstellen.

---

# 18. Netzwerkregeln

Alle neuen Mutationstypen benötigen host-authoritative Requests und bestätigte Resultate.

Mindestens:

```ts
persistentBasePlaceRequest
persistentBaseRemoveRequest
persistentBaseRepositionRequest
persistentBaseRewardPlaceRequest
persistentBaseRewardUnplaceRequest
structureEnterRequest
structureExitRequest
```

Die konkrete Key-Struktur darf sich an der bestehenden NetworkBridge-/Room-State-Architektur orientieren.

Wichtig:

- keine Mutation ausschließlich auf Client-Seite,
- Revisionen atomar aktualisieren,
- State und akzeptierte Revision niemals getrennt schreiben,
- Duplicate Requests idempotent behandeln,
- stale Revisions ablehnen oder sauber rebasen,
- Disconnect-Cleanup muss Occupancy entfernen.

---

# 19. Persistenz-Invarianten

Folgende Invarianten müssen nach Phase 3 gelten:

1. Ein persönliches persistentes Konstrukt besitzt genau einen stabilen Owner.
2. Ein persönlicher Beitrag bleibt lokal erhalten, auch wenn der Host wechselt.
3. Ein Client speichert nur Host-bestätigte Änderungen als akzeptierten Stand.
4. Ein Conflict löscht kein persistentes Objekt.
5. Base-owned Reward-Unlocks können nicht durch Runtime-Zerstörung verloren gehen.
6. Ein unique Reward kann höchstens einmal gleichzeitig platziert sein.
7. Verschieben ändert nicht die `persistentId`.
8. Editor-Mutationen committen sofort.
9. Missionsmutationen committen nur bei Sieg.
10. Radius-Freischaltungen passieren nur nach Kampagnensieg.
11. Occupancy existiert nie auf einer nicht existierenden Runtime-Struktur.
12. Nach Disconnect existiert kein verwaister Occupant.
13. Map 18/19 sind nach Abschluss nicht mehr Teil der Kampagne/Registry.
14. Item-Rewards beginnen erst auf Map 15.

---

# 20. Tests

## 20.1 Save / Schema

Tests für:

- V4-Default-State,
- V3 wird sauber verworfen,
- stabile lokale ownerId,
- Serialisierung/Deserialisierung persönlicher Beiträge.

## 20.2 Merge / Konflikte

Tests für:

- gleiche Eingaben ergeben identischen Composite-State,
- host contribution priorisiert guest contribution,
- Guest-Sortierung deterministisch,
- Konflikt löscht kein Objekt,
- Konflikte bleiben im lokalen Blueprint erhalten und werden nur dem betroffenen Spieler als Information angezeigt.

## 20.3 Editor

Tests für:

- Basis-Button ist vor Unlock sichtbar und analog zu Items locked,
- Basis-Button ist bei `ready` ausgegraut und bei `not ready` nutzbar,
- Build/Remove/Reposition committed sofort,
- ungültiges Reposition verändert Source nicht,
- Ownership-Rechte.

## 20.4 Rewards

Tests für:

- Sieg Map 11 -> Wachturm unlocked,
- Sieg Map 12 -> Holy-Hand-Podest unlocked,
- Sieg Map 13 -> Dachsbau unlocked,
- Sieg Map 14 -> Radius erweitert,
- Unlock funktioniert ohne sofortige Platzierung,
- unique Reward nicht doppelt platzierbar,
- Unplace -> wieder im Reward-Radial verfügbar,
- Runtime-Zerstörung löscht Unlock nicht,
- 5-Sekunden-Reconstruction-Cooldown,
- Reward bleibt während des Cooldowns sichtbar und gesperrt im Radialmenü,
- nach Cooldown ist manuelle Neuplatzierung möglich; kein automatischer Wiederaufbau.

## 20.5 Occupancy

Tests für:

### Wachturm
- bis zu vier Occupants,
- fünfter Eintritt abgelehnt,
- Movement blockiert,
- Weapons erlaubt,
- Modifier aktiv,
- Damage nicht doppelt,
- Zerstörung eines besetzten Wachturms tötet alle Occupants.

### Dachsbau
- gesamtes Team darf eintreten,
- Movement/Weapons/Utility/Dash blockiert,
- Occupants erhalten keinen direkten Damage,
- Gegner können Bau als Target verwenden,
- Bau kann zerstört werden,
- Zerstörung eines besetzten Dachsbaues tötet alle Occupants.

### Allgemein
- Disconnect entfernt Occupancy,
- Map-Wechsel entfernt Occupancy,
- Reposition/Unplace einer besetzten Struktur wird abgelehnt,
- Eintritt muss host-validiert sein.

## 20.6 Radialmenü-Cooldowns

Tests für:

- HE-Granate und andere bestehende Cooldown-Tools liefern den generischen Availability-State,
- Cooldown-Segment bleibt sichtbar und ist nicht auswählbar,
- radiale Restfüllung basiert auf `remaining / total`,
- Reconstruction-Cooldown nutzt denselben Mechanismus,
- fehlende Capacity und Cooldown bleiben getrennte Sperrgründe.

## 20.7 Kampagnenprogression

Tests für:

- Persistent Base Unlock nach Map 10,
- Items **nicht** nach Map 10,
- keine Item-Rewards Maps 10–14,
- Map 15 Item-Level 1,
- Map 16 Item-Level 1,
- Map 17 Item-Level 2,
- Maps 18/19 nicht registriert.

---

# 21. Empfohlene Implementierungsreihenfolge

Die Coding-KI soll die Phase möglichst in dieser Reihenfolge umsetzen:

### Schritt 1 – Datenmodell / V4
- neues Progress-Schema,
- persistente ownerId,
- persönlicher Beitrag.

### Schritt 2 – Composite Authority
- Room-State umbauen,
- Client-Beiträge hostseitig mergen,
- deterministische Konflikte,
- bestätigte Composite-States an alle Teilnehmer.

### Schritt 3 – Basis-Editor
- Lobby-Button,
- Editor-Lifecycle,
- sofortige Commits,
- Konfliktanzeige.

### Schritt 4 – Reposition
- generischer atomarer Move-Request,
- Permissions,
- Preview und Validierung.

### Schritt 5 – Permanent Reward Framework
- Reward-Definitionen,
- Unlock-State,
- radialer Placement-State,
- unique Placement,
- Unplace,
- Runtime-Zerstörung,
- Reconstruction-Cooldown mit manueller Neuplatzierung.

### Schritt 6 – Occupancy Framework
- generisches StructureOccupancySystem,
- Host-Requests,
- Player-Locks,
- Enemy Target Proxy.

### Schritt 7 – Wachturm
- 2×2,
- 4 Occupants,
- Damage Proxy,
- Range-/Adrenalin-Modifier.

### Schritt 8 – Dachsbau
- 1×1,
- Team-Kapazität,
- vollständiger Action Lock,
- Invulnerability der Occupants,
- Enemy Target Proxy.

### Schritt 9 – Holy-Hand-Podest
- vorhandene Power-up-/Pedestal-Systeme anbinden.

### Schritt 10 – Kampagnenintegration
- Unlock Map 10,
- PB-Anker Maps 11–17,
- Reward-Unlocks 11–14,
- Item-System auf Map 15 verschieben,
- Item-Level anpassen,
- Maps 18/19 entfernen.

### Schritt 11 – Tests / Regression
- neue Tests,
- vorhandene PB-Tests anpassen,
- komplette Test-Suite,
- Build.

---

# 22. Definition of Done

Phase 3 gilt als technisch abgeschlossen, wenn folgende End-to-End-Sequenz funktioniert:

1. Frischer V4-Progress.
2. Map 10 wird gewonnen.
3. In der Lobby erscheint „Basis“.
4. Spieler öffnet den Basis-Editor.
5. Inspector kann normale Konstruktionen bauen.
6. Zweiter Client kann eigene Konstruktionen bauen.
7. Beide Beiträge werden lokal auf den jeweiligen Clients gespeichert.
8. Host löst den Composite-State deterministisch auf.
9. Ein Konflikt wird ausschließlich dem betroffenen Spieler in der Konfliktliste angezeigt; das nicht materialisierte Objekt bleibt unverändert in dessen lokalem Blueprint.
10. Beide Spieler verlassen den Editor.
11. Map 11 startet mit wiederhergestellter persistenter Basis.
12. Sieg auf Map 11 schaltet Wachturm frei.
13. Wachturm kann im Editor platziert werden.
14. Map 12 stellt ihn wieder her; vier Spieler können ihn gleichzeitig benutzen.
15. Sieg auf Map 12 schaltet das Holy-Hand-Podest frei.
16. Sieg auf Map 13 schaltet den Dachsbau frei.
17. Dachsbau schützt Occupants, wird aber von Gegnern attackiert.
18. Ein zerstörter Wachturm/Dachsbau startet 5 Sekunden Reconstruction-Cooldown und kann danach über das Radialmenü neu platziert werden; besetzte Strukturen töten bei Zerstörung ihre Occupants.
19. Sieg auf Map 14 erweitert den Radius.
20. Map 15 läuft ohne Persistent Base; vor Map 15 wurden keine Items erzeugt.
21. Sieg auf Map 15 erzeugt einen Item-Level-1-Reward.
22. Map 16 verwendet Item-Level 1.
23. Map 17 verwendet Item-Level 2.
24. Maps 18 und 19 sind nicht mehr registriert.
25. Nach Host-Abbruch bleibt kein persistierter Room-Gesamtzustand zurück; ein neuer Raum wird deterministisch aus Host-Kampagnenstand und den persönlichen Beiträgen der aktuell verbundenen Spieler aufgebaut.
26. Tests und Production-Build laufen erfolgreich.

---

# 23. Nicht Bestandteil von Phase 3

Nicht implementieren:

- seamless Host Migration während einer laufenden Session,
- Room-Recovery-Snapshots / persistierte Gesamtzustände eines beendeten Raums,
- Cloud-Saves / Account-Synchronisation,
- vollständiges Auth-/Anti-Spoofing-System für Owner-IDs,
- umfassendes Redesign der Maps 11–17,
- neue Kampagnenmaps nach Map 17,
- finales Balancing der neuen Strukturen,
- finales Art-/VFX-Polishing,
- neue Reward-Strukturen über Wachturm, Holy-Hand-Podest und Dachsbau hinaus,
- vollständige Neuentwicklung des bestehenden Construction-Systems.

---

# 24. MANUELLER CONTENT-PASS NACH DER CODING-KI

> **Die folgenden Arbeiten müssen NICHT durch die Coding-KI im Rahmen der Phase-3-Implementierung erledigt werden.**
>
> Sie erfolgen erst, nachdem der technische End-to-End-Prototyp spielbar ist.

1. **Maps 11–17 spielen und manuell feinjustieren**
   - auf Maps 11–14 insbesondere Persistent-Base-Lage,
   - freie Feuerlinien für den Wachturm,
   - Gegnerdruck auf Dachsbau/Wachturm,
   - Spawnrichtungen,
   - einzelne Felsen / Engstellen,
   - Schwierigkeit und Missionsdauer.

2. **Wachturm-Balance abstimmen**
   - Range-Bonus,
   - Adrenalin-Regeneration,
   - HP,
   - Rebuild-Verhalten im realen Spielgefühl.

3. **Dachsbau-Balance abstimmen**
   - HP,
   - Gegnerpriorisierung,
   - mögliche Missbrauchssituationen,
   - sinnvolle Nutzung in Survival-/Boss-Situationen.

4. **Basis-Radius visuell und spielerisch prüfen**
   - Größe nach Map 10,
   - Größe nach Erweiterung auf Map 14,
   - ausreichend Raum für 2×2-Wachturm und weitere Konstruktionen.

5. **Optischer Feinschliff**
   - finale Wachturm-/Dachsbau-Grafik,
   - Occupancy-Feedback,
   - Cooldown-/Destroyed-Feedback,
   - Basis-Editor-Polish,
   - Animationen/VFX.

6. **Item-Kurve ab Map 18+ später festlegen**
   - Phase 3 endet bei Map 17,
   - die weitere Item-Level-Progression wird erst mit späteren Kampagnenmaps definiert.

Diese manuellen Punkte sind **kein Blocker für die technische Abnahme von Phase 3**.
