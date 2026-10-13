# Fragdachse Inspector Gadachs Feuerleit Utilitys GDD V1

**Version:** 1.0

**Stand:** 13. Oktober 2026

**Klasse:** Inspector Gadachs

**Geltungsbereich:** Gameplay und Progression für Coop-Defense

**Status:** Abgestimmtes Gameplay-Konzept; konkrete Balancewerte und ausdrücklich benannte Detailentscheidungen sind offen. Die beschriebenen neuen Regeln sind Soll-Verhalten und keine Aussage über eine bereits erfolgte Implementierung.

Inspector Gadachs erhält zwei Utilities, mit denen seine gebauten Türme entfernte Kämpfe unterstützen: Das **Feuerleit-Relais** erzeugt vorübergehende Turmkopien am Einsatzort. Die **Feuerleitgranate** bündelt das Feuer aktiver eigener Türme durch kurzzeitig geöffnete Portale. Kopien können ebenfalls an der Portalunterstützung teilnehmen.

Zusätzlich lernen Türme grundsätzlich, geeignete feindliche Basen selbstständig anzugreifen. Diese Erweiterung gilt auch ohne eine der beiden Utilities. Das Relais ersetzt die HE-Granate als anfänglich freigeschaltete und ausgerüstete Utility des Inspektors.

## 1 Zielbild und Umfang

Die Klassenstärke des Inspektors hängt an vorbereiteten Konstruktionen. Bei der Basisverteidigung ist diese Stärke gut verfügbar, bei entfernten Missionsaufgaben bislang deutlich weniger. Die neuen Utilities machen die vorhandene Turminvestition an einem anderen Ort nutzbar. Turmwahl, Aufbau und Upgrades bleiben bestimmend für die Unterstützung.

| Merkmal | Feuerleit-Relais | Feuerleitgranate |
|---|---|---|
| Wirkung | Temporäre Kopien ausgewählter eigener Türme | Beschuss durch Eingänge vor aktiven eigenen Türmen und einen gemeinsamen Ausgang |
| Einsatzdauer | Länger bestehende Unterstützung | Kürzeres Zeitfenster für konzentrierte Unterstützung |
| Anzahl der Feuerquellen | Durch Kopienzahl begrenzt und ausbaubar | Alle geeigneten aktiven eigenen Turm-Feuerquellen einschließlich Kopien |
| Originale in der Grundversion | Ausgewählte Originale pausieren | Angeschlossene Türme richten ihr Feuer auf Ziele am Ausgang |
| Spitzenupgrade | Original und Kopie können gleichzeitig kämpfen | Lokales Feuer, wenn am Ausgang kein geeignetes Ziel verfügbar ist |
| Einstieg | Startutility anstelle der HE-Granate | Spätere Freischaltung; Zeitpunkt und Kosten offen |

Beide Fähigkeiten verfolgen bewusst dasselbe Gameplay-Ziel. Ihre Ähnlichkeit ist gewollt. Unterschiedliche Dauer, Kopienzahl und Bündelung geben ihnen eigene Einsatzmöglichkeiten, ohne künstlich getrennte Rollen zu erzwingen.

**Zum Umfang gehören:** allgemeine Turmzielwahl gegen feindliche Basen, beide Utilities, deren Upgrades, gemeinsame Nutzung, Startausrüstung sowie die dafür notwendigen Darstellungs- und Mehrspielerregeln.

**Außerhalb dieser Version liegen:** das Ultimate „Festung auf Beinen“, ein Umbau des Tesla-Turms, zusätzliche allgemeine Bewegungs- oder Transport-Upgrades und eine automatische Erweiterung auf andere Klassen oder Spielmodi.

## 2 Gemeinsame Turmregeln

### 2.1 Feindliche Basen als reguläre Ziele

Geeignete Türme können feindliche Basen selbstständig auswählen und angreifen. Ein vorgeschobener Turmaufbau kann dadurch auch ohne Utility eine feindliche Basis zerstören.

Die automatische Zielpriorität lautet:

1. Ein ausdrücklich gesetztes, gültiges Fokusziel.
2. Geeignete feindliche Figuren in Reichweite.
3. Eine erreichbare feindliche Basis, gegen die die Waffe wirksam ist.

Reichweite, Zielberechtigung und freie Schusslinie bleiben bei jeder Priorität verbindlich. Für Basen wird ein erreichbarer Punkt ihrer tatsächlichen Außenfläche verwendet. Ein weit entfernter oder verdeckter Mittelpunkt darf einen möglichen Angriff auf eine nahe Außenwand nicht verhindern.

Die Eignung richtet sich nach dem gesamten Angriff: direkter Schaden, Explosion und sonstige wirksame Waffenanteile. Eine Prüfung allein auf den direkten Projektilschaden reicht nicht aus. Kontrolltürme sollen keine Basen beschießen, auf die ihre Wirkung keinen Einfluss hat.

Originale, Relais-Kopien und Portalbeschuss verwenden dieselben fachlichen Zielregeln. Beim Portalbeschuss ändern sich lediglich der Ort der Zielsuche und die zu prüfenden Schussabschnitte.

### 2.2 Geeignete Quellen der Utilities

Beide Utilities beziehen sich auf eigene, bestehende und kampffähige Türme. Verbündete Türme anderer Spieler, feindliche Türme und der Basis selbst gehörende Geschütze werden nicht automatisch übernommen. Ein eigener Turm auf einer Basis bleibt eine eigene Konstruktion, sofern seine reguläre Kampfberechtigung besteht.

| Quelle | Relais | Feuerleitgranate |
|---|---|---|
| Eigener Raketen-, MG- oder Flammenturm | Als Original auswählbar | Als aktive Feuerquelle geeignet |
| Eigener Gravitations- oder Zeitblasenturm | Als Original auswählbar | Als aktive Feuerquelle geeignet; schadenfreie Kontrolle bleibt schadenfrei |
| Eigener Sporenturm einschließlich seiner geeigneten Waffenvariante | Als Original auswählbar | Als aktive Feuerquelle geeignet |
| Tesla-Turm | In V1 ausgeschlossen | In V1 ausgeschlossen |
| Relais-Kopie eines geeigneten Turms | Keine Quelle weiterer Kopien | Als aktive Feuerquelle geeignet |
| Angriffsdrohne und ihre Station | Nicht kopierbar | Keine Teilnehmer dieser Utility |
| Podeste, Barrieren und Wachtürme | Keine Turmprojektion | Keine Teilnehmer dieser Utility |

Der Tesla-Ausschluss gilt für den heutigen Feldwaffenaufbau. Eine spätere Umstellung kann Anlass für eine gesonderte Erweiterung sein.

## 3 Feuerleit-Relais

### 3.1 Aktivierung und Wirkung

Der Inspektor wirft ein Relais an den gewünschten Einsatzort. Dort entstehen für eine begrenzte Zeit Kopien ausgewählter eigener Türme. Die Grundversion unterstützt **eine Kopie**. Ein Upgrade erhöht die gleichzeitig mögliche Kopienzahl.

Die Kopien bekämpfen selbstständig geeignete Ziele in ihrer jeweiligen Reichweite. Ihre Bewaffnung, dauerhaften Turm-Upgrades und regulären Waffenwirkungen stammen vom zugeordneten Original. Sie erhalten keine zusätzliche universelle Waffe.

Die Auswahl muss vor der Aktivierung nachvollziehbar sein. Insbesondere darf der Spieler bei einer einzelnen Kopie nicht mit einer zufälligen Auswahl rechnen müssen. Die konkrete Bedienung für eine Prioritätenliste oder Quellenauswahl ist noch festzulegen.

Fehlt ein geeignetes Original, wird die Nutzung mit einem verständlichen Hinweis abgewiesen und verbraucht keinen Einsatz. Für mehrere Kopien gilt die verfügbare Zahl geeigneter Originale als zusätzliche Obergrenze.

### 3.2 Kopien und Originale

Jede Kopie bleibt an genau ein Original gebunden. Ohne Parallelbetrieb pausiert dieses Original während der Projektion. Es bleibt physisch vorhanden und verwundbar; das Relais entfernt oder versetzt es nicht.

Kopien sind temporäre, durchlässige Kampfprojektionen. Sie belegen keine zusätzliche Baukapazität, blockieren keine Wege, werden nicht als dauerhafte Basisbauten gespeichert und lassen sich nicht abbauen, reparieren oder bemannen. Das Relais erzeugt keine weiteren Angriffsziele allein durch kopierte Gebäudekörper.

Wird ein Original zerstört, abgebaut oder verliert es seine reguläre Kampfberechtigung, endet die zugehörige Projektion. Eine Kopie kann keine weiteren Relais-Kopien erzeugen. Wiederholte Aktivierungen dürfen keine unbegrenzte Vervielfachung desselben Originals ermöglichen.

Pausieren, Übertragen und Wiederaufnehmen setzen Nachladezeiten oder bereits verbrauchte Angriffe nicht zurück. Die Grundversion darf durch einen Wechsel zwischen Original und Kopie keine kostenlose zusätzliche Salve erzeugen. Die konkrete Zuordnung noch laufender Salven beim Aktivieren des Relais ist in der Detailplanung festzulegen.

### 3.3 Parallelbetrieb

Das Spitzenupgrade **Parallelbetrieb** lässt ausgewählte Originale während ihrer Projektion weiterkämpfen. Original und Kopie besitzen dann jeweils eine aktive Feuerfolge mit der regulären Feuerrate des Turms.

Die zusätzliche Feuerleistung ist die beabsichtigte Wirkung dieses Upgrades. Sie kann sowohl an zwei Orten als auch konzentriert an einem Ort genutzt werden. Die Kopien bleiben zeitlich begrenzt und an ihre Originale gebunden.

### 3.4 Upgradepfad

| Knoten | Wirkung | Festlegungsstand |
|---|---|---|
| Grundfreischaltung | Eine temporäre Turmkopie | Zum Start des Inspektors verfügbar |
| Mehr Verbindungen | Erhöht die maximale Kopienzahl | Wirkung festgelegt; Stufenzahl und Zuwachs offen |
| Parallelbetrieb | Originale kämpfen während der Projektion weiter | Spitzenupgrade; Kosten und Voraussetzungen offen |
| Längere Übertragung | Verlängert die Kopienlaufzeit | Ergänzungsoption aus dem Brainstorming; Aufnahme und Werte noch offen |

## 4 Feuerleitgranate

### 4.1 Zeitfenster und Teilnehmer

Die Granate öffnet am Einsatzort einen festen Portalausgang. Die Verbindung besteht für eine kurze Periode und ermöglicht währenddessen wiederholten Beschuss mit normalen Feuerraten und Salven. Sie endet nicht nach einem einzelnen Schuss.

Die Öffnungsdauer ist kürzer als die Laufzeit des Relais. Die konkrete Abstimmung beider Progressionen erfolgt beim Tuning.

Während der Laufzeit können alle geeigneten aktiven eigenen Turm-Feuerquellen teilnehmen. Dazu gehören Originale und Relais-Kopien. Die Teilnahme wird während des Einsatzes aktualisiert: Eine neu entstandene Kopie kann hinzukommen; eine entfernte Quelle verliert ihren Eingang. Die Reihenfolge der beiden Utility-Aktivierungen entscheidet nicht über ihre Kombinierbarkeit.

Ein durch das Relais pausiertes Original bleibt pausiert. Die Feuerleitgranate hebt diese Pause nicht auf.

### 4.2 Zielsuche am Ausgang

Jeder teilnehmende Turm sucht vom Ausgang aus nach geeigneten Zielen. Die Reichweite richtet sich nach diesem Turm und seinen wirksamen Upgrades. Ein Flammenturm muss deshalb näher an seinem Ziel liegen als ein Raketenturm, auch wenn beide denselben Portalausgang verwenden.

Freie Schusslinien werden auf den tatsächlichen Abschnitten geprüft: von der Mündung zum Eingang sowie vom Ausgang zum Ziel. Eine Wand irgendwo auf der übersprungenen Strecke zwischen Basis und Einsatzort blockiert den Portaltransport nicht. Hindernisse am Ein- oder Ausgang bleiben relevant.

Der Portalsprung verbraucht keine Waffenreichweite. Real geflogene Strecken vor und nach dem Sprung unterliegen weiterhin den Waffenregeln; Reichweite und Lebensdauer werden durch einen Transport nicht erneuert.

Ohne Boss-Upgrade wartet eine angeschlossene Quelle, wenn sie am Ausgang kein geeignetes Ziel hat. Sie wechselt in dieser Grundversion nicht selbstständig zu lokalem Feuer.

### 4.3 Mündungsportal und Schusswinkel

Der **Ort des Ausgangs bleibt fest**. Die Schussrichtung wird für jede Quelle aus Ausgang und ausgewähltem Ziel bestimmt. Das Quellportal wird sehr nah vor der Mündung angelegt und folgt der Ausrichtung des Turmrohrs.

Der Ablauf pro Quelle ist:

1. Ein geeignetes Ziel vom Portalausgang aus bestimmen.
2. Die Richtung vom Ausgang zum Ziel berechnen.
3. Das Turmrohr mit seiner normalen Drehgeschwindigkeit in diese Richtung führen.
4. Den Eingang passend vor der Mündung positionieren.
5. Bei erfüllter Zielausrichtung und Feuerbereitschaft schießen.
6. Das Geschoss am Ausgang mit derselben Flugrichtung weiterfliegen lassen.

**Beispiel:** Steht ein Gegner östlich vom Ausgang, richtet sich das Rohr nach Osten aus. Der Eingang liegt unmittelbar östlich der Turmmündung. Das Geschoss tritt am festen Ausgang nach Osten aus, unabhängig davon, wo das Original auf der Karte steht.

Es ist keine zusätzliche Drehung oder Spiegelung der Flugrichtung beim Transport vorgesehen. Vorhandene Drehgeschwindigkeiten und Zieltoleranzen bleiben wirksam. Ein weit versetztes Ziel darf nicht zu einem sofortigen, kostenlosen Richtungswechsel führen.

Mehrere Türme können gleichzeitig in verschiedene Richtungen aus demselben Ausgang schießen. Dessen Darstellung muss deshalb einen Austritt in alle Richtungen vermitteln und darf keine feste einseitige Schussöffnung suggerieren.

### 4.4 Zulässiger Transport

Ein Feuerleit-Eingang akzeptiert ausschließlich die für diesen Eingang bestimmten Schüsse seiner zugeordneten Turm-Feuerquelle. Der gemeinsame Besitzer allein genügt nicht als Transportberechtigung. Auch Angriffsdrohnen oder andere eigene Waffen werden dadurch nicht versehentlich Teilnehmer.

Die Verbindung ist ausschließlich vom Turm zum gemeinsamen Ausgang nutzbar. Spieler, Gegner und fremde Geschosse werden nicht transportiert. Der Ausgang nimmt keine Reisenden auf und leitet Geschosse nicht zurück zu den Türmen.

Mehrere Eingänge bilden einen gemeinsamen Einsatz. Ein austretendes Geschoss darf nicht sofort in eine andere Verbindung dieses Einsatzes eintreten. Ein Portal wird nicht durch bloße Nähe zu einem fremden Projektil zu dessen Transportweg.

### 4.5 Boss-Upgrade für lokales Feuer

Das Boss-Upgrade erlaubt die automatische Rückkehr zu lokalen Zielen, wenn **für den jeweiligen Turm** am Ausgang kein geeignetes Ziel verfügbar ist.

| Situation der Quelle | Verhalten mit Boss-Upgrade |
|---|---|
| Geeignetes Ziel am Ausgang vorhanden | Portalbeschuss hat Vorrang |
| Am Ausgang kein erreichbares oder frei beschießbares Ziel | Eingang deaktivieren und lokal nach regulären Regeln kämpfen |
| Weder entfernt noch lokal ein geeignetes Ziel | Warten |
| Wieder ein geeignetes Ziel am Ausgang vorhanden | Nach laufender Salve und erforderlicher Drehung zum Portalbeschuss zurückkehren |

Fehlende Feuerbereitschaft durch Nachladen oder eine noch laufende Drehung bedeutet nicht, dass ein Ziel ungeeignet ist. Daraus entsteht kein zusätzlicher lokaler Angriff.

Eine begonnene Salve bleibt auf demselben Weg, solange die Verbindung gültig ist. Der Wechsel zwischen lokalem und entferntem Feuer setzt Nachladezeiten nicht zurück. Pro Quelle besteht weiterhin eine Feuerfolge; das Upgrade erzeugt keine gleichzeitige zweite lokale Feuerfolge.

Lokal abgegebene Schüsse bleiben lokal, auch wenn sich kurz darauf wieder ein Mündungsportal öffnet. Der gewählte Weg eines Schusses muss deshalb eindeutig bleiben.

### 4.6 Upgrades und Schaden

| Knoten | Wirkung | Festlegungsstand |
|---|---|---|
| Grundfreischaltung | Temporäres Portalfeuer aller geeigneten aktiven eigenen Quellen | Freischaltungszeitpunkt und Kosten offen |
| Längere Öffnung | Erhöht die Öffnungsdauer | Wirkung festgelegt; Stufen und Werte offen |
| Verstärkter Durchschuss | Erhöht den Schaden der durch diesen Einsatz transportierten Schüsse | Wirkung festgelegt; Stufen und Werte offen |
| Lokale Feuerfreigabe | Erlaubt lokales Feuer, wenn am Ausgang kein geeignetes Ziel verfügbar ist | Boss-Upgrade; Voraussetzungen und Kosten offen |

Die Knotennamen sind Arbeitstitel. Der Schadensbonus wird je Geschoss höchstens einmal für denselben Feuerleit-Einsatz erworben, unabhängig von der Zahl seiner Eingänge. Bereits enthaltene Beiträge bleiben bei Folgeeffekten erhalten und werden nicht erneut aufmultipliziert.

Der Bonus betrifft schadentragende Anteile wie direkten Treffer, Explosion und zugehörigen Brand. Er erhöht nicht automatisch Radius, Reichweite, Zugkraft, Verlangsamung, Effektlaufzeit oder Reparatur. Schadenfreie Gravitations- und Zeitblaseneffekte bleiben schadenfrei.

Für Schüsse, die anschließend ein gewöhnliches Translocator-Portal passieren, bleiben dessen eigene Regeln maßgeblich. Eine Änderung der allgemeinen Portalbonus-Stacking-Regel gehört nicht zu diesem Entwurf; die Kombination ist beim Balancing zu berücksichtigen.

## 5 Gemeinsame Nutzung und Verstärkungen

### 5.1 Relais und Feuerleitgranate

| Quelle während eines Relais-Einsatzes | Darf die Granate nutzen | Ergebnis |
|---|---|---|
| Nicht kopiertes, aktives Original | Ja | Portalfeuer; mit Granaten-Bossupgrade gegebenenfalls lokales Feuer |
| Pausiertes Original ohne Parallelbetrieb | Nein | Bleibt während der Projektion pausiert |
| Aktive Relais-Kopie | Ja | Eigener Eingang an der Kopie |
| Original mit Parallelbetrieb | Ja | Original und Kopie dürfen beide teilnehmen |
| Zerstörtes oder anderweitig nicht kampffähiges Original | Nein | Zugeordnete Projektion und ihre Verbindung enden |

Es gibt keine gegenseitige Sperre der beiden Utilities. Der Portalbeschuss nutzt die bereits vorhandenen aktiven Feuerquellen. Zusätzliche Feuerleistung entsteht durch den Relais-Parallelbetrieb und durch den ausdrücklich freigeschalteten Portalschadensbonus.

Auch eine Relais-Kopie kann mit dem Granaten-Bossupgrade lokal kämpfen: Ihr lokaler Ort ist ihre Position am Relais. Ein pausiertes Original erhält dadurch keine lokale Feuerfreigabe.

### 5.2 Upgrades und örtliche Buffs

Dauerhafte Turm-Upgrades folgen der Kopie. Örtliche Verstärkungsfelder werden an der Position der jeweils tatsächlich feuernden Quelle geprüft:

- Ein Original verwendet Verstärkungen an seinem Standort.
- Eine Relais-Kopie verwendet örtliche Verstärkungen an ihrem Projektionsort.
- Portaltransport allein verlegt die Quelle nicht an den Ausgang. Dortige Felder gelten nur, wenn ihre bestehenden Regeln ausdrücklich durchfliegende Geschosse beeinflussen.

Original- und Projektionsort dürfen denselben örtlichen Buff nicht doppelt auf einen Angriff anwenden. Identitätsgebundene Effekte, etwa besondere MG-Treffereigenschaften oder ein gezielt auf ein Konstrukt gesetzter Buff, benötigen eine ausdrückliche Zuordnung zwischen Original und Kopie. Die Details sind vor der Implementierung festzulegen; solche Effekte dürfen weder still entfallen noch unbeabsichtigt vervielfacht werden.

## 6 Einstieg und Bedienung

Das Feuerleit-Relais wird für Inspector Gadachs anfänglich freigeschaltet und ersetzt die HE-Granate in dessen Standardausrüstung. Der bereits anfänglich verfügbare Raketenturm bleibt der erste passende Partner. Das beabsichtigte Einstiegsverhalten ist: Turm bauen, einen entfernten Kampf aufsuchen, dessen Feuerkraft über das Relais einsetzen.

Beide Utilities werden über die vorhandene Utility-Auswahl verwendet. Das Zielen und Werfen orientiert sich an den vorhandenen Wurfwerkzeugen. Nach erfolgreicher Aktivierung erfolgt die Zielwahl autonom; einzelne Portalverbindungen benötigen keinen zusätzlichen Bedienknopf.

Die Anzeige soll vor der Aktivierung erkennen lassen, ob geeignete Quellen verfügbar sind und welche Kopien das Relais erzeugen würde. Während der Laufzeit sind aktive Verbindung, pausiertes Original, verbleibende Dauer und lokales Feuer unterscheidbar.

Die Startänderung ist klassenspezifisch. Für bestehende gespeicherte Inspektor-Profile sind kostenlose Relais-Freischaltung, belegte Utility-Slots und bereits bewusst gewählte Ausrüstung bei der Migration zu berücksichtigen. Ob die HE-Granate für den Inspektor später kostenpflichtig freischaltbar bleibt und wann sie in bestehenden Loadouts ersetzt wird, ist noch festzulegen.

## 7 Lebensdauer und Mehrspieler

Der Host entscheidet über gültige Aktivierungen, Quellenauswahl, Zielwahl, Pausen, Projektionen, Portaltransport, Schaden und Einsatzende. Clients zeigen den bestätigten Zustand. Ein nachträglich beitretender Spieler muss aktive Kopien und Verbindungen mit ihren verbleibenden Laufzeiten sehen können.

Temporäre Projektionen und Portale gehören zum laufenden Einsatz. Sie werden nicht als dauerhafte Konstruktionen gespeichert. Entfernte Quellen dürfen keine verwaisten Kopien, Eingänge oder dauerhaften Schusspausen zurücklassen. World-Wechsel und endgültiges Entfernen des Besitzers räumen seine Einsätze vollständig auf.

Bereits abgegebene Geschosse behalten ihre Herkunft und werden nach den regulären Geschossregeln weiterverarbeitet. Ein Einsatzende löscht nicht nachträglich bereits ausgetretene Geschosse oder erworbene Schadensbeiträge. Es erneuert auch keine Waffenbereitschaft. Die Behandlung noch nicht transportierter Schüsse beim Schließen des Portals sowie von Spielertod und Respawn ist als Detailentscheidung offen.

## 8 Darstellung und Lesbarkeit

Die Darstellung folgt der orthografischen 90°-Top-down-Perspektive und den [visuellen Projektregeln](../ai/visual-guidelines.md).

Relais-Kopien müssen als temporäre Projektionen erkennbar bleiben und ihre jeweilige Turmwaffe lesbar zeigen. Originale dürfen während ihrer Pause nicht durch Schussanimationen einen aktiven Angriff vortäuschen.

Mündungsportale sitzen sichtbar vor dem Rohr und folgen seiner Drehung. Bei lokalem Feuer ist der jeweilige Eingang deaktiviert. Der gemeinsame Ausgang zeigt den gebündelten Beschuss, ohne eine einzige feste Austrittsrichtung vorzugeben.

Die Feuerleit-Portale müssen von gewöhnlichen Translocator-Portalen unterscheidbar sein, damit Spieler keinen begehbaren Durchgang erwarten. Effekte, Geschossspuren und Audio dürfen keine Flugbahn quer über die übersprungene Kartenstrecke suggerieren. Viele gleichzeitige Quellen dürfen Ziele und Gefahren am Ausgang nicht verdecken.

## 9 Offene Detailentscheidungen und Tuning

Die Grundmechaniken der vorstehenden Abschnitte sind das Zielbild. Die folgenden Punkte dürfen bei der Umsetzung nicht als bereits beschlossene Zahlen oder stillschweigende Regeln behandelt werden.

| Punkt | Verbindlicher Rahmen | Noch festzulegen |
|---|---|---|
| Laufzeiten | Portalunterstützung kürzer als Relais-Kopien | Grundwerte und Verlauf über die Upgrades |
| Ressourcen und Cooldown | Nutzung als Utility; Kopien verbrauchen keine zusätzliche Baukapazität | Adrenalinkosten, Cooldown, dessen Startzeitpunkt und etwaige Ladungen |
| Gleichzeitige Einsätze | Beide Utility-Typen sind kombinierbar; keine unbegrenzten Kopienketten | Als einfache V1-Arbeitsannahme höchstens ein Relais und eine Feuerleitgranate je Spieler; Verhalten bei erneuter Nutzung |
| Relais-Quellenauswahl | Nachvollziehbar und auf geeignete Originale begrenzt | Prioritätenliste, Auswahloberfläche und Verhalten bei Ausfall einer Quelle |
| Kopienpositionen | Temporär und durchlässig am Einsatzort | Anordnung, Abstände, gültiger Untergrund und Verhalten bei Platzmangel |
| Verwundbarkeit des Relais | Originale bleiben verwundbar; Kopien sind keine zusätzlichen Gebäudekörper | Ob das Relais selbst zerstörbar ist und damit den gesamten Einsatz beendet |
| Salven und Feuerbereitschaft | Keine kostenlosen zusätzlichen Salven durch Zustandswechsel | Übergang beim Relais-Start und beim Ende einer Projektion, insbesondere mit Parallelbetrieb |
| Identitätsgebundene Effekte | Dauerhafte Waffen-Upgrades funktionieren auch an Kopien | MG-Trefferzustände, gezielte Konstrukteffekte, Fernsteuerungsbonus und Bemannungspriorität |
| Ungültiger Granatenwurf | Ein fehlender Gegner ist nicht automatisch ein ungültiger Einsatz | Verbrauch und Feedback bei fehlenden Quellen oder ungültigem Ausgangsort |
| Wurf und Platzierung | Vorhandene Wurfbedienung | Flugparameter, Auslösezeitpunkt, zulässige Landepunkte und Mündungsportal-Abstand |
| Ende und Tod | Kein Reset von Feuerbereitschaft; keine verwaisten Quellen | Spielertod, Respawn und noch nicht transportierte Geschosse beim Portalende |
| Progression | Relais zum Start, Granate später | Upgradepunkte, Stufen, Abhängigkeiten und Freischaltungsbedingungen |
| HE und bestehende Profile | Klassenspezifischer Wechsel der Startutility | Spätere HE-Verfügbarkeit und konkrete Migration bestehender Ausrüstungen |

Das Tuning muss die gemeinsame Wirkung von Kopienzahl, Parallelbetrieb, Öffnungsdauer und Portalschaden betrachten. Mehr Dauer bedeutet bereits mehr abgegebene Schüsse. Die Basiskopie muss mit dem anfänglichen Raketenturm einen nützlichen Außeneinsatz ermöglichen, ohne erst mehrere Pflichtupgrades zu verlangen.

Vergleichsszenarien sind Basisverteidigung, ein entferntes Missionsziel, ein Angriff auf eine feindliche Basis sowie beide Utilities gemeinsam. MG-, Raketen-, Flammen- und Kontrollturm-Aufbauten sind getrennt zu beurteilen. Belastungsprüfungen berücksichtigen mehrere Inspektoren mit vielen aktiven Quellen und maximaler zulässiger Überlagerung; konkrete Leistungsgrenzen werden erst anhand der Umsetzung bestimmt.

## 10 Abnahmeszenarien

Die folgenden Szenarien beschreiben langlebiges Verhalten. Zahlen werden erst nach Festlegung des Tunings ergänzt.

1. Ein gewöhnlicher Schadensturm greift ohne Utility eine erreichbare feindliche Basis an. Eine nahe Außenfläche genügt auch bei weit entferntem Mittelpunkt; verdeckte Flächen werden nicht durchschossen.
2. Ein Kontrollturm verschwendet keine Angriffe auf eine Basis, gegen die er wirkungslos ist. Gültige Figuren- und Fokusziele folgen der gemeinsamen Priorität.
3. Die Relais-Grundversion erzeugt eine passende Kopie und pausiert ihr Original. Nach Ende setzt das Original seine reguläre Feuerfolge ohne kostenlosen Reset fort.
4. Höhere Kopienzahl erzeugt nur aus geeigneten Originalen zusätzliche Projektionen. Kopien erzeugen keine weiteren Kopien.
5. Parallelbetrieb lässt Original und Kopie gleichzeitig kämpfen. Die Zerstörung des Originals beendet die Kopie.
6. Ein Portal bleibt über mehrere Feuerzyklen offen. Ein Turm kann einen Gegner am Ausgang angreifen, obwohl dieser weit außerhalb seiner Reichweite vom ursprünglichen Standort liegt.
7. Ziele in unterschiedlichen Richtungen um den festen Ausgang führen zu entsprechender Rohrdrehung und Austrittsrichtung. Eingang und Mündung bleiben zusammengehörig.
8. Hindernisse auf der übersprungenen Strecke blockieren den Transport nicht; Hindernisse auf realen Schussabschnitten schon. Restreichweite und Lebensdauer werden nicht erneuert.
9. Spieler, Gegner, fremde Geschosse und nicht zugeordnete eigene Schüsse nutzen keinen Feuerleit-Eingang. Der gemeinsame Ausgang führt nicht zu Rücktransport oder Portal-Pingpong.
10. Ohne Granaten-Bossupgrade bleibt eine Quelle ohne geeignetes Ausgangsziel untätig. Mit Bossupgrade kämpft sie lokal und kehrt bei einem geeigneten Ausgangsziel zurück. Salvenweg und Nachladezustand bleiben konsistent.
11. Beide Aktivierungsreihenfolgen von Relais und Granate funktionieren. Neu entstandene Kopien erhalten Verbindungen; pausierte Originale werden nicht durch die Granate reaktiviert.
12. Portalschaden wird je Einsatz einmal angewandt und erreicht zugehörige Schadenseffekte ohne doppelte Skalierung. Schadenfreie Kontrolle bleibt unverändert.
13. Turm-Upgrades, örtliche Buffs und die ausdrücklich festgelegten identitätsgebundenen Effekte verhalten sich an Original und Kopie konsistent.
14. Entfernen von Quellen, Einsatzende, Besitzerentfernung und World-Wechsel hinterlassen weder Portale noch Pausen. Clients und nachträglich beitretende Spieler sehen den richtigen Zustand.
15. Ein neuer Inspektor startet mit Raketenturm und Relais. Fehlende geeignete Originale werden verständlich gemeldet; bestehende Ausrüstungen folgen der festgelegten Migration.

## 11 Technische Anknüpfungspunkte

Die Umsetzung kann die vorhandene Turmfeuer- und Projektilverarbeitung erweitern. Temporäre Feuerquellen benötigen eigene Laufzeitidentitäten und eine ausdrückliche Verbindung zum Original. Eine Kopie darf nicht allein durch Übernahme eines Datenobjekts als vollständige zweite persistente Konstruktion entstehen.

Die vorhandenen Portale arbeiten mit beidseitigen Paaren und erhalten die Flugrichtung. Für Feuerleit-Portale sind insbesondere einseitige, quellengebundene Verbindungen mit gemeinsamem Ausgang sowie ein gemeinsamer Schadensbeitrag pro Einsatz erforderlich. Die normalen Translocator-Regeln bleiben davon getrennt.

| Bereich | Bestehender Anknüpfungspunkt |
|---|---|
| Zielwahl, Drehen, Feuerraten und Salven | [TurretSystem](../../src/systems/TurretSystem.ts) |
| Zusammenstellung der Türme, Waffenabgabe und MG-Zuordnung | [WorldCombatGameplayBinding](../../src/world/WorldCombatGameplayBinding.ts), [WorldMgTurretBinding](../../src/world/WorldMgTurretBinding.ts) |
| Portalgeometrie und Schadensbeiträge | [PortalTraversal](../../src/systems/PortalTraversal.ts), [PortalDamagePayload](../../src/combat/PortalDamagePayload.ts) |
| Tatsächlicher Geschosstransport und Flugabschnitte | [WorldProjectileRuntime](../../src/projectile/WorldProjectileRuntime.ts) |
| Vorhandene Utility-Ausführung | [PlayerUtilityActionRuntime](../../src/world/PlayerUtilityActionRuntime.ts) |
| Startausrüstung und Profilauflösung | [coopDefenseUpgrades](../../src/utils/coopDefenseUpgrades.ts) |
| Vergleichbare Portalfähigkeit | [Translocator GDD](Fragdachse_GDD_Translocator_Utility_Rework_v2.md) |
| Ergänzende mobile Konstruktion | [Angriffsdrohnenstation GDD](Fragdachse_GDD_Angriffsdrohnenstation_v2.md) |
| Architektur und Prüfung | [Architektur-Leitbild](../ai/architecture-principles.md), [Gameplay-Verträge](../ai/gameplay.md), [Testregeln](../ai/testing.md) |

Die technische Detailplanung konkretisiert diese Anknüpfungspunkte nach dem dann aktuellen Code. Sie ersetzt keine der hier festgelegten Gameplay-Regeln und löst die offenen Entscheidungen nicht durch unbeabsichtigte Übernahme bestehender Defaults.
