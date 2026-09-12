# FRAGDACHSE – GDD: Rocket-Launcher-Upgrade-Überarbeitung

**Version:** 2  
**Stand:** 2026-09-12  
**Waffe:** `ROCKET_LAUNCHER`  
**Status:** Umsetzung mit beschlossenen Ergänzungen in Abschnitt 18; initiale Balancewerte

---

## 1. Zielbild

Der neue Rocket-Launcher-Baum soll vier Kernfantasien klar unterstützen:

1. **Rocket-Jump / Nahkampf:** Eigene Explosionen als Movement-, Heal- und Schutzwerkzeug.
2. **Distanz-Skillshots:** Lange und schwierigere Schüsse werden durch Beschleunigung und höheren Schaden belohnt.
3. **UT-inspiriertes Raketenmagazin:** Mehrere Raketen laden und gleichzeitig als breite oder fokussierte Salve abfeuern.
4. **Brachiale Explosionen:** Hauptdetonation → Brandbrocken → kleine lokale Nachbeben.

Als Designregel entstehen maximal drei sichtbare Effektebenen:

> **Rakete → Hauptdetonation → Brandbrocken mit Nachbeben**

Spätere Upgrades verändern diese vorhandenen Ebenen, erzeugen aber keine weitere Kaskadenebene.

---

# 2. Upgrade-Baum

```text
L1  Raketensprung (1)
 ↓
L2 ★ Explosive Medizin (1)
 ↓
L3  Druckschild (3)

                         \
                          \
                           ★ B2 Nachbeben (1)
                          /                 \
                         /                   \
R1  Adrenalin-Verbrauch (bestehend)   Mehr Brandbrocken (3)
 ↓                                   +2 / Stufe
R2  Schwere Ladung (3)               8 / 10 / 12 insgesamt
 ↓
R3  Raketenmagazin (3)               Gezielte Streuung (1)
    2 / 4 / 6 Raketen
```

L2 ist ein frühes Boss-Upgrade innerhalb des linken Strangs.  
L3 und R3 münden gemeinsam in B2.

---

# 3. Linker Strang – Rocket-Jump, Heilung und Schutz

## L1 – Raketensprung

**Stufen:** 1

Eigene Rocket-Launcher-Explosionen verstärken den auf den Spieler wirkenden Bewegungsimpuls.

### Initialwert

- **Multiplikator des bisherigen Self-Explosion-Movement-Impulses: `4.0`**
- Der bestehende Impuls wird also vervierfacht.
- Der normale Waffen-/Schussrückstoß (`shotRecoilForce`) ist davon nicht betroffen.
- Self-Damage bleibt auf L1 unverändert.

### Ziel

L1 soll den bereits vorhandenen Rocket-Jump bewusst zu einem starken Movement-Werkzeug machen, ohne die Risikokomponente bereits zu entfernen.

---

## L2 ★ – Explosive Medizin

**Stufen:** 1  
**Boss-Upgrade**

Eigene Rocket-Launcher-Hauptdetonationen verursachen am Spieler keinen Self-Damage mehr, sondern heilen. Verbündete Spieler können ebenfalls geheilt werden.

### Initialwert

- **Heilung = 50 % des normalen radialen Explosionsschadens einschließlich Angriffsboni, ohne Self-Damage-Faktor und ohne Empfängerabwehr.**

### Heilbasis

Für Spieler und Verbündete wird zunächst die normale radiale Schadensbasis der Explosion an ihrer Position bestimmt.

Die Heilbasis verwendet den radialen Schaden einschließlich Angriffsboni. Der bisherige Self-Damage-Faktor wird nicht verwendet. Die Heilung hängt weiterhin davon ab, wie nah sich der Spieler an der Explosion befindet.

Anschließend:

```text
Heal = 0.50 × normaler radialer Schaden einschließlich Angriffsboni
```

### Regeln

- Der betreffende Rocket-Launcher-Schaden am Spieler wird vollständig unterdrückt.
- Stattdessen wird geheilt.
- Für Verbündete wird dieselbe radiale Berechnung verwendet, unabhängig davon, ob normales Friendly Fire aktiv wäre. Rüstung und Schadensreduktion des Empfängers vermindern die Heilung nicht.
- Overheal ist nicht vorgesehen.
- B2-Nachbeben lösen **nicht** zusätzlich Explosive Medizin aus; ihre defensive Synergie läuft über L3.

---

## L3 – Druckschild

**Stufen:** 3

Spieler, die von einer eigenen Rocket-Launcher-Hauptdetonation oder einem B2-Nachbeben erfasst werden, erhalten **20 Prozentpunkte zusätzliche Schadensreduktion**.

| Stufe | Schadensreduktion | Dauer |
|---|---:|---:|
| 1 | 20 % | 1 s |
| 2 | 20 % | 2 s |
| 3 | 20 % | 3 s |

### Regeln

- Gilt für den Besitzer und Verbündete.
- Die Schadensreduktion stackt nicht.
- Weitere gültige Treffer aktualisieren ausschließlich die Dauer.
- Nachbeben können Druckschild auslösen bzw. erneuern.

---

# 4. Rechter Strang – Effizienz, Distanz und Raketenmagazin

## R1 – Adrenalin-Verbrauch

**Stufen:** wie bestehend

Das bestehende Rocket-Launcher-Adrenalin-Upgrade bleibt erhalten und wird als R1 verwendet.

### Implementierungsregel

- Bestehende Werte und bestehende Modifier-Logik wiederverwenden.
- Keine neue Sonderlogik für R1.
- R1 erhält durch R3 zusätzliche natürliche Synergie, weil geringere Kosten größere Salven leichter ermöglichen.

---

# 5. R2 – Schwere Ladung

**Stufen:** 3

Die Rakete beschleunigt mit der bereits zurückgelegten Distanz. Parallel steigt ihr Schadensmultiplikator.

## 5.1 Initialwerte

Pro Stufe:

- **bis zu +50 % Projektilgeschwindigkeit**
- **bis zu +50 % Schaden**
- Maximalbonus nach **300 px Flugdistanz**
- Anstieg von 0 bis 300 px **linear**

| R2 | Max. Geschwindigkeit | Max. Schaden |
|---|---:|---:|
| 1 | +50 % | +50 % |
| 2 | +100 % | +100 % |
| 3 | +150 % | +150 % |

## 5.2 Formel

```text
progress = clamp(travelDistance / 300px, 0, 1)

speedMultiplier  = 1 + progress × (0.50 × level)
damageMultiplier = 1 + progress × (0.50 × level)
```

Beispiel R2/3:

| Flugdistanz | Speed-Bonus | Damage-Bonus |
|---:|---:|---:|
| 0 px | 0 % | 0 % |
| 100 px | +50 % | +50 % |
| 200 px | +100 % | +100 % |
| 300+ px | +150 % | +150 % |

## 5.3 Schadensvererbung

Beim Einschlag besitzt jede Rakete genau **einen** finalen R2-Schadensmultiplikator.

Dieser gilt für:

1. direkten Projektilschaden,
2. Hauptdetonation,
3. B2-Nachbeben der Brandbrocken dieser Rakete.

Brandbrocken sammeln während ihres eigenen Flugs **keinen weiteren R2-Bonus**.

### Ziel

R2 belohnt präzise Distanzschüsse, während der linke Strang den Nahkampf stärkt. Dadurch erhält der Rocket Launcher zwei unterschiedliche, aber kombinierbare Spielweisen.

---

# 6. R3 – Raketenmagazin

**Stufen:** 3

| Stufe | Maximale geladene Raketen |
|---|---:|
| 1 | 2 |
| 2 | 4 |
| 3 | 6 |

Vor der ersten R3-Stufe bleibt das heutige RMB-Verhalten vollständig unverändert.

Ab R3/1 wird RMB zu einem Tap-/Hold-Feuermodus.

---

## 6.1 Einzelschuss

Ein kurzer RMB-Klick feuert genau **eine Rakete**.

Die erste Rakete gilt beim RMB-Down unmittelbar als geladen. Wird RMB direkt wieder losgelassen, wird sie sofort abgefeuert.

Es gibt keinen zusätzlichen künstlichen Hold-Threshold.

---

## 6.2 Laden

Solange RMB gehalten wird, werden weitere Raketen geladen.

### Ladeintervall

- **Das Ladeintervall entspricht dem normalen aktuell aufgelösten Rocket-Launcher-Cooldown.**
- Der Basis-Cooldown beträgt in allen Spielmodi **800 ms**. Verwendet wird der tatsächlich aufgelöste Cooldown.
- Das Raketenmagazin erzeugt dadurch keine kostenlose zusätzliche DPS.

### Automatisches Abfeuern

Die komplette geladene Salve wird sofort abgefeuert, sobald eine der Bedingungen erfüllt ist:

1. RMB wird losgelassen.
2. Das R3-Maximum wurde geladen.
3. Das vorhandene Adrenalin reicht für keine weitere Rakete.
4. Dash, Einbuddeln oder Utility-Nutzung wird ausgelöst. Die bereits bezahlte Salve feuert vor der jeweiligen Aktion; anschließend ist ein neuer RMB-Klick nötig.

Jede Rakete besitzt die normalen aktuellen Adrenalinkosten des Rocket Launchers.

Die Kosten werden beim Laden einer Rakete reserviert bzw. verbraucht, damit nie mehr Raketen geladen werden können, als tatsächlich bezahlbar sind.

---

## 6.3 Gleichzeitiger Abschuss

Alle geladenen Raketen werden **im selben Abschusszeitpunkt** erzeugt.

- Keine zeitversetzte Salve.
- Keine besondere erste oder letzte Rakete.
- Jede Rakete ist mechanisch gleichwertig.
- Jede Rakete berechnet ihren R2-Flug-/Schadensbonus selbst.
- Jede Rakete kann unabhängig B2 auslösen.

---

## 6.4 Standardformation

Die Salve verwendet einen konfigurierbaren **Winkelabstand von 4°**.

| Raketen | Winkel relativ zur Zielrichtung |
|---:|---|
| 1 | `0°` |
| 2 | `-4°, +4°` |
| 3 | `-4°, 0°, +4°` |
| 4 | `-8°, -4°, +4°, +8°` |
| 5 | `-8°, -4°, 0°, +4°, +8°` |
| 6 | `-12°, -8°, -4°, +4°, +8°, +12°` |

Die Raketen fliegen nach dem Abschuss geradlinig auf diesen Winkeln weiter.

Sie werden später **nicht** wieder zur zentralen Zielrichtung zurückgeführt.

---

## 6.5 Fokusformation mit LMB

Während RMB lädt, schaltet jeder neue LMB-Klick den Fokus-Modus um. Loslassen verändert den Modus nicht; dauerhaftes Halten schaltet nicht wiederholt um. Ein gleichzeitiger RMB-/LMB-Klick startet fokussiert. Automatische Ladezyklen desselben RMB-Haltens behalten den Modus; ein neuer RMB-Griff beginnt im Standardmodus.

Ist Fokus beim Abschuss aktiv:

```text
focusAngle = standardAngle × 0.25
```

Damit wird der Winkel geviertelt.

| Raketen | Standard | Fokus |
|---:|---|---|
| 2 | `-4°, +4°` | `-1°, +1°` |
| 3 | `-4°, 0°, +4°` | `-1°, 0°, +1°` |
| 4 | `-8°, -4°, +4°, +8°` | `-2°, -1°, +1°, +2°` |
| 5 | `-8°, -4°, 0°, +4°, +8°` | `-2°, -1°, 0°, +1°, +2°` |
| 6 | `-12°, -8°, -4°, +4°, +8°, +12°` | `-3°, -2°, -1°, +1°, +2°, +3°` |

### Ziel

- Standard: Flächenabdeckung.
- Fokus: konzentriertes Feuer auf einzelne Ziele.
- Kein Schadensbonus.
- Kein neuer Projektiltyp.

Das Spiel verhindert bereits gleichzeitiges normales Feuern beider Waffen; während des Rocket-Launcher-Ladens schaltet R3 mit der LMB-Drückflanke ausschließlich den Fokus um.

---

# 7. B2 ★ – Nachbeben

**Stufen:** 1  
**Gemeinsames Boss-Upgrade**

Jede Rocket-Launcher-Hauptdetonation schleudert **6 Brandbrocken** aus.

Diese Brandbrocken verwenden ausdrücklich das **bereits vorhandene Fire-Chunk-/Brandbrocken-System**.

Es soll **keine zweite Rocket-spezifische Brandbrocken-Implementierung** entstehen.

---

## 7.1 Bestehende Mechanik wiederverwenden

Die vorhandene `FireChunkBurst`-/`FlamethrowerUpgradeSystem`-Logik soll für:

- Auswahl der Landepunkte,
- Brandbrocken-Flug/Präsentation,
- verzögerte Landung,
- Erzeugen des Bodenbrands

wiederverwendet bzw. sauber erweitert werden.

Rocket-B2 ergänzt ausschließlich die für diesen Effekt nötigen Regeln:

1. spezielle Zielauswahl innerhalb der Raketenexplosion,
2. kleine lokale Explosion beim Einschlag,
3. optional gezielte Verteilung durch das Post-Boss-Upgrade.

---

## 7.2 Anzahl

Basis:

- **6 Brandbrocken pro Hauptdetonation**

Mit Post-Boss-Upgrade:

- maximal **12**

---

## 7.3 Suchbereich und zufällige Verteilung

Ohne „Gezielte Streuung“ werden die Brandbrocken zufällig innerhalb des Radius der ursprünglichen Hauptdetonation verteilt.

Aktueller Rocket-Launcher-Basisradius:

- **110 px** als Ausgangswert
- tatsächlich den aufgelösten aktuellen Explosionsradius verwenden

### Gültiger Landepunkt

Ein zufälliges Ziel ist nur gültig, wenn:

1. es innerhalb des aktuellen Haupt-Explosionsradius liegt,
2. dort ein gültiger Ground-Fire-Landepunkt existiert (`canPlaceGroundCell` bzw. äquivalente bestehende Prüfung),
3. vom Ursprung der Hauptdetonation zum Landepunkt eine freie Sicht-/Fluglinie besteht.

Geblockte Flugbahnen werden verworfen und durch andere gültige Kandidaten ersetzt.

---

# 8. Gemeinsame Brandbrocken-Flugzeit

## 8.1 Repository-Ausgangslage

Das aktuelle Fire-Chunk-System verwendet pro Burst einen einzelnen `flightMs`-Wert und daraus einen gemeinsamen `landsAt`-Zeitpunkt für alle Ziele.

Dadurch landen heute nahe und weit entfernte Brandbrocken desselben Bursts gleichzeitig.

Das soll im Rahmen dieser Umsetzung im **gemeinsamen Brandbrocken-System** verbessert werden.

---

## 8.2 Neue gemeinsame Distanzregel

`flightMs` bleibt als existierender Konfigurationswert erhalten und beschreibt künftig:

> **Flugzeit eines Brandbrockens bis zum maximalen `searchRadius`.**

Für jeden Brandbrocken wird die tatsächliche Flugzeit individuell aus seiner Distanz berechnet:

```text
distanceFactor = clamp(distanceToTarget / searchRadius, 0, 1)
actualFlightMs = max(1ms, flightMs × distanceFactor)
```

Damit besitzen alle Brandbrocken eines Bursts dieselbe implizite Fluggeschwindigkeit.

### B2-Basiswert

- `flightMs`: **320 ms**
- bei Landung am äußeren Rand des Suchradius
- der Wert entspricht dem bereits häufig verwendeten bestehenden Fire-Chunk-Basiswert

Beispiel bei 110 px Suchradius:

| Entfernung | ca. Flugzeit |
|---:|---:|
| 27.5 px | 80 ms |
| 55 px | 160 ms |
| 82.5 px | 240 ms |
| 110 px | 320 ms |

### Wichtig

Diese Verbesserung soll im bestehenden gemeinsamen Fire-Chunk-System erfolgen und nicht als Sonderflugmodell nur für den Rocket Launcher.

Bestehende Fire-Chunk-Konfigurationen behalten ihren `flightMs`-Wert und damit ihre bisherige maximale Flugzeit.

---

# 9. Bodenbrand der B2-Brandbrocken

Jeder eingeschlagene Brandbrocken setzt am Landepunkt wie bestehende Brandbrocken den Boden in Brand.

Als initiales Rocket-B2-Profil wird das etablierte Fire-Chunk-Grundverhalten verwendet:

- **Bodenbranddauer: 2000 ms**
- **Burn-Dauer auf getroffenen Gegnern: 2000 ms**
- **Burn-Schaden pro Tick: 0.5**
- bestehende Fire-Chunk-Darstellung und Ground-Fire-Logik wiederverwenden
- kein Bodenbrand am Zentrum allein durch B2 (`igniteCenter = false`)

Diese Werte sind initiale Basiswerte und können später zentral angepasst werden.

---

# 10. Lokales Nachbeben beim Brandbrocken-Einschlag

Rocket-B2-Brandbrocken unterscheiden sich von normalen Brandbrocken dadurch, dass bei ihrer Landung zusätzlich eine kleine Explosion ausgelöst wird.

## Initialwerte

- **Radius:** `50 px`
- **Maximalschaden im Zentrum:** `15`
- **Minimalschaden am Rand:** `5`
- **Knockback:** `0`

Der Schaden fällt innerhalb der 50 px radial vom Maximal- zum Minimalschaden ab.

### Regeln

- Kein Knockback: Die zeitversetzten kleinen Explosionen sollen Gegner nicht chaotisch hin- und herschieben.
- Nachbeben erzeugen keine weiteren Brandbrocken.
- Nachbeben erzeugen keine weiteren Nachbeben.
- R2-Schadensmultiplikator der Ursprungsrakete gilt auch für `5–15` Nachbeben-Schaden.
- Nachbeben können L3 Druckschild auf Spieler/Verbündete auslösen bzw. erneuern.
- Nachbeben lösen nicht zusätzlich L2 Explosive Medizin aus.
- Der Bodenbrand entsteht unabhängig von der lokalen Explosion über die bestehende Fire-Chunk-Logik.

---

# 11. Post-B2 A – Mehr Brandbrocken

**Stufen:** 3

Erhöht ausschließlich die Anzahl der von B2 erzeugten Brandbrocken um **2 je Stufe**.

| Zustand | Brandbrocken |
|---|---:|
| B2 | 6 |
| Stufe 1 | 8 |
| Stufe 2 | 10 |
| Stufe 3 | 12 |

Keine weitere Regeländerung.

---

# 12. Post-B2 B – Gezielte Streuung

**Stufen:** 1

„Gezielte Streuung“ sorgt dafür, dass Gegner, die die Hauptdetonation überlebt haben, möglichst jeweils einen Brandbrocken erhalten.

## Ablauf

Nach der Hauptdetonation:

1. Ermittle alle noch lebenden Gegner innerhalb des aktuellen Haupt-Explosionsradius.
2. Entferne Gegner ohne gültige Sicht-/Fluglinie vom Explosionsursprung.
3. Weise verfügbaren Brandbrocken möglichst unterschiedlichen gültigen Gegnern zu.
4. Pro Gegner wird maximal **ein** Brandbrocken gezielt.
5. Ein gezielter Brocken erhält die Position dieses Gegners zum Zeitpunkt der Zielauswahl als Landepunkt.
6. Der Brocken homt danach **nicht** und verfolgt bewegte Gegner nicht.
7. Für alle übrigen Brandbrocken werden wie ohne Upgrade zufällige gültige Landepunkte gewählt.

### Beispiel

```text
6 Brandbrocken
3 überlebende gültige Gegner

→ 1 Brocken zu Gegner A
→ 1 Brocken zu Gegner B
→ 1 Brocken zu Gegner C
→ 3 Brocken zufällig
```

Damit verbessert das Upgrade die Zuverlässigkeit, ohne alle Brandbrocken auf ein einziges Ziel zu konzentrieren.

---

# 13. Synergien

## L1 + L2

Rocket-Jump wird vom riskanten Movement-Werkzeug zum aggressiven Heal-/Movement-Werkzeug.

## L2 + L3

Eine Nahkampfexplosion kann gleichzeitig heilen und Schutz gewähren.

## L3 + B2

Zeitversetzte Nachbeben können Druckschild nach der Hauptdetonation erneut aktualisieren.

## R1 + R3

Geringere Adrenalinkosten erleichtern große Magazine.

## R2 + R3

Jede gleichzeitig abgefeuerte Rakete baut auf Distanz individuell Geschwindigkeit und Schaden auf.

## R2 + B2

Nachbeben erben den beim Haupteinschlag erreichten Schadensmultiplikator.

## R3 + B2

Mehrere gleichzeitige Hauptdetonationen können jeweils eigene Brandbrocken-Bursts auslösen.

## B2 + Mehr Brandbrocken

Direkte Eskalation von 6 auf bis zu 12 Landungen/Nachbeben.

## B2 + Gezielte Streuung

Überlebende Gegner im Explosionsbereich erhalten zuverlässig maximal einen gezielten Folgeeinschlag.

---

# 14. Entfernte bisherige Rocket-Launcher-Upgrades

Im neuen Baum entfallen bzw. werden ersetzt:

- Schwarzes Loch
- Schwarzes-Loch-Dauer
- Schwarzes-Loch-Sog
- reines Cooldown-Upgrade
- reines Explosionsradius-Upgrade
- reines pauschales Schadensupgrade
- bisherige großflächige „Brennende Explosion“

Die Black-Hole-Fantasie gehört zum entsprechenden Turm.

---

# 15. Initiale Balanceübersicht

| Mechanik | Initialwert |
|---|---|
| L1 Rocket-Jump | `4.0×` Self-Explosion-Movement-Impuls |
| L2 Explosive Medizin | Heal = `50 %` des normalen radialen Schadens einschließlich Angriffsboni |
| L3 Druckschild | `20 %` DR für `1 / 2 / 3 s` |
| R1 Adrenalin | bestehende Werte |
| R2 Speed | `+50 % / Stufe`, linear bis 300 px |
| R2 Damage | `+50 % / Stufe`, linear bis 300 px |
| R3 Kapazität | `2 / 4 / 6` |
| Rocket-Cooldown | `800 ms` in allen Spielmodi |
| R3 Ladeintervall | aktueller normaler Rocket-Cooldown |
| R3 Standardwinkel | `4°` Abstand |
| R3 Fokuswinkel | `0.25×` Standardwinkel |
| B2 Basisbrocken | `6` |
| B2 Suchradius | aktueller Haupt-Explosionsradius |
| B2 max. Fire-Chunk-Flugzeit | `320 ms` am Suchradius |
| B2 Ground Fire | `2000 ms` |
| B2 Burn | `2000 ms`, `0.5` Schaden/Tick |
| B2 Nachbebenradius | `50 px` |
| B2 Nachbebenschaden | `15 → 5` radial |
| B2 Knockback | `0` |
| Mehr Brandbrocken | `+2 / Stufe`, max. `12` |
| Gezielte Streuung | `1` Stufe, max. 1 gezielter Brocken je Gegner |

---

# 16. Technische Leitplanken

Diese Punkte sind Teil des Designs und sollen bei der Implementierung erhalten bleiben:

1. **Bestehende Brandbrocken wiederverwenden.** Kein paralleles Rocket-spezifisches Fire-Chunk-System.
2. Distanzabhängige Brandbrocken-Flugzeit möglichst im gemeinsamen Fire-Chunk-System ergänzen.
3. LOS-Prüfung als sauber konfigurierbare Gültigkeitsregel in die bestehende Zielauswahl integrieren.
4. Rocket-B2 ergänzt die bestehende Landung lediglich um eine optionale lokale Explosion.
5. R2 verwendet einen einzelnen pro Rakete bestimmten Multiplikator und vererbt ihn an B2; keine zweite Skalierung während des Brandbrockenflugs.
6. R3 erzeugt normale Rocket-Launcher-Projektile; keine separaten Magazin-Projektiltypen.
7. Alle Winkel, Multiplikatoren, Radien, Schäden und Zeiten zentral konfigurierbar halten.

---

# 17. Abnahmekriterien

Die Umsetzung ist funktional abgeschlossen, wenn:

- L1 den bestehenden Rocket-Jump-Impuls exakt vervierfacht.
- L2 50 % des normalen radialen Schadens einschließlich Angriffsboni als Heilung für Besitzer/Verbündete verwendet, ohne Self-Damage-Faktor und ohne Empfängerabwehr.
- L3 korrekt 20 % DR für 1/2/3 s vergibt und nur die Dauer aktualisiert.
- R2 Geschwindigkeit und gesamten zugehörigen Schaden linear bis 300 px skaliert.
- R3 Tap als Einzelschuss und Hold als 2/4/6-Magazin funktioniert.
- R3 mit dem normalen Rocket-Cooldown lädt (Basis 800 ms in allen Modi).
- jeder LMB-Klick beim Laden den Fokus umschaltet, unabhängig vom anschließenden Halten oder Loslassen.
- Dash, Einbuddeln und Utility-Nutzung bezahlte Raketen genau einmal vor der jeweiligen Aktion abschießen.
- die Zielhilfe beim nächsten Magazin-Griff auch nach einem Primärwaffenschuss wieder zum Raketenwerfer wechselt.
- alle geladenen R3-Raketen gleichzeitig abgefeuert werden.
- Standard- und Fokuswinkel der definierten Matrix entsprechen.
- B2 das bestehende Brandbrocken-System wiederverwendet.
- Brandbrocken ausschließlich gültige Landepunkte mit freier Fluglinie wählen.
- Brandbrocken abhängig von ihrer Distanz unterschiedliche Flugzeiten besitzen.
- jeder Rocket-B2-Brandbrocken Bodenbrand erzeugt.
- jeder Rocket-B2-Brandbrocken zusätzlich genau ein 50-px-Nachbeben mit 5–15 Schaden und 0 Knockback erzeugt.
- B2-Kaskaden nicht rekursiv weitere Brandbrocken/Nachbeben erzeugen.
- Gezielte Streuung pro überlebendem Gegner maximal einen Brocken zuweist und übrige Brocken zufällig verteilt.

## 18. Beschlossene Ergänzungen zur Umsetzung (2026-09-12)

Diese Entscheidungen konkretisieren beziehungsweise ersetzen abweichende Aussagen der ursprünglichen Version 2. Nicht geänderte Zahlen bleiben initiale Balancewerte.

| Thema | Verbindliche Umsetzung |
|---|---|
| Punkte und Voraussetzungen | L2 und B2 kosten jeweils einen Boss-Punkt und keinen normalen Punkt. Normale Knoten kosten einen regulären Punkt je Stufe. Jeder Vorgänger muss mindestens Stufe 1 besitzen. B2 benötigt beide Vorgänger L3 und R3. |
| Heilbasis | 50 % des normalen radialen Hauptdetonationsschadens einschließlich R2, Power-ups und Angriffsboni. Der Self-Damage-Faktor und die Abwehr des Empfängers werden nicht angewandt. Besitzer und verbündete Spieler erhalten Heilung ohne Overheal. |
| Druckschild | Additive 20 Prozentpunkte Schadensreduktion; die gesamte Reduktion bleibt auf 100 % begrenzt. Dauer 1/2/3 s. Weitere Anwendungen stapeln die Stärke nicht und setzen das Ende auf mindestens den neuen Ablaufzeitpunkt. |
| Magazinbedienung | Tap schießt beim Loslassen. Die erste bezahlbare Rakete wird ohne Hold-Schwelle geladen. Hold lädt und feuert bei vollem Magazin automatisch; danach beginnt bei weiter gehaltenem RMB nach dem normalen Cooldown die nächste Ladung. |
| Ressourcen | Kosten werden je Rakete beim Laden nach den aktuellen Kostenmodifikatoren verbraucht. Sobald keine weitere Rakete bezahlbar ist, wird die vorhandene Salve abgefeuert. Beim Abschuss werden keine weiteren Kosten abgezogen. |
| Abbruch | Dash, Einbuddeln und Utility-Nutzung schießen die geladene Salve vor der Aktion ab. Waffen-/Buildwechsel, Menü, Eingabe- oder Fensterfokusverlust, Tod, sonstige Handlungsunfähigkeit und Lifecycle-Ende verwerfen die Ladung ohne Erstattung. Ein abgebrochener Mausgriff benötigt erneutes Loslassen und Drücken. |
| Fokus und Rückstoß | RMB besitzt während des Ladens die Waffenbedienung; Jeder LMB-Klick schaltet den Fokus um, auch beim gleichzeitigen Drücken beider Tasten. Loslassen beendet den Fokus nicht. Ziel und Fokus werden beim Abschuss ausgewertet. Eine Salve erzeugt einen normalen Schussrückstoß, jede Hauptdetonation einen eigenen Explosionsimpuls. L1 verändert ausschließlich den eigenen Explosionsimpuls. |
| Flug und Reichweite | Cursorentfernung begrenzt weiterhin die Flugstrecke. R2 zählt tatsächlich zurückgelegte Segmente bis zum Kontakt; Portalversatz zählt nicht. Zeitblasen verändern die Simulation weiterhin korrekt. |
| Vererbung | R2 wird einmal auf Direkttreffer, Hauptdetonation und deren Nachbeben angewandt. Bodenbrand erhält keinen zusätzlichen R2-Bonus. Die Hauptdetonation fixiert Angriffsboni für verzögerte Nachbeben. Raketen und Landungen führen Herkunft, Zugehörigkeit und aufgelöste Rocket-Effekte mit. |
| Deckung | Brandbrocken benötigen gültige Bodenbrandzellen, Positionen innerhalb des Suchradius und freie Fluglinien. Explosionen wirken weiterhin radiusbasiert, auch durch Deckung. |
| Zielauswahl | Gezielte Streuung mischt die nach der Hauptdetonation gültigen überlebenden Gegner zufällig. Pro Gegner und Hauptdetonation höchstens ein gezielter Brocken; feste Position beim Start, kein Homing. Übrige Brocken erhalten zufällige gültige Zellen. Bei Platzmangel entstehen weniger Brocken. |
| Globale Flugzeit | Für sämtliche Erzeuger gemeinsamer Brandbrocken gilt: max(1 ms, flightMs × min(1, Distanz / searchRadius)). Ein Burst führt einen gemeinsamen Startzeitpunkt und individuelle Landezeitpunkte. Verspätete Darstellung verschiebt keine Landung; die frühere Mindestanimation entfällt. |
| Landung | Rocket-B2 erzeugt je Landung einmal Bodenbrand und einmal ein Nachbeben. Nachbeben schädigen nur feindliche Ziele und gewähren Freunden Druckschild, ohne Heilung oder weitere Kaskade. Bodenbrand behält seine bisherigen Zielregeln. Veränderte Hindernisse werden bei der Bodenbrandplatzierung erneut geprüft; die Explosion ist unabhängig davon. |
| Profile und Texte | Freischaltung und bisherige R1-ID bleiben erhalten. Entfernte Investitionen werden durch die bestehende Profilbereinigung wieder frei, ohne Umwandlung. Alle Rocket-Knoten einschließlich Freischaltung verwenden lokalisierte Textplatzhalter; keine neuen oder ersatzweise alten Upgrade-Icons. |
| Darstellung | Segmentierter Cursor-Ladering mit engeren Markierungen und Farbwechsel im Fokus. Bestätigte Heilung nutzt vorhandene grüne Partikel. Druckschild erhält eine pulsierende Cyan-Hülle während seiner Laufzeit, ohne Statusicon. Raketen, Explosionen und kleinere Nachbeben verwenden vorhandene Effekte. Audio und Kamera bleiben bei Salven begrenzt. |
| Netzwerk und Lifecycle | Der Host besitzt Magazin, Kosten und Abschuss. Eingabeidentität und Activity-Zuordnung sperren veraltete beziehungsweise doppelte Aktionen. Ladezustand, Ladezeit, Schildende und bestätigte Heilungen werden repliziert. Tod, Respawn, Spielerentfernung und World-/Activity-Wechsel räumen Zustände und Darstellung auf. Das geänderte Brandbrockenformat benötigt eine passende Peer-Protokollversion. |

### Automatisierte Abnahme

Die Umsetzung wird über die bestehenden Kern-, Architektur- und Integrationstests sowie den Produktionsbuild geprüft. Neue Verhaltenstests decken insbesondere Magazin, Eingabe/RPC, Profilbereinigung, Distanzsegmente, Portaltransport, Zeitblasen, Heilung, additive Schadensreduktion, Brandbrocken-Landungen und Render-Cleanup ab.

Es erfolgen ausdrücklich **keine Browserprüfung und keine Balance-Lab-Auswertung**. Spielgefühl, visuelle Qualität im laufenden Spiel und Stärke der Heil-/Schutzkombination bleiben praktisch unbestätigt. Die Zahlen in diesem Dokument sind Startwerte.
