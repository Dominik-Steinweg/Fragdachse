# Fragdachse – GDD V3: Persistente Basis ab Map 16

**Status:** Konzeptstand V3  
**Scope:** Persistente Basis für die Coop-Defense-Kampagne ab Map 16  
**Spätere Erweiterung:** Vorbereitung für „From Dachs Till Dawn“, aber keine Umsetzung in diesem Vorhaben

---

## 1. Vision

Mit Abschluss von Boss 15 erhält Fragdachse eine weitere große Gameplay-Erweiterung:

> **Ab Map 16 besitzt der Host eine eigene persistente Basis, die über Maps und Spielsitzungen hinweg erhalten bleibt.**

Wie die bisherigen großen Kampagnenmeilensteine nach Boss 5, 10 und 15 soll auch dieser Abschnitt eine deutlich wahrnehmbare neue Spielebene einführen.

Ab Map 16 wird nicht mehr ausschließlich für die aktuelle Mission gebaut. Ein klar abgegrenzter Bereich der Arena bildet die langfristige Heimatbasis. Konstruktionen innerhalb dieses Bereichs können – abhängig von Ownership, Klasse, Kapazität und Missionsausgang – zukünftige Maps, Reloads und neue Räume überleben.

Der geplante Kampagnenabschnitt lautet zunächst:

**Map 16 → Map 17 → Map 18 → Map 19 → Map 20**

Ein späterer Übergang in **From Dachs Till Dawn** soll architektonisch möglich sein, gehört aber ausdrücklich nicht zur ersten Umsetzung.

Map 16 und 17 dürfen dafür umfassend überarbeitet werden. Ihre heutigen Inhalte gelten nicht als feste Einschränkung für das neue Basissystem.

---

## 2. Zentrale Designziele

Das System soll folgende Ziele gleichzeitig erreichen:

1. **Langfristiges Aufbaugefühl**  
   Die Basis entwickelt sich über mehrere Missionen hinweg weiter.

2. **Neue strategische Entscheidung**  
   Der Spieler unterscheidet zwischen temporären Feldbefestigungen und dauerhaften Basisinvestitionen.

3. **Bauen als Late-Game-System für alle Klassen**  
   Auch Nicht-Inspector-Klassen erhalten begrenzten Zugriff auf Konstruktionen.

4. **Inspector bleibt klarer Bau-Spezialist**  
   Die anderen Klassen erhalten nur einen kleinen Ausschnitt des Systems.

5. **Saubere Multiplayer-Ownership**  
   Der Host besitzt die langfristige Basis; Clients können innerhalb einer laufenden Session beitragen.

6. **Keine zweite Konstruktionssimulation**  
   Persistente Konstruktionen werden nach dem Restore wieder normale Runtime-Konstruktionen.

7. **Robuste Save- und Reward-Logik**  
   Niederlagen dürfen keinen dauerhaften Basisschaden erzeugen. Einmalige permanente Rewards dürfen nicht dupliziert oder versehentlich verloren werden.

8. **Spätere Erweiterbarkeit**  
   Basisgröße, neue Reward-Typen und ein späterer Base Editor sollen ohne grundlegenden Architekturwechsel möglich sein.

---

# 3. Grundprinzip

Persistenz wird nicht dadurch erreicht, dass Phaser-Objekte oder Arena-Systeme zwischen Maps weiterleben.

Stattdessen gilt:

```text
Arena Runtime
    ↓
Working Base State
    ↓ bei Sieg
Committed Persistent Base
    ↓
neue Arena
    ↓
Restore in normale Runtime-Systeme
```

Der bestehende Arena-Lifecycle darf weiterhin vollständig aufräumen.

Die persistente Basis liegt fachlich oberhalb des normalen Round-Lifecycles.

Nach dem Restore gibt es im Kampf keine eigene „Persistent-Turret“-Logik. Ein persistenter Turm ist danach ein normaler Turm und verwendet dieselben Systeme wie ein frisch gebauter Turm:

- PlacementSystem
- Turret-/Combat-Systeme
- Damage
- PowerUpSystem
- Energy Injector
- Flowfields
- Rendering
- Netzwerk-Snapshots
- Reparatur
- Targeting

Persistenz betrifft nur:

- Restore
- Ownership
- Checkpoint
- Save
- Mapwechsel
- Sessionwechsel

---

# 4. Die persistente Basis

Jede Map mit aktiviertem Persistent-Base-System besitzt einen festen **Base Anchor**.

Um diesen Anchor liegt die aktuell freigeschaltete **Persistent Zone**.

Diese Zone definiert:

- welche Fläche optisch zur Heimatbasis gehört,
- welche normalen Konstruktionen bei einem erfolgreichen Missionsabschluss persistent werden können,
- wo permanente Basis-Rewards platziert werden dürfen.

Die Zone ist nicht pro Map unterschiedlich groß.

Ihre Größe ist Teil des persönlichen Fortschritts des Spielers.

---

# 5. Basis-Untergrund: Kies

Die Basis soll nicht nur über ein UI-Overlay definiert werden.

Die aktive Persistent Zone erhält einen eigenen **Kies-Untergrund**.

Dafür sollen die bereits vorhandenen Kies-Sprites aus dem derzeitigen public\assets\sprites\tmp-Assetbestand verwendet und vor der Umsetzung in einen regulären Produktions-Assetpfad übernommen werden.

Der Kies-Untergrund erfüllt drei Funktionen:

1. Er zeigt auch außerhalb des Baumodus klar: **Hier ist die Basis.**
2. Er visualisiert das Wachstum der Basis.
3. Er trennt den Heimatbereich optisch von der normalen Arena.

Beispiel:

```text
Radius 5
→ kleine Kiesfläche

Radius 7
→ sichtbar größere Kiesfläche
```

Der Kies bedeckt nur die **aktuell freigeschaltete Persistent Zone**, nicht den gesamten für zukünftige Erweiterungen reservierten Bereich.

---

# 6. Kies-Rendering

Empfohlenes Rendering:

- 47Blob von Gras oder Dirt nutzen und anpassen. Ggf. vom Benutzer einen manuellen Schritt hierfür fordern
- die Kies-Grafiken darüber legen, so wie aktuell schon Moos über Gras und Dirt Blobs gelegt wird. 
- Kies sollte grundsätzlich auf technischer Ebene so ähnliche wie Gras und Dirt dargestellt werden, keine neue Technik hierfür erfinden, sondern die bestehenden Systeme nutzen

---

# 7. Persistente Zone als Spielerprogression

Die aktuelle Größe wird im persönlichen Fortschritt gespeichert:

```text
persistentBaseRadiusCells
```

Beispiel:

```text
Start:     Radius 5
später:    Radius 6
...
Maximum:   Radius 10
```

Die konkreten Unlock-Schritte bleiben Content-/Balancingparameter.

Die Zone kann später beispielsweise wachsen durch:

- Siege auf bestimmten Maps
- Boss-Meilensteine
- besondere Kampagnen-Rewards

Wichtig:

> Der Radius gehört zum Spielerfortschritt und nicht zur Map.

Wenn ein Spieler als Host Radius 7 freigeschaltet hat, verwendet jede Persistent-Base-Map dieses Spielers Radius 7.

---

# 8. Radius im Multiplayer

Jeder Spieler besitzt seinen eigenen persistenten Radius-Fortschritt.

In einem Multiplayer-Raum gilt jedoch:

> **Die aktive Basisgröße wird ausschließlich durch den Host bestimmt.**

Beispiel:

```text
Host: Radius 6
Client A: Radius 8
Client B: Radius 5
```

Aktive Zone im Raum:

```text
Radius 6
```

Gewinnt Client A später selbst als Host, verwendet seine eigene Basis weiterhin Radius 8.

Der persönliche Fortschritt eines Clients wird also nicht überschrieben, nur weil er in einer kleineren Host-Basis mitspielt.

---

# 9. Globaler Maximalradius

Für Map-Generierung und Contentplanung darf nicht der aktuelle Radius verwendet werden.

Es existiert ein globaler Maximalwert, beispielsweise:

```text
MAX_PERSISTENT_BASE_RADIUS_CELLS = 10
```

Die genaue Zahl bleibt konfigurierbar.

Alle Maps mit Persistent Base werden bereits beim Erzeugen so geplant, als könne die Basis irgendwann diesen Maximalradius erreichen.

Dadurch benötigt eine spätere Erweiterung der Zone:

- keine Anpassung alter Maps,
- keine Regeneration alter Saves,
- keine Verschiebung bestehender Konstruktionen,
- keine Migration der Weltgeometrie.

---

# 10. Sicherheitsabstand um die Basis

Um den maximal möglichen Persistent-Bereich müssen zusätzlich mindestens **2 vollständig freie Rasterfelder** garantiert werden.

Beispiel:

```text
Maximaler Basisradius: 10
Clearance:              2
--------------------------------
Generator-Reserve:     12
```

Innerhalb dieses reservierten Bereichs dürfen keine blockierenden oder dauerhaft störenden Mapobjekte erzeugt oder authored werden.

Dazu gehören insbesondere:

- Rocks
- Trees
- Gleise
- Hindernisse
- Missionsbarrieren
- Spawn-Strukturen
- hostile/friendly Outposts
- Ground-Hazards
- Void-Korridore
- sonstige persistente Mapgeometrie

Auch der Abstand zum Arenarand muss diese Reserve berücksichtigen.

---

# 11. Anzeige während des Bauens

Zusätzlich zum Kies-Untergrund wird die aktuell aktive Persistent Zone im Baumodus als Grid hervorgehoben.

Beispielsweise:

- leicht eingefärbte Rasterzellen
- dezente Umrandung
- transparente Overlay-Fläche

Die Markierung zeigt nicht den maximal möglichen Radius, sondern nur den aktuell freigeschalteten Bereich.

Dadurch versteht der Spieler sofort:

> Innerhalb dieser Zellen kann mein Bau dauerhaft zur Basis gehören.

Außerhalb:

> Dieses Objekt ist nur für die aktuelle Mission.

---

# 12. Bauen innerhalb und außerhalb der Zone

Der normale Placement-Workflow bleibt auf der gesamten zulässigen Map verfügbar.

Es gibt zwei Lebenszyklen:

## Innerhalb der Persistent Zone

```text
Persistent Build Candidate
```

Bei erfolgreichem Missionsabschluss kann das Objekt in den nächsten Basiszustand übernommen werden.

## Außerhalb der Persistent Zone

```text
Mission Build
```

Das Objekt:

- funktioniert vollständig normal,
- zählt gegen die persönliche Kapazität,
- kann repariert und zerstört werden,
- verschwindet beim Mapwechsel,
- wird nie nachträglich persistent.

---

# 13. Zeitpunkt der Persistenzentscheidung

Ob ein Objekt persistent ist, wird anhand der **aktiven Zone zum Zeitpunkt des Placements** bestimmt.

Beispiel:

- Aktueller Radius = 5
- Spieler baut direkt außerhalb auf einer späteren Radius-6-Zelle
- Mission wird gewonnen
- Danach wird Radius 6 freigeschaltet

Das bereits dort gebaute Objekt wird **nicht** nachträglich persistent.

Erst Konstruktionen, die ab einer späteren Mission tatsächlich innerhalb der dann aktiven Zone gebaut werden, können dauerhaft übernommen werden.

Dadurch bleibt das Verhalten vorhersehbar.

---

# 14. Ownership-Modell

V3 unterscheidet drei fachlich unterschiedliche Ownership-Typen.

```text
1. Host-Persistent
2. Guest-Session
3. Base-Owned Reward
```

Diese Typen besitzen bewusst unterschiedliche Persistenz- und Disconnect-Regeln.

---

# 15. Host-Persistent-Konstruktionen

Normale Konstruktionen des Hosts innerhalb der Persistent Zone.

Eigenschaften:

- gehören dem Host,
- zählen gegen die persönliche Baukapazität des Hosts,
- müssen für die aktuelle Klasse freigeschaltet sein,
- werden nur innerhalb der aktiven Persistent Zone persistent,
- werden bei Sieg committed,
- überleben Mapwechsel,
- überleben Reload,
- überleben neue Räume,
- liegen im lokalen Host-Save.

---

# 16. Guest-Session-Konstruktionen

Normale Konstruktionen eines Clients.

Eigenschaften:

- gehören dem jeweiligen Client,
- zählen gegen dessen persönliche Baukapazität,
- müssen für dessen aktuelle Klasse freigeschaltet sein,
- können innerhalb der Persistent Zone über mehrere Maps erhalten bleiben,
- gelten aber nur für die aktuelle Raum-Session,
- werden niemals in den permanenten Host-Save übernommen,
- werden nicht aus dem eigenen Client-Save in fremde Host-Basen importiert.

Beispiel:

```text
Map 16:
Client B baut einen Turm in der Basis.

Sieg.

Map 17:
Turm ist noch da.

Raum wird beendet.

Neuer Raum:
Turm ist weg.
```

Damit können Freunde gemeinsam an einer Basis arbeiten, ohne fremde Savegames dauerhaft miteinander zu verschmelzen.

---

# 17. Client verlässt den Raum

Wenn ein Client den Raum endgültig verlässt, verschwinden seine normalen Guest-Session-Konstruktionen aus der aktiven Basis.

Das gilt auch zwischen Maps.

Zu entfernen sind insbesondere:

- Rocks
- Fliegenpilztürme
- Inspector-Türme
- Mauern
- Support-Konstruktionen
- normale persönliche Podeste

Der Cleanup muss alle abhängigen Systeme berücksichtigen:

- Placement/Occupancy
- PowerUpSystem
- Energy Injector
- TargetStatus
- Rendering
- Flowfield-Invalidierung
- Turret Runtime
- Netzwerk-State

Ein kurzfristiger Netzwerkabbruch innerhalb des bestehenden Resume-/Reconnect-Fensters gilt nicht als endgültiges Verlassen.

---

# 18. Base-Owned Rewards

Besondere permanente Missionsbelohnungen bilden eine eigene Ownership-Klasse.

Typischer erster Anwendungsfall:

- besondere Power-up-Podeste

Nach erfolgreicher Platzierung gehören diese Konstruktionen:

> **der Basis des Hosts**

und nicht dem Spieler, der das Placement ausgeführt hat.

Sie sind damit weder normale Host-Konstruktionen noch Guest-Session-Konstruktionen.

---

# 19. Wer zieht einen permanenten Missionsreward?

Permanente Missionsbelohnungen werden ausschließlich anhand des **Host-Fortschritts** erzeugt.

Es gibt nicht:

```text
Reward Host
+ Reward Client A
+ Reward Client B
```

sondern:

```text
genau einen Reward für die Host-Basis
```

Ein Client bekommt durch das Mitspielen keinen dauerhaften Basisreward für seine spätere eigene Host-Basis.

Wenn derselbe Spieler später selbst Host ist und die entsprechende Reward-Mission noch nicht erfolgreich abgeschlossen hat, kann er sie für seine eigene Basis spielen.

---

# 20. Wer darf den Reward platzieren?

Die Belohnung darf durch einen berechtigten Spieler der aktuellen Session platziert werden.

Beispiel:

```text
Reward gehört Host-Basis
Client B führt Placement aus
```

Nach erfolgreicher Platzierung:

```text
placer = Client B
ownership = base-owned
persistent owner = Host-Basis
```

Der placer ist damit nur der ausführende Spieler.

Er besitzt den Reward nicht.

---

# 21. Wo dürfen permanente Rewards platziert werden?

Base-Owned Rewards dürfen ausschließlich **innerhalb der aktuell freigeschalteten Persistent Zone** gesetzt werden.

Sie dürfen deshalb frühestens ab Map 16 eingeführt werden.

Sie unterliegen weiterhin:

- Grid-Bounds
- Zellkollisionen
- Zone Validation
- normalem Placement-Check

Sie ignorieren dagegen persönliche Baukapazität.

---

# 22. Kapazität permanenter Rewards

Base-Owned Rewards verbrauchen **keine persönliche Construction Capacity**.

Grund:

Ein Client darf einen Host-Reward platzieren können, ohne dadurch dauerhaft eigene Kapazität zu verlieren.

Außerdem sind diese Rewards ein Teil der Basisprogression und kein normaler persönlicher Build.

---

# 23. Rückbau permanenter Rewards

Im ersten Wurf sind Base-Owned Rewards:

> **nicht rückbaubar**

Das gilt unabhängig davon, wer sie platziert hat.

Spätere Verwaltung kann über einen Base Editor oder eine eigene Host-Funktion ergänzt werden.

Für die erste Version gibt es keinen manuellen Rückbaupfad.

---

# 24. Zerstörbarkeit permanenter Rewards

Im ersten Wurf sind Base-Owned Rewards:

> **unzerstörbar**

Das passt insbesondere zu den zunächst vorgesehenen Power-up-Podesten.

Dadurch entsteht keine zusätzliche Regel dafür, ob ein einmaliger Reward nach Zerstörung in einer späteren gewonnenen Mission dauerhaft verloren wäre.

---

# 25. Permanente Reward-Missionen

Eine Mission mit permanentem Basisreward besitzt eine stabile Reward-/Mission-ID.

Der entscheidende Abschlusszustand lautet:

```text
Reward erfolgreich gesetzt
UND
Mission erfolgreich gewonnen
```

Nur wenn **beide Bedingungen** erfüllt sind, wird im Save markiert:

```text
permanentRewardMissionCompleted = true
```

und der Reward dauerhaft gespeichert.

---

# 26. Sieg ohne gesetzten Reward

Wenn die Map gewonnen wird, der permanente Reward aber nicht erfolgreich gesetzt wurde:

- normaler Kampagnensieg zählt,
- nächste Map kann freigeschaltet werden,
- normale XP-/Item-/Progress-Rewards können vergeben werden,
- der permanente Reward wird nicht gespeichert,
- die Reward-Mission wird für diesen Spezialstatus nicht als abgeschlossen markiert,
- die Mission darf wiederholt werden.

Der Spieler muss sie erneut erfolgreich spielen und den Reward in diesem erfolgreichen Versuch setzen.

---

# 27. Reward gesetzt, Map danach verloren

Wenn der Reward während der Map gesetzt wird, die Map anschließend aber verloren geht:

- Reward wird nicht dauerhaft gespeichert,
- Reward-Abschlussstatus wird nicht gespeichert,
- Working State wird verworfen,
- Mission bleibt wiederholbar.

Es gilt der normale Rollback.

---

# 28. Reward gesetzt + Map gewonnen

Nur dieser Fall erzeugt:

1. Base-Owned Reward im persistenten Host-Save
2. `completedPermanentRewardMissionId`
3. Replay-Sperre dieser Reward-Mission

Diese Operation sollte fachlich atomar behandelt werden.

---

# 29. Replay-Sperre permanenter Reward-Missionen

Wenn der Host den permanenten Reward einer Mission bereits erfolgreich committed hat, darf diese Mission nicht erneut gestartet werden.

Die Map läuft dann also ohne diese Mission ab, oder es gibt keine Belohnung für die Mission. Diese Entscheidung sollte während der Implementierung getroffen werden.

---

# 30. Working State und Committed State

Die Basis besitzt zwei Zustände:

```text
Committed Base
      ↓
Working Base
```

## Missionsstart

Die aktuelle Committed Base wird geladen.

Für die aktive Mission entsteht daraus eine Working Copy.

Session-Konstruktionen verbundener Clients werden ebenfalls in den Working State übernommen.

---

# 31. Änderungen während einer Mission

Alle Änderungen betreffen zunächst nur den Working State.

Dazu gehören:

- neue Konstruktionen
- Rückbau
- Zerstörung
- neue Guest-Konstruktionen
- Platzierung von Base-Owned Rewards

Kein normaler Runtime-Schaden schreibt sofort in localStorage.

---

# 32. Sieg

Bei Sieg:

### Host-Persistent
Aktueller gültiger Zustand innerhalb der Persistent Zone wird committed.

### Guest-Session
Aktueller Zustand wird als Session-Checkpoint für die nächste Map behalten, aber nicht in Host-localStorage geschrieben.

### Base-Owned Rewards
Werden nur committed, wenn die zugehörige Reward-Regel erfüllt ist.

### HP
Nicht als Verschleißzustand gespeichert.

---

# 33. Niederlage

Bei Niederlage:

```text
Working Base verwerfen
```

Danach gilt wieder der Baseline-Zustand vor Beginn der Mission.

Keine dauerhafte Bestrafung durch:

- zerstörte Türme
- zerstörte Mauern
- Rückbau
- verlorene neue Konstruktionen
- gesetzte, aber nicht erfolgreich abgeschlossene Rewards

---

# 34. HP-Regeln zwischen Missionen

Persistiert werden Layout und Aufbau, nicht der Verschleiß.

Bei jeder neuen Mission starten:

- Hauptbasis mit 100 % HP
- normale persistente Konstruktionen mit 100 % HP
- Guest-Session-Konstruktionen mit 100 % HP
- alle reparierbaren Elemente vollständig repariert

Damit bleibt das Balancing jeder Map unabhängig vom Schadensverlauf der vorherigen Mission.

---

# 35. Power-up-Podeste

Persistente Podeste bestehen technisch aus zwei Teilen:

```text
PlacementSystem-Konstrukt
+
PowerUpSystem-Runtime
```

Beim Restore:

1. physisches Konstrukt materialisieren
2. PowerUpSystem normal registrieren
3. neuen Respawn-Zyklus starten

Nicht gespeichert werden:

- aktuell vorhandenes Power-up
- Restzeit des Respawns

Neue Mission:

```text
Podest leer
→ normaler neuer Respawn-Timer
```

---

# 36. Bauen für alle Klassen

Ab Einführung der Persistent Base erhalten alle Klassen einen begrenzten Zugriff auf das Bausystem.

Der Inspector bleibt jedoch klar der Spezialist.

---

# 37. Nicht-Inspector-Klassen

Vorgesehener Basisscope:

- Rock Barrier
- Fliegenpilzturm
- genau ein ausgewähltes Construction Utility
- eingeschränkte Basiskapazität

Die konkrete Utility-Auswahl erfolgt weiterhin über den normalen Loadout-/Utility-Slot.

Beispiel:

```text
Rock Barrier
ODER
Fliegenpilzturm
```

Nicht-Inspector-Klassen erhalten keinen vollständigen Inspector-Konstruktionsbaum.

---

# 38. Basis-Kapazität

Die persönliche Basiskapazität wird klassenabhängig.

Vorgesehener Startwert:

```text
Nicht-Inspector: 30
Inspector:       100
```

Diese Werte sind **Basiskapazitäten**, keine Hardcaps.

Es gilt:

```text
persönliche Max Capacity
=
Klassen-Basiskapazität
+
generische construction.capacity Boni
```

Beispiel:

```text
Dachs Nukem:
30 + 10 Item-Bonus = 40

Inspector:
100 + 10 Item-Bonus = 110
```

Host, Client Preview, HUD und Placement Validation müssen immer dieselbe Kapazitätsauflösung verwenden.

---

# 39. Nur freigeschaltete Konstruktionen

Ein Spieler darf ausschließlich Konstruktionen verwenden, die für seinen aktuellen Fortschritt und seine aktuelle Klasse freigeschaltet sind.

Das gilt sowohl für:

- neue Placements
- Restore persistenter Konstruktionen

Ein Save darf also nicht verwendet werden, um aktuell gesperrte Konstruktionstypen zu materialisieren.

---

# 40. Klassenwechsel und persistenter Blueprint

Ein Host kann als Inspector eine größere Basis bauen und später mit einer anderen Klasse spielen.

Beispiel:

```text
Inspector Blueprint: 80 / 100
Nächste Mission als Dachs Nukem
Kapazität: 30
```

Der vollständige Blueprint bleibt gespeichert.

Es werden jedoch nur Konstruktionen materialisiert, die:

1. für die aktuelle Klasse/für den aktuellen Fortschritt erlaubt sind,
2. innerhalb der aktuellen Persistent Zone liegen,
3. zusammen die aktuelle persönliche Capacity nicht überschreiten.

Der Rest bleibt **inaktiv im Save**, wird aber nicht gelöscht.

---

# 41. Auswahl bei zu großem Blueprint

Damit Restore deterministisch bleibt, benötigt der Blueprint eine stabile Aktivierungsreihenfolge.

Empfohlen wird ein persistiertes:

```text
placementOrder
```

bzw. eine stabile Sortierreihenfolge.

Restore:

```text
sortiere aktive Kandidaten deterministisch
→ materialisiere solange Capacity verfügbar ist
→ Rest bleibt dormant
```

Dadurch ist das Ergebnis auf jedem Reload reproduzierbar.

Später kann ein Base Editor erlauben, explizit auszuwählen, welche Konstruktionen aktiv sein sollen.

---

# 42. Gesperrte Konstrukte im Save

Wird ein gespeichertes Konstrukt durch Klassenwechsel oder Progression aktuell unzulässig:

- nicht materialisieren
- nicht löschen
- nicht gegen Capacity zählen
- im Save erhalten

Wenn der Spieler später wieder eine geeignete Klasse verwendet, kann es erneut aktiv werden.

---

# 43. Utility-Rad für alle bauenden Klassen

Das heutige Inspector-Rad soll fachlich zu einem allgemeinen **Construction Tool Radial** werden.

Es darf kein zweites Radialsystem entstehen.

---

# 44. Wann wird das Rad verwendet?

Normale Nicht-Bau-Utilities funktionieren unverändert.

Beispiel:

```text
Molotov
→ normales Utility-Verhalten
```

Wenn das ausgewählte Utility dagegen ein Construction Tool ist:

```text
Rock Barrier
→ Construction Radial verfügbar
```

Das Rad enthält bei einer Nicht-Inspector-Klasse beispielsweise:

```text
Rock Barrier
Rückbau
```

oder:

```text
Fliegenpilzturm
Rückbau
```

---

# 45. Rückbau für Nicht-Inspector-Klassen

Sobald eine Klasse ein Construction Utility ausgewählt hat, erhält sie über dasselbe Rad Zugriff auf Rückbau.

Rückbau soll kein Inspector-Sonderrecht bleiben.

Das vorhandene Tool-/Dismantle-Konzept wird generalisiert.

---

# 46. Inspector

Der Inspector behält seine klare Spezialisierung:

- größere Basis-Capacity
- mehrere Construction-Slots
- spezialisierte Türme
- Support-Konstruktionen
- Power-up-Podeste
- Construction-Upgrades
- Repair-/Support-Synergien

Die anderen Klassen erhalten nur einen kleinen, bewusst eingeschränkten Teil dieses Systems.

---

# 47. Kein zweites Placement-System

Alle Klassen verwenden denselben:

- PlacementSystem-Pfad
- Grid-Check
- Capacity-Check
- Ownership-Pfad
- Netzwerk-Request
- Rückbaupfad
- Placement Preview

Die Klassenunterschiede werden ausschließlich über:

- Tool-Verfügbarkeit
- Unlocks
- Basiskapazität
- Loadout
- Upgrades

definiert.

---

# 48. Multiplayer-Authorität

Grundregel:

> Der Host entscheidet über jede Gameplay-relevante Platzierung.

Clients besitzen nur Preview und Request.

---

# 49. Normales Placement

Ablauf:

```text
Client Preview
    ↓
Placement Request
    ↓
Host Validation
    ↓
Host akzeptiert oder lehnt ab
    ↓
authoritative Runtime-State
    ↓
Replikation an Clients
```

Die lokale grüne Placement-Vorschau garantiert nicht, dass der Request später noch gültig ist.

---

# 50. Gleichzeitiger Zellkonflikt

Beispiel:

```text
Client A → Zelle 24/18
Client B → Zelle 24/18
```

Beide können lokal zunächst eine gültige Preview sehen.

Der Host verarbeitet Requests atomar.

Regel:

> **First successfully accepted wins.**

Ablauf:

```text
Request A
→ Zelle frei
→ Host baut A

Request B
→ Zelle inzwischen belegt
→ Host lehnt B ab
```

Client B verliert:

- keine Capacity
- keinen Reward
- keinen persistenten Zustand

---

# 51. Konflikte mit permanenten Rewards

Ein Reward wird erst verbraucht, wenn das gesamte Placement erfolgreich abgeschlossen wurde.

Dazu gehört mindestens:

```text
PlacementSystem erfolgreich
+
ggf. PowerUpSystem-Registrierung erfolgreich
```

Wenn die Zielzelle inzwischen belegt ist:

- Placement schlägt fehl
- Reward bleibt verfügbar
- Mission kann fortgesetzt werden

---

# 52. Konfliktprioritäten beim Restore

Empfohlene Priorität:

1. authored Hauptbasis
2. Base-Owned Rewards
3. normale committed Host-Konstruktionen
4. Guest-Session-Konstruktionen
5. neue Runtime-Placements

Ein persistentes Objekt wird nicht automatisch verschoben, um für ein späteres Objekt Platz zu schaffen.

---

# 53. Konflikte mit Mapgeometrie

Sie sollen konstruktiv ausgeschlossen werden.

Da jede Persistent-Base-Map:

```text
MAX_RADIUS + 2 Clearance
```

reserviert, darf ein gültiges gespeichertes Objekt nicht mit neu generierter Weltgeometrie kollidieren.

Passiert es trotzdem:

- Objekt nicht materialisieren
- diagnostisch melden
- nicht automatisch verschieben

Dies gilt als Content-/Save-/Schema-Problem.

---

# 54. LocalStorage-Modell

Die persistente Basis wird Bestandteil der bestehenden zentralen Progress-Persistenz.

Sinngemäß:

```text
coopDefense
├─ ...
└─ persistentBase
   ├─ schemaVersion
   ├─ radiusCells
   ├─ revision
   ├─ constructions[]
   ├─ baseOwnedRewards[]
   └─ completedPermanentRewardMissionIds[]
```

Die genaue Einbettung kann an den bestehenden Save-Vertrag angepasst werden.

---

# 55. Persistent Construction

Ein normaler persistenter Eintrag benötigt nur stabilen Zustand.

Sinngemäß:

```text
persistentId
toolType
constructionId / utilityId
relativeGridX
relativeGridY
angle
placementOrder
```

Nicht dauerhaft speichern:

- Runtime Entity ID
- current HP
- aktuelles Target
- Cooldowns
- temporäre Buffs
- VFX-State
- Power-up Respawn Restzeit

---

# 56. Base-Owned Reward State

Zusätzliche Felder:

```text
persistentId
rewardDefinitionId
rewardSourceMissionId
relativeGridX
relativeGridY
angle
```

Optional kann intern zusätzlich eine Reward-Version geführt werden.

---

# 57. Relative Koordinaten

Persistente Positionen werden relativ zum Base Anchor gespeichert:

```text
world cell
=
base anchor
+
relative grid position
```

Dadurch darf sich die absolute Basisposition zwischen Maps ändern.

Map 16, 17 und später Endless müssen nicht dieselbe Arenaabmessung besitzen.

---

# 58. Save-Validierung

Beim Laden muss der Host jeden persistenten Eintrag validieren.

Mindestens:

- gültiges Schema
- bekannte Tool-/Construction-ID
- gültige relative Position
- innerhalb des globalen Maximalradius
- innerhalb der aktuell aktiven Zone, wenn das Objekt aktiv werden soll
- gültige Rotation
- keine doppelte Persistent-ID
- keine Zellkollision
- Konstruktion für aktuelle Klasse freigeschaltet
- persönliche Capacity nicht überschritten
- technische Payload-Limits eingehalten

LocalStorage ist eine Datenquelle, keine Gameplay-Authorität.

---

# 59. Radiusverkleinerung / inkonsistente Saves

Das normale Design sieht vor, dass der Radius wächst.

Sollte ein Save dennoch Konstruktionen außerhalb des aktuell verfügbaren Radius enthalten:

- nicht materialisieren
- im Save behalten
- nicht löschen

Damit bleibt der Blueprint robust gegenüber späteren Progressionsänderungen oder Migrationen.

---

# 60. Host-Persistenz und Clients

In einem Raum existiert genau **eine langfristige Basis**:

> die Basis des Hosts.

Clients schicken keinen eigenen Persistent-Base-Save an den Host.

Sie erhalten den vom Host autoritativ materialisierten Basiszustand über die normale Arena-Replikation.

Damit wird kein permanenter Base-Save mehrerer Spieler miteinander gemerged.

---

# 61. Mapwechsel innerhalb desselben Raums

Beim Übergang von einer Persistent-Base-Map zur nächsten:

```text
Working Session State
→ Snapshot
→ alte Arena vollständig abbauen
→ neue Arena bauen
→ Persistent Base restaurieren
```

Dabei werden:

- committed Host-Bauten
- aktive Guest-Session-Bauten
- Base-Owned Rewards

neu in die normalen Runtime-Systeme materialisiert.

Es werden keine alten Phaser-Objekte weiterverwendet.

---

# 62. Neuer Raum / Reload

Beim neuen Raum:

- Host lädt seinen permanenten Save
- Base-Owned Rewards werden geladen
- Guest-Session-Konstruktionen existieren nicht mehr

Beim Reload innerhalb einer Host-Session gilt dasselbe, sofern kein spezieller Session-Reconnect-Zustand separat erhalten wird.

Die langfristige Wahrheit ist immer der Host-Save.

---

# 63. Permanente Rewards und frühester Einsatz

Da Base-Owned Rewards ausschließlich innerhalb der Persistent Zone gesetzt werden dürfen:

> Permanente Basis-Rewards dürfen frühestens ab Map 16 existieren.

Frühere Maps bleiben vollständig unabhängig vom Basissystem.

---

# 64. Map 16 – Systemeinführung

Map 16 ist die offizielle Einführung des Persistent-Base-Systems.

Sie soll daher gegenüber ihrem heutigen Platzhalterzustand überarbeitet werden.

Ziele:

1. neue Basis sofort erkennbar machen
2. Kies-Untergrund zeigen
3. Persistent Zone verständlich machen
4. Spieler mit begrenztem Zeitdruck erste Bauten setzen lassen
5. Unterschied zwischen Persistent Build und Mission Build vermitteln
6. auch Nicht-Inspector-Spielern das neue begrenzte Bausystem zeigen

Die Einführung soll bevorzugt über Gameplay und klare visuelle Hinweise erfolgen, nicht über ein langes Texttutorial.

---

# 65. Map 17 – erster echter Restore-Moment

Map 17 soll die Mechanik erstmals selbstverständlich voraussetzen.

Der wichtigste Erlebniswert:

> Die auf Map 16 errichtete Basis ist wieder da.

Map 17 darf dafür ebenfalls stark überarbeitet werden.

Sie soll zeigen:

- persistenter Host-Aufbau
- ggf. Session-Aufbau von Mitspielern
- neue Map rund um denselben Basiskern
- temporäre Außenbefestigungen bleiben sinnvoll

---

# 66. Map 18 und 19 als temporäre Integrationsmaps

Während der technischen Umsetzung werden Map 18 und Map 19 bewusst als **kleine Testmaps** verwendet.

Sie müssen in dieser Phase keinen finalen Kampagneninhalt besitzen.

Zweck:

> Jede Implementierungsstufe im echten Spiel validieren, bevor Map 16/17 und spätere Produktionsinhalte vollständig darauf aufgebaut werden.

---

# 67. Temporäre Map 18

Sehr einfache Testarena.

Empfohlen:

- zentrale Persistent Base
- wenig oder keine zufällige Geometrie
- kurze Mission
- keine komplizierten Objectives
- keine komplexen Encounter

Tests:

- Kies-Untergrund
- aktuelle Zone
- Build inside/outside
- Host Persistence
- Kapazität
- Klassen
- Unlock-Gates
- Utility-Rad
- Rückbau

---

# 68. Temporäre Map 19

Ebenfalls sehr einfach.

Hauptzweck:

> echter Restore nach einem Mapwechsel.

Tests:

- Map 18 → Map 19
- Host-Bauten
- Guest-Session-Bauten
- volle Reparatur
- Power-up-Podeste
- Basisradius
- Capacity
- Ownership
- Disconnect
- Conflict Handling
- Reward-Restore

---

# 69. Rückbau der temporären Testmaps

Mit der letzten Implementierungsphase werden die technischen Testinhalte von Map 18 und 19 wieder entfernt.

Danach können beide Maps wieder als normale Kampagnenmaps ausgearbeitet werden.

Die temporären Debug-/Integrationsinhalte dürfen nicht versehentlich Teil des finalen Game Designs bleiben.

---

# 70. From Dachs Till Dawn

From Dachs Till Dawn ist aktuell nur eine spätere Vision.

Die aktuelle Umsetzung enthält daher:

- keinen Endless-Loop
- keine Endless-Waves
- keine Endless-Checkpoint-Regeln
- kein Endless-spezifisches Save-Modell

Die Persistent-Base-Architektur darf jedoch keine Annahmen enthalten wie:

```text
mapId <= 20
```

Stattdessen sollte eine Map lediglich markieren können:

```text
supportsPersistentBase = true
```

bzw. einem Persistent-Base-Kontext zugeordnet werden.

Ein späterer Endless-Modus soll dadurch dieselben Komponenten wiederverwenden können:

- Save
- Restore
- Base Anchor
- Zone
- Kies
- Placement
- Ownership
- Rewards

---

# 71. Spätere Vision: Base Editor aus der Lobby

Nicht Teil dieser Umsetzung, aber architektonisch vorzusehen.

Der Host kann später aus der Lobby einen speziellen Base Edit Mode öffnen.

Dieser verwendet eine Minimal-Map mit:

- eigener Basis
- Kiesfläche
- aktueller Persistent Zone
- gespeichertem Blueprint
- normalem Construction-Rad
- Rückbau
- Placement
- keine Gegner
- kein Zeitdruck

Wichtig:

> Kein separates Editor-Bausystem.

Der Editor muss dieselben Runtime- und Validierungssysteme verwenden wie die normalen Maps.

---

# 72. Technisches Zielbild

Empfohlene grobe Verantwortungsverteilung:

```text
localPreferences
      │
      ▼
PersistentBaseRepository
      │
      ▼
CommittedPersistentBaseState
      │
      ▼
PersistentBaseSession
      │
      ├── Restore Planner
      ├── Capacity / Unlock Validation
      ├── Ownership
      ├── Reward State
      └── Working State
      │
      ▼
PlacementSystem / PowerUpSystem
      │
      ▼
normale Arena Runtime
```

---

# 73. PersistentBaseRepository

Verantwortlich für:

- Lesen des lokalen Host-Saves
- Schreiben eines erfolgreichen Commit
- Schema-Validierung
- Clone/Serialization
- keine Runtime-Gameplaylogik

---

# 74. PersistentBaseSession

Hostseitiger Zustand der aktuellen Raum-/Missionsfolge.

Verantwortlich für:

- Committed Baseline
- Working Copy
- Guest-Session State
- Victory Commit
- Defeat Rollback
- Restore
- Owner Leave
- Reward Ownership
- Mapwechsel

---

# 75. Restore Planner / Validator

Verantwortlich für:

- aktuelle Zone
- aktuelle Klasse
- Unlocks
- persönliche Capacity
- stabile Aktivierungsreihenfolge
- Zellkollisionen
- Reward-Priorität
- Dormant-Einträge

Der Planner erzeugt aus einem gespeicherten Blueprint den tatsächlich aktiven Runtime-Bestand.

---

# 76. Construction-Radial-Generalisierung

Das heutige Inspector-Rad soll technisch entkoppelt werden von:

```text
classId === inspector_gadachs
```

und stattdessen davon abhängen:

```text
hat Spieler aktuell Construction Tools?
```

Dadurch bleibt eine gemeinsame Codebasis erhalten.

Mögliche fachliche Umbenennung:

```text
InspectorToolRadialMenu
→ ConstructionToolRadialMenu
```

Nicht zwingend erforderlich, aber langfristig sauberer.

---

# 77. Implementierungsphase 1 – Persistent Base Foundation

## Ziel

Die persistente Host-Basis funktioniert lokal, über Mapwechsel und Reload.

## Scope

### Datenmodell

Einführen:

- PersistentBaseState
- PersistentConstruction
- PersistentBaseRepository
- persistentBaseRadiusCells
- schemaVersion
- revision
- placementOrder

### Map-Konfiguration

Persistent-Base-Unterstützung und Base Anchor.

### Generator

Reservieren:

```text
MAX_PERSISTENT_BASE_RADIUS
+
2 Zellen Clearance
```

### Darstellung

- Kies-Untergrund
- aktuelle Persistent Zone
- Grid-Overlay im Baumodus

### Lifecycle

- Working Base
- Committed Base
- Victory Commit
- Defeat Rollback
- vollständige Reparatur beim Restore

### Restore

Normale Konstruktionen wieder über bestehende Runtime-Systeme erzeugen.

### Capacity/Unlock

Bereits in Phase 1 berücksichtigen:

- nur freigeschaltete Konstruktionen
- nur bis aktuelle Capacity
- Rest dormant

### Testmaps

Map 18 und 19 temporär vereinfachen.

## Abnahmekriterien

- Host baut auf Map 18 innerhalb Zone.
- Sieg.
- Map 19 lädt Konstrukt.
- HP ist voll.
- Reload erhält Konstrukt.
- neuer Raum erhält Konstrukt.
- Objekt außerhalb Zone wird nicht persistent.
- späterer Radius-Upgrade macht alte Außenbauten nicht rückwirkend persistent.
- Save außerhalb aktuellen Radius bleibt erhalten, aber dormant.
- zu großer Blueprint wird deterministisch nur bis Capacity materialisiert.
- gesperrte Konstrukte werden nicht materialisiert.
- ungültiger Save verursacht keinen Crash.

---

# 78. Implementierungsphase 2 – Shared Building, Klassen & Multiplayer

## Ziel

Alle Klassen und mehrere Spieler arbeiten korrekt an derselben Host-Basis.

## Scope

### Klassenkapazität

Einführen:

```text
getBaseConstructionCapacity(classId, bonus)
```

Vorgabe:

```text
Nicht-Inspector: 30 + Boni
Inspector:       100 + Boni
```

### Nicht-Inspector-Bauen

Mindestens:

- Rock Barrier
- Fliegenpilzturm
- ein Construction Utility gleichzeitig

### Radialmenü

Generalisiertes Construction Tool Radial.

### Rückbau

Für alle Klassen mit aktivem Construction Utility.

### Ownership

Saubere Typen:

```text
host-persistent
guest-session
base-owned
```

### Guest Session

- Bauten bleiben über Mapwechsel im selben Raum.
- Bei endgültigem Leave entfernen.
- Nicht in Host-localStorage übernehmen.

### Konflikte

Hostautoritative atomare Zellvergabe:

```text
first successfully accepted wins
```

### Reconnect

Bestehenden Resume-Lifecycle respektieren.

## Tests auf Map 18/19

Mindestens:

- Host + ein Client
- Host + mehrere Clients
- gleiche Zielzelle gleichzeitig
- Client Leave
- Client Reconnect
- Dachs Nukem mit Building Utility
- Dachs of Steel mit Building Utility
- Inspector
- 30/100 Capacity + Boni
- Unlock-Gates
- Rückbau
- Mapwechsel mit Guest-Bauten
- neuer Raum ohne Guest-Bauten

---

# 79. Implementierungsphase 3 – Permanente Rewards & Kampagnenintegration

## Ziel

Das technische Basissystem wird vollständig in die Kampagne integriert.

## Scope

### Base-Owned Rewards

Einführen:

- rewardDefinitionId
- rewardSourceMissionId
- persistent base ownership
- unzerstörbar
- nicht rückbaubar
- keine persönliche Capacity

### Reward Flow

```text
Reward erzeugt
→ innerhalb Zone platziert
→ Mission gewonnen
→ atomarer Commit
```

### Replay-Regel

Nur:

```text
Reward gesetzt + Mission gewonnen
```

sperrt die permanente Reward-Mission.

### Sieg ohne Reward

Normaler Kampagnenfortschritt kann weiterlaufen; Reward-Mission bleibt erneut spielbar.

### Reward gesetzt + Niederlage

Rollback; keine Sperre.

### Map 16

Zur echten Systemeinführung umbauen.

### Map 17

Zum ersten echten Restore-Erlebnis umbauen.

### Map 18/19

Temporäre technische Testinhalte wieder entfernen.

Danach können Map 18/19 als reguläre Kampagnenmaps ausgearbeitet werden.

---

# 80. Globale Abnahmetests

## Persistenz

```text
Host baut
→ Sieg
→ Mapwechsel
→ Reload
→ neuer Raum
```

Objekt bleibt erhalten.

---

## Mission Build

```text
Host baut außerhalb Zone
→ Sieg
→ Mapwechsel
```

Objekt ist weg.

---

## Zone Upgrade

```text
Radius 5
→ temporäres Objekt auf späterer Radius-6-Zelle
→ Sieg
→ Radius 6
```

Altes Objekt ist nicht persistent geworden.

---

## Rollback

```text
Committed Turm vorhanden
→ Mission
→ Turm zerstört
→ Niederlage
```

Nächster Versuch startet wieder mit Turm.

---

## Sieg nach Zerstörung

```text
Committed Turm vorhanden
→ Mission
→ Turm zerstört
→ Sieg
```

Turm ist dauerhaft verloren.

---

## Klassenwechsel

```text
Inspector: 80 Capacity gespeichert
→ nächste Mission Nukem: 30 Capacity
```

Nur zulässiger deterministischer Teil wird aktiv.

Rest bleibt im Save.

---

## Unlock-Wechsel

Gespeichertes Konstrukt ist aktuell nicht freigeschaltet.

Ergebnis:

- nicht aktiv
- nicht gelöscht

---

## Guest-Session

```text
Client baut
→ Sieg
→ nächste Map
```

Bau bleibt.

```text
Client verlässt Raum
```

Bau verschwindet.

---

## Neuer Raum

Guest-Session-Bauten des vorherigen Raums existieren nicht.

---

## Konflikt

Zwei Clients bauen gleichzeitig auf dieselbe Zelle.

Ergebnis:

```text
genau ein Konstrukt
```

---

## Permanent Reward

```text
Client setzt Host-Reward
→ Mission gewonnen
```

Reward:

- base-owned
- Host-Save
- neuer Raum: vorhanden

---

## Reward + Disconnect

Client setzt Reward, danach verlässt er den Raum.

Reward bleibt, weil er base-owned ist.

---

## Reward ohne Sieg

Reward gesetzt, Mission verloren.

Ergebnis:

- Reward nicht gespeichert
- Mission nicht permanent abgeschlossen
- Mission wiederholbar

---

## Sieg ohne Reward

Mission gewonnen, Reward nicht gesetzt.

Ergebnis:

- normaler Kampagnenfortschritt möglich
- permanenter Reward nicht gespeichert
- Reward-Mission wiederholbar

---

## Reward vollständig abgeschlossen

Reward gesetzt und Mission gewonnen.

Ergebnis:

- Reward gespeichert
- Permanent-Reward-Mission gesperrt
- Reward nicht zerstörbar
- Reward nicht rückbaubar

---

# 81. Bewusst nicht Bestandteil des ersten Vorhabens

Nicht Teil der drei Implementierungsphasen:

- From Dachs Till Dawn selbst
- Lobby Base Editor
- freie Verschiebung gespeicherter Konstruktionen
- komplexes Blueprint-UI
- persistente HP
- persistente Cooldowns
- persistente Power-up-Timer
- Cloud Save
- Server-Datenbank
- Save-Merge mehrerer Spielerbasen
- automatisches Verschieben kollidierender Konstruktionen
- komplexe Basiskosmetik
- separate Basisressource
- eigener Persistent-Construction-Runtime-Typ

---

# 82. Architekturgrundsätze

## Eine langfristige Basis pro Raum

Die permanente Basis gehört dem Host.

## Clients helfen nur innerhalb der Session

Normale Client-Bauten werden nicht in den Host-Save übernommen.

## Rewards gehören der Basis

Nicht dem Spieler, der sie gesetzt hat.

## Permanenter Reward ist ein Commit-Ergebnis

Nur Reward-Platzierung plus Missionssieg macht ihn dauerhaft.

## Zone ist Progression

Nicht Mapparameter.

## Generator plant für das Maximum

Nicht für den aktuellen Radius.

## Zwei Zellen Clearance sind garantiert

Um den maximalen Basisbereich.

## Kies zeigt die echte Basisfläche

Das Grid-Overlay ist nur zusätzliches Baufeedback.

## Bauen ist für alle Klassen möglich

Aber Inspector bleibt mit Abstand der Spezialist.

## Capacity ist klassenabhängig

30 bzw. 100 sind Basiswerte; generische Boni kommen hinzu.

## Nur freigeschaltete Konstrukte sind aktiv

Ein Save umgeht keine Unlocks.

## Blueprint darf größer sein als die aktuelle Klasse

Überzählige oder gesperrte Einträge bleiben dormant im Save.

## Host entscheidet

Client Preview ist UX, Host Validation ist Gameplay-Wahrheit.

## Sieg committed

Niederlage rollt zurück.

## Keine zweite Simulation

Restore erzeugt normale bestehende Runtime-Konstruktionen.

---

# 83. Zielzustand

Ab Map 16 verändert sich Fragdachse von:

> „Ich baue etwas für diese Mission.“

zu:

> **„Ich entwickle meine eigene Festung weiter und nehme sie mit.“**

Der Host besitzt eine langfristig gespeicherte Basis.

Die Basis:

- hat einen sichtbaren Kies-Untergrund,
- wächst über einen persistent gespeicherten Radius,
- besitzt einen global reservierten Maximalbereich,
- hat mindestens zwei freie Rasterfelder Sicherheitsabstand,
- kann von allen Klassen eingeschränkt bebaut werden,
- bietet dem Inspector weiterhin deutlich mehr Bauoptionen,
- lässt Freunde innerhalb derselben Session mitbauen,
- verliert deren normale Bauten beim endgültigen Verlassen,
- kann unzerstörbare, nicht rückbaubare permanente Missions-Rewards erhalten,
- speichert Rewards nur nach erfolgreicher Platzierung **und** Missionssieg,
- repariert normale persistente Konstruktionen vollständig zwischen Missionen,
- rollt Niederlagen vollständig auf den Missionsstart zurück.

Die technische Umsetzung bleibt kontrollierbar, weil sie in drei klar getrennten Schritten erfolgt:

1. **Persistenz-Grundlage**
2. **Klassen & Multiplayer**
3. **Rewards & Kampagnenintegration**

Map 18 und 19 dienen dabei zunächst als kleine echte Integrationsarenen und werden in der letzten Phase wieder von den technischen Testinhalten bereinigt.

Die Architektur bleibt gleichzeitig offen genug, um später einen Lobby-Base-Editor und From Dachs Till Dawn auf demselben Fundament aufzubauen.
