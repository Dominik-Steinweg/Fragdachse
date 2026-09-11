# MG-Turm – Gameplay- und Upgrade-Konzept

**Version:** 3.1 – abgestimmte Umsetzung

**Stand:** 11. September 2026

**Status:** Beschlossenes Gameplay mit konkretisierten Kampf-, Koop-, Netzwerk- und Lifecycle-Regeln. Die visuelle Abnahme im Browser steht aus.

## 1. Kernrolle und Spielerfantasie

Der MG-Turm ist der klassischste Damage-Turm des Engineers: **große Reichweite, hohe Präzision, hohe Schussfrequenz und kontinuierlicher Single-Target-Schaden**.

Ohne Upgrades ist er bewusst schlicht. Geringe Baukapazitätskosten ermöglichen eine ganze MG-Stellung; **5–10 gleichzeitig gebaute MGs** sind ein relevantes Nutzungsszenario, keine festgelegte Baugrenze.

> Einfaches Standardgeschütz → autarker Spezialist für anhaltenden Beschuss → gemeinsam arbeitende MG-Batterie.

Die besondere Identität entsteht durch Zermürbung, gemeinsame Zielbearbeitung und das Zusammenspiel mehrerer günstiger Geschütze. Direkte Angriffe bleiben auf einzelne Ziele gerichtet.

Das GDD betrifft die persönlich einem Spieler zugeordneten MG-Konstruktionen und ihre Koop-Zusammenarbeit. Die Upgrades eines Spielers gelten nicht automatisch für unabhängige Basis-, Welt- oder Gegnertürme. Persönliche MGs behalten ihre Zuordnung auch dann, wenn sie Teil einer gespeicherten Aufstellung sind.

Der Geltungsbereich ist **Coop-Defense einschließlich Lobby-Kämpfen und gespeicherter persönlicher Aufstellungen**. Berechtigte Zermürbungsziele sind feindliche KI-Gegner einschließlich Elites/Bosse sowie angreifbare feindliche Basen. Spieler und andere Konstruktionen erhalten diesen Status nicht. Die automatische Zielauswahl bekommt keine zusätzlichen Zieltypen; feindliche Basen bleiben manuell fokussierbar.

### Persönliche MG-Basis

| Eigenschaft | Wert |
| --- | --- |
| Direktschaden | 5 |
| Schussabstand | 185 ms |
| Zielreichweite | 550 px |
| Geschossreichweite | 600 px |
| Baukapazität | 10 |
| HP / Baureichweite / Bau-Cooldown | Bestehende Werte bleiben erhalten. |

Diese Waffenwerte gelten ausschließlich für persönliche MGs. Der langsame Zermürbungsaufbau anhand der ursprünglichen Trefferwerte bleibt bestehen; die höhere Grundfrequenz beschleunigt ihn. Bestehende Türme übernehmen Profiländerungen sofort, ohne einen laufenden Schuss-Cooldown zurückzusetzen. Platzierungsanzeige, wiederhergestellte Konstruktionen und Turmfeuer verwenden denselben Besitzer-Resolver.

## 2. Upgrade-Baum

Der Baum umfasst **sechs normale Upgrades und ein Boss-Upgrade**. BL1 und BR1 gehören zu den sechs normalen Upgrades und sind ausschließlich nach dem eigenen Boss-Upgrade verfügbar. Die Freischaltung des Turms selbst zählt nicht dazu.

| Position | Name | Stufen | Wirkung je Stufe / Stufenwerte |
| --- | --- | --- | --- |
| L1 | Zermürben | 3 | Pro MG-Treffer +1 / +2 / +3 Prozentpunkte Zermürbung; 4 Sekunden aktiv, durch weitere gültige MG-Treffer erneuert. |
| L2 | Kalibrierte Feuerleitung | 3 | +50 Prozentpunkte zum Zermürbungsmaximum je Stufe; mit Basismaximum +50 % insgesamt bis +200 %. |
| R1 | Erweiterte Zieloptik | 3 | +20 % Zielerfassungs- und Schussreichweite je Stufe; insgesamt +20 / +40 / +60 %. |
| R2 | Feuerüberlegenheit | 3 | +10 % Schussfrequenz je Stufe; insgesamt +10 / +20 / +30 %. |
| Boss | Feuerleitnetz | 1 | Gemeinsame Zermürbung für alle MGs der befreundeten Spieler mit diesem Boss-Upgrade. |
| BL1 | Ausbluten | 3 | 1 Schaden pro Sekunde je 100 % aktueller Zermürbung und je Stufe. |
| BR1 | Zielübergabe | 3 | Beim Tod 20 / 40 / 60 % der aktuellen Zermürbung an Gegner im Radius von 150 px weitergeben. |

**Verbindungen:** L1 → L2; R1 → R2; L2 **und** R2 → Boss; Boss → BL1 und BR1.

Jeder Vorgänger muss mindestens **Stufe 1** besitzen. L1 und R1 setzen die vorhandene MG-Freischaltung voraus. BL1 und BR1 setzen bei jedem Spieler dessen eigenes Feuerleitnetz voraus. Jede normale Stufe kostet einen normalen Upgradepunkt; der Boss kostet einen Bosspunkt und keinen normalen Punkt. Die bestehenden Abhängigkeits- und Rückerstattungsregeln gelten. Neue Knoten beginnen in vorhandenen Spielständen auf Stufe 0.

## 3. Zermürbung: L1 und L2

### L1 – Zermürben

Jeder tatsächliche, gültige MG-Geschosstreffer erhöht die Zermürbung des getroffenen Gegners. Maßgeblich ist das tatsächlich getroffene Ziel und nicht nur das zuvor anvisierte Ziel. Fehlschüsse und von Hindernissen oder Schutz abgefangene Geschosse erzeugen keine Zermürbung auf einem dahinterliegenden Gegner. Der Zuwachs ist **additiv in Prozentpunkten**:

Zuerst verstärkt der bereits aktive Wert den ansonsten geltenden Direktschaden. **Erst bestätigter positiver Schaden erhöht den Wert.** Bei einem tödlichen Treffer zählt dieser Zuwachs bereits für die Zielübergabe. Blutung, abgeleitete Effekte und reflektierte Projektile erzeugen keine weiteren MG-Trefferanwendungen. Bereits abgefeuerte Geschosse behalten die Turm-, Besitzer- und World-Herkunft nach Zerstörung ihres Turms; ein ausgeschiedener Besitzer liefert keine weiteren Upgradeeffekte.

| L1-Stufe | Zuwachs pro Treffer |
| --- | --- |
| 0 | Keine Zermürbung |
| 1 | +1 Prozentpunkt |
| 2 | +2 Prozentpunkte |
| 3 | +3 Prozentpunkte |

Ein Treffer auf Stufe 3 erhöht beispielsweise +20 % Zermürbung auf +23 %. Ohne L2 beträgt das Maximum auf jeder freigeschalteten L1-Stufe **+50 % Schaden**.

Ohne Feuerleitnetz besitzt jeder MG-Turm einen **eigenen Zermürbungswert je Gegner**. Dieser verstärkt ausschließlich den Schaden dieses konkreten MGs gegen dieses Ziel. Andere Türme und Spieler profitieren nicht von diesem persönlichen Wert.

Zermürbung ist eine eigenständige Mechanik. Sie reduziert keine Rüstung und löst nicht automatisch den bestehenden Status **Verwundbar** aus.

### L2 – Kalibrierte Feuerleitung

Jede Stufe erhöht das Zermürbungsmaximum um **50 Prozentpunkte**:

| L2-Stufe | Maximaler Schadensbonus | MG-Schadensfaktor bei diesem Maximum |
| --- | --- | --- |
| 0 | +50 % | 1,5-fach |
| 1 | +100 % | 2-fach |
| 2 | +150 % | 2,5-fach |
| 3 | +200 % | 3-fach |

**+200 % Zermürbung bedeutet dreifachen MG-Schaden.** Der Zermürbungsbonus wird auf den ansonsten geltenden MG-Trefferschaden angewendet.

L1 bestimmt die Aufbaugeschwindigkeit, L2 die Obergrenze. Für persönliche Werte gilt die L2-Stufe des Turmbesitzers; für das Feuerleitnetz gelten die Koop-Regeln aus Abschnitt 6.

### Dauer und Erneuerung

**Zermürbung bleibt 4 Sekunden aktiv. Jeder weitere gültige MG-Treffer setzt die verbleibende Dauer des zugehörigen Werts erneut auf 4 Sekunden.** Die Dauer wird nicht aufaddiert. Auch ein Treffer bei bereits erreichtem Maximum erneuert sie.

| Zustand | Welche Treffer erneuern seine Dauer? |
| --- | --- |
| Persönliche Zermürbung ohne Boss | Nur Treffer desselben konkreten MG-Turms auf diesen Gegner. |
| Gemeinsame Zermürbung mit Boss | Treffer jedes MG-Turms eines Netzteilnehmers auf diesen Gegner. |

Während der vier Sekunden bleibt der gesamte aufgebaute Wert erhalten. Es gibt keinen schrittweisen Verfall und keine separat ablaufenden Einzelstacks. Ohne rechtzeitige Erneuerung endet der Status vollständig: Der Zermürbungswert fällt auf 0, sein MG-Schadensbonus entfällt und eine daran gebundene Blutung endet. Auch für die Zielwahl zählt dann wieder 0.

**Blutungsticks und Schaden aus anderen Quellen erneuern Zermürbung nicht.** Treffer eines MGs ohne Netzteilnahme erneuern ausschließlich dessen persönlichen Wert, nicht den Netz-Wert.

Beispiel: Ein Treffer bei Sekunde 0 startet die Dauer. Ein weiterer gültiger Treffer bei Sekunde 3 erhält den aufgebauten Wert und verschiebt das Ende auf Sekunde 7. Ohne weitere Anwendung ist ab Sekunde 7 keine Zermürbung mehr aktiv.

BR1 kann Zermürbung zusätzlich durch eine Zielübergabe anwenden; dafür gilt ebenfalls die Vier-Sekunden-Dauer, wie in Abschnitt 7 beschrieben.

## 4. Allgemeine Zielpriorisierung

Die Ziellogik ist eine Grundfunktion des MG-Turms und benötigt kein eigenes Upgrade. Berücksichtigt werden nur gültige, innerhalb der jeweiligen Reichweite tatsächlich beschießbare Ziele. Sicht- und Schusslinienregeln bleiben erhalten. Die bestehende Möglichkeit, über den Engineer manuell Ziele vorzugeben, bleibt erhalten; die Zermürbungspriorisierung erweitert nicht automatisch die beschießbaren Zieltypen.

Priorität:

1. Manuell vom Engineer priorisiertes Ziel, sofern gültig und erreichbar.
2. Gegner mit dem höchsten für diesen MG maßgeblichen, noch aktiven Zermürbungswert.
3. Bei gleichem Wert: der dem jeweiligen Turm nächstgelegene Gegner.
4. Bei weiterem Gleichstand: stabile Zielidentität.

Die Auswahl wird regelmäßig neu bewertet. Eine Schadensreservierung zur Vermeidung von Übertreffern findet nicht statt.

**Ohne Feuerleitnetz** zählt nur der eigene Zermürbungswert dieses MGs. Die Geschütze agieren autark. Fremde persönliche Werte und der Wert eines vorhandenen Koop-Netzes beeinflussen ihre Zielwahl nicht.

**Mit Feuerleitnetz** zählt der gemeinsame Netz-Wert. Ein stärker zermürbter Gegner zieht dadurch weitere MGs auf sich, sobald er für sie erreichbar wird. Das gilt auch für MGs anderer Netzteilnehmer. Die Priorität wird auch während eines laufenden Beschusses erneut berücksichtigt: Ein gültiges Ziel mit höherem maßgeblichem Wert kann das bisherige Ziel ablösen.

Ohne vorhandene Zermürbung entscheiden manueller Fokus und Entfernung. Elites und Bosse erhalten keine automatische Sonderpriorität. Unterschiedliche Reichweiten, Sichtlinien und Entfernungen können auch im Netz zu unterschiedlichen Zielen führen; es gibt keinen Zwang zum Beschuss desselben Gegners.

## 5. Rechter Ast: bessere Grundwaffe

### R1 – Erweiterte Zieloptik

Erhöht dauerhaft sowohl **Zielerfassungsreichweite als auch Schussreichweite** um 20 % je Stufe. Bezogen auf die jeweilige Basisreichweite ergeben sich die Faktoren **1,2 / 1,4 / 1,6**. Beide Reichweiten werden jeweils um diesen Faktor erhöht; die Baureichweite bleibt unverändert. Die Geschosse müssen Ziele innerhalb der erweiterten Zielerfassungsreichweite tatsächlich erreichen können.

Der Turm kann früher angreifen, Ziele länger beschießen und größere Überschneidungen mit den Schussbereichen anderer MGs erzeugen.

### R2 – Feuerüberlegenheit

Erhöht dauerhaft die **Schussfrequenz** um 10 % je Stufe. Bezogen auf die Basisfrequenz ergeben sich die Faktoren **1,1 / 1,2 / 1,3**.

Gemeint sind mehr Schüsse pro Sekunde, nicht eine gleich hohe prozentuale Verringerung des Schussabstands. Auf Stufe 3 beträgt der Schussabstand entsprechend den Basis-Schussabstand geteilt durch 1,3.

Beide Upgrades funktionieren unabhängig von Zermürbung und Abschüssen. Mehr Schüsse erzeugen in Kombination mit L1 zusätzlich schneller Zermürbung. Die Stufenboni beider Upgrades werden jeweils addiert, nicht untereinander aufgezinst.

## 6. Boss-Upgrade – Feuerleitnetz und Koop

### Teilnehmer und Wirkung

Alle MG-Türme eines Spielers mit **Feuerleitnetz** gehören zum gemeinsamen Netz. Im Koop umfasst dieses Netz auch die MGs aller befreundeten Mitspieler, die das Boss-Upgrade ebenfalls besitzen. Ein einzelner Boss-Besitzer bildet mit seinen eigenen MGs bereits ein Netz.

Innerhalb dieses Netzes besteht **ein gemeinsamer Zermürbungswert mit einer gemeinsamen Vier-Sekunden-Dauer je Gegner**. Jeder Treffer eines beteiligten MGs erhöht ihn entsprechend der **L1-Stufe seines eigenen Besitzers** und erneuert die Dauer. Alle beteiligten MGs nutzen den gemeinsamen Wert für Schaden und Zielpriorisierung. Persönliche und gemeinsame Zermürbung werden für denselben MG-Treffer nicht miteinander kombiniert.

Die Verbindung benötigt keine zusätzliche räumliche Nähe zwischen den MGs. Die individuelle Waffenreichweite und die normale Beschießbarkeit eines Ziels bleiben für jeden Turm maßgeblich.

**Der gemeinsame Schadensbonus gilt ausschließlich für die MGs des Netzes.** Spielerwaffen, andere Konstruktionstypen und MGs ohne eigene Netzteilnahme profitieren nicht davon.

### Gemischte Koop-Gruppen

Besitzt nur ein Teil der Spieler das Boss-Upgrade, laufen beide Formen parallel:

| MG-Besitzer | Aufbau, Schadensbonus und Zielpriorisierung |
| --- | --- |
| Mit Feuerleitnetz | Gemeinsamer Wert des Koop-Netzes. |
| Ohne Feuerleitnetz | Persönlicher Wert je eigenem MG und Gegner, mit eigenem L2-Maximum. |

Ein nicht teilnehmendes MG schreibt den Netz-Wert nicht fort und verwendet ihn nicht. Seine persönlichen Werte werden auch nicht zusätzlich zum Netz-Wert auf seinen Schaden angewendet.

Boss-Besitz und tatsächliche Spielteilnahme genügen als Netzbeitrag; ein eigenes gebautes MG ist nicht erforderlich. Der Tod des Engineers allein entfernt seinen Beitrag nicht. Reine Zuschauer tragen keine Upgrade-Stufen bei. In der Lobby gelten die tatsächlichen Freund-/Feindbeziehungen.

### Erwerb, Rückerstattung und Teilnehmerwechsel

Beim Boss-Erwerb wird je Ziel der höchste noch aktive persönliche oder vorhandene Netz-Wert übernommen. Er behält **seine eigene Ablaufzeit**; bei gleichen Werten gewinnt die spätere Ablaufzeit. Persönliche Werte des eintretenden Spielers werden anschließend entfernt.

Fällt ein Beitrag weg, werden Maximum, Blutungsstärke, Zurechnung und Übertragungsanteil neu bestimmt. Bestehende Werte werden nötigenfalls begrenzt; ihre Laufzeit wird nicht verlängert. Die Netzidentität bleibt bei verbleibenden Teilnehmern erhalten. Ohne Teilnehmer endet das Netz. Ein Spieler, der sein Boss-Upgrade verliert, beginnt persönliche Werte wieder bei null.

### Unterschiedliche Upgrade-Stufen im Netz

Für gemeinsame Effekte gilt jeweils der **höchste Wert unter den Netzteilnehmern**, nicht die Summe ihrer Werte:

| Eigenschaft | Maßgeblicher Wert |
| --- | --- |
| Zermürbungszuwachs pro MG-Treffer | L1-Stufe des Besitzers des treffenden MGs. |
| Gemeinsames Zermürbungsmaximum | Höchstes durch L2 bestimmtes Maximum der Netzteilnehmer. |
| BL1 – Blutungsstärke | Höchste BL1-Stufe der Netzteilnehmer. |
| BR1 – Übertragungsanteil | Höchste BR1-Stufe der Netzteilnehmer. |
| Reichweite und Schussfrequenz | Eigene R1-/R2-Stufen des jeweiligen Turmbesitzers. |

Die höchsten Werte für L2, BL1 und BR1 dürfen von unterschiedlichen Spielern stammen. Spieler ohne Boss-Upgrade steuern keine Werte zum gemeinsamen Netz bei. Für den gemeinsamen Blutungs- oder Übertragungseffekt müssen nicht alle Netzteilnehmer BL1 bzw. BR1 besitzen.

**Beispiel:** Spieler A hat Boss, L2 Stufe 1, BL1 Stufe 1 und BR1 Stufe 3. Spieler B hat Boss, L2 Stufe 2, BL1 Stufe 3 und BR1 Stufe 1. Das Netz verwendet **+150 % Maximum, BL1 Stufe 3 und BR1 Stufe 3**. Spieler C ohne Boss und mit L2 Stufe 3 behält für jedes eigene MG sein persönliches Maximum von +200 %, verändert aber das Netz nicht.

### Balancing-Prinzip

Viele MGs – insbesondere im Koop – erreichen die Obergrenze schneller. **Mehr Teilnehmer erhöhen jedoch nicht automatisch das Maximum und vervielfachen weder Blutungen noch Zielübergaben.** Der gemeinsame Zermürbungsbonus bleibt durch das höchste gültige Maximum gedeckelt, absolut bei +200 % mit L2 Stufe 3.

## 7. Post-Boss-Upgrades

### BL1 – Ausbluten

Gegner mit gemeinsamer Zermürbung erhalten einen Blutungs-DoT, wenn mindestens ein Netzteilnehmer BL1 besitzt. Pro Gegner besteht **ein Blutungseffekt des gemeinsamen Netzes**, unabhängig von der Anzahl beteiligter Spieler oder MGs.

Der Schaden folgt proportional dem aktuellen Zermürbungsbonus und der höchsten BL1-Stufe im Netz:

> **Blutungsschaden pro Sekunde = (aktueller Zermürbungsbonus in % / 100) × BL1-Stufe.**

| Aktuelle gemeinsame Zermürbung | BL1 Stufe 1 | BL1 Stufe 2 | BL1 Stufe 3 |
| --- | --- | --- | --- |
| 0 % | 0 Schaden/s | 0 Schaden/s | 0 Schaden/s |
| +50 % | 0,5 Schaden/s | 1 Schaden/s | 1,5 Schaden/s |
| +100 % | 1 Schaden/s | 2 Schaden/s | 3 Schaden/s |
| +150 % | 1,5 Schaden/s | 3 Schaden/s | 4,5 Schaden/s |
| +200 % | 2 Schaden/s | 4 Schaden/s | 6 Schaden/s |

Zwischenwerte skalieren ebenfalls proportional; volle 100-%-Schritte sind keine Voraussetzung. Maßgeblich ist der absolute Zermürbungswert, nicht der Anteil am erreichbaren Maximum. L2 erweitert damit das Blutungspotenzial, ohne bestehende Blutung abzuschwächen.

Die Blutungsstärke passt sich dem aktuellen, noch aktiven Netz-Wert an. Persönliche Zermürbung nicht teilnehmender MGs löst diesen Netz-Effekt nicht aus.

**Die Blutung besteht nur, solange die gemeinsame Zermürbung aktiv ist.** Sie hat keine zusätzliche Nachlaufdauer. Vier Sekunden nach der letzten gültigen Erneuerung endet sie zusammen mit der Zermürbung. Fortlaufende MG-Treffer erhalten den Effekt; sie dürfen die laufende Schadensabgabe nicht immer wieder aufschieben. Auch anteilige Schadenswerte und kürzere Zeitabschnitte müssen die angegebenen Schadensraten korrekt abbilden.

**Keine doppelte Zermürbungsskalierung:** Der so berechnete Blutungsschaden wird nicht nochmals mit dem MG-Schadensbonus aus Zermürbung multipliziert. Blutungsticks sind keine MG-Geschosstreffer, bauen selbst keine Zermürbung auf und erneuern deren Dauer nicht.

Die Abrechnung erfolgt in **250-ms-Intervallen**. Änderungen des Zermürbungswerts oder der BL1-Stufe werden zeitanteilig integriert; Bruchteile bleiben erhalten. Bei Ablauf wird ein letztes Teilintervall abgerechnet. Treffer verschieben den laufenden Abrechnungstakt nicht. Änderungen des beitragenden Besitzers rechnen bereits aufgelaufenen Schaden unter der bisherigen Zurechnung ab.

Zielseitige Verwundbarkeit und Schutz gelten. Besitzer-Schadensboni, kritische Treffer, Lebensraub und trefferabhängige Procs gelten nicht. Der Teilnehmer mit der höchsten BL1-Stufe erhält die Zurechnung; Gleichstände werden über stabile Spieler-IDs gelöst. Jede Schadensanwendung erhält genau eine Zurechnung.

### BR1 – Zielübergabe

Stirbt ein Gegner mit noch aktiver gemeinsamer Zermürbung, gibt das Netz einen Anteil seines zum Todeszeitpunkt aktiven Werts an andere lebende Gegner im Umkreis weiter, sofern mindestens ein Netzteilnehmer BR1 besitzt. Bereits abgelaufene Zermürbung kann nicht weitergegeben werden.

**Radius: 150 px bei freier Verbindung.** Jeder berechtigte Empfänger erhält den Übertragungswert; er wird nicht unter den Empfängern aufgeteilt. Mauern und andere feste Schusshindernisse blockieren. Bei Basen zählen die Zielkonturen für Entfernung und Verbindung; Quell- und Zielgrundfläche blockieren ihre eigene Verbindung nicht, dazwischenliegende Hindernisse dagegen schon.

| Höchste BR1-Stufe im Netz | Übertragungsanteil | Beispiel bei +200 % Zermürbung des gestorbenen Gegners |
| --- | --- | --- |
| 1 | 20 % | 40 Prozentpunkte |
| 2 | 40 % | 80 Prozentpunkte |
| 3 | 60 % | 120 Prozentpunkte |

Der Anteil bezieht sich auf die tatsächlich vorhandene Zermürbung, nicht auf das theoretische Maximum. Übertragene Zermürbung gehört zum gemeinsamen Netz; persönliche Werte nicht teilnehmender MGs werden nicht verändert.

**Die Todesursache ist unerheblich.** Der Effekt gilt auch bei einem finalen Treffer durch Spieler, andere Konstruktionen, MGs ohne Boss oder einen DoT. Pro Gegner-Tod erfolgt **genau eine Zielübergabe des Netzes**, nicht eine pro Turm oder Spieler.

BR1 verursacht selbst keinen Schaden. Der Übertragungswert wird zu vorhandener Netz-Zermürbung **addiert und am gültigen Maximum begrenzt**. Übergaben werden geordnet verarbeitet. Der Wert der toten Zielinstanz wird vor ihrer Statusbereinigung genau einmal entnommen.

**Jede gültige Zielübergabe gilt als neue Statusanwendung beim Empfänger und gibt dessen Netz-Zermürbung 4 Sekunden ab dem Übertragungszeitpunkt.** Auch hier werden Restlaufzeiten nicht aufaddiert. Weitere gültige MG-Treffer oder Zielübergaben können die Dauer erneut auf vier Sekunden setzen. Die Übertragung erzeugt keinen zusätzlichen L1-Trefferzuwachs.

### Zusammenspiel von BL1 und BR1

Übertragene gemeinsame Zermürbung bewirkt ebenfalls Blutung, wenn BL1 im Netz verfügbar ist. Tötet diese Blutung einen noch zermürbten Gegner, kann dessen Tod wiederum BR1 auslösen.

Es gibt kein künstliches Kettenlimit. Jede weitere Übergabe braucht einen tatsächlich eingetretenen Tod, noch aktive Zermürbung und berechtigte, lebende Empfänger.

Direktangriffe bleiben Single Target; die Kombination der Post-Boss-Effekte ermöglicht zusätzliche indirekte Flächenwirkung. Jede einzelne Anwendung bleibt an ihre Vier-Sekunden-Dauer gebunden. Ohne neue Treffer oder Zielübergaben enden Zermürbung und Blutung zuverlässig.

## 8. Darstellung und Spielgefühl

Die Basisversion zeigt klassisches, präzises MG-Feuer. Höhere Schussfrequenz und zunehmende Zermürbung sollen erkennbar sein, ohne jeden Treffer mit dominanten Spezialeffekten zu überladen.

Der Boss-Moment entsteht durch **konvergierendes Feuer mehrerer MGs** – im Koop auch über Spielergrenzen hinweg. Wenige kühle, entsättigte Partikel an der Zielkontur zeigen aktive Zermürbung zurückhaltender als Brennen. Es gibt keine Prozentzahlen, Statusringe oder Restzeitanzeigen und keine exakte Visualisierung der Stapelhöhe. Die Reichweitenvorschau beim Bauen bleibt davon unabhängig.

BL1 verwendet reduzierte bestehende GPU-Blutpartikel. Die visuelle Emission läuft unabhängig vom Schadenstakt und löst keine Serie vollständiger Trefferblutspritzer aus. BR1 zeigt kurze gerichtete Scanimpulse zu tatsächlich erreichten Empfängern. Vorhandene Atlasformen, Qualitätssteuerung und Sichtbarkeitsprüfung werden verwendet; neue Turmassets oder Icons sind nicht erforderlich.

Ein gemeinsamer GPU-Effektcontroller besitzt einen Emissionscallback für die Scene. Zielquellen werden bei Ablauf, Zielentfernung, Sichtbarkeitsverlust und World-Teardown freigegeben. Die Darstellung bleibt auch mit 5–10 MGs pro Spieler und mehreren Koop-Spielern übersichtlich.

## 9. Autorität, Lebensdauer und Replikation

Die Phaser-unabhängige `MgAttritionRuntime` besitzt Zermürbung, Blutungsabrechnung und Zielübergaben beim Host. Ein World-Binding verbindet sie mit Combat, Konstruktionen und hostseitig aufgelösten Besitzerprofilen. Eine World ohne Activity wird unterstützt. Map-, Activity- und World-Wechsel entfernen die jeweiligen temporären Kampfwerte; diese werden nicht gespeichert.

Ziele werden über vollständige Combat-Instanzen einschließlich Scope und Generation identifiziert. Persönliche Quellen tragen Turmidentität, Besitzer und World-Lifetime. Spritepositionen und wiederverwendbare Gegner-IDs allein sind keine Identität.

Die vollständige Turm-Ziel-Matrix bleibt beim Host. Clients erhalten über die bestehenden `NetworkBridge`-Wege eine kompakte Projektion aus Zielinstanz, aktiver Zermürbungs-/Blutungsdauer und sequenzierten Übergabeereignissen. Leere Zustände werden ausdrücklich übertragen, wiederholte Snapshots heilen Paketverlust. Ein initialer Snapshot spielt alte Übergabeimpulse nicht nach.

## 10. Prüfung und offene Abnahme

Regeltests schützen Aufbau, Maximum, Erneuerung, exakte Ablaufgrenze, gemischte Gruppen, Beitragswechsel, Bruchteilschaden und geordnete Ketten. Integrationstests prüfen bestätigte Treffer, tödlichen Zuwachs, Schutz, Basenkonturen, Hindernisse, Besitzerherkunft und Cleanup. Netzwerk- und GPU-Tests prüfen Bootstrap, explizites Leeren, Ereignisdeduplizierung, Zielgenerationen und Quellenfreigabe.

Die bestehenden Test-Harnesses enthalten Batterieszenarien mit 1/5/10 MGs und mehreren Spielern sowie Horde- und Kettenfälle. Aufbauzeit, Direktschaden und Blutung werden gemessen. Diese deterministischen Szenarien ersetzen keinen Spieltest mit realen Flugzeiten, Zielwechseln und Hindernissen.

Die abschließende technische Prüfung umfasst `npm run check` sowie passende Integrations- und Stress-Suites. Eine Browserprüfung erfolgt ausschließlich auf ausdrücklichen Auftrag. Die visuelle Abnahme und die Bewertung des Spielgefühls bleiben bis dahin offen; das Tuning ist weiterhin in authored Daten anpassbar.
