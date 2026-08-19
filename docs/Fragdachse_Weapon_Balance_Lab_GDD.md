# GDD – Coop Defense Weapon Balance Lab

**Projekt:** Fragdachse  
**Status:** Konzept / Alpha-Tooling  
**Datum:** 2026-08-19  
**Zielbereich:** Coop Defense – Waffe 1 und Waffe 2  
**Format:** Repository-integriertes Balance- und Analysewerkzeug

---

## 1. Ziel

Das **Coop Defense Weapon Balance Lab** erweitert das bestehende Balance-Lab um eine reproduzierbare, automatisierte Analyse der regulär auswählbaren Waffen aus **Waffe 1** und **Waffe 2**.

Das Tool soll insbesondere:

- die Schadensprogression durch waffenspezifische Upgrades sichtbar machen,
- extreme Synergien und Skalierungsfehler früh erkennen,
- unterschiedliche Waffenrollen bewusst vergleichbar machen,
- Single-Target-, Multi-Target- und realistischere Kampfsituationen getrennt bewerten,
- bei Waffe 1 zusätzlich die Adrenalingenerierung ausweisen,
- bei Waffe 2 zusätzlich Adrenalinverbrauch und Einsatzdauer ausweisen,
- Zielwerte und Rollenunterschiede versioniert im Repository abbilden,
- möglichst dieselben Gameplay-Regeln wie das echte Spiel verwenden,
- bei späteren Änderungen an Burn, Verwundbarkeit, Piercing, Splitting, Homing, DoTs, Kill-Effekten usw. automatisch mit dem Gameplay synchron bleiben.

Das Tool ist **kein separater DPS-Rechner mit nachgebauten Waffenformeln**, sondern eine beschleunigte, deterministische Headless-Simulation auf Basis der echten Combat-Regeln.

---

## 2. Zentrale Architekturvorgabe

### 2.1 Single Source of Truth für Gameplay-Regeln

Das Weapon Balance Lab darf möglichst wenig Waffen- oder Schadenslogik duplizieren.

Nicht erwünscht:

```ts
if (weapon.id === 'GLOCK') {
  dps += calculateGlockBurnSeparately();
}
```

Erwünscht:

```text
Weapon Config
    ↓
echte Coop-Upgrades
    ↓
echter Weapon-Fire-/Spezialwaffenpfad
    ↓
gemeinsame Combat-Regeln
    ↓
Headless Simulation World
    ↓
gemessene Damage-/Resource-Events
```

Wenn Gameplay-Regeln aktuell zu stark mit Phaser, `CombatSystem`, `ProjectileManager`, `EnemyManager` oder anderen Runtime-Klassen verbunden sind, dürfen und sollen sie in gemeinsam nutzbare, testbare Resolver oder Domain-Systeme ausgelagert werden.

### 2.2 Zielbild

```text
                    SHARED COMBAT RULES
                  tatsächliche Gameplay-Wahrheit
                         /            \
                        /              \
                GAME RUNTIME        BALANCE LAB
                Phaser World        Headless World
                echte Entities      Simulations-Entities
                Rendering           kein Rendering
                Netzwerk            kein Netzwerk
                Echtzeit            virtuelle Zeit
```

Das Balance Lab vereinfacht die **Testsituation**, nicht die **Gameplay-Regeln**.

---

## 3. Scope

### 3.1 Enthalten

- alle regulär auswählbaren Waffe-1-Waffen
- alle regulär auswählbaren Waffe-2-Waffen
- waffenspezifische Coop-Defense-Upgrades
- Boss-Upgrades der jeweiligen Waffe
- Schaden
- Burns
- DoTs
- Explosionen
- Piercing
- Splits
- Homing
- Charge-/Warmup-Mechaniken
- Verwundbarkeit
- Kill-/Death-Effekte
- Multi-Target-Effekte
- Adrenalingenerierung
- Adrenalinverbrauch
- realistische Gegnerbewegung im Combat Scenario
- reale EnemyConfigs im Combat Scenario
- echte Encounter-/Wave-Struktur im Combat Scenario

### 3.2 Nicht enthalten

- Inspector-spezifische Waffe-2-Systeme
- allgemeine Coop-Upgrades im Standardvergleich
- Item-Boni
- Klassenboni
- Power-ups
- automatische Balance-Änderungen
- CI-Gates oder harte Balance-Alarme
- vollständige Campaign-Map-Simulation
- kombinierte automatische W1/W2-Rotation in V1

---

## 4. Progressionsstufen

Für jede Waffe werden fünf Progressionszustände analysiert.

| Stage | Normale Upgrade-Punkte | Boss-Upgrades |
|---|---:|---:|
| Base | 0 | 0 |
| Early | max. 3 | 0 |
| Mid | max. 5 | max. 1 |
| Late | max. 10 | max. 2 |
| Endgame | max. 20 | max. 2 |

### Regeln

- Der Waffen-Unlock zählt **nicht** als Upgrade-Punkt.
- Upgrade-Level zählen jeweils gegen das normale Budget.
- Boss-Upgrades besitzen ein separates Boss-Budget.
- Voraussetzungen müssen vollständig erfüllt sein.
- Nur legal erreichbare Upgrade-Kombinationen sind erlaubt.
- Hat eine Waffe weniger verfügbare Upgrades als das Budget erlaubt, wird ihr maximal möglicher Ausbau verwendet.
- Nicht nutzbare Restpunkte verfallen.
- Im Standardbenchmark werden ausschließlich waffenspezifische Upgrades berücksichtigt.

---

## 5. Automatische Build-Optimierung

Für jede Waffe und jede Progressionsstufe sucht das Tool automatisch den **besten legal erreichbaren Build**.

Die Optimierung erfolgt mindestens separat für:

1. **Single Target**
2. **5 Targets**

Optional kann später auch das Combat Scenario separat optimiert werden. In V1 darf zunächst der für den jeweiligen Benchmark beste Build verwendet und der Combat-Wert zusätzlich ausgewiesen werden.

### Anforderungen

- Upgrade-Abhängigkeiten respektieren
- Boss-Budget respektieren
- normale Upgrade-Punkte respektieren
- echte Upgrade-Profile erzeugen
- echte Coop-Modifier auf echte WeaponConfigs anwenden
- keinen Parallel-Modifierpfad im Analyzer erzeugen

### Transparenz

Das Tool muss immer anzeigen, welcher Build den Messwert erzeugt hat.

Beispiel:

```text
TESLA_DOME · MID · SINGLE TARGET

Expected DPS: 74.2

Selected upgrades:
- Additional Beams II
- Focused Conductivity III

Boss:
- Overcharge Pulse
```

---

## 6. Simulation und virtuelle Zeit

Die Simulation läuft **nicht in Echtzeit**.

Stattdessen wird virtuelle Zeit verwendet.

Beispiel:

```ts
for (let now = 0; now < 30_000; now += 16) {
  world.update(now, 16);
}
```

Damit können 30 simulierte Sekunden in sehr kurzer realer Zeit abgearbeitet werden.

### Anforderungen an zeitabhängige Gameplay-Logik

Wo relevante Combat-Regeln heute direkt auf Folgendes zugreifen:

- `Date.now()`
- `performance.now()`
- `setTimeout`
- Phaser-Timer

soll geprüft werden, ob eine explizite Zeitquelle sinnvoller ist:

```ts
now
deltaMs
Clock
```

Ziel ist:

- deterministische Tests
- beschleunigte Simulation
- identische Zeitlogik zwischen Runtime und Balance Lab

---

# 7. Benchmark A – Single Target

## 7.1 Ziel

Messung der idealisierten Single-Target-Leistung einer Waffe gegen genau ein Ziel.

## 7.2 Zielobjekt

Das Ziel ist:

- unsterblich
- unbeweglich
- exakt Spielergröße
- ohne Rüstung
- ohne eigene Angriffe
- frei sichtbar
- ohne Hindernisse
- mit echter Hitbox-/Trefferlogik

Die Spielergröße verhindert, dass Shotgun, Explosionen, Spread und Mehrfachprojektile durch eine künstlich riesige Boss-Hitbox unrealistisch bevorzugt werden.

## 7.3 Aim

Der simulierte Spieler richtet die Waffe optimal auf das Ziel aus.

### Dynamischer Accuracy-Spread

Bei Waffen mit wachsendem Spread durch Dauerfeuer wird nicht blind mit maximaler Feuerrate geschossen.

Die Simulation verwendet optimale Trigger Discipline:

> Geschossen wird nur, wenn davon ausgegangen werden kann, dass der aktuelle Spread-Kegel das Ziel noch zuverlässig erfassen kann.

Dadurch darf die Simulation auf Spread-Recovery warten.

### Absichtlich designter Multi-Pellet-Spread

Gewollte Projektilverteilung wie:

- Shotgun-Pellets
- Mehrfachbolzen
- andere Multi-Projectile-Patterns

wird nicht als „Spielerungenauigkeit“ behandelt.

Die Waffe wird optimal ausgerichtet, aber die reale Projektilverteilung bleibt bestehen. Projektile dürfen daher am Ziel vorbeigehen.

---

# 8. Benchmark B – 5 Targets

## 8.1 Ziel

Messung der Multi-Target-Leistung gegen fünf gleichzeitig vorhandene Ziele.

## 8.2 Ziele

Alle fünf Ziele sind:

- unsterblich
- unbeweglich
- Spielergröße
- frei sichtbar
- ohne Rüstung

## 8.3 Positionierung

Die Ziele stehen nicht immer in derselben festen Formation.

Für jeden deterministischen Seed werden fünf Zielpositionen innerhalb eines definierten Testbereichs erzeugt.

Dadurch entstehen über mehrere Seeds unter anderem:

- enge Gruppen
- mittlere Cluster
- größere Abstände

Das ist besonders relevant für:

- AoE
- Explosionen
- Chain Lightning
- Tesla
- Piercing
- Shotgun
- Hydra
- ASMD
- Ground Effects
- Homing

## 8.4 Hauptkennzahl

Die zentrale Kennzahl lautet:

**5T Expected Total DPS**

Sie ist der gesamte Schaden pro Sekunde über alle fünf Ziele.

Nicht der durchschnittliche Schaden pro Ziel.

Beispiel:

```text
Target 1: 40 DPS
Target 2: 30 DPS
Target 3: 20 DPS
Target 4: 30 DPS
Target 5: 40 DPS

5T DPS = 160
```

---

# 9. Benchmark C – Combat Scenario

## 9.1 Ziel

Das Combat Scenario ist ein dritter, spielnäherer Benchmark neben Single Target und 5 Targets.

Es soll insbesondere Mechaniken abbilden, die in statischen Dummy-Tests nur schlecht bewertet werden können:

- Kill-Effekte
- Death-Effekte
- Overkill
- Zielwechsel
- Homing
- AoE-Ausnutzung
- Burns
- DoTs
- Killstreaks
- Splitting
- Piercing
- neue Gegner während laufender Flächeneffekte
- echte Bewegung
- Gruppendynamik
- echte Gegnergrößen und HP

Das Combat Scenario soll keine künstliche Kopie der Arena erzeugen, sondern möglichst bestehende Coop-Defense-Systeme wiederverwenden.

---

## 9.2 Echte Encounter-/Wave-Logik

Für den Enemy Stream soll die bereits vorhandene Encounter-/Wave-Architektur verwendet werden.

Das Balance Lab definiert dafür eine eigene kleine, versionierte Serie von **Balance Encounters**.

Beispiel:

```text
Wave 1 – kleine Gruppe
6 × leichter Gegner

Pause

Wave 2 – Einzelziel
1 × robuster Gegner

Pause

Wave 3 – Horde
10 × leichter Gegner

Wave 4 – Mixed
5 × leicht
2 × mittel

Wave 5 – Heavy
1 × stark
4 × leicht
```

Die konkrete Zusammenstellung wird später anhand einer kleinen repräsentativen Auswahl echter Coop-Defense-Gegner festgelegt.

Es müssen ausdrücklich **nicht alle Gegnerarten** im Spiel verwendet werden.

---

## 9.3 Echte Gegnerwerte

Im Combat Scenario werden keine künstlichen `LIGHT / MEDIUM / HEAVY`-Dummys verwendet.

Stattdessen werden reale Gegner aus den echten `coopDefenseEnemies`-Konfigurationen verwendet.

Damit gelten automatisch:

- echte HP
- echte Hitboxgröße
- echte Bewegungsgeschwindigkeit
- echte Death-Spawns
- echte Death-Effekte
- echte für den Waffenoutput relevante Eigenschaften
- echte Statusinteraktionen

Wenn sich ein EnemyConfig später ändert, wirkt sich diese Änderung automatisch auf den Combat-Benchmark aus.

---

## 9.4 Repräsentative Gegnerauswahl

Das Combat Scenario soll bewusst eine kleine, stabile Auswahl an Gegnern verwenden.

Die Auswahl sollte verschiedene Balance-Situationen repräsentieren, beispielsweise:

- kleiner, schwacher Standard-Nahkämpfer
- etwas robusterer Gegner
- größerer / stärkerer Gegner
- optional ein Gegner mit relevantem Death-Effekt
- optional ein Gegner mit größerer Hitbox

Die Auswahl bleibt versioniert und wird nicht pro Test zufällig gewechselt.

---

## 9.5 Echte Flowfield-Bewegung

Das Combat Scenario soll die bestehende Flowfield-Logik wiederverwenden.

Ziel:

- echte Pfadrichtung
- echte Bewegungsgeschwindigkeit
- echte Separation
- echte Gegnergröße
- echte Gruppendynamik

Die Balance-Arena bleibt dabei bewusst einfach, damit Terrain nicht die Waffenmessung dominiert.

### Referenz-Arena

Beispiel:

```text
SPAWN FRONT
    ↓
    ↓
    ↓

========================
      COMBAT AREA

         PLAYER

========================
       FLOW GOAL
```

Standardmäßig:

- keine Felsen
- keine Gleise
- keine Konstruktionen
- keine komplexen Hindernisse
- keine zufällige Map-Topologie

Das Flowfield ist real, die Arena selbst bleibt kontrolliert.

---

## 9.6 Spawnlogik

Wo sinnvoll, sollen bestehende Komponenten wiederverwendet werden:

- CoopDefenseMapDirector / Encounter Director
- CoopDefenseSpawnExecutor
- EnemyFlowFieldService
- reale EnemyConfigs
- Shared Enemy Movement Rules

Der Combat-Test soll nicht einen neuen Wave- oder Spawn-Scheduler im Balance Lab besitzen, wenn die bestehende Encounter-Architektur denselben Zweck erfüllt.

---

## 9.7 Zufall im Combat Scenario

Die **Zusammenstellung und Reihenfolge der Balance-Waves bleibt fest**.

Seeds variieren nur Dinge wie:

- Spawnpositionen innerhalb erlaubter Bereiche
- leichte räumliche Gruppierung
- interne RNG-Procs
- andere bereits echte zufallsabhängige Gameplay-Effekte

Dadurch bleibt ein Vergleich zwischen zwei Code-Versionen aussagekräftig.

Beispiel:

```text
Seed 1:
dieselben 6 Gegner kommen relativ eng

Seed 2:
dieselben 6 Gegner verteilen sich breiter

Seed 3:
dieselben 6 Gegner erreichen den Kampfbereich leicht versetzt
```

Nicht erwünscht:

```text
Seed 1:
6 schwache Gegner

Seed 2:
1 Boss

Seed 3:
15 Fernkämpfer
```

Die Testlast muss zwischen Seeds strukturell vergleichbar bleiben.

---

## 9.8 Gegnerangriffe

Gegnerangriffe auf den simulierten Spieler gehören **nicht** zum Standard-Combat-Scenario.

Aktiv:

- Bewegung
- HP
- Tod
- Death-Effekte
- Death-Spawns
- relevante Statusmechaniken
- Collision-/Hitbox-Verhalten
- für Waffenoutput relevante Spezialmechaniken

Nicht Teil des Standardtests:

- Spieler-HP
- Survival
- Verteidigung
- Ausweichen wegen gegnerischem Schaden
- Niederlage

Das Tool soll Waffenoutput messen, nicht Spielerüberleben.

---

# 10. Combat-Controller

Der simulierte Spieler benötigt einen allgemeinen Aim-/Fire-Controller.

Ziel:

**optimal und reproduzierbar spielen, ohne eine eigene komplexe KI pro Waffe zu bauen.**

## 10.1 Grundregeln

- Ziel innerhalb effektiver Reichweite wählen
- optimal ausrichten
- Spread-Recovery berücksichtigen
- neue Ziele nach Tod sauber übernehmen
- bei AoE-Waffen einen sinnvollen Zielpunkt innerhalb der Gegnergruppe wählen
- Kill-/Death-Effekte dürfen natürlich aus der echten Simulation entstehen
- keine Kenntnis zukünftiger RNG-Procs verwenden

## 10.2 V1

Der Controller darf zunächst relativ einfach sein.

Für AoE:

- Mittelpunkt relevanter erreichbarer Gegner
- optional gewichtete Position nach Gegnerdichte

Für Single-Target-lastige Waffen:

- sinnvolles aktives Ziel

Spätere Versionen können die Controller-Qualität verbessern.

---

# 11. Damage-Messung

## 11.1 Single Target / 5 Targets

Gemessen wird tatsächlich verursachter Schaden aus der echten Damage-Pipeline.

## 11.2 Combat Scenario

Die Hauptkennzahl lautet:

**Combat DPS**

```text
effektiv verursachter Schaden
÷
Simulationsdauer
```

### Overkill

Schaden über die verbleibenden HP hinaus zählt nicht als effektiver Combat Damage.

Beispiel:

```text
Gegner besitzt noch 20 HP
Treffer verursacht theoretisch 500 Schaden

Combat Damage = 20
Overkill = 480
```

Optional kann Overkill separat ausgewiesen werden.

---

# 12. Zusätzliche Combat-Metriken

Für V1 ist nur **Combat DPS** zwingend.

Später sinnvoll:

- Kills pro Sekunde
- Overkill / wasted damage
- durchschnittliche Ziel-Lebensdauer
- Targets hit per shot
- tatsächliche AoE-Ausnutzung
- durchschnittlich aktive Burns/DoTs
- Target-Switch-Häufigkeit

Diese Werte dürfen später ergänzt werden, ohne den Hauptscore zu verändern.

---

# 13. RNG und deterministische Seeds

Das Balance Lab verwendet deterministischen RNG.

Gleicher:

- Code
- Build
- Config
- Seed

muss dasselbe Ergebnis liefern.

### Verwendung

Seeds bestimmen beispielsweise:

- 5T-Zielpositionen
- Combat-Scenario-Spawnpositionen
- Plasma-Procs
- zufällige Projektilmechaniken
- andere Gameplay-RNG-Effekte

### Hauptwert

Bei RNG-abhängigen Tests wird über mehrere Seeds gemittelt.

Hauptwert:

**Expected**

Zusätzliche Details:

- P10
- Median
- P90
- Maximum / beobachtetes Ceiling

---

# 14. Ergebnisqualität

Jeder Messwert darf eine Qualitäts-/Interpretationskennzeichnung erhalten.

## EXACT

Nahezu deterministisch.

## EXPECTED

RNG wurde über mehrere Seeds gemittelt.

## GEOMETRY

Starke Abhängigkeit von räumlicher Verteilung.

## CONDITIONAL

Benötigt spezielle Voraussetzungen, z. B. vorbereitete Kills.

Diese Klassifikation verhindert, dass alle Zahlen als gleich exakt interpretiert werden.

---

# 15. Kill-basierte Mechaniken

In Single Target und 5 Targets sind Ziele unsterblich.

Daher entstehen dort keine natürlichen Kills.

Standard:

**0 vorbereitete Kills**

Optional können Details anzeigen:

```text
Conditional DPS @ 5 kills
Conditional DPS @ 10 kills
```

Solche Werte fließen nicht in den normalen Max-Build-Optimizer ein.

Im Combat Scenario entstehen Kills natürlich und lösen echte Kill-/Death-Mechaniken aus.

---

# 16. Waffe 1 – zusätzliche Ressourcenmetriken

Für Waffe 1 werden je Progressionsstufe mindestens ausgewiesen:

- ST DPS
- 5T DPS
- Combat DPS
- Adrenalin pro Sekunde

Adrenalin/s wird unter denselben Testbedingungen gemessen.

Eine Waffe darf dadurch bewusst weniger Schaden verursachen, aber deutlich besser Waffe 2 finanzieren.

---

# 17. Waffe 2 – zusätzliche Ressourcenmetriken

Für Waffe 2 werden je Progressionsstufe mindestens ausgewiesen:

- ST Active DPS
- 5T Active DPS
- Combat Active DPS
- Adrenalinverbrauch pro Sekunde
- theoretische Einsatzdauer bei 100 Adrenalin

Beispiel:

```text
Drain: 20 / s
100 Adrenalin → 5.0 s aktive Nutzung
```

---

# 18. Kein kombinierter W1/W2-DPS in V1

V1 erzeugt keinen automatischen Sustained-DPS eines Waffenpaares.

Dafür müsste bereits eine konkrete Rotation festgelegt werden:

```text
x Sekunden W1
→
y Sekunden W2
→
zurück zu W1
```

Das wäre eine zusätzliche Gameplay-Annahme.

Stattdessen werden zunächst nebeneinander dargestellt:

```text
W1 Adrenalin/s
W2 Adrenalinverbrauch/s
```

Ein Pair-Simulator kann später ergänzt werden.

---

# 19. Zielwertmodell

## 19.1 Referenzpaar

Zunächst wird ein Waffenpaar, z. B.:

- Glock
- P90

manuell sinnvoll balanciert.

Aus diesem Paar werden Referenzkurven für die fünf Progressionsstufen abgeleitet.

Beispiel:

```text
              Base  Early  Mid  Late  Endgame

W1 ST
W1 5T
W1 Combat
W1 Adr/s

W2 ST
W2 5T
W2 Combat
W2 Drain/s
```

## 19.2 Rollenfaktoren

Andere Waffen erhalten Multiplikatoren relativ zu dieser Referenz.

Beispiel:

```text
BITE
ST      1.50
5T      0.80
Combat  1.10

LEAF_BLOWER
ST      0.25
5T      0.40
Combat  0.60
```

Dadurch kann ein Leaf Blower bewusst viel weniger Schaden als Bite verursachen, ohne als „unterbalanciert“ zu gelten.

---

# 20. Zielgrößen

Mindestens folgende Zielgrößen müssen unterstützt werden:

- ST DPS
- 5T DPS
- Combat DPS
- W1 Adrenalin/s
- W2 Adrenalinverbrauch/s

Utility-/Control-Effekte werden **nicht** in einen künstlichen Gesamtwert umgerechnet.

---

# 21. Utility-/Control-Informationen

Zusätzlich zur Damage-Tabelle können relevante Eigenschaften angezeigt werden:

- Knockback
- Slow
- Verwundbarkeit
- Lifeleech
- Heilung
- Damage Reduction
- Reflexion
- Homing
- Piercing
- Range
- Movement Penalty
- Charge/Warmup
- Kill-basierte Voraussetzungen

Diese Informationen dienen der Interpretation, nicht einem universellen Weapon Score.

---

# 22. Versionierte Balance-Ziele

Zielwerte liegen im Repository.

Beispiel:

```text
src/debug/coopDefenseBalance/
    weaponTargets.ts
```

oder:

```text
src/config/coopDefenseWeaponBalanceTargets.json
```

Vorteile:

- Git-Historie
- Reviewbarkeit
- reproduzierbare Balance-Stände
- saubere Diffs
- keine Abhängigkeit von `localStorage`

---

# 23. UI-Integration

Das bestehende Balance Lab erhält einen neuen Bereich.

Beispiel:

```text
COOP DEFENSE BALANCE LAB

[ MAP BALANCE ]
[ WEAPON BALANCE ]
```

## Haupttabelle

| Weapon | Stage | ST | Target | 5T | Target | Combat | Target | Resource |
|---|---|---:|---:|---:|---:|---:|---:|---:|

Beispiel:

```text
BITE · MID

ST       151    Target 142    +6 %
5T       221    Target 240    -8 %
Combat   167    Target 160    +4 %
Adr/s    171    Target 165    +4 %
```

Keine automatische Änderungsempfehlung.

---

# 24. Detailansicht

Beispiel:

```text
P90 · ENDGAME

Single Target
Expected: 182
Target: 175
Deviation: +4 %

5 Targets
Expected: 207
Target: 220
Deviation: -6 %

Combat
Expected: 191
Target: 200
Deviation: -5 %

Adrenaline drain:
38.5 / s

100 adrenaline:
2.60 s

Selected ST Build:
...

Selected 5T Build:
...

Simulation:
30 seeds

ST:
P10 ...
Median ...
P90 ...

5T:
P10 ...
Median ...
P90 ...

Combat:
P10 ...
Median ...
P90 ...
```

---

# 25. CSV / Export

Das Weapon Balance Lab sollte seine Ergebnisse analog zum bestehenden Balance Lab exportieren können.

Mindestens sinnvoll:

- Summary CSV
- Build Details CSV oder JSON
- Target Comparison CSV

Beispielspalten:

```text
weaponId
slot
stage
scenario
expectedDps
p10
median
p90
targetDps
deviationPercent
adrenalinePerSecond
adrenalineDrainPerSecond
selectedUpgrades
selectedBossUpgrades
rulesetVersion
```

---

# 26. Gemeinsame Combat-Regeln

Folgende Systeme sollen nicht separat im Analyzer nachgebaut werden:

| Bereich | Ziel |
|---|---|
| WeaponConfig | echte Config |
| Upgrade-Auflösung | echte Coop-Upgrades |
| Fire Dispatch | gemeinsamer Fire-Pfad |
| Damage Modifier | echte Schadensresolver |
| Burn | gemeinsamer Burn-State/-Resolver |
| Verwundbarkeit | gemeinsamer Target-Status |
| Explosionen | gemeinsamer Radial-Damage-Resolver |
| Ground DoT | gemeinsamer Damage-State |
| Plasma | echte Charge-/Swarm-Regeln |
| Piercing | gemeinsamer Projectile-Resolver |
| Hydra | gemeinsamer Split-Resolver |
| ASMD | gemeinsamer Detonation-/Combo-Pfad |
| Tesla | gemeinsame Pulse-/Charge-/Damage-Regeln |
| Kill Events | echter Damage-/Kill-Pipeline-Kern |
| Enemy Movement | echte/shared Flowfield- und Movement-Regeln |
| Spawn/Waves | bestehende Encounter-/Spawn-Pipeline |

---

# 27. Refactoring-Strategie

Kein Big-Bang-Umbau.

Prinzip:

**Extract as needed.**

Wenn das Balance Lab eine Regel benötigt, die heute tief in einer Runtime-Klasse steckt, wird genau diese Regel ausgelagert.

Langfristiges mögliches Ziel:

```text
src/combat/rules/
    DamageResolver.ts
    BurnResolver.ts
    ProjectileImpactResolver.ts
    ProjectilePenetrationResolver.ts
    HydraSplitResolver.ts
    DetonationResolver.ts
    GroundDamageResolver.ts
    TeslaPulseResolver.ts

src/enemies/rules/
    EnemyMovementResolver.ts
    EnemySeparationResolver.ts
```

Runtime-Systeme kümmern sich dann hauptsächlich um:

- Phaser-Entities
- Rendering
- Netzwerk
- Physik-Anbindung
- Orchestrierung

Das Balance Lab verwendet dieselben Domain-Regeln in einer Headless-Umgebung.

---

# 28. Parity-Tests

Für wichtige ausgelagerte Regeln müssen Tests sicherstellen, dass Runtime und Balance Lab tatsächlich dieselbe Logik verwenden.

Priorität:

- Burn
- Verwundbarkeit
- Explosion
- Piercing
- Hydra Split
- Plasma Swarm
- Tesla Pulse
- ASMD Combo
- Ground DoT
- Enemy Movement
- Encounter Timing
- Spawnverhalten

Ziel:

Eine Gameplay-Regel darf nicht an zwei Stellen unabhängig implementiert werden.

---

# 29. Performance

Das Balance Lab läuft:

- headless
- ohne Rendering
- ohne Audio
- ohne Netzwerk
- mit virtueller Zeit

Ziel ist interaktive Nutzbarkeit.

Eine vollständige W1+W2-Analyse soll eher in **Sekunden als Minuten** laufen.

Für V1 gilt jedoch:

1. Korrektheit
2. Parität mit Runtime
3. Determinismus
4. erst danach Optimierung

---

# 30. Implementierungsphasen

## Phase 1 – Shared Simulation Core

- virtuelle Clock
- deterministischer RNG
- Dummy Targets
- Damage Recorder
- Resource Recorder
- echte WeaponConfigs
- echte Coop-Upgrades
- einfache Projectile-/Hitscan-/Melee-Waffen

## Phase 2 – Shared Combat Refactoring

Nur soweit für die Benchmarks benötigt:

- Burn
- Status
- Projectile Impact
- Piercing
- Splits
- Explosionen
- Detonationen
- Ground Effects
- Spezialwaffenregeln

## Phase 3 – Controlled Benchmarks

- Single Target
- 5 Targets
- Seeds
- Progressionsstufen
- Build Optimizer
- Adrenalinmetriken

## Phase 4 – Combat Scenario

- kleine Balance-Referenzarena
- bestehende Encounter-/Wave-Logik
- bestehender Spawn Executor
- reale EnemyConfigs
- reale Flowfield-Bewegung
- echte HP/Tod/Death-Effekte
- Combat Controller
- Combat DPS

## Phase 5 – Targets und UI

- Referenzkurven
- Rollenfaktoren
- Zielabweichungen
- Balance-Lab-UI
- Detailansicht
- CSV/JSON-Export

---

# 31. Nicht-Ziele von V1

V1 soll nicht:

- Waffenwerte automatisch ändern
- konkrete Nerf-/Buff-Vorschläge generieren
- Balance per CI erzwingen
- alle Gegnerarten simulieren
- vollständige Maps simulieren
- Rocks und komplexe Terrain-Geometrie im Standardbenchmark verwenden
- einen universellen Weapon Score berechnen
- W1+W2 automatisch zu einer Rotation kombinieren
- perfekte menschenähnliche Spieler-KI modellieren

---

# 32. Balance-Workflow

Der vorgesehene Workflow lautet:

## Schritt 1 – Referenzpaar balancieren

Zum Beispiel:

- Glock
- P90

Diese beiden Waffen werden manuell sinnvoll über alle Progressionsstufen eingestellt.

## Schritt 2 – Referenzkurven definieren

Aus diesen Waffen werden Zielwerte abgeleitet:

- ST
- 5T
- Combat
- Adrenalin

## Schritt 3 – Rollenfaktoren festlegen

Beispiel:

- Bite: hoher ST, niedriger 5T, hohes Risiko
- Leaf Blower: niedriger Damage, hohe Control-/Support-Rolle
- Hydra: höherer Multi-Target-/Geometry-Wert
- ASMD: Combo-/Precision-Rolle

## Schritt 4 – restliche Waffen toolgestützt angleichen

Das Tool zeigt:

- aktuelle Werte
- Zielwerte
- Abweichung
- gewählte Upgrade-Builds
- Progressionskurven

## Schritt 5 – echte Playtests

Das bestehende Balance Lab bleibt die Validierung durch reale Runden.

Damit entsteht:

```text
Weapon Theory
    ↓
Weapon Balance Lab
    ↓
Target Curves
    ↓
Real Playtests
    ↓
Iteration
```

---

# 33. Leitprinzipien

1. **Eine Gameplay-Wahrheit.** Keine parallelen Combat-Systeme.
2. **Benchmarks vereinfachen die Situation, nicht die Regeln.**
3. **Single Target, Multi Target und realer Kampf sind verschiedene Dimensionen.**
4. **Waffen müssen nicht denselben DPS besitzen.** Ihre Zielwerte hängen von ihrer Rolle ab.
5. **Upgrade-Progression ist genauso wichtig wie Endgame-DPS.**
6. **Waffe 1 wird nicht nur über Schaden bewertet, sondern auch über Adrenalingenerierung.**
7. **Waffe 2 wird nicht nur über Schaden bewertet, sondern auch über Ressourcenverbrauch.**
8. **Combat Scenario verwendet möglichst echte Gegner, echte Waves und echte Bewegung.**
9. **Deterministische Seeds machen Änderungen reproduzierbar.**
10. **Das Tool analysiert in V1 – es balanciert nicht automatisch.**

---

# 34. Zusammenfassung der drei Kernbenchmarks

| Benchmark | Zweck |
|---|---|
| **Single Target** | idealer Schaden gegen ein einzelnes spielergroßes, unsterbliches Ziel |
| **5 Targets** | Multi-Target-Leistung gegen fünf zufällig im Testbereich angeordnete unsterbliche Ziele |
| **Combat Scenario** | effektiver Schaden in einem reproduzierbaren Mini-Coop-Kampf mit echten Waves, echten Gegnern, echter Bewegung, HP, Tod und Death-Effekten |

Die drei Werte beantworten unterschiedliche Fragen und sollen bewusst nebeneinander bestehen.

---

# 35. Endziel

Das Weapon Balance Lab soll langfristig ermöglichen, eine Änderung wie:

- Burn stackt nicht mehr, sondern refresht
- Verwundbarkeit wird von 20 % auf 15 % geändert
- Piercing verliert mehr Schaden pro Ziel
- Hydra splittert nur noch zweimal
- Tesla-Pulse wird neu skaliert
- ein Gegner erhält mehr HP
- Flowfield-/Movement-Verhalten ändert sich

an der echten Gameplay-Logik vorzunehmen und anschließend das Balance Lab erneut auszuführen.

Die resultierenden Waffenwerte sollen sich automatisch entsprechend verändern, **ohne dass ein separater DPS-Rechner angepasst werden muss**.

Damit wird das Tool nicht nur ein Balancing-Helfer, sondern zugleich ein Architektur- und Regressionstest für das gesamte Coop-Defense-Waffensystem.
