# FRAGDACHSE – Konzept: Angriffsdrohnenstation

**Version:** 2.0  
**Stand:** 23. September 2026  
**Klasse:** Inspektor Gadachs  
**Status:** Vollständiges Gameplay-Konzept mit konkretem initialem Balancing; rechnerisch gegen vorhandene Konstrukte eingeordnet, noch nicht im Spiel getestet.  
**Änderung gegenüber V1:** 30 Konstruktionskosten und sämtliche zuvor offenen Balancingwerte festgelegt. Der beschlossene Upgrade-Baum und die Bombenprioritäten bleiben erhalten.

> Eine stationäre Drohnenbasis unterhält genau eine Angriffsdrohne. Diese patrouilliert autonom im Umfeld ihres Besitzers, bestreicht Gegnergruppen mit schnellen, schwenkenden Feuerstößen und erhält durch ein Bossupgrade wiederkehrende Bombenangriffe. Bordmunition begrenzt das Geschütz; Bomben besitzen ausschließlich einen eigenen Cooldown.

## 1. Zielbild und Geltungsbereich

Das Konstrukt erweitert den Inspektor um mobile, offensive Luftunterstützung. Der Spieler bestimmt durch seine Position, wo die Drohne tätig wird. Er muss keine Ziele markieren, keinen zusätzlichen Knopf drücken und keine einzelnen Flugmanöver steuern.

Die Station ist der Ausgangspunkt und Versorgungsort. Die Drohne operiert dagegen in der Nähe des **Besitzers**, nicht in einem festen Radius um die Station. Mehrere Stationen desselben Spielers dürfen jeweils eine eigene Drohne unterhalten; die Anzahl der Stationen wird über die reguläre Konstruktverwaltung und Baukapazität begrenzt.

Als aus der bisherigen Diskussion übernommene Grundannahme gilt: Die fliegende Drohne ist nicht anvisierbar und nicht beschädigbar; die Bodenstation ist ein verwundbares Konstrukt. Sie ist weder Köder noch fliegender Tank und besitzt keine Kamikaze-Funktion.

**Nicht Bestandteil dieser Version:** besondere Regeln gegen Verschieben-, Rückbau- oder Neubau-Tricks, zusätzliche Bedienaktionen, ein eigener Schadens-Upgrade-Knoten oder eine zweite gleichzeitig aktive Drohne derselben Station.

Die bestätigten Mechaniken aus V1 bleiben verbindlich. Die ergänzten Zahlen in V2 sind konkrete **Startwerte für Implementierung und Spieltests**, keine bereits gemessenen Ergebnisse. Alle Schadenswerte sind Basiswerte vor allgemeinen Modifikatoren, Rüstung und sonstigen Empfängerregeln.

**Balanceziel:** Gegenüber einer gut positionierten stationären Schadenslösung mit **ebenfalls 30 Baukapazität** besitzt die Grunddrohne weniger Dauerschaden. Bezahlt werden mobile Zielabdeckung, hindernisunabhängiger Beschuss und die Unverwundbarkeit der fliegenden Einheit. Der Vergleich erfolgt nicht mit einem einzelnen, wesentlich günstigeren MG-Turm. Als Hauptreferenz dient der ebenfalls 30 Kapazität teure Raketenturm; drei MG-Türme bilden eine zusätzliche Einzelschadensreferenz. [S3–S6]

## 2. Station, Drohne und Lebenszyklus

### 2.1 Basiswerte der Station

| Eigenschaft | Basiswert |
|---|---:|
| Konstruktionskosten / gebundene Baukapazität | **30** |
| Lebenspunkte | **200** |
| Grundfläche | **1 Rasterzelle**, regulärer Konstrukt-Footprint |
| Bau- und Interaktionsreichweite | **350 px** |
| Bau-Cooldown | **100 ms**, wie die bestehenden Konstrukte |
| Zusätzliche Bau- oder Erststartwartezeit | **0 ms** |
| Gleichzeitig zugeordnete Drohnen | **Genau 1 je Station** |
| Separate Adrenalin- oder Munitionskosten | **Keine** |
| Startmagazin | **180 Schuss** |
| Normale Stationsversorgung | **2,5 s**, danach volles Bordmagazin |
| Eigene Bewaffnung der Bodenstation | **Keine** |

Die Kosten belegen Kapazität, solange die Station existiert; jeder Versorgungsumlauf kostet nicht erneut 30. Bei der derzeitigen Inspektor-Grundkapazität von 100 sind ohne Kapazitätsboni drei Stationen möglich, mit zehn Restkapazität. Bauwerte und Grundkapazität der vorhandenen Konstrukte wurden im Repository abgeglichen. [S3, S8]

200 Lebenspunkte geben der Station normale Konstrukt-Robustheit, aber weniger Lebenspunkte als dem Raketenturm mit 250. Reguläre Reparaturen und allgemeine Konstrukt-Lebenspunkteboni bleiben nutzbar. Die Drohne selbst erhält weder einen Trefferkörper für gegnerische Angriffe noch einen regulären Lebenspunktevorrat.

### 2.2 Lebenszyklus

Nach dem Bau startet eine Drohne mit vollem Bordmagazin von ihrer Station und fliegt zum Besitzer. Mit freigeschaltetem Bombenschacht sind ihre Bomben beim ersten Einsatz sofort bereit.

Der normale Zyklus lautet:

**Start → Anschluss an den Besitzer → Patrouille und Angriffe → Versorgungsentscheidung → gegebenenfalls Stationsflug → Aufmunitionieren → erneuter Start.**

Während einer Rückkehr oder Stationsversorgung wird keine zusätzliche Drohne erzeugt. Dieselbe Station unterhält auch dann nur eine Drohne, wenn deren Magazin leer oder der Bombenangriff noch nicht bereit ist.

Verliert eine weiterhin bestehende Station ihre zugehörige Drohne durch einen gesonderten Lifecycle-Fall, darf sie eine Ersatzdrohne bereitstellen. Da die Drohne nicht regulär beschädigbar ist, ist das kein wiederkehrender Kampfmechanismus. Ein leerer Munitionsvorrat führt zur Versorgung, nicht zur Zerstörung.

Als konsistente Lifecycle-Regel endet beim endgültigen Entfernen oder Zerstören einer Station auch der aktive Drohneneinsatz. Die Drohne deaktiviert sich ohne Schaden verursachende Explosion. Bereits abgefeuerte Geschosse und abgeworfene Bomben werden nach den normalen Regeln bestehender Kampfeffekte abgewickelt; sie erzeugen keine neue Drohne.

Verschieben und Rückbau verwenden die vorhandene Konstruktverwaltung. Es werden dafür in dieser Version ausdrücklich keine zusätzlichen Sonder-Cooldowns oder Missbrauchsschutzregeln eingeführt.

## 3. Flugverhalten und räumliche Regeln

### 3.1 Aufenthaltsbereich

Der Patrouillenbereich liegt ungefähr **400 px um den aktuellen Besitzer**. Das ist ein weicher Aufenthaltsbereich, keine verpflichtende Kreisbahn und kein fester Abstand von exakt 400 px.

Die Drohne bevorzugt wechselnde Positionen mit etwas Abstand zum Spieler. Sie soll weder permanent direkt über dessen Kopf stehen noch fortwährend von einem Rand des Bereichs zum anderen rasen. Geeignete Gegnerbereiche beeinflussen die Wahl der Patrouillenpunkte; eine komplexe Deckungs- oder Schusslinien-KI ist nicht erforderlich.

Patrouillenziele bleiben kurzzeitig bestehen. Kleine Bewegungen des Besitzers lösen nicht sofort eine vollständige Neuplanung aus. Bei mehreren Drohnen desselben Besitzers sind unterschiedliche Patrouillenpunkte sinnvoll, ohne hierfür eine aufwendige Schwarm-KI vorauszusetzen.

### 3.2 Drei Fluggeschwindigkeiten

| Flugmodus | Basisgeschwindigkeit | Zweck |
|---|---:|---|
| Patrouillenflug | **160 px/s** | Ruhige Bewegung innerhalb des Aufenthaltsbereichs. |
| Angriffsflug | **400 px/s** | Bewegter Geschützangriff und gerader Bombenüberflug. |
| Reiseflug | **700 px/s** | Start, Stationsrückkehr und Anschluss an den Besitzer. |

R1 erhöht alle drei Geschwindigkeiten um **15 % des jeweiligen Basiswerts je Stufe**. Die Stufen sind additiv, nicht miteinander multipliziert:

| R1-Stufe | Multiplikator | Patrouille | Angriff | Reise |
|---|---:|---:|---:|---:|
| 0 | 1,00 | 160 px/s | 400 px/s | 700 px/s |
| 1 | 1,15 | 184 px/s | 460 px/s | 805 px/s |
| 2 | 1,30 | 208 px/s | 520 px/s | 910 px/s |
| 3 | 1,45 | 232 px/s | 580 px/s | 1.015 px/s |

Die Patrouille bleibt relativ langsamer. R1 verändert weder Projektilgeschwindigkeit noch Schussrate, Magazin, Bombenanzahl oder Cooldown. Auch bei schnelleren Angriffen wird die Schussrichtung unabhängig vom Flugvektor nachgeführt; ein kurzer Richtungswechsel des Fliegers darf nicht den gesamten Feuerfächer vom Ziel wegreißen.

Entfernt sich der Spieler deutlich, wechselt die Drohne in den schnelleren Anschlussflug. Sie soll nicht wegen ihrer absichtlich langsamen Patrouille dauerhaft hinter einem mobilen Inspektor zurückbleiben. Bereits gestartete kurze Angriffe können abgeschlossen werden; danach orientiert sie sich wieder am Besitzer. Es gibt keine unbegrenzte Verfolgung fliehender Gegner.

### 3.3 Konkrete Patrouillen- und Anschlusswerte

Neue Patrouillenpunkte liegen bevorzugt **160–360 px** vom Besitzer entfernt, innerhalb des weichen 400-px-Bereichs. Die Drohne fliegt nicht zwingend diese Mindestentfernung an, wenn sie gerade startet oder einen Angriff beendet.

| Verhalten | V2-Startwert |
|---|---:|
| Zeit zwischen regulären Patrouillen-Neuplanungen | **2 s**, leicht variiert zwischen **1,5 und 2,5 s** |
| Abstand, ab dem schneller Anschlussflug beginnt | **450 px** zum Besitzer |
| Abstand, bei dem wieder Patrouille möglich ist | **320 px** zum Besitzer |
| Zielbewertung bei freier Drohne | Höchstens alle **250 ms** |
| Normaler Aufenthaltsbereich | **400 px** zum Besitzer |
| Maximaler geplanter Randbereich eines kurzen Angriffs | **600 px** zum Besitzer |

Die 450/320-px-Schwellen verhindern ständiges Umschalten am Rand. Ein bereits laufender kurzer Angriff darf den normalen Bereich vorübergehend verlassen. Außerhalb des 600-px-Angriffsbereichs beginnt kein neuer Angriff; die Drohne holt den Besitzer ein. Schnelle Spielerbewegungen oder ein Dash erzwingen keinen Positionssprung der Drohne.

### 3.4 Hindernisse und Reichweite

Die Drohne fliegt ohne Kollision über Felsen, Türme und andere Bodenhindernisse. Auch Wasser und vergleichbare Bodenflächen erfordern für ihre Flugbewegung keine Wegsuche. Weltgrenzen und die Regeln für gültige Kampfziele bleiben bestehen.

Ihr Bordgeschütz hat ungefähr **400 px Reichweite ab der Drohne beziehungsweise Geschossmündung**. Der Aufenthaltsradius und die Waffenreichweite sind unterschiedliche Größen: Am Rand ihres Bereichs kann die Drohne im Extrem bis ungefähr 800 px vom Besitzer entfernte Ziele erreichen. Diese Reichweite ist kein Auftrag, solche Ziele außerhalb des Begleitbereichs zu verfolgen.

**Luftbeschuss überwindet Bodenhindernisse bereits ohne Upgrade.** Felsen und freundliche Konstrukte fangen die Bordgeschosse nicht ab. Feindliche Basen bleiben dagegen gültige Trefferziele und stoppen Bordgeschosse auch mit Durchschussmunition.

Die freie Flugbahn der Drohne hebt die Bodenregeln späterer Brandbrocken nicht auf: Sobald ein Bombeneffekt am Boden entstanden ist, gelten für dessen Landepunkte und Feuerflächen die vorhandenen Bodenfeuerregeln.

## 4. Bordgeschütz

### 4.1 Ausgangswerte des Bordgeschützes

| Eigenschaft | Basiswert |
|---|---:|
| Reichweite ab der Geschossmündung | **400 px** |
| Schussrate während eines Feuerstoßes | **20 Schuss/s** |
| Schussintervall | **50 ms** |
| Schaden je Geschoss | **1,4** |
| Feuerstoßdauer | **1,5 s** |
| Schüsse je vollständigem Feuerstoß | **30** |
| Reguläre Feuerpause | **1 s** |
| Maximales Magazin | **180 Schuss**, also sechs volle Feuerstöße |
| Projektilgeschwindigkeit | **1.200 px/s** |
| Projektil-Trefferbreite | **6 px**; keine versteckte Flächenexplosion |
| Mündungsversatz | **18 px** ab Drohnenzentrum |
| Fächerschwenk bei mehreren Zielgegnern | **16° gesamt: −8° bis +8°** |
| Fächerschwenk bei genau einem Ziel | **8° gesamt: −4° bis +4°** |
| Maximale Nachführung der zentralen Angriffsrichtung | **60°/s** während des Feuerstoßes |
| Zufallsstreuung / zusätzliche Bewegungsstreuung | **0° / 0°** |
| Abpraller, Treffer-Knockback, intrinsischer Krit-Bonus | **0** |
| Eigener Adrenalingewinn durch Drohnenschüsse | **0** |
| Eigener Schadens-Upgrade-Knoten | **Keiner** |

Jeder vollständige Feuerstoß schwenkt genau einmal von links nach rechts. Der engere 8°-Fächer gegen ein einzelnes Ziel ist eine V2-Balancingpräzisierung: Es bleibt derselbe sichtbare Schwenkangriff, aber nicht fast die gesamte Munition geht zwangsläufig an einem kleinen Einzelziel vorbei. Bei mehreren Zielen wird die größere Fläche bestrichen. Der Winkel wird vor dem Feuerstoß gewählt und nicht pro Geschoss zwischen beiden Werten umgeschaltet.

Die Fächerform entsteht ausdrücklich durch **Schwenken**, nicht durch zufällige Streuung in einem statischen Kegel. Jeder Schuss behält nach dem Abschuss seine Richtung. Die 30 Schüsse liegen innerhalb des 1,5-s-Zeitfensters; an dessen Endgrenze wird kein versehentlicher 31. Schuss erzeugt.

1,4 Schaden bleibt intern eine Nachkommastellenzahl und wird nicht vor der regulären Schadensverarbeitung pauschal auf 1 oder 2 gerundet. Die angegebenen 6 px sind die Trefferbreite, nicht nur die Grafikgröße.

### 4.2 Zielwahl und Ausrichtung

Das Geschütz bevorzugt gut treffbare Gegnergruppen. Sind keine geeigneten Gruppen vorhanden, sind einzelne Gegner oder feindliche Basen zulässige Ziele.

Vor einem Feuerstoß bestimmt die Drohne eine sinnvolle zentrale Angriffsrichtung. Sie schwenkt ihre Schüsse anschließend über den gewählten Bereich. Die zentrale Ausrichtung darf moderat nachgeführt werden; sie soll nicht mit jedem Einzelschuss auf ein anderes Ziel springen. Währenddessen darf die Drohne einen kurzen Angriffslauf fliegen.

Zwischen Feuerstößen wird das Ziel neu bewertet. Eine neue, besonders günstige Bombengelegenheit unterbricht nicht jeden laufenden Feuerstoß; sie erhält an der nächsten sinnvollen Angriffsgrenze Priorität.

### 4.3 Munition und Teilmagazine

Munition wird pro tatsächlich abgegebenem Schuss verbraucht, auch bei Fehlschüssen. Flug und Leerlauf verbrauchen keine Bordmunition. Bei 20 Schuss/s, 1,5 s je Feuerstoß und sechs Feuerstößen ergibt sich das Magazin zu **180 Schuss**. Ein vollständiger Feuerstoß verbraucht **30 Schuss**.

Als Ausarbeitungsregel darf ein bereits möglicher Feuerstoß mit Restmunition kürzer ausfallen, sobald das Magazin leer wird. Danach soll die Drohne aber nicht mit jedem einzelnen regenerierten Geschoss sofort einen winzigen neuen Feuerstoß beginnen. Sie sammelt entweder wieder Munition für einen normalen Feuerstoß, fliegt zur Station oder nutzt einen passenden Bombenangriff.

Der Zustand „Bordmunition erschöpft“ wird bei der Angriffsentscheidung berücksichtigt. Eine unmittelbar danach regenerierte Kleinstmenge darf einen bereits sinnvoll ausgewählten Bombenangriff nicht ständig wieder verhindern. Nach dem Leerfeuern gilt **30 Schuss** als Wiedereinstiegsschwelle für einen neuen normalen Feuerstoß. Vorhandene Restmunition darf beim ursprünglich begonnenen Angriff weiterhin aufgebraucht werden.

Wird nach dem letzten Feuerstoß zurückgeflogen, kann die normale Feuerpause bereits während dieses Flugs ablaufen. Sie wird nicht als zusätzliche Wartezeit vor dem Abflug aufgeschlagen.

## 5. Selbstlader, Stationsversorgung und Rückkehrentscheidung

### 5.1 Selbstlader: langsame Regeneration außerhalb des Geschützfeuers

L1 regeneriert Bordmunition, solange das Bordgeschütz nicht feuert. Dazu gehören Feuerpausen, Patrouille, Reise und ein Bombenlauf. Während eines tatsächlichen Geschützfeuerstoßes findet keine Regeneration statt.

| L1-Stufe | Regeneration pro Sekunde ohne Geschützfeuer |
|---|---:|
| 0 | 0 % des maximalen Magazins |
| 1 | 1 % des maximalen Magazins |
| 2 | 2 % des maximalen Magazins |
| 3 | 3 % des maximalen Magazins |

Die Werte sind Gesamtwerte der jeweiligen Stufe, keine kumulative Summe von 1 + 2 + 3 %. Bei 180 Schuss Magazin entspricht das **1,8 / 3,6 / 5,4 Schuss je Sekunde ohne Geschützfeuer**. Das Magazin kann nicht überfüllt werden; Bruchteile einer Munitionseinheit werden intern gesammelt.

Da ein voller Feuerstoß ein Sechstel des Magazins benötigt, ersetzt die reguläre einsekündige Pause selbst auf L1/3 nur einen kleinen Teil der verbrauchten Munition. Bei leerem Magazin entspricht die reine Regenerationszeit für einen vollen Feuerstoß ungefähr 16,7 / 8,3 / 5,6 Sekunden. Reise- oder Bombenphasen können einen Teil dieser Zeit ohnehin abdecken.

### 5.2 Ladegeschwindigkeit: ausschließlich Station

Die normale Stationsversorgung dauert **2,5 Sekunden** und stellt das Bordmagazin wieder vollständig her. L2 verkürzt diese Versorgung.

L2 verbessert ausdrücklich **nicht** den Selbstlader, die reguläre Feuerpause, die Schussrate oder den Bomben-Cooldown. So bleiben der verlängerte Außeneinsatz durch L1 und der schnellere Versorgungsumlauf durch L2 zwei unterschiedliche Verbesserungen.

Die Stationsversorgung ist ein eigener Vorgang, nicht eine mit L1 zusätzlich beschleunigte Nachladung. Sie füllt am Ende vollständig auf, auch wenn beim Andocken noch Restmunition vorhanden ist. Während des regulären Rückflugs darf L1 weiterhin arbeiten.

L2 reduziert die **Basisversorgungsdauer um 20 Prozentpunkte je Stufe**:

| L2-Stufe | Verkürzung gegenüber Basis | Stationsversorgung |
|---|---:|---:|
| 0 | 0 % | **2,5 s** |
| 1 | 20 % | **2,0 s** |
| 2 | 40 % | **1,5 s** |
| 3 | 60 % | **1,0 s** |

Formel: `Versorgungsdauer = 2,5 s × (1 − 0,20 × L2-Stufe)`. Dies sind Dauerreduktionen, nicht 20/40/60 % mehr Geschwindigkeit mit einer anderen Umrechnung.

### 5.3 Effizienzentscheidung

Die Drohne entscheidet autonom, ob Regeneration vor Ort oder ein Stationsbesuch mehr nutzbare Geschützangriffe ermöglicht. Ein bloßer Test „Magazin nicht voll → zurück“ reicht nicht aus.

**Konkrete Startwerte:** **12 s Prognosefenster**, **500 ms Mindestabstand** zwischen freien Neubewertungen und **ein zusätzlicher vollständiger Feuerstoß** als Vorteilsschwelle für eine stationsbedingte Unterbrechung. Neubewertung erfolgt außerdem nach dem Ende eines Feuerstoßes oder Bombenlaufs, nicht mitten im Angriff.

Solange mindestens ein vollständiger Feuerstoß verfügbar ist und Ziele vorhanden sind, bleibt die Drohne zunächst im Einsatz. Bei weniger als 30 Schuss nach einem Angriff vergleicht sie zwei kurze Prognosen:

| Variante | In die Prognose einzurechnen |
|---|---|
| Bleiben | Restmunition; L1-Regeneration ausschließlich außerhalb des Geschützfeuers; 30-Schuss-Feuerstöße mit 1,5 s Dauer und 1 s Mindestpause. |
| Station | Tatsächliche Flugdistanz von der Drohne zur Station; Rückweg zum lokalen Besitzerbereich; aktuelle R1-Reisegeschwindigkeit; L2-Versorgungsdauer; anschließend volles 180-Schuss-Magazin und derselbe Feuerstoßrhythmus. |

Es zählen vollständige, innerhalb des gemeinsamen 12-s-Fensters mögliche Feuerstöße. Liefert die Stationsvariante mindestens **einen vollen Feuerstoß mehr**, wird zurückgeflogen. Bei Gleichstand wird der weniger unterbrechende Außeneinsatz bevorzugt. Ohne L1 und ohne genügend Restmunition zur Fortsetzung ist der Stationsbesuch der notwendige Nachschubweg, selbst wenn er länger als zwölf Sekunden dauert.

Als Reisekosten werden beide **tatsächlichen** Wege verwendet. `2 × Stationsabstand / Reisegeschwindigkeit` ist nur eine vereinfachte Rechnung für stationäre Testaufbauten, nicht die allgemeine Spielregel.

Bei fehlenden Zielen wird mit L1 normalerweise ruhig patrouilliert und regeneriert; ohne L1 wird ein nicht volles Magazin an der Station ergänzt. Kurze Kampfpausen sollen mit dem Selbstlader nicht unnötig zu Versorgungsflügen führen.

**Bomben sind keine Stationsressource.** Der Stationsbesuch füllt keine Bombenmunition und beschleunigt ihren Cooldown nicht. Verfügbare Bombenangriffe nach Abschnitt 6 erhalten vor einer Abflugentscheidung Priorität. Für Bomben mit höchstens einer Sekunde Rest-Cooldown gilt die dortige Aufschubregel. Eine ansonsten ohnehin gewählte L1-Wartephase darf natürlich ebenfalls in einen später bereit werdenden Bombenangriff übergehen.

Während eines begonnenen normalen Stationsflugs wird wegen kleiner Prognoseänderungen nicht umgedreht. Nach einem noch vorgeschalteten Bombenlauf wird dagegen ausdrücklich neu entschieden. Damit bleibt der Ablauf verständlich, ohne perfekte Zukunftsvorhersage, globale Routenoptimierung oder zusätzliche Spielerbedienung.

## 6. Bossupgrade: Bombenschacht

### 6.1 Grundfunktion und Cooldown

Der Bombenschacht schaltet einen separaten automatischen Angriff frei: Die Drohne überfliegt einen geeigneten Korridor und wirft nacheinander mehrere kleine Bomben ab. Es entstehen viele kleinere, zeitversetzte Explosionen statt einer einzelnen großen Detonation.

| Eigenschaft | Regel |
|---|---|
| Grundanzahl | 6 Bomben je vollständigem Überflug |
| Schaden je Bombe | **6 im Zentrum / 2 am Rand**, linearer Abfall |
| Explosionsradius | **48 px** |
| Zusätzlicher Direkttrefferschaden | **0**; kein doppelter Schaden aus Aufprall plus Explosion |
| Explosions-Knockback | **0** |
| Fallzeit ab Abwurf | **250 ms** |
| Geplante Teppichlänge / -breite der Einschlagzentren | **320 / 80 px** |
| Bombenmunition | Keine |
| Cooldown | 10 s |
| Start des Cooldowns | Nach dem letzten Bombenabwurf des Angriffs |
| Erster Einsatz | Sofort bereit |
| Cooldown während Rückflug und Versorgung | Läuft normal weiter |
| Einfluss von L1 oder L2 | Keiner auf Bombenbereitschaft oder Cooldown |
| Bordgeschütz während des Überflugs | Pausiert |
| Selbstlader während des Überflugs | Arbeitet, sofern freigeschaltet |

Bereite Bomben werden nicht gestapelt. Ein langer Leerlauf erzeugt keine zusätzlichen gespeicherten Bombenteppiche. Der Cooldown bleibt bereit, bis tatsächlich ein Angriff stattfindet.

### 6.2 Wenige oder viele Ziele

Die Entscheidung richtet sich nach den **im erreichbaren Angriffskorridor sinnvoll erfassbaren Zielen**, nicht nach der Gesamtzahl irgendwo auf der Karte.

| Situation | Verhalten |
|---|---|
| Wenige Ziele, Bordmunition noch nutzbar | Zuerst mit dem Bordgeschütz angreifen, auch wenn Bomben bereit sind. |
| Wenige Ziele, Bordmunition erschöpft, Ziele überleben | Bomben einsetzen, sobald sie bereit sind; auch ein einzelnes verbliebenes gültiges Ziel reicht. |
| Viele Ziele in einem sinnvollen Korridor, Bomben bereit | Bomben direkt bevorzugen, auch bei vollem Bordmagazin. |
| Viele Ziele, Bomben noch im Cooldown | Verfügbares Bordgeschütz weiter verwenden; nicht grundsätzlich auf Bomben warten. |
| Kein gültiges Ziel | Keine Bomben verschwenden; Patrouille beziehungsweise Versorgung. |

Die Grenze für „viele“ liegt in V2 bei **vier verschiedenen gültigen Zielen im selben erreichbaren Abwurfkorridor**. Jede feindliche Basis und jeder Boss zählt für diese Mengenschwelle genau einmal, nicht als künstliche Mehrfachgruppe. Ein Ziel zählt, wenn seine tatsächliche Trefferfläche den geplanten Einschlagbereich berührt.

Für die Auswahl zwischen mehreren guten Korridoren gelten einfache Gewichte: normaler Gegner **1**, Elitegegner **2**, Bossgegner oder feindliche Basis **3**. Diese Gewichte betreffen nur die Korridorqualität; sie ändern die Vier-Ziele-Schwelle nicht. Gegen einzelne Ziele gilt weiterhin die Geschütz-zuerst-Regel.

### 6.3 Rückflug höchstens eine Sekunde für fast bereite Bomben aufschieben

Steht ein sinnvoller Rückflug zur Station an, prüft die Drohne zuvor, ob ein geeigneter Bombenangriff unmittelbar möglich wird.

Ist ein solcher Angriff nach der Zielpriorität sinnvoll und beträgt die verbleibende Cooldown-Zeit **höchstens 1 Sekunde**, wird er noch durchgeführt. Der Anflug auf den Angriffskorridor darf bereits während dieser Restzeit beginnen. Abgeworfen wird erst nach tatsächlicher Bereitschaft.

Die Sekunde begrenzt das zusätzliche Warten auf den Cooldown, nicht die physische Dauer von Anflug und Bombenlauf. Lange Umwege zu weit entfernten Zielen sind damit nicht beabsichtigt. Bei mehr als einer Sekunde Rest-Cooldown wird ein ansonsten sinnvoller Stationsflug nicht allein wegen der kommenden Bombenbereitschaft aufgeschoben.

Die Entscheidung wird nicht durch ständig neue Wartefenster verlängert. Nach dem Bombenlauf wird jedoch **neu bewertet**, ob die Rückkehr noch effizient ist: Hat L1 währenddessen genug Bordmunition regeneriert, darf die Drohne weiterkämpfen.

### 6.4 Auswahl und Ablauf des Korridors

Die Drohne vergleicht einige einfache mögliche Überfluglinien innerhalb ihres lokalen Einsatzbereichs. Gute Linien erfassen viele Gegner und gegebenenfalls feindliche Basen. Zielgröße und räumliche Verteilung dürfen die Bewertung beeinflussen; eine global optimale Route ist nicht nötig.

Nach Auswahl wird ein weitgehend gerader Überflug ausgeführt. Der Teppich folgt dieser Linie, nicht hektisch wechselnden Einzelzielen. Sind vor dem ersten Abwurf keine gültigen Ziele mehr vorhanden, darf der Angriff abgebrochen und neu geplant werden. Ein bereits begonnener Bombenteppich wird im normalen Betrieb zu Ende abgeworfen.

Die Einschlagzentren werden auf einer **320 px langen und 80 px breiten** Fläche verteilt. Die 80 px beschreiben die Breite der Verteilung, nicht einen zusätzlichen Explosionsradius. Mit 48 px Einzelradius ergibt sich eine maximale äußere Wirkfläche von ungefähr **416 × 176 px**, ohne dass der gesamte Außenbereich überall gleich viel Schaden erhält.

Längs werden die Einschläge gleichmäßig über die Strecke verteilt; seitlich werden beide Hälften der 80-px-Fläche ausgewogen belegt. Höhere Bombenzahlen verdichten dieselbe Fläche. Die Mitte eines geplanten Teppichs liegt im normalen 400-px-Besitzerbereich; seine Enden dürfen für den kurzen Überflug in den begrenzten Angriffsrandbereich hineinreichen. Es werden keine weit entfernten Bombenziele quer über die Karte verfolgt.

Zwischen erstem und letztem Abwurf liegen bei Grundgeschwindigkeit **320 / 400 = 0,8 s**. Mit R1/3 sind es ungefähr **0,552 s**. Für sechs Bomben beträgt der Längsabstand **64 px**, für zwölf ungefähr **29,1 px**. Der Abwurf ist an die Wegposition gekoppelt, nicht an einen festen Timer, der bei höherer Fluggeschwindigkeit den Teppich verlängern würde. Die 250-ms-Fallzeit verlängert nicht die Strecke der Einschlagzentren; die Planung berücksichtigt die Flugbewegung bei der Darstellung.

Der zehnsekündige Cooldown beginnt erst mit dem letzten Abwurf. Selbst ohne zusätzlichen Anflug liegt der minimale Abstand zweier vollständiger Angriffsbeginn-Zeitpunkte deshalb bei **10,8 s**, mit R1/3 bei ungefähr **10,552 s**. R1 verkürzt dabei ausschließlich die Überflugzeit, nicht den Cooldown selbst.

Jede Bombe ist ein eigener Schaden verursachender Angriff. Ein großes Ziel kann mehrere Explosionen desselben Teppichs abbekommen; es gibt keinen zusätzlichen versteckten Ein-Treffer-pro-Teppich-Deckel. Die niedrigen sechs Maximalschaden je Bombe berücksichtigen dieses Verhalten.

Bordgeschosse, Bomben und Brandbrocken beschädigen regulär gültige Gegner beziehungsweise mit ihren Explosionen feindliche Basen. **Fels- und Zugschadensmultiplikatoren sind für diese Drohnenangriffe zunächst 0**, ebenso Selbst- und Verbündetenschaden im vorgesehenen Koop-Einsatz. Die Drohne soll Gegner bekämpfen und nicht unbeabsichtigt die Karte abtragen oder das Zugziel beschädigen. Unverwundbare oder noch nicht freigegebene Missionsziele bleiben geschützt.

Es besteht keine besondere pauschale Basis-Schadensverstärkung: Für eine gültige feindliche Basis gilt zunächst **1,0 ×** der normale Angriffsschaden. Ihre große Trefferfläche kann bereits mehrere Bomben aufnehmen.

## 7. Finaler Upgrade-Baum

```text
L1 Selbstlader (3)                       R1 Fluggeschwindigkeit (3)
        │ mindestens Stufe 1                     │ mindestens Stufe 1
        ▼                                        ▼
L2 Ladegeschwindigkeit (3)               R2 Durchschussmunition (3)
        │ mindestens Stufe 1                     │ mindestens Stufe 1
        └─────────────────────┬──────────────────┘
                              │ BEIDE Voraussetzungen
                              ▼
                     ★ Boss: Bombenschacht (1)
                              │
                  ┌───────────┴────────────┐
                  ▼                        ▼
       BL1 Anzahl Bomben (3)     BR1 Brandbrockenbomben (3)
```

L2 setzt mindestens L1/1 voraus. R2 setzt mindestens R1/1 voraus. Der Bossknoten benötigt **L2/1 UND R2/1**. BL1 und BR1 benötigen jeweils nur den Bossknoten und sind untereinander unabhängig. Kein Vorgänger muss vollständig ausgebaut sein.

### Upgrade-Übersicht

| Position | Name | Stufen | Wirkung | Voraussetzung |
|---|---|---:|---|---|
| L1 | Selbstlader | 3 | 1 / 2 / 3 % des maximalen Bordmagazins pro Sekunde ohne Geschützfeuer | Konstrukt verfügbar |
| L2 | Ladegeschwindigkeit | 3 | Stationsversorgung **2,0 / 1,5 / 1,0 s**; kein Einfluss auf L1 oder Bomben-Cooldown | L1 mindestens Stufe 1 |
| R1 | Fluggeschwindigkeit | 3 | Alle Fluggeschwindigkeiten **+15 / +30 / +45 %** | Konstrukt verfügbar |
| R2 | Durchschussmunition | 3 | Pro Stufe einen zusätzlichen Gegner durchschlagen; kein Schadensverlust | R1 mindestens Stufe 1 |
| Boss | Bombenschacht | 1 | Bombenteppich mit 6 Bomben und 10 s Cooldown | L2 und R2 jeweils mindestens Stufe 1 |
| BL1 | Anzahl Bomben | 3 | +2 Bomben pro Stufe; insgesamt 8 / 10 / 12 | Boss |
| BR1 | Brandbrockenbomben | 3 | Jede Bombe erzeugt nach ihrer Explosion 1 / 2 / 3 Brandbrocken | Boss |

Ein normales Schadensupgrade ist nicht Bestandteil dieses Baums. Bereits vorhandene allgemeine Konstrukt- oder Itemmodifikatoren werden bei der späteren Integration nach den Projektregeln behandelt; daraus entsteht kein zusätzlicher Drohnenknoten.

## 8. Durchschussmunition im Detail

Jede Stufe wirkt auf **alle Bordgeschosse**. Sie erhöht die Zahl zusätzlicher Gegner, die ein Geschoss nach dem ersten Treffer noch treffen kann.

| R2-Stufe | Zusätzliche Gegner | Maximal getroffene Gegner je Geschoss |
|---|---:|---:|
| 0 | 0 | 1 |
| 1 | 1 | 2 |
| 2 | 2 | 3 |
| 3 | 3 | 4 |

Alle gültigen Treffer besitzen denselben ursprünglichen Geschossschaden; es gibt keinen Durchschuss-Schadensverlust. Dasselbe Geschoss trifft denselben Gegner nicht mehrfach. Es erhält keine zusätzliche Reichweite und keine Aufspaltung in weitere Geschosse.

Felsen und freundliche Konstrukte verbrauchen keine Durchschüsse, weil sie für den Luftbeschuss ohnehin keine Trefferhindernisse sind. **Eine getroffene feindliche Basis erleidet Schaden und stoppt das Geschoss.** Die Zahl verbleibender Gegner-Durchschüsse ändert daran nichts.

Das Upgrade verändert weder Bomben noch Brandbrocken.

## 9. Post-Boss-Upgrades und Brandbrocken

### 9.1 BL1 – Anzahl Bomben

Ausgehend von sechs Bomben erhöht jede Stufe die Anzahl um zwei: **8 / 10 / 12**.

Länge und Breite des Teppichs bleiben gleich. Die Einschläge werden dichter, der Schaden der einzelnen Bombe bleibt durch diesen Knoten unverändert. Der Bomben-Cooldown bleibt bei zehn Sekunden nach dem letzten Abwurf.

### 9.2 BR1 – Brandbrockenbomben

Jede detonierte Bombe erzeugt **1 / 2 / 3 Brandbrocken**, abhängig von BR1. Die Brandbrocken entstehen nach der jeweiligen Bombenexplosion, fliegen zu lokalen Landepunkten und wirken zeitversetzt.

Für die in der Abstimmung gewünschte grundsätzliche Wirkung wie beim Raketenwerfer wird das dortige Profil übernommen: **kleine Landungsexplosion plus Bodenfeuer**, jedoch mit eigenen Drohnenwerten. Dies ist eine Konkretisierung der vereinbarten Referenz, keine Übernahme des gesamten Raketenwerfer-Upgradesystems. Die Rocket-GDD beschreibt diese Kombination; das vorhandene gemeinsame Brandbrocken-System unterstützt unter anderem verzögerte Landungen und optionale Landungsexplosionen. [S1, S2]

Es werden keine ausgerüsteten Raketenwerfer-Upgrades übernommen: keine Raketenmagazinlogik, keine raketenspezifische Distanzskalierung, keine Explosive Medizin, kein Druckschild und keine zusätzliche Brandbrockenzahl aus dem Raketenwerferbaum.

Die Effektfolge bleibt begrenzt:

**Bombe → Bombenexplosion → Brandbrocken → lokale Landungswirkung und Bodenfeuer.**

Brandbrocken und Landungsexplosionen erzeugen keine weiteren Bomben oder Brandbrocken. Gültige Landepunkte, Bodenkollisionen und überlappende Feuerzellen verwenden die gemeinsamen Regeln; das Flugprivileg der Drohne bedeutet nicht, dass Bodenfeuer in Felsen oder auf ungültigen Flächen entstehen darf.

Für die Drohne gelten folgende eigene Brandbrockenwerte:

| Eigenschaft | V2-Startwert |
|---|---:|
| Brocken je detonierter Bombe | **1 / 2 / 3**, entsprechend BR1 |
| Suchradius um die jeweilige Bombenexplosion | **60 px** |
| Flugzeit bis zum Rand des Suchradius | **320 ms** |
| Flugzeit bei kürzerer Strecke | Proportional zur Strecke, wie im gemeinsamen System |
| Radius der Landungsexplosion | **24 px** |
| Landungsschaden im Zentrum / am Rand | **1,5 / 0,5**, linearer Abfall |
| Landungs-Knockback | **0** |
| Dauer der erzeugten Bodenfeuerzelle | **2 s** |
| Brandstatusdauer je neuem Brandtreffer | **1 s** |
| Brandschaden pro Tick und Brandstapel | **0,2** |
| Brand-Tickintervall | **250 ms**, gemeinsamer Spielwert |
| Zusätzliche garantierte Zündung am Bombenzentrum | **Nein** |
| Weitere Brandbrocken aus Landung oder Bodenbrand | **Keine** |

Ein einzelner aktiver Brandstapel entspricht damit nominell **0,8 Schaden/s**. Das ist ausdrücklich **nicht** der gesamte Schaden einer Feuerfläche: Im bestehenden System erzeugen wiederholte Brandtreffer zusätzliche Stapel. Kontaktverhalten, Flächenüberlappung und Brandstapel werden weiterhin vom gemeinsamen System verarbeitet; V2 führt keinen zweiten Stapelmechanismus und keinen versteckten zusätzlichen Stapelbonus ein. [S7]

Die Brandwerte sind bewusst zurückhaltender als das Raketenwerfer-Profil. Bei maximal 36 Brocken pro Teppich sollen sie die verzögerte Gefahrenfläche stärken, nicht den Geschütz- und Bombenschaden durch sehr hohe Stapelwerte verdrängen.

Die Flugprivilegien gelten nicht automatisch für diese vom Boden aus ausgestoßenen Brocken: Es werden nur gültige, nach den gemeinsamen Bodenregeln erreichbare Landepunkte verwendet. Gibt es lokal nicht genügend gültige Punkte, entstehen entsprechend weniger Brocken. Ohne zusätzliches Upgrade gibt es keine gezielte Zielsuchfunktion der Brocken.

Feindliche Basen können von den Landungsexplosionen getroffen werden. Es wird **kein neuer allgemeiner Brandstatus für Basen** eingeführt; deren bisherige Empfängerregeln bleiben maßgeblich.

### 9.3 Zusammenspiel der beiden Äste

Die beiden Post-Boss-Upgrades sind unabhängig freischaltbar, verstärken sich aber in ihrer Menge:

| Bomben pro Teppich | BR1/1: ein Brocken je Bombe | BR1/2: zwei Brocken je Bombe | BR1/3: drei Brocken je Bombe |
|---:|---:|---:|---:|
| 6 | 6 | 12 | 18 |
| 8 | 8 | 16 | 24 |
| 10 | 10 | 20 | 30 |
| 12 | 12 | 24 | 36 |

Voll ausgebaut entstehen damit **12 Bomben und bis zu 36 Brandbrocken je Überflug**, sofern genügend gültige Landepunkte vorhanden sind. Die tatsächliche Schadenswirkung hängt von Treffern, Überlappung und bestehenden Bodenfeuerregeln ab; sie ist nicht automatisch proportional zur gesamten Effektanzahl.

## 10. Entscheidungsbeispiele

### Kleine Gruppe, volles Magazin, Bomben bereit

Die Drohne nutzt zunächst schwenkende Geschützfeuerstöße. Die bloße Bombenbereitschaft verdrängt das Geschütz nicht. Stirbt die Gruppe, bleiben die Bomben bereit.

### Ein zäher Gegner überlebt das leergeschossene Magazin

Der einzelne Gegner ist jetzt ein zulässiges Bombenziel. Sind die Bomben bereit, folgt ein Bombenlauf. Danach bewertet die Drohne anhand der inzwischen regenerierten Munition und des Stationswegs neu, ob sie bleiben oder zurückkehren soll.

### Große Gruppe, volles Magazin, Bomben bereit

Die Drohne beginnt zum nächsten sinnvollen Angriffszeitpunkt direkt mit dem Bombenlauf. Das Geschütz pausiert; danach kann sie ihre weiterhin vorhandene Bordmunition einsetzen.

### Magazin leer, Bomben in 0,8 Sekunden bereit

Bei geeignetem Ziel wird der Rückflug aufgeschoben. Die Drohne kann den Anflug bereits beginnen, wirft erst bei Bereitschaft ab und entscheidet danach erneut über die Versorgung.

### Magazin leer, Bomben in 1,5 Sekunden bereit

Ein ansonsten effizienter Stationsflug wird nicht allein für die Bomben verschoben. Ist Warten wegen des Selbstladers ohnehin die bessere Wahl, darf die Drohne aus diesem unabhängigen Grund im Einsatzbereich bleiben.

### Station weit entfernt, hoher Selbstlader

Ein langer Hin- und Rückflug kann weniger sinnvoll sein als Regeneration vor Ort. Die Drohne darf bleiben, später wieder Geschützfeuerstöße abgeben und fällige Bombenangriffe nutzen. Kontinuierliches Geschütz-Dauerfeuer entsteht dadurch nicht.

## 11. Darstellung, Multiplayer und technische Leitplanken

Dies ist kein Implementierungsplan. Für die spätere Umsetzung sind jedoch einige Gameplay-Grenzen wichtig.

Die Drohne braucht eine eigene visuelle Identität gegenüber der vorhandenen Reparaturdrohne. Schatten beziehungsweise Höhenversatz sollen ihren Flug über Hindernisse verständlich machen. Patrouille, schneller Angriff und Stationsrückkehr müssen sich durch Bewegung und kurze, klare Effekte unterscheiden. Nicht jeder Munitions- oder Cooldown-Schritt benötigt eine zusätzliche HUD-Zeile.

Viele kleine Bombenexplosionen sollen als zusammenhängender Teppich lesbar sein, ohne pro Teilereignis starken Bildschirmwackler oder identisch laute Vollpegel-Sounds auszulösen. Bei zwölf Bomben und bis zu 36 Brandbrocken pro Drohne müssen auch mehrere gleichzeitige Stationen berücksichtigt werden.

Simulation und Darstellung werden getrennt. Zielwahl, tatsächliche Schüsse, Bombenbereitschaft, Abwürfe und Schaden benötigen eine gemeinsame autoritative Grundlage; Clients stellen den synchronisierten Ablauf dar und berechnen nicht unabhängig eigene Treffer. Ziel- und Korridorsuchen erfolgen lokal und an sinnvollen Entscheidungspunkten, nicht als globale Vollsuche je Drohne und Frame.

Die vorhandenen Brandbrocken- und Bodenfeuermechaniken sollen wiederverwendet werden. Die geprüfte Implementierung bietet dafür einen `FireChunkBurstPort` und verarbeitet verzögerte Landungen mit konfigurierbaren Wirkungen. [S2] Ein eigener zweiter Brandbrocken-Simulator für die Drohne ist nicht Teil des Konzepts.

Drohnen werden ihrer **Station und ihrem Besitzer** zugeordnet. Eine reine Verwaltung „eine Drohne pro Spieler“ würde dem gewünschten Mehrstationsbetrieb nicht entsprechen. Schaden und Folgeeffekte brauchen eine eindeutige Zuordnung zum verantwortlichen Spieler und zur ursprünglichen Drohnenattacke.

## 12. Zentrale V2-Balancingübersicht

Diese Übersicht bündelt die neuen Startwerte. Die zugehörigen Verhaltensregeln stehen in den vorherigen Abschnitten.

| Bereich | Festgelegter Startwert |
|---|---|
| Station | **30 Kapazität, 200 HP, 1 Zelle, 350 px Platzierung, 100 ms Bau-Cooldown** |
| Geschütz | **20 Schuss/s, 1,4 Schaden, 400 px Reichweite, 1.200 px/s Projektilgeschwindigkeit, 6 px Trefferbreite** |
| Feuerstoß / Magazin | **1,5 s / 30 Schuss, 1 s Pause, 180 Schuss Magazin** |
| Fächer | **16° bei mehreren Zielen / 8° bei einem Ziel**, jeweils ein Links-rechts-Schwenk |
| Flug | **160 / 400 / 700 px/s** für Patrouille / Angriff / Reise |
| R1 | **+15 / +30 / +45 %** für alle Flugphasen |
| L1 | **1 / 2 / 3 % Magazin je Sekunde ohne Geschützfeuer** |
| Stationsversorgung / L2 | **2,5 s Basis → 2,0 / 1,5 / 1,0 s** |
| R2 | **1 / 2 / 3 zusätzliche Gegner**, ohne Schadensverlust |
| Bombenschacht | **6 Bomben, 10 s Cooldown nach letztem Abwurf, kein Munitionsvorrat** |
| Einzelbombe | **6–2 Schaden, 48 px Radius, 250 ms Fallzeit, kein Knockback** |
| Teppich | **320 × 80 px Einschlagverteilung**, bei Basisgeschwindigkeit 0,8 s vom ersten bis letzten Abwurf |
| BL1 | **8 / 10 / 12 Bomben** auf unveränderter Teppichfläche |
| Viele Ziele | **Mindestens 4 verschiedene Ziele im Korridor** |
| Bombenbedingter Rückflugaufschub | **Höchstens 1 s Rest-Cooldown**, danach Bombenlauf und neue Versorgungsbewertung |
| BR1 | **1 / 2 / 3 Brocken je Bombe**, bis zu 36 je Teppich |
| Brandbrocken | **60 px Suchradius, maximal 320 ms Flugzeit, 24 px Landungsradius, 1,5–0,5 Landungsschaden** |
| Bodenbrand | **2 s Bodenfeuer, 1 s Brandstatus je Treffer, 0,2 Schaden pro Stapel und 250-ms-Tick** |
| Versorgungsprognose | **12 s**, Neubewertung frühestens nach **500 ms**; Rückflug bei mindestens **einem zusätzlichen vollen Feuerstoß** |

## 13. Rechnerische Balance und Begründung

### 13.1 Vergleichsmaßstab: gleiche Kapazität, gleiche Ausbaustufe

Die Drohne wird zunächst **ohne Upgrades, Items und externe Verstärkungen** gegen stationäre Grundkonstrukte eingeordnet. Schadensvergleiche nutzen ideale Trefferbedingungen, bevor Rüstung, Schadensreduktion, Zieldrehung, Überkill und Projektilverluste wirken. Es handelt sich um **rechnerische Rohwerte, nicht gemessene Schießstand-DPS**.

| Referenz | Kapazität | Rechnerisches Grund-Schadensbudget |
|---|---:|---:|
| Ein MG-Turm | 10 | `2 / 0,275` = **7,27 Schaden/s** |
| Drei MG-Türme | 30 | **21,82 Schaden/s** insgesamt |
| Ein Raketenturm | 30 | Bis zu `(2 × (3 + 14)) / (1,8 + 0,12)` = **17,71 Schaden/s** gegen ein ideal getroffenes Ziel |

Der MG-Resolver verwendet zwei Basisschaden und 275 ms Schussintervall. Der Raketenturm schießt zwei Raketen im Abstand von 120 ms, jeweils mit drei Direktschaden und bis zu 14 Explosionsschaden. Sein 1.800-ms-Cooldown beginnt **nach dem letzten Salvenschuss**. Daher beträgt der ideale Salvenzyklus 1,92 s, nicht 1,8 s. Das Maximum von 14 ist ein Explosions-Zentrumswert; reale Einschläge und andere Gegner im Explosionsradius können weniger Schaden erhalten. [S4–S6]

Bei Gegnergruppen besitzt der Raketenturm zusätzlich seinen Flächenschaden. Die Tabelle ist deshalb weder eine vollständige AoE-Wertung noch eine Aussage, dass reale Rocket- und MG-Treffer identisch zuverlässig wären.

### 13.2 Grunddrohne: Feuerstoß und kompletter Versorgungsumlauf

Bei voller Trefferverwertung ergibt sich:

```text
Schaden während des Feuerstoßes = 20 × 1,4 = 28 Schaden/s
Schaden pro vollständigem Feuerstoß = 30 × 1,4 = 42
Schadensbudget eines Magazins = 180 × 1,4 = 252

Geschützrhythmus ohne Versorgung = 42 / (1,5 + 1,0)
                                = 16,8 Schaden/s
```

Der hohe momentane Feuerstoßschaden ist beabsichtigt: Der Angriff soll sich schnell und offensiv anfühlen. Seine Feuerpause und Versorgung senken die durchschnittliche Leistung.

Ohne Selbstlader werden sechs volle Feuerstöße abgegeben. Das sind neun Sekunden Feuer plus fünf Sekunden Zwischenpausen. Nach dem letzten Feuerstoß startet der Stationsflug; die letzte normale Pause läuft während der Unterbrechung mit.

Für einen vereinfachten Test mit konstantem Abstand `d` zwischen Station und Einsatzposition:

```text
Zyklusdauer = 6 × 1,5 s + 5 × 1 s + 2,5 s + 2 × d / 700 px/s
Drohnen-Schadensbudget pro Sekunde = 252 / Zyklusdauer
```

| Einfache Stationsdistanz | Ideale Zyklusdauer | Drohne: Rohschaden/s | Abstand zur 17,71-Rocket-Referenz |
|---:|---:|---:|---:|
| 200 px | 17,07 s | **14,76** | **16,6 % niedriger** |
| 400 px | 17,64 s | **14,28** | **19,3 % niedriger** |
| 600 px | 18,21 s | **13,84** | **21,9 % niedriger** |
| 800 px | 18,79 s | **13,41** | **24,2 % niedriger** |
| 1.200 px | 19,93 s | **12,65** | **28,6 % niedriger** |

Damit liegt die Grunddrohne bei einem kurzen bis mittleren Versorgungsweg von 400–800 px ungefähr **20–25 % unter dem nominellen Einzelschadensmaximum des Raketenturms**. Gegen drei MG-Türme liegt sie in diesem Bereich ungefähr **35–39 % niedriger**. Das ist bewusst keine Forderung, unter allen Umständen denselben prozentualen Abstand zu jeder stationären Waffe zu besitzen.

Der Fächerschwenk verteilt Schaden. Nicht alle 30 Schüsse treffen zwangsläufig denselben Gegner; besonders kleine bewegliche Einzelziele senken die tatsächliche Ausbeute. Umgekehrt kann der Fächer mehrere Gegner treffen. Die 8°-Einzelzielvariante und die hohe Projektilgeschwindigkeit begrenzen unnötige Fehlschüsse. Der verbleibende Unterschied muss in Spieltests kontrolliert werden.

### 13.3 Einfluss von Selbstlader, Flug- und Ladegeschwindigkeit

L1 ersetzt während einer einsekündigen Normalpause **1,8 / 3,6 / 5,4 Schuss**, während der vorherige Feuerstoß 30 verbraucht hat. Selbst auf Stufe drei werden nur **18 % eines Feuerstoßes** in der Standardpause ersetzt. Dauerfeuer ohne Versorgungs- oder längere Regenerationsphasen entsteht dadurch nicht.

R1 und L2 verkürzen die Versorgungslücke. Sie erhöhen den Schaden pro Geschoss, die Schussrate und das Magazin nicht. Die regulären Geschützfeuerpausen bleiben auch nach vollständigem Ausbau bestehen. Bei entfernten Stationen darf L1 stattdessen langsameres stationenunabhängiges Weiterkämpfen ermöglichen; das ist die gewünschte Alternative, kein unbegrenzt schießender Begleiter.

### 13.4 Bomben- und Brandbrockenbudget

Sechs Bomben besitzen zusammen **36**, zwölf Bomben **72** nominalen Maximalschaden, wenn jeweils ihr Explosionszentrum getroffen würde. Das ist die Summe einzelner Explosionswerte, nicht automatisch der Schaden an einem Gegner. Ein Teppich verteilt seine Bomben räumlich; mehrere Gegner können jeweils mehrere Explosionen erhalten.

Bei ideal sofort aneinander anschließenden Angriffsmöglichkeiten und Grund-Fluggeschwindigkeit ergeben sich rein für die Bomben `36 / 10,8 = 3,33` beziehungsweise `72 / 10,8 = 6,67` Schaden/s **unter der künstlichen Annahme, dass ein einzelnes großes Ziel alle Bombenzentren aufnimmt**. Reale Werte hängen stark von Zielgröße, Lage und Ausweichbewegung ab. Die niedrig angesetzten sechs Schaden pro Bombe vermeiden eine unbemerkte Vervielfachung durch zwölf Treffer auf große Basen.

Auf BL1/3 und BR1/3 kommen höchstens **36 × 1,5 = 54** nominelle Maximal-Landungsschadenspunkte aus Brandbrocken hinzu, ebenfalls räumlich verteilt und ohne rekursive Auslösung. Bodenbrand wird wegen seiner Kontakt- und Stapelregeln nicht als fixer pauschaler DPS-Zuschlag behauptet.

**Diese Teilbudgets dürfen nicht einfach auf den unveränderten Geschütz-Dauerschaden addiert werden.** Bombenanflug und Überflug pausieren das Bordgeschütz, verändern die Regenerationszeit und verschieben Stationsbesuche. Eine kombinierte Schadensmessung muss den vollständigen tatsächlichen Ablauf erfassen.

### 13.5 Grenzen der Zielsetzung

„Etwas weniger Schaden als stationäre Türme“ bedeutet hier: geringerer durchschnittlicher Schaden einer mobilen Lösung bei gleicher Kapazität und vergleichbarem Ausbau, insbesondere im normalen Verteidigungsvergleich. Es bedeutet **nicht**, dass eine voll ausgebaute Drohne mit Bossupgrade nie mehr Schaden verursachen darf als ein unaufgerüsteter stationärer Turm.

R2 soll gegen günstig aufgereihte Gegner stark sein. Bomben sollen dichte Gruppen treffen. Die mobile Drohne darf außerdem in Szenarien führen, in denen stationäre Türme das Kampfgebiet gar nicht mehr erreichen. Diese Vorteile sind ihre Rolle. Ein genereller Gleichstand bei idealer stationärer Verteidigung wäre dagegen nicht das Balanceziel.

## 14. Spieltest-Prüfpunkte und erste Korrekturhebel

Die Zahlen sind vollständig genug für einen ersten Prototyp. Das rechnerische Budget ersetzt keine Tests der tatsächlichen Zielwahl, Fächertreffer, Bombenüberlappung und Brandkontakte.

| Test | Aufbau / gewünschte Beobachtung |
|---|---|
| Grundschaden | Mindestens **60 s** gegen ein stationäres, ausreichend robustes Testziel; Drohne ohne Upgrades bei **400 und 800 px Stationsdistanz**, daneben Raketenturm und drei MG-Türme mit gleichen allgemeinen Modifikatoren. Zyklusgrenzen und Testdauer mitprotokollieren. |
| Einzelzieltreffer | Kleiner und großer Gegner, stillstehend und beweglich, jeweils **200 und 400 px Waffenabstand**. Prüfen, dass der 8°-Schwenk nicht überwiegend vorbeischießt. |
| Gruppe und Durchschuss | Gruppen von **2, 4 und 8** Gegnern; dicht, verteilt und in Reihe. Prüfen, dass ein Geschoss höchstens **1/2/3/4 verschiedene Gegner** trifft und nie mehrfach denselben. |
| Bombenpriorität | Kleine Gruppe erst mit Bordgeschütz; ab vier Zielen Bomben priorisieren; ein überlebendes Einzelziel nach leerem Magazin bombardieren. |
| Rückkehrregel | Leeres Magazin bei **0,8 s** beziehungsweise **1,2 s** Bomben-Rest-Cooldown. Nur im ersten Fall den sonst sinnvollen Rückflug bombenbedingt aufschieben. |
| Langstrecke und L1 | Station zunächst **800**, dann **2.400 px** entfernt; L1-Stufen vergleichen. Die Entscheidung soll anhand realer Flugwege sinnvoll wechseln, ohne Pendeln oder Einzelschuss-Tröpfeln. |
| Post-Boss | BL1 und BR1 einzeln sowie gemeinsam testen; Bomben, Brocken, Bodenbrand und Geschützschaden getrennt ausweisen. Mit stationären Lösungen vergleichbarer Upgrade-Investition vergleichen. |
| Mehrere Stationen | **Drei voll ausgebaute Drohnen** desselben Besitzers; zusätzlich Mehrspieler-Maximalfall. Pro drei synchronen Bombenläufen entstehen bis zu **36 Bomben und 108 Brocken**. Keine versteckten zusätzlichen Drohnen, Effektkaskaden oder ungebremsten globalen Suchläufe. |

Falls die Grunddrohne **zu schwach** wirkt, zuerst Trefferquote, Zielwechsel, unnötige Reisewege und verpasste Feuerstöße prüfen. Nicht sofort die 30 Kapazität oder den Munitionszyklus abschaffen. Erst danach den Geschossschaden in kleinen Schritten von **0,1** verändern.

Falls die **voll ausgebaute Flächenwirkung zu stark** ist, zuerst Bomben- und insbesondere Brandbrockenschaden sowie die tatsächliche Brandkontakt-Überlappung prüfen. Der normale Geschützangriff muss nicht pauschal geschwächt werden, nur weil ein Post-Boss-Effekt zu viel beiträgt.

Falls die Drohne gegen schnelle bewegliche Einzelziele unbrauchbar wird, zuerst den Einzelzielfächer und die zulässige Nachführung überprüfen. Das gute mobile Spielgefühl hat Vorrang vor einem nur auf dem Papier passenden DPS-Wert.

Verschieben-, Rückbau- und Neubau-Sonderregeln bleiben ausdrücklich außerhalb dieser Version. Entsprechende bekannte Umgehungsmöglichkeiten werden für reguläre Balancemessungen nicht ausgenutzt; es wird kein zusätzlicher Schutzmechanismus stillschweigend ergänzt.

## 15. Quellen des Repository-Abgleichs

Die Gameplay-Entscheidungen dieses Konzepts beruhen auf der gemeinsamen Abstimmung. Repository-Bezüge dienen der Einordnung vorhandener Effekte und der stationären Balance-Referenzen. Sie bedeuten nicht, dass die Angriffsdrohne bereits implementiert ist. Die V2-Drohnenwerte sind neu vorgeschlagene Basiswerte, nicht aus dem Repository ausgelesene bestehende Drohnenwerte.

**Geprüfter Stand:** `Dominik-Steinweg/Fragdachse`, `main`, Commit `f2f88a13925b3f97e7e103758f0c2f6a44af52be`.

**[S1]** `docs/GDDs/FRAGDACHSE_Rocket_Launcher_Upgrade_GDD_v2.md`, insbesondere Abschnitte 7–10: gemeinsame Brandbrockenmechanik, verzögerte Landung, Bodenbrand und kleine zusätzliche Landungsexplosionen. Die Rocket-spezifischen Zahlen werden nicht automatisch als Drohnenwerte übernommen.

**[S2]** `src/systems/FlamethrowerUpgradeSystem.ts`, insbesondere `FireChunkBurstPort`, `PendingFireChunkLanding` und `launchFireChunks`: konfigurierbare generische Brandbrockenerzeugung, gültige Landepunkte, Flugzeiten und optionale Landungsexplosionen.


**[S3]** `src/config/coopDefenseConstructions.ts`: Inspektor-Grundkapazität 100, MG-Kosten 10, Rocket-Kosten 30, Zielreichweiten, Lebenspunkte und 350-px-Interaktionsreichweite.

**[S4]** `src/config/mgTurret.json`, `src/config/mgTurretRules.ts` und `src/config/mgTurret.ts`: MG-Basisschaden 2, Basiscooldown 275 ms und Verwendung dieser Werte durch den MG-Statresolver.

**[S5]** `src/loadout/content/data/weapons-rockets.json`, Eintrag `TURRET_ROCKET_BURST`: zwei Raketen, 120-ms-Salvenintervall, 1.800-ms-Cooldown, drei Direktschaden und 14/2 Explosionsschaden bei 95 px Radius.

**[S6]** `src/systems/TurretSystem.ts`, insbesondere Verarbeitung von `pendingBursts` und `nextFireAt`: Beginn des normalen Salven-Cooldowns nach dem letzten Zusatzschuss; daraus idealer Rocket-Salvenabstand 1,92 s.

**[S7]** `src/config.ts`, `src/combat/rules/BurnStateMachine.ts` sowie `src/combat/CombatBurnStatusOwner.ts`: 250-ms-Brandtakt, zusätzliche Brandstapel durch Brandtreffer und Empfängergrenzen des allgemeinen Brandstatus. Die 0,2 Schaden und eine Sekunde Statusdauer sind eigene V2-Drohnenwerte, nicht unveränderte Rocket-Werte.

**[S8]** `src/config/coopDefenseConstructions.json`: 100-ms-Bau-Cooldowns der bestehenden Konstrukte.

## 16. Änderungsprotokoll V1 → V2

V2 setzt die Station auf **30 Baukapazität und 200 HP**, ergänzt die vollständigen Geschütz-, Flug-, Versorgungs-, Bomben- und Brandbrockenwerte und konkretisiert Gruppen- und Rückkehrentscheidungen. Neu präzisiert sind außerdem der engere Fächerschwenk gegen ein Einzelziel und der begrenzte Randbereich kurzer Angriffe.

Unverändert bleiben der Upgrade-Baum mit Mindeststufe eins je Vorgänger, L2 ohne Einfluss auf Selbstlader oder Bomben, Durchschüsse ohne Schadensverlust, der reine Bomben-Cooldown, die 1-s-Aufschubregel, Geschütz-zuerst bei wenigen Zielen und die unabhängigen Post-Boss-Äste BL1 und BR1. Es gibt weiterhin kein eigenes Schadensupgrade und keine besonderen Rückbau- oder Verschieberegeln.
