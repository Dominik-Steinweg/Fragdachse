# Fragdachse Inspector Gadachs Ultimates GDD V1

**Version:** 1.0

**Stand:** 14. Oktober 2026

**Klasse:** Inspector Gadachs

**Geltungsbereich:** Gameplay, Progression, Mehrspieler und Darstellung für Coop-Defense

**Status:** Design spezifiziert, nicht implementiert; Balancewerte sind ungetestete Startwerte.

Inspector Gadachs erhält mit **Holo-Offensive** und **Bombergeschwader** zwei klasseneigene Ultimates.
Die Holo-Offensive verstärkt sein vorhandenes Turmarsenal durch vorübergehende, eigenständige Kopien.
Das Bombergeschwader liefert kurzfristige Flächenunterstützung unabhängig von gebauten Konstruktionen.
Beide ersetzen seine bisherige Ultimate-Auswahl.

Die Regeln beschreiben Soll-Verhalten für eine spätere Implementierung. Integration und Abnahme in
den Kapiteln 4 und 5 sind Anforderungen an diese spätere Umsetzung; die Erstellung dieses GDD führt
keine Spielmechanik, Konfiguration oder Migration aus.

## 1. Zielbild und Umfang

### 1.1 Rollen und Verfügbarkeit

| Ultimate | Spielgefühl | Stärke |
|---|---|---|
| **Holo-Offensive** | Während Gadachs kämpft oder sich bewegt, entstehen um ihn vorübergehende Turmkopien. | Anhaltende Feuerunterstützung und Gebietskontrolle; verstärkt das vorhandene Turmarsenal. |
| **Bombergeschwader** | Eine Staffel fliegt leicht zeitversetzt aus derselben Richtung ein und legt breite Bombenteppiche. | Schnelle Entlastung gegen Gegnergruppen; funktioniert unabhängig von gebauten Konstruktionen. |

Die Holo-Offensive ist kostenlos freigeschaltet und standardmäßig ausgerüstet. Das Bombergeschwader
kostet **einen normalen Upgradepunkt**. Beide verwenden den vorhandenen Ultimate-Slot.

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
konkretisieren diese Entscheidungen. Sie gelten als Startentwurf für die spätere Umsetzung und
wurden nicht einzeln als Nutzerentscheidungen festgelegt. Die aktuellen Injektorwerte und das
Feuerbrockenprofil stammen aus den in Kapitel 6 verlinkten bestehenden Systemen.

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

V1 unterstützt die bereits für Turmkopien vorgesehenen Typen: **MG, Raketen, Sporen, Flammen,
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
Originals zum Spawnzeitpunkt. Sie erhält eine eigene Feuerfolge und beginnt nach der
Materialisierung kampfbereit. Laufende Salven des Originals werden nicht übernommen.

Die Kopien sind unverwundbar, nicht blockierend und nicht bemannbar. Sie benötigen keine
Baukapazität und können weder repariert noch abgebaut oder gespeichert werden. Ihr Schaden zählt
zum Besitzer.

**Die Zerstörung des Originals beendet bestehende Ultimate-Kopien nicht.** Weitere Kopien benötigen
jedoch weiterhin eine gültige Vorlage.

### 2.3 Platzierung und Bewegung

Jede Kopie entsteht um die **aktuelle Position** von Gadachs und bleibt anschließend dort stehen.

Der bevorzugte Spawnring besitzt **120 px Radius**. Seine zwölf Winkelpositionen werden reihum
verwendet. Ist der vorgesehene Platz ungültig, werden die übrigen Ringplätze und anschließend Ringe
mit **80 und 160 px** geprüft. Kopien benötigen gültigen Boden, **16 px Freiraum** und mindestens
**32 px Abstand** zu anderen Kopien.

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

V1 erhält keinen zusätzlichen Bossknoten für diese Ultimate. Voll ausgebaut entstehen bei
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

Bis zum Abschluss der Staffel ist ein weiterer Ultimate-Einsatz gesperrt. Bereits entstandenes
Bodenfeuer verlängert diese Sperre nicht.

### 3.2 Bombenteppiche und Spielerbewegung

**Jede Drohne erfasst Gadachs' Position zu Beginn ihres eigenen Anflugs.** Daraus legt sie einen
festen Korridor fest. Nachfolgende Spielerbewegungen verändern diesen begonnenen Anflug nicht mehr.

Bei stillstehendem Gadachs entstehen parallele Bahnen über einer gemeinsamen Fläche:

- Korridorlänge: **640 px**.
- Seitliche Verteilung der Bahnen: gleichmäßig über **560 px Gesamtbreite**.
- Anflugreihenfolge: mittlere Bahnen zuerst, anschließend abwechselnd nach links und rechts außen.
- Bomben werden gleichmäßig entlang der jeweiligen Bahn abgeworfen.

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
ungefähr **4,2 Sekunden nach Aktivierung**. Die Summe aller Bombenschäden ist kein
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

Nach dem ersten Überflug wendet jede Drohne sichtbar innerhalb einer Sekunde hinter ihrem Korridor
und bombardiert **dieselbe Bahn in Gegenrichtung**. Sie erhält dafür erneut ihre vollständige
Bombenanzahl. Die Bahn wird nicht auf Gadachs' inzwischen neue Position verschoben.

Voll ausgebaut entstehen **252 Bomben und bis zu 756 Feuerbrocken pro Einsatz**, verteilt auf etwa
**8,3 Sekunden bis zum letzten Bombeneinschlag**. Diese Multiplikation ist ein zentraler Balance- und
Belastungsprüfpunkt.

## 4. Anforderungen an die spätere Integration

### 4.1 Klasse und Migration

Gadachs erhält ausschließlich die zwei neuen Ultimatezweige. Investitionen in seine entfernten
Zweige geben die gebundenen normalen und Boss-Punkte wieder frei. Veraltete Ultimate-Auswahlen
wechseln auf Holo-Offensive. Wiederholtes Laden darf keine zusätzlichen Punkte erzeugen; andere
Klassenprofile bleiben erhalten.

### 4.2 Abgrenzung zu bestehenden Fähigkeiten

Turmkopien-Utility und Angriffsdrohnenstation behalten ihre eigenen Regeln und Upgrades.
Ultimate-Kopien nehmen in V1 nicht an Feuerleitportalen teil.

### 4.3 Lifetime und Aufräumen

Bei Spielertod stoppen neue Kopien und noch nicht gestartete Drohnen. Bestehende Kopien und bereits
gestartete Bomber einschließlich ihres zweiten Überflugs laufen aus. Bei Verlassen des Spielers
oder World-/Activity-Teardown werden die Einsätze vollständig aufgeräumt.

### 4.4 Content und Schnittstellen

Für die spätere Implementierung sind die neuen Ultimate-IDs `HOLO_OFFENSIVE` und `BOMBER_SQUADRON`
vorgesehen, ergänzt um eigene Configvarianten sowie klassengebundene Unlock- und Upgradeeinträge.
Diese IDs bezeichnen geplanten Content, keine bereits vorhandenen Fähigkeiten.

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

### 4.6 Darstellung und Bedienungsfeedback

Die Darstellung folgt der orthografischen Top-down-Perspektive. Holo-Kopien zeigen ihren Turmtyp
deutlich, materialisieren sich kurz und lösen sich am Ende sichtbar auf. Bomber besitzen eine
erkennbare Bombenträger-Silhouette, klare Flugrichtung und sichtbare Abwürfe. Explosionen, Audio und
Kamerafeedback werden innerhalb eines Teppichs gebündelt, damit Spieler und Gegner lesbar bleiben.

Das Ultimate-HUD zeigt Freischaltung, benötigte Rage und den laufenden Einsatz. Fehlende
Turmvorlagen werden mit **„Keine kampffähigen eigenen Türme“** erklärt.

## 5. Anforderungen an die spätere Abnahme

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
Diese Fälle werden mit normalem Gefecht geprüft. Kosmetische Effekte dürfen reduziert werden;
tatsächliche Bomben oder Treffer dürfen nicht stillschweigend entfallen.

Bestehende Ultimate-, Fire-Control-, Drohnen-, Loadout- und Persistenztests werden bei der späteren
Implementierung um die relevanten Verhaltensverträge erweitert. Dafür gelten `npm run check` sowie
passende Integration-, Stress- und Balance-Lab-Prüfungen gemäß der
[Teststrategie](../ai/testing.md). Browser- und Sichtprüfung erfolgen nur nach ausdrücklichem Auftrag.

## 6. Referenzen und bestehende Grundlagen

| Referenz | Bezug zu diesem GDD |
|---|---|
| [Feuerleit-Utilities GDD V2](Fragdachse_GDD_Inspector_Gadachs_Feuerleit_Utilitys_V2.md) | Bestehende Turmkopien-Utility, Originalbindung, Parallelbetrieb und Feuerleitportale. Die Ultimate besitzt die in Kapitel 2 ausdrücklich abweichenden Regeln. |
| [Angriffsdrohnenstation GDD V2](Fragdachse_GDD_Angriffsdrohnenstation_v2.md) | Bestehende Angriffsdrohnen, Bombenteppiche und Feuerbrocken. Das Bombergeschwader hat eigene Einsatz- und Upgradeparameter. |
| [FireControlEligibility.ts](../../src/systems/fireControl/FireControlEligibility.ts) | Bestehender Satz unterstützter Turmtypen; Grundlage für die sechs Vorlagentypen in V1. |
| [coopDefenseConstructions.ts](../../src/config/coopDefenseConstructions.ts) | Vorhandene Injektor-Effektdefinition je Konstruktion: Schaden, Zugkraft oder Verlangsamungsstärke. |
| [EnergyInjectorSystem.ts](../../src/systems/EnergyInjectorSystem.ts) und [HostUpdateCoordinator.ts](../../src/scenes/arena/HostUpdateCoordinator.ts) | Bestehende Injektorwirkung und Umrechnung der Verlangsamungsstärke. |
| [attackDrone.json](../../src/config/attackDrone.json) und [WorldAttackDroneBinding.ts](../../src/world/WorldAttackDroneBinding.ts) | Vorhandenes Feuerbrockenprofil und dessen Einbindung in Explosionen und Bodenfeuer. |
| [Visuelle Leitlinien](../ai/visual-guidelines.md) | Top-down-Perspektive, erkennbare Effektzustände und Lesbarkeit im Gefecht. |

Für Aussagen zum bestehenden Spiel bleibt der aktuelle Quellcode maßgeblich. Dieses GDD legt das
Zielverhalten der beiden neuen Ultimates fest und behauptet keine bereits erfolgte Implementierung.
