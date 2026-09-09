# FRAGDACHSE – GDD: Translocator Utility Rework

## 1. Zielbild

Der Translocator bleibt in seiner Grundform ein schnelles, riskantes Mobilitätswerkzeug und wird über den Upgradebaum gezielt in drei Kernfantasien ausgebaut:

1. **Mobilität / Flucht**  
   Große Distanzen schnell überwinden, gefährliche Situationen verlassen und nach der Translokation sofort handlungsfähig bleiben.

2. **Telefrag / offensives Risiko**  
   Der Translocator kann aggressiv direkt in Gegnergruppen eingesetzt werden. Gute Puck-Platzierung und Timing sollen mit Telefrags belohnt werden.

3. **Portal-Gameplay**  
   Das Boss-Upgrade erweitert den persönlichen Teleport zu einem temporären Portalpaar, das die Kampfgeometrie verändert: Spieler können Positionen wechseln, Verbündete folgen und Angriffe können durch die Portale geführt werden.

Das System soll trotz der starken Portalmechanik **einfach lesbar und regelarm** bleiben.

Koop-Defense bestimmt Upgradebaum und Balance-Abnahme. Basis-Cooldown und Telefrag gelten
einheitlich auch in anderen Modi. Die folgenden Regeln enthalten die abgestimmten
Präzisierungen gegenüber dem ursprünglichen Entwurf.

---

# 2. Baseline-Translocator

## 2.1 Bedienung ohne Boss-Upgrade

Der Translocator besitzt drei logische Zustände:

`Bereit → Puck aktiv → Cooldown → Bereit`

### Bereit
- **E drücken/halten:** Puck entsprechend der bestehenden Wurfmechanik werfen.
- Der Cooldown startet **noch nicht**.

### Puck aktiv
- Pro Spieler existiert höchstens **ein aktiver Puck**.
- **Erneut E:** Spieler teleportiert zur aktuellen Puck-Position.
- Der Puck wird dabei beendet/verbraucht.
- Der normale Telefrag-Check am Ziel wird ausgeführt.
- Anschließend startet der Cooldown.

### Cooldown
- Während des Cooldowns kann kein neuer Puck geworfen werden.
- Nach Ablauf kehrt die Utility in `Bereit` zurück.

Der Cooldown gehört damit zum **abgeschlossenen Translokationsvorgang**, nicht zum Wurf des Pucks.

## 2.2 Basiswerte und Telefrag

- Basis-Cooldown: **3 Sekunden**. Bestehende Wurfparameter und Lademechanik bleiben erhalten.
- Telefrag: **100 Schaden**, **16 px Radius**, kein zusätzlicher Rückstoß.
- Ausschließlich feindliche Figuren, deren Körper den Kreis schneiden, erhalten Schaden.
  Der Besitzer, Mitspieler und die Umgebung erhalten keinen Telefrag-Schaden.
- Normale anwendbare Schadensmodifikatoren bleiben wirksam. Es gibt keine garantierten Kills
  und keine besondere Boss-Schadensformel. Ankunftsgefahren bleiben wirksam.
- Ein ungültiger Teleportversuch verbraucht weder Puck noch Einsatz.
- Ein neuer E-Tastendruck löst die Folgeaktion sofort aus. Derselbe Tastendruck kann ein Paar
  nicht zugleich öffnen und schließen.

## 2.3 Lebensdauer und Inventar

- Ein Puck hat keine neue reguläre Ablauffrist und keine Rücknahmeaktion.
- Puckverlust ohne Teleport beginnt den normalen Cooldown.
- Utility-Wechsel erhält Puck, Paar und Cooldown. Die bestehende Utility-Auswahl hält
  Folgeaktionen auch nach Verbrauch der letzten temporären Ladung erreichbar.
- Temporäre Ladungen werden einmal beim erfolgreichen Wurf verbraucht, niemals zusätzlich
  beim Teleport oder Schließen.
- Effektive Einsatzwerte werden beim Wurf festgehalten. Inventar- und Buildänderungen
  verändern einen laufenden Einsatz nicht rückwirkend.
- Besitzertod entfernt einen aktiven Puck beziehungsweise schließt das Portalpaar und beginnt
  den Cooldown. Eigene Translocator-Buffs enden. Ein Respawn in derselben Einsatz-Lifetime
  umgeht den Cooldown nicht.
- Disconnect, World-Abbau und Ende des zugehörigen Spielabschnitts räumen Zustand und
  Darstellung vollständig auf, ohne zusätzlichen Kollaps.

---

# 3. Upgradebaum

```text
                 TRANSLOCATOR
                 /          \
               L1            R1
               |             |
               L2            R2
                 \          /
                    BOSS
                   /    \
                 BL1    BR1
```

| Knoten | Stufen | Kerneffekt |
|---|---:|---|
| L1 | 3 | Cooldown −20 % je Stufe |
| L2 | 3 | Nach Translokation +10 % Bewegung je Stufe |
| R1 | 3 | Nach Translokation +10 HP/s Regeneration je Stufe |
| R2 | 3 | Telefrag-Radius +20 % je Stufe |
| Boss | 1 | Temporäres bidirektionales Portalpaar |
| BL1 | 3 | Risskollaps beim Schließen der Portale |
| BR1 | 3 | +20 % Schaden je Stufe für Angriffe durch Portale |

Alle Zahlen sind initiale, leicht tweakbare Balancewerte.

L2 verlangt L1 auf Stufe 1; R2 verlangt R1 auf Stufe 1. Der Boss verlangt L2 und R2
jeweils auf Stufe 1. Normale Stufen kosten einen Upgradepunkt, der Boss einen Bosspunkt.
Beide Folgeäste können gemeinsam ausgebaut werden. Die bisherigen drei Translocator-Knoten
werden ersetzt; entfallene IDs verarbeitet die vorhandene Profilbereinigung ohne Kaufmigration.

---

# 4. Pre-Boss-Upgrades

## L1 – Schnellere Rekalibrierung
**3 Stufen**

Reduziert den effektiven Translocator-Cooldown additiv um **20 % des Basis-Cooldowns je Stufe**.

- Stufe I: −20 %
- Stufe II: −40 %
- Stufe III: −60 %

Bei einem Basis-Cooldown von 3,0 s entspräche dies:

- 2,4 s
- 1,8 s
- 1,2 s

Der Cooldown startet weiterhin erst nach Abschluss der normalen Translokation bzw. nach Ende eines Boss-Portalpaars.

---

## L2 – Phasenschub
**3 Stufen**

Nach einer erfolgreichen Translokation erhält der Spieler für **2 Sekunden** zusätzliche Bewegungsgeschwindigkeit.

- Stufe I: +10 %
- Stufe II: +20 %
- Stufe III: +30 %

Regeln:
- Der Effekt stapelt nicht mit sich selbst.
- Eine erneute Auslösung ersetzt Stärke und Dauer durch den letzten Durchgang, auch bei
  schwächerem Upgrade. Fehlt das Upgrade beim neuen Portalbesitzer, bleibt der laufende Effekt unverändert.
- Mit aktivem Boss-Upgrade erhalten auch **verbündete Spieler** Phasenschub, wenn sie erfolgreich eines der Portale durchqueren.
- Gegner erhalten den Effekt nie.

Designziel: Nach offensiver Translokation oder Flucht schnell Abstand gewinnen bzw. repositionieren.

---

## R1 – Phasenregeneration
**3 Stufen**

Nach einer erfolgreichen Translokation erhält der Spieler für **3 Sekunden** zusätzliche HP-Regeneration.

- Stufe I: +10 HP/s
- Stufe II: +20 HP/s
- Stufe III: +30 HP/s

Maximale zusätzliche Heilung bei voller Dauer:

- Stufe I: 30 HP
- Stufe II: 60 HP
- Stufe III: 90 HP

Regeln:
- Der Effekt stapelt nicht mit sich selbst.
- Eine erneute Auslösung ersetzt Stärke und Dauer durch den letzten Durchgang, auch bei
  schwächerem Upgrade. Fehlt das Upgrade beim neuen Portalbesitzer, bleibt der laufende Effekt unverändert.
- Mit aktivem Boss-Upgrade erhalten auch **verbündete Spieler** die Regeneration nach erfolgreichem Portaldurchgang.
- Gegner erhalten keine Regeneration.
- Die HP-Grenze gilt weiterhin. Andere Bewegungs- und Regenerationsquellen werden über die
  normalen Resolver kombiniert.

Designziel: Flucht und aggressive Telefrags werden robuster, ohne dem eigentlichen Teleport eine Sofortheilung zu geben.

---

## R2 – Erweiterter Telefrag
**3 Stufen**

Erhöht den **effektiven Erfassungsradius der bestehenden Telefrag-Mechanik** um **20 % des Basisradius je Stufe**.

- Stufe I: +20 %
- Stufe II: +40 %
- Stufe III: +60 %

Wichtig:
- Das Upgrade erhöht die räumliche Toleranz für den bestehenden Telefrag.
- Es erhöht nicht automatisch Telefrag-Schaden, Knockback oder andere Effekte.
- Es soll den Telefrag leichter treffen lassen, ihn aber nicht in eine frei wirkende große AoE-Explosion verwandeln.
- Beim Öffnen des Boss-Portalpaars findet weiterhin die normale Translokation zur Puck-Position statt; dieser initiale Teleport kann entsprechend von R2 profitieren.

---

# 5. Boss-Upgrade – Portalpaar

## 5.1 Neue Zustandsmaschine

Mit Boss-Upgrade erweitert sich der Ablauf auf:

`Bereit → Puck aktiv → Portalpaar aktiv → Cooldown → Bereit`

### Bereit
- **E:** Puck werfen.
- Noch kein Cooldown.

### Puck aktiv
- **E:** 
  1. Portal A wird an der aktuellen Puck-Position erzeugt.
  2. Portal B wird an der Position des Spielers **unmittelbar vor dem Teleport** erzeugt.
  3. Der Spieler teleportiert wie beim normalen Translocator zur Puck-/Portal-A-Position.
  4. Der normale Telefrag-Check des Translocators wird dort ausgeführt.
  5. Das Portalpaar wird aktiv.

### Portalpaar aktiv
- Standard-Lebensdauer: **5 Sekunden**.
- Währenddessen kann kein neuer Puck geworfen werden.
- **E:** Portalpaar sofort manuell schließen.
- Ohne Eingabe schließt es automatisch nach Ablauf der 5 Sekunden.

### Portalende
Manuelles und automatisches Schließen sind spielmechanisch gleichwertige Wege, das Portalpaar zu beenden.

Nach dem Schließen:
- Portalpaar wird entfernt.
- ggf. BL1 `Risskollaps` wird ausgelöst.
- erst **danach** startet der Translocator-Cooldown.

---

# 6. Portal-Geometrie

## 6.1 Endpunkte

Ein Portalpaar besteht aus zwei gleichwertigen Endpunkten:

- **Portal A:** ehemalige Puck-Position
- **Portal B:** ursprüngliche Spielerposition vor dem Boss-Teleport

Beide Portale sind:
- kreisförmig
- bidirektional
- Radius: **16 px**

Es gibt keine Vorder-/Rückseite und keine Portalorientierung.

---

## 6.2 Grundregel des Transfers

Ein Portal verändert **nur die Position**.

Beim Transfer bleiben unverändert:

- Welt-Flugrichtung
- Bewegungsrichtung
- Geschwindigkeit
- aktueller Bewegungszustand
- Projektiltyp
- Besitz/Quelle des Projektils
- Homing-Zustand
- Restreichweite
- Fuse-/Lebensdauerzustand
- bestehende Status- oder Projektilparameter

Beispiel:

`↗ in Portal A`  
wird zu  
`↗ aus Portal B`

Es findet **keine Rotation** relativ zu den Portalen statt.

---

## 6.3 Relative Eintrittsposition

Ein Objekt wird nicht einfach exakt in den Mittelpunkt des Zielportals gesetzt.

Der relative Offset zum Quellportal wird beibehalten.

Beispiel:

- Eintritt 8 px oberhalb des Mittelpunktes von A
- Austritt 8 px oberhalb des Mittelpunktes von B

Formal:

`ExitPosition = Zielportalzentrum + (Eintrittsposition − Quellportalzentrum)`

Dadurch bleiben mehrere gleichzeitig eintretende Objekte räumlich getrennt und die Portalwirkung fühlt sich wie eine reine Raumverschiebung an.

Es wird kein zusätzlicher künstlicher Exit-Offset in Bewegungsrichtung benötigt.

---

# 7. Welche Objekte Portale verwenden

Portale sind **neutral** und können von beiden Teams verwendet werden.

Unterstützt werden:

- Besitzer
- verbündete Spieler
- Gegner
- physische Projektile des eigenen Teams
- physische gegnerische Projektile
- Hitscan-Angriffe des eigenen Teams
- gegnerische Hitscan-Angriffe

Die Portale sind daher kein Schutzschild. Eine schlecht platzierte Verbindung kann auch vom Gegner ausgenutzt werden.

Nicht Teil des Zielbilds:
- Gegner planen keine Pfade gezielt über Portale.
- Es gibt keine dynamische Portal-Kante im Flowfield/Pathfinding.
- Gegner können ein Portal dennoch benutzen, wenn ihre normale Bewegung sie hineinführt.

---

# 8. Portal-Eintritt und Reentry-Schutz

## 8.1 Eintritt

Für Figuren und andere persistente Objekte zählt der Mittelpunkt des Objekts gegenüber der kreisförmigen Portalfläche.

Ein Portal gilt als betreten, wenn der relevante Bewegungsverlauf den Portalbereich tatsächlich erreicht.

Bei schnellen Projektilen darf ein Portal nicht nur deshalb verfehlt werden, weil das Projektil zwischen zwei Frames vollständig durch die Portalfläche fliegt.

Die Endpunkte desselben Paars benötigen mindestens **32 px Abstand**; verschiedene Paare dürfen
überlappen. Bereits beim Öffnen überlappende Figuren und Flugkörper werden erfasst. Der initial
teleportierte Besitzer ist durch die Ausgangssperre geschützt.

Alle Gegner einschließlich Bosse passieren automatisch. Dash und Rückstoß bleiben erhalten;
eingegrabene Spieler und laufende Tunneltransits passieren nicht. Nach einem Transfer arbeitet
die normale Gegnernavigation am neuen Ort weiter.

Der Ausgang wird anhand des tatsächlichen Figurenkörpers gegen Weltgrenzen und feste Geometrie
geprüft. Bei Blockierung bleibt die Figur am Eingang; es gibt keine Suche nach einem Ersatzplatz.
Gefahren an einem ansonsten gültigen Ausgang bleiben wirksam.

---

## 8.2 Kein Zeit-Cooldown

Es gibt **keinen zeitbasierten Portal-Reentry-Cooldown**.

Stattdessen wird rein räumlich verhindert, dass ein Objekt sofort endlos zwischen A und B pendelt.

---

## 8.3 Räumliches Reentry-Gate

Nach einem Transfer:

`A → B`

wird **Portal B für genau dieses Objekt gesperrt**.

Die Sperre endet erst, wenn sich der Mittelpunkt des Objekts mindestens

**48 px vom Mittelpunkt von Portal B**

entfernt hat.

Danach kann Portal B wieder normal betreten werden.

Das gleiche gilt entsprechend für `B → A`.

Diese Regel gilt generisch für:
- Spieler
- Verbündete
- Gegner
- persistente Projektile

### Initialer Boss-Teleport

Beim Öffnen des Portalpaars teleportiert der Besitzer direkt zur Puck-/Portal-A-Position.

Dieser Vorgang wird bezüglich Reentry so behandelt, als wäre der Besitzer gerade **aus Portal A ausgetreten**:

- Portal A ist für ihn zunächst gesperrt.
- Erst nach mindestens 48 px Entfernung kann er Portal A wieder betreten.

Damit wird verhindert, dass der Spieler unmittelbar nach dem Öffnen automatisch zurück durch das gerade erzeugte Portal springt.

---

# 9. Physische Projektile

Physische Projektile werden am Portal räumlich versetzt und fliegen danach normal weiter.

Erhalten bleiben insbesondere:
- Geschwindigkeit
- Flugrichtung
- Homing
- Restreichweite
- Fuse
- Explosionseigenschaften
- Schadensquelle/Ownership
- sonstige bereits vorhandene Projektilmechaniken

Das Portal erzeugt:
- keine Kopie
- keinen zusätzlichen Schuss
- keine neue Zielsuche
- keine Richtungsänderung

Ein Homing-Projektil darf nach dem Austritt normal weiterlenken.

Das Reentry-Gate aus Abschnitt 8 verhindert direkte A↔B-Schleifen.

Alle Waffen- und Utility-Flugkörper passieren, einschließlich Granaten, Molotows, Zeitblasen
und Translocator-Pucks. Heil- und Reparaturangriffe passieren mit unveränderter Supportwirkung.
Bereits entstandene Flächen, Gebäude, platzierte Objekte und Sammelobjekte werden nicht transportiert.

Schnelle Geschosse prüfen das ganze Bewegungssegment. Treffer und Blocker vor dem Portal
werden zuerst aufgelöst. Die Restbewegung wird am Ausgang fortgesetzt; die Entfernung zwischen
den Zentren verbraucht keine Reichweite. Treffer, Schilde, Detonatoren, Reiseeffekte und Spuren
betrachten ausschließlich reale Teilstrecken.

Bei überlappenden Portalen entscheidet zuerst die Eintrittsdistanz, dann die stabile Endpunkt-ID.
Ein Schutz gegen wiederholte Verbindungen ohne räumlichen Fortschritt beendet Nullstrecken-Schleifen.
Es gibt keinen zusätzlichen zeitbasierten Reentry-Cooldown.

---

# 10. Hitscan durch Portale

Hitscan besitzt kein persistentes Objekt und verwendet deshalb kein 48-px-Reentry-Gate.

Stattdessen gilt:

> **Ein einzelner Hitscan darf dasselbe Portalpaar pro Schuss höchstens einmal traversieren.**

Ablauf:

1. Ray startet normal an der Waffe.
2. Trifft er vor seinem normalen Welt-/Zieltreffer ein Portal, wird der Ray dort unterbrochen.
3. Der Eintrittspunkt wird relativ auf das andere Portal übertragen.
4. Der Ray wird vom Zielportal aus in **derselben Welt-Richtung** fortgesetzt.
5. Bereits verbrauchte Reichweite bleibt verbraucht; die räumliche Distanz zwischen den Portalzentren ist kein normal durchflogener Ray-Abschnitt.
6. Dasselbe Portalpaar darf von diesem Schuss nicht erneut benutzt werden.

Damit entstehen Schusslinien wie:

`Mündung → Portal A`  
`Portal B → Ziel`

ohne Portalrotation oder rekursive Endlosschleifen.

Bei der Trefferauflösung bleiben normale Blocker- und Trefferregeln vor und nach dem Portal erhalten.

Maßgeblich ist die tatsächliche Flugbahn ab der Waffenmündung. Ein Schütze innerhalb der
Portalfläche bekommt keinen automatischen Portalschuss. Mehrere unterschiedliche Paare je Schuss sind erlaubt.

---

# 11. Koop-Verhalten

Das Portalpaar ist ausdrücklich als Koop-Werkzeug gedacht.

Verbündete können:
- durch beide Portale laufen
- ihre Projektile durch beide Portale schießen
- Hitscan durch beide Portale führen

Zusätzlich profitieren sie von den passenden Upgrades des Portalbesitzers:

- L2: Phasenschub nach Portaldurchgang
- R1: Phasenregeneration nach Portaldurchgang
- BR1: Schadensbonus für freundliche Angriffe, die dieses Portalpaar traversieren

Die Portale selbst bleiben trotzdem neutral und können auch vom Gegner benutzt werden.

---

# 12. Post-Boss-Upgrades

## BL1 – Risskollaps
**3 Stufen**

Beim Schließen des Portalpaars kollabieren **beide Portalendpunkte gleichzeitig**.

Der Effekt wird ausgelöst:
- beim manuellen Schließen durch E
- beim automatischen Ablauf nach 5 Sekunden
- beim Tod des Besitzers

Der Kollaps:
1. zieht Gegner im Wirkungsradius kräftig zum jeweiligen Portalzentrum,
2. verlangsamt betroffene Gegner anschließend für **2 Sekunden**.

Initiale Werte:

| Stufe | Kollapsradius | Slow |
|---|---:|---:|
| I | 100 px | 20 % |
| II | 150 px | 40 % |
| III | 200 px | 60 % |

Regeln:
- Risskollaps verursacht **keinen Schaden**.
- Der Pull ist deutlich wahrnehmbar und soll Gruppen für Folgeangriffe zusammenziehen.
- Gegner werden nicht teleportiert; es handelt sich um einen kurzen starken Zug zum Mittelpunkt.
- Jeder betroffene Gegner wird pro schließendem Paar genau einmal dem näheren Endpunkt
  zugeordnet und einmal verlangsamt.
- Der Zug verwendet die bestehende Impulsverarbeitung einschließlich Gegnerresistenz und
  Hindernissen. Starttuning: **250 ms**, höchstens **1.200 px/s Anfangsimpuls**, zusätzlich
  zur verbleibenden Entfernung begrenzt.

Designziel:
- Portalende wird selbst zu einer taktischen Entscheidung.
- BL1 ist der Crowd-Control-/Setup-Ast.
- Manuelles Schließen kann bewusst genutzt werden, ohne dass automatisches Auslaufen den Upgradeeffekt verliert.

---

## BR1 – Portaldurchschlag
**3 Stufen**

Eigene und verbündete Angriffe, die das Portalpaar traversieren, erhalten einen reinen Schadensbonus.

- Stufe I: +20 % Schaden
- Stufe II: +40 % Schaden
- Stufe III: +60 % Schaden

Regeln:
- Gilt für physische Projektile.
- Gilt für Hitscan.
- Gilt nur für **freundliche Angriffe relativ zum Besitzer des Portalpaars**.
- Gegnerische Angriffe können das Portal benutzen, erhalten aber keinen Bonus.
- Ausschließlich der Schaden wird verändert.
- Slow, Knockback, Status-Effekte, Projektilgeschwindigkeit, Radius, Dauer und andere Nicht-Schadens-Eigenschaften bleiben unverändert.
- Bei Projektilen gilt der Bonus auch für den aus dem durchgeleiteten Projektil resultierenden Schaden, z. B. den normalen Treffer- oder Explosionsschaden dieses Projektils.
- Jedes unterschiedliche freundliche Paar trägt seinen erworbenen Bonus genau einmal bei.
  Der Multiplikator ist **1 + Summe der Portalboni**; es gibt keine feste Schadensobergrenze.
- Kinder und Folgeeffekte (Splitter, Kettenblitze, Brand, zurückbleibende Schadensflächen)
  erben den Stand bei ihrer Erzeugung. Erneute Durchquerung eines bereits angerechneten Paars
  erhöht den Bonus nicht nochmals.
- Ownership, Schadensquelle und Belohnungszuordnung bleiben erhalten. Neue Beiträge prüfen
  die aktuelle Zugehörigkeit des Angriffs relativ zum jeweiligen Portalbesitzer.
- Heilung und Reparatur werden nicht verstärkt.

Designziel:
- Bewusstes Schießen durch Portale wird direkt belohnt.
- Funktioniert unabhängig von konkreter Waffenart.
- Koop-Spieler können eine gut platzierte Portal-Schusslinie gemeinsam ausnutzen.
- Nichtschädigende Nebeneffekte benötigen keine Sonderbehandlung.

---

# 13. Portal-Lifetime und Schließen

Standarddauer des aktiven Portalpaars:

**5 Sekunden**

Es endet durch:
1. manuelles E des Besitzers,
2. automatischen Ablauf der Lifetime oder
3. Tod des Besitzers.

Alle drei Fälle verwenden denselben Gameplay-Abschluss, genau einmal je Paar.

Während ein Portalpaar aktiv ist:
- kein neuer Translocator-Puck
- kein zweites Portalpaar desselben Besitzers
- E hat ausschließlich die Bedeutung `Portalpaar schließen`

Nach dem Schließen:
- Portale verschwinden
- BL1 wird ggf. ausgelöst
- Cooldown beginnt

---

# 14. Telefrag und Portal klar trennen

Der klassische Telefrag gehört zur **aktiven Translokation des Besitzers zum Puck**.

Beim Boss-Upgrade geschieht diese Translokation weiterhin beim Öffnen des Portalpaars.

Daher:
- R2 verbessert weiterhin diesen offensiven Initial-Teleport.
- Normales späteres Durchlaufen eines offenen Portals ist dagegen ein **Portaltransfer**, nicht automatisch ein neuer Telefrag.
- Verbündete oder Gegner erzeugen durch bloßes Durchqueren des Portals keinen klassischen Translocator-Telefrag.

Damit bleibt Telefrag ein klarer Bestandteil der Translocator-Aktivierung und wird nicht zu einem dauerhaften 5-Sekunden-Killfeld.

---

# 15. Visualisierung und Lesbarkeit

Die Portale sollen in der Top-Down-Darstellung klar als zusammengehöriges Paar lesbar sein.

Anforderungen:
- orthografische kreisförmige Fläche; sichtbarer Rand entspricht exakt dem Gameplay-Radius
- Portal **A bläulich** am Puck-Ziel, Portal **B orange** am Absprungort
- synchroner Puls und übereinstimmende Restzeitanzeige vermitteln die Verbindung
- keine Besitzerfarben, zusätzlichen Paarsymbole oder dauerhaften Verbindungslinien
- aktive Portale deutlich von normalem Translocator-Puck unterscheiden
- Portalende bzw. Risskollaps klar telegraphieren
- Öffnung, Transfer und Kollaps erhalten unterscheidbare Effekte; die letzte halbe Sekunde
  kündigt automatisches Ende an. Manuelles Schließen bleibt unmittelbar.
- HUD und Utility-Auswahl unterscheiden Puck, verbleibende Portalzeit und Cooldown.
- Vorhandene Icons, Texturen, Effektbausteine und Sounds werden wiederverwendet; deutsche und
  englische Beschreibungen sind vorhanden. Neue externe Bild- und Audioassets sind nicht vorgesehen.

Nicht erforderlich:
- echte Portal-2-Kameraansicht
- gerenderte Sicht durch das Portal
- perspektivische Portalrotation

Die Portalmechanik soll über Position, VFX und Transfer verständlich sein.

---

# 16. Fachliche Invarianten

1. Pro Besitzer existiert höchstens ein aktiver Puck bzw. ein aktives Portalpaar.
2. Der Cooldown beginnt erst nach abgeschlossener normaler Translokation oder nach Ende des Portalpaars.
3. Portal A und B sind bidirektional und besitzen keine Orientierung.
4. Portaltransfer verändert Position, aber nicht Welt-Richtung oder Geschwindigkeit.
5. Relative Eintrittsposition wird am Zielportal beibehalten.
6. Portale können von beiden Teams und deren Angriffen benutzt werden.
7. Gegner erhalten keine AI-Sonderplanung für Portale.
8. Persistente Objekte dürfen nicht unmittelbar A↔B pendeln; Reentry erfolgt erst nach 48 px Entfernung vom Exit.
9. Hitscan darf dasselbe Portalpaar pro Schuss nur einmal nutzen.
10. Der initiale Boss-Teleport bleibt ein echter Translocator-Teleport inklusive Telefrag.
11. Spätere normale Portaltransfers sind keine automatischen Telefrags.
12. L2 und R1 unterstützen nach dem Boss auch verbündete Portalnutzer.
13. BL1 ist Crowd Control ohne Schaden.
14. BR1 verändert ausschließlich freundlichen Schaden nach Portaltraversierung.
15. Das Portal erzeugt keine Projektilkopien und verändert keine Nicht-Schadens-Effekte.
16. Manuelles, automatisches und todesbedingtes Portalende verwenden dieselbe Gameplay-Logik.
17. Alle Balancewerte sollen zentral und leicht tweakbar bleiben.

---

# 17. Beispielhafte Spielsituationen

## Flucht
1. Spieler gerät unter Druck.
2. Puck wird in sichere Entfernung geworfen.
3. E teleportiert zum Puck.
4. L2 unterstützt die weitere Flucht durch Bewegungsgeschwindigkeit.
5. R1 regeneriert während der anschließenden Repositionierung HP.

Mit Boss:
- Portal bleibt offen.
- Spieler kann von sicherer Position zurück durch das Portal auf die Gegner schießen.
- Mit BR1 wird diese Schusslinie offensiv verstärkt.

## Offensiver Telefrag
1. Puck wird in eine Gegnergruppe geworfen.
2. Spieler teleportiert hinein.
3. R2 erhöht die Telefrag-Toleranz.
4. L2 und R1 helfen, den riskanten Eintritt zu überleben.

Mit Boss:
- Portalpaar bleibt nach dem Telefrag bestehen.
- Überlebende Gegner können anschließend aus einer sichereren Position durch das Portal bekämpft werden.

## Rückzug durch das eigene Portal
1. Spieler öffnet das Portalpaar durch Teleport zum Puck.
2. Er kämpft kurz am Zielort.
3. Er läuft anschließend durch Portal A zurück zu Portal B am ursprünglichen Standort.
4. Die verbleibenden Gegner werden von dort durch das Portal beschossen.
5. BR1 erhöht den Schaden dieser bewusst durch das Portal geführten Angriffe.
6. Beim Ende kann BL1 beide Portalpositionen als Crowd-Control-Punkte kollabieren lassen.

---

# 18. Technischer Vertrag und Abnahme

`TranslocatorSystem` besitzt den kanonischen Einsatz- und Buffzustand. Ein typisierter
`TranslocatorUseState` beschreibt Puck, Paar oder Cooldown; fehlender Zustand bedeutet bereit.
`PlayerUtilityActionRuntime` verbindet diesen Zustand mit Inventar, Ladungen und eindeutigen
Wurf-/Teleport-/Schließen-/Ablehnungsergebnissen, ohne konkurrierenden Translocator-Cooldown.

Ein rendererfreier Portalresolver dient Figuren, Projektilen und Hitscan. Figuren-Owner führen
Transfers selbst aus und aktualisieren Bewegungsrevisionen, Navigation und positionsabhängige
Missionsdaten. `WorldProjectileRuntime` bleibt alleiniger Writer seiner Records. Ein typisierter
Schadenskontext trägt einmalig erworbene Portalbeiträge durch Kinder und Folgeeffekte.

World-gebundene Zustandsprojektionen übertragen Einsatzphase, stabile Paaridentität, Endpunkte
und Ablaufzeit über `NetworkBridge`. Später beitretende Clients rekonstruieren aktive Paare aus
dem aktuellen Zustand. Bestätigte Transfers unterbrechen Interpolation und Bewegungseffekte;
Projektilspuren verwenden Sprungstellen. Veraltete Nachrichten und doppelte Aktionen dürfen
keine erneuten Transfers oder Kollapswirkungen erzeugen.

Alle Werte bleiben authored Konfiguration und durchlaufen die vorhandenen Resolver und
Validatoren. Abnahme umfasst Lifecycle und Inventar, Körper- und Portalgeometrie, reale
Angriffssegmente, Schadensvererbung und Support, Buff-Erneuerung und Kollaps, Host-/Client-Parität,
Late Join sowie mehrere Paare mit vielen Projektilen. Dafür werden `npm run check` und die
betroffenen Integrations-, Stress- und Balance-Lab-Suites ausgeführt.

Die ausdrücklich gewünschte Sichtprüfung verwendet `npm run dev:browser` auf Port 8090 nach
HTTP 200. Basisbedienung, Host-/Client-Koop, Boss-Transfer, Utility-Wurf, Hitscan, Buff-Erneuerung
und Kollaps werden im sichtbaren Spiel geprüft. Nicht beobachtbare Fälle gelten als nicht
verifiziert. Blau/Orange, Flugbahnsprünge, Einsatzphase und Portalende müssen verständlich sein.
