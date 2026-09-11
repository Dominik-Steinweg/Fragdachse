# FRAGDACHSE – Hindernisklassen und Schusslinien

**Version:** 1.0 · 11.09.2026  
**Status:** Fachliche Umsetzungsgrundlage

## 1. Ziel und Umfang

Spieler sollen eine funktionierende Verteidigung bauen können, ohne dass niedrige Mauern und Türme das eigene Feuer blockieren. Natürliche Deckung und massive Gebäude bleiben taktisch relevant. Basistürme können aus ihrem eigenen Gebäude herausfeuern, aber nicht durch andere Gebäude oder Felsen.

Das Modell verwendet vier verständliche Hindernisklassen, **keine echte Höhenphysik**. Es führt weder dreidimensionale Flugbahnen noch zusätzliche Trefferebenen für Figuren ein. Der Umsetzungsumfang bleibt auf einheitliche Schussblockierung, Abschussträger, notwendige Supportinteraktionen und das zugehörige Gegnerverhalten begrenzt.

## 2. Die vier Hindernisklassen

Die Tabelle beschreibt gewöhnliches offensives Direktfeuer. Schadensfähigkeit, Reparierbarkeit und Zugehörigkeit sind davon unabhängig.

| Klasse | Bewegung | Gewöhnliches Direktfeuer | Objekte |
|---|---|---|---|
| **Boden** | Nicht blockiert | Passiert | Gras, Dirt, Kies, Gleise, sämtliche Power-up-Podeste, Pickups und reine Interaktionsflächen |
| **Niedrig** | Blockiert | Passiert darüber | Gebaute Mauern und sämtliche normalen Spielertürme einschließlich ihres niedrigen Sockels |
| **Hoch** | Blockiert | Wird abgefangen | Eigene Basis, Vorposten, gegnerische Hauptbasen und Brutnester |
| **Sehr hoch** | Blockiert | Wird abgefangen | Natürliche und mapseitig vorgegebene Felsen, Baumstämme, geschlossene Missionssperren und der Zug |

**Boden ist der implizite Standard für Objekte ohne feste Hindernisgeometrie.** Rein visuelle oder nicht blockierende Objekte benötigen keine individuelle Höhenkennzeichnung. Vorhandene feste Hindernisse müssen dagegen eindeutig eingeordnet sein und dürfen nicht durch eine fehlende Zuordnung versehentlich durchlässig werden.

Alle regulären Spielerturmvarianten sind niedrig: Sporen-, Raketen-, MG-, Flammen-, Tesla-, Gravitations- und Slow-Bubble-Türme. Waffentyp, Upgrades, Besitzer und dauerhafte Speicherung ändern diese Klasse nicht. Ein gewöhnlicher Turm innerhalb der Basis-Bauzone bleibt niedrig; nur eine tatsächliche Montage auf dem Basisgebäude macht ihn zum Basisturm.

Nur die reale Gebäudefläche ist hoch. Begehbare Nischen, Zwischenräume und der Kiesbereich um die Basis bleiben Boden. Bei Bäumen blockiert der Stamm, nicht die gesamte gezeichnete Krone. Geöffnete Missionssperren sind keine aktiven Hindernisse mehr.

Auf sehr hohen Objekten gibt es **keine Turmmontage**. Die Einordnung ist nicht von der Fraktion abhängig. Begehbarkeit bedeutet außerdem nicht automatisch Bebaubarkeit oder Gefahrlosigkeit.

## 3. Direktfeuer und montierte Türme

Gewöhnliche offensive Direktgeschosse und entsprechende Strahlen passieren niedrige Konstrukte. Hohe und sehr hohe Hindernisse fangen sie ab. Spieler, Gegner und andere reguläre Kampfziele bleiben unabhängig davon normal treffbar.

Für montierte Türme gilt genau eine allgemeine Quellenregel:

> Ein Turm darf aus seinem konkreten Trägergebäude herausfeuern. Andere hohe und sehr hohe Hindernisse bleiben wirksam.

Der Träger ist das zusammengehörige Gebäude, nicht jedes verbündete Bauwerk. Dadurch kann ein Basisturm über seine eigene Basisfläche schießen und eine gegnerische Basis treffen. Ein anderes freundliches Basisgebäude dazwischen blockiert dagegen ebenfalls.

Die Trägerfreigabe gilt nur für den ursprünglichen Abschuss. Nach abgeschlossenem Austritt darf sie bei Rückkehr, Abprallern oder Portaltransport nicht erneut wirksam werden. Sie darf auch nicht pauschal auf später an anderen Orten entstehende Folgegeschosse übergehen.

„Erhöht“ bezeichnet lediglich die Montage auf einem hohen Gebäude. Es gibt keine allgemein durch hohe Bauwerke fliegende Geschossart. Hohe und sehr hohe Hindernisse reagieren auf eintreffendes Standardfeuer gleich; hohe Gebäude können zusätzlich als Turmträger dienen.

Zielprüfung, Schussfreigabe, tatsächlicher Treffer und Darstellung müssen übereinstimmen. Das gilt auch bei Turmdrehung, Salven und zielsuchenden Geschossen. Der Kontakt mit dem angegriffenen Gebäude zählt als Zieltreffer, nicht als Hindernis vor dem Ziel. Geschosse beginnen an ihrer vorgesehenen Mündung; sie werden nicht unsichtbar an eine Gebäudekante vorversetzt.

## 4. Gezielte Supporttreffer

Niedrige Konstrukte bleiben für geeignete Supportangriffe direkt erreichbar. Dafür wird ihre Hindernisklasse nicht verändert.

| Waffe | Erforderliches Verhalten |
|---|---|
| **Plasma-Brenner** | Trifft und repariert eigene sowie verbündete reparierbare Mauern und Türme, auch wenn diese niedrig sind. |
| **Energieinjektor** | Trifft seine gültigen verbündeten Konstruktziele, auch wenn diese niedrig sind, und bringt die jeweilige Verstärkung an. |

Die vorhandenen Wirkungen auf andere Ziele bleiben erhalten. Die Supportregel erweitert nicht automatisch den Kreis reparierbarer oder verstärkbarer Objekte.

Der Plasma-Brenner endet am ersten gültigen Treffer beziehungsweise vorherliegenden festen Schusshindernis. Ein voll repariertes Konstrukt bleibt ein Treffer und beendet den Strahl, erhält aber keine zusätzliche Heilung. Ein einzelner Strahl repariert nicht durch ein Konstrukt hindurch gleichzeitig ein weiteres Ziel.

Auch der Energieinjektor darf keine vor seinem Ziel liegende feste Deckung umgehen. Seine bestehenden Regeln für gültige Supportziele bleiben maßgeblich. Flächenunterstützung benötigt keine zusätzliche Direktkontakt-Ausnahme.

## 5. Schaden und Gegnerverhalten

Niedrige Mauern und Türme bleiben durch geeignete **feindliche Explosionen und Nahkampfangriffe** beschädigbar. Schussdurchlässigkeit bedeutet keine Unverwundbarkeit. Reparatur, Flächeneffekte und Nahkampf dürfen diese Ziele nicht verlieren.

Freundliches Turmfeuer verursacht keinen Schaden an verbündeten Bauwerken, auch nicht durch Explosionen oder Folgeeffekte. Dieser Schutz muss unabhängig vom Ausbleiben direkter Projektilkontakte gelten. Bewusst vorhandene Eigen- oder Teamschadensregeln anderer Angriffe werden nicht pauschal geändert.

Gegner behandeln niedrige Konstrukte nicht als reguläre direkte Fernkampfziele. Die bestehenden Prioritäten zwischen Spielern und hohen Gebäudezielen bleiben grundsätzlich erhalten.

Solange ein begehbarer Weg zum eigentlichen Ziel existiert, verfolgen Gegner diesen Weg. Versperren niedrige Spielerkonstrukte alle Zugänge, erreichen sie eine zugängliche Stelle der Blockade und öffnen sie im Nahkampf. Die gewählte Blockade muss für den Weg zum eigentlichen Ziel relevant sein; ein beliebiges nahes Konstrukt genügt nicht. Sobald ein Weg frei ist, setzen die Gegner ihren ursprünglichen Angriff fort.

Gefordert ist zuverlässiger Blockadeabbau, keine optimale Berechnung von Wegen anhand ihrer Zerstörungskosten. Niedrige Türme, die als Wegsperre eingesetzt werden, tragen dasselbe Nahkampfrisiko wie Mauern.

## 6. Portale und bestehende Spezialmechaniken

**Translocator-Portale wirken unabhängig von der Abschussquelle.** Sie sind Durchtrittsflächen, keine sehr hohen festen Wände. Bereits unterstützte Angriffe behalten ihre Portalwirkung; auch Schüsse von Basistürmen können hindurchtreten.

Ein tatsächliches Hindernis vor dem Portal bleibt wirksam. Der Portalausgang gewährt keine neue Trägerfreigabe. Eine automatische Zielsuche über Portalverbindungen ist nicht Bestandteil dieser Änderung.

Bestehende Wurf- und Rollphysik, etwa von Granaten oder dem Translocator-Puck, wird nicht pauschal mit gewöhnlichem Direktfeuer gleichgesetzt. Ebenso bleiben bewusst vorhandene Durchdringungs-, Nahkampf-, Schild- und Wirkfeldmechaniken bestehen. Die neue Schussregel darf insbesondere nicht als freie Lauf-, Landungs- oder Nahkampfverbindung interpretiert werden.

## 7. Lesbarkeit und Begrenzung des Umfangs

Gebaute Felsen werden für Spieler als **Mauern** bezeichnet und sichtbar von Naturfelsen unterschieden. Mauern und normale Turmsockel sollen als niedrige künstliche Befestigungen erkennbar sein; Basisgebäude und Dachmontage müssen davon unterscheidbar bleiben. Die strikte Draufsicht und die bestehenden Bewegungsgrundflächen bleiben erhalten.

Nicht erforderlich sind neue interne Objektbezeichnungen, eine allgemeine Gebäudeneuarchitektur, getrennte Trefferflächen für Dachgeschütze oder eine neue automatische Belagerungspriorisierung der Türme. Die vier Klassen sollen vorhandene Objekte konsistent beschreiben, nicht für jedes Objekt einen Sonderfall erzeugen.

## 8. Abnahmekriterien

| Situation | Erwartetes Ergebnis |
|---|---|
| Spieler oder niedriger Turm schießt durch mehrere niedrige Konstrukte | Keine Blockierung, kein unbeabsichtigter Trefferverbrauch; Ziele dahinter werden getroffen. |
| Basisturm schießt über seinen eigenen Träger | Freie Schussbahn über die zugehörige Gebäudefläche. |
| Basisturm beschießt eine andere Basis oder einen Vorposten | Das Gebäude ist regulär treffbar und fängt den Schuss ab. |
| Naturfels, Stamm, geschlossene Missionssperre oder Zug liegt im Weg | Bleibt auch für Basistürme wirksam. |
| Plasma-Brenner oder Energieinjektor trifft ein gültiges niedriges Supportziel | Reparatur beziehungsweise Verstärkung funktioniert; feste Deckung davor wird beachtet. |
| Feindlicher Nahkampf oder eine geeignete Explosion trifft niedrige Konstrukte | Schaden wirkt; freundliches Turmfeuer beschädigt verbündete Bauwerke nicht. |
| Sämtliche Zugänge sind durch niedrige Konstrukte geschlossen | Gegner öffnen eine relevante erreichbare Blockade und laufen danach weiter. |
| Portaltransport oder Rückkehr zum ursprünglichen Träger | Keine dauerhafte oder neu aktivierte Gebäudedurchlässigkeit. |
| Platzieren, Verschieben, Zerstören, Laden oder Multiplayer-Beitritt | Dieselbe Einordnung und konsistente Schuss- und Bewegungsregeln ohne verbleibende unsichtbare Hindernisse. |
