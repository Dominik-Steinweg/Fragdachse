# FRAGDACHSE – GDD: Mörser-Dachs

**Status:** Implementierungsgrundlage / Work in Progress – Version 1  
**Gegner-ID (Arbeitstitel):** `mortar-badger` / „Mörser-Dachs“  
**Spielmodus:** Coop Defense  
**Rolle:** Fragiler Fernbereichs-Belagerer / taktische Artillerie  
**Ziel dieses Dokuments:** Fachliche und technische Grundlage für die Implementierung des Mörser-Dachses sowie der dafür benötigten möglichst generischen und wiederverwendbaren Systeme.

---

# 1. Designziel

Der Mörser-Dachs soll eine neue strategische Bedrohung in Coop Defense einführen:

> **Er ist nicht gefährlich, weil er einen Spieler im direkten Duell besiegt, sondern weil man ihn nicht unbeaufsichtigt lassen kann.**

Seine Aufgabe ist es, Spieler aus der Sicherheit ihrer Basis herauszulocken. Während viele bestehende Gegner den unmittelbaren Nah- oder Fernkampf suchen, soll der Mörser-Dachs aus großer Entfernung gezielt Druck auf die Verteidigungsstruktur ausüben.

Seine Identität basiert auf fünf Elementen:

1. **Sehr hohe indirekte Angriffsreichweite** gegen Basis, Konstrukte und gelegentlich Spieler.
2. **Klarer, zweiphasiger Telegraph:** Vor dem Abschuss kann der Angriff durch Töten des Mörser-Dachses verhindert werden; nach dem hör- bzw. sichtbar markanten Abschuss ist die Granate committed.
3. **Fragiler Nahkampf:** langsam, relativ wenig HP, nur normaler Bite als direkte Waffe.
4. **Taktische Feuerstellungen:** Im Belagerungsbereich versucht der Mörser-Dachs bevorzugt eine Position zu finden, die durch Felsen oder andere Geometrie gegen nahe Gefahren geschützt ist.
5. **Klare Void-Lesbarkeit:** Lila kennzeichnet sowohl den vorbereitenden Gegner als auch den Zielbereich als feindliche Gefahr.

Das zentrale Gameplay-Gesetz lautet:

> **Vor dem THUMP kann der Schuss durch Töten des Mörser-Dachses verhindert werden. Nach dem THUMP ist die Granate unterwegs und schlägt unabhängig vom weiteren Zustand des Gegners am bereits markierten Weltpunkt ein.**

Eine zweite wichtige Regel lautet:

> **Der sichtbare Zielkreis ist die Wahrheit. Der Einschlag folgt keinem beweglichen Ziel nach.**

Diese Regeln müssen für Spieler jederzeit konsistent bleiben.

---

# 2. Abgrenzung zu bestehenden Mechaniken und Gegnern

## 2.1 Kein normaler Fernkämpfer

Der Mörser-Dachs ist ausdrücklich kein Gegner, der wie ein klassischer Ranged Enemy auf Sichtlinie schießt und Spieler kitet.

Er soll:

- keine permanente direkte Schusslinie benötigen,
- nicht vor Spielern geschickt rückwärts kiten,
- keine Dodges verwenden,
- keine schnellen Fluchtfähigkeiten besitzen,
- im direkten Kampf deutlich schwächer als seine strategische Bedrohung sein.

Wird er erreicht, soll sich das für die Spieler wie ein Erfolg anfühlen.

## 2.2 Airstrike

Das vorhandene `AirstrikeSystem` ist ein wichtiger technischer Referenzpunkt:

- host-autoritatives Timed-Strike-Modell,
- feste Weltposition,
- zeitgesteuerter Einschlag,
- schlanker Präsentations-Snapshot.

Der Mörser darf jedoch **nicht einfach als Airstrike implementiert** werden.

Unterschiede:

- Mörserangriff besitzt eine explizite **unterbrechbare Phase vor dem Abschuss**,
- der abschießende Gegner ist Teil des Lifecycles,
- die Zielwahl entsteht aus Enemy-AI,
- der Angriff besitzt eine eigene Belagerungs- und Cover-Logik,
- Darstellung und Schadenssemantik sollen nicht an bestehende Airstrike-Sonderregeln gekoppelt werden.

## 2.3 Nuke

Nuke-Renderer und Void-Nuke liefern visuelle Referenzen für klar erkennbare Warnflächen und lila Gefahrendarstellung. Der Mörser soll jedoch wesentlich kleiner, häufiger und weniger spektakulär wirken.

Insbesondere:

- kein numerischer Countdown als Pflicht,
- kein Nuke-artiger Superweapon-Charakter,
- deutlich kleinerer Impact.

## 2.4 Meteor / Armageddon

`MeteorRenderer` ist der wichtigste bestehende Referenzpunkt für die Darstellung einer aus der Höhe kommenden Bedrohung in der strikten 90°-Top-Down-Ansicht:

- Warnfläche am Boden,
- wachsender Schlagschatten,
- Objekt erscheint erst kurz vor dem Einschlag größer werdend,
- keine echte 3D-Flugbahn notwendig.

Dieses Prinzip soll für die finale Mörser-Flugphase in kleinerer, physischerer Form wiederverwendet werden.

## 2.5 Timebomb-Dachs

`CoopDefenseTimebombSystem` zeigt bereits ein passendes Architekturprinzip:

- eigener host-autoritärer Ability-State,
- normale Flow-Field-Anfahrt,
- anschließend spezialisierte lokale Bewegung,
- gecachte Pfad-/Direktweg-Prüfungen,
- optionale Blockierung regulären Kampfverhaltens.

Der Mörser-Dachs soll ebenfalls eine eigene Ability-/Positioning-Schicht erhalten, ohne das normale Angriffssystem zu überladen.

---

# 3. Grundwerte – erster Prototyp

Diese Werte sind Startpunkte. HP, Bewegungsgeschwindigkeit, Schaden, XP und Spawnhäufigkeit müssen nach dem ersten spielbaren Build gebalanced werden.

| Wert | Startwert / Vorgabe |
|---|---:|
| Rolle | Fernbereichs-Belagerer |
| Bewegung | langsam |
| HP | niedrig bis moderat; bewusst fragil |
| Normale Waffe | Bite |
| Mörser-Mindestreichweite | ca. **300 px** |
| bevorzugter Belagerungsbereich | ca. **700–1000 px** |
| Beginn taktischer Stellungssuche | ca. **maxRange + 200–300 px** |
| Windup | **2000 ms** |
| Flugzeit nach THUMP | **1000 ms** |
| Mindestpause nach Einschlag | **1000 ms** |
| theoretisch kürzestes THUMP-Intervall | **4000 ms** |
| lokale Stellungssuche | ca. **300–500 px** |
| relevante Gefahren für Cover | Spieler + bewaffnete Spieler-Konstrukte + relevante Basistürme/Outpost-Gefahren |
| Cover-Gefahrenlimit | konfigurierbarer Radius + begrenzte Top-N-Auswahl, zunächst etwa **4–6** relevante Gefahren |
| Friendly Fire gegen Gegner | **nein** |

Die exakten Werte für folgende Punkte bleiben zunächst offen:

- HP,
- Move Speed,
- XP,
- Mörserschaden,
- Explosionsradius,
- Schadensmultiplikatoren,
- Cover-Suchradius,
- Threat-Radius,
- maximale Threat-Anzahl,
- Positions-Score-Gewichte,
- Mindestverbesserung für Repositionierung,
- Spawnhäufigkeit und erste Map.

---

# 4. Zustandsmodell des Mörserangriffs

Der Mörserangriff besteht fachlich aus vier Phasen.

```text
APPROACH / POSITIONING
        |
        v
WINDUP / TARGETING
2 s, unterbrechbar durch Tod
        |
        | THUMP
        v
IN FLIGHT
1 s, vollständig committed
        |
        v
IMPACT
        |
        v
RECOVERY / REPOSITION
mind. 1 s bis neuer Windup möglich
```

Wichtig ist die klare Trennung zwischen **Windup** und **Flug**.

## 4.1 Windup

Beim Start des Windups:

- wird der endgültige Einschlagspunkt als Weltposition festgelegt,
- erscheint der Zielmarker sofort,
- bleibt der Mörser-Dachs stehen,
- beginnt der lila Void-Glow des Gegners,
- startet der 2-s-Timer.

Während dieser Phase existiert gameplayseitig noch kein irreversibel abgeschossenes Geschoss.

## 4.2 THUMP

Bei `launchAt` erfolgt der Abschuss.

Der THUMP ist der **Point of no Return**.

Ab diesem Zeitpunkt:

- kann der Strike nicht mehr durch den Tod des Mörser-Dachses verhindert werden,
- wird der Zielpunkt niemals verändert,
- darf der Mörser-Dachs nach dem Abschuss wieder in Recovery-/Positionslogik übergehen,
- läuft der Strike unabhängig von der Enemy-Entity weiter.

## 4.3 Flug

Die Flugzeit beträgt im ersten Prototyp **1000 ms**.

Währenddessen:

- kein Homing,
- keine Zielkorrektur,
- keine erneute KI-Entscheidung für diesen Strike,
- keine Kollision mit Terrain auf der Flugbahn,
- nur der feste Einschlagspunkt ist gameplayrelevant.

## 4.4 Impact und Recovery

Beim Impact wird radialer Schaden angewendet.

Der nächste Windup darf frühestens beginnen:

```text
impactAt + 1000 ms
```

Die Recovery ist **keine Stillstandsphase**.

Der Mörser-Dachs darf in dieser Zeit bereits:

- Zielkandidaten neu bewerten,
- seine aktuelle Deckungsqualität prüfen,
- eine bessere Stellung auswählen,
- sich in Richtung einer ausgewählten Stellung bewegen.

Braucht er länger als eine Sekunde, um eine ausreichend gute Stellung zu erreichen, verzögert sich der nächste Angriff entsprechend.

---

# 5. Interrupt-Regel

## 5.1 Einzige Unterbrechung: Tod vor THUMP

Für V1 gilt bewusst eine sehr einfache Regel:

> **Nur der Tod des Mörser-Dachses vor `launchAt` bricht einen begonnenen Mörserangriff ab.**

Nicht ausreichend zum Abbruch sind:

- normaler Schaden,
- Betreten der Mindestreichweite durch einen Spieler,
- Verlust der aktuellen Deckung,
- Bewegung oder Zerstörung des ursprünglichen Ziels,
- andere Statusänderungen, solange der Gegner lebt.

## 5.2 Tod während Windup

Stirbt der Mörser-Dachs vor `launchAt`:

- Strike wird entfernt,
- Zielmarker verschwindet,
- kein THUMP,
- kein Einschlag,
- kein Schaden.

## 5.3 Tod nach THUMP

Stirbt der Mörser-Dachs bei oder nach `launchAt`:

- Strike bleibt aktiv,
- Granate fliegt weiter,
- Impact erfolgt normal.

Diese Grenze muss hostseitig exakt und testbar sein.

## 5.4 Ziel wird während Windup zerstört

Wird das ursprünglich ausgewählte Ziel vor THUMP zerstört:

- kein Retargeting,
- kein Abbruch,
- kein neuer Zielpunkt,
- der Mörser schießt auf die bereits markierte Weltposition.

Der Schuss darf dadurch vollständig oder teilweise verschwendet werden.

---

# 6. Mörser-Zielwahl

## 6.1 Grundprinzip

Die Zielwahl ist **gewichtet**, nicht als starre Prioritätsliste aufgebaut.

Ein Ziel wird anhand mehrerer Aspekte bewertet:

- strategischer Wert,
- Zieltyp,
- aktuelle Distanz,
- Erreichbarkeit eines sinnvollen Mörserbereichs,
- Qualität einer verfügbaren Feuerstellung,
- bereits laufende Mörsereinschläge im selben Bereich.

Dadurch darf ein geringfügig weniger wertvolles Ziel bevorzugt werden, wenn dafür eine deutlich bessere geschützte Feuerstellung existiert.

## 6.2 Zielkategorien

Erster Designrahmen:

### Hohe Gewichtung

- bewaffnete, zerstörbare Spieler-Konstrukte,
- strategisch wertvolle aktive Konstrukte,
- freundliche Coop-Basis.

### Mittlere Gewichtung

- Spieler-Barrieren / Rock Barriers,
- andere zerstörbare Spieler-Konstrukte.

### Niedrigere, aber relevante Gewichtung

- Spieler,
- player-like Ziele / Decoys, sofern die bestehenden allgemeinen Target-Regeln sie als gültiges Spielerziel präsentieren.

### Keine absichtlichen Ziele

- natürliche Map-Felsen,
- unzerstörbare Konstrukte,
- bereits ungültige/zerstörte Ziele.

Natürliche Felsen dürfen durch Splash Damage zerstört werden, werden aber nicht absichtlich beschossen.

## 6.3 Unzerstörbare Konstrukte

`PlacementSystem` und `CoopDefenseConstructionDefinition` besitzen bereits eine zentrale `indestructible`-Semantik.

V1 soll unzerstörbare Konstrukte – derzeit insbesondere entsprechende Pedestale – **nicht als absichtliche Mörserziele** auswählen.

Keine Sonderliste nach konkreten Construction-IDs erzeugen; die bestehende Definition ist die Wahrheit.

## 6.4 Fester Target-Point

Nach der Zielentscheidung wird ein Weltpunkt gespeichert:

```ts
targetX
targetY
```

Dieser Punkt wird während Windup und Flug nicht mehr verändert.

Bei Spielern:

- Position bei Beginn des Windups verwenden,
- keine Prediction,
- kein Nachführen.

Bei Konstrukten:

- sinnvollen Mittelpunkt / kanonischen World-Target-Point des Runtime-Objekts verwenden.

Bei Basen:

- einen stabilen repräsentativen Weltpunkt der aktiven Basis verwenden,
- keine Annahme machen, dass eine Basis nur aus einer einzelnen Zelle besteht.

## 6.5 Kein komplexes AoE-Optimierungsproblem

Die KI muss in V1 nicht versuchen:

- maximal viele Konstrukte mit einem Einschlag zu treffen,
- den exakten erwarteten Gesamtschaden eines Einschlagspunkts zu maximieren,
- HP aller Ziele gegen erwarteten Mörserschaden zu simulieren.

Der primäre Zielkandidat bestimmt den Einschlagspunkt.

Emergente Mehrfachtreffer durch den realen Explosionsradius sind ausdrücklich erlaubt.

---

# 7. Koordination mehrerer Mörser-Dachse

Mehrere Mörser-Dachse sollen nicht vollkommen unabhängig denselben kleinen Bereich überbombardieren.

Es gibt aber **keine harte Zielreservierung**.

## 7.1 Räumlicher Overlap-Malus

Bei der Zielbewertung wird geprüft, ob der Kandidatenpunkt:

- innerhalb eines laufenden Mörser-Einschlagsradius liegt,
- oder ausreichend nah an einem bereits markierten Einschlag liegt.

Dann erhält das Ziel einen Score-Malus.

Damit wird z. B. vermieden:

- zwei Mörser wählen gleichzeitig denselben Turm,
- zwei benachbarte Konstrukte werden separat gewählt, obwohl die erste Granate ohnehin beide treffen kann.

## 7.2 Keine Overkill-Prognose

V1 berechnet ausdrücklich nicht:

```text
aktuelle Ziel-HP
vs.
erwarteter Schaden laufender Strikes
```

Ein räumlicher Malus genügt.

Dadurch bleibt die KI:

- performanter,
- robuster,
- leichter testbar,
- weniger abhängig von Damage-Balancing.

---

# 8. Globale Navigation: Flow-Field bleibt Standard

Der Mörser-Dachs soll keine eigene globale Pfadsuche erhalten.

Für die großräumige Bewegung gilt weiterhin:

> **Bestehendes Flow-Field zuerst.**

Der Gegner nähert sich über die normale Navigation dem relevanten Basis-/Belagerungsbereich.

Als Grundausrichtung bietet sich `movementTarget: 'bases'` an, weil die strategische Kernrolle die Belagerung der Verteidigungszone ist.

Die konkrete Zielauswahl des Mörsers muss deshalb nicht identisch mit dem globalen MovementTarget sein.

## 8.1 Übergang zur taktischen Positionierung

Sobald der Gegner sich dem möglichen Belagerungsbereich nähert, ungefähr:

```text
distanceToRelevantSiegeArea <= maxRange + coverSearchActivationMargin
```

mit einem Startwert von etwa:

```text
coverSearchActivationMargin = 200–300 px
```

beginnt die lokale taktische Positionssuche.

Bis dahin soll der Mörser-Dachs keinen teuren Cover-Scan durchführen.

---

# 9. Lokale taktische Stellungssuche

## 9.1 Ziel

Innerhalb des Belagerungsbereichs soll der Mörser-Dachs bevorzugt eine Position suchen, von der aus:

- ein wertvolles Ziel in sinnvoller Mörserreichweite liegt,
- direkte Gefahren möglichst durch Felsen oder andere Geometrie blockiert werden,
- keine unnötig lange Bewegung nötig ist.

Das System soll intelligent wirken, aber bewusst **kein taktischer Voll-Pathfinder** sein.

## 9.2 Kandidaten

Pro Neubewertung wird eine kleine, deterministisch erzeugbare Menge lokaler Positionskandidaten betrachtet.

Mindestens:

- aktuelle Position,
- mehrere Kandidaten in verschiedenen Richtungen und Distanzen,
- nur Punkte innerhalb eines lokalen Suchradius,
- nur gültige / begehbare / lokal erreichbare Punkte.

Startbereich:

```text
localSearchRadiusPx ≈ 300–500
```

Die aktuelle Position ist **immer Kandidat** und besitzt:

```text
movementCost = 0
```

Dadurch entsteht natürliche Trägheit ohne eine separate „bleib stehen“-Sonderregel.

## 9.3 Bestehende Flow-Field-Topologie wiederverwenden

Die lokale Suche soll die vorhandene Navigationstopologie verwenden.

Geeignete bestehende Grundlagen sind insbesondere:

- `EnemyFlowFieldService.worldToGrid(...)`,
- Traversability-/Kind-Abfragen,
- `forEachReachableNeighbor(...)`,
- `hasWalkableCircleLine(...)`,
- vorhandene kurze Target-/Waypoint-Helfer wie sie bereits bei spezialisierten Gegnerbewegungen genutzt werden.

Es soll **kein zweites Grid**, keine zweite statische Hindernisliste und kein eigener globaler A*-Dienst nur für den Mörser entstehen.

## 9.4 Kandidatenbewertung

Konzeptionell:

```text
positionScore =
    targetValue
  + rangeQuality
  + coverQuality
  + firingPositionQuality
  - exposurePenalty
  - movementCost
  - mortarOverlapPenalty
```

Die konkrete Formel darf anders strukturiert werden. Entscheidend ist das Verhalten.

### Target Value

Wie wertvoll ist das beschießbare Ziel?

### Range Quality

Liegt das Ziel:

- außerhalb der Mindestreichweite,
- innerhalb des bevorzugten 700–1000-px-Bereichs,
- nicht außerhalb der Maximalreichweite?

### Cover Quality

Wie viele relevante Gefahren besitzen von dieser Position **keine freie direkte Sichtlinie** zum Mörser?

### Exposure Penalty

Wie viele wichtige Gefahren können den Mörser von dort direkt bekämpfen?

### Movement Cost

Wie weit / aufwendig muss der Mörser laufen, um die Position zu erreichen?

## 9.5 Bewegungskosten müssen Nutzen relativieren

Zentrales Designprinzip:

> **Je länger die notwendige Bewegung, desto größer muss die Verbesserung der Stellung sein.**

Beispiele:

- 40 px Bewegung für kleine Cover-Verbesserung: sinnvoll.
- 350 px Bewegung für minimale Verbesserung: nicht sinnvoll.
- 350 px Bewegung von völlig offenem Feld zu sehr guter Felsdeckung gegen mehrere Gefahren: kann sinnvoll sein.

Es gibt deshalb nicht primär eine harte Regel „maximal X px repositionieren“.

Stattdessen muss der Positionsgewinn den Bewegungsaufwand übertreffen.

Ein großzügiger technischer Safety-Cap darf existieren, soll aber nicht das eigentliche Designprinzip sein.

## 9.6 Hysterese

Eine neue Position soll nur gewählt werden, wenn sie die aktuelle Position **ausreichend deutlich** übertrifft.

Sinngemäß:

```text
bestCandidateScore >= currentPositionScore + minRepositionImprovement
```

Der Schwellwert ist konfigurierbar.

Dadurch werden vermieden:

- Links/Rechts-Flattern,
- permanentes Wechseln zwischen fast identischen Felsen,
- unnötige Bewegung nach jedem Schuss,
- Jagd nach der mathematisch perfekten Position.

---

# 10. Cover-Bewertung

## 10.1 Was zählt als Cover?

Als Deckung darf grundsätzlich jede bereits vorhandene Weltgeometrie wirken, die eine direkte Angriffslinie blockiert, z. B.:

- natürliche Felsen,
- Spieler-Barrieren,
- andere Konstrukte,
- relevante Basisgeometrie.

Die Cover-Bewertung soll auf denselben LoS-/Obstacle-Regeln basieren wie das bestehende Combat-System.

Keine zweite vereinfachte „Mörser-Sichtlinienwelt“ erzeugen.

## 10.2 Geometrie und Gefahr strikt trennen

Ein bewaffnetes Spieler-Konstrukt kann gleichzeitig:

- physisch eine Schusslinie eines anderen Angreifers blockieren,
- selbst eine gefährliche Waffe gegen den Mörser besitzen.

Deshalb dürfen folgende Fragen nicht vermischt werden:

1. **Blockiert dieses Objekt eine Linie?**
2. **Ist dieses Objekt selbst eine Gefahr?**

Ein Turm darf geometrisch Deckung liefern, aber seine eigene Threat-Bewertung kann diesen Vorteil vollständig überkompensieren.

## 10.3 Relevante Gefahren

Für V1 mindestens:

- lebende Spieler,
- bewaffnete Spieler-Konstrukte,
- relevante freundliche Basistürme bzw. bewaffnete Outpost-/Objective-Quellen.

Nicht jeder theoretische Angreifer der gesamten Map wird berücksichtigt.

## 10.4 Performancebegrenzung

Cover-Bewertung wird zweifach begrenzt:

### Räumlicher Radius

Nur Gefahren innerhalb eines konfigurierbaren Radius um den Mörser bzw. Positionskandidaten werden berücksichtigt.

Sehr weit entfernte Gefahren sind für die lokale Entscheidung irrelevant.

### Maximale Anzahl

Aus diesen Gefahren werden nur die relevantesten `N` ausgewertet.

Startwert:

```text
maxCoverThreats ≈ 4–6
```

Relevanz kann robust und günstig bestimmt werden, z. B. über:

- Distanz,
- tatsächliche Waffenreichweite bei Konstrukten,
- Gefahrenkategorie,
- aktuelle direkte Sichtlinie.

## 10.5 Turmreichweiten nutzen

Bewaffnete Konstrukte tragen bereits semantische Waffen-/Range-Daten.

Eine Stellung außerhalb der tatsächlichen Reichweite eines Turms soll nicht so behandelt werden, als würde ein Felsen den Mörser „retten“.

Für Cover-Scoring sind daher mindestens zu unterscheiden:

```text
Threat irrelevant / außer Reichweite
Threat relevant, aber LoS blockiert
Threat relevant und LoS frei
```

## 10.6 Cover ist Wunsch, keine Voraussetzung

Findet die KI keine gute Deckung:

> **Sie wählt die beste verfügbare Stellung und feuert notfalls offen.**

Der Mörser darf nicht minutenlang außerhalb des Kampfes herumwandern, nur weil kein perfekter Felsen existiert.

---

# 11. Zeitpunkt der Positions-Neubewertung

Die vollständige lokale Cover-/Positionssuche darf nicht jeden Frame laufen.

Sie wird primär ereignis- und intervallbasiert ausgelöst.

Pflichtauslöser:

1. Eintritt in den taktischen Belagerungsbereich.
2. Nach jedem abgeschlossenen Schuss / THUMP bzw. spätestens in der anschließenden Recovery.
3. Aktuelles Ziel wird ungültig.
4. Aktuelle Deckung bzw. lokale Topologie verändert sich relevant.
5. Gefahrensituation verändert sich deutlich.
6. Langsamer periodischer Safety-Check als Fallback.

Die vorhandenen Map-/Grid-Änderungssignale und Obstacle-/Topology-Generationen sollen möglichst genutzt werden, statt jede Geometrieänderung separat im Mörsersystem zu duplizieren.

## 11.1 Nach jedem Schuss

Nach einem Schuss wird die aktuelle Stellung **neu bewertet**, aber nicht automatisch verlassen.

Wenn die aktuelle Position weiterhin sehr gut ist:

- dort bleiben,
- Ziel neu bewerten,
- später nächsten Windup starten.

Ist eine alternative Stellung deutlich besser:

- repositionieren,
- erst danach neuen Windup starten.

---

# 12. Verhalten bei Gefahr innerhalb der Mindestreichweite

Der Mörser besitzt eine Mindestreichweite von zunächst ca. **300 px**.

Er soll außerhalb eines aktiven Windups keinen neuen Mörserangriff starten, wenn eine relevante unmittelbare Gefahr innerhalb dieser Mindestreichweite liegt.

## 12.1 Zwischen Nahkampf und Mindestreichweite

Befindet sich z. B. ein Spieler bei 150–300 px:

- Mörser-Dachs versucht langsam, wieder Abstand zu gewinnen,
- Ziel ist die Wiederherstellung seiner Artillerierolle,
- keine optimierte Seitwärts-Kiting-Logik,
- keine schnellen Dodges,
- keine Fluchtfähigkeit.

Seine niedrige Bewegungsgeschwindigkeit ist Teil der Counterplay-Regel.

## 12.2 Echte Bite-Reichweite

Wird er wirklich im Nahkampf erreicht:

- normaler Bite,
- kein Mörserstart,
- keine besondere Nahkampf-Spezialfähigkeit.

Der Spieler soll den Mörser-Dachs nach erfolgreichem Rush klar im Vorteil bekämpfen können.

## 12.3 Kein Abbruch laufender Windups

Wird die 300-px-Grenze **nach Beginn eines Windups** unterschritten:

- Windup läuft weiter,
- Mörser bleibt stehen,
- nur Tod unterbricht.

Das hält die Spielerregel eindeutig.

---

# 13. Normaler Bite und Angriffssystem

Der Bite soll über das bestehende normale Gegner-Waffensystem laufen.

Der Mörser selbst soll **nicht** als normaler `EnemyAttackWeapon` modelliert werden.

Begründung:

Das normale Angriffssystem ist auf klassische Waffenentscheidungen, Schusslinien, Salven, Mindestdistanzen und direkte Ziele ausgelegt. Der Mörser besitzt dagegen:

- Zielplanung und Positionsplanung vor dem Schuss,
- indirektes Feuer ohne LoS zum Ziel,
- einen eigenen mehrphasigen Strike-Lifecycle,
- eine Todes-Interrupt-Regel,
- einen Strike, der nach dem Abschuss ohne Enemy-Entity weiterlebt.

## 13.1 Blockierung regulärer Angriffe

Während des 2-s-Mörser-Windups:

- kein Bite,
- keine andere reguläre Attacke,
- Gegner steht vollständig.

Dafür kann der bereits vorhandene Mechanismus zur Blockierung regulärer Enemy-Aktionen genutzt werden (`actionBlockedChecker` bzw. äquivalente zentrale Verdrahtung).

Außerhalb des Windups bleibt der Bite normal verfügbar.

---

# 14. Schadensmodell

## 14.1 Radialer Falloff

Der Mörser-Einschlag erzeugt radialen Schaden mit Falloff:

- Zentrum sehr gefährlich,
- zum Rand hin deutlich schwächer.

Bestehende gemeinsame Radial-Damage-Helfer sollen wiederverwendet werden.

## 14.2 Zielarten

Der Einschlag kann beschädigen:

- Spieler,
- freundliche Coop-Basen,
- zerstörbare Spieler-Konstrukte,
- natürliche Felsen als Kollateralschaden.

Andere feindliche Gegner werden nicht beschädigt.

## 14.3 Belagerungs-Multiplikatoren

Der Mörser soll als Siege Enemy konfigurierbare Multiplikatoren erhalten.

Sinngemäße Konfiguration:

```ts
baseDamageMult
constructionDamageMult
rockDamageMult
```

Die konkrete technische Integration soll vorhandene allgemeine Damage-Optionen nutzen, wenn diese semantisch passen.

Keine hartcodierten Checks wie:

```ts
if (enemy.kind === 'mortar-badger') ...
```

im allgemeinen Damage-Kern.

## 14.4 EnvironmentDamageResolver wiederverwenden

Für Felsen/Konstruktionsobjekte soll der vorhandene gemeinsame Umgebungsschadenspfad verwendet werden.

Insbesondere sollen erhalten bleiben:

- radialer Falloff,
- `rockDamageMult`,
- Grid-/Radius-Vorauswahl,
- Konstrukt-/Team-/Unverwundbarkeitsregeln,
- zentrale Zerstörungs-Callbacks.

Keine zweite Mortar-spezifische Fels-/Konstruktions-HP-Logik.

## 14.5 Eigene Deckung kann zerstört werden

Natürliche Felsen erhalten realen Splash Damage.

Dadurch kann der Mörser:

- langfristig seine eigene Deckung beschädigen,
- seine bisher gute Stellung nach einem Einschlag schlechter machen.

Das ist erwünschtes emergentes Verhalten.

Nach dem Schuss wird die Stellung ohnehin neu bewertet.

---

# 15. MortarStrikeSystem

## 15.1 Aufgabe

Ein eigener kleiner host-autoritärer Strike-Lifecycle soll die zeitliche Wahrheit eines Mörserschusses besitzen.

Zielrichtung:

```ts
interface ActiveMortarStrike {
  id: number;

  sourceEnemyId: string;
  sourceX: number;
  sourceY: number;

  targetX: number;
  targetY: number;
  radius: number;

  armedAt: number;
  launchAt: number;
  impactAt: number;

  // host-only:
  attackerId: string;
  damageConfig: ...;
}
```

Die genaue Typstruktur darf an bestehende Projektkonventionen angepasst werden.

## 15.2 Strike entsteht beim Windup-Start

Der Strike wird **nicht erst beim THUMP** erzeugt.

Er entsteht bereits:

```text
armedAt = Start des Windups
launchAt = armedAt + 2000
impactAt = launchAt + 1000
```

Damit besitzt ein einziges Objekt:

- Warnphase,
- Point of no Return,
- Flugphase,
- Impact-Zeitpunkt.

## 15.3 Phase wird aus Zeit abgeleitet

Ein zusätzlich replizierter `phase`-String ist nicht zwingend erforderlich.

```text
now < launchAt
=> windup / interruptible

launchAt <= now < impactAt
=> in flight / committed
```

Diese Ableitung reduziert Zustandsduplikation.

## 15.4 Cancel Pending by Source

Das System braucht einen klaren, testbaren Pfad:

```ts
cancelPendingBySource(enemyId, now)
```

oder eine funktional äquivalente Lösung.

Dabei werden ausschließlich Strikes entfernt, für die gilt:

```text
now < launchAt
```

Bereits abgeschossene Strikes bleiben bestehen.

## 15.5 Impact

Bei `impactAt`:

1. Strike hostseitig auflösen.
2. Gameplay-Schaden anwenden.
3. synchronisierte Explosion/VFX auslösen.
4. Strike aus aktivem Snapshot entfernen.

Der Impact darf nicht von einem noch existierenden Source-Enemy abhängen.

---

# 16. CoopDefenseMortarSystem

## 16.1 Aufgabe

`CoopDefenseMortarSystem` besitzt die Enemy-AI-spezifische Logik:

- Welche Mörser-Dachse sind aktiv?
- Welches Ziel ist sinnvoll?
- Wann beginnt die lokale Stellungssuche?
- Welche Stellung ist ausreichend gut?
- Wann darf ein Windup starten?
- Wann wird reguläre Bewegung überschrieben?
- Wie reagiert der Dachs auf Gefahren innerhalb der Mindestreichweite?
- Wann wird ein pending Strike durch Enemy-Tod abgebrochen?

Es soll **nicht** die visuelle Granate rendern und **nicht** eigenständig allgemeine Damage-Regeln duplizieren.

## 16.2 Runtime-State pro Mörser

Sinngemäß:

```ts
interface MortarEnemyState {
  activeStrikeId: number | null;
  nextWindupEarliestAt: number;

  selectedTarget: MortarTargetRef | null;
  selectedTargetX: number;
  selectedTargetY: number;

  tacticalWaypoint: { x: number; y: number } | null;
  nextPositionEvaluationAt: number;

  // optional gecachte Werte:
  lastPositionScore: number;
  topologyGeneration: number;
}
```

Nicht jeder dieser Werte muss exakt so gespeichert werden.

## 16.3 Movement Override

Das System kann sich an bestehenden `EnemySpecialMovementSource`-Mustern orientieren.

Priorität:

```text
1. aktiver Windup
   -> Bewegung 0

2. unmittelbare Gefahr < Minimum Range
   -> langsames Spacing / bei Nahkampf Bite

3. taktisches Repositioning aktiv
   -> lokaler Waypoint / Kandidat

4. sonst
   -> kein Override; normale Flow-Field-Navigation
```

---

# 17. Ziel- und Positionssuche performant koppeln

Eine naive Vollkombination aus:

```text
alle Ziele
x alle Positionen
x alle Gefahren
```

soll vermieden werden.

Für V1 wird ein klar begrenztes Verfahren empfohlen.

## 17.1 Schritt 1 – Target-Shortlist

Zunächst günstige Basisbewertung der gültigen Zielkandidaten:

- Zieltyp,
- Distanz,
- Overlap-Malus laufender MortarStrikes,
- grundlegende Gültigkeit.

Dann nur die besten wenigen Kandidaten weiter betrachten.

Sinngemäß:

```text
topTargetCandidates ≈ 3–5
```

Der genaue Wert ist Balancing/Performance-Tuning.

## 17.2 Schritt 2 – lokale Positionskandidaten

Nur kleine Menge lokaler, erreichbarer Punkte innerhalb ca. 300–500 px.

Die aktuelle Position gehört immer dazu.

## 17.3 Schritt 3 – Threat-Shortlist

Nur nahe/relevante Gefahren.

Dann maximal ca. 4–6 Gefahren für die teureren LoS-Prüfungen verwenden.

## 17.4 Schritt 4 – Target/Position-Paare bewerten

Nur für die begrenzte Menge werden geprüft:

- Ziel in Mörserreichweite?
- Stellung erreichbar?
- Cover gegen relevante Gefahren?
- Laufaufwand?
- Target-Score?

Dadurch bleiben die Kosten kontrollierbar, auch wenn sehr viele Konstrukte existieren.

---

# 18. Renderer und visuelle Sprache

## 18.1 Grundprinzip

Aufgrund der strikten 90°-Top-Down-Ansicht und des gewünschten Implementierungsaufwands gibt es in V1 keine komplexen Mortar-/Character-Animationen.

Die Phasen werden primär kommuniziert durch:

- Glow,
- Partikel,
- Rauch,
- Warnkreise,
- Schlagschatten,
- kurze Shell-Visuals,
- Explosionseffekte.

## 18.2 Farbcode

Der gesamte feindliche Telegraph verwendet die bestehende **Void-Palette**.

Spieler sollen im Gefechtsgetümmel schnell lernen:

> **Lila = feindliche / unmittelbare Gefahr.**

Diese Farbcodierung ist wichtiger als physikalischer Realismus.

## 18.3 Der Dachs ist in V1 die Waffenplattform

Der Mörser-Dachs trägt in der ersten Version **keine separat sichtbare Mörserwaffe**.

Daraus folgt:

- Windup-Glow liegt auf / um dem Gegner,
- Partikel entstehen am Gegner,
- THUMP-VFX entsteht an der Enemy-Position,
- kein Muzzle-Bone / kein separates Weapon-Sprite notwendig.

---

# 19. Windup-Rendering

## 19.1 Zielmarker

Sobald ein Strike erzeugt wurde:

- lila Warnkreis am Zielpunkt,
- klarer Explosionsradius,
- keine numerische Countdown-Zahl,
- zeitlicher Fortschritt über Ringbewegung / Puls / Füllung.

## 19.2 Unterbrechbarer Zustand

Vor THUMP soll der Marker visuell etwas weniger „final“ wirken.

Mögliche Sprache:

- offene / segmentierte / gestrichelte Ringwirkung,
- ruhigeres Pulsieren,
- geringere Intensität.

Die konkrete Grafikform darf im Renderer entschieden werden.

Wichtig ist die Bedeutung:

> **Gefahr ist angekündigt, aber der Abschuss kann noch verhindert werden.**

## 19.3 Source-Glow

Während der zwei Sekunden:

- zunehmend starker Void-Glow um den Mörser-Dachs,
- steigende Partikeldichte,
- schnellere Pulse gegen Ende,
- Lesbarkeit auch in einer großen Gegnergruppe.

Kein separates Icon ist für V1 Pflicht.

Falls Playtests zeigen, dass der Dachs trotz Glow nicht auffindbar ist, kann später ein zusätzliches Symbol ergänzt werden.

## 19.4 Keine dauerhafte Enemy-SpecialAction-Pflicht

Der Windup muss nicht zwingend über `SyncedEnemySnapshot.specialAction` repliziert werden.

Da der aktive `SyncedMortarStrike` bereits:

- `sourceEnemyId`,
- `armedAt`,
- `launchAt`

kennt, kann der MortarRenderer den Source-Glow daraus ableiten.

Das vermeidet eine weitere manuell codierte Enemy-SpecialAction im kompakten Enemy-Snapshot-Codec.

---

# 20. THUMP- und Flug-Rendering

## 20.1 THUMP

Bei `launchAt` muss der visuelle Zustandswechsel eindeutig sein.

Pflichtelemente:

- kräftiger kurzer lila Flash am Mörser-Dachs,
- deutlicher Partikelburst,
- **viel Rauch**,
- kurze physische/energetische Ausstoßwirkung.

Der bestehende `MuzzleFlashRenderer` kann als technischer Referenzpunkt bzw. durch ein generisches `mortar`-Preset erweitert werden.

Wegen der fehlenden sichtbaren Waffe liegt der Ursprung am Gegner selbst bzw. an einem kleinen richtungsabhängigen Offset.

## 20.2 Keine Bildschirm-Parabel

Die Granate soll nicht als horizontales Projektil über Felsen fliegen.

Das würde in der Top-Down-Darstellung suggerieren, dass sie Hindernisse durchquert.

Stattdessen:

```text
THUMP
-> Granate sehr kurz am Source sichtbar
-> schrumpft / verschwindet "nach oben"
-> Großteil des Flugs unsichtbar
-> am Ziel wächst Schlagschatten
-> Granate erscheint kurz vor Impact von oben
-> Explosion
```

## 20.3 Committed Target Marker

Nach THUMP wechselt der Warnmarker deutlich seinen Zustand:

- geschlossener / eindeutigerer Ring,
- stärkere Void-Intensität,
- schnelleres Pulsieren,
- einsetzender Schlagschatten.

Spieler sollen ohne Erklärung erkennen können:

> **Unterbrechen ist jetzt vorbei; nur noch den Einschlag vermeiden.**

## 20.4 Fallende Granate

Die finale Annäherung orientiert sich konzeptionell an `MeteorRenderer`:

- wachsender Schlagschatten,
- Shell / Glow erst spät sichtbar,
- Scale-Up vermittelt Annäherung aus der Höhe.

Mörser-spezifische Darstellung:

- deutlich kleiner als Meteor,
- weniger Feuer,
- physischere Shell-Silhouette,
- lila Void-Akzent statt vollständig lila Energiegeschoss.

---

# 21. Impact-Rendering

Der Einschlag soll eine physische Mörserexplosion bleiben.

Pflichteindruck:

- Druck / Blast,
- Dirt,
- Stein-/Chunk-Partikel,
- kräftiger Rauch,
- klare lila Void-Akzente.

Nicht gewünscht:

- reine abstrakte Energieexplosion,
- Nuke-Größe,
- ein bloß umgefärbter Airstrike.

## 21.1 Bestehenden Explosion-RPC nutzen

`EffectSystem` besitzt bereits einen zentral synchronisierten Explosionspfad.

Der Mörser-Impact sollte deshalb bevorzugt als:

- neues generisches `mortar`-Explosion-Visual-Preset,
- oder eine äquivalent sauber abgegrenzte Erweiterung der bestehenden Explosion-Visual-Profile

integriert werden.

Der Client soll den Impact nicht ausschließlich daraus ableiten, dass ein Strike aus dem Snapshot verschwunden ist.

Der hostseitig ausgelöste Effect-/RPC-Pfad bleibt die eindeutige Impact-Präsentation für alle Peers.

## 21.2 Profil statt Sonderrenderer für die Explosion

Falls das vorhandene `ExplosionGpuRenderer`-Profilmodell die gewünschte Wirkung ausdrücken kann, soll es erweitert werden, z. B. mit:

- relativ hohem Smoke-Faktor,
- moderaten Chunks,
- normalem physischem Blast-Body,
- Void-Farbgebung.

Keine Mortar-only Kopie des allgemeinen Explosion-Renderers.

---

# 22. Audio-Zielbild

Langfristig sind drei Audioebenen vorgesehen:

1. dezentes Arming-/Windup-Geräusch,
2. markanter **THUMP** beim Abschuss,
3. fallendes Pfeifen kurz vor Impact.

Für die erste Version werden noch keine entsprechenden Sounds bereitgestellt.

Daher gilt:

> **Audio ist für V1 kein Abnahmekriterium.**

Alle mechanisch notwendigen Zustände müssen auch ohne Sound eindeutig über VFX lesbar sein.

Die Architektur soll Audio-Hooks aber nicht unnötig verhindern.

---

# 23. Host Authority / Multiplayer

Alle gameplayrelevanten Entscheidungen bleiben host-autoritativ:

- Zielauswahl,
- Positionsauswahl,
- Cover-Bewertung,
- Windup-Start,
- Target-Point,
- `launchAt`,
- Interrupt durch Tod,
- Strike-Lifecycle,
- Impact,
- Schaden,
- Konstruktschaden,
- Felszerstörung,
- Cooldown / frühester nächster Windup.

Clients treffen keine eigene Mortar-AI-Entscheidung.

## 23.1 Eigener Snapshot

Empfohlen:

```ts
interface SyncedMortarStrike {
  id: number;

  sourceEnemyId: string;
  sourceX: number;
  sourceY: number;

  targetX: number;
  targetY: number;
  radius: number;

  armedAt: number;
  launchAt: number;
  impactAt: number;
}
```

Nur Präsentationsdaten replizieren.

Nicht erforderlich:

- Damage-Werte,
- Target-Score,
- Cover-Score,
- ausgewählte Threats,
- lokale AI-Waypoints.

## 23.2 GameState-Integration

Airstrikes und Meteore werden bereits als eigene Arrays im komprimierten `GameState` übertragen.

Der Mörser soll diesem Muster folgen, z. B. sinngemäß:

```text
mortarStrikes: SyncedMortarStrike[]
```

mit eigenem kompaktem Payload-Key.

Keine Einbettung jedes Strike-Zustands in den Enemy-Upsert.

## 23.3 Kein neuer Enemy-SpecialAction-Wire-State für V1

Der bestehende Enemy-Snapshot codiert `specialAction` manuell über Zahlenwerte.

Ein zusätzlicher `mortar-windup`-Action-Code würde Änderungen an:

- Typen,
- Codec,
- Delta-Handling,
- Tests

erfordern, obwohl der Strike selbst bereits alle Präsentationszeitpunkte trägt.

V1 soll deshalb bevorzugt ohne neue Enemy-SpecialAction auskommen.

## 23.4 Late Snapshot / Client Join

Ein Client, der einen Strike erst nach `launchAt` empfängt:

- zeigt keinen neuen vollständigen 2-s-Windup,
- rendert direkt den aus `now`, `launchAt` und `impactAt` abgeleiteten Flugzustand.

Ein THUMP-One-Shot darf nur abgespielt werden, wenn der Renderer den tatsächlichen Übergang rund um `launchAt` beobachtet bzw. ausreichend nah am Ereignis einsteigt.

Kein mehrfaches THUMP durch wiederholte Snapshots.

---

# 24. Architekturvorgabe

Empfohlene Trennung:

```text
CoopDefenseMortarSystem
        |
        | plant Ziel, Stellung und Windup
        v
MortarStrikeSystem
        |
        | repliziert zeitlichen Strike-Zustand
        v
MortarRenderer
        |
        | Windup, Source-Glow, Target Marker,
        | THUMP, Flug, Shadow
        v
bestehender Explosion-/Effect-Pfad
        |
        | synchronisierter Impact
        v
Gameplay-Damage-Resolver
```

## 24.1 `CoopDefenseMortarSystem`

Besitzt:

- Enemy-State,
- Zielwahl,
- Ziel-Shortlist,
- lokale Stellungssuche,
- Cover-/Threat-Scoring,
- Mindestreichweitenverhalten,
- Windup-Freigabe,
- Bewegungsoverride,
- Angriffssperre während Windup.

## 24.2 `MortarStrikeSystem`

Besitzt:

- aktive Strikes,
- `armedAt`,
- `launchAt`,
- `impactAt`,
- Cancel vor Launch,
- unabhängige Weiterführung nach Launch,
- Snapshot,
- Impact-Callback.

## 24.3 `MortarRenderer`

Besitzt:

- Warnmarker,
- Windup-Fortschritt,
- Source-Glow,
- Source-Partikel,
- THUMP-VFX,
- Rauch,
- kurze Launch-Shell,
- committed Marker,
- Schlagschatten,
- finale Shell-Annäherung.

## 24.4 Damage bleibt in bestehenden Pfaden

Der Mortar-Code soll allgemeine Damage-Systeme aufrufen und nicht replizieren.

Insbesondere:

- CombatSystem / bestehende AoE-Damage-Helfer für Spieler/Basis,
- `EnvironmentDamageResolver` für Umgebung/Konstrukte,
- BaseManager für kanonischen Basiszustand,
- bestehende Explosions-RPC für Präsentation.

---

# 25. Bezug zur vorhandenen Codebasis

Folgende vorhandene Komponenten sind bei der Implementierung ausdrücklich als Ausgangspunkt zu prüfen bzw. zu nutzen:

### Enemy-Konfiguration

- `src/config/coopDefenseEnemies.ts`
- `src/config/coopDefenseEnemies.json`

Neuer optionaler Config-Block, sinngemäß:

```ts
interface CoopDefenseEnemyMortarConfig {
  minRangePx: number;
  preferredRangeMinPx: number;
  maxRangePx: number;

  windupMs: number;
  flightMs: number;
  postImpactDelayMs: number;

  impactRadiusPx: number;
  maxDamage: number;
  minDamage: number;

  baseDamageMult: number;
  constructionDamageMult: number;
  rockDamageMult: number;

  coverSearchActivationMarginPx: number;
  localSearchRadiusPx: number;
  threatScanRadiusPx: number;
  maxCoverThreats: number;

  minRepositionImprovement: number;
}
```

Die genaue Form kann abweichen. Wichtig ist, dass Mortar-Werte data-driven bleiben.

### Normale Gegnerwaffen

- `src/systems/CoopDefenseEnemyAttackSystem.ts`

Bite dort belassen; Mörser nicht als normale Direct-Fire-Waffe erzwingen.

### Spezialbewegung

- `src/entities/EnemyManager.ts`
- `src/systems/CoopDefenseTimebombSystem.ts`

Bestehendes Movement-Override-/Special-Movement-Muster wiederverwenden.

### Globale Navigation / lokale Topologie

- `src/systems/EnemyFlowFieldService.ts`
- `src/systems/flowfield/*`

Flow-Field bleibt globaler Navigationskern. Lokale Cover-Kandidaten verwenden dieselbe Topologie.

### Combat Positioning

- `src/systems/CoopDefenseEnemyCombatPositioningSystem.ts`

Nicht mit Mortar-Cover-Scoring überladen. Das bestehende System ist bewusst auf einfachen Spielerabstand ausgelegt.

### Zielquellen

- `src/systems/EnemyAiTargetCatalog.ts`
- `src/systems/EnemyStrategicTargetService.ts`
- `src/entities/BaseManager.ts`
- `src/systems/PlacementSystem.ts`
- `src/config/coopDefenseConstructions.ts`

Vorhandene semantische Quellen kombinieren; keine zweite vollständige World-Entity-Liste im Mortar-System pflegen.

### LoS / Cover

- `src/systems/CombatSystem.ts`
- `src/systems/ArenaObstacleIndex.ts`
- `src/systems/CombatGeometry.ts`

Cover-Prüfungen müssen dieselbe Geometrie wie normale Combat-LoS verwenden.

### Strike-Lifecycle

- `src/systems/AirstrikeSystem.ts`

Als Strukturvorbild für einen kleinen host-autoritativen Timed Strike verwenden.

### Fall-Illusion

- `src/effects/MeteorRenderer.ts`

Schlagschatten + Scale-Up als Referenz.

### Target-Telegraph

- `src/effects/AirstrikeRenderer.ts`
- `src/powerups/NukeRenderer.ts`

Visuelle Primitive / Void-Palette wiederverwenden, aber eigenständige Mortar-Lesbarkeit erhalten.

### THUMP / One-Shot

- `src/effects/MuzzleFlashRenderer.ts`
- GPU-VFX-System

Wenn sinnvoll generisch um Mortar-Preset erweitern.

### Impact

- `src/effects/EffectSystem.ts`
- `src/effects/ExplosionVisualProfiles.ts`
- `src/effects/ExplosionGpuRenderer.ts`

Generisches Mortar-Explosionprofil statt separater Kopie.

### Environment Damage

- `src/systems/EnvironmentDamageResolver.ts`

Zentraler Pfad für Felsen/Konstrukte.

### Renderer-Wiring

- `src/scenes/arena/RendererBundle.ts`

MortarRenderer als scene-lifetime Renderer analog Airstrike/Meteor einbinden.

### Netzwerk

- `src/network/NetworkBridge.ts`
- `src/network/enemySnapshotCodec.ts`
- `src/types.ts`

Eigener Strike-Snapshot im GameState; Enemy-SpecialAction-Codec möglichst unangetastet lassen.

---

# 26. Nicht-Ziele

Für die erste Umsetzung ausdrücklich nicht vorgesehen:

- reale 3D-Parabel,
- kontinuierlich sichtbares Geschoss über die gesamte Flugbahn,
- komplexe Mörser-/Charakteranimation,
- sichtbares separates Mortar-Weapon-Sprite,
- Homing,
- Target-Prediction nach Windup-Start,
- Retargeting während Windup,
- Abbruch durch normalen Schaden,
- Abbruch durch Nahbereich nach Windup-Start,
- Dodge,
- Burrow,
- Translocator,
- schneller Kiting-Algorithmus,
- globaler taktischer Pathfinder,
- perfekte Cover-Suche über die gesamte Arena,
- per-Frame-Vollscan aller Gefahren,
- HP-basierte Overkill-Prognose mehrerer Mörser,
- komplexe AoE-Multi-Target-Optimierung,
- Friendly Fire gegen andere Gegner,
- absichtliches Beschießen natürlicher Felsen,
- absichtliches Beschießen unzerstörbarer Konstrukte,
- Mortar-spezifische Kopie allgemeiner Damage-/Explosion-/LoS-Systeme,
- neuer Enemy-`specialAction` nur zur Darstellung des Windups,
- verpflichtende Sounds in V1.

---

# 27. Implementierungsphasen

Die Phasen sind so gewählt, dass früh ein testbarer Gameplay-Kern entsteht und die taktische KI anschließend getrennt ergänzt werden kann.

---

## Phase 1 – Mortar-Config und Strike-Lifecycle

### Ziel

Host-autoritatives Grundmodell ohne komplexe KI oder finale Darstellung.

### Umfang

- `mortar`-Config-Block in Enemy-Konfiguration.
- `MortarStrikeSystem`.
- `SyncedMortarStrike`.
- `armedAt`, `launchAt`, `impactAt`.
- Windup 2000 ms.
- Flug 1000 ms.
- Cancel pending Strike bei Source-Tod vor `launchAt`.
- Strike bleibt nach `launchAt` unabhängig bestehen.
- Impact-Callback.
- GameState-/NetworkBridge-Integration.
- Unit Tests für zeitliche Grenzen.

### Pflicht-Testfälle

- Strike startet als Windup.
- Source stirbt 1 ms vor `launchAt` -> kein Impact.
- Source stirbt exakt/nach Launch-Grenze -> Impact bleibt.
- Strike landet exakt einmal.
- Target-Point verändert sich nicht.
- Snapshot enthält keine gameplayinternen Damage-/AI-Daten.
- Clear/Teardown entfernt aktive Strikes.

### Abnahmekriterium

Ein programmgesteuert gestarteter Strike besitzt den vollständigen korrekten Lifecycle Host → Client, auch ohne Mortar-AI.

---

## Phase 2 – Basisgegner und Angriff

### Ziel

Spielbaren Mörser-Dachs ohne taktische Cover-KI erhalten.

### Umfang

- Enemy-Registry-Eintrag `mortar-badger`.
- langsam / fragil.
- normaler Bite im bestehenden AttackSystem.
- globale Flow-Field-Anfahrt.
- Mörserzielauswahl:
  - Basis,
  - zerstörbare Konstrukte,
  - Spieler/player-like.
- natürliche Felsen ausschließen.
- unzerstörbare Konstrukte ausschließen.
- feste Target-Position.
- 300 px Mindestreichweite.
- 700–1000 px Belagerungsbereich.
- 2 s Windup.
- vollständiger Stillstand im Windup.
- reguläre Angriffe während Windup blockieren.
- nach Impact mindestens 1 s bis neuer Windup.
- Bewegung während Recovery erlauben.
- räumlicher Multi-Mortar-Overlap-Malus.

### Abnahmekriterium

Der Gegner kann sich normal über Flow-Field annähern, einen gültigen festen Zielpunkt wählen, telegraphiert zwei Sekunden, lässt sich durch Tod unterbrechen und feuert danach einen nicht mehr abbrechbaren Strike.

---

## Phase 3 – Damage und Impact

### Ziel

Vollständige Belagerungswirkung über vorhandene Damage-Pfade.

### Umfang

- radialer Falloff,
- Spieler-Schaden,
- Basis-Schaden,
- Konstruktschaden,
- natürlicher Fels-Splash,
- kein Enemy Friendly Fire,
- konfigurierbare Multiplikatoren,
- `EnvironmentDamageResolver` nutzen,
- zentrales Explosion-/Effect-RPC nutzen,
- Mortar-Explosionprofil mit physischem Blast + viel Rauch + Void-Akzenten.

### Abnahmekriterium

Gameplay- und Visualradius stimmen überein; Konstrukte/Felsen folgen ihren bestehenden zentralen Damage-/Indestructible-Regeln.

---

## Phase 4 – MortarRenderer

### Ziel

Alle Spielphasen ohne komplexe Animation klar lesbar machen.

### Umfang

- Windup-Zielkreis,
- keine Countdown-Zahl,
- sichtbarer 0→1-Zeitfortschritt,
- lila Source-Glow am Gegner,
- zunehmende Windup-Partikel,
- THUMP-Flash,
- starker Rauch-/Partikelburst,
- kurze Shell-Aufstiegsillusion,
- klarer Wechsel in committed Marker,
- wachsender Schlagschatten,
- finale Shell von oben,
- Impact über bestehenden synchronisierten Explosionseffekt,
- keine Sound-Pflicht.

### Abnahmekriterium

Ein Spieler kann allein anhand der Optik unterscheiden:

1. Ziel markiert, Angriff noch unterbrechbar.
2. THUMP erfolgt, Angriff committed.
3. Einschlag steht unmittelbar bevor.

---

## Phase 5 – Lokale Cover- und Siege-Positioning-KI

### Ziel

Dem Mörser seine charakteristische geschützte Feuerstellungs-Suche geben.

### Umfang

- Flow-Field bleibt globale Navigation.
- lokale Logik ab `maxRange + 200–300 px`.
- aktuelle Position als Kandidat.
- lokale Kandidaten bis ca. 300–500 px.
- bestehende Flow-Field-Topologie für Erreichbarkeit nutzen.
- Target-Shortlist.
- Threat-Shortlist.
- nur Gefahren im lokalen Threat-Radius.
- maximal ca. 4–6 relevante Gefahren.
- Spieler berücksichtigen.
- bewaffnete Spieler-Konstrukte berücksichtigen.
- Basistürme / relevante armed outposts berücksichtigen.
- Combat-LoS für Cover verwenden.
- Geometry/Cover und Threat separat werten.
- Positionen nach Target-Wert, Range, Cover, Exposure und Movement Cost bewerten.
- Verbesserungsschwelle / Hysterese.
- lange Bewegung nur bei deutlich höherem Nutzen.
- wenn kein gutes Cover existiert: beste offene Stellung akzeptieren.
- nach jedem Schuss Stellung neu bewerten, aber nicht zwangsläufig wechseln.
- ereignis-/intervallbasiertes Re-Evaluation statt per Frame.

### Abnahmekriterium

Der Mörser kann sichtbar:

- normale Flow-Field-Anfahrt nutzen,
- kurz vor Reichweite hinter einem Felsen eine bessere Stellung bevorzugen,
- eine bereits sehr gute Stellung nach einem Schuss behalten,
- bei zerstörter Deckung sinnvoll eine neue Stellung suchen,
- offene Stellung akzeptieren, wenn kein besseres Cover verfügbar ist,
- aufhören, für minimale Vorteile weite Wege zu laufen,
- ohne nervöses Oszillieren stabil wirken.

---

## Phase 6 – Nahbereich, Balancing und Stabilisierung

### Ziel

Counterplay und Performance finalisieren.

### Umfang

- Verhalten bei Gefahr < 300 px.
- langsames Abstandgewinnen, ohne echtes Kiting.
- Bite im Nahkampf.
- niemals neuen Mortar-Windup bei relevanter Gefahr innerhalb der Mindestreichweite.
- laufender Windup bleibt trotzdem committed.
- HP / Move Speed / XP.
- Damage / Radius / Multiplikatoren.
- Target-Gewichte.
- Cover-Score-Gewichte.
- Threat-Radius / Threat-Limit.
- Reposition-Hysterese.
- Spawnrate.
- Multiplayer Host + Client.
- mehrere Mortar-Dachse gleichzeitig.
- Performance bei vielen Konstrukten und vielen Gegnern.
- Map-Szenarien mit wenig / viel Cover.
- optional Audio später ergänzen.

### Abnahmekriterium

Der Gegner erzeugt strategischen Druck, ohne unfairen Spam, starke Direktkampf-Fähigkeit oder übermäßige CPU-Kosten.

---

# 28. Test-Szenarien

Mindestens folgende Situationen sollen gezielt automatisiert bzw. im Playtest geprüft werden.

## A. Normaler Windup

- Ziel wird gewählt.
- Marker erscheint sofort.
- Gegner glüht lila.
- Gegner steht zwei Sekunden vollständig.
- THUMP erfolgt einmal.

## B. Tod während Windup

Mörser-Dachs stirbt nach ca. 1 s.

Erwartung:

- Marker verschwindet,
- kein THUMP,
- kein Impact.

## C. Tod nach THUMP

Mörser-Dachs stirbt unmittelbar nach Abschuss.

Erwartung:

- Strike bleibt,
- Granate schlägt nach verbleibender Flugzeit ein.

## D. Ziel bewegt sich

Spieler wird beim Windup markiert und läuft weg.

Erwartung:

- Kreis bleibt an der alten Position,
- Impact dort,
- keine Zielverfolgung.

## E. Konstruktion wird verschoben

Konstrukt wird nach Windup-Start repositioniert.

Erwartung:

- Mörser folgt nicht,
- alter Weltpunkt bleibt Ziel.

## F. Ziel wird zerstört

Konstrukt wird während Windup anderweitig zerstört.

Erwartung:

- Windup läuft weiter,
- THUMP,
- Impact am ursprünglichen Punkt.

## G. Spieler betritt Mindestreichweite während Windup

Spieler läuft nach Start des Windups auf <300 px.

Erwartung:

- kein Abbruch,
- Mörser bleibt stehen,
- nur Töten kann Schuss verhindern.

## H. Spieler ist bereits innerhalb Mindestreichweite

Vor möglichem Windup steht Spieler bei ca. 200 px.

Erwartung:

- kein neuer Mortar-Windup,
- Mörser versucht langsam Abstand zu gewinnen,
- bei echter Bite-Reichweite normaler Nahkampf.

## I. Gute Felsdeckung vorhanden

Ein Ziel ist in Reichweite; zwei lokale Stellungen sind ähnlich weit.

Eine davon liegt hinter einem Felsen gegenüber Spieler/Turm.

Erwartung:

- gedeckte Stellung wird bevorzugt.

## J. Nur minimale Verbesserung weit entfernt

Aktuelle Position ist brauchbar. 350 px entfernt existiert eine nur geringfügig bessere Position.

Erwartung:

- aktuelle Position behalten.

## K. Große Verbesserung weiter entfernt

Aktuelle Position ist offen gegen mehrere Gefahren. Deutlich bessere Stellung liegt weiter entfernt.

Erwartung:

- längeres Repositioning ist erlaubt.

## L. Aktuelle Stellung bleibt gut

Nach THUMP wird Cover neu bewertet.

Erwartung:

- kein automatischer Positionswechsel,
- aktuelle Stellung bleibt bei ausreichendem Score.

## M. Deckung wird zerstört

Fels vor dem Mörser wird durch Explosion zerstört.

Erwartung:

- laufender Windup nicht abbrechen,
- nach Schuss / nächster Bewertung neue Exposure berücksichtigen.

## N. Kein Cover auf der Map

Keine lokale Position hat relevante Blocker.

Erwartung:

- Mörser feuert aus bester verfügbarer offenen Stellung,
- kein dauerhaftes Suchen.

## O. Bewaffnetes Konstrukt als Geometrie und Gefahr

Ein Turm liegt zwischen einer anderen Gefahr und dem Mörser.

Erwartung:

- Turm kann geometrisch eine Linie blockieren,
- wird selbst trotzdem als Threat bewertet,
- kein positiver Cover-Score allein aufgrund seiner eigenen Geometrie.

## P. Threat außerhalb Reichweite

Turm ist weit außerhalb seiner realen Waffenreichweite.

Erwartung:

- kein starker Exposure-Penalty,
- keine unnötige Cover-Suche gegen diesen Turm.

## Q. Viele Gefahren

Viele Spieler-Konstrukte existieren.

Erwartung:

- Threat-Radius wird eingehalten,
- nur Top-N relevante Gefahren erhalten teure LoS-Prüfung,
- keine Skalierung mit jeder Konstruktion der gesamten Map.

## R. Zwei Mörser, dasselbe Ziel

Mörser A markiert einen Turm.

Mörser B bewertet Ziele kurz danach.

Erwartung:

- räumlicher Overlap-Malus reduziert denselben Bereich,
- anderes gutes Ziel kann bevorzugt werden,
- keine harte Sperre.

## S. Kein alternatives Ziel

Nur ein wertvolles Ziel existiert.

Erwartung:

- Overlap-Malus verhindert Angriff nicht grundsätzlich,
- mehrere Strikes dürfen denselben Bereich treffen, wenn Alternativen schlechter sind.

## T. Natürlicher Fels im Impact

Fels liegt im Explosionsradius.

Erwartung:

- realer radialer Fels-Schaden,
- kann zerstört werden,
- keine absichtliche Target-Auswahl notwendig.

## U. Unzerstörbares Pedestal

Unzerstörbares Konstrukt ist vorhanden.

Erwartung:

- kein primäres Mortar-Ziel.

## V. Multiplayer

Host und Client sehen konsistent:

- denselben Target-Point,
- denselben Windup-Fortschritt,
- denselben THUMP-Zeitpunkt,
- dieselbe committed Phase,
- denselben Impact.

## W. Client erhält Strike erst im Flug

Erwartung:

- kein nachträglicher kompletter Windup,
- direkt korrekter Flug-/Shadow-Zustand,
- kein mehrfacher THUMP.

## X. Theoretische Maximal-Kadenz

Ohne Repositioning:

```text
Windup start 0.0 s
THUMP        2.0 s
Impact       3.0 s
next windup  4.0 s
next THUMP   6.0 s
```

THUMP-zu-THUMP:

```text
4.0 s
```

Keine schnellere Kadenz.

---

# 29. Performance-Anforderungen

Die taktische KI ist der performancekritischste neue Teil.

Deshalb gelten folgende Architekturregeln:

1. Keine vollständige Cover-Suche pro Frame.
2. Keine Prüfung gegen alle Konstrukte der Map je Kandidat.
3. Keine zweite Hindernisrepräsentation.
4. Keine neue globale Pfadsuche pro Mortar.
5. Zielkandidaten vor teuren Positionsprüfungen begrenzen.
6. Gefahren vor LoS-Prüfungen räumlich und nach Anzahl begrenzen.
7. Bestehende Obstacle-/Flow-Field-Indizes wiederverwenden.
8. Gecachte Ergebnisse durch Ereignisse/Intervalle invalidieren.
9. VFX bevorzugt in vorhandene GPU-VFX-/Shared-Lane-Infrastruktur integrieren.
10. Mehrere Mörser müssen ohne lineare Vollscan-Kombination über alle Weltobjekte skalieren.

Für Performance-Tests besonders relevant:

- 50–100 Gegner insgesamt,
- mehrere gleichzeitige Mörser,
- viele Persistent-Base-/Inspector-Konstrukte,
- stark verbaute Maps,
- mehrere Spieler,
- gleichzeitig laufende Strikes/VFX.

---

# 30. Offene Balancing-Werte

Bewusst noch nicht final:

- `maxHp`,
- `moveSpeed`,
- `knockbackFactor`,
- `xp`,
- Bite-Werte, falls eigener Bite-Config nötig ist,
- exakte Mörser-Mindestreichweite um 300 px,
- bevorzugter Range-Bereich innerhalb 700–1000 px,
- Explosionsradius,
- Max-/Min-Damage,
- `baseDamageMult`,
- `constructionDamageMult`,
- `rockDamageMult`,
- Target-Gewichte,
- Spieler-Target-Gewicht,
- Barrieren-Gewicht,
- Mortar-Overlap-Penalty,
- Overlap-Radius-Marge,
- Cover-Aktivierungsmarge,
- lokaler Suchradius,
- Anzahl Positionskandidaten,
- Threat-Radius,
- `maxCoverThreats`,
- Cover-/Exposure-Gewichte,
- Movement-Cost-Gewicht,
- `minRepositionImprovement`,
- Safety-Reevaluation-Intervall,
- konkrete Spacing-Geschwindigkeit bei Gefahr <300 px,
- Spawn-Häufigkeit,
- erste Map / Encounter,
- maximale empfohlene Anzahl gleichzeitiger Mörser.

Die festgelegten Zeitwerte bleiben dagegen für den ersten Prototyp klar:

```text
Windup:              2000 ms
Flight:              1000 ms
Post-Impact minimum: 1000 ms
```

---

# 31. Definition of Done

Der Mörser-Dachs gilt für V1 als vollständig umgesetzt, wenn:

- ein eigener `mortar-badger` als langsamer, fragiler Belagerungsgegner existiert,
- normaler Bite über das bestehende Enemy-Attack-System läuft,
- Mörserangriff als eigene Ability und nicht als normale Direct-Fire-Waffe implementiert ist,
- globale Bewegung weiter über vorhandene Flow-Fields läuft,
- lokale taktische Stellungssuche erst nahe des Belagerungsbereichs aktiviert wird,
- Cover-Kandidaten nur lokal gesucht werden,
- aktuelle Position immer ein Kandidat mit Bewegungskosten 0 ist,
- Spieler, bewaffnete Konstrukte und relevante Basistürme als lokale Gefahren bewertet werden,
- Threat-Scans räumlich und über eine maximale Anzahl begrenzt sind,
- Cover dieselben LoS-/Obstacle-Regeln wie Combat verwendet,
- Geometry-Cover und die Gefahr eines bewaffneten Konstrukts getrennt bewertet werden,
- lange Repositionierung nur bei entsprechend großem Stellungsgewinn erfolgt,
- eine gute aktuelle Stellung nach einem Schuss beibehalten werden kann,
- bei fehlender Deckung trotzdem eine offene Feuerstellung akzeptiert wird,
- Zielwert und Qualität einer verfügbaren Feuerstellung gemeinsam Einfluss auf die Zielwahl haben,
- wertvolle Konstrukte/Basis bevorzugt und Spieler gelegentlich beschossen werden,
- natürliche Felsen nie absichtlich gewählt werden,
- unzerstörbare Konstrukte nicht absichtlich gewählt werden,
- laufende Mortar-Strikes räumlich einen Ziel-Malus für andere Mörser erzeugen,
- keine HP-basierte Overkill-Simulation notwendig ist,
- der Target-Point beim Windup-Start als feste Weltposition gespeichert wird,
- der Target-Marker sofort sichtbar ist,
- der Windup exakt 2 s dauert,
- der Mörser während des Windups vollständig stillsteht,
- nur der Tod vor THUMP den Angriff abbrechen kann,
- THUMP den eindeutigen Point of no Return bildet,
- ein nach THUMP getöteter Mörser den Strike nicht mehr verhindert,
- die Flugzeit 1 s beträgt,
- frühestens 1 s nach Impact ein neuer Windup starten darf,
- sich der Gegner während Recovery bereits repositionieren darf,
- bei Gefahr innerhalb der Mindestreichweite kein neuer Windup startet,
- der Gegner dort langsam Abstand gewinnen bzw. im echten Nahkampf Bite nutzen kann,
- der Gegner während eines bereits gestarteten Windups nicht wegen Nahbereich oder Cover-Verlust abbricht,
- Spieler/Basis/Konstrukte radialen Falloff-Schaden erhalten,
- natürliche Felsen als Kollateralschaden über den gemeinsamen Environment-Damage-Pfad beschädigt werden,
- andere Gegner keinen Mortar-Friendly-Fire-Schaden erhalten,
- Windup und Zielmarker konsequent die lila Void-Palette verwenden,
- der Mörser-Dachs selbst während Windup deutlich lila glüht,
- keine separate sichtbare Mortar-Waffe für V1 erforderlich ist,
- THUMP mit starkem Partikelburst und viel Rauch dargestellt wird,
- das Geschoss nicht horizontal über die Map fliegt,
- Schlagschatten + späte Shell-Darstellung die Fallhöhe vermitteln,
- der Marker vor und nach THUMP klar unterschiedliche Zustände zeigt,
- der Impact physisch mit Dirt/Stein/Rauch und Void-Akzenten wirkt,
- der Strike host-autoritativ als eigener Netzwerkzustand repliziert wird,
- der Enemy-SpecialAction-Codec für V1 nicht unnötig erweitert werden muss,
- Host und Clients alle relevanten Strike-Phasen konsistent darstellen,
- Multiplayer-, Cover-, Timing- und Performance-Testfälle stabil bestehen.

---

# 32. Kurzfassung der Spielerfahrung

Der gewünschte Moment-to-Moment-Loop lautet:

```text
Mörser-Dachs nähert sich über normales Flow-Field
        |
nahe Belagerungsreichweite:
lokale geschützte Feuerstellung suchen
        |
Ziel + Stellung gewählt
        |
LILA ZIELKREIS ERSCHEINT
Mörser-Dachs beginnt stark lila zu glühen
        |
2 Sekunden:
Spieler können den Angriff noch durch Töten verhindern
        |
THUMP + Partikel + viel Rauch
        |
Point of no Return
        |
1 Sekunde:
committed Zielmarker + wachsender Schlagschatten
        |
Granate erscheint von oben
        |
IMPACT
        |
Deckung, Ziel und Stellung neu bewerten
        |
mindestens 1 Sekunde nach Impact:
neuer Windup nur, wenn die aktuelle/erreichte Stellung ausreichend gut ist
```

Der zentrale emotionale Effekt soll sein:

> **„Da hinten leuchtet ein Mörser-Dachs – wenn wir ihn jetzt nicht holen, schlägt es gleich bei uns ein.“**

Und nach dem THUMP:

> **„Zu spät für den Interrupt. Raus aus dem Kreis.“**
