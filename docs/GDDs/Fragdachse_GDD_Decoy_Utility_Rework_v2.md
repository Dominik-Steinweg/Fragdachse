# GDD – Decoy-Utility-Überarbeitung

## 1. Ziel

Das Decoy ist primär eine **defensive Täuschungs- und Ablenkungs-Utility**.

Die Baseline-Funktion soll bereits ohne Upgrades stark und taktisch relevant bleiben:

- Gegner werden vom Spieler weg auf das Decoy umgelenkt.
- Der Spieler wird währenddessen unsichtbar und ist nicht mehr als reguläres Ziel erkennbar.
- Das Decoy eignet sich für Flucht, Repositionierung und defensive Entlastung.
- Im PvE kann es Gegner vom Spieler wegziehen.
- Im PvP funktioniert es als Täuschungs- und Tarnwerkzeug.

Die Upgrades bauen auf dieser defensiven Grundidentität auf.

Erst das Boss-Upgrade **Sprengattrappe** führt einen deutlichen offensiven Faktor ein. Die beiden Post-Boss-Upgrades entwickeln diesen offensiven Teil anschließend in zwei unterschiedliche Feuer-Richtungen weiter.

Alle Zahlenwerte in diesem Dokument sind **initiale Balance-Basiswerte** und sollen später zentral anpassbar sein.

---

## 2. Kernprinzipien der Baseline

### 2.1 Übernommene Lebenswerte

Das Decoy übernimmt beim Erzeugen weiterhin die aktuellen Werte seines Besitzers:

- aktuelle HP
- maximale HP
- aktuelle Armor

Dieses Verhalten ist ein Kernprinzip des Decoys und bleibt unverändert.

Dadurch entstehen bewusst unterschiedliche taktische Einsatzformen:

- Ein Spieler mit wenig verbleibenden HP erzeugt ein entsprechend fragiles Decoy.
- Ein Spieler mit hohen HP/Armor erzeugt einen langlebigeren Lockvogel.
- Ein fragiles Decoy kann bei vorhandenem Boss-Upgrade bewusst als schneller Sprengkörper eingesetzt werden.
- Ein robustes Decoy eignet sich stärker zum langfristigen Binden von Gegnern.

Es wird kein fester eigener Decoy-HP-Wert eingeführt.

### 2.2 Baseline-Werte

Initiale Ausgangswerte:

- Basis-Cooldown: **12 Sekunden**
- Decoy-Lebensdauer: **6 Sekunden**
- Tarnungsdauer: **6 Sekunden**

Diese Werte bilden den Ausgangspunkt für die Upgrade-Skalierung.

---

## 3. Zielstruktur des Upgradebaums

```text
                     DECOY
                    /     \
                  L1       R1
                  |        |
                  L2       R2
                    \     /
                 SPRENGATTRAPPE
                   /     \
                 BL1     BR2
```

Regeln:

- L1, L2, R1, R2, BL1 und BR2 besitzen jeweils **3 Stufen**.
- Das Boss-Upgrade besitzt **1 Boss-Stufe**.
- Das Boss-Upgrade benötigt sowohl **L2 als auch R2**.
- BL1 und BR2 benötigen das Boss-Upgrade.

---

## 4. Linker Hauptast – Verfügbarkeit und Lockvogel

### L1 – Massenablenkung

**3 Stufen**

L1 reduziert den verbleibenden Cooldown des Decoys **erst in dem Moment, in dem das aktive Decoy zerstört wird oder regulär ausläuft**.

Zu diesem Zeitpunkt werden gültige Gegner im L1-Radius um die letzte Position des Decoys gezählt.

Pro Gegner innerhalb des Radius:

- **-1 Sekunde verbleibender Cooldown**

Der Radius steigt mit jeder Stufe:

| L1-Stufe | Auswertungsradius beim Ende des Decoys |
|---:|---:|
| I | 100 px |
| II | 200 px |
| III | 300 px |

Der Cooldown kann durch diesen Effekt höchstens bis auf **0 Sekunden Restzeit** reduziert werden.

#### Aktivitätsregel

Ein neues Decoy kann niemals erzeugt werden, solange das vorherige Decoy noch aktiv ist.

L1 ermöglicht daher keinen Decoy-Spam während der Laufzeit. Die Belohnung wird bewusst erst beim Tod bzw. Ablauf des aktuellen Decoys verrechnet.

#### Gameplay-Ziel

L1 belohnt gut platzierte Decoys in großen Gegnergruppen.

Ein Decoy, das nur wenige oder keine Gegner bindet, erhält kaum Cooldown-Rückerstattung. Ein Decoy, das mitten in einer großen Gegnergruppe erfolgreich eingesetzt wurde, verkürzt dagegen die Wartezeit bis zum nächsten Einsatz deutlich.

Dadurch bleibt das Decoy:

- selten und situationsabhängig einsetzbar,
- während seiner Laufzeit nicht erneut verfügbar,
- bei starkem Einsatz in Gegnermassen spürbar schneller wieder bereit.

### L2 – Unwiderstehlicher Lockvogel

**3 Stufen**

Das Decoy erhält einen zusätzlichen aktiven Anziehungsradius.

Gegner innerhalb dieses Radius können gezielt vom bisherigen Verhalten auf das Decoy umgelenkt werden.

Das gilt ausdrücklich auch für Gegner, die aktuell:

- keinen Spieler angreifen,
- eine Basis angreifen,
- ein anderes strategisches Ziel verfolgen.

#### Initiale Radiuswerte

| L2-Stufe | Akquise-Radius |
|---:|---:|
| I | 100 px |
| II | 200 px |
| III | 300 px |

#### Target-Lock-Regel

Der Radius entscheidet nur darüber, **welche Gegner neu angelockt werden können**.

Sobald ein Gegner durch dieses Upgrade das Decoy als Ziel aufgenommen hat:

- behält er dieses konkrete Decoy als Ziel,
- auch wenn er anschließend den ursprünglichen Akquise-Radius wieder verlässt,
- solange das Decoy lebt und grundsätzlich erreichbar bzw. als gültiges Ziel vorhanden ist.

Das Ziel soll nicht ständig neu aufgrund der Distanz bewertet werden.

#### Gameplay-Ziel

L2 soll insbesondere ermöglichen:

- Gegner von der eigenen Basis wegzulocken,
- größere Gruppen umzulenken,
- Gegner bewusst in gefährliche Bereiche zu ziehen,
- spätere Boss- und Feuer-Upgrades vorzubereiten.

---

## 5. Rechter Hauptast – defensive Tarnungsnutzung

### R1 – Schattenläufer

**3 Stufen**

Während der Decoy-Tarnung erhält der Spieler:

- **+10 % Bewegungsgeschwindigkeit pro Stufe**

Damit ergeben sich:

| R1-Stufe | Bewegungsbonus während Tarnung |
|---:|---:|
| I | +10 % |
| II | +20 % |
| III | +30 % |

Der Bonus endet unmittelbar mit dem Ende der Tarnung.

#### Gameplay-Ziel

R1 unterstützt:

- Flucht,
- Repositionierung,
- Abstand gewinnen,
- taktisches Umgehen von Gegnergruppen,
- schnelles Erreichen sicherer Positionen.

### R2 – Regeneration im Schatten

**3 Stufen**

Während der Decoy-Tarnung erhält der Spieler zusätzliche defensive Regeneration.

Pro Stufe:

- **+10 % passive Adrenalinregeneration**
- **+5 HP pro Sekunde**

Damit ergeben sich:

| R2-Stufe | Passive Adrenalinregeneration | HP-Regeneration |
|---:|---:|---:|
| I | +10 % | +5 HP/s |
| II | +20 % | +10 HP/s |
| III | +30 % | +15 HP/s |

#### Adrenalin-Regel

Der Bonus verstärkt die bereits aufgelöste **passive Adrenalinregeneration prozentual**.

Es werden keine festen zusätzlichen Adrenalinpunkte pro Tick erzeugt.

Dadurch bleibt das Upgrade mit anderen Regenerationsboni kompatibel.

#### Heilungsregel

Die HP-Regeneration:

- wirkt nur während aktiver Tarnung,
- endet beim Ende der Tarnung,
- kann HP nicht über das normale Maximum hinaus erhöhen.

#### Gameplay-Ziel

R2 macht die Tarnphase zu einem taktischen Reset-Fenster:

- Gegner verlieren den Spieler als Ziel,
- der Spieler repositioniert sich,
- HP werden regeneriert,
- Adrenalin wird schneller wiederhergestellt.

---

## 6. Boss-Upgrade – Sprengattrappe

**1 Boss-Stufe**

Voraussetzungen:

- L2 erworben
- R2 erworben

Das Decoy explodiert:

- bei tatsächlichem Tod,
- oder beim Ablauf seiner normalen Lebensdauer.

Die Explosion führt den ersten klar offensiven Effekt in den Decoy-Baum ein.

### Initiale Balance-Basis

Ausgangswerte:

- Explosionsradius: **150 px**
- Explosionsschaden: **100**
- Knockback: **500**

Diese Werte sind Balance-Basiswerte.

### Gameplay-Ziel

Die Sprengattrappe soll besonders Gegner bestrafen, die erfolgreich vom Lockvogel gesammelt wurden.

Typischer Ablauf:

```text
Decoy erzeugen
-> Gegner werden angelockt
-> Gegner verfolgen und attackieren das Decoy
-> Gegner sammeln sich in seiner Nähe
-> Decoy stirbt oder läuft aus
-> Explosion trifft die gesammelte Gruppe
```

Ein Decoy mit niedrigen übernommenen HP darf bewusst schneller sterben und dadurch früher explodieren.

Diese taktische Möglichkeit ist ausdrücklich gewünscht.

---

## 7. BL1 – Brandbrocken

**3 Stufen**

Die Sprengattrappen-Explosion schleudert zusätzlich brennende Brocken aus dem Explosionszentrum.

Dabei soll die bereits vorhandene generische **Fire-Chunk-/Brandbrocken-/Ground-Fire-Logik** verwendet werden.

Es soll kein isolierter Decoy-spezifischer Feuerpfad entstehen.

### Skalierung

Pro Stufe:

- **+3 Brandbrocken**

Damit ergeben sich:

| BL1-Stufe | Brandbrocken |
|---:|---:|
| I | 3 |
| II | 6 |
| III | 9 |

### Verhalten

Die Brandbrocken:

- werden aus der Explosion herausgeschleudert,
- fliegen in unterschiedliche Richtungen,
- landen räumlich verteilt,
- setzen den Boden in Brand,
- erzeugen zusätzliche Gefahrenbereiche um den Explosionsort.

Schaden, Flugweite, Bodenfeuerdauer und weitere Fire-Chunk-Parameter sollen möglichst über bereits bestehende generische Mechaniken und Balancewerte gesteuert werden.

### Gameplay-Ziel

BL1 ist besonders stark gegen:

- schnelle Gegner,
- Gegner, die das Decoy tatsächlich erreichen,
- Gegnergruppen, die sich dicht um das Decoy sammeln.

Der Boss verursacht den unmittelbaren Burst.

BL1 verlängert die Gefahrenzone anschließend durch Feuer.

---

## 8. BR2 – Brennende Fährte

**3 Stufen**

Das Decoy setzt während seiner Bewegung den Boden hinter sich in Brand.

Die Feuerfährte nutzt die Tatsache, dass angelockte Gegner dem Decoy aktiv hinterherlaufen.

Dadurch entsteht eine gezielte Gegenmechanik gegen langsamere Gegner, die das Decoy verfolgen, aber nicht rechtzeitig erreichen.

### Grundverhalten

Während das Decoy sich tatsächlich bewegt:

- werden entlang seiner zurückgelegten Strecke Ground-Fire-Segmente erzeugt,
- die Spur bleibt für kurze Zeit bestehen,
- verfolgende Gegner laufen dadurch automatisch durch den brennenden Bereich.

Die Spur entsteht bereits während der Lebensdauer des Decoys.

Sie ist nicht an dessen Explosion gebunden.

### Initiale Skalierung

| BR2-Stufe | Feuerdauer je Spursegment | Ziel-DPS |
|---:|---:|---:|
| I | 2 s | ca. 8 DPS |
| II | 3 s | ca. 12 DPS |
| III | 4 s | ca. 16 DPS |

Diese Werte sind initiale Balance-Basiswerte.

Die Spurbreite bleibt über die Stufen grundsätzlich konstant.

### Regeln zur Spur-Erzeugung

Neue Feuersegmente entstehen nur bei **tatsächlicher räumlicher Bewegung** des Decoys.

Daraus folgen:

- Ein festhängendes oder stehendes Decoy erzeugt nicht permanent an derselben Stelle neue Feuersegmente.
- Bereits vorhandene Segmente sollen nicht durch Stillstand unendlich gestapelt werden.
- Die Spur folgt der realen Bewegungsbahn.
- Nach Tod oder Ablauf des Decoys werden keine neuen Segmente mehr erzeugt.
- Bereits vorhandene Feuersegmente brennen normal bis zum Ende ihrer eigenen Lebensdauer weiter.

### Schadensregeln

Die Feuerfährte folgt den normalen Ground-Fire-Regeln.

Sie kann Gegner beschädigen unabhängig davon, ob diese:

- auf das Decoy gelockt wurden,
- zufällig durch die Spur laufen,
- ein anderes Ziel verfolgen.

Der Lockvogel-Effekt erzeugt lediglich die besonders starke natürliche Synergie, weil angelockte Gegner der Spur bewusst folgen.

### Gameplay-Ziel

BR2 ist besonders stark gegen:

- langsame Gegner,
- große Gegnergruppen mit geringer Bewegungsgeschwindigkeit,
- Gegner, die das Decoy über längere Distanz verfolgen,
- Gegner, die den eigentlichen Explosionsradius nie erreichen würden.

Typischer Ablauf:

```text
Decoy läuft weg
-> langsame Gegner verfolgen es
-> Decoy zieht eine Feuerfährte
-> Verfolger laufen durch die brennende Route
-> langsame Gegner verlieren kontinuierlich HP
```

---

## 9. Post-Boss-Spezialisierung nach Gegnertempo

Die beiden Post-Boss-Upgrades sollen bewusst unterschiedliche Verfolger bestrafen.

### BL1 – schnelle Gegner

Schnelle Gegner:

- erreichen das Decoy,
- sammeln sich in seiner Nähe,
- werden von der Sprengattrappe getroffen,
- werden anschließend durch Brandbrocken und Ground Fire weiter beschädigt.

### BR2 – langsame Gegner

Langsame Gegner:

- verfolgen das Decoy,
- erreichen es aber häufig nicht rechtzeitig,
- laufen stattdessen über längere Strecken durch seine Feuerfährte.

Damit ergänzen sich beide Upgrades statt denselben Effekt zu verstärken.

---

## 10. Gesamtsynergie des Baums

### Baseline

- Gegner vom Spieler weglocken
- Spieler unsichtbar machen
- defensiven Reset ermöglichen

### Linker Hauptast

**L1 + L2**

- bei erfolgreichem Einsatz in Gegnermassen verkürzte Wartezeit bis zum nächsten Decoy
- gezieltes Weglocken auch von Basis- und anderen strategischen Zielen
- persistente Verfolgung des Decoys

### Rechter Hauptast

**R1 + R2**

- schneller repositionieren
- HP regenerieren
- Adrenalin regenerieren
- Tarnphase maximal defensiv nutzen

### Boss

**Sprengattrappe**

- angelockte Gegner offensiv bestrafen
- bewussten Einsatz fragiler Decoys als Schnellzünder ermöglichen

### BL1

- Explosion mit Brandbrocken erweitern
- starke Nahbereichs- und Gruppenkontrolle gegen schnelle Verfolger

### BR2

- Bewegungsbahn des Decoys in eine brennende Falle verwandeln
- langsame Verfolger über Zeit bestrafen

---

## 11. Gameplay-Identität

Der Decoy-Baum soll eine klare Entwicklung besitzen.

### Ohne Boss-Upgrade

Das Decoy bleibt primär:

- defensiv,
- taktisch,
- täuschend,
- kontrollierend.

### Mit Boss-Upgrade

Das Decoy wird zusätzlich:

- explosiv,
- offensiv nutzbar,
- zu einer Falle für angelockte Gegner.

### Voll ausgebaut

Der Spieler kann das Decoy situationsabhängig einsetzen:

- als Fluchtwerkzeug,
- als Regenerationsfenster,
- als Basisverteidigungs-Lockvogel,
- als kurzfristigen Schnellzünder,
- als mobilen Feuerköder,
- als Gruppensammelpunkt für eine starke Explosion.

---

## 12. Lesbarkeit und Gamefeel

Die wichtigsten Zustände müssen visuell klar verständlich sein:

- Spieler ist durch Decoy getarnt
- Gegner hat das Decoy als Lockziel übernommen
- Sprengattrappe ist aktiv
- Explosion des Decoys
- Brandbrocken werden ausgeworfen
- Brennende Fährte liegt hinter dem Decoy

Besonders wichtig:

- Die Feuerfährte muss eindeutig hinter der realen Laufbewegung des Decoys entstehen.
- Brandbrocken und Feuerfährte sollen visuell aus derselben Feuerfamilie stammen, aber unterschiedliche räumliche Muster besitzen.
- BL1 soll als radialer Explosions-Folgeeffekt lesbar sein.
- BR2 soll als lineare bzw. kurvige Bewegungsfährte lesbar sein.

---

## 13. Initiale Balance-Basiswerte

| Parameter | Initialer Wert |
|---|---:|
| Basis-Cooldown | 12 s |
| Basis-Decoy-Lebensdauer | 6 s |
| Basis-Tarnungsdauer | 6 s |
| L1 Cooldown-Rückerstattung | -1 s pro Gegner beim Ende des Decoys |
| L1 Auswertungsradius I | 100 px |
| L1 Auswertungsradius II | 200 px |
| L1 Auswertungsradius III | 300 px |
| L2 Akquise-Radius I | 100 px |
| L2 Akquise-Radius II | 200 px |
| L2 Akquise-Radius III | 300 px |
| R1 Bewegung | +10 % pro Stufe |
| R2 passive Adrenalinregeneration | +10 % pro Stufe |
| R2 HP-Regeneration | +5 HP/s pro Stufe |
| Boss Explosionsradius | 150 px |
| Boss Explosionsschaden | 100 |
| Boss Knockback | 500 |
| BL1 Brandbrocken | +3 pro Stufe |
| BR2 I Feuerdauer | 2 s |
| BR2 II Feuerdauer | 3 s |
| BR2 III Feuerdauer | 4 s |
| BR2 I Ziel-DPS | ca. 8 |
| BR2 II Ziel-DPS | ca. 12 |
| BR2 III Ziel-DPS | ca. 16 |

Diese Werte bilden den ersten spielbaren Balance-Stand und sind ausdrücklich keine dauerhaft festgeschriebenen Endwerte.
