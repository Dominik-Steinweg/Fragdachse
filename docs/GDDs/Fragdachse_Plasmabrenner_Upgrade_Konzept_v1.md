# Fragdachse – Plasmabrenner: Waffen- und Upgrade-Konzept

**Version:** 1.0 · **Datum:** 23. September 2026  
**Klasse:** Inspektor Gadachs · **Kategorie:** Waffe 2  
**Umfang:** Grundwaffe, zwei aufeinander aufbauende Boss-Upgrades, sieben normale Upgrades mit jeweils drei Stufen  
**Status:** Ausgearbeitetes Designkonzept. Die Mechaniken beruhen auf den Entscheidungen im Gespräch. Die Zahlen sind vorgeschlagene Startwerte für Spieltests, keine bereits validierte Balance und keine implementierten Änderungen.

---

## 1. Leitidee und verbindliche Abgrenzung

> **Was zusammengehört, schweiße ich zusammen. Den Rest auseinander.**

Der Plasmabrenner ist ein unmittelbar reagierendes Ingenieurwerkzeug. Sein kontinuierlicher Hitscan-Strahl nimmt Gegnern Leben und gibt Verbündeten beziehungsweise Konstrukten Leben zurück. Der Spieler entscheidet mit seiner Zielwahl, ob er schneidet oder repariert. Bewegung, Nachführen und schnelle Eingriffe bleiben wichtig; weder ein neuer Feuermodus noch eine zusätzliche Taste werden eingeführt.

Die drei Inspektor-Waffen behalten unterschiedliche Aufgaben:

| Waffe | Zuständigkeit |
|---|---|
| Plasmabrenner | Direkte Lebenspunktwirkung: Schaden, Heilung und Reparatur. |
| Energieinjektor | Zeitlich begrenzte Buffs und Debuffs auf einzelnen Zielen. |
| Verstärkungsmatrix | Verwundbarkeit und Schutz in einer platzierten Fläche, mit längerem Cooldown. |

Dieses Konzept ergänzt beim Plasmabrenner weder allgemeine Verwundbarkeit noch Schadensreduktion, Turm-Übertaktung, Rüstungswiederherstellung, Wiederbelebung oder Wiederaufbau zerstörter Konstrukte. Die bisherigen Plasmabrenner-Upgrades bilden keine Designvorgabe und werden nicht zusätzlich übernommen.

**Entwicklungsfolge:** Die Grundwaffe arbeitet an einem Ziel. Boss 1 belohnt anhaltenden wirksamen Kontakt durch Überladung. Boss 2 erweitert den Strahl zu einer begrenzten Kette. Autonome Plasmaladungen tragen zusätzliche Schadens-/Reparaturwirkung von den Kontaktpunkten aus weiter.

### Begriffsauflösung der letzten Antwort

Die Formulierung „gesunde Gegner“ in Antwort 11 wird im Kontext der Frage als **vollständig gesunde Verbündete und vollständig reparierte Konstrukte** verstanden. Diese erzeugen keine Überladung und keine Plasmaladungen und werden nicht automatisch ausgewählt. **Unverletzte Gegner bleiben selbstverständlich gültige Angriffsziele:** Bereits der erste tatsächlich schädigende Kontakt zählt als wirksamer Kontakt. Diese Festlegung ersetzt die frühere Zwischenentscheidung, auch an gesunden freundlichen Zielen aufladen zu können.

---

## 2. Grundwaffe und Zielregeln

### 2.1 Grundverhalten

Die rechte Maustaste erzeugt einen durchgängigen, präzisen Hitscan-Strahl. Seine Wirkung beginnt sofort. Ohne Boss 2 behandelt er nur das erste getroffene gültige Objekt. Der Spieler kann währenddessen normal laufen und ausweichen. Es gibt keine Anlaufverzögerung, keine Bewegungssperre und keine Überhitzungsstrafe.

Der direkte Strahl bleibt durch die Waffenreichweite und blockierende Geometrie begrenzt. Ohne Target-Lock bleibt die bestehende cursorbegrenzte direkte Bedienung erhalten. Der sichtbare Strahl und die tatsächliche Trefferposition müssen übereinstimmen.

### 2.2 Vorgeschlagene Grundwerte

| Parameter | Startwert des Konzepts | Einordnung |
|---|---:|---|
| Direkte Reichweite | **300 px** | Deutlich kürzer als der geprüfte bisherige Wert von 600 px. |
| Wirkungsintervall | **100 ms** | Zehn Wirkungsimpulse pro Sekunde; Darstellung bleibt kontinuierlich. |
| Schaden je Impuls | **5 LP** | 50 Schaden/s bei durchgehend wirksamen Treffern. |
| Heilung/Reparatur je Impuls | **10 LP** | 100 LP/s vor Begrenzung durch fehlende Lebenspunkte. |
| Adrenalinkosten je Impuls | **2** | 20 Adrenalin/s während des tatsächlichen Feuerns, auch bei Fehlschüssen. |
| Direkter Adrenalingewinn | **0** | Keine waffeneigene Rückgewinnung. |
| Überladung ohne Boss 1 | **Keine** | Die Grundwaffe ist ohne Boss voll funktionsfähig. |
| Zusätzliche Kettensprünge ohne Boss 2 | **0** | Kein automatischer Zweitkontakt. |
| Autonome Plasmaladungen ohne normales Upgrade | **Keine** | Werden separat freigeschaltet. |

Intervall, Schaden, Heilung und Kosten übernehmen für den ersten Test die geprüfte Ausgangskonfiguration; nur die Basisreichweite wird hier direkt abgesenkt. Die Zahlen sind Rohwerte ohne externe Modifikatoren, Resistenzen, weitere Schadensboni oder Heilungsbegrenzungen. Quelle der bisherigen Konfiguration: [S1].

### 2.3 Direkte und automatische Zielwahl

| Ziel | Direkt anvisierbar | Automatische Auswahl durch Kette/Projektile | Beitrag zu Überladung und Projektilerzeugung |
|---|---|---|---|
| Lebender, tatsächlich schädigbarer Gegner | Ja | Ja, auch bei voller Gesundheit | Ja, wenn der Strahl Schaden verursacht. |
| Schädigbare feindliche Struktur | Ja | Ja | Ja, wenn der Strahl Schaden verursacht. |
| Verletzter verbündeter Spieler | Ja | Ja | Ja, wenn der Strahl Leben wiederherstellt. |
| Beschädigtes, grundsätzlich reparierbares freundliches Konstrukt | Ja | Ja | Ja, wenn der Strahl Leben wiederherstellt. |
| Vollständig gesunder Verbündeter / vollständig repariertes Konstrukt | Bewusst direkt erreichbar, aber ohne Heilwirkung | Nein | Nein. |
| Verletzter Inspektor selbst | Nicht als direktes Primärziel | Ja, durch Kette und autonome Projektile | Ein wirksamer Kettenkontakt zählt; Projektilheilung zählt nicht als neuer Strahlkontakt. |
| Zerstörbare Umgebung, z. B. Felsen | Direkte Beschädigung möglich | Nein | Nein, unabhängig vom verursachten Umgebungsschaden. |
| Tote Spieler, zerstörte Konstrukte, Gegnerreste | Keine neue Sonderinteraktion | Nein | Nein. |

Die Waffe eröffnet keine bisher grundsätzlich unzulässige Reparatur an Missionsobjekten oder unzerstörbaren Strukturen. Vorhandene Zielberechtigungen und Fraktionsregeln gelten weiter.

**Wirksamer Kontakt** bedeutet einen tatsächlich positiven Schadens- oder Heilungs-/Reparaturbetrag. Reiner Overheal, Immunität und Nullwirkung zählen nicht. Ein fast repariertes Ziel, das beim aktuellen Impuls noch einen positiven Heilbetrag erhält, zählt für diesen letzten wirksamen Impuls; anschließend nicht mehr.

### 2.4 Bewusstes Anvisieren gesunder freundlicher Ziele

Ein vollständig gesundes freundliches Ziel darf bewusst direkt angestrahlt werden. Es erzeugt weder Überladung noch Plasmaladungen. Target-Lock hält es nach vollständiger Heilung nicht künstlich fest.

**Ergänzende Auslegung für die Kette:** Solange das gesunde Ziel weiterhin tatsächlich direkt getroffen wird, darf es als manuell gewählter Ausgangspunkt einer Kette dienen. Nur tatsächlich wirksame Nebenstrahlen tragen dann zur Aufladung und Projektilerzeugung bei. Die Kette sucht gesunde freundliche Ziele aber niemals selbst als Zwischenglied aus.

### 2.5 Umgebung

Felsen und vergleichbare zerstörbare Umgebungsobjekte können direkt beschädigt werden. Bestehende Umgebungs-Schadensregeln bleiben maßgeblich; das Konzept gewährt keine neue Hindernisdurchdringung. Umgebungsobjekte werden nicht als Kettenstart oder automatisches Supportziel verwendet.

Bereits vorhandene Überladung darf die direkte Schneidwirkung erhöhen. Reine Umgebungsarbeit lädt jedoch nicht auf und verhindert den normalen Abbau der Überladung nicht. Dadurch lässt sich der Brenner nicht an einem Felsen für den nächsten Kampf vorladen.

---

## 3. Boss-Upgrade 1 – Überladen

**Fantasie:** Erfolgreicher Einsatz fährt das Werkzeug hoch. Die gewonnene Leistung kann vom Angriff in eine Reparatur und wieder zurück mitgenommen werden.

### 3.1 Wirkung und Aufbau

Überladung ist ein Zustand des Brenners beziehungsweise seines Spielers, nicht des einzelnen Zieles. Zielwechsel setzen sie nicht zurück. Sie verstärkt den direkten Schaden und die Heilungs-/Reparaturleistung gleichermaßen.

Als einfacher Testansatz wird eine Ladung **Q** verwendet:

```text
Ohne Überladung:                  Q = 0
Obergrenze mit Boss 1:             Qmax = 100
Leistungsfaktor:                  M = 1 + Q / 100
Grundaufbau am Primärziel:         100 / 3 Ladungspunkte pro Sekunde
```

Damit gilt bei einem durchgehend wirksamen Primärziel: nach ungefähr einer Sekunde 1,33-fache, nach zwei Sekunden 1,67-fache und nach drei Sekunden doppelte Strahlleistung. Die Wirkung beginnt trotzdem sofort mit der normalen Grundleistung.

Die Ladung steigt durch **wirksame Kontaktzeit**, nicht durch die Höhe des Schadens oder der Heilung. Hohe Wirkung beschleunigt daher nicht automatisch ihren eigenen Aufbau. Ein Kontakt bleibt zeitlich ein Kontakt, unabhängig von der Größe des Lebensbalkens.

### 3.2 Mehrere Kontakte mit Boss 2

Das Primärziel zählt mit Gewicht 1; jeder zusätzliche wirksame Kettenkontakt zählt mit Gewicht 0,5:

```text
W = (1, falls Primärkontakt wirksam, sonst 0)
    + 0,5 × Anzahl wirksamer Sekundärkontakte

Wenn W > 0:
    Aufbau pro Sekunde = (100 / 3) × W
Wenn W = 0:
    Abbau gemäß Abschnitt 3.3
```

| Wirksames Primärziel plus Sekundärziele | Aufbaugeschwindigkeit | Zeit bis Q = 100 |
|---|---:|---:|
| 1 + 0 | 1,0-fach | 3,0 s |
| 1 + 1 | 1,5-fach | 2,0 s |
| 1 + 2 | 2,0-fach | 1,5 s |
| 1 + 3 | 2,5-fach | 1,2 s |
| 1 + 4 | 3,0-fach | 1,0 s |

Ein nicht wirksames Primärziel zählt nicht mit. Bei einem bewusst direkt angestrahlten gesunden Turm und nur einem wirksamen Nebenstrahl beträgt der Aufbau somit 0,5-faches Grundtempo.

### 3.3 Abbau

Sobald kein wirksamer Haupt- oder Kettenkontakt mehr besteht, beginnt der Abbau **sofort und ohne Schonfrist**. Grundwert: **25 Ladungspunkte pro Sekunde**.

Fehlschüsse, Loslassen, Adrenalinmangel und der Einsatz einer anderen Waffe lassen die Ladung gleichermaßen sinken. Die regulären 100-ms-Abstände zwischen bezahlten Strahlimpulsen sind dagegen keine Fehlschussphasen: Ein kontinuierlich aufrechterhaltener Treffer gilt als laufender Kontakt.

| Situation bei Q = 100 | Grundabbau ohne normales Upgrade |
|---|---:|
| 0,2 s ohne wirksamen Kontakt | Q fällt auf 95. |
| 1 s ohne wirksamen Kontakt | Q fällt auf 75. |
| 4 s ohne wirksamen Kontakt | Q fällt auf 0. |

Ladung wird bei Tod und Ende der Arena zurückgesetzt; keine Übernahme in Lobby oder nächste Runde. Kurzes Ausweichen oder Waffenwechsel innerhalb der Arena bewahrt lediglich die noch nicht abgebaute Restladung.

### 3.4 Was Überladen ausdrücklich nicht tut

Es erhöht weder den Adrenalinverbrauch noch die mögliche Feuerdauer und gibt kein Adrenalin zurück. Die Wirkungsimpulse bleiben bei 100 ms; Schaden und Reparatur pro Impuls steigen. Es gibt kein Überhitzen und keine Zwangspause bei voller Ladung.

Autonome Plasmaladungen entstehen mit höherer Ladung häufiger, verursachen aber nicht zusätzlich mehr Schaden oder Heilung pro Projektil. Sie selbst bauen keine Überladung auf und halten sie auch nicht aufrecht.

---

## 4. Boss-Upgrade 2 – Kettenstrahl

**Fantasie:** Der Brenner verbindet mehrere Arbeitsstellen, ohne zu einer unbegrenzten Flächenwaffe zu werden.

Boss 2 wird in der vorgesehenen Progression **nach Boss 1** freigeschaltet. Beide Boss-Effekte bleiben gleichzeitig aktiv.

### 4.1 Form und Startwerte

```text
Inspektor → Primärziel → Sekundärziel 1 → Sekundärziel 2 → …
```

Es entsteht eine **lineare Kette**, kein Verzweigungsbaum. Das Boss-Upgrade erlaubt zunächst einen zusätzlichen Sprung: insgesamt höchstens zwei behandelte Ziele.

| Parameter | Startwert |
|---|---:|
| Zusätzliche Sprünge durch Boss 2 | 1 |
| Kopplungsradius pro Sprung | 90 px |
| Direkte Wirkung an jedem Sekundärziel | 70 % der aktuellen Hauptstrahlwirkung |
| Maximaler Ausbau mit drei Kaskadenstufen | 4 Sprünge / 5 Ziele insgesamt |

Die 70 % gelten für **jedes** Sekundärziel. Es gibt keine weitere Abschwächung von Glied zu Glied. Autonome Plasmaladungen, die an einem Sekundärziel entstehen, übernehmen ebenfalls den Faktor 0,70.

### 4.2 Zielauswahl und Stabilität

Jedes Kettenglied verbindet sich mit dem nächsten geeigneten, noch nicht verwendeten Ziel innerhalb seines Kopplungsradius. Gegner, verletzte Verbündete und beschädigte Konstrukte werden nach Nähe behandelt, ohne allgemeine Freund-/Feind-Priorität. Der verletzte Inspektor kann ein Sekundärziel sein.

Ein bestehendes Kettenglied bleibt gebunden, solange es gültig, erreichbar und innerhalb des Radius ist. Ein näher vorbeilaufendes Ziel verdrängt es nicht. Stirbt ein Ziel, wird vollständig geheilt oder verliert die Erreichbarkeit, wird nur der davon betroffene Kettenabschnitt neu aufgebaut. Ein ungültiges Zwischenglied kann keine nachfolgenden Verbindungen unsichtbar weitertragen.

Jede Verbindung benötigt eine freie, nach den normalen Waffenregeln zulässige Schusslinie. Keine Verbindung durch Felsen oder andere blockierende Hindernisse. Der Radius bezieht sich auf den räumlichen Abstand zwischen den jeweiligen Zielpositionen; große Strukturen benötigen dabei eine konsistente Zielgeometrie im späteren Implementierungsplan.

### 4.3 Keine Doppelbehandlung

Pro Strahlimpuls und Inspektor wird jedes Ziel höchstens einmal direkt oder durch die Kette behandelt. Es gibt keine Rücksprünge zum Primärziel, Schleifen oder mehrfachen Treffer über unterschiedliche Verbindungen.

Diese Begrenzung betrifft die Strahlkette. Ein separat erzeugtes, später eintreffendes Projektil darf dasselbe Ziel zusätzlich treffen. Mehrere Projektile werden nicht zu einem einzigen Treffer zusammengefasst.

Verliert der Hauptstrahl seinen Kontakt oder endet das Feuern, endet die gesamte Kette. Sie setzt ihre Arbeit nicht eigenständig fort. Bereits erzeugte Projektile dürfen dagegen ihren Flug beenden.

Die direkte Reichweite begrenzt das Primärziel; weitere Kettenglieder dürfen darüber hinausreichen. Mit 480 px direkter Reichweite und vier Sprüngen à 150 px beträgt die theoretische maximale Pfadlänge 1.080 px. Das ist keine freie Fernzielsuche: Dafür müssen sämtliche Zwischenglieder vorhanden und alle Einzelverbindungen gültig sein.

---

## 5. Die sieben normalen Upgrades

Alle sieben normalen Upgrades erhalten **drei Stufen**. Tabellenwerte sind absolute Endwerte der jeweiligen Stufe, keine zusätzlich zu addierenden Prozentangaben. Boss-abhängige Upgrades werden erst nach dem zugehörigen Boss angeboten.

| Nr. | Name / Arbeitsbezeichnung | Ohne normales Upgrade | Stufe 1 | Stufe 2 | Stufe 3 | Voraussetzung |
|---|---|---|---|---|---|---|
| 1 | **Verlängerte Brennlanze** | 300 px direkte Reichweite | 360 px | 420 px | 480 px | Plasmabrenner |
| 2 | **Hochleistungskondensator** | Qmax 100 / Faktor 2,0 | Qmax 120 / Faktor 2,2 | Qmax 140 / Faktor 2,4 | Qmax 160 / Faktor 2,6 | Boss 1 |
| 3 | **Ladungserhalt** | Abbau 25 Punkte/s | 20 Punkte/s | 16 Punkte/s | 12,5 Punkte/s | Boss 1 |
| 4 | **Kaskade** | 1 Kettensprung durch Boss 2 | 2 Sprünge / 3 Ziele | 3 Sprünge / 4 Ziele | 4 Sprünge / 5 Ziele | Boss 2 |
| 5 | **Erweiterte Kopplung** | 90 px Kopplungsradius | 110 px | 130 px | 150 px | Boss 2 |
| 6 | **Autonome Plasmaladungen** | Keine Projektile | Grundintervall 1,20 s | Grundintervall 0,90 s | Grundintervall 0,60 s | Plasmabrenner |
| 7 | **Target-Lock** | Keine automatische Zielbindung | 6° maximale Abweichung | 10° | 14° | Plasmabrenner |

### Hochleistungskondensator

Das Upgrade erhöht nur die Obergrenze. Der Aufbau bis zu einer bereits vorher erreichbaren Leistung wird **nicht langsamer**. Bei einem einzelnen wirksamen Primärziel werden Q = 100 weiterhin nach drei Sekunden erreicht; Q = 120/140/160 nach 3,6/4,2/4,8 Sekunden.

### Ladungserhalt

Es verringert ausschließlich den Abbau ohne wirksamen Kontakt. Keine zusätzliche Schonfrist, keine Steigerung des Aufbaus, keine Kostenreduktion. Eine Ladung von 100 fällt mit Stufe 3 in acht statt vier Sekunden auf null. Eine Ladung von 160 benötigt mit Stufe 3 12,8 Sekunden für den vollständigen Abbau.

### Kaskade und Erweiterte Kopplung

Kaskade bestimmt die maximale Zahl aufeinanderfolgender Sprünge. Erweiterte Kopplung erleichtert deren räumliches Zustandekommen. Weder Upgrade erhöht die Zahl gleichzeitig aus einem Kettenglied ausgehender Strahlen: Es bleibt bei einem nächsten Ziel.

### Kurze Beschreibungstexte

| Upgrade | Beschreibung für die spätere Oberfläche |
|---|---|
| Verlängerte Brennlanze | Erhöht die Reichweite des Hauptstrahls. |
| Hochleistungskondensator | Erhöht die maximal mögliche Überladung und damit die Spitzenleistung des Brenners. |
| Ladungserhalt | Überladung sinkt ohne wirksamen Zielkontakt langsamer ab. |
| Kaskade | Der Kettenstrahl kann zu weiteren Zielen weiterspringen. Jedes Ziel wird nur einmal pro Impuls getroffen. |
| Erweiterte Kopplung | Erhöht den Radius, in dem jeder Kettensprung ein weiteres Ziel erreichen kann. |
| Autonome Plasmaladungen | Wirksame Strahlkontakte erzeugen zielsuchende Plasmaladungen, die Gegner schädigen oder Verbündete reparieren und heilen. Weitere Stufen verkürzen das Erzeugungsintervall. |
| Target-Lock | Ein erfasstes Ziel bleibt bei begrenzter Zielabweichung im Hauptstrahl. Weitere Stufen erhöhen die Toleranz. |

---

## 6. Autonome Plasmaladungen im Detail

### 6.1 Entstehung und Überladung

Während ein Haupt- oder Nebenstrahl wirksam arbeitet, erzeugt sein Kontaktpunkt in einem festen Intervall ein kleines zielsuchendes Plasmaprojektil. Ein Kontakt ohne tatsächliche Wirkung erzeugt nichts. Das Upgrade benötigt kein Boss-Upgrade, profitiert aber von beiden.

```text
T0 = Grundintervall der Upgrade-Stufe
M  = aktueller Überladungsfaktor, ohne Boss 1 gleich 1
Effektives Intervall = T0 / M
```

| Projektilstufe | Ohne Überladung | Bei Q = 100 / M = 2,0 | Bei Q = 160 / M = 2,6 |
|---|---:|---:|---:|
| 1 | 1,20 s | 0,60 s | ca. 0,462 s |
| 2 | 0,90 s | 0,45 s | ca. 0,346 s |
| 3 | 0,60 s | 0,30 s | ca. 0,231 s |

Jeder gleichzeitig wirksame Kontakt hat seine eigene zeitgesteuerte Erzeugung. Das Upgrade erzeugt nicht bei jedem 100-ms-Treffer ein Projektil und gewährt keinen kostenlosen Sofortausstoß bei jeder Neuerfassung.

Für eine faire Umsetzung wird Fortschritt über **wirksame Kontaktzeit** gesammelt. Ändert sich die Überladung während eines Intervalls, ändert sich die weitere Fortschrittsgeschwindigkeit. Ein Zielwechsel setzt den Erzeugungstakt nicht auf „sofort bereit“. Bei ungenutzten Kontaktplätzen entsteht kein Vorrat; beim Beenden des Feuerns werden Restfortschritte verworfen. Es gibt kein Nachholen von Projektilen aus Pausen.

### 6.2 Projektileigenschaften – Testwerte

| Parameter | Vorschlag |
|---|---:|
| Schaden eines am Primärziel entstandenen Projektils | 12 LP |
| Heilung/Reparatur desselben Projektils | 24 LP |
| Wirkung eines an einem Sekundärziel entstandenen Projektils | 70 %: 8,4 Schaden oder 16,8 Heilung/Reparatur |
| Suchradius für ein geeignetes Ziel | 240 px |
| Fluggeschwindigkeit | 480 px/s |
| Maximale Drehrate | 720°/s |
| Maximale Lebensdauer | 1,5 s ab Entstehung |
| Treffer pro Projektil | Einer, anschließend verbraucht |

Die Zahlen betreffen Rohwirkung vor bestehenden externen Modifikatoren. Der Überladungsfaktor wird **nicht** nochmals auf Schaden oder Heilung eines einzelnen Projektils angewendet. Die geringere Wirkung eines am Nebenstrahl entstandenen Projektils bleibt auch dann erhalten, wenn es später das Ziel wechselt.

### 6.3 Zielsuche

Die Ladung bevorzugt das nächste geeignete **andere** Ziel, unabhängig von Freund oder Feind. Ein Gegnerkontakt kann ein unterstützendes Projektil hervorbringen; bei einer Reparatur kann eine Ladung zu einem Gegner fliegen. Der verletzte Inspektor ist ein gültiger Empfänger.

Vollständig gesunde Verbündete, vollständig reparierte Konstrukte und Umgebungsobjekte werden nicht ausgewählt. Die Projektile erhalten eine eigene erkennbare Form und Flugbewegung; sie sind keine zusätzlichen Kettenblitze und keine dauerhaften Drohnen.

Findet sich kein anderes Ziel, darf die Ladung nach ihrer Auswärtsbewegung zum Ausgangsziel zurückkehren, sofern es noch ein sinnvolles Wirkziel ist. So bleibt das Upgrade auch bei einem einzelnen Gegner oder Reparaturziel nützlich.

### 6.4 Austritt, Hindernisse und Zielverlust

Eine Ladung muss die Kontur ihres Entstehungsobjekts zunächst verlassen. Sie darf nicht unmittelbar im Ausgangskörper kollidieren. Eine mögliche Rückkehr ist erst nach diesem Austritt erlaubt. Die kurze Freigabe für den Ausgangskörper darf keine allgemeine Hindernisdurchdringung erzeugen.

Die Projektile fliegen nicht durch feste Hindernisse und besitzen keine eigene komplexe Wegplanung. Zielsuche bevorzugt nach den normalen Projektilregeln erreichbare Ziele; eine später in den Weg geratene Wand kann die Ladung abfangen.

Stirbt das Ziel, wird vollständig geheilt oder verliert anderweitig seine Eignung, wird innerhalb der **verbleibenden** Lebensdauer neu gesucht. Die Lebensdauer startet dabei nicht erneut. Ohne geeignetes Ziel vergeht die Restlebensdauer normal; die Ladung verpufft spätestens an deren Ende.

Die Zielsuche bleibt nach Auswahl stabil, bis das Ziel ungültig wird. Sie wechselt nicht laufend zum nächstgelegenen vorbeilaufenden Objekt.

### 6.5 Keine Erzeugungsschleifen

Ein Projektiltreffer verursacht ausschließlich Schaden oder Heilung/Reparatur. Er erzeugt **keine** neuen Plasmaladungen, **keine** Kettenstrahlen und **keine** Überladung. Auch ein Rückkehrtreffer am Ausgangsziel ist kein neuer Erzeugungskontakt.

```text
Bezahlter Strahlkontakt → Überladung und gegebenenfalls Projektil
Bezahlter Kettenkontakt → gewichtete Überladung und gegebenenfalls Projektil
Projektiltreffer        → Schaden oder Heilung/Reparatur, danach Ende
```

---

## 7. Target-Lock im Detail

### 7.1 Erfassen und Halten

Ein gültiges Ziel muss zuerst durch den direkten Hauptstrahl tatsächlich getroffen werden. Danach darf der sichtbare Strahl diesem Ziel folgen, solange die Maus-Zielrichtung innerhalb der freigeschalteten Winkeltoleranz bleibt.

Die Werte 6°/10°/14° bezeichnen jeweils die **maximale einseitige Abweichung**, also einen Toleranzbereich von ±6°/±10°/±14°. Es handelt sich nicht um den gesamten Öffnungswinkel. Der Winkel wird zwischen der ursprünglichen Maus-Zielrichtung und der Richtung vom Strahlursprung zum erfassten Ziel gemessen.

Die Zielbindung verändert nicht das Fadenkreuz oder die Mausposition. Sie führt nur den Hauptstrahl nach. Der tatsächliche Strahl endet sichtbar am behandelten Ziel.

### 7.2 Sofortiger Zielwechsel

Ein anderes gültiges Ziel, das mit der unbeeinflussten Maus-Zielrichtung direkt getroffen wird, übernimmt die Bindung sofort. Diese Direktprüfung hat Vorrang vor dem Halten des alten Ziels. Dadurch bleibt der schnelle Wechsel zwischen Gegner und verletztem Verbündeten möglich.

Es gibt keine automatische Suche nach einem noch nie direkt getroffenen Primärziel. Verschwindet das gehaltene Ziel, muss ein neues direkt erfasst werden; Target-Lock übernimmt nicht eigenständig den nächsten Gegner.

### 7.3 Ende der Bindung

Die Bindung endet beim Überschreiten der Winkeltoleranz, beim Verlassen der direkten Waffenreichweite, bei blockierter Schusslinie, Tod oder Ungültigkeit des Ziels sowie beim Beenden des Feuerns. Ein vollständig geheiltes freundliches Ziel wird freigegeben und nicht weiter automatisch verfolgt.

Die maximale Distanz ist immer die freigeschaltete direkte Brennerreichweite. Target-Lock erzeugt weder zusätzliche Reichweite noch einen Treffer durch Hindernisse. Bei bestehender Bindung wird die Strahllänge bis zum gehaltenen Ziel aufgelöst; sie wird nicht künstlich an einer kürzeren Cursorentfernung abgeschnitten, solange die gültige Zielrichtung und Waffenreichweite eingehalten werden.

### 7.4 Zusammenspiel

Ein tatsächlich wirkender, durch Target-Lock gehaltener Kontakt lädt normal auf und erzeugt normal Projektile. Das Upgrade ändert weder deren Stärke noch deren Intervalle. Es hält nur das Primärziel, keine eigenständige zweite Kette. Der Kettenstrahl profitiert vom stabilen Ausgangspunkt.

---

## 8. Zusammenspiel, Ressourcen und Progression

### 8.1 Synergien ohne zusätzliche Ausnahmen

| Kombination | Ergebnis |
|---|---|
| Target-Lock + Überladen | Weniger unbeabsichtigte Kontaktabbrüche beim Nachführen. |
| Reichweite + Target-Lock | Ein erfasstes Ziel kann innerhalb der vergrößerten regulären Reichweite gehalten werden. |
| Überladen + Kettenstrahl | Zusätzliche wirksame Kontakte beschleunigen den Aufbau; alle Strahlkontakte profitieren von der Ladung. |
| Kaskade + Erweiterte Kopplung | Mehr mögliche Kettenglieder und größere Chance auf eine gültige Verbindung. |
| Überladen + autonome Projektile | Häufigere Projektile, ohne deren Einzelwirkung zusätzlich zu skalieren. |
| Kettenstrahl + autonome Projektile | Jeder wirksame Kontakt kann Ladungen erzeugen; Nebenstrahl-Ursprünge erzeugen schwächere Ladungen. |
| Ladungserhalt + Ziel-/Waffenwechsel | Ein Teil der gewonnenen Leistung kann durch kurze Pausen getragen werden. |
| Selbstheilung + gemischtes Netz | Der verletzte Inspektor kann indirekt versorgt werden, solange ein gültiger Strahleinsatz die Kette beziehungsweise Projektile erzeugt. |

### 8.2 Adrenalin bleibt die Begrenzung

Keines der sieben normalen Upgrades senkt Kosten, erstattet Adrenalin oder erzeugt eine neue Regenerationsquelle. Überladung, Kette und Projektile dürfen den Brenner nicht selbst versorgen. Fehlendes Adrenalin beendet den Strahleinsatz; vorhandene Ladung sinkt dann normal.

Der Brenner kostet als Testbasis weiterhin 20 Adrenalin/s. Für einen **rein illustrativen Testvorrat von 100 Adrenalin ohne jeglichen Zufluss** ergeben sich fünf Sekunden Feuerzeit. Das ist eine Rechenannahme, keine Aussage über jeden tatsächlichen Spielerbuild.

Boss 1 erreicht seine Grundobergrenze nach drei Sekunden beziehungsweise 60 verbrauchten Adrenalinpunkten. Die maximal erhöhte Obergrenze Q = 160 wird an einem einzelnen Ziel nach 4,8 Sekunden beziehungsweise 96 Punkten erreicht. Ohne zusätzliche Versorgung bleibt diese höchste Einzelzielspitze deshalb kurz; eine volle Kette erreicht sie deutlich früher. Das ist ein bewusst zu prüfender Balancepunkt, kein Grund, ein Effizienzupgrade wieder einzuführen.

Allgemeine Regeneration, Essenzen, Primärwaffen und andere externe Ressourcenquellen bleiben separate Spielsysteme. Das Konzept verspricht daher keine feste Feuerdauer für alle Kombinationen. Insbesondere ist die Versorgung durch getötete Gegner in echten Gefechten mitzubeobachten.

### 8.3 Freischaltung

Die drei bossunabhängigen normalen Upgrades sind Reichweite, autonome Plasmaladungen und Target-Lock. Boss 1 öffnet Hochleistungskondensator und Ladungserhalt. Boss 2 öffnet Kaskade und Erweiterte Kopplung.

Die Reihenfolge der Boss-Upgrades ist verbindlich: zuerst Überladen, danach Kettenstrahl. Kosten, Boss-Meilensteine und Einbindung in das allgemeine Auswahl-/Freischaltsystem richten sich nach dessen gemeinsamen Regeln; es wird hier kein neues Fortschrittssystem eingeführt. Die Waffenfreischaltung selbst zählt nicht als eines der sieben normalen Upgrades.

### 8.4 Turmbemannen

Turmbemannen gehört für den Inspektor fest zur Klasse und ist kein von ihm zu kaufendes Upgrade mehr. Diese Klassenänderung zählt nicht zu den sieben normalen Plasmabrenner-Upgrades.

**Der Plasmabrenner ist während des Bemannens nicht einsetzbar.** Der Waffeneinsatz aus dem Turm bleibt zunächst die Besonderheit des vorgesehenen Energieinjektor-Boss-Konzepts. Beim Einstieg enden Brennerstrahl, Kette, Target-Lock und weitere Projektilerzeugung. Bereits fliegende Projektile beenden ihren normalen Lebenszyklus; Überladung sinkt während der Bemannung ab.

Eine automatische Rücknahme bestehender Bemannungsrechte anderer Klassen ist damit nicht beschlossen. Die Umstellung der Klassenfreigabe und der Umgang mit bisherigen Upgrade-Daten werden im späteren Implementierungsplan separat berücksichtigt.

---

## 9. Rechenbeispiele für die Startwerte

Die Beispiele beschreiben ideale Rohwirkung: alle Kontakte sind dauerhaft wirksam, keine Resistenzen, keine externen Modifikatoren, keine verfehlenden Projektile, kein Lebenspunkt-Clamping. Tatsächliche Trefferzahlen und Heilwerte im Spiel können deutlich niedriger sein.

| Zustand | Hauptstrahl Schaden/s | Ein Sekundärstrahl Schaden/s | Hauptstrahl Heilung/Reparatur pro Sekunde |
|---|---:|---:|---:|
| Ohne Überladung | 50 | 35, sofern Boss 2 vorhanden | 100 |
| Q = 100 | 100 | 70 | 200 |
| Q = 160 | 130 | 91 | 260 |

Mit einem wirksamen Hauptziel, vier wirksamen Sekundärzielen und Q = 160 beträgt die gesamte Strahl-Rohwirkung über alle Ziele **494 Schaden/s**: `130 + 4 × 91`. Das ist Gruppenwirkung, nicht 494 Strahlschaden auf ein einzelnes Ziel.

Bei Projektilstufe 3 und Q = 160 erzeugt jeder aktive Kontakt rechnerisch etwa **4,33 Projektile/s**. Fünf durchgehend wirksame Kontakte ergeben etwa **21,67 Projektile/s pro Inspektor**. Bei 1,5 Sekunden Lebensdauer liegt die rechnerische Obergrenze gleichzeitig fliegender Projektile eines kontinuierlich feuernden Inspektors in der Größenordnung von 33, bevor vorzeitige Treffer oder Verfall berücksichtigt werden.

Für die Rohwirkung aller Projektile zusammen ergibt sich in diesem Extremfall:

```text
(12 + 4 × 8,4) × (2,6 / 0,60) = 197,6 Schaden/s
Strahl + Projektile über alle Ziele = 494 + 197,6 = 691,6 Schaden/s
```

Mehrere Projektile können auf dasselbe Ziel treffen. Daher kann ein Teil der zusätzlichen Gruppenproduktion auf ein einzelnes Ziel konzentriert werden; die begrenzte Strahlkette verhindert nicht automatisch jede solche Konzentration. Insbesondere günstige Ketten um einen Boss und beschädigte Turmgruppen gehören in die Balanceprüfung.

Diese Werte sind **kein Nachweis für ausgewogene Stärke**. Sie machen die vorgesehene Skalierung und den zu testenden Maximalfall transparent. Bei zu hoher Wirkung werden zunächst Projektil-Grundwirkung, Intervall, Nebenstrahlfaktor oder Überladungsobergrenze angepasst – nicht nachträglich versteckte Rekursionen oder Ressourcenkosten eingeführt.

---

## 10. Darstellung und Rückmeldung

Der grüne Plasma-/Schweißcharakter bleibt erhalten. Überladung verstärkt schrittweise Helligkeit, Strahlkern, Kontaktfunken und Klangintensität, ohne plötzlich in eine gewöhnliche Feuerwaffe umzuschlagen. Eine kleine Anzeige am Fadenkreuz oder Waffenstatus zeigt die aktuelle Ladung und deren Abbau. Nur bei vorhandenem Boss 1 wird diese Anzeige benötigt.

Der Hauptstrahl bleibt visuell dominant. Kettensegmente sind dünner und weniger hell, ihre Endpunkte stabil. Ein erfasstes Target-Lock-Ziel erhält eine zurückhaltende Markierung; kein großes Overlay verdeckt den Lebensbalken. Heilende und schädigende Kontakte müssen trotz derselben Waffenfarbe unterscheidbar bleiben.

Autonome Plasmaladungen sind kompakte, klar erkennbare Flugobjekte mit kurzem Auswärtsbogen und anschließendem Suchflug. Ihre Darstellung unterscheidet sich von Tesla-Blitzen. Die Anzahl von Lichtern und aufwendigen Partikeln muss nicht der Anzahl der Gameplay-Projektile entsprechen.

---

## 11. Abnahmefälle für die spätere Umsetzung

Dies sind prüfbare Designanforderungen, keine bereits ausgeführten Spieltests.

| Prüffall | Erwartetes Verhalten |
|---|---|
| Unverletzten Gegner direkt treffen | Sofort Schaden; Boss 1 lädt auf; Projektilfortschritt läuft. |
| Vollständig gesunden Verbündeten direkt anstrahlen | Keine Heilwirkung, kein eigener Aufladungsbeitrag, keine eigene Projektilerzeugung. |
| Gesundes freundliches Ziel in der Nähe | Keine automatische Auswahl durch Kette oder Projektile. |
| Ziel wird während der Reparatur vollständig gesund | Nach dem letzten wirksamen Impuls keine weitere Erzeugung; automatische Bindungen werden freigegeben. |
| Einzelziel drei Sekunden wirksam bearbeiten | Ohne weitere Überladungs-Upgrades ungefähr Q = 100 / doppelte Wirkung. |
| Ziel wechseln oder kurz ausweichen | Restladung bleibt erhalten und sinkt nur während tatsächlicher Kontaktlücken. |
| Felsen bearbeiten | Direkter Umgebungsschaden möglich; kein Aufladen, keine Projektile, keine Kette aus dem Felsen. |
| Ein Ziel über mehrere Kettenwege erreichbar | Pro Strahlimpuls nur einmal behandelt. |
| Näherer Gegner kreuzt eine bestehende Kette | Gültige bestehende Kettenbindung bleibt stabil. |
| Target-Lock hält einen Gegner, ein anderes Ziel wird direkt anvisiert | Sofortiger Wechsel zum direkt anvisierten gültigen Ziel. |
| Target-Lock-Ziel hinter einem Felsen / außerhalb der Reichweite | Bindung endet; keine unsichtbare Wirkung. |
| Verletzter Inspektor in Reichweite eines Kettenglieds | Kann indirekt geheilt werden, sofern ein gültiger Kettenkontakt entsteht. |
| Projektil entsteht innerhalb einer großen Zielkontur | Zunächst sicherer Austritt; keine sofortige Selbstkollision. |
| Nur das Projektil-Ausgangsziel ist vorhanden | Rückkehr nach Austritt möglich, sofern das Ziel weiter geeignet ist. |
| Projektilziel stirbt oder wird vollständig repariert | Neue Zielsuche innerhalb der unverlängerten Restlebensdauer. |
| Projektil trifft ein Ziel | Genau eine Schadens-/Heilwirkung, keine weitere Erzeugung und keine Überladung. |
| Schnelles Wechseln oder Ein-/Ausschalten | Kein kostenloser Sofortausstoß und kein Nachholen angesammelter Projektile. |
| Adrenalin ist aufgebraucht | Strahl, Kette und neue Erzeugung enden; Überladung sinkt. |
| Inspektor bemannt einen Turm | Brenner kann nicht eingesetzt werden; Restladung sinkt normal. |
| Vollausbau mit mehreren Inspektoren | Korrekte Zielzuordnung, stabile Darstellung und begrenzte Projektillebensdauer; keine rekursiven Effekte. |

Für Multiplayer müssen die verbindlichen Entscheidungen über Treffer, Lebenspunkte, Ladung, Kettenmitglieder, Ressourcen und Projektilerzeugung von der autoritativen Spielsimulation stammen. Lokale Darstellung darf unmittelbar reagieren, aber keine zusätzlichen Wirkungen erzeugen. Die konkreten Komponenten, Netzwerkfelder und Tests werden im Implementierungsplan festgelegt; dieses Dokument schreibt keinen Refactor vor.

Das Produktionsverhalten muss bei unterschiedlichen Bildraten gleich bleiben. Zeitbasierte Aufladung und Projektilintervalle werden nicht an gerenderte Frames gekoppelt. Die Beurteilung von Kontakten benötigt echte Ergebniswerte statt bloßer Berührungsereignisse.

---

## 12. Bewusst offene Balancepunkte

Die **Mechaniken sind festgelegt**; weitere Grundsatzfragen sind für dieses Konzept nicht erforderlich. Die folgenden Punkte werden durch Spielen entschieden, nicht durch zusätzliche Funktionsvarianten:

- Passen 300 px Basisreichweite und die Stufen bis 480 px zum gewünschten Risiko und Bewegungstempo?
- Sind 50 Schaden/s und 100 Heilung/Reparatur pro Sekunde als unverstärkte Ausgangswerte passend, insbesondere bei kleinen Lebensbalken?
- Ist die Spitze Q = 160 sinnvoll erreichbar, ohne durch externe Versorgung zum dauerhaften Normalzustand zu werden?
- Sind maximal fünf Strahlkontakte und die zusätzliche Projektilproduktion in Gegnergruppen beziehungsweise eng gebauten Stellungen angemessen?
- Sind 6°/10°/14° Zielbindung hilfreich, ohne bewusstes Zielen und Wechseln zu verdrängen?

Freischaltpreise und exakte Einordnung in allgemeine Progressionskosten bleiben im bestehenden System. Es fehlen keine normalen Upgrade-Plätze: **Die sieben Upgrades aus Abschnitt 5 sind vollständig gesetzt.**

---

## Quellen und Herkunft

Die Designentscheidungen stammen aus dem vorangegangenen Gespräch. Ergänzende Regeln zur eindeutigen Auflösung von Randfällen und alle exakten Zahlen sind im Konzept beschriebene Vorschläge für die erste Umsetzung und anschließende Tests.

**Geprüfter Repository-Stand:** `f2f88a13925b3f97e7e103758f0c2f6a44af52be`, abgerufen am 23. September 2026. Keine Repository-Dateien wurden im Rahmen dieses Konzepts geändert.

**[S1] Bisherige Waffen-Grundkonfiguration:** `src/loadout/content/data/weapons-support.json`. Plasmabrenner: Reichweite 600, Intervall 100 ms, Schaden 5, Heilung 10 und Kosten 2 pro Impuls; keine direkte Adrenalinrückgewinnung.  
https://github.com/Dominik-Steinweg/Fragdachse/blob/f2f88a13925b3f97e7e103758f0c2f6a44af52be/src/loadout/content/data/weapons-support.json

**[S2] Klassenkonfiguration als Kontext:** `src/config/coopDefenseClasses.ts`. Die Inspektor-Konfiguration verweist auf gemeinsame Adrenalinquellen statt einer eigenen Klassen-Ressourcenkurve. Daraus wird hier keine bestimmte effektive Regeneration eines ausgebauten Spielers abgeleitet.  
https://github.com/Dominik-Steinweg/Fragdachse/blob/f2f88a13925b3f97e7e103758f0c2f6a44af52be/src/config/coopDefenseClasses.ts
