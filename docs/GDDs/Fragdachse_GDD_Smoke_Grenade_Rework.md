# GDD – Smoke-Granaten-Überarbeitung

## 1. Ziel

Die Smoke-Granate ist eine primär **defensive Disruption-Utility**.

Ihre Kernaufgaben sind:

- Sicht und Zielerfassung stören,
- Gegner verwirren,
- gegnerische Navigation unzuverlässiger machen,
- Rückzug, Repositionierung und Area Control ermöglichen.

Die Smoke soll vor dem Boss-Upgrade **keine primär offensive Schadens-Utility** sein.

Erst durch das Boss-Upgrade **Gewittersturm** wird die Smoke zusätzlich offensiv und entwickelt sich zu einer elektrischen Kampfzone, in der Spieler aktiv mit ihren Waffen und anderen Schadensquellen Combos erzeugen können.

Alle Zahlenwerte in diesem Dokument sind **initiale Balance-Basiswerte**. Sie sollen später zentral anpassbar sein, ohne die fachliche Struktur oder Identität des Upgradebaums zu verändern.

---

# 2. Zielstruktur des Upgradebaums

```text
                  SMOKE
                 /     \
               L1       R1
               |        |
               L2       R2
                 \     /
              GEWITTERSTURM
                /     \
              BL1     BL2
```

Regeln:

- L1, L2, R1, BL1 und BL2 besitzen jeweils **3 Stufen**.
- R2 besitzt **1 Stufe**.
- Das Boss-Upgrade besitzt **1 Boss-Stufe**.
- Das Boss-Upgrade benötigt sowohl **L2 als auch R2**.
- BL1 und BL2 benötigen das Boss-Upgrade.

---

# 3. Baseline-Überarbeitung

Die Baseline-Smoke wird unabhängig vom Upgradebaum überarbeitet.

## 3.1 Grundidentität

Die Smoke soll bereits ohne Upgrades:

- gegnerische Sicht und Zielerfassung stören,
- Gegner innerhalb der Smoke verwirren,
- gegnerische Navigation beeinflussen,
- defensive Raumkontrolle ermöglichen,
- im PvE und PvP klar lesbar bleiben.

---

## 3.2 Verwirrung

Die aktuelle Verwirrung soll weniger hektisch und kontrollierbarer wirken.

### Zielverhalten

Innerhalb der Smoke:

- Gegner weichen von ihrer normalen Navigation ab.
- Die Abweichung ist deutlich, aber nicht so stark, dass Gegner permanent chaotisch zwischen Smoke-Innenraum und Außenbereich pendeln.
- Eine gewählte Verwirrungsrichtung bleibt kurz stabil, bevor neu entschieden wird.

Initiale Balance-Basis:

- ca. **50 % normale Navigation**
- ca. **50 % Verwirrungsrichtung**
- neue Verwirrungsentscheidung etwa alle **800–1200 ms**

Die genaue Mischung und Dauer sind Balance-Parameter.

---

## 3.3 Nachwirkung außerhalb der Smoke

Verwirrung endet nicht sofort beim Verlassen der Smoke.

Baseline:

- Nach Verlassen der Smoke bleibt die Verwirrung noch etwa **1 Sekunde** bestehen.
- Danach blendet sie weich zurück zur normalen Navigation.

Ziel:

- Gegner sollen nach dem Verlassen nicht sofort wieder perfekt über das normale Flowfield in die Smoke zurücklaufen.
- Die Bewegung soll glaubwürdig wirken und die defensive Wirkung der Smoke besser lesbar machen.

Während dieser Nachwirkung gilt der Gegner weiterhin als **verwirrt**.

---

## 3.4 Sicht- und Zielstörung

Smoke blockiert bzw. stört gegnerische Sicht und Zielerfassung bereits baseline.

Ziel:

- Gegner innerhalb der Smoke sollen nicht zuverlässig auf Ziele außerhalb der Smoke feuern können.
- Gegner außerhalb der Smoke sollen nicht zuverlässig durch eine Smoke hindurch auf Ziele dahinter feuern können.
- Gegner sollen Ziele nicht mit perfekter Präzision verfolgen können, wenn Smoke die relevante Sichtverbindung stört.

Die genaue Reaktion unterschiedlicher Gegnertypen darf variieren, die Smoke darf aber nicht nur die Navigation stören, während Zielerfassung vollständig unbeeinflusst bleibt.

---

# 4. Baseline-Darstellung

Die visuelle Smoke-Darstellung wird überarbeitet.

## 4.1 Zielbild

Die Smoke soll:

- deutlich als dichter Rauch erkennbar bleiben,
- aber nicht fast vollständig blickdicht sein,
- Silhouetten und grobe Bewegungen im Inneren erkennen lassen,
- genaue Positionen, Orientierung und Details erschweren,
- lokal unterschiedlich dicht wirken,
- lebendig und volumetrisch erscheinen.

Besonders wichtig:

- Im PvE müssen Spieler erkennen können, dass Gegner innerhalb der Smoke verwirrt reagieren.
- Im PvP darf die Smoke nicht zu einem vollständig undurchsichtigen Sichtblocker werden.
- Die visuelle Darstellung soll die Gameplay-Wirkung verständlich machen.

## 4.2 Optische Richtung

Bevorzugt werden:

- transparente bzw. halbtransparente Rauchkörper,
- bewegte dichtere Schlieren,
- lokale Dichteschwankungen,
- weiche Außenbereiche,
- erkennbare Bewegung innerhalb der Wolke.

Die Smoke soll nicht wie ein homogener, blickdichter Kreis wirken.

---

# 5. Linker Hauptast – Raum und Dauer

## L1 – Größere Smoke

**3 Stufen**

Pro Stufe:

- **+10 % Smoke-Radius**

Die Skalierung basiert auf dem normalen aufgelösten Smoke-Radius.

### Gameplay-Ziel

L1 verbessert:

- Area Control,
- Absicherung größerer Bereiche,
- defensive Nutzung in Engstellen,
- Anzahl gleichzeitig betroffener Gegner.

---

## L2 – Längere Smoke

**3 Stufen**

Pro Stufe:

- **+15 % Smoke-Dauer**

Die Verlängerung betrifft die wirksame Lebensdauer der Smoke.

### Gameplay-Ziel

L2 verbessert:

- defensive Kontrolle über längere Zeit,
- Rückzugsmöglichkeiten,
- Absicherung wichtiger Zonen,
- spätere Synergie mit Gewittersturm.

---

# 6. Rechter Hauptast – stärkere Disruption

## R1 – Desorientierung

**3 Stufen**

R1 verstärkt die vorhandene Verwirrung.

Pro Stufe:

- wird die Abweichung von der normalen Navigation stärker,
- wird die Nachwirkungsdauer nach Verlassen der Smoke erhöht.

Initiale Balance-Basis:

| Zustand | Verwirrungsanteil | Nachwirkung |
|---|---:|---:|
| Baseline | 50 % | 1,0 s |
| R1 I | 60 % | 1,5 s |
| R1 II | 70 % | 2,0 s |
| R1 III | 80 % | 2,5 s |

Die Werte sind Balance-Basiswerte und können angepasst werden.

### Gameplay-Ziel

R1 soll:

- Gegner stärker desorientieren,
- die Smoke als Disruption-Zone spürbarer machen,
- den Übergang aus der Smoke weniger abrupt machen,
- spätere Synergien mit R2 verlängern.

---

## R2 – Verwundbarkeit

**1 Stufe**

Verwirrte Gegner gelten als **verwundbar**.

Dabei wird die bereits allgemein vorhandene Verwundbarkeitsmechanik verwendet.

Baseline dieser Mechanik:

- verwundbare Gegner erleiden **+20 % eingehenden Schaden aus allen gültigen Quellen**.

R2 ist direkt an den Zustand **verwirrt** gekoppelt.

Das bedeutet:

- Gegner innerhalb der Smoke sind verwundbar, solange sie verwirrt sind.
- Gegner bleiben während der Verwirrungs-Nachwirkung außerhalb der Smoke ebenfalls verwundbar.
- Endet die Verwirrung, endet auch die durch R2 verursachte Verwundbarkeit.

### Gameplay-Ziel

R2 soll:

- defensive Smoke-Nutzung mit offensivem Teamplay verbinden,
- Spieler belohnen, wenn sie verwirrte Gegner gezielt angreifen,
- R1 durch die längere Verwirrungsdauer indirekt aufwerten.

---

# 7. Boss-Upgrade – Gewittersturm

**1 Boss-Stufe**

Voraussetzungen:

- L2 erworben
- R2 erworben

Die Smoke wird elektrisch aufgeladen.

## 7.1 Schaden

Der Gewittersturm verursacht regelmäßig elektrischen Schaden an Gegnern innerhalb der Smoke.

Die bereits vorhandene Blitzdarstellung kann als visuelle Basis dienen.

Die genaue Schadenshöhe und Tickrate sind Balance-Parameter.

---

## 7.2 Elektrische Aufladung von Gegnern

Ein Gegner, der vom Gewittersturm getroffen wurde, erhält den Zustand:

**elektrisch aufgeladen**

Initiale Balance-Basis:

- Aufladungsdauer nach dem letzten Gewittertreffer: **ca. 2 Sekunden**
- ein weiterer Gewittertreffer erneuert die Dauer

Aufgeladene Gegner sind die Grundlage für BL1 und BL2.

Ein Gegner kann damit auch kurz nach Verlassen der Smoke noch als aufgeladen gelten.

---

# 8. BL1 – Elektrische Entladung

**3 Stufen**

BL1 belohnt Spieler dafür, aktiv in den Gewittersturm hineinzuschießen.

## 8.1 Auslösung

Wird ein **elektrisch aufgeladener Gegner** durch eine andere gültige freundliche Schadensquelle getroffen, kann er eine elektrische Entladung auslösen.

Mögliche Auslöser:

- Spielerwaffen,
- verbündete Türme,
- offensive Utilities,
- andere reguläre freundliche Schadensquellen.

Nicht als Auslöser gelten:

- der Gewittersturm selbst,
- durch BL1 erzeugte Blitzprojektile.

Dadurch werden rekursive Endlosschleifen verhindert.

---

## 8.2 Blitzprojektile

Bei einer erfolgreichen Entladung entstehen Blitzprojektile.

Diese sollen sich optisch und spielerisch an den bereits vorhandenen elektrischen Sturmprojektilen der Tesla-Kuppel orientieren.

Eigenschaften:

- Start am aufgeladenen Gegner,
- suchen nahe gültige Gegner,
- schnelle elektrische Flugbewegung,
- deutlich sichtbare Entladung,
- klar von normalen Projektilen unterscheidbar.

Initiale Skalierung:

| BL1-Stufe | Blitzprojektile pro Entladung |
|---:|---:|
| I | 1 |
| II | 2 |
| III | 3 |

Schaden, Reichweite, Fluggeschwindigkeit und Zielsuche sind Balance-Parameter.

---

## 8.3 Entladungs-Cooldown

Ein einzelner aufgeladener Gegner kann nicht bei jedem einzelnen Treffer sofort erneut eine Entladung erzeugen.

Initiale Balance-Basis:

- interner Entladungs-Cooldown pro Gegner: **ca. 400 ms**

Ziel:

- schnelle Waffen bleiben attraktiv,
- die Smoke erzeugt viele sichtbare Combo-Momente,
- extrem hohe Feuerraten führen aber nicht zu unlesbaren oder unverhältnismäßigen Blitzmengen.

---

## 8.4 Gameplay-Ziel

BL1 soll das klare Signal erzeugen:

> Aufgeladene Gegner sind Combo-Ziele – schieß in den Gewittersturm.

Die Entladungen sollen eines der visuellen Highlights des Utility-Baums sein.

---

# 9. BL2 – Wachsende Gewitterzelle

**3 Stufen**

BL2 lässt erfolgreiche Kills innerhalb der Gewitter-Combo die Smoke selbst verstärken.

## 9.1 Auslösung

Stirbt ein **elektrisch aufgeladener Gegner**, wird die Smoke verstärkt, die diesen Aufladungszustand verursacht hat.

Pro erfolgreicher Auslösung:

- **+1 Sekunde verbleibende Smoke-Dauer**
- **+10 % Smoke-Radius**

Der Effekt ist pro Smoke begrenzt.

---

## 9.2 Skalierung

| BL2-Stufe | Max. Auslösungen pro Smoke | Max. Dauerbonus | Max. Radiusbonus |
|---:|---:|---:|---:|
| I | 2 | +2 s | +20 % |
| II | 4 | +4 s | +40 % |
| III | 6 | +6 s | +60 % |

Jede Auslösung besitzt immer dieselbe Wirkung.

Die Upgrade-Stufe erhöht nur die maximale Anzahl möglicher Auslösungen.

---

## 9.3 Radius-Skalierung

Die Radiussteigerung erfolgt **additiv relativ zum ursprünglichen Radius dieser Smoke**.

Beispiel:

```text
100 % -> 110 % -> 120 % -> 130 % -> ...
```

Keine multiplikative Verkettung wie:

```text
100 % -> 110 % -> 121 % -> ...
```

Damit bleiben die maximalen Werte klar kontrollierbar.

---

## 9.4 Zuordnung zur Smoke

Die elektrische Aufladung muss einer konkreten Smoke zugeordnet sein.

Wenn der aufgeladene Gegner stirbt:

- wird genau diese Smoke verstärkt,
- überlappende Smokes erhalten nicht gleichzeitig denselben Kill-Proc.

Zusätzlich gilt:

- die Smoke muss noch aktiv sein,
- vollständig verschwundene Smokes werden nicht wiederbelebt,
- BL2 kann pro Tod nur einmal auslösen.

---

## 9.5 Visuelles Feedback

Eine BL2-Auslösung soll klar sichtbar sein.

Zielbild:

- kurzer elektrischer Puls,
- Smoke leuchtet kurz auf,
- Wolke expandiert weich auf den neuen Radius,
- die Verstärkung wirkt wie eine wachsende Gewitterzelle.

Der Radius darf nicht sichtbar hart in einem einzelnen Frame springen.

---

# 10. Gesamtsynergie

Der vollständige Baum soll folgende Progression erzeugen:

## Baseline

- Sichtschutz
- Zielstörung
- moderate Verwirrung
- kurze Nachwirkung außerhalb der Smoke

## Linker Hauptast

**L1 + L2**

- größere Kontrollzone
- längere Kontrollzone

## Rechter Hauptast

**R1 + R2**

- stärkere und länger anhaltende Verwirrung
- verwirrte Gegner werden zu attraktiven Schadenszielen

## Boss

**Gewittersturm**

- Smoke verursacht zusätzlich elektrischen Schaden
- getroffene Gegner werden elektrisch aufgeladen

## BL1

- Spielerbeschuss auf aufgeladene Gegner erzeugt Blitzprojektile
- aktive Offensive innerhalb der Gewitterzone wird belohnt

## BL2

- Kills auf aufgeladenen Gegnern lassen die Gewitterzelle wachsen
- erfolgreiche Kämpfe verlängern die Kontrolle über das Gebiet

---

# 11. Gameplay-Identität

Die Smoke soll sich über den Upgradebaum von einer defensiven Utility zu einer defensiv-offensiven Combo-Zone entwickeln.

### Ohne Boss-Upgrade

Die Smoke ist primär:

- defensiv,
- störend,
- kontrollierend,
- taktisch.

### Mit Boss-Upgrade

Die Smoke wird zusätzlich:

- gefährlich,
- elektrisch,
- combo-orientiert.

### Voll ausgebaut

Die Smoke soll das Gefühl vermitteln:

> Gegner verlieren Orientierung, werden verwundbar, der Gewittersturm lädt sie elektrisch auf, Beschuss erzeugt Blitzentladungen und erfolgreiche Kills lassen die Gewitterzelle weiter wachsen.

---

# 12. Lesbarkeit und Gamefeel

Die Smoke soll trotz vieler Effekte jederzeit verständlich bleiben.

Wichtige visuelle Zustände:

- normale Smoke
- verwirrter Gegner
- verwundbarer Gegner
- Gewittersturm aktiv
- elektrisch aufgeladener Gegner
- BL1-Entladung
- BL2-Wachstumsimpuls

Die Effekte sollen klar unterscheidbar sein und sich nicht gegenseitig überdecken.

Besonders wichtig:

- Gegner müssen trotz Smoke noch grob sichtbar sein.
- Die Verwirrungsbewegung soll im PvE erkennbar sein.
- Elektrisch aufgeladene Gegner brauchen ein klares visuelles Signal.
- BL1-Blitzprojektile sollen auffällig, aber lesbar bleiben.
- BL2-Wachstum soll sichtbar, aber nicht abrupt wirken.

---

# 13. Initiale Balance-Basiswerte

| Parameter | Initialer Wert |
|---|---:|
| Baseline Verwirrungsanteil | 50 % |
| Baseline normale Navigation | 50 % |
| Baseline Richtungsintervall | 800–1200 ms |
| Baseline Verwirrungs-Nachwirkung | 1,0 s |
| L1 Radius | +10 % pro Stufe |
| L2 Dauer | +15 % pro Stufe |
| R1 I Verwirrung | 60 % |
| R1 II Verwirrung | 70 % |
| R1 III Verwirrung | 80 % |
| R1 I Nachwirkung | 1,5 s |
| R1 II Nachwirkung | 2,0 s |
| R1 III Nachwirkung | 2,5 s |
| R2 Verwundbarkeit | bestehender globaler Wert, aktuell +20 % eingehender Schaden |
| Boss Aufladungsdauer | ca. 2,0 s |
| BL1 I Blitzprojektile | 1 |
| BL1 II Blitzprojektile | 2 |
| BL1 III Blitzprojektile | 3 |
| BL1 Proc-Cooldown | ca. 400 ms pro aufgeladenem Gegner |
| BL2 Dauerbonus pro Kill | +1 s |
| BL2 Radiusbonus pro Kill | +10 % |
| BL2 I Max-Procs | 2 |
| BL2 II Max-Procs | 4 |
| BL2 III Max-Procs | 6 |

Diese Werte bilden den ersten spielbaren Balance-Stand und sind ausdrücklich keine dauerhaft festgeschriebenen Endwerte.
