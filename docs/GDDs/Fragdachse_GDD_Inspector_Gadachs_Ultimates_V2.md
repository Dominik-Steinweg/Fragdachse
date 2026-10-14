# Fragdachse Inspector Gadachs Ultimates GDD V2

**Version:** 2.0

**Stand:** 14. Oktober 2026

**Klasse:** Inspector Gadachs

**Geltungsbereich:** Gameplay, Progression, Mehrspieler und Darstellung für Coop-Defense

**Status:** In Umsetzung (Gate GU1)

V2 ersetzt [V1](Fragdachse_GDD_Inspector_Gadachs_Ultimates_V1.md) als verbindliche
Umsetzungsgrundlage. Sie übernimmt deren Regeln und ergänzt die User-Entscheidungen vom
2026-10-14 sowie die Design-Defaults des freigegebenen Umsetzungsplans. User-Entscheidungen
bleiben bis zu einer neuen User-Entscheidung bindend; Defaults sind im
[Entscheidungslog](#7-entscheidungslog) markiert und an einem Gate kippbar.
Balancewerte sind ungetestete Startwerte, werden in authored JSON geführt und bleiben tunebar.

Inspector Gadachs erhält mit **Holo-Offensive** und **Bombergeschwader** zwei klasseneigene Ultimates.
Die Holo-Offensive verstärkt sein vorhandenes Turmarsenal durch vorübergehende, eigenständige Kopien.
Das Bombergeschwader liefert kurzfristige Flächenunterstützung unabhängig von gebauten Konstruktionen.
Beide ersetzen seine bisherige Ultimate-Auswahl.

Die Regeln beschreiben das verbindliche Soll-Verhalten. Integration und Abnahme in den Kapiteln 4
und 5 sind Anforderungen an die Umsetzung; dieses GDD behauptet keine bereits erfolgte
Implementierung oder Abnahme.

### Änderungen gegenüber V1

| Thema | Fortschreibung in V2 |
|---|---|
| Holo-Offensive | Nicht erstattbare Standardfreischaltung; eigene Identität, MG-Attrition und Feuerfolge; keine temporären Originalboni oder Konstruktionsfunktionen; Platzierung und HUD präzisiert. |
| Bombergeschwader | Korridorbeginn, Anflug, Abwurfpunkte, U-Wende und Einsatzsperre konkretisiert; Kauf rüstet nicht automatisch aus. |
| Darstellung | Drohnen-Look in zwei Asset-Schritten; Glas-Hologramme mit Sockel und Entstehungsblitz; rote Spieler-Einfärbung nur bei Honigdachs-Wut. |
| Lifecycle und Mehrspieler | Kampfunterbrechung beendet keinen Einsatz; kompakte Holo-Kopien in `fc`, deterministischer Staffelplan in `bq`, Late Join und Effektbündelung festgelegt. |
| Content und Abnahme | Feste IDs und Klassen-/Modusbindung, Entscheidungslog sowie Zuordnung Abnahme → Test ergänzt. |

## 1. Zielbild und Umfang

### 1.1 Rollen und Verfügbarkeit

| Ultimate | Spielgefühl | Stärke |
|---|---|---|
| **Holo-Offensive** | Während Gadachs kämpft oder sich bewegt, entstehen um ihn vorübergehende Turmkopien. | Anhaltende Feuerunterstützung und Gebietskontrolle; verstärkt das vorhandene Turmarsenal. |
| **Bombergeschwader** | Eine Staffel fliegt leicht zeitversetzt aus derselben Richtung ein und legt breite Bombenteppiche. | Schnelle Entlastung gegen Gegnergruppen; funktioniert unabhängig von gebauten Konstruktionen. |

Die Holo-Offensive ist kostenlos freigeschaltet und standardmäßig ausgerüstet. Ihre Freischaltung
ist **nicht erstattbar**. Das Bombergeschwader kostet **einen normalen Upgradepunkt**; sein Kauf
rüstet es **nicht automatisch aus**. Beide verwenden den vorhandenen Ultimate-Slot und sind nur
für Coop-Defense verfügbar.

Die erste Integration umfasst die vollständigen Basisfähigkeiten und **alle hier beschriebenen
Upgrades**, einschließlich des zweiten Bomberüberflugs. Die bisherigen Ultimates und ihre
Upgradezweige entfallen ausschließlich für Gadachs. Andere Klassen behalten ihre Auswahl.

Alle folgenden Zahlen sind konkrete **Startwerte für Implementierung und Spieltests**, keine bereits
bestätigten Balanceergebnisse. Schadenswerte gelten vor allgemeinen Modifikatoren und den jeweiligen
Empfängerregeln.

### 1.2 Bestätigte Entscheidungen und ergänzende Designwerte

**Vom Nutzer festgelegt:**

- Gadachs erhält ausschließlich die beiden neuen Ultimates als Ersatz für seine bisherige Auswahl.
- Die Turm-Ultimate erzeugt zeitversetzt Kopien vorhandener eigener Türme; die Originale kämpfen weiter.
- Ein Original kann mehrere eigenständige Kopien liefern. Bestehende Kopien leben ihre Dauer aus,
  selbst wenn das Original zerstört wird; weitere Kopien benötigen ein noch vorhandenes Original.
- Nur die Holo-Offensive skaliert mit der angesparten Rage. Die Bomber haben einen festen Preis und
  eine feste, durch Upgrades veränderbare Staffelgröße.
- Jede Bomberdrohne richtet ihren Anflug auf Gadachs' dann aktuelle Position aus. Die Drohnen kommen
  leicht zeitversetzt aus derselben Richtung.
- Alle genannten Upgradearten einschließlich Feuerbrocken und zweitem Bomberüberflug gehören zur
  ersten Integration.
- Reduzierte Minimalrage ermöglicht einen früheren Start, verlängert aber nicht die Laufzeit bei
  derselben eingesetzten Rage.
- Für den Kopienbonus soll die vorhandene Injektor-Logik verwendet werden.
- Die Holo-Offensive ist die kostenlose Standard-Ultimate; die Bomberfreischaltung kostet einen
  normalen Upgradepunkt.

**Ergänzende Designfestlegungen dieses GDD:** Die Namen, konkreten Zahlen, Upgrade-Stufenzahlen und
Abhängigkeiten, Auswahl- und Platzierungsdetails, Lifecycle-Regeln und Integrationsgrenzen
konkretisieren diese Entscheidungen. Sie gelten als verbindliche Startwerte für die Umsetzung und
wurden nicht einzeln als Nutzerentscheidungen festgelegt. Die zusätzlichen User-Entscheidungen
vom 2026-10-14 und die an Gates änderbaren Plan-Defaults sind in Kapitel 7 getrennt ausgewiesen.
Die aktuellen Injektorwerte und das Feuerbrockenprofil stammen aus den in Kapitel 9 verlinkten
bestehenden Systemen.

## 2. Ultimate 1 Holo-Offensive

### 2.1 Aktivierung und Rage

Ein Druck auf die Ultimate-Taste startet die automatische Kopienerzeugung. Gadachs kann sich
währenddessen normal bewegen, schießen und Utilities benutzen.

| Eigenschaft | Basiswert |
|---|---:|
| Minimale Rage zur Aktivierung | **300** |
| Eingesetzte Rage | Gesamte Rage bei Aktivierung |
| Erzeugungsdauer | **Eingesetzte Rage ÷ 50 pro Sekunde** |
| Abstand zwischen Kopien | **0,75 s** |
| Erste Kopie | Sofort bei erfolgreicher Aktivierung |
| Lebensdauer jeder Kopie | **6 s ab Entstehung** |
| Materialisierung | Erste **0,4 s** der Lebensdauer |
| Zusätzlicher zeitlicher Cooldown | Keiner |

Damit entstehen bei **300 Rage acht Kopien über sechs Sekunden**, bei **600 Rage sechzehn Kopien
über zwölf Sekunden**. Höchstens acht Basiskopien bestehen gleichzeitig. Am exakten Ende des
Erzeugungsfensters entsteht keine zusätzliche Kopie. Diese Mengen setzen gültige Vorlagen und
Spawnplätze an allen Spawnterminen voraus.

Die eingesetzte Rage wird beim Start verbraucht. Währenddessen neu gewonnene Rage verlängert den
laufenden Einsatz nicht. Ein erneuter Ultimate-Einsatz ist erst nach Ablauf aller Kopien möglich.

**Erzeugungsdauer und Kopienlebensdauer sind getrennt:** Endet die Erzeugung, leben bereits
entstandene Kopien ihre verbleibende Zeit aus.

### 2.2 Vorlagen und Verhalten

Als Vorlagen dienen **vorhandene, intakte, eigene Türme in derselben World**. Ihre Entfernung zu
Gadachs ist unerheblich.

Unterstützt werden die bereits für Turmkopien vorgesehenen Typen: **MG, Raketen, Sporen, Flammen,
Gravitation und Verlangsamung**. Tesla-Türme, Drohnenstationen, fremde Türme, basisverwaltete Türme
und Kopien selbst gehören nicht zum Vorlagenpool.

- Verschiedene Turmtypen kommen zyklisch zum Zug, entsprechend ihrer Reihenfolge im Utility-Rad.
  Noch gebaute, inzwischen abgewählte Typen folgen anschließend.
- Innerhalb eines Typs werden die geeigneten Originale reihum verwendet; die anfängliche Reihenfolge
  folgt Entfernung zu Gadachs und anschließend Konstruktions-ID.
- Nach Durchlaufen des Pools beginnt die Auswahl erneut. **Dasselbe Original darf mehrere
  gleichzeitig bestehende Kopien erzeugen.**
- Vor jedem Spawn wird die Verfügbarkeit aktualisiert. Neu gebaute Originale können hinzukommen;
  zerstörte fallen heraus.
- Bemannte oder durch die Kopien-Utility pausierte Originale bleiben gültige Vorlagen. Die Ultimate
  verändert deren Betriebszustand nicht.

Eine Kopie übernimmt Waffe, dauerhafte Turm-Upgrades, Reichweite und reguläres Zielverhalten ihres
Originals zum Spawnzeitpunkt. Eingefroren werden dabei **nur dauerhafte Turm-Upgrades**; temporäre
Boni des Originals wie **Injektor oder Fernsteuerung werden nicht übernommen**. Jede Kopie besitzt
eine **eigene Identität, einen eigenen MG-Attrition-Stack und eine eigene Feuerfolge** und beginnt
nach der Materialisierung kampfbereit. Laufende Salven des Originals werden nicht übernommen.

Das Zielverhalten entspricht dem der Spielertürme, einschließlich **feindlicher Basen als dritter
Zielstufe** und der bestehenden waffenspezifischen Eignungsregeln.

Die Kopien sind unverwundbar, nicht blockierend und nicht bemannbar. Sie benötigen keine
Baukapazität und können weder repariert noch abgebaut oder gespeichert werden. Ihr Schaden zählt
zum Besitzer. **Kopien zählen nie als Konstruktion:** Sie sind weder bemannbar noch fernsteuerbar
und nehmen nicht an der Injektor-Suche über die Position teil. Die eigene Injektorprojektion
aus §2.4 bleibt davon unberührt.

**Die Zerstörung des Originals beendet bestehende Ultimate-Kopien nicht.** Weitere Kopien benötigen
jedoch weiterhin eine gültige Vorlage.

### 2.3 Platzierung und Bewegung

Jede Kopie entsteht um die **aktuelle Position** von Gadachs und bleibt anschließend dort stehen.

Der bevorzugte Spawnring besitzt **120 px Radius**. Seine zwölf Winkelpositionen werden reihum
verwendet. Ist der vorgesehene Platz ungültig, werden die übrigen Ringplätze und anschließend Ringe
mit **80 und 160 px** geprüft. Kopien benötigen **begehbaren Boden**, **16 px Freiraum** nach der
bestehenden Freiraumprüfung (`isPointFree`) und mindestens **32 px Abstand zu allen temporären
Kopien**, einschließlich der Relais-Kopien der Turmkopien-Utility.

Dadurch entstehen beim Stehen lokale Verteidigungsstellungen und beim Laufen eine vorübergehende
Verteidigungsspur.

Fehlen beim Aktivieren geeignete Originale oder ein erster Spawnplatz, erfolgt **kein Rageverbrauch**.
Später ungültige Spawntermine werden übersprungen, ohne Nachholsalve oder Verlängerung. Bereits
entstandene Kopien bleiben bestehen.

### 2.4 Upgradebaum

Jede normale Stufe kostet einen Upgradepunkt. Für einen Folgeknoten genügt **Stufe 1** seines
Vorgängers. Beide Zweige beginnen an der kostenlosen Freischaltung der Holo-Offensive.

| Zweig / Knoten | Stufen | Wirkung |
|---|---:|---|
| Links 1: **Stabile Projektion** | 3 | Kopienlebensdauer **7 / 8 / 9 s** |
| Links 2: **Schnellprojektion** | 3 | Spawnintervall **0,70 / 0,65 / 0,60 s** |
| Rechts 1: **Frühstart** | 3 | Minimale Rage **250 / 200 / 150** |
| Rechts 2: **Injektorprojektion** | 1 | Jede Kopie besitzt während ihrer Lebensdauer den passenden Injektor-Bonuseffekt. |

**Frühstart verändert ausschließlich die Aktivierungsschwelle.** Der Umrechnungswert bleibt
50 Rage pro Erzeugungssekunde. Bei 150 Rage dauert die Erzeugung daher drei Sekunden; 600 Rage
ergeben weiterhin zwölf Sekunden.

**Injektorprojektion verwendet die vorhandenen Effektdefinitionen:**

- Schadenstürme: derzeit **+25 % Schaden**.
- Gravitationstürme: derzeit **+50 % Zugkraft**.
- Verlangsamungstürme: derzeit **+50 % Verlangsamungsstärke**, mit derselben Umrechnung und
  Begrenzung wie beim Injektor; keine zusätzlichen 50 Prozentpunkte.

Der Bonus erfordert keine ausgerüstete Injektorwaffe. Temporäre Injektoreffekte des Originals werden
nicht zusätzlich kopiert. Derselbe Injektor-Effekttyp wird auf der Kopie höchstens einmal angewendet.

Die Holo-Offensive erhält auch in V2 keinen zusätzlichen Bossknoten. Voll ausgebaut entstehen bei
600 Rage **20 Kopien**, davon höchstens **15 gleichzeitig**, sofern alle Spawntermine möglich sind.

## 3. Ultimate 2 Bombergeschwader

### 3.1 Aktivierung und Staffel

Ein Druck auf die Ultimate-Taste ruft die Staffel. Die Zielrichtung beim Aktivieren bestimmt ihre
gemeinsame Flugrichtung und bleibt für den gesamten Einsatz fest.

| Eigenschaft | Basiswert |
|---|---:|
| Ragekosten und Mindest-Rage | **300** |
| Drohnen | **8** |
| Abstand zwischen Anflugstarts | **0,25 s** |
| Anflug bis zum Abwurfkorridor | **0,6 s** |
| Geschwindigkeit im Bombenlauf | **400 px/s** |
| Bomben je Drohne | **6** |
| Überflüge je Drohne | **1** |
| Bordgeschütz | Keines |

Überschüssige Rage bleibt erhalten. Mehr angesparte Rage verändert weder Staffelgröße noch
Bombenanzahl. Drohnenstationen und deren Upgrades sind keine Voraussetzung.

Die Bomber sind unverwundbar, fliegen über Hindernisse hinweg und belegen keine Baukapazität. Nach
ihrem Einsatz fliegen sie weiter und verschwinden. Sie werden nicht zu dauerhaften Begleitern.

Ein weiterer Ultimate-Einsatz bleibt **bis zum letzten Bombeneinschlag** gesperrt. Bereits
entstandenes Bodenfeuer verlängert diese Sperre nicht. Das HUD zeigt während der Sperre **„Aktiv“**.

### 3.2 Bombenteppiche und Spielerbewegung

**Jede Drohne erfasst Gadachs' Position zu Beginn ihres eigenen Anflugs.** Daraus legt sie einen
festen Korridor fest. Er beginnt **48 px vor Gadachs** (`corridorLeadPx`) und erstreckt sich
**640 px in die beim Aktivieren festgelegte Richtung**, mit dem jeweiligen seitlichen Bahnoffset.
Nachfolgende Spielerbewegungen verändern diesen begonnenen Anflug nicht mehr.

Der Anflug beginnt **240 px vor dem Korridorbeginn** entlang der Bahn und dauert **0,6 s**.
Während dieses Anflugs wird die Drohne eingeblendet.

Bei stillstehendem Gadachs entstehen parallele Bahnen über einer gemeinsamen Fläche:

- Korridorlänge: **640 px**.
- Seitliche Verteilung der Bahnen: gleichmäßig über **560 px Gesamtbreite**.
- Anflugreihenfolge: mittlere Bahn(en) zuerst, anschließend abwechselnd nach links und rechts außen.
- Bomben werden gleichmäßig entlang der jeweiligen Bahn abgeworfen: bei **(i + 0,5) / n** der
  Bahnlänge, mit **i = 0 bis n − 1** und **n = Bombenzahl je Drohne und Überflug**. Die Punkte
  liegen jeweils in der Mitte eines gleich langen Bahnabschnitts.

Bewegt sich Gadachs, verschieben sich die später geplanten Bahnen mit seiner Position. So kann er
den Angriff mit seiner Bewegung über das Kampfgebiet führen, während die Staffel ihre gemeinsame
Richtung behält.

Zusätzliche Drohnen verdichten die Bahnen innerhalb derselben Breite. Zusätzliche Bomben verdichten
die Einschläge innerhalb derselben Länge.

Die Staffel führt ihre Abwürfe auch ohne vorhandene Gegner aus. Sie sucht keine Einzelziele und
verfolgt keine fliehenden Gegner. Einschlagpunkte außerhalb der World entfallen, statt am Kartenrand
auf einen Punkt zusammengedrückt zu werden.

### 3.3 Bombenwirkung

| Eigenschaft | Basiswert |
|---|---:|
| Explosionsradius | **72 px** |
| Schaden im Zentrum / am Rand | **24 / 8**, linearer Abfall |
| Fallzeit | **0,25 s** |
| Zusätzlicher Aufprallschaden | **0** |
| Knockback | **0** |
| Feuerbrocken ohne Upgrade | **0** |

Bomben treffen Gegner und feindliche Basen. Sie beschädigen weder Gadachs noch Verbündete,
freundliche Konstruktionen, Felsen oder den Zug.

Die Basisstaffel wirft **48 Bomben** ab. Ihr letzter Einschlag erfolgt bei vollständigem Ablauf
innerhalb von ungefähr **4,2 Sekunden nach Aktivierung**. Die Summe aller Bombenschäden ist kein
Einzelschadenswert: Die Einschläge verteilen sich über eine große Fläche.

### 3.4 Upgradebaum

Die Freischaltung kostet einen normalen Punkt. Jede weitere normale Stufe kostet ebenfalls einen
Punkt; Voraussetzung ist jeweils Stufe 1 des Vorgängers. Großgeschwader und Erweiterter
Bombenschacht setzen direkt an der Bomberfreischaltung an, Brandladung folgt auf den Bombenschacht.

| Zweig / Knoten | Stufen | Wirkung |
|---|---:|---|
| Links: **Großgeschwader** | 3 | **10 / 12 / 14 Drohnen** |
| Rechts 1: **Erweiterter Bombenschacht** | 3 | **7 / 8 / 9 Bomben je Drohne und Überflug** |
| Rechts 2: **Brandladung** | 3 | **1 / 2 / 3 Feuerbrocken je Bombe** |
| Boss: **Zweiter Anflug** | 1 | Jede Drohne bombardiert ihre Bahn ein zweites Mal. |

Der Bossknoten kostet **einen Boss-Punkt** und benötigt mindestens Stufe 1 in **Großgeschwader** und
**Brandladung**.

### 3.5 Brandladung

Brandladung übernimmt das bestehende Feuerbrockenprofil der Angriffsdrohnen: lokale
Landungsexplosion, anschließend Bodenfeuer, dieselben Regeln für gültige Landepunkte und
Brandstapel.

| Eigenschaft | Ausgangswert des bestehenden Profils |
|---|---:|
| Streuradius um die Bombenexplosion | **60 px** |
| Radius der Landungsexplosion | **24 px** |
| Landungsschaden im Zentrum / am Rand | **1,5 / 0,5** |
| Dauer des Bodenfeuers | **2 s** |
| Brandstatusdauer je neuem Brandtreffer | **1 s** |
| Brandschaden je Stapel und 250-ms-Tick | **0,2** |

Brocken erzeugen keine weiteren Brocken. Stations- und Raketenwerfer-Upgrades verändern diese
Ultimate nicht.

### 3.6 Bossupgrade Zweiter Anflug

Nach dem ersten Überflug wendet jede Drohne sichtbar in einem **U-Bogen von 1 s hinter dem
Korridorende** und bombardiert **dieselbe Bahn in Gegenrichtung**. Sie erhält dafür erneut ihre
vollständige Bombenanzahl. Die Bahn wird nicht auf Gadachs' inzwischen neue Position verschoben.

Voll ausgebaut entstehen **252 Bomben und bis zu 756 Feuerbrocken pro Einsatz**, verteilt auf
bis zu etwa **8,3 Sekunden bis zum letzten Bombeneinschlag**. Diese Multiplikation ist ein zentraler Balance- und
Belastungsprüfpunkt.

## 4. Anforderungen an die Integration

### 4.1 Klasse und Migration

Gadachs erhält ausschließlich die zwei neuen Ultimatezweige. Investitionen in seine entfernten
Zweige geben die gebundenen normalen und Boss-Punkte wieder frei. Veraltete Ultimate-Auswahlen
wechseln auf Holo-Offensive. Wiederholtes Laden darf keine zusätzlichen Punkte erzeugen; andere
Klassenprofile bleiben erhalten.

### 4.2 Abgrenzung zu bestehenden Fähigkeiten

Turmkopien-Utility und Angriffsdrohnenstation behalten ihre eigenen Regeln und Upgrades.
Ultimate-Kopien nehmen auch in V2 nicht an Feuerleitportalen teil.

### 4.3 Lifetime und Aufräumen

Bei Spielertod stoppen neue Kopien und noch nicht gestartete Drohnen. Bestehende Kopien und bereits
gestartete Bomber einschließlich ihres zweiten Überflugs laufen aus. Bei Verlassen des Spielers
oder World-/Activity-Teardown werden die Einsätze vollständig aufgeräumt.

Eine Kampfunterbrechung durch `interruptCombat`, etwa beim **Bemannen**, **Betreten einer
Struktur** oder durch **Stun**, beendet keinen Einsatz.

### 4.4 Content und Schnittstellen

Die Ultimate-IDs `HOLO_OFFENSIVE` und `BOMBER_SQUADRON`, eigene Configvarianten sowie
klassengebundene Unlock- und Upgradeeinträge sind in Kapitel 6 verbindlich festgelegt.
Diese IDs bezeichnen den umzusetzenden Content, keine Zusage bereits vorhandener Fähigkeiten.

Kopien benötigen unabhängige Feueridentitäten und Lebenszeiten. Bomber benötigen je Drohne einen
festen Korridor, Abwurffortschritt und Überflugstatus.

### 4.5 Autorität und Schadenszuordnung

Der Host entscheidet Vorlagen, Spawns, Korridore, Abwürfe und Schaden. Replikation überträgt den
bestätigten Einsatz einschließlich verbleibender Lebenszeiten für Late Join. Bestehende Turm-,
Explosions-, Injektor- und Feuerbrockenregeln werden wiederverwendet; die Ultimate besitzt ihren
zeitlichen Ablauf.

Allgemeine und spezifische Modifikatoren werden genau einmal angewendet. Verzögerte Geschosse,
Bomben und Folgeeffekte behalten ihre beim Abschuss beziehungsweise Abwurf erfasste Wirkung auch
nach Ablauf der erzeugenden Kopie oder Drohne.

**Replikationsvertrag:**

- **Holo-Offensive im vorhandenen `fc`-Slice:** eigene Einsatzart **2**; Lebensdauer und
  Materialisierungsdauer werden einmal je Einsatz übertragen. Kompakte Kopienzeilen enthalten
  `[seq, weapon, x10, y10, angle1000, spawnedAt]`. Einsatz-IDs sind über Holo- und
  Feuerleit-Einsätze hinweg eindeutig. Der Slice wird je Tick übertragen; sein Größenbudget
  berücksichtigt auch gleichzeitig aktive Relais-Kopien.
- **Bombergeschwader im neuen `bq`-Slice:** ein deterministischer Datensatz je Staffel mit
  eingefrorenen Zählwerten und Zeiten, Winkel, Stopp-Flag sowie den Ankern, sobald diese beim
  jeweiligen Anflugstart feststehen. Der Slice wird vollständig ersetzt; `[]` räumt ihn auf.
  Er ist Bestandteil des vollständigen Spielzustands.
- Clients leiten **Flug, Abwürfe und Explosionsoptik** aus dem bestätigten Staffelplan ab;
  es gibt **kein RPC je Bombe**. Der Host bleibt für Treffer und Schaden zuständig.
  **Late Join überspringt vergangene Bomben**, statt deren Abwürfe oder Explosionen nachzuholen.
- **Effektnachrichten werden je Host-Frame gebündelt**, insbesondere `fcfx`.
  Landungsexplosionen der Bomber-Feuerbrocken erzeugen keine zusätzliche Broadcast-Nachricht:
  Ihr Schaden bleibt hostautoritativ, ihre Optik wird clientseitig bereits dargestellt.

### 4.6 Darstellung und Bedienungsfeedback

Die Darstellung folgt der orthografischen Top-down-Perspektive. Holo-Kopien zeigen ihren Turmtyp
deutlich, materialisieren sich kurz und lösen sich am Ende sichtbar auf. Bomber besitzen eine
erkennbare Bombenträger-Silhouette, klare Flugrichtung und sichtbare Abwürfe. Explosionen, Audio und
Kamerafeedback werden innerhalb eines Teppichs gebündelt, damit Spieler und Gegner lesbar bleiben.

**Holo-Look (U3):** Die Kopien verwenden den bereits abgenommenen **Glas-Hologramm-Look** der
Turmkopien, jedoch **ohne Projektor und Strahl**. Unter jeder Kopie sitzt ein kleiner leuchtender
Holo-Sockel; ein kurzer Entstehungsblitz führt von Gadachs zur neuen Kopie.

**Bomber-Look (U1):** Die Bomber sehen wie Drohnen aus. **Schritt 1** verwendet die vorhandenen
Angriffsdrohnen-Assets (`AttackDroneRenderer`, `attack-drone-body`). **Schritt 2** ersetzt sie
durch eigene Drohnen-Bomber-Assets. Der **Dawn-Tarnkappenbomber wird hier nicht verwendet**;
er bleibt für einen späteren Umbau des Luftangriffs reserviert.

Das Ultimate-HUD zeigt Freischaltung, benötigte Rage und den laufenden Einsatz. Bei der
Holo-Offensive zeigt der Ultimate-Slot **„Aktiv“ mit der Restzeit bis zum Ablauf der letzten
Kopie**. Beim Bombergeschwader zeigt er **„Aktiv“ bis zum letzten Bombeneinschlag**.

Fehlende Turmvorlagen werden mit **„Keine kampffähigen eigenen Türme“**, ein fehlender erster
Spawnplatz mit einem **Platzierungsfehler** erklärt. Beide Fehlerfälle verbrauchen keine Rage.

Die **rote Spieler-Einfärbung gilt ausschließlich für Honigdachs-Wut**. Die bisherige Einfärbung
bei jeder aktiven Ultimate wird korrigiert; Holo-Offensive und Bombergeschwader färben Gadachs
nicht rot.

## 5. Anforderungen an die Abnahme

### 5.1 Funktionale Abnahme

- Gadachs kann nur die zwei neuen Ultimates ausrüsten; Bomber bleiben bis zum Kauf gesperrt.
  Migration und Punkterückgabe funktionieren wiederholbar.
- Kopienerzeugung, individuelle Lebensdauer und Rage-Schwelle sind unabhängig. Frühstart verlängert
  keinen Einsatz bei gleicher Rage.
- Ein Original kann mehrere unabhängige Kopien liefern. Seine Zerstörung beendet diese nicht;
  Original und Kopien beeinflussen ihre Feuerfolgen nicht gegenseitig.
- Injektorwirkung funktioniert für Schaden, Gravitation und Verlangsamung ohne Doppelanwendung,
  auch bei verzögerten Treffern.
- Jede Bomberbahn erfasst die Position beim eigenen Anflugstart. Alle Erstüberflüge besitzen
  dieselbe Richtung; der Bossrückflug verwendet jeweils die ursprüngliche Bahn.
- Bewegung, Kartenränder, fehlende Spawnflächen, Tod, Disconnect, Late Join und Teardown erzeugen
  keine verwaisten Einsätze oder doppelten Abwürfe.

### 5.2 Balanceabnahme

Verglichen werden Basis- und Vollausbau gegen verstreute Gegner, dichte Gruppen, Boss und feindliche
Basis. Holo-Offensive wird zusätzlich mit einem einzelnen Original und einem gemischten Turmarsenal
geprüft.

Die Holo-Offensive soll bei anhaltendem Kampf und gut ausgebauten Türmen überzeugen. Das
Bombergeschwader soll schneller große Gruppen entlasten, jedoch ohne gezielte Bahnbündelung keinen
vergleichbar starken Einzelschadensangriff ersetzen. Änderungen beginnen bei
Kopienintervall/-lebensdauer beziehungsweise Bombenschaden und Flächenüberlappung.

### 5.3 Belastung und Verifikation

Vier vollständig ausgebaute Einsätze ergeben bis zu **60 gleichzeitig bestehende Ultimate-Kopien**
beziehungsweise insgesamt **1.008 Bomben und 3.024 Feuerbrocken** während vier Bomberangriffen.
Diese Fälle werden mit normalem Gefecht geprüft. Zusätzlich werden **12 Relais-Kopien** neben
den 60 Holo-Kopien geprüft, also **72 temporäre Kopien** mit einem Größenbudget für `fc`.
Der Bomber-Stressfall erhält ein Nachrichtenbudget. Kosmetische Effekte dürfen reduziert werden;
tatsächliche Bomben oder Treffer dürfen nicht stillschweigend entfallen.

Bestehende Ultimate-, Fire-Control-, Drohnen-, Loadout- und Persistenztests werden bei der späteren
Implementierung um die relevanten Verhaltensverträge erweitert. Dafür gelten `npm run check` sowie
passende Integration-, Stress- und Balance-Lab-Prüfungen gemäß der
[Teststrategie](../ai/testing.md). Erwartete Mengen werden aus der Config abgeleitet und nicht
als feste Testkonstanten hinterlegt. Kapitel 8 ordnet die Abnahme den geplanten Tests zu.
Browser- und Sichtprüfung erfolgen nur nach ausdrücklichem Auftrag; der Plan sieht Sichtprüfungen
an den Gates vor.

## 6. IDs und Content

Die IDs und Bindungen dieses Kapitels sind fest. Beide Ultimates erhalten eigene Configvarianten;
ihre Werte und Upgrades werden über authored Content aufgelöst.

| Content | Feste ID | Vorgabe |
|---|---|---|
| Holo-Offensive | `HOLO_OFFENSIVE` | Configtyp `holo_offensive`; kostenlose Standard-Ultimate. |
| Bombergeschwader | `BOMBER_SQUADRON` | Configtyp `bomber_squadron`; nach Kauf auswählbar. |
| Holo-Freischaltung | `unlock_holo_offensive` | `startingLevel: 1`, nicht erstattbar. |
| Bomberfreischaltung | `unlock_bomber_squadron` | Kostet einen normalen Upgradepunkt; kein automatisches Ausrüsten. |

| Upgrade | Feste Upgrade-Icon-ID |
|---|---|
| Stabile Projektion | `UPGRADE_HOLO_OFFENSIVE_DURATION` |
| Schnellprojektion | `UPGRADE_HOLO_OFFENSIVE_INTERVAL` |
| Frühstart | `UPGRADE_HOLO_OFFENSIVE_RAGE_REQUIRED` |
| Injektorprojektion | `UPGRADE_HOLO_OFFENSIVE_INJECTOR` |
| Großgeschwader | `UPGRADE_BOMBER_SQUADRON_SIZE` |
| Erweiterter Bombenschacht | `UPGRADE_BOMBER_SQUADRON_BOMB_COUNT` |
| Brandladung | `UPGRADE_BOMBER_SQUADRON_FIRE_CHUNKS` |
| Zweiter Anflug | `UPGRADE_BOMBER_SQUADRON_SECOND_PASS` |

**Klassen- und Modusbindung:**

- Die bisherigen Ultimate-Wurzeln `unlock_armageddon`, `unlock_gauss_rifle`,
  `unlock_airstrike` und `unlock_honey_badger_rage` sind nur noch für
  `dachs_nukem` und `dachs_of_steel` verfügbar:
  `availableClasses: ["dachs_nukem", "dachs_of_steel"]`.
  Ihre abhängigen normalen und Boss-Knoten folgen dieser Bindung.
- Die beiden neuen Bäume sind ausschließlich an `inspector_gadachs` gebunden:
  `availableClasses: ["inspector_gadachs"]`.
- Beide neuen Ultimates erhalten `allowedModes: ["coop_defense"]`; sie werden nicht im PvP angeboten.
- Im Katalog steht Holo vor Bomber (`order: 5` beziehungsweise `order: 6`).
  Veraltete Gadachs-Auswahlen fallen auf Holo zurück. Die Klassenbindung wird auch bei der
  Übernahme eines Loadouts durch den Host geprüft.
- Die Upgrade-Stufen, Kosten und Abhängigkeiten aus §2.4 und §3.4 bleiben verbindlich,
  einschließlich der beiden Voraussetzungen für den Boss-Knoten.

## 7. Entscheidungslog

Die Lead-Session ergänzt weitere Einträge während der Umsetzung.

**User-Entscheidungen** sind bis zu einer neuen User-Entscheidung bindend.
**Defaults** gelten für die Umsetzung, können aber an einem Gate geändert werden.
Die vier User-Entscheidungen stammen aus dem freigegebenen Plan vom 2026-10-14; anschließend
folgen sämtliche dort unter „Design-Defaults“ festgelegten Regeln.

| ID | Datum | Entscheidung | Begründung | Status |
|---|---|---|---|---|
| U1 | 2026-10-14 | Bomber sehen wie Drohnen aus: Schritt 1 nutzt Angriffsdrohnen-Assets (`AttackDroneRenderer`, `attack-drone-body`), Schritt 2 eigene Drohnen-Bomber-Assets. Der Dawn-Tarnkappenbomber bleibt dem späteren Luftangriff-Umbau vorbehalten. | Gewünschte Drohnen-Silhouette; getrennte visuelle Identität des Luftangriffs. | User-Entscheidung 2026-10-14 |
| U2 | 2026-10-14 | Jede Drohne erfasst Gadachs' Position beim eigenen Anflugstart; ihr Korridor beginnt knapp davor und reicht 640 px in die beim Aktivieren festgelegte Zielrichtung. | Spielerbewegung führt spätere Bahnen; begonnene Bahnen bleiben berechenbar. | User-Entscheidung 2026-10-14 |
| U3 | 2026-10-14 | Holo-Kopien nutzen den abgenommenen Glas-Hologramm-Look ohne Projektor und Strahl, ergänzt um einen kleinen leuchtenden Sockel und einen kurzen Entstehungsblitz von Gadachs zur Kopie. | Vertraute Kopienoptik mit sichtbarem Ursprung der Ultimate. | User-Entscheidung 2026-10-14 |
| U4 | 2026-10-14 | Astra übernimmt Code, Analysen, Bildgenerierung und Browser-Aufnahmen; Opus übernimmt Verträge, Reviews, Integration, Shader und Optik. Fragen werden wie bei der Feuerleitung an den Gates gesammelt. | Festgelegte Arbeitsteilung und gebündelte Richtungsentscheidungen. | User-Entscheidung 2026-10-14 |
| D1 | 2026-10-14 | Holo-Offensive ist freigeschalteter Standard; ihre Freischaltung ist nicht erstattbar (§1.1). | Verhindert einen Rückfall der Ultimate-Auswahl auf ARMAGEDDON. | Default, an Gate kippbar |
| D2 | 2026-10-14 | Kopien haben eigene Identität, MG-Attrition und Feuerfolge. Nur dauerhafte Turm-Upgrades werden eingefroren; temporäre Originalboni wie Injektor und Fernsteuerung werden nicht kopiert (§2.2). | Vollständige Eigenständigkeit ohne geerbte temporäre Verstärkung. | Default, an Gate kippbar |
| D3 | 2026-10-14 | Kopien sind niemals Konstruktionen: keine Bemannung, Fernsteuerung oder Injektor-Suche über die Position (§2.2). | Verhindert unbeabsichtigte Konstruktionsfunktionen und örtlich geerbte Boni. | Default, an Gate kippbar |
| D4 | 2026-10-14 | Kopien zielen wie Spielertürme, einschließlich feindlicher Basen über die bestehende dritte Zielstufe (§2.2). | Einheitliche Zielregeln für dieselben Turmwaffen. | Default, an Gate kippbar |
| D5 | 2026-10-14 | Platzierung auf begehbarem Boden mit 16 px Freiraum über `isPointFree` und mindestens 32 px Abstand zu allen temporären Kopien einschließlich Relais-Kopien (§2.3). | Freie, lesbare Platzierung auch bei gleichzeitiger Utility-Nutzung. | Default, an Gate kippbar |
| D6 | 2026-10-14 | Holo-HUD zeigt „Aktiv“ und Restzeit bis zum Ablauf der letzten Kopie (§4.6). | Sichtbar bleibt die tatsächliche Einsatzsperre. | Default, an Gate kippbar |
| D7 | 2026-10-14 | Ohne Vorlage erscheint „Keine kampffähigen eigenen Türme“, ohne ersten Platz ein Platzierungsfehler; beide Fälle verbrauchen keine Rage (§2.3, §4.6). | Fehlgeschlagene Aktivierung kostet keine Ressource. | Default, an Gate kippbar |
| D8 | 2026-10-14 | Bomberkorridor beginnt 48 px vor Gadachs (`corridorLeadPx`, §3.2). | Konkretisiert „knapp vor Gadachs“ aus U2. | Default, an Gate kippbar |
| D9 | 2026-10-14 | Bomberanflug dauert 0,6 s ab 240 px vor Korridorbeginn (§3.2). | Sichtbarer Anflug vor dem Bombenlauf. | Default, an Gate kippbar |
| D10 | 2026-10-14 | Bomber werden während des Anflugs eingeblendet (§3.2). | Lesbarer Eintritt in die Darstellung. | Default, an Gate kippbar |
| D11 | 2026-10-14 | Abwurfpunkte liegen bei (i + 0,5) / n der Bahnlänge, i = 0 bis n − 1 (§3.2). | Gleichmäßige Abdeckung durch mittige Punkte je Bahnabschnitt. | Default, an Gate kippbar |
| D12 | 2026-10-14 | Bahnen sind gleichmäßig über 560 px Gesamtbreite verteilt (§3.2). | Zusätzliche Drohnen verdichten dieselbe Angriffsfläche. | Default, an Gate kippbar |
| D13 | 2026-10-14 | Mittlere Bahn(en) starten zuerst, danach abwechselnd die äußeren (§3.2). | Vorhersehbarer Aufbau des Bombenteppichs von innen nach außen. | Default, an Gate kippbar |
| D14 | 2026-10-14 | Zweiter Anflug: U-Bogen von 1 s hinter dem Korridorende, anschließend dieselbe Bahn rückwärts (§3.6). | Sichtbare Wende ohne erneute Zielerfassung. | Default, an Gate kippbar |
| D15 | 2026-10-14 | Bomber sperren weitere Einsätze bis zum letzten Bombeneinschlag; Bodenfeuer verlängert nicht. Das HUD zeigt „Aktiv“ (§3.1, §4.6). | Sperre folgt dem Bombenlauf und bleibt verständlich. | Default, an Gate kippbar |
| D16 | 2026-10-14 | Bomberkauf rüstet die Ultimate nicht automatisch aus (§1.1). | Entspricht dem Kaufverhalten anderer Ultimates. | Default, an Gate kippbar |
| D17 | 2026-10-14 | Tod stoppt neue Kopien und noch nicht gestartete Drohnen; bereits Laufendes läuft aus (§4.3). | Kein neuer Einsatzanteil nach dem Tod, bestehende Wirkung bleibt konsistent. | Default, an Gate kippbar |
| D18 | 2026-10-14 | `interruptCombat` durch Bemannen, Struktur betreten oder Stun beendet keinen Einsatz (§4.3). | Automatische Unterstützung bleibt unabhängig von einer Kampfunterbrechung. | Default, an Gate kippbar |
| D19 | 2026-10-14 | Rote Spieler-Einfärbung ausschließlich bei Honigdachs-Wut; das bisherige Rot bei jeder aktiven Ultimate wird korrigiert (§4.6). | Die Farbe kennzeichnet die richtige Fähigkeit. | Default, an Gate kippbar |
| D20 | 2026-10-14 | Bahnoffsets −W/2 + W · (j + 0,5) / n über die Gesamtbreite; Abflug nach dem letzten Überflug 900 ms (nur Darstellung). | Analog zu den Abwurfpunkten deckt jede Bahn einen gleich breiten Streifen ab. | Von der Leit-Session übernommen |
| D21 | 2026-10-14 | Zweiter Anflug als geschlossene Tropfenkurve hinter dem Korridorende: Ausflug, Rückkehr auf dieselbe Bahn, Tangente und Tempo stetig; äußere Bahnen wenden nach außen, die mittlere nach links. | Sichtbare Wende ohne Bahnwechsel; keine Kreuzung der Nachbarbahnen. | Default, an Gate kippbar |
| D22 | 2026-10-14 | Eine veraltete oder klassenfremde Ultimate-Auswahl wird mit einer gemeinsamen Regel sowohl beim Client-Commit als auch bei jedem Lesen eines Commits auf dem Host auf die erste wählbare Ultimate (Holo) gesetzt. | Der Rundenstart übernimmt keine gesperrte Ultimate aus einem alten Commit. | Default, an Gate kippbar |
| D23 | 2026-10-14 | Slice `bq` wird jeden Zustands-Tick vollständig gesendet; Clients leiten Flug, Abwürfe und Explosionen aus dem Plan ab; Feuerbrocken-Effekte werden je Host-Frame zu einem `fcfx` gebündelt. | Verlorene Pakete heilen von selbst; vier volle Staffeln bleiben unter 2 KiB. | Default, an Gate kippbar |
| D24 | 2026-10-14 | Holo-Sockel nach PLATE_v06: dunkle Achteckscheibe unter der Kopie, 8 tangentiale Rand-Ticks; die Ticks laden vor der Kopie, dimmen je abgelaufenem Achtel der Lebensdauer und verlöschen zuletzt. Entstehungsblitz 260 ms, höchstens 180 px. | Auswahl der Leit-Session; keine Verwechslung mit der Portal-Iris, der Turm bleibt dominant. | Auswahl der Leit-Session |
| D25 | 2026-10-14 | Bomber fliegen über den Baumkronen (Tiefe Kronen + 0,6) und tragen die nächtliche Kronentönung; Explosionsoptik lokal aus dem Plan, je Frame höchstens 4 volle Explosionen im Bild, ein Kamera-Rumpeln je Staffel. | Lesbarkeit über Bäumen ohne Nachtglühen; Kosmetik wird ausgedünnt, Treffer nie. | Default, an Gate kippbar |
| D26 | 2026-10-14 | Host-Ausführung der Bomber-Einschläge übergibt den Subframe-Zeitpunkt; verschachtelt in der Host-Frame-Ausführung gilt derzeit noch die Framezeit (wie bei den Angriffsdrohnen). | Abweichung höchstens ein Frame, ohne Einfluss auf „genau einmal“. | Bestätigt an GU1 (D27) |
| D27 | 2026-10-14 | Kein Eingriff in `WorldCombatCore` für Subframe-Zeiten; der Befund bleibt als `it.fails` dokumentiert. | Höchstens ein Frame Abweichung; der Kernvertrag betrifft auch die Angriffsdrohnen. | Entscheidung Leit-Session an GU1 |
| D28 | 2026-10-14 | Eigener Drohnen-Bomber B3_v01 (VTOL, 2 Hubrotoren, Stummelflügel) mit Bombenanordnung P1 an der Flügelwurzel; Material matt und abgenutzt; Flugrichtung in 48 px klar. Kräftigerer Bodenschatten und kleine, gedämpfte Positionslichter ohne Glow. | Stärkere Abgrenzung von der Angriffsdrohne; Lesbarkeit bei Nacht. | User-Entscheidung (Form, Bomben) und Leit-Session an GU1 |
| D29 | 2026-10-14 | Der helle Nachtteppich im Vollausbau bleibt ungedämpft. | Gewünschte Wucht des Vollausbaus. | User-Entscheidung an GU1 |
| D30 | 2026-10-14 | Die Holo-Sockel-Ticks dimmen weiter je abgelaufenem Achtel der Kopienlebensdauer. | Ruhige, lesbare Restzeit ohne zusätzliches UI. | Entscheidung Leit-Session an GU1 |
| D32 | 2026-10-14 | Gemeinsames Nachtlicht aller fliegenden Drohnen (Angriffsdrohne, Bomber, Reparaturdrohnen): Drohnen-Renderer liefern nur Anker; ein szenenweiter Licht-Layer über dem Nacht-Overlay (unter den Kronen für tieffliegende, über den Kronen für Bomber) mit warmweißem, leicht gestrecktem Buglicht, langsamem himmelblauem Heck-Beacon und begrenzten Bodenlicht-Pools; tagsüber gedimmt. Dazu Silhouetten-Bodenschatten im Schattenband der Figuren. Farben getrennt von Gegneraugen, verbündeter Jade, Telegraph-Rot und Holo-Mint. | User-Auftrag: Drohnen nachts besser sichtbar, Lösung für alle fliegenden Drohnen nach dem Vorbild der Gegneraugen. | User-Auftrag, Optik Lead-Session |
| D33 | 2026-10-14 | Nachtlicht-Inventar: Angriffsdrohne, Bomber und beide Reparaturdrohnen sind angebunden. Der Dawn-Bombernacht-Überflug bleibt ohne Lichter (nur Formationsschatten feindlicher Tarnkappenbomber, kein sichtbares Fluggerät). Heck-Beacon auf ≈ 221° gesetzt, in die Lücke zwischen cyan- und violettfarbenen Gegneraugen; ein Test sichert den Farbabstand. | Positionslichter widersprächen Tarnung und Feindrolle; Farbtrennung bleibt prüfbar. | Entscheidung Lead-Session |
| D34 | 2026-10-14 | main gemergt (Dawn-Nachtmodifikatoren, Protokoll 34); Peer-Protokoll auf 35 für `fc`-Art 2, Pflicht-Slice `bq` und gebündelte `fcfx`. | Wire-Änderungen erfordern passende Peers. | Umgesetzt in U3.5 |
| D31 | 2026-10-14 | Holo-Sockel kleiner und zurückhaltender: etwa 1,2–1,25 × Turmfuß, schmalerer Rand, feinere Ticks, transparentere Scheibe; Turmtyp der Kopie (vor allem MG und Rakete) in Spielgröße klar lesbar. | Der Turm bleibt dominant; der Sockel darf nicht als UI-Plakette wirken. | Befund Leit-Session an GU1, Umsetzung U3.3 |

## 8. Abnahme → Test

Stand Gate GU1 (2026-10-14): Die funktionalen Zeilen sind umgesetzt und grün (Status **„grün (GU1)“**); Stress- und
Balance-Lab-Zeilen folgen mit U3.4 (Status **„geplant (U3.4)“**).
Die sechs funktionalen Zeilen entsprechen den sechs Abnahmepunkten aus §5.1 in derselben Reihenfolge.
Die Testnamen stammen aus der Verifikation des freigegebenen Plans. Wo dieser nur einen
Prüfbereich nennt, ist er bei der passenden Suite aufgeführt; die Injektor-Integration wird
dem Identitätstest zugeordnet.

Pfade in dieser Tabelle sind relativ zur Repository-Wurzel. **„Neu“** bezeichnet geplante, in
diesem Dokumentationsstand noch nicht vorhandene Testdateien; bestehende Dateien benötigen
die genannten Ergänzungen.

| Abnahmepunkt | Tests | Status |
|---|---|---|
| §5.1, Punkt 1: Gadachs kann nur die zwei neuen Ultimates ausrüsten; Bomber bleiben bis zum Kauf gesperrt; Migration und Punkterückgabe funktionieren wiederholbar. | `tests/CoopDefenseLoadoutSelection.test.ts`, `tests/LoadoutCatalog.test.ts`, `tests/CoopDefenseClassLoadoutPersistence.test.ts` (alte Level → 0, Punkte frei, veraltete Auswahl → Holo, zweimal laden stabil, andere Klassen unberührt); zusätzlich Host-Commit-Filter prüfen; `tests/GameContentValidation.test.ts`, `tests/CoopDefenseLoadoutModifierReachability.test.ts` (Modifier-Erreichbarkeit), `tests/PerformanceLabScenarios.test.ts`. | grün (GU1) |
| §5.1, Punkt 2: Erzeugung, individuelle Lebensdauer und Rage-Schwelle sind unabhängig; Frühstart verlängert bei gleicher Rage nichts. | `tests/HoloOffensiveRuntime.test.ts` (neu), `tests/PlayerUltimateBehaviorRuntime.test.ts`: gesamte Aktivierungsrage verbraucht, neue Rage nicht abgezogen, Einsatzsperre, kein Verbrauch bei Fehlern, sichere Wiederholung einer Anfrage, `interruptCombat` folgenlos. | grün (GU1) |
| §5.1, Punkt 3: Ein Original liefert mehrere unabhängige Kopien; Originalzerstörung beendet sie nicht; Feuerfolgen sind getrennt. | `tests/integration/HoloOffensiveIdentity.test.ts` (neu): getrennte Folgen, Original zerstört, bemannte oder pausierte Originale gültig, keine Portale, Kopien nicht in Konstruktionsdefinitionen oder Fernsteuerung, eigene MG-Attrition, korrekte Zuordnung der Kopienwinkel. | grün (GU1) |
| §5.1, Punkt 4: Injektor wirkt auf Schaden, Gravitation und Verlangsamung genau einmal, auch bei verzögerten Treffern. | `tests/integration/HoloOffensiveInjector.test.ts` (neu; Injektor-Integration): einmalige Wirkung auch neben einem injizierten Original, Raketentreffer nach Ablauf der Kopie, ohne Upgrade keine Wirkung. | grün (GU1) |
| §5.1, Punkt 5: Bahn je eigenem Anflugstart, gemeinsame Richtung aller Erstüberflüge, Bossrückflug auf derselben Bahn. | `tests/BomberSquadronPlan.test.ts` (neu), `tests/BomberSquadronRuntime.test.ts` (neu). | grün (GU1) |
| §5.1, Punkt 6: Bewegung, Kartenränder, fehlende Spawnflächen, Tod, Disconnect, Late Join und Teardown erzeugen keine verwaisten Einsätze oder Doppelabwürfe. | `tests/HoloOffensiveRuntime.test.ts` (neu; Bewegung, Spawnfehler, Aufräumen); `tests/integration/BomberSquadronCombat.test.ts` (neu: außerhalb der World entfällt die Bombe, jede Bombe genau einmal bei ungleichmäßigen Frames, kein Schaden an Verbündeten, Konstruktionen, Felsen oder Zug); `tests/integration/BomberSquadronLifecycle.test.ts` (neu: Tod, Disconnect, Teardown); `tests/integration/FireControlNetwork.test.ts` (Art 2, Late Join), `tests/integration/BomberSquadronNetwork.test.ts` (neu), `tests/PeerProtocol.test.ts`. | grün (GU1) |
| §5.3: 60 Holo- und 12 Relais-Kopien gleichzeitig im normalen Gefecht; Größenbudget für `fc`. | `tests/stress/FireControlStress.test.ts`. | geplant (U3.4) |
| §5.3: Vier volle Bomberangriffe mit 1.008 Bomben und 3.024 Brocken im normalen Gefecht; Nachrichtenbudget, keine entfallenen Treffer. | `tests/stress/BomberSquadronStress.test.ts` (neu). | geplant (U3.4) |
| §5.3: Bestehende Drohnen-, Basisziel- und Projektilreplikationslast erneut prüfen. | `tests/stress/AttackDroneStress.test.ts`, `tests/stress/TurretBaseTargetingStress.test.ts`, `tests/stress/ProjectileReplicationLoad.test.ts`. | geplant (U3.4) |
| §5.2: Holo-Offensive mit einzelnem Original und gemischtem Arsenal, jeweils Basis- und Vollausbau; Vergleich gegen verstreute Gegner, dichte Gruppen, Boss und Basis. | `tests/balance-lab/HoloOffensiveBenchmark.test.ts` (neu). | geplant (U3.4) |
| §5.2: Bombergeschwader gegen verstreute Gegner, dichte Gruppen, Boss und Basis, jeweils Basis- und Vollausbau. | `tests/balance-lab/BomberSquadronBenchmark.test.ts` (neu). | geplant (U3.4) |

## 9. Referenzen und bestehende Grundlagen

| Referenz | Bezug zu diesem GDD |
|---|---|
| [Feuerleit-Utilities GDD V2](Fragdachse_GDD_Inspector_Gadachs_Feuerleit_Utilitys_V2.md) | Bestehende Turmkopien-Utility, Originalbindung, Parallelbetrieb und Feuerleitportale. Die Ultimate besitzt die in Kapitel 2 ausdrücklich abweichenden Regeln. |
| [Angriffsdrohnenstation GDD V2](Fragdachse_GDD_Angriffsdrohnenstation_v2.md) | Bestehende Angriffsdrohnen, Bombenteppiche und Feuerbrocken. Das Bombergeschwader hat eigene Einsatz- und Upgradeparameter. |
| [FireControlEligibility.ts](../../src/systems/fireControl/FireControlEligibility.ts) | Bestehender Satz unterstützter Turmtypen; Grundlage für die sechs Vorlagentypen in diesem GDD. |
| [coopDefenseConstructions.ts](../../src/config/coopDefenseConstructions.ts) | Vorhandene Injektor-Effektdefinition je Konstruktion: Schaden, Zugkraft oder Verlangsamungsstärke. |
| [EnergyInjectorSystem.ts](../../src/systems/EnergyInjectorSystem.ts) und [HostUpdateCoordinator.ts](../../src/scenes/arena/HostUpdateCoordinator.ts) | Bestehende Injektorwirkung und Umrechnung der Verlangsamungsstärke. |
| [attackDrone.json](../../src/config/attackDrone.json) und [WorldAttackDroneBinding.ts](../../src/world/WorldAttackDroneBinding.ts) | Vorhandenes Feuerbrockenprofil und dessen Einbindung in Explosionen und Bodenfeuer. |
| [Visuelle Leitlinien](../ai/visual-guidelines.md) | Top-down-Perspektive, erkennbare Effektzustände und Lesbarkeit im Gefecht. |

Für Aussagen zum bestehenden Spiel bleibt der aktuelle Quellcode maßgeblich. Dieses GDD legt das
Zielverhalten der beiden neuen Ultimates fest und behauptet keine bereits erfolgte Implementierung.
