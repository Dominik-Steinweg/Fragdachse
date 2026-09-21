# Fragdachse – Dynamischer Bodennebel

**Konzept V1 · 21. September 2026**  
**Status:** Gestaltungsentscheidungen abgestimmt; Grundlage für einen späteren Implementierungsplan.  
**Codebezug:** `Dominik-Steinweg/Fragdachse`, `main` auf Commit `fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54`.

> Feiner Bodennebel zieht über Wasser, Rasen und Dirt. Er reagiert auf die Tageszeit, umspielt Bewegungen und wird durch Explosionen sowie Geschosse aufgerissen. Nach Felszerstörung schwebt er von benachbarten Bereichen in die neue Öffnung hinein – ohne Aufploppen und ohne flächiges Einblenden.

Dieses Dokument beschreibt das gewünschte Verhalten und die technische Leitlinie. Konkrete Texturgrößen, Zeitwerte und Budgets sind ausdrücklich **Startwerte für die Abstimmung**, keine gemessenen Ergebnisse. Eine vollständige Strömungssimulation ist nicht vorgesehen.

## 1. Ziel und verbindliche Entscheidungen

Der Nebel soll die Arena räumlicher und lebendiger wirken lassen, ohne die Lesbarkeit des schnellen Top-down-Kampfes oder das Zielprofil von 120 FPS unnötig zu belasten. Er ist ein zusammenhängendes Umweltsystem, keine Ansammlung vergrößerter Rauchgranatenwolken.

Die acht abgestimmten Entscheidungen sind vollständig Bestandteil von V1:

| Bereich | Festlegung |
| --- | --- |
| Gameplay | Rein visuell; keine Änderungen an Wahrnehmung, Zielerfassung, Sichtlinien, Schaden oder Kollisionen. |
| Verteilung | Sehr dünner, unregelmäßiger Grundnebel mit einzelnen deutlicheren Schwaden; über Wasser dichter, über Rasen und Dirt lockerer. |
| Tageszeit | Frühmorgens am stärksten, abends und nachts mittelstark; mittags auf Land nahezu keiner, über Wasser schwache Reste möglich. |
| Map-Konfiguration | Eine gemeinsame Tageszeitkurve und eine einfache Nebelstärke pro Map einschließlich „aus“. |
| Figuren | Dezente Reaktion auf normales Laufen; stärkere Reaktion auf schnelle Bewegungen und große Gegner. Kein dauerhaft freier Kreis um stillstehende Figuren. |
| Projektile | Grundsätzlich alle sichtbaren fliegenden Geschosse können Spuren auslösen; Stärke, Breite und Lebensdauer werden passend abgestuft. Begrenzung und Zusammenfassung bei Dauerfeuer. |
| Zerstörung | Neu freigegebene Bereiche beginnen nebelarm beziehungsweise leer. Räumliches Einströmen vom Rand; große Innenflächen dürfen lange klar bleiben. |
| Grafikqualität | Zunächst weniger Details und kleine Reaktionen. Auf niedriger Stufe dürfen Projektilspuren und Gegnerreaktionen entfallen. Große Explosionen und Nachströmen bleiben möglichst erhalten. Separat abschaltbar. |

**Übergreifende Regel:** Die logische Geländezuordnung bestimmt, wo Nebel existieren und transportiert werden darf. Die Zeichenreihenfolge entscheidet nur, wie dieser Zustand im Bild erscheint.

## 2. Erscheinungsbild

### 2.1 Feine Schwaden statt dichter Qualm

Das Bild besteht aus einer sehr schwachen Grundstruktur und wenigen deutlicheren, weich ineinander übergehenden Schwaden. Große, fast klare Bereiche zwischen den Schwaden sind erwünscht. Der Untergrund bleibt erkennbar; Nebel darf nicht wie ein gleichmäßiger grauer Farbfilter wirken.

Die Smoke-Granate ist eine Referenz für organische Bewegung und weiche Übergänge, nicht für Dichte, Kontrast oder runde Rauchkörper. Ihr vorhandener Shader verwendet rollende Wolkenformen und einen eigenen begrenzten Wolkenumriss. Der Bodennebel erhält daher ein eigenes Material und eigene Parameter. Die Smoke-Darstellung und ihre Gameplay-Wirkung bleiben unverändert. [R1]

Für die gestalterische Abstimmung gelten folgende Leitlinien:

- Helle, zurückhaltend getönte Schleier statt dunkler Rauchfalten, klarer Kugeln oder weißer Wattebäusche.
- Langsame gemeinsame Drift mit kleinen lokalen Abweichungen statt zufälligem Wabern an jeder Stelle.
- Mehrere räumliche Strukturgrößen innerhalb desselben Materials; keine sichtbaren Wiederholungsmuster oder gegeneinander rutschenden Folien.
- Feine Details unterstützen die Dichteverteilung, ersetzen aber niemals den gespeicherten Nebelzustand.

Nebel ist in Weltkoordinaten verankert. Kamera-Bewegung, Zoom und Kamerawackeln erzeugen weder zusätzlichen Wind noch eine Verschiebung relativ zum Boden.

### 2.2 Verteilung und Beleuchtung

Über Wasser ist der Nebel etwas dichter und zusammenhängender. Auf Rasen und Dirt ist er gleichermaßen zulässig, aber dünner und stärker aufgelockert. V1 benötigt keine zusätzliche feine Unterscheidung zwischen sämtlichen Bodenmaterialien. Die Wasserverstärkung läuft am Ufer weich aus und zeigt keine Zellgrenzen.

Der Nebel soll zur vorhandenen Tages- und Nachtbeleuchtung gehören. Er darf nachts nicht als selbstleuchtender grauer Schleier erscheinen. Die konkrete Einbindung in die Weltbeleuchtung ist beim Rendereraufbau festzulegen; eine doppelte Abdunklung durch eigenes Ambient-Tinting und anschließende Lightmap ist zu vermeiden. Echte volumetrische Lichtkegel oder eine separate Lichtsimulation im Nebel gehören nicht zu V1.

### 2.3 Lesbarkeit

Figuren, Geschosse, Gegenstände, Adrenalin-Essenzen und Angriffsmarkierungen müssen klar lesbar bleiben. HUD und lokale Statusanzeigen werden nicht eingenebelt. Ein Nebelstreifen darf insbesondere nicht mit einer Schadensfläche, einem Geschoss oder der Smoke-Granate verwechselt werden.

Die bevorzugte Komposition lässt den Nebel bodennah unter den wesentlichen Spielfiguren und Kampfsignalen liegen. Ausnahmen durch bestehende Render-Schichten werden gezielt gelöst, nicht durch einen pauschalen Vollbildnebel. Überlagerte Schwaden und viele Impulse dürfen die Deckkraft nicht unbegrenzt erhöhen.

## 3. Tageszeit und Map-Einstellungen

### 3.1 Gemeinsamer Tagesverlauf

Alle Maps verwenden dieselbe separat abstimmbare Nebelkurve. Sie liest die aktuelle Arena-Uhrzeit; es entsteht kein zweiter unabhängiger Tag-Nacht-Zyklus. Die vorhandene Arena-Uhr unterstützt synchronisierte Zeitverläufe und geskriptete Übergänge. [R2]

| Tagesabschnitt | Gewünschter Eindruck |
| --- | --- |
| Früher Morgen | Höchste Intensität; Wasserflächen tragen die deutlichsten Schwaden. |
| Vormittag | Der Nebel nimmt kontinuierlich ab. |
| Mittag | Auf Rasen und Dirt nahezu unsichtbar; über Wasser können sehr schwache Reste verbleiben. |
| Nachmittag | Weiterhin zurückhaltend, anschließend langsame Zunahme. |
| Abend und Nacht | Mittlere Intensität; keine automatische Maximaldichte nur wegen Dunkelheit. |

Die Kurve geht über Mitternacht ohne Sprung ineinander über. Auch bei geskripteten Uhrzeitsprüngen soll die sichtbare Nebelmenge weich reagieren. Die konkreten Stützpunkte und eine kurze Anpassungsglättung sind Tuning, keine zusätzlichen Map-Optionen.

Tageszeit ändert die gewünschte Umgebungsdichte. Sie darf bestehende Bewegungsspuren oder gerade freigeräumte Flächen nicht durch eine komplette Neuberechnung übermalen. Neu freigegebene Bereiche unterliegen auch während eines Tageszeitwechsels der Einströmregel aus Kapitel 5.

### 3.2 Eine Einstellung pro Map

Vorgesehen ist ein optionaler relativer Stärkefaktor, beispielsweise `fogStrength`. Der Name ist ein Vorschlag für den Implementierungsplan, kein bereits vorhandenes Datenfeld.

`0` bedeutet aus, `1` entspricht dem gemeinsamen Standard. Fehlende Werte verwenden den Standard. Erhöhte Werte bleiben durch einen zentralen Grenzwert für die Lesbarkeit begrenzt. Der Faktor steuert keine unabhängigen Wettervarianten.

Windrichtung, Windgeschwindigkeit und Wasserverstärkung werden zentral abgestimmt. Eine konsistente Grundrichtung kann aus dem Map-Seed abgeleitet werden; es gibt dafür in V1 keine zusätzlichen Autorenfelder. Bestehende und neue Map-Dateien müssen dieselbe Default-Regel verwenden. Beim späteren Einbau sind Schema, Laufzeitkonfiguration und gegebenenfalls Map-Editor gemeinsam anzupassen.

**Ergänzende V1-Abgrenzung:** Der erste Einsatz gilt für die Spielmaps. Die Lobby erhält nicht automatisch Nebel. Labor- und Testwelten können ihn gezielt einschalten.

## 4. Gelände und Hindernisse

### 4.1 Erlaubnis und Strömungsbarriere

Eine logische Nebelmaske unterscheidet zulässige Bodenflächen von erhöhten beziehungsweise massiven Hindernissen. Sie ist keine Kopie der Wegfindung: Wasser soll beispielsweise Nebel tragen, unabhängig davon, ob eine Figur es betreten kann.

| Oberfläche oder Objekt | Verhalten |
| --- | --- |
| Wasser, Rasen, Dirt | Nebel erlaubt. |
| Felsen und solide Felswände | Kein Nebel im Hindernis; blockieren den Transport. |
| Hohe, solide Basisflächen | Kein Nebel auf der erhöhten Fläche; blockieren den Transport. |
| Niedriger Bodenbelag, Kies, Markierungen, flacher Schutt | Bleibt zulässig; nicht pauschal wegen der Zugehörigkeit zu einer Basis sperren. |
| Neu platzierte oder entfernte solide Bauten | Lokale Aktualisierung der Sperrfläche aus dem tatsächlichen Weltzustand. |
| Spieler und Gegner | Keine festen Löcher in der Geländemaske; erzeugen vorübergehende Impulse. |
| Geschosse und Effektpartikel | Keine Hindernisse; relevante Geschosse liefern kurze Bewegungsimpulse. |

Für weitere Objektfamilien ist die Höhe beziehungsweise solide Grundfläche entscheidend, nicht ein beliebiger Depth-Wert. Eine vollständige Umströmung beweglicher Großobjekte wie des Zuges und detaillierte Baumstamm-Wirbel sind keine zusätzlichen V1-Pflichten. Bestehende Überdeckung bleibt erhalten; passende spätere Erweiterungen sollen möglich bleiben.

### 4.2 Depth bleibt eine Darstellungsentscheidung

Im geprüften Stand liegen Wasser, Felsen und Basisflächen auf unterschiedlichen Depth-Werten; Basisoberflächen werden auf `DEPTH.BASES` gezeichnet. Ein einzelner Nebel-Depth-Wert kann deshalb die logische Flächenregel nicht vollständig ersetzen. [R3]

Es wird zwischen zwei Aufgaben getrennt: Die Transportmaske verhindert Nebel im Hindernis und Durchströmen durch geschlossene Barrieren. Eine ausreichend genaue Darstellungsmaske hält sichtbare Fels- und Basiskonturen frei. Wo sinnvoll, können beide dieselbe Datenbasis nutzen, müssen aber nicht dieselbe Auflösung haben.

Weiche Nebelkanten dürfen keine hellen Säume über Felsen erzeugen. Gleichzeitig soll der Nebel möglichst bis an die Hindernisse heranziehen, ohne breite künstliche Sicherheitsabstände.

### 4.3 Lokale Änderungen

Die Nebelmaske konsumiert bestehende Terrain-, Bau- und Zerstörungszustände. Sie entscheidet nicht selbst, ob ein Objekt getroffen oder zerstört wurde. Änderungen werden gebündelt auf betroffene Zellen beziehungsweise Bereiche übertragen.

Bei einer neuen Sperre werden vorhandene Dichte und unzulässige Transportanteile dort entfernt. Bei einer Öffnung bleibt die neue Fläche zunächst leer. Ein vollständiger Maskenneuaufbau je zerstörtem Fels ist ausgeschlossen; großflächige Zerstörung muss als zusammenhängende Änderung verarbeitet werden.

## 5. Nachströmen nach Fels- und Basiszerstörung

### 5.1 Gewünschtes Verhalten

Verschwindet ein Hindernis, wird dessen Fläche für Nebel freigegeben, aber **nicht sofort befüllt**. Zunächst ist dort der freigelegte Boden sichtbar. Nebel erreicht die Fläche von benachbarten nebelhaltigen Bereichen aus und zieht ungleichmäßig hinein.

Wind und lokale Bewegung beeinflussen die Richtung. Ein kleiner Durchbruch kann sich vergleichsweise rasch mit Schleiern füllen. Nach einer großen Nuke-Zerstörung kann die Mitte noch mehrere Sekunden oder deutlich länger klar bleiben. Gibt es keinen erreichbaren Nebelnachbarn, bleibt sie zunächst leer.

Es gibt keinen globalen Fertig-Timer wie „nach einer Sekunde überall wieder volle Dichte“. Die Größe der Öffnung, erreichbare Nachbarflächen und vorhandene Bewegung bestimmen den Verlauf. Ein schmaler Durchgang darf den Transport verlangsamen; eine geschlossene Felsbarriere darf ihn nicht durchlassen.

### 5.2 Mindestanforderung an den Zustand

Dieses Verhalten benötigt einen gespeicherten räumlichen Dichtezustand oder ein gleichwertiges zustandsbehaftetes Transportmodell. Eine animierte Noise-Textur, die nach dem Entfernen eines Felsens lediglich sichtbar geschaltet wird, erfüllt die Anforderung nicht.

Für eine neu geöffnete Fläche gilt:

1. Sperre entfernen und lokale Nebeldichte auf null belassen.
2. Zufluss nur aus erreichbaren, bereits nebelhaltigen Nachbarbereichen zulassen.
3. Eine prozedurale Grunddichte oder automatische Wiederauffüllung im Inneren zunächst unterdrücken.
4. Nach tatsächlichem Eintreffen des Nebels die Fläche in das normale Verhalten übergehen lassen.

Ein einfacher lokaler Zustandsmarker darf dafür festhalten, dass der Nebel eine neue Fläche noch nicht erreicht hat. Dieser Marker ist kein Timer zum flächigen Einblenden. Details des Datenformats bleiben dem Implementierungsplan überlassen.

### 5.3 Zusammenspiel mit Explosionen

Geländeöffnung und Explosionsreaktion sind zwei getrennte Eingaben in denselben Nebelzustand. Eine Explosion kann vorhandenen Nebel am Rand verdrängen und damit den späteren Zufluss zusätzlich verzögern.

Die Verarbeitung muss im selben Aktualisierungsschritt konsistent sein: Zuerst den aktuellen Hinderniszustand übernehmen und neue Flächen leer halten; dann Impulse und Transport auswerten. Das bloße Freigeben einer Maske darf niemals versteckten, vorher unter dem Fels gespeicherten Nebel sichtbar machen.

Bei gestaffelten Zerstörungsanimationen bleibt eine noch sichtbare feste Oberfläche in der abschließenden Komposition frei. Der Nebelzustand richtet sich nach der logischen Öffnung, ohne eine intakte oder noch dargestellte Dachfläche zu übermalen.

## 6. Reaktionen auf Figuren, Explosionen und Projektile

### 6.1 Spieler und Gegner

Bewegung erzeugt eine leichte seitliche Verdrängung und eine kurze nachziehende Spur. Normales Laufen bleibt dezent. Höhere Geschwindigkeit und größere Körper erzeugen stärkere, breitere Reaktionen. Im Stillstand klingen Impulse ab; es bleibt kein sauber ausgestanzter Kreis zurück.

Die Spur orientiert sich an der sichtbaren Bewegungsbahn, nicht an Blickrichtung oder Waffenrichtung. Alle sichtbaren Spieler werden berücksichtigt; Gegner erhalten dieselbe Grundlogik mit einem eigenen begrenzten Budget. Unterirdische, ausgeblendete oder anderweitig nicht bodennah dargestellte Figuren erzeugen keine gewöhnliche Laufspur.

Positionssprünge, Respawns und Teleports unterbrechen die Spur. Auf Clients stammen ihre Eingaben aus den bereits geglätteten Darstellungspositionen, damit Spur und Figur übereinanderliegen. Vorhandene Bewegungssamples sind dafür ein sinnvoller Anknüpfungspunkt. [R4]

### 6.2 Explosionen

Eine Explosion dünnt den Nebel im Zentrum kurz aus und drückt ihn radial nach außen. Am Rand darf eine schwache Verdichtung entstehen, jedoch kein harter weißer Ring. Anschließend klingen die Impulse ab, während Nebel wieder nachströmt.

Die Stärke orientiert sich am visuellen Typ und Radius des Ereignisses. Schaden wird weder neu berechnet noch als Nebelwirkung zurück ins Gameplay geschrieben. Große Explosionen haben Vorrang vor vielen kleinen Impulsen. Wiederholte Mini-Raketen-Detonationen werden räumlich und zeitlich gebündelt, statt den Nebel bei jedem Treffer vollständig zurückzusetzen.

Der Ereigniseingang muss unabhängig davon funktionieren, ob die vorhandene Kamera-Druckwelle auf der aktuellen Grafikstufe eingeschaltet ist. `VisualFeedbackDirector` besitzt zwar passende Explosionsparameter, schaltet seine Druckwellen aber über die Einstellung für lokale Verzerrung ab. Nebel darf diese Abschaltung nicht unbeabsichtigt erben. [R5]

### 6.3 Projektile

Grundsätzlich kann jedes sichtbare fliegende Gameplay-Geschoss eine Nebelspur erzeugen. Kleine Kugeln hinterlassen schmale, schwache Linien; Raketen, größere Plasma-Geschosse und Feuerbälle deutlichere Verdrängungen. Die Spur ist eine Änderung des vorhandenen Nebels, kein zusätzliches leuchtendes Tracer-Sprite.

Die Reaktion folgt dem tatsächlich zurückgelegten Wegstück. Sehr schnelle Geschosse dürfen nicht nur punktförmig an ihrer aktuellen Position wirken. Bei Abprallern oder gekrümmten Bahnen werden passende Teilsegmente verwendet, nicht eine Abkürzung quer durch Hindernisse. Endet ein Geschoss zwischen zwei Nebelaktualisierungen, darf sein letztes sichtbares Segment nicht grundsätzlich verloren gehen.

Unregelmäßige Kamera-Bewegung, Netzkorrekturen oder wiederverwendete Geschoss-IDs dürfen keine langen falschen Linien erzeugen. Stabile Identität und eine explizite Unterbrechung bei Sprüngen sind Teil des Eingabevertrags.

Effektpartikel wie Funken und Rauch erzeugen keine eigenen Nebelspuren. Soforttreffer ohne sichtbares fliegendes Geschoss und kontinuierliche Strahlen benötigen in V1 keine zusätzliche Sonderbehandlung. Das erweitert die getroffene Auswahl nicht ungefragt auf jede Form visueller Energie.

**Startbereich für die Abstimmung:** Bei Kleingeschossen ungefähr 0,1–0,25 Sekunden erkennbare Ausdünnung, anschließend eine schwache Restverformung für einige weitere Zehntelsekunden. Große Geschosse dürfen breiter und länger wirken. Entscheidend ist das Bild, nicht die Einhaltung eines einzelnen Zahlenwerts.

### 6.4 Begrenzung ohne Flackern

„Alle Geschosse können reagieren“ bedeutet keine Garantie für einen eigenen Nebelimpuls pro Kugel unter beliebiger Last. Kandidaten werden nach räumlicher Nähe, Stärke und Sichtbarkeit zusammengefasst beziehungsweise ausgedünnt. Stärke pro Wegstrecke verhindert, dass die Wirkung allein wegen höherer Bildrate zunimmt.

Die Priorität lautet: Gelände-Korrektheit und Grundzustand, große Explosionen und Spielerbewegung, große Geschosse und relevante Gegner, schließlich kleine Projektilspuren. Wiederholte Impulse sättigen weich. Dauerfeuer darf weder dauerhaft eine vollständig freie Schneise erzeugen noch eine wachsende Warteschlange aufbauen.

## 7. Technische Leitlinie

### 7.1 Ein kleines, zustandsbehaftetes 2D-Feld

V1 verwendet eine vereinfachte Nebeldynamik: Wind, begrenzte lokale Bewegungsimpulse, Transport der Dichte und gedämpfte Verformungen. Eine druckerhaltende Flüssigkeitssimulation mit vollständigem physikalischem Gleichungssystem ist nicht erforderlich. Dichte- und Geschwindigkeitsfelder sowie deren Transport sind etablierte Bausteine GPU-basierter Strömungsverfahren; hier wird bewusst nur ein für den Effekt geeigneter Teilumfang angestrebt. [T1]

Vier Verantwortlichkeiten bleiben unterscheidbar, auch wenn die Implementierung Datenkanäle oder Renderdurchläufe zusammenfasst:

| Bestandteil | Verantwortung |
| --- | --- |
| Geländemodell | Erlaubte Flächen, solide Barrieren, Wassergewichtung und lokale Änderungen. |
| Nebelzustand | Bestehende Dichte sowie der Status frisch geöffneter, noch nicht erreichter Flächen. |
| Bewegungs- und Impulszustand | Grunddrift, kurzlebige Verdrängung, gedämpfte lokale Unruhe. |
| Renderer | Sichtbare Schwaden, Beleuchtung, korrekte Aussparung und Komposition mit der Spielwelt. |

Der bevorzugte Prototyp hält die laufenden Felder in niedrig aufgelösten GPU-Texturen. Aktualisierungen lesen den vorherigen Zustand und schreiben in eine getrennte Zieltextur. Danach werden die Rollen getauscht. Die genaue Kanalbelegung und die Entscheidung zwischen einem kameranahen Fenster und mehreren residenten Feld-Chunks werden im Implementierungsplan festgelegt.

### 7.2 Was der vereinfachte Transport leisten muss

Transport darf nur entlang offener Verbindungen stattfinden. Eine reine Maske am Zielpixel reicht nicht: Ein großer Bewegungsschritt könnte ansonsten Nebel über eine dünne Felswand hinweg auf die andere Seite abholen. Hindernisse sind bei Nachbarschaftsaustausch und Transportweg zu berücksichtigen.

Numerische Schrittweite und Feldauflösung werden deshalb in Weltmaßen abgestimmt. Bei höherer Geschwindigkeit sind begrenzte Teilstrecken oder entsprechend begrenzte Impulse vorzusehen. Schmale spielrelevante Durchgänge müssen erhalten bleiben; niedrigere Qualität darf keine geschlossenen Hindernisse durchlässig machen.

V1 verspricht keine physikalisch korrekten Wirbel hinter jedem Fels. Erwartet werden glaubwürdige Drift, lokale Reaktionen und verlässliche Barrieren. Begrenzte seitliche Vermischung kann verhindern, dass Nebel an einer Front vollständig hängen bleibt.

### 7.3 Dichte ist die Wahrheit, Noise nur die Oberfläche

Der sichtbare Nebel wird aus dem gespeicherten Zustand entwickelt. Noise kann seine Struktur feiner und lebendiger machen, aber keine Dichte in einer leeren neuen Öffnung erzeugen. Auch Wasserverstärkung und Tageszeit sind kein Freibrief, solche Flächen lokal aufzufüllen.

Damit sich das normale Umgebungsbild langfristig stabilisiert, darf es eine sehr schwache Rückführung zum Tageszeit-Zielzustand geben. Diese ist von der Einströmregel zu trennen: Frisch freigegebene, noch nicht erreichte Bereiche und gerade stark verdrängte Zonen erhalten keinen sofortigen lokalen Dichtenachschub. Eine exakte Erhaltung der gesamten Nebelmenge ist nicht verlangt.

### 7.4 Kamerabereich und kurze Erinnerung

Nur der sichtbare Bereich mit einer Randreserve wird detailliert fortgeschrieben. Die Reserve erlaubt Nebelzufluss von außerhalb des Bildes und verhindert sichtbares Entstehen direkt am Bildschirmrand. Bei Kameraverschiebungen bleiben überlappende Weltbereiche erhalten; die Kamera darf das Feld nicht neu würfeln.

Kürzlich verlassene Bereiche erhalten einen begrenzten Zustandscache. Ein kurzes Weg- und Zurückschwenken darf keine Schneise sofort zurücksetzen. Grenzen und Lebensdauer dieses Caches werden ausdrücklich budgetiert.

Für weit entfernte, lange nicht beobachtete Bereiche reicht eine Annäherung aus aktuellem Gelände, Tageszeit, Seed und grober Information über kürzliche Öffnungen. Exakte historische Wirbel sind nicht erforderlich. Jüngst zerstörte Flächen dürfen beim Wiederbetreten des Sichtbereichs aber nicht wie unberührter, bereits vollständig benebelter Boden initialisiert werden. Diese Unterscheidung ist beim Verwerfen von Felddaten zu erhalten.

### 7.5 Breite Schwaden und sehr schmale Geschossspuren

Ein einziges sehr grobes Feld ist möglicherweise ausreichend für das Nachströmen, aber nicht automatisch für feine Kugelspuren. Kleine Spuren dürfen deshalb nicht allein zur Sichtbarkeit auf breite Gräben vergrößert werden.

Zuerst werden weiche Segmentstempel im gemeinsamen Feld getestet. Reicht dessen Detail nicht aus, ist eine begrenzte feinere Spurmaske als Ergänzung zulässig. Sie moduliert nur dort vorhandenen Nebel, wird ebenfalls am Gelände ausgespart und unterliegt demselben Impulsbudget. Sie ersetzt weder den Dichtezustand noch öffnet sie Felsen. Der Prototyp entscheidet anhand der sichtbaren Qualität, ob dieser zusätzliche Durchlauf nötig ist.

## 8. Einbindung in Fragdachse

Die nachfolgenden Dateien wurden als vorhandene Anknüpfungspunkte geprüft. Sie sind keine Aufforderung, sämtliche Nebellogik in diese Klassen einzubauen.

| Vorhandener Bereich | Geeigneter Bezug |
| --- | --- |
| `SmokeSystem` / `smokeCloudShader` | Referenz für Shader-Anbindung, Vorbereitung, kamerabezogene Renderflächen und Qualitätsabstufung; keine Wiederverwendung der kompletten Rauchwolkenlogik. [R1] |
| `ArenaTimeOfDayController` / `TimeOfDay` | Bestehende Uhrzeit und Gestaltung des Tagesverlaufs. [R2] |
| `WaterSurfaceRenderer` | Beispiel für vorbereitete Geländemasken und kameranahe Ressourcenhaltung. [R6] |
| `MovementEffectsRenderer` | Bestehende sichtbare Bewegungssamples und Behandlung unterbrochener Bewegungen. Nebel nicht an das Budget für Fußabdrücke oder Staub koppeln. [R4] |
| `VisualFeedbackDirector` | Vorhandene Explosionsparameter; Nebelereignisse vor effektabhängigen Abschaltungen abgreifen. [R5] |
| `LocalDistortionComposer` | Vorbild für begrenzte Quellen und eine gemeinsame kleine Verschiebungskarte, aber kein bestehender persistenter Nebelzustand. [R7] |
| `WorldPresentationFrameBinding` | Einordnung der laufenden Darstellung in die aktive World-Lebensdauer. [R8] |

Der Nebel erhält eine eigene Zuständigkeit innerhalb der World-Presentation. Eine Scene kann Shaderprogramme und unveränderliche Hilfstexturen wiederverwenden; Dichte, Maskenbezug, Impulse und Bewegungsverläufe gehören dagegen zur jeweiligen World. Sie dürfen nicht als unbereinigter globaler Zustand zwischen Maps weiterleben.

Es wird keine allgemeine Wetter-Engine, kein neues ECS und keine zusätzliche Kollisionssimulation eingeführt. Schmale Eingänge für Geländeänderungen, Bewegung und Effektereignisse reichen aus. Der Nebel liest vorhandene Fakten und liefert ausschließlich Darstellung.

## 9. Multiplayer und Lebensdauer

### 9.1 Lokal darstellen, vorhandene Zustände verwenden

Jeder Peer berechnet seinen kosmetischen Nebel lokal. Map-Seed und gemeinsame Tageszeit schaffen einen ähnlichen Grundzustand; Bewegungen kommen aus der lokalen Darstellung der vorhandenen Spielfiguren und Geschosse. Explosionen und Geländeänderungen stammen aus den bereits replizierten Ereignissen beziehungsweise Weltzuständen.

Es werden keine Nebeltexturen, einzelnen Wirbel oder dauernden zusätzlichen Nebelsnapshots übertragen. Kleine Unterschiede zwischen Peers durch Interpolation, Qualitätsstufen oder unterschiedliche Sichtausschnitte sind akzeptabel. Das gilt ausdrücklich nicht für Gameplay: Gegnerwahrnehmung und Rauchgranatenmechanik bleiben unabhängig vom Bodennebel.

Ein Late Joiner muss keine alten Projektilspuren nachspielen. Aktuell vorhandene Hindernisse müssen stimmen; soweit frühere Öffnungszeitpunkte nicht verfügbar sind, ist eine konservative nebelarme Initialisierung betroffener Bereiche zulässig. Ein fehlender historischer Wirbel rechtfertigt keine Vergrößerung der Netzwerk-Payload.

### 9.2 Zeit und Unterbrechungen

Die Dichtefortschreibung arbeitet mit einer begrenzten Aktualisierungsrate und glatter Darstellung zwischen Zuständen. Ihre Zeitbasis gehört zur aktiven Spielwelt, nicht zur realen Tagesuhr. Eine Pause friert den Nebel ein; die Arena-Tageszeit bleibt ein davon getrenntes Eingabesignal für die Dichte.

Nach Tab-Rückkehr oder einem langen Frame werden keine unbeschränkt vielen Simulationsschritte nachgeholt. Alte Kleinstimpulse dürfen verfallen. Vorhandene beziehungsweise spätere Zeitlupensteuerung soll über einen zentralen Zeiteingang anschließbar bleiben; dieses Feature führt kein eigenes Bullet-Time-System ein.

Bei World-Wechsel, Neuaufbau oder endgültiger Aufgabe einer World werden deren Feldzustand, ausstehende Impulse und Quellverläufe bereinigt. Ein visueller Handoff darf Darstellung nur so lange halten, wie deren bisherige World noch gezeigt wird; keine alten Impulse wandern in die neue Map.

## 10. Leistung und Grafikstufen

### 10.1 Budget statt Leistungsversprechen

Für 120 FPS stehen rechnerisch etwa 8,33 ms pro Bild zur Verfügung. Als **vorläufige Entwicklungsleitplanke** werden auf dem vereinbarten High-Zielsystem ungefähr 0,5–1,0 ms zusätzliche GPU-Zeit für den gesamten Nebeleffekt angestrebt. Das ist weder gemessen noch eine Zusage für alle GPUs, Auflösungen und Kampfsituationen.

Die Messung umfasst Feldaktualisierung, Impulszeichnen, Nebelmaterial und abschließende Komposition. Nur einen einzelnen Shaderdurchlauf zu messen wäre unzureichend. CPU-Submission und tatsächliche GPU-Zeit werden getrennt ausgewiesen; fehlen verlässliche GPU-Messungen, wird das im Bericht ausdrücklich angegeben.

Kleine Renderflächen, gebündelte Zeichenarbeit, begrenzte Ressourcen und das Vermeiden synchroner GPU-Rücklesungen entsprechen den WebGL-Leitlinien. Konkrete Einsparungen müssen am Spiel gemessen werden. [T2]

### 10.2 Startkonfiguration für den Prototyp

| Stellschraube | Ausgangspunkt, noch zu validieren |
| --- | --- |
| Aufwendige Nebelberechnung | Zunächst halbe Kantenauflösung gegenüber dem Spielbild; Spiel und UI selbst bleiben unverändert. |
| Grobes Dynamikfeld | Größenordnung `256 × 144` für einen üblichen Full-HD-Sichtbereich, zusätzlich Randreserve; Weltmaßstab und schmale Barrieren sind wichtiger als diese exakte Zahl. |
| Fortschreibung | Zunächst 30 Hz mit geglätteter Ausgabe bei jeder gerenderten Bildaktualisierung. |
| Feine Projektile | Zuerst im gemeinsamen Feld; feinere Spurmaske nur bei nachgewiesenem Qualitätsbedarf. |
| Impulse | Feste Kapazität, räumliche Bündelung und Prioritäten; keine ungebremsten Listen pro Geschoss und Lebenszeit. |
| Ressourcen | Begrenzte aktive Fläche und begrenzter Cache; keine hochauflösende Vollwelt-Simulation. |

Halbe Breite und Höhe bedeuten ein Viertel der Pixel im betreffenden Zwischenpass. Daraus folgt keine vierfache Beschleunigung des Gesamteffekts: Der Schlussdurchlauf und andere Kosten bleiben bestehen.

### 10.3 Abstufung

| Qualität | Darstellung und Reaktionen |
| --- | --- |
| Hoch | Alle Reaktionsarten im Budget; beste Schwadenstruktur und feinere Spuren. |
| Mittel | Weniger Strukturdetails, gröbere Felder beziehungsweise kleinere Impulsbudgets; die wesentlichen Reaktionen bleiben. |
| Niedrig | Grundnebel, logische Barrieren und räumliches Nachströmen bleiben. Große Explosionen und einfache Spielerreaktionen werden bevorzugt erhalten; Gegnerreaktionen und Projektilspuren dürfen entfallen. |
| Aus | Kein Nebel-Rendering und keine aktive Nebelsimulation. |

Qualitätsstufen dürfen nicht die grundsätzliche Hinderniszuordnung oder Sichtbarkeit wichtiger Spielinformationen verändern. Eine Reduktion der Detailkosten darf nicht zum sofortigen Einblenden neuer Öffnungen führen. Bei fehlender technischer Unterstützung ist „aus“ einem fehlerhaften Effekt vorzuziehen.

Die separate Nebelabschaltung betrifft ausschließlich den Umgebungsnebel, niemals die Smoke-Granate. Bei einer global tatsächlich verschwindenden Nebelmenge darf das System schlafen; Geländeänderungen müssen bei Wiederaktivierung trotzdem korrekt übernommen werden. Sehr schwacher Wassernebel ist nicht gleichbedeutend mit vollständig ausgeschaltetem Effekt.

### 10.4 CPU- und Ladeverhalten

Nebel benötigt keine neuen Vollwelt-Suchen für jede Figur und jeden Frame. Sichtbare Kandidaten und vorhandene Präsentationsdaten sollen wiederverwendet werden. Geländearbeit wird bei Änderungen gebündelt; die Anzahl der Impulse und aktiven Ressourcen bleibt begrenzt.

Shader und erforderliche Renderziele werden vor dem ersten sichtbaren Einsatz vorbereitet. Eine erste Explosion darf keine große spontane Shaderkompilierung auslösen. GPU-Rücklesungen für alltägliche Entscheidungen, Textur-Neuallokationen bei jeder Kamerabewegung und eine unbegrenzte Aufholsimulation sind ausgeschlossen. Unterstützte Texturformate und Filterung sind bei der technischen Ausarbeitung zu prüfen, nicht stillschweigend vorauszusetzen. [T2]

## 11. Umsetzung in überprüfbaren Ausbauschritten

Die folgenden Schritte sind eine Reihenfolge innerhalb von V1, keine Reduktion des abgestimmten Endumfangs.

| Schritt | Ergebnis und Prüfschwerpunkt |
| --- | --- |
| 1. Zustandsfähiges Fundament | Eigener Renderer, Tageszeitkurve, Map-Faktor, logische Masken und Dichtezustand. Schon hier ein kleines zerstörbares Testgebiet mit echtem randseitigem Nachströmen. Keine reine Overlay-Zwischenarchitektur. |
| 2. Dynamische Arena | Spieler- und Gegnerreaktionen, Explosionen, großflächige Fels- und Basisänderungen, stabile Kamerabewegung und begrenzte Zustandsaufbewahrung. |
| 3. Projektilspuren | Schmale Segmentspuren, unterschiedliche Größen, Abpraller sowie Budgetierung bei P90, Schrot und anderen projektilreichen Situationen. |
| 4. Qualität und Integration | Grafikstufen, Abschaltung, Multiplayer-Prüfung, Lade-/World-Lebensdauer und reproduzierbare Performance-Abnahme. |

Vor größeren Ausbauarbeiten wird das Grundbild im ersten Schritt sichtbar abgestimmt. Wenn feiner Nebel nur mit teuren, qualmartigen Wolken entsteht, wird das Material korrigiert, nicht durch zusätzliche Effektmengen kaschiert.

## 12. Prüfbilder und Abnahmekriterien

Die vorhandenen Test- und Performance-Werkzeuge sollen erweitert werden; eine zusätzliche umfangreiche Wetter-Testanwendung ist nicht Bestandteil des Konzepts. Hilfreich sind lokale Debug-Ansichten für Sperrflächen, Wassergewichtung, Dichte, noch nicht erreichte Öffnungen und Impulsbelegung.

| Prüffall | Erwartung |
| --- | --- |
| Wasser–Rasen–Dirt bei Morgen, Mittag und Nacht | Weiche Verteilung, plausibler Tagesverlauf, nachts kein Eigenleuchten und mittags keine graue Flächendecke. |
| Einzelner zerstörter Fels | Erst freier Boden, anschließend von außen eintreffende Schleier; kein Alpha-Aufploppen. |
| Große Nuke-Freifläche | Mitte bleibt zunächst klar; langsames randseitiges Einströmen, zusätzlich vom Explosionsimpuls beeinflusst. |
| Geschlossene Felswand und schmaler Durchgang | Kein Nebeltransport durch die Wand; Durchgang bleibt funktional und sichtbar plausibel. |
| Basis wird zerstört oder neu gebaut | Nebel hält erhöhte Oberflächen frei und aktualisiert nur die betroffenen Bereiche. |
| Laufen, Stillstand, schneller Gegner, Teleport | Passende Stärke; keine Daueraussparung und keine falschen Verbindungsspuren. |
| P90, Schrot, Raketen, Plasma und Feuerball | Schmale bis breite Reaktionen, keine flackernden Radiergassen und kein unbeschränktes Quellenwachstum. |
| Gleichzeitige Nebel- und Smoke-Granaten-Darstellung | Klare gestalterische Trennung; Smoke-Wirkung und Smoke-Sichtbarkeit bleiben unverändert. |
| Kameraschwenk, Zoom und kurzer Rückweg | Kein Mitschieben am Bildschirm, kein Randsaum und kein sofortiges Zurücksetzen kürzlich erzeugter Schneisen. |
| Host, Client und später Beitritt | Reaktionen sitzen an der dargestellten Bewegung; kein zusätzlicher Nebel-Snapshot-Verkehr erforderlich. |
| Niedrige Qualität und Nebel aus | Zentrale Flächenregeln bleiben korrekt; deaktivierter Nebel erzeugt keine laufende Effektarbeit. |
| Map-Wechsel, Pause und Tab-Rückkehr | Keine alten Impulse, Ressourcenlecks oder große Aufholspitzen. |

Für Leistungsvergleiche laufen dieselbe Map, derselbe Seed, derselbe Kamerapfad und dieselbe Last jeweils ohne Nebel, mit Grundnebel und mit allen Reaktionen. Ruhige Landschaft, Bewegung, Dauerfeuer und Massenzerstörung werden separat betrachtet. Auflösung, Zoom, Grafikprofil, CPU-/GPU-Messmethode sowie Median und hohe Perzentile werden dokumentiert. Ein begrenzter FPS-Wert allein belegt keine freien GPU-Reserven.

V1 ist gestalterisch abgenommen, wenn die Atmosphäre im ruhigen Bild überzeugt und die Effekte im Kampf unterstützend bleiben. Technisch ist sie erst abgenommen, wenn das Nachströmen tatsächlich zustandsabhängig funktioniert und auch unter Last keine Kosten oder Ressourcen unkontrolliert wachsen.

## 13. Bewusste Grenzen und verbleibendes Tuning

Nicht Teil von V1 sind eine vollständige 3D- oder druckerhaltende Strömungssimulation, neue Gameplay-Sichtregeln, meteorologische Feuchte-/Temperaturmodelle, ein allgemeines Wettersystem, individuelle Windkonfiguration je Map, echte volumetrische Lichtstrahlen und die Synchronisierung jedes Nebeldetails zwischen Peers.

Offen bleiben ausschließlich technische und visuelle Abstimmungswerte: Farbton, Dichtebegrenzung, Kurvenstützpunkte, Windstärke, Impulsbreiten, Abklingzeiten, Feldauflösung, Cachegröße und genaue Rendereranbindung. Diese Werte werden am Prototyp entschieden. Sie erfordern vor der Konzepterstellung keine weiteren Produktfragen.

**Leitentscheidung für die Umsetzung:** Qualität entsteht hier durch einen glaubwürdigen fortlaufenden Zustand und passende räumliche Reaktionen – nicht durch möglichst viele Partikel oder eine möglichst vollständige Physiksimulation.

## 14. Quellen und Codebezug

Die Gestaltungsvorgaben beruhen auf den acht bestätigten Entscheidungen und den zuvor vereinbarten Ergänzungen. Codehinweise beziehen sich ausschließlich auf den oben genannten geprüften Commit. Die nachfolgenden technischen Quellen stützen die zugrunde liegenden Verfahren, nicht eine bestimmte Bildqualität oder einen gemessenen Leistungsgewinn in Fragdachse.

### Projektquellen

- **[R1] Rauchrenderer und Material:** [SmokeSystem.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/effects/SmokeSystem.ts), [smokeCloudShader.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/effects/smokeCloudShader.ts).
- **[R2] Tageszeit:** [ArenaTimeOfDayController.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/systems/ArenaTimeOfDayController.ts), [TimeOfDay.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/effects/TimeOfDay.ts).
- **[R3] Schichten und Basisoberflächen:** [config.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/config.ts), [BaseVisuals.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/entities/BaseVisuals.ts), [BaseEntity.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/entities/BaseEntity.ts).
- **[R4] Bewegungsdarstellung:** [MovementEffectsRenderer.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/effects/MovementEffectsRenderer.ts).
- **[R5] Explosionen und visuelle Rückmeldung:** [VisualFeedbackDirector.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/effects/VisualFeedbackDirector.ts).
- **[R6] Wassermasken und kameranahe Ressourcen:** [WaterSurfaceRenderer.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/arena/WaterSurfaceRenderer.ts).
- **[R7] Gemeinsame lokale Verzerrungskarte:** [LocalDistortionComposer.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/effects/distortion/LocalDistortionComposer.ts).
- **[R8] World-bezogene Darstellung:** [WorldPresentationFrameBinding.ts](https://github.com/Dominik-Steinweg/Fragdachse/blob/fd46e6f7c5f5a8b1cdd9184ba94199bfb3665f54/src/world/WorldPresentationFrameBinding.ts).

### Technische Referenzen

- **[T1] NVIDIA GPU Gems, Kapitel 38:** [Fast Fluid Dynamics Simulation on the GPU](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu). Hintergrund zu Dichte-/Geschwindigkeitsfeldern, Transport und Randbedingungen; V1 übernimmt ausdrücklich keine vollständige Flüssigkeitssimulation.
- **[T2] MDN:** [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices). Hintergrund zu Renderauflösung, Bündelung, Ressourcen, Shader-Vorbereitung, Erweiterungen und blockierenden GPU-Aufrufen.

Abruf der externen Referenzen und Abgleich des Repository-Stands: 21. September 2026.
