# GDD – HE-Granaten-Upgradebaum

## 1. Ziel

Die HE-Granate ist eine offensive Explosiv-Utility mit klarer **Demolition-/Anti-Struktur-Identität**.

Der Upgradebaum bietet zwei Entwicklungsrichtungen:

- **Links:** Verfügbarkeit, Burst-Nutzung und stärkere Würfe
- **Rechts:** Explosionswirkung und Zuverlässigkeit gegen bewegliche Gegner

Beide Seiten laufen in einem starken Boss-Upgrade zusammen. Danach kann der Cluster-Effekt in zwei unterschiedliche Richtungen weiterentwickelt werden.

Alle Zahlenwerte in diesem Dokument sind **initiale Balance-Basiswerte**. Sie sollen zentral tweakbar sein und dürfen im späteren Balancing angepasst werden, ohne die fachliche Identität oder Baumstruktur zu verändern.

---

# 2. Baumstruktur

```text
                 HE-Granate
                 /        \
               L1          R1
               |           |
               L2          R2
                 \        /
                   BOSS
                  /    \
                BL1    BR1
```

Regeln:

- L1, L2, R1, BL1 und BR1 besitzen jeweils **3 Stufen**.
- R2 ist ein **einmaliges Verhaltens-Upgrade**.
- Das Boss-Upgrade ist ein **einmaliges Boss-Upgrade**.
- Das Boss-Upgrade benötigt sowohl **L2 als auch R2**.
- BL1 und BR1 benötigen das Boss-Upgrade.

---

# 3. Baseline-Identität

Die HE-Granate ist bereits ohne Upgrades:

- eine direkt wirksame explosive Flächen-Utility,
- besonders effektiv gegen gegnerische Strukturen,
- stark gegen Gruppen in einem begrenzten Bereich,
- durch Wurfstärke und Flugbahn aktiv platzierbar.

Der erhöhte Schaden gegen gegnerische Strukturen bleibt eine **Baseline-Eigenschaft** und ist nicht an einen Upgrade-Pfad gebunden.

---

# 4. Linker Hauptast – Verfügbarkeit und Burst

## L1 – Schnellere Einsatzbereitschaft

**3 Stufen**

Pro Stufe:

- **-15 % Cooldown**
- **+15 % maximale Wurfgeschwindigkeit**

Die Änderungen beziehen sich jeweils auf den Basiswert der Utility.

Damit ergeben sich bei maximaler Stufe als Ausgangspunkt:

- Cooldown: **55 % des Basis-Cooldowns**
- maximale Wurfgeschwindigkeit: **145 % des Basiswerts**

Die Zeit bis zum Erreichen der maximalen Wurfstärke bleibt unverändert. Ein vollständig aufgeladener Wurf fliegt dadurch schneller und weiter, ohne dass sich das grundlegende Charge-Timing des Wurfs verändert.

Cooldown-Reduktionen wirken gleichzeitig auf die Charge-Regeneration aus L2.

---

## L2 – Granaten-Charges

**3 Stufen**

Die HE-Granate erhält ein regenerierendes Charge-System.

Baseline:

- **1 verfügbare Charge**

Pro Stufe:

- **+1 maximale Charge**

Damit ergeben sich:

| L2-Stufe | Maximale Charges |
|---:|---:|
| 0 | 1 |
| 1 | 2 |
| 2 | 3 |
| 3 | 4 |

### Nutzung

Verfügbare Charges können in kurzer Folge eingesetzt werden.

Zwischen dem Abschuss einer Granate und dem frühestmöglichen Beginn des nächsten HE-Wurfs liegt ein kurzer Mindestabstand von:

- **100 ms**

Dieser Wert ist nur der kurze Burst-Lockout zwischen zwei Nutzungen. Das normale Aufladen der Wurfstärke bleibt bestehen.

### Charge-Regeneration

Ein verbrauchter Charge regeneriert nach Ablauf des **aktuellen effektiven Cooldowns**.

Dadurch gilt:

- Cooldown-Reduktionen verkürzen automatisch die Charge-Regeneration.
- L1 erhöht somit gleichzeitig die langfristige Verfügbarkeit der HE.
- Charges regenerieren nacheinander bis zum aktuellen Maximum.
- Der laufende Regenerationsfortschritt eines Charges wird durch die Nutzung eines weiteren vorhandenen Charges nicht zurückgesetzt.

Das Charge-Konzept ist ein allgemeines Gameplay-Konzept und soll auch für andere Utilities oder gegnerische Fähigkeiten nutzbar sein.

---

# 5. Rechter Hauptast – Explosionswirkung und Zuverlässigkeit

## R1 – Sprengkraft

**3 Stufen**

Pro Stufe:

- **+10 % Explosionsschaden**
- **+10 % Explosionsradius**

Die Skalierung erfolgt jeweils ausgehend vom Basiswert.

Bei maximaler Stufe besitzt die HE damit als Balance-Basis:

- **130 % Basisschaden**
- **130 % Basisradius**

Nachfolgende Cluster-Effekte beziehen sich auf die bereits aufgelösten HE-Werte nach diesen Modifikationen.

---

## R2 – Aufschlagzünder

**1 Stufe**

Die HE-Granate explodiert bei direktem Kontakt mit einem **gegnerischen Charakter** sofort.

R2 löst ausdrücklich keine Sofortdetonation aus bei Kontakt mit:

- gegnerischen Strukturen,
- Felsen,
- Wänden,
- Boden,
- sonstigem Terrain.

Treffer gegen Strukturen behalten das normale Wurf-, Bounce- und Fuse-Verhalten der HE.

### Gameplay-Ziel

R2 soll:

- direkte Würfe gegen bewegliche Gegner belohnen,
- die Zuverlässigkeit der HE gegen Einzelziele und Gruppen erhöhen,
- das normale Granatenverhalten gegen Strukturen erhalten.

---

# 6. Boss-Upgrade – Clustergranate

**1 Boss-Stufe**

Voraussetzungen:

- L2 erworben
- R2 erworben

Nach der Primärexplosion werden **5 kleinere Clustergranaten** aus dem Explosionszentrum herausgeschleudert.

Die Cluster besitzen eine kurze sichtbare Flugphase und detonieren zeitlich leicht versetzt.

## 6.1 Cluster-Schaden und Radius

Jeder Cluster verwendet als initialen Balancewert:

- **30 % des aufgelösten HE-Explosionsschadens**
- **30 % des aufgelösten HE-Explosionsradius**

Damit erzeugen die fünf Basis-Cluster theoretisch bis zu **150 % zusätzlichen HE-Schaden**, wenn ein Ziel tatsächlich von allen fünf Clustern getroffen wird.

Zusammen mit der Primärexplosion entspricht das einem theoretischen Maximum von **250 % einer einzelnen HE-Explosion**.

Diese hohe Obergrenze ist beabsichtigt: Das Boss-Upgrade soll sehr stark sein. In der Praxis wird der Schaden durch räumliche Verteilung, unterschiedliche Flugweiten und kleine Cluster-Radien begrenzt.

Die normalen zielabhängigen Schadensmodifikatoren der HE gelten weiterhin auch für die Boss-Cluster.

## 6.2 Flugrichtung

Die ursprüngliche Flugbewegung der HE beeinflusst die Cluster deutlich.

Die Cluster werden nicht rein gleichmäßig radial verteilt. Stattdessen entsteht ein **vorwärts gewichteter Fächer**, der sich an Bewegungsrichtung und Geschwindigkeit der Primärgranate orientiert.

Zusätzlich erhält jeder Cluster eine leichte individuelle Abweichung.

### Initiale Flugweiten

Die fünf Basis-Cluster werden in zwei Gruppen aufgeteilt:

**2 kurze Cluster**
- Ziel-Flugweite etwa **0,35–0,65 × HE-Explosionsradius**
- ihre Explosionen liegen typischerweise noch innerhalb des Bereichs der ursprünglichen HE-Explosion

**3 weite Cluster**
- Ziel-Flugweite etwa **0,80–1,25 × HE-Explosionsradius**
- sie können den ursprünglichen Explosionsradius verlassen und die Wirkung nach außen verlängern

Diese Faktoren sind Balance-Basiswerte.

## 6.3 Streuung

Die Cluster folgen grundsätzlich der ursprünglichen Bewegungsrichtung, erhalten aber individuelle Winkel- und Geschwindigkeitsabweichungen.

Zielbild:

- klar erkennbare gemeinsame Hauptbewegungsrichtung,
- keine identischen Flugbahnen,
- keine perfekte symmetrische Verteilung,
- leichte räumliche Überlappung der inneren Cluster,
- sichtbare Ausdehnung über den Primärradius durch die äußeren Cluster.

Die konkrete Winkelstreuung ist ein visueller und spielerischer Tuning-Parameter.

## 6.4 Zündverzögerung

Jeder Cluster detoniert nach einer individuell bestimmten Verzögerung zwischen:

- **200 ms Minimum**
- **500 ms Maximum**

Die Verzögerungen sollen nicht für alle Cluster identisch sein.

Dadurch entsteht:

- unmittelbar nach der Primärexplosion bereits sichtbare Folgeaktivität,
- genug Zeit für erkennbare Cluster-Flugbahnen,
- eine kurze gestaffelte Explosionskaskade statt einer simultanen Sekundärexplosion.

Cluster erzeugen keine weiteren normalen Cluster.

---

# 7. BL1 – Cluster-Masse

**3 Stufen**

BL1 erhöht die Anzahl der vom Boss-Upgrade erzeugten normalen Cluster.

Pro Stufe:

- **+2 Cluster**

Damit ergeben sich:

| BL1-Stufe | Gesamtzahl Boss-Cluster |
|---:|---:|
| 0 | 5 |
| 1 | 7 |
| 2 | 9 |
| 3 | 11 |

Die zusätzlichen Cluster nutzen dieselben grundlegenden Regeln für:

- Schaden,
- Radius,
- Flugrichtung,
- Flugweiten,
- Zündverzögerung.

Bei größeren Clusterzahlen soll die Mischung aus kurzen und weiten Flugbahnen proportional erhalten bleiben.

### Gameplay-Identität

BL1 steht für:

- größere Flächenabdeckung,
- mehr Explosionen,
- höheren Gruppenschaden,
- starke Endgame-Skalierung,
- maximales explosives Chaos.

---

# 8. BR1 – Abriss-Cluster

**3 Stufen**

BR1 spezialisiert die HE weiter auf gezielte Würfe gegen gegnerische Strukturen.

## 8.1 Auslösung

Trifft die **ursprüngliche HE-Granate** direkt eine gegnerische Struktur, wird am Kontaktpunkt sofort ein kleiner konzentrierter Abriss-Cluster-Burst ausgelöst.

Dabei gilt:

- Die Primärgranate explodiert durch den Strukturkontakt **nicht automatisch**.
- Sie behält ihr normales Wurf-, Bounce- und Fuse-Verhalten.
- Die normale Boss-Clusterexplosion entsteht erst bei der späteren Primärexplosion.
- Der BR1-Effekt kann pro geworfener Primärgranate **höchstens einmal** ausgelöst werden.
- Normale Boss-Cluster können BR1 nicht erneut auslösen.

Damit können Strukturkontakt-Burst und spätere Primärexplosion räumlich und zeitlich getrennt stattfinden.

## 8.2 Abriss-Cluster

Der Strukturkontakt erzeugt immer:

- **5 Mini-Cluster**

Diese bleiben bewusst sehr nah am Kontaktpunkt.

Initiale Balance-Basis:

- Flug-/Verteilungsbereich: etwa **0,10–0,35 × HE-Explosionsradius** um den Kontaktpunkt
- Mini-Cluster-Radius: **20 % des aufgelösten HE-Radius**
- sehr kurze, leicht unterschiedliche Flugbahnen
- Fokus auf konzentrierten Schaden am getroffenen Gebäude

## 8.3 Schaden und Skalierung

Der Schaden wird so skaliert, dass BR1 auf Stufe 3 einen sehr starken, klar erkennbaren Demolition-Effekt erzeugt.

Jeder der fünf Mini-Cluster verursacht gegen die direkt getroffene gegnerische Struktur:

| BR1-Stufe | Schaden je Mini-Cluster | Maximaler Burst gesamt |
|---:|---:|---:|
| 1 | 25 % einer normalen HE-Strukturexplosion | 125 % |
| 2 | 30 % einer normalen HE-Strukturexplosion | 150 % |
| 3 | 40 % einer normalen HE-Strukturexplosion | 200 % |

Auf BR1-Stufe 3 kann der reine Strukturkontakt-Burst damit insgesamt ungefähr den **doppelten Schaden einer normalen HE-Explosion an derselben Struktur** erreichen.

„Normale HE-Strukturexplosion“ bezeichnet dabei den bereits vollständig aufgelösten Schaden inklusive:

- R1-Schadenssteigerungen,
- Baseline-Struktur-Schadensmultiplikator,
- sonstigen für die HE geltenden allgemeinen Schadensmodifikatoren.

Die spätere normale Primärexplosion der Granate ist davon getrennt und kann zusätzlich Schaden verursachen, falls sie weiterhin in Reichweite derselben Struktur detoniert.

### Gameplay-Identität

BR1 steht für:

> Präziser direkter Strukturkontakt erzeugt konzentrierten zusätzlichen Abrissschaden, ohne die normale Granatenflugbahn sofort zu beenden.

Damit unterscheiden sich die beiden Post-Boss-Äste klar:

- **BL1:** mehr allgemeine Cluster und größere Flächenwirkung
- **BR1:** konzentrierte Zusatzwirkung gegen Strukturen bei präzisem Direktkontakt

---

# 9. Gesamtwirkung des Baums

## Linker Hauptpfad

L1 + L2 steht für:

- häufigere Nutzung,
- schnellere Charge-Regeneration,
- höhere Burst-Kapazität,
- größere Reichweite vollständig aufgeladener Würfe.

## Rechter Hauptpfad

R1 + R2 steht für:

- stärkere Explosionen,
- größere Flächenwirkung,
- zuverlässige Sofortdetonation gegen direkt getroffene Gegner.

## Boss

Die Clustergranate verbindet beide Richtungen:

- starke Primärexplosion,
- mehrere physische Sekundärgranaten,
- räumlich verlängerte Flächenwirkung,
- starke Burst- und Endgame-Skalierung.

## Post-Boss

BL1 und BR1 setzen danach unterschiedliche Schwerpunkte:

- **BL1:** allgemeine Cluster-Masse und Flächenvernichtung
- **BR1:** präziser Abriss gegnerischer Strukturen

---

# 10. Lesbarkeit und Gamefeel

Die voll ausgebaute HE soll spektakulär sein, ohne dass alle Explosionen zu einem einzigen visuellen Ereignis verschmelzen.

Wichtige Eigenschaften:

- klare Primärexplosion,
- sichtbares Herausschleudern der Boss-Cluster,
- kurze erkennbare Flugphasen,
- leicht unterschiedliche Flugweiten,
- gestaffelte Zündzeiten zwischen 200 und 500 ms,
- kleinere Clusterexplosionen als die Primärexplosion,
- kompakter, klar unterscheidbarer BR1-Struktur-Burst.

Der Spieler soll unmittelbar erkennen können:

- normale HE-Explosion,
- Boss-Clusterkaskade,
- BR1-Abriss-Burst an einer gegnerischen Struktur.

---

# 11. Balance-Basiswerte

| Parameter | Initialer Wert |
|---|---:|
| L1 Cooldown-Reduktion | -15 % pro Stufe |
| L1 maximale Wurfgeschwindigkeit | +15 % pro Stufe |
| L2 zusätzliche Max-Charges | +1 pro Stufe |
| Burst-Lockout zwischen Charge-Würfen | 100 ms |
| R1 Schaden | +10 % pro Stufe |
| R1 Radius | +10 % pro Stufe |
| Boss Basis-Cluster | 5 |
| Boss Cluster-Schaden | 30 % HE-Schaden |
| Boss Cluster-Radius | 30 % HE-Radius |
| Boss kurze Flugweite | 0,35–0,65 × HE-Radius |
| Boss weite Flugweite | 0,80–1,25 × HE-Radius |
| Boss Cluster-Zündzeit | 200–500 ms |
| BL1 zusätzliche Cluster | +2 pro Stufe |
| BR1 Mini-Cluster | 5 |
| BR1 Verteilungsbereich | 0,10–0,35 × HE-Radius |
| BR1 Mini-Cluster-Radius | 20 % HE-Radius |
| BR1 I Schaden je Mini | 25 % normale HE-Strukturexplosion |
| BR1 II Schaden je Mini | 30 % normale HE-Strukturexplosion |
| BR1 III Schaden je Mini | 40 % normale HE-Strukturexplosion |

Diese Werte bilden den **ersten spielbaren Balance-Stand**. Sie sind ausdrücklich keine dauerhaft festgeschriebenen Endwerte.
