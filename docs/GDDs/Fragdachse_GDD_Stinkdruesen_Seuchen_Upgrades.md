# FRAGDACHSE – GDD: Stinkdrüsen / Seuchen-Upgradebaum

## 1. Zielbild

Die Stinkdrüsen bleiben eine **sofort ausgelöste Nahkampf-Utility rund um den Spieler**. Sie sollen aggressives Spiel mitten in Gegnergruppen belohnen und gleichzeitig als „Oh Shit!“-Button funktionieren.

Kernfantasien:
- **Aggressiver Nahkampf:** mitten in die Horde, Stinkdrüsen aktivieren, weiterkämpfen.
- **Survival:** während der Wolke beweglicher und widerstandsfähiger werden und über verseuchte Gegner Lifeleech erhalten.
- **Ansteckende Seuche:** nach dem Boss breitet sich die Verseuchung sichtbar durch dichte Horden aus.
- **Biohazard-/Schleim-Synergie:** tote Verseuchte können über vorhandene Schleimbrocken neue Schleimflächen erzeugen.

Die Schleimspur ist eine optionale Synergie, keine Voraussetzung.

---

## 2. Baseline

Aktuelle Grundfunktion:
- Aktivierung: **instant**
- Cooldown: **8 s**
- Wolkenradius: **180 px**
- Wolkendauer: **4 s**
- Basisschaden: **3 Schaden pro Tick**
- Tickintervall: **250 ms**
- Wolke entsteht direkt um den Spieler.
- Fokus liegt auf lebenden Gegnern; Struktur-/Umweltschaden bleibt nachrangig.

---

## 3. Upgradebaum

```text
                 STINKDRÜSEN
                 /        \
        L1 Verseuchung    R1 Ausbreitung
              |                |
        L2 Lebensraub     R2 Kampfmodus
                 \        /
                    BOSS
                   /    \
                 BL1    BR1
```

| Knoten | Stufen | Effekt |
|---|---:|---|
| L1 | 3 | Gegner werden 4 s verseucht; Seuchenschaden steigt je Stufe |
| L2 | 3 | Alle Verbündeten erhalten 10 % Lifeleech/Stufe gegen Verseuchte |
| R1 | 3 | Cooldown sinkt und Wolkenradius steigt |
| R2 | 3 | Während der Primärwolke mehr Bewegungsgeschwindigkeit und Schadensreduktion |
| Boss | 1 | Verseuchung wird ansteckend und breitet sich aktiv durch Gegnergruppen aus |
| BL1 | 1 | Verseuchte Gegner sind verwundbar |
| BR1 | 3 | Tote Verseuchte schleudern Schleimbrocken |

Alle Zahlen sind initiale, leicht tweakbare Balancewerte.

---

# 4. L1 – Verseuchung

**3 Stufen**

Jeder Gegner, der von der ursprünglichen Stinkwolke getroffen wird, erhält den Status **Verseucht**.

Regeln:
- direkte Verseuchung dauert **4 s**
- Verseuchung verursacht einen eigenen Seuchen-DoT
- ohne Boss ist die Seuche **nicht ansteckend**
- ohne Boss verändert sie das Bewegungsverhalten nicht
- erneute direkte Anwendung erneuert die Dauer, stapelt aber nicht
- die drei L1-Stufen erhöhen ausschließlich den Seuchenschaden

Initiale Werte:
- Seuchen-Tickintervall: **500 ms**

| Stufe | Schaden/Tick | DPS | Max. Schaden über 4 s |
|---|---:|---:|---:|
| I | 1 | 2 | 8 |
| II | 2 | 4 | 16 |
| III | 3 | 6 | 24 |

Der Seuchenschaden bleibt moderat; die große Eskalation entsteht später über Ausbreitung, Vulnerability und Lifeleech.

---

# 5. L2 – Lebensraub

**3 Stufen**

Alle verbündeten Spieler erhalten gegen **verseuchte Gegner** Lifeleech aus allen eigenen Schadensquellen.

| Stufe | Lifeleech |
|---|---:|
| I | 10 % |
| II | 20 % |
| III | 30 % |

Regeln:
- geheilt wird der verursachende verbündete Spieler
- Grundlage ist der **tatsächlich verursachte Schaden**
- gilt für alle eindeutig einem Spieler zuordenbaren Schadensquellen, z. B. Waffen, Projektile, Hitscan, Explosionen, DoTs und Utilities
- reiner Umwelt-/teamloser Schaden heilt niemanden
- Overkill-Schaden erzeugt keinen zusätzlichen Heal
- der Effekt gilt nur solange das Ziel aktuell **Verseucht** ist
- zunächst kein zusätzlicher Heal-Cap

Designziel:
- vor dem Boss entstehen temporäre Lifeleech-Ziele im Nahkampf
- nach dem Boss vervielfacht die Pandemie die Zahl dieser Ziele und macht das Upgrade besonders stark im Koop

---

# 6. R1 – Ausbreitung

**3 Stufen**

Verbessert Verfügbarkeit und Erstabdeckung der Stinkdrüsen.

Pro Stufe:
- **−15 % Basis-Cooldown**
- **+10 % Basisradius**

Bei 8 s Cooldown und 180 px Radius:

| Stufe | Cooldown | Radius |
|---|---:|---:|
| 0 | 8,0 s | 180 px |
| I | 6,8 s | 198 px |
| II | 5,6 s | 216 px |
| III | 4,4 s | 234 px |

Designziel:
- vor dem Boss häufiger und zuverlässiger große Gruppen treffen
- nach dem Boss mehr direkte **Generation-0-Träger** erzeugen und damit die Pandemie stärker starten

---

# 7. R2 – Kampfmodus

**3 Stufen**

Während die **ursprüngliche aktive Stinkwolke** des Spielers besteht, erhält der Besitzer:

| Stufe | Bewegung | Schadensreduktion |
|---|---:|---:|
| I | +10 % | 10 % |
| II | +20 % | 20 % |
| III | +30 % | 30 % |

Regeln:
- Buff startet mit der Primärwolke
- Buff endet spätestens mit dem Ende dieser Primärwolke
- später weiterlaufende Verseuchungen verlängern ihn nicht
- gilt nur für den Besitzer

Designziel:
- offensiv in die Horde gehen und dort repositionieren
- als Panic Button schneller und robuster aus einer Einkesselung herauskommen

---

# 8. Boss – Pandemie

**1 Stufe**

Das Boss-Upgrade macht den durch L1 bestehenden Status **Verseucht** ansteckend.

Die Seuche soll sich sichtbar durch dichte Horden ausbreiten, aber über eine feste Generationstiefe zuverlässig auslaufen.

## 8.1 Generationen

### Generation 0 – direkt verseucht
- Ursache: ursprüngliche Stinkwolke
- Dauer: **4 s**
- verwendet den aktuellen L1-Seuchenschaden
- ist ansteckend
- sucht aktiv einen noch nicht verseuchten Gegner

### Generation 1 – erste Übertragung
- Ursache: Ansteckung durch G0
- Dauer: **2 s**
- verwendet denselben L1-Seuchenschaden
- ist ansteckend
- sucht aktiv einen noch nicht verseuchten Gegner

### Generation 2 – zweite Übertragung
- Ursache: Ansteckung durch G1
- Dauer: **1 s**
- verwendet denselben L1-Seuchenschaden
- ist **nicht mehr ansteckend**
- sucht kein weiteres Infektionsziel

Danach gibt es keine weitere Generation.

---

## 8.2 Aktive Ausbreitung

G0- und G1-Gegner versuchen während ihrer infektiösen Phase aktiv, einen **noch nicht verseuchten Gegner** zu erreichen.

Initiale Werte:
- Suchradius: **220 px**
- Übertragungsdistanz: **40 px**

Regeln:
- bevorzugt wird der nächstgelegene gültige, nicht verseuchte Gegner
- wenn das Ziel infiziert, stirbt oder ungültig wird, wird ein neues Ziel gesucht
- gibt es kein gültiges Ziel, läuft normale KI weiter
- die tatsächliche Infektion geschieht erst bei engem Kontakt
- G2 verändert sein Bewegungsverhalten nicht mehr für weitere Übertragungen

Die Bewegung soll als sichtbares „Infektionsverhalten“ lesbar sein und kein permanenter Decoy-Taunt werden.

---

## 8.3 Masseninfektion

Es gibt **keine feste Obergrenze** der gleichzeitig verseuchten Gegner.

Ein infektiöser G0- oder G1-Träger darf während seiner infektiösen Phase mehrere gesunde Gegner anstecken, wenn diese die Übertragungsdistanz erreichen.

Die Begrenzung erfolgt ausschließlich über:
- kurze Infektionsdauer
- nur zwei übertragbare Generationen
- begrenzten Suchradius
- räumliche Nähe

Dadurch können dichte Horden spektakulär „kippen“, ohne dass die Seuche unbegrenzt über die gesamte Map läuft.

---

## 8.4 Reinfection / Refresh

- normale Seuchenübertragung stapelt Verseuchung nicht
- direkter Kontakt mit der ursprünglichen Stinkwolke setzt G1/G2 wieder auf **G0 mit 4 s**
- erneuter direkter Kontakt erneuert G0, ohne zusätzlichen Schadensstack
- L2-Lifeleech und BL1-Verwundbarkeit hängen nur am Status `Verseucht`, nicht an der Generation

---

# 9. BL1 – Septischer Schock

**1 Stufe**

Alle verseuchten Gegner sind für die Dauer ihrer Verseuchung **verwundbar**.

Regeln:
- verwendet die bereits bestehende allgemeine Vulnerability-Mechanik
- kein eigener neuer Vulnerability-Wert
- gilt für G0, G1 und G2
- endet mit dem Seuchenstatus

Designziel:
- klare Team-Fokusfenster erzeugen
- mehr eingehender Schaden verstärkt gleichzeitig den Nutzen von L2-Lifeleech

---

# 10. BR1 – Schleimseuche

**3 Stufen**

Stirbt ein verseuchter Gegner, schleudert er Schleimbrocken in seine Umgebung.

| Stufe | Schleimbrocken pro Tod |
|---|---:|
| I | 1 |
| II | 2 |
| III | 3 |

Regeln:
- verwendet die vorhandene Schleimblüten-/Schleimbrocken-Mechanik
- Brocken wählen gültige Zellen in der Umgebung des toten Gegners
- bestehende Schleimflächen werden erneuert, nicht gestapelt
- löst bei jedem Tod eines aktuell verseuchten Gegners aus, unabhängig von G0/G1/G2
- funktioniert auch ohne separat geskillte Schleimspur
- ist die Schleimspur vorhanden, verwenden die erzeugten Brocken deren aktuell aufgelöste Schleimwerte
- ohne Schleimspur wird eine definierte Baseline-Schleimkonfiguration verwendet

Designziel:

`Stinkdrüsen → Verseuchung → Pandemie → Tod → Schleimbrocken → kontaminiertes Schlachtfeld`

---

# 11. Gameplay-Synergien

## Nahkampf-Offensive
- R1 trifft initial mehr Gegner.
- L1 hält sie auch nach Verlassen der Wolke verseucht.
- L2 belohnt Weiterkämpfen gegen diese Ziele.
- R2 macht aggressives Positionieren innerhalb der Wolke sicherer.

## Oh-Shit-Button
- Instant-Aktivierung bleibt erhalten.
- R2 liefert sofort Bewegung und Schadensreduktion.
- L2 kann über Gegenangriffe auf bereits Verseuchte Sustain erzeugen.

## Pandemie
- R1 erzeugt mehr G0-Träger.
- Boss lässt G0 und G1 aktiv gesunde Ziele suchen.
- Keine harte Infektionsobergrenze.
- Kürzere Generationen verhindern unbegrenzte Ausbreitung.

## Koop
- L2 macht Verseuchte zu Lifeleech-Zielen für alle Verbündeten.
- BL1 macht dieselben Ziele zusätzlich verwundbar.
- Eine gut gestartete Pandemie erzeugt temporäre Team-Fokusziele.

## Schleim
- BR1 erzeugt aus toten Verseuchten Schleimflächen.
- Mit vorhandener Schleimspur entsteht ein Biohazard-Build aus Seuche und Schleim.

---

# 12. Fachliche Invarianten

1. Die Stinkdrüsen bleiben eine **Instant-Nahkampf-Utility rund um den Spieler**.
2. L1 etabliert `Verseucht` bereits vor dem Boss.
3. Vor dem Boss ist Verseuchung nicht ansteckend.
4. Boss transformiert Verseuchung in eine Infektionskette: **4 s → 2 s → 1 s**.
5. Nur G0 und G1 übertragen die Seuche.
6. Es gibt keine feste Obergrenze gleichzeitig Verseuchter.
7. G0/G1 suchen nur innerhalb eines begrenzten Radius aktiv gesunde Ziele.
8. Reinfection stackt nicht; direkter Primärwolkenkontakt kann G1/G2 zu G0 erneuern.
9. L2-Lifeleech gilt für alle Verbündeten und alle eindeutig zuordenbaren eigenen Schadensquellen.
10. R2 hängt ausschließlich an der ursprünglichen Primärwolke und wird nicht durch die Pandemie verlängert.
11. BL1 verwendet die bestehende Vulnerability-Mechanik.
12. BR1 verwendet vorhandene Schleimbrocken-/Schleimblütenlogik statt einer parallelen Sondermechanik.
13. Die Schleimspur bleibt optional.
14. Alle Balancewerte müssen zentral und leicht tweakbar bleiben.
15. Verseuchte Gegner und Übertragungsvorgänge müssen visuell klar erkennbar sein.
