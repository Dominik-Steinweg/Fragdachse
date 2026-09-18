# Fragdachse – Schießstand im Übungsplatz und gemeinsame Shift-Interaktionen

**Version:** 1.3
**Stand:** 18. September 2026  
**Status:** Abgestimmtes Funktionskonzept für die erste Umsetzung

## 1. Ziel und Grundidee

Im Übungsplatz der Lobby entsteht ein zuschaltbarer Schießstand. Spieler können ihren aktuellen Build mit Waffen, Upgrades, Items, Utilities und Geschütztürmen unmittelbar ausprobieren. Eine gemeinsame DPS-Anzeige mit kurzem Verlauf macht die Wirkung sichtbar.

Das Werkzeug unterstützt die manuelle Einschätzung des Balancings. Es soll weder Builds automatisch testen noch Waffen bewerten oder auf identische DPS-Werte ausrichten.

> **Hinstellen, Schießstand einschalten, selbst spielen, Werte ablesen und anschließend im echten Spiel überprüfen.**

Ein typischer Ablauf: Eine bekannte Waffe dient als grobe Referenz. Eine im Spiel auffällige Waffe wird am Schießstand ausprobiert. Nach einer manuellen Anpassung ihrer Balancingwerte wird erneut geschossen und anschließend in einer echten Runde getestet. Die Zahlen merkt sich der Nutzer selbst; das Spiel speichert keine Vergleichsergebnisse.

### Festgelegter erster Umfang

- Der linke Lobbybereich wird umgebaut. Geschossen wird **von rechts nach links**.
- Es gibt **tötbare, stationäre Trainingsgegner mit je 100 HP**. Start mit einem Gegner; über zwei Schalter zwischen **1 und 10 Gegnern**, jeweils in Einzelschritten, veränderbar. Nach dem Tod der gesamten Gruppe erscheint ohne Wartezeit eine vollständige neue Gruppe.
- Der Schaden aller Spieler und ihrer Schadensquellen an den Trainingsgegnern wird gemeinsam angezeigt. **Keine Aufteilung nach Spielern, Waffen oder Schadensarten.**
- Eine zuschaltbare Adrenalinversorgung ermöglicht praktisch unbegrenztes Dauerfeuer bei unveränderten Waffenkosten und normalem maximalem Adrenalinvorrat.
- **Alle Spieler** dürfen den Schießstand bedienen.
- Sämtliche Schießstandaktionen werden über **Shift** ausgelöst. Die bisherige Auswahl zum Turmbemannen wird dafür zu einer gemeinsamen Interaktionsauswahl verallgemeinert.

## 2. Bewusste Abgrenzung

Nicht Bestandteil dieser Umsetzung sind automatische Schussfolgen, Build-Suche, standardisierte Benchmarkläufe, Countdown, Ergebnisvergleiche, Ranglisten, Exporte oder gespeicherte Messungen. Es gibt keine künstliche Neutralisierung des aktuellen Builds und keine eigene vereinfachte Schadenssimulation.

Nicht enthalten sind zusätzliche Zielmodi, bewegliche Ziele, konfigurierbare Resistenzen, HP-Einstellungen oder ein umfangreiches Schießstandmenü. Kampfbezogene Kill-Effekte werden mit den normalen Trainingsgruppen getestet.

Spätere Gebäude zum Öffnen von Upgrades, Items oder anderen Oberflächen sind lediglich ein möglicher weiterer Nutzer der gemeinsamen Shift-Logik. **Die Auslagerung dieser Menüs wird hier nicht umgesetzt.**

Die DPS ist eine Orientierung, kein abschließendes Balanceurteil. Reichweite, Risiko, Kontrolleffekte, Überleben, Kill-Effekte und Verhalten unter Gegnerdruck werden weiterhin im echten Spiel beurteilt.

## 3. Räumliche Anordnung in der Lobby

### 3.1 Umbau des linken Bereichs

Die bestehende Lobby soll zunächst nicht vergrößert werden. Die reservierten Bereiche für den Schriftzug und die persistente Basis bleiben erhalten.

Der linke See füllt die **untere linke Ecke bis an beide Kartenränder**; die bisherigen Felsreste dort entfallen. Tafel, Schalter und Ziele sind um eine Rasterzelle nach unten versetzt. Die unterste Kartenzeile wird nicht als Schießstand-Nutzfläche verwendet. Der See liegt außerhalb der Gegner- und Bewegungsfläche.

Die Schussbahn bleibt auch bei ausgeschaltetem Schießstand eine freie Lichtung. Es sollen nicht bei jedem Einschalten Felsen oder Wasser als vermeintlich normale Hindernisse verschwinden.

### 3.2 Verbindliche Anordnung

| Position im linken Lobbybereich | Linke Seite | Rechte Seite |
|---|---|---|
| Oben, außerhalb der Schriftzugreserve | **DPS-Tafel** mit großer Zahl und Verlauf | **Bedienelemente** für Schießstand, Gegnerzahl und Adrenalinversorgung |
| Darunter | **Gegnerbereich** mit festen Zielpositionen | **Freie Spieler- und Aufstellfläche**, einschließlich Platz für eigene Geschütztürme |
| Am unteren Rand | **Kleiner Teich in der linken Ecke**, außerhalb der Testfläche | **Zugang vom übrigen Lobbygelände** |

**Gegner ← Schussrichtung ← Spieler und eigene Türme**

Es gibt keine feste Schützenposition. Spieler können näher an die Ziele herangehen, Nahkampf ausprobieren oder Türme versetzt aufstellen. Die rechte Fläche ist der vorgesehene Ausgangsbereich, kein unsichtbarer Bewegungszwang.

Die Bedienung rechts oben liegt außerhalb der eigentlichen Schussbahn. Vier jeweils ein Rasterfeld große Mauer-Objekte stehen unmittelbar nebeneinander: von links nach rechts Adrenalinversorgung, Gegner −, Gegner +, Schießstand. Kleine aufliegende Piktogramme zeigen ihre Funktion; Beschriftungen erscheinen nur in der Shift-Aktionshilfe. Die Reihe endet vor der persistenten Basisreserve. Zugang und unmittelbare Bedienpunkte dürfen nicht durch Konstrukte zugestellt werden. Die Tafel links oben wächst nach rechts und verwendet die vorhandene Holztextur mit Button-Rahmen.

Die konkrete Größe und die Abstände werden beim Aufbau an die vorhandene Geometrie angepasst. Ziel ist ein kompakter Schadensschießstand, keine lange Reichweitenteststrecke. Zwischen Gegnern, Kartenrand und Teich bleibt Abstand. Eine zusätzliche Wand direkt hinter den Zielen wird nicht allein als optischer Abschluss eingeführt, da sie Abpraller oder Explosionen verändern könnte.

Die Piktogramme sind transparente, orthografische Holztafeln mit Wurzeln, Moos und Efeu. Sie füllen jeweils ein Rasterfeld ohne sichtbaren grauen Mauersockel. Der Adrenalin-Blitz besteht aus cyanblauem Harz. Lebende Trainingsziele erhalten einen weichen rötlichen Bodenschein. Die aktive Versorgung wird durch sehr dezente Eckakzente und Lichtflecken im Cyanblau der Adrenalin-Essenz angezeigt; ein durchgehender Rahmen entfällt.

## 4. Gemeinsame Shift-Interaktionslogik

### 4.1 Grundregel

> **Das hervorgehobene Element ist dasjenige, auf das sich der nächste Shift-Tastendruck bezieht.**

Es darf zu einem Zeitpunkt höchstens einen relevanten Interaktionskandidaten geben. Ein Tastendruck führt höchstens eine Aktion aus. Gedrückthalten erzeugt keine Wiederholungen.

Turmbemannen und Schießstandbedienung dürfen nicht länger unabhängig voneinander denselben Tastendruck auswerten und dadurch gleichzeitig reagieren.

### 4.2 Kandidatenauswahl und Darstellung

Die bestehenden Regeln der Turmauswahl werden soweit sinnvoll übernommen und verallgemeinert:

- Nur aktuell bedienbare Elemente im jeweiligen Interaktionsradius kommen infrage.
- Blickrichtung und Entfernung bestimmen den bevorzugten Kandidaten. Eine kleine Wechselhürde stabilisiert die Auswahl zwischen ähnlich geeigneten Elementen.
- Es gibt keine pauschale Bevorzugung von Türmen gegenüber Schaltern oder umgekehrt.

Genau ein Element erhält eine eindeutige Markierung und einen konkreten Hinweis, beispielsweise **„Shift: Bemannen“**, **„Shift: Schießstand einschalten“** oder **„Shift: Gegner hinzufügen“**. Räumlich getrennte Schalter erleichtern das bewusste Anvisieren.

### 4.3 Zustände und Prioritäten

Die vorhandene Shift-Bedienung von Spielfigur und Türmen bleibt konsistent:

| Zustand | Bedeutung von Shift |
|---|---|
| Spieler bemannt einen Turm | **Aussteigen**; ein benachbarter Schalter verdrängt diese Aktion nicht. |
| Spieler ist eingegraben | **Auftauchen** gemäß bestehender Spielregel. |
| Normaler Zustand und Interaktionsziel ausgewählt | Genau die **angezeigte Interaktion** auslösen. |
| Kein Interaktionsziel ausgewählt | Bestehende Ausweichfunktion, etwa **Eingraben**, sofern erlaubt. |

Ein Tastendruck darf niemals gleichzeitig interagieren und eingraben. Wird der angezeigte Kandidat unmittelbar vor der Ausführung ungültig, bleibt die Aktion ohne Wirkung. Es wird nicht überraschend ein anderer Kandidat oder die Ausweichfunktion ausgelöst.

Geöffnete Oberflächen und bestehende Eingabesperren werden respektiert. Die gemeinsame Logik darf keine Weltinteraktion auslösen, während die Eingabe einer anderen Oberfläche gehört.

### 4.4 Kleine, erweiterbare Verallgemeinerung

Gemeinsam werden **Auswahl, Hervorhebung, Hinweis und Auslösung** gelöst. Die eigentlichen Funktionen bleiben bei ihren zuständigen Systemen: Das Turmsystem bemannt Türme, der Schießstand verändert seinen Zustand.

Die Freischaltung zum Turmbemannen bleibt eine turmspezifische Voraussetzung. Sie ist ausdrücklich **keine Voraussetzung für Schießstandaktionen**.

Spätere Interaktionspunkte können dieselbe Auswahl verwenden. Dafür wird jetzt kein umfangreiches Gebäude-, Menü- oder Interaktionsframework entwickelt.

## 5. Bedienung und Zustände des Schießstands

### 5.1 Vier Interaktionspunkte

| Element | Aktion über Shift | Verhalten |
|---|---|---|
| **Hauptschalter** | Schießstand ein-/ausschalten | Bleibt auch im ausgeschalteten Zustand sichtbar und erreichbar. |
| **Gegner −** | Einen Gegner entfernen | Minimum 1. Am Minimum als nicht verfügbar gekennzeichnet. |
| **Gegner +** | Einen Gegner hinzufügen | Maximum 10. Am Maximum als nicht verfügbar gekennzeichnet. |
| **Adrenalinversorgung** | Versorgung ein-/ausschalten | Zustand ist am Schalter und an der Anzeige eindeutig sichtbar. |

Es gibt kein Auslösen durch Darüberlaufen, keine zusätzliche Bestätigung, kein Untermenü und kein langes Gedrückthalten. Die weiteren drei Schalter werden erst beim aktiven Schießstand sichtbar beziehungsweise bedienbar.

### 5.2 Start- und Rücksetzverhalten

Beim Start der Lobby-World ist der **Schießstand ausgeschaltet**. Einschalten beginnt mit einem Gegner, ausgeschalteter Adrenalinversorgung und leerer Anzeige. Erneutes Einschalten beginnt wieder mit genau diesen Werten.

Beim Einschalten erscheinen Trainingsziele, Anzeigen und die weiteren Bedienelemente. Beim Ausschalten werden die Trainingsziele entfernt, die Versorgung beendet und der kurzzeitige Messpuffer verworfen. Das Entfernen ist **kein Kill** und löst keine Todes-, Belohnungs- oder Fortschrittsereignisse aus.

Bereits aufgestellte Spielerkonstrukte werden nicht allein durch das Ausschalten gelöscht. Ihre normalen Besitz- und Lebensdauerregeln bleiben bestehen. Spielerbuilds und die persistente Basis werden nicht zurückgesetzt.

Die Ziele eines neu aktivierten Standes beginnen ohne vorherige Ziel-Debuffs oder Stacks. Alte Ziele werden nicht unter derselben Laufzeitidentität wiederbelebt. Noch existierende Effekte in der Welt dürfen weiterhin normal wirken; es gibt keinen künstlich bereinigten Benchmarkstart und keinen weltweiten Projektilreset.

Änderungen der Gegnerzahl oder Versorgung im laufenden Betrieb starten keinen neuen Messlauf. Der Verlauf läuft kontinuierlich weiter. Der Nutzer berücksichtigt selbst, wann er eine Einstellung geändert hat.

## 6. Trainingsgegner

### 6.1 Zahl und Aufstellung

Alle Ziele verwenden denselben klar definierten Trainingsgegner. Start mit einem Ziel; Veränderung von 1 bis 10 in Einzelschritten.

Zehn feste Zielplätze liegen in zwei Spalten mit jeweils fünf Positionen. Die ersten fünf Ziele stehen dicht zusammen, mit einer Rasterzelle Abstand, und werden vom mittleren Ziel aus nach oben und unten ergänzt. Die weiteren fünf Ziele stehen weiter links hinter dieser Gruppe und haben größere Abstände untereinander. Plus ergänzt sofort einen Platz samt Gegner. Minus entfernt den letzten Platz gegebenenfalls mitsamt seinem lebenden Gegner, ohne Kill. Andere Gegner behalten Position, HP und Status. Bereits tote Plätze bleiben bis zum vollständigen Gruppenwechsel leer.

Zielplätze, Tafel und Bedienwege bleiben auch bei ausgeschaltetem Stand gegen Platzieren und Verschieben von Konstrukten gesperrt. Vorschau und Host-Prüfung verwenden dieselbe Sperre. Zwischenräume bleiben bebaubar. Die Tafel hat keine Kollisionsgeometrie. Sichtbare Schalter haben unzerstörbare, niedrige Hitboxen wie Mauern und Türme: Sie blockieren Bewegung und physische Projektile, lassen normale direkte Schüsse aber passieren. Verborgene Schalter kollidieren nicht.

Die Abstände sollen Flächenschaden und Ketteneffekte sinnvoll ausprobieren lassen, ohne die Ziele künstlich auf einen Punkt zu stapeln. Eine Auswahl verschiedener Formationen ist nicht vorgesehen.

### 6.2 Verhalten und Schadensverarbeitung

Die Trainingsgegner stehen still, greifen nicht an und benötigen keine normale Patrouillen- oder Verfolgungs-KI. Sie bleiben an ihren vorgesehenen Positionen. Sie werden von passenden Waffen und Geschütztürmen als reguläre feindliche Ziele erkannt.

Verwendet wird der vorhandene **Zombie-Dachs mit Trainingsmarkierung, jeweils 100 HP**, ohne Skalierung nach Spielerzahl und ohne zusätzliche Resistenzen. Normale Treffer, kritische Treffer, Flächen- und nachwirkender Schaden, Trefferbelohnungen sowie geeignete Debuffs und Stacks laufen über die echten Spielsysteme. Bewegungs- und Verschiebungseffekte verändern die festen Positionen nicht.

Gezählt wird tatsächlich verlorenes Leben: Ein Treffer mit 300 Schaden auf einen frischen Gegner trägt **100 Schaden** bei. Tödliche Treffer und Folgeschäden werden genau einmal erfasst.

**Kampfbezogene Kill-Effekte funktionieren**, einschließlich Ressourcen, Buffs, Folgeexplosionen und Nekromantie. Beschworene Verbündete behalten ihre normalen Bewegungs-, Besitz-, Limit- und Lebensdauerregeln. Der Stand funktioniert in allen Lobby-Spielmodi; bestehende PvP-, Team- und Turm-Zielregeln bleiben erhalten.

Trainingsschaden und Trainingskills erzeugen keine normalen Statistikeinträge, XP, Loot oder Missionsfortschritte. Trainingseigenschaft und Belohnungsberechtigung bleiben getrennt von Gegnerart und Fraktion; Kampfreaktionen werden nicht durch das Unterdrücken sämtlicher Kill-Callbacks abgeschaltet.

Sobald alle Zielplätze besiegt oder leer sind, entsteht am Ende des Host-Simulationsschritts nach Abschluss aller Todesreaktionen eine vollständige neue Gruppe mit frischen Identitäten und ohne übernommene Debuffs. Dadurch kann dieselbe Explosion keine rekursive Folge sofortiger Gruppenspawns erzeugen. Bestehende Projektile und Flächeneffekte wirken anschließend normal weiter. Der Gruppenwechsel setzt die Messung nicht zurück.

## 7. DPS-Tafel und Verlauf

### 7.1 Eine gemeinsame Schadenszahl

Gezählt wird der gesamte tatsächlich verursachte Schaden **an den aktuell zum Schießstand gehörenden Trainingsgegnern**. Dazu gehören alle beteiligten Spieler, eigene und befreundete Konstrukte sowie Folgeschäden, soweit sie über die normalen Kampfregeln Schaden an diesen Zielen verursachen.

Es gibt keine Aufteilung nach Waffe, Spieler oder Schadensart. Schaden an anderen Weltobjekten oder Spielern geht nicht ein. Bei mehreren Gegnern wird der Gesamtschaden summiert, **nicht durch die Gegnerzahl geteilt**.

Solo lässt sich ein eigener Build prüfen; gemeinsam lassen sich auch Teamkombinationen ausprobieren. Für einen ungestörten Einzeltest sprechen sich die Spieler selbst ab. Die Tafel zeigt keine Überschrift; die große Zahl erhält das kurze Präfix „DPS: “.

### 7.2 Sichtbare Informationen

| Anzeige | Inhalt |
|---|---|
| **Große DPS-Zahl** | „DPS: “ und der Schaden über die letzte Sekunde als schnell lesbarer grober Indikator. |
| **Vergrößerter Graph** | Verlauf dieser DPS über die letzten 10 Sekunden. Eine feine Linie, dezente Flächenfüllung, zurückhaltendes Raster und Zeitachse. |

Die untere Statuszeile mit Gegnerzahl und Versorgung entfällt. Die Versorgung bleibt durch das Schalter-Piktogramm und die Markierung des Testbereichs erkennbar.

Eine gut lesbare Haupttafel wird mehreren kleinen Statistiktafeln vorgezogen. Der vorhandene Spieler-Adrenalinbalken bleibt unverändert nutzbar.

Zusätzliche Ressourcenstatistiken entfallen. Die künstliche Versorgung darf nicht als natürliche Erzeugung erscheinen.

### 7.3 Berechnung und Darstellung

Es gelten ein gleitendes **1-Sekunden-Fenster** und **10 Sekunden Verlauf**. Der Host erfasst Verlaufspunkte alle **100 ms**. Das Diagramm bewegt sich zwischen bestätigten Punkten kontinuierlich; 200 ms Anzeigeverzögerung ermöglichen lineare Interpolation ohne erfundene Spitzen oder Extrapolation fehlender Pakete. Die große Zahl wird ruhiger, etwa viermal pro Sekunde aktualisiert.

```text
DPS(t) = Summe des Schadens an Trainingsgegnern in (t − 1 s, t] / 1 s
```

Jeder relevante Schaden wird erfasst. Die begrenzte Aktualisierungsrate betrifft nur Zahl und Graph, nicht die Vollständigkeit der Erfassung. Leere Zeitabschnitte zählen als null; insbesondere wird der Wert nicht nur durch aktive Schusszeit oder die Zeit zwischen Treffern geteilt.

Kurze Salven erscheinen als Ausschläge, Ressourcenmangel und Feuerpausen als Abfall. Turmschaden kann einen Grundpegel bilden, auf den sich die eigenen Schüsse addieren. Nachwirkender Schaden bleibt sichtbar, solange er tatsächlich entsteht. Der Graph läuft auch ohne weitere Schüsse weiter.

Die senkrechte Achse beginnt bei null und wächst bei Bedarf auf lesbare Stufen der Reihe **1–2–5**. Sie schrumpft erst beim erneuten Einschalten, auch nicht nach einer Feuerpause.

Es wird ausschließlich ein begrenzter kurzzeitiger Puffer im Arbeitsspeicher benötigt. **Keine dauerhafte Speicherung, kein Verlauf über Sitzungen hinweg und keine Ergebnisablage.**

## 8. Zusätzliche Adrenalinversorgung

Die Versorgung ist standardmäßig ausgeschaltet und kann von jedem Spieler am Schalter aktiviert werden. Eine kleine Station und eine erkennbare aktive Darstellung machen die Testhilfe sichtbar.

Bei eingeschalteter Versorgung erhalten Spieler **im gesamten vorgesehenen Schießstandbereich** zuverlässig Nachschub bis zum normalen maximalen Adrenalinvorrat. Auch das Vorlaufen zu den Gegnern für Nahkampf soll innerhalb dieses Bereichs möglich sein; niemand muss auf einem kleinen Versorgungspunkt stehen bleiben.

Die Versorgung ist keine gewöhnliche Regeneration mit festem Tempo. Auch mehrere regulär bezahlbare Aktionen innerhalb eines Simulationsschritts dürfen den Nachschub nicht überholen. Client-Vorhersage darf trotz aktiver Versorgung keine künstlichen Feuerpausen erzeugen.

**Waffenkosten, maximaler Vorrat und andere Spielregeln bleiben unverändert.** Die Versorgung setzt weder Cooldowns zurück noch erhöht sie den maximalen Vorrat oder macht sonst ungültige Aktionen gültig. Sie verändert auch nicht die normale Aufladung oder Mechanik einer Waffe.

Nach Ausschalten der Versorgung, Deaktivierung des Standes oder Verlassen des Versorgungsbereichs endet der künstliche Nachschub. Bereits vorhandenes Adrenalin wird nicht nachträglich entzogen.

Die künstlich zugeführte Ressource muss von natürlicher Erzeugung unterscheidbar bleiben, damit sie weder entsprechende Statistiken noch etwaige erzeugungsgebundene Spieleffekte fälschlich auslöst.

## 9. Multiplayer und Zuständigkeiten

Der Schießstand ist ein **gemeinsames Objekt der Lobbywelt**, keine separate Instanz je Spieler. Alle Spieler dürfen ihn einschalten, ausschalten, die Gegnerzahl ändern und die Versorgung bedienen.

Zustand und Gameplay werden über die normale Host-Autorität des Spiels abgewickelt. Clients melden ihre Interaktionsabsicht; vor der Ausführung werden Ziel, Reichweite und Berechtigung geprüft. Gleichzeitige gültige Aktionen werden in der vom Host verarbeiteten Reihenfolge wirksam. Es braucht keine Reservierung des Schießstands und kein zusätzliches Berechtigungsmenü.

Clients senden konkrete Interaktionsabsichten als World-gebundene Requests. Der Host prüft Teilnahme, Zustand, Ziel und Reichweite und verarbeitet gültige Aktionen in Empfangsreihenfolge. Alle Spieler sehen denselben Standzustand, dieselben Ziele und denselben gemeinsamen Schaden. Repliziert werden Aktivität, Gruppengröße, lebende Zielzuordnung, Versorgung und aggregierte Anzeigewerte samt Verlauf. Bestehende Gegnersnapshots werden weiterverwendet; Late Join erhält auch den aktuellen Verlauf. Einzelne Schadensereignisse werden nicht übertragen.

## 10. Technische Leitplanken

Die Umsetzung nutzt die vorhandene Lobbywelt, den echten Kampflauf, Ressourcenmechaniken und die bestehenden Bau- und Turmsysteme. Die aktuell ausgerüsteten Builds werden nicht durch Lab-Referenzprofile ersetzt.

Die Integration der Trainingsziele muss reguläre Treffer, Zielerfassung, Statuswirkungen und Turmangriffe ermöglichen. Wo bestehende Gegneranbindung an eine Mission gekoppelt ist, wird eine schmale, zur Lobbywelt passende Anbindung benötigt. Es soll dafür weder eine künstliche Mission gestartet noch das komplette automatische Balance-Lab in die Lobby übernommen werden.

Schießstandzustand, Trainingsziele und Versorgung gehören zur Lebensdauer der jeweiligen Lobbywelt. Bei deren Abbau werden Ziele, Beobachter, Interaktionskandidaten und Anzeigepuffer zuverlässig entfernt. Die allgemeine Shift-Auswahl verwendet keine veralteten Referenzen aus einer vorherigen Welt.

Die eigene Schießstand-Runtime besitzt Zustand, Zielplätze, Trainingsidentitäten und Messpuffer innerhalb der Lobby-World. Sie nutzt den bestehenden EnemyManager und Kampflauf. Physik, Zielerfassung, Statusdarstellung und Replikation greifen auf den zuständigen Gegner-Owner zu. Benötigte Nekromantie-, Navigations- und Kill-Reaktionsbausteine werden auch für die Lobby gebunden.

Die Messung liest tatsächliche, bestätigte Schadensereignisse. Sie zählt keine Effektanimationen, theoretischen Konfigurationswerte oder denselben Treffer an mehreren Stellen. Ausschalten entfernt Trainingsgegner ohne Kill und beendet Versorgung und Messung. Konstrukte, beschworene Verbündete und Welteffekte folgen weiter ihren normalen Lebensdauerregeln. Beim World-Abbau werden alle Bindungen gelöst.

Graph und Zahl werden sparsam aktualisiert. Für zehn stationäre Ziele und eine einzelne Verlaufslinie wird kein neues Telemetrie- oder Analyseframework benötigt. Die Darstellung und Bedienelemente passen sich an die bestehenden Kamera-, UI- und Lokalisierungsregeln an.

## 11. Abnahme der ersten Umsetzung

Der erste Stand ist nutzbar, wenn folgende Prüfungen gelingen:

1. **Layout:** Tafel oben links, Gegner darunter, Schalter oben rechts, freie Spieler-/Turmfläche darunter. Geschossen wird von rechts nach links. Teich, Schriftzug und Basisreserve kollidieren nicht mit der Nutzung.
2. **Bedienung:** Shift aktiviert genau das markierte Element. Darüberlaufen tut nichts. Schalter und nahe Türme konkurrieren über dieselbe Auswahl. Aussteigen, Auftauchen und Eingraben bleiben eindeutig; kein Tastendruck löst zwei Funktionen aus.
3. **Ziele:** Der Stand beginnt mit einem Gegner. Plus und Minus verändern die Zahl zwischen 1 und 10, ohne überlebende Gegner zu versetzen oder zurückzusetzen. Tödliche Treffer, geeignete Statuswirkungen und Kampf-Kill-Effekte einschließlich Nekromantie funktionieren. Nach vollständiger Niederlage erscheint eine frische Gruppe. Administratives Entfernen löst keinen Kill aus.
4. **Kombinierter Schaden:** Eine Waffe allein, ein eigener Turm allein und beide zusammen erscheinen in derselben DPS-Zahl. Schaden außerhalb der Trainingsziele wird nicht mitgezählt. Mehrere Spieler können gemeinsam testen.
5. **Verlauf und Versorgung:** Eine kurze starke Salve mit anschließender Pause bleibt im Graphen erkennbar. Ohne Versorgung gilt das normale Ressourcenverhalten. Mit Versorgung ist Dauerfeuer bei normalen Kosten und normalem maximalem Vorrat möglich; der aktive Zustand ist klar sichtbar.
6. **Lebensdauer und Multiplayer:** Auch ein Nicht-Host kann alle Schalter bedienen. Ausschalten oder Verlassen der Lobby hinterlässt weder aktive Versorgung noch verwaiste Ziele oder Interaktionskandidaten. Es entstehen keine gespeicherten Messläufe oder dauerhaften Trainingsbelohnungen.

## 12. Zusammenfassung

Der Schießstand bleibt ein einfaches Spielerfeature und manuelles Balancingwerkzeug: **selbst spielen, gemeinsam verursachten Schaden sehen, Änderungen einschätzen und im echten Spiel überprüfen.**

Verallgemeinert wird die Shift-Bedienung, nicht der Testablauf. Die erste Umsetzung umfasst den linken Lobbyumbau, vier Interaktionspunkte, ein bis zehn tötbare Trainingsziele, vollständigen Gruppenrespawn, eine gemeinsame DPS-Tafel mit Live-Verlauf und eine zuschaltbare Adrenalinversorgung.
