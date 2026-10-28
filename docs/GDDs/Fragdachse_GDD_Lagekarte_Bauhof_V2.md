# Lagekarte im Bauhof (V2)

Status: Konzept vom 2026-10-27, umgesetzt (P0–P8) am 2026-10-27, Sichtprüfung als Host im Browser;
Überarbeitung (Tageszeit, Ladeanzeige, vorbereiteter Bauhof) am 2026-10-28; Spieltest mit Gästen offen. Ersetzt
[V1](Fragdachse_GDD_Lagekarte_Bauhof_V1.md). Grundlage ist die
[Gameplay-Analyse vom 22.10.2026](../reports/gameplay-review-2026-10-22-inspector-td.md), Vorschlag V1.
Die Entscheidungen hat der Projektinhaber am 22., 27. und 28.10.2026 getroffen.

## 1. Anlass

Für Tower-Defense-Spieler, vor allem den Inspector Gadachs, findet die Planung **zwischen den Runden**
statt. Geplant wird die persistente Basis im Bauhof. Der Bauhof zeigt heute aber eine leere Fläche,
nicht die nächste Mission. Gleichzeitig wechseln die Angriffsrichtungen von Map zu Map stark.

Drei weitere Lücken:
- **Nur der Host kann den Bauhof öffnen.** Gäste bringen ihren Beitrag in jeden Raum mit, können ihn
  dort aber weder sehen noch anpassen.
- **Der Bauhof zeigt nur den eigenen Beitrag,** nicht die Beiträge der Mitspieler, mit denen der Host
  die Basis in der Mission zusammenführt.
- **Die Ausrichtung der Basis ist eine Sonderregel.** Nur Map 16 dreht die Basis (`open-right`), und
  auch dort nur die Belohnungen, nicht die persönlichen Bauwerke.

## 2. Ziele und Nicht-Ziele

**Ziele**
- Im Bauhof die vom Host gewählte Map um die Basis zeigen: Gelände, Angriffsrichtungen und die Wege
  der Gegner, **wo sie für die Basis Bedeutung haben.**
- Die Basis bleibt **ein** globaler Grundriss. Der Host kann die ganze Basis in Vierteldrehungen
  ausrichten.
- Alle Spieler eines Raums planen ihren eigenen Teil und sehen dabei die Teile der Mitspieler.
- Die Routen sind hochwertig dargestellt: eine fließende Void-Strömung statt Linien und Pfeilen.

**Nicht-Ziele**
- Keine Änderung an der Lobby-World und keine Markierungen dort.
- Kein zusätzlicher Platz auf den Maps. Reservierung und Bauradius bleiben unverändert.
- Keine Grundrisse pro Map und keine automatischen Vorschläge für die Aufstellung.
- Keine Angaben zur Stärke der Bedrohung, zu Gegnertypen oder zum Zeitplan der Wellen.
- Am Ablauf in der Mission ändert sich nichts.

## 3. Entscheidungen

| # | Entscheidung |
|---|---|
| E1 | Die Lagekarte liegt im **Bauhof-Editor**. |
| E2 | Gezeigt wird die **vom Host gewählte Coop-Map**. Wechselt der Host die Map, lädt die Lagekarte neu; der Entwurf bleibt erhalten. |
| E3 | **Detailbereich plus Miniübersicht.** Der Detailbereich reicht etwa 20 Zellen um den Anker. Die Miniübersicht zeigt die ganze Map mit Basis, Spawnzonen, Routen und dem Rahmen des Detailbereichs. |
| E4 | **Nur Richtungen.** Keine Stärke, keine Gegnersymbole, keine Zeitangabe. |
| E5 | **Volle Routen** im Zustand beim Missionsstart, neu berechnet nach jedem Umsetzen und Drehen. |
| E6 | **Mitspieler** erscheinen wie in der Mission in ihrer Spielerfarbe und lassen sich nicht bearbeiten. |
| E7 | **Ein globaler Grundriss.** Einzelnes Umsetzen bleibt wie heute. |
| E8 | **Keine Ausrichtung durch die Map.** Kein Map-Authoring legt eine Ausrichtung fest; die Sonderstellung von Map 16 entfällt. **Nur der Host dreht die ganze Basis** per „Drehen 90°“ im Uhrzeigersinn. Die Drehung gilt für alle Bauwerke aller Spieler, die Belohnungen und die Startwinkel der Türme. |
| E9 | **Gäste bearbeiten ihren eigenen Teil.** Der Host prüft jede Änderung. Belohnungen und Drehung sehen Gäste nur an. |
| E10 | **Basis-Belohnungen verwaltet nur der Host:** Platzieren, Verschieben und Rückbau, in der Welt wie im Bauhof. Dass Gäste das bisher in der Welt durften, war ein Fehler. |
| E11 | **Konflikte sind sichtbar.** Ein Objekt, das der Host auf dieser Map aussortieren würde, wird markiert und nennt den Grund. |
| E12 | **Reichweitenringe** der eigenen Türme lassen sich einblenden. |
| E13 | **Der Einsatz-Seed wird in der Lobby festgelegt.** Damit zeigt die Lagekarte das echte Gelände der nächsten Runde. Nach jedem Rundenstart und bei jedem Map-Wechsel gibt es einen neuen Seed. |
| E14 | **Ansicht wie in der Mission:** Norden oben. Das Gelände wird nie gedreht; nur die Basisobjekte erscheinen mit der Drehung des Hosts. |
| E15 | **Wege zum Spieler zählen.** Das Ziel einer Route ergibt sich wie in der Mission aus der Gegnerart: Basisstürmer laufen zu den Zielbasen, Jäger zur erwarteten Spielerposition. |
| E16 | **Die Vorschau erscheint nur, wo sie Sinn ergibt.** Der Anzeigemodus folgt aus den Routen (Abschnitt 6.3). Maps mit vorgelagerter Basis zeigen Gelände, Hinweis und die Routen in der Miniübersicht. |
| E17 | **Routenstil „Void-Strömung“.** Violetter Void-Dunst wabert im Shader zur Basis, darunter eine Bodenspur; keine weißen Funken. Spawnzonen atmen mit dem Void-Dunst, Eintrittspunkte glühen, „Kein freier Weg“ erscheint als Druckwelle. Keine geraden Linien und keine Pfeile. |

## 4. Ablauf für den Spieler

1. Der Host wählt eine Map, zum Beispiel Map 19.
2. Ein Spieler, Host oder Gast, öffnet den Bauhof. Sein Bereit-Status wird wie heute zurückgesetzt.
   Der Bauhof ist meist schon in der Lobby vorbereitet und öffnet sofort. Sonst zeigt ein Ladefenster
   „Gelände wird erkundet …“ bzw. „Lagekarte wird gezeichnet …“ mit Fortschritt und Abbrechen.
3. Die Lagekarte zeigt das Fort mit Fackeln und Feuerschalen, rundherum Felsen, Bäume, Wasser und
   Gleise von Map 19. Aus den Spawnzonen strömt die Void-Strömung zur Basis; wo sie in den Baubereich
   eintritt, glüht der Rand. Die Bauwerke der Mitspieler stehen in ihrer Farbe.
4. Der Host stellt fest, dass die Raketentürme nach Westen stehen, die Strömung aber von Osten kommt.
   Er dreht die Basis zweimal um 90°. Danach setzt ein Gast zwei Barrieren um, und die Strömung
   verlagert sich sichtbar.
5. Ein Turm ist rot markiert: „Entfällt auf dieser Map: Kollision mit Bauwerk von Spieler B“. Der
   Spieler setzt ihn um.
6. Er übernimmt die Änderung. Der Host prüft sie, und der neue Grundriss gilt global.

## 5. Darstellung

Die Darstellung folgt [`visual-guidelines.md`](../ai/visual-guidelines.md) und dem Fort-Vertrag in
[`rendering.md`](../ai/rendering.md).

- **Fort wie in der Mission:** Die Lagekarte nutzt dieselbe Verdrahtung von Basis und Fort wie die
  Mission: Fort, Fackeln und Feuerschalen mit GPU-Partikeln, Sonnen- und Fortschatten und
  Turm-Mesh-Schatten. Die Fort-Grafik wird nie gedreht; der Kern ist unter Vierteldrehungen
  deckungsgleich.
- **Detailbereich:** Gelände der Map in echten Weltkoordinaten, ohne Simulation, zur Startzeit der
  Mission und mit dem Farbgrading ihres Starts. Die Übersicht nennt die Uhrzeit („Einsatzbeginn“).
  Spawnzonen im Bild tragen ihren Void-Dunst wie in der Mission.
- **Void-Strömung (Routen):**
  - **Bodenspur:** eine dunkle, feuchte Void-Verfärbung unter der Route. Wo sich Routen
    überlagern, wird sie breiter und kräftiger.
  - **Strom:** Violetter Void-Dunst treibt in zwei Schichten zur Basis und rollt dabei über sich
    selbst; hellere Schlieren statt Funken. Die Phase hängt an der Distanz zum Ziel, darum fließen
    zusammenlaufende Routen ohne Bruch weiter.
  - **Verzweigungen:** Der am besten ausgerichtete Arm läuft in einer Rundung weiter; die übrigen fließen in den
    Stamm aus oder aus ihm heraus. Breite und Helligkeit wechseln weich, ein Strom löst sich hinter seinem Ziel auf.
  - **Quellen:** Spawnzonen stehen wie in der Mission kurz vor einer Freigabe: dichter Void-Dunst und
    violetter Nebel, der langsam atmet. Der Strom sammelt sich darin, breit und blass im Zentrum, und tritt
    am Zonenrand als Strom heraus. Kein eigenes Zeichen an der Quelle.
  - **Nebel:** Der Bodennebel der Runde liegt auch über der Lagekarte, mit ihrer Startzeit; um den
    Baubereich bleibt die Luft klar. Die Ströme tragen Void-Dunst: Der Nebel färbt sich entlang der Wege
    violett und verdichtet sich leicht, Sporen treiben mit, und dicke Bänke verschleiern das Leuchten des
    Stroms, statt dass es darüber liegt.
  - **Eintrittspunkte:** Wo eine Route in den Baubereich eintritt, glüht der Rand.
  - **Kein freier Weg:** Der Strom läuft heiß gegen die Mauer und erzeugt einen Druckring. Dazu
    erscheint die Warnung „Kein freier Weg – Gegner brechen durch“.
  - **Lage:** Das Leuchten des Stroms liegt über den Baumkronen; Dunst und Bodenspur bleiben am Boden.
- **Mitspieler:** in Spielerfarbe wie in der Mission, nicht anwählbar.
- **Konflikte:** pulsierender roter Halo am Objekt und ein kurzer Grund in der Liste rechts.
- **Reichweitenringe:** ein Schalter für alle eigenen Türme. Das ausgewählte Objekt zeigt seinen Ring
  immer.
- **Miniübersicht:** die ganze Map, Norden oben, mit Basis, Spawnzonen, dem Rahmen des Detailbereichs
  und der Strömung in einer zweiten, feineren Instanz. Eine Legende darunter nennt nur, was die Map zeigt.
- **Aufteilung:** Links steht die World in einem festen Rahmen; was die Map nicht füllt, ist dunkles
  Passepartout. Eine Kopfzeile trägt links Stufe und Basis-HP, rechts „Drehen 90°“ und „Reichweiten“ und
  über der rechten Spalte Titel und Einsatzbeginn der Lagekarte. Rechts folgen Übersicht, Legende,
  Hinweis und die Simulationsschalter, darunter die Liste. Unten stehen nur „Abbruch“ und „Übernehmen“.

## 6. Regeln

### 6.1 Einsatz-Seed
- Der Host besitzt den Einsatz-Seed. Er wird zusammen mit der Map in der Lobby-Synchronisation
  (`lsy`) veröffentlicht.
- **Neu gewürfelt wird:**
  - beim ersten Veröffentlichen;
  - bei einem echten Map- oder Programmwechsel;
  - direkt nach jedem Rundenstart. Damit bekommt die Lobby nach jeder Runde frisches Gelände.
- Der Rundenstart verwendet genau diesen Seed. Ein Szenario-Seed setzt dasselbe Feld; es gibt keine
  Vorrangkette.
- Die Lagekarte erzeugt das Layout mit demselben Generator und derselben vollen Map-Konfiguration
  wie der Rundenstart, im Hintergrund und zwischengespeichert.
- Das Layout kann danach direkt an den Rundenstart übergeben werden, wenn Seed und Fingerprint
  übereinstimmen.

### 6.2 Ausrichtung und Bezugsrahmen
- Blueprints und Belohnungen werden **kanonisch** gespeichert.
- Die Drehung des Hosts (`quarterTurns`, 0–3) gehört zum Basisdokument des Hosts. Dort stehen auch
  die Belohnungen. Sie wird in der Mission eingefroren.
- **Eine** Transformation bildet kanonische Zellen, Grundflächen und Turmwinkel auf die Welt ab und
  zurück. Sie gilt für alle Basisobjekte aller Spieler.
- Gültigkeit im Baubereich hängt nicht von der Drehung ab, weil Kern und Baubereich unter
  Vierteldrehungen deckungsgleich sind.

### 6.3 Ziele der Routen und Anzeigemodus
Alle Eingaben kommen aus denselben Funktionen, die auch die Mission benutzt.

**Eingaben**
- **Zielbasen G:** die Basen, die beim Missionsstart Ziel der Gegner sind. Grundlage sind die
  Basisdeskriptoren, die Zielwahl der Map (`enemyTargeting`) und `isBaseGoalSource`. Basen mit
  Ziel-Bindung zählen nur, wenn ihr Ziel bei t = 0 startet.
- **Spawnfokus F der Spieler:** `missionProgress.startArea`, sonst die freundliche Hauptbasis nach
  derselben Regel wie der Spieler-Spawn.
- **Erwartete Spielerposition P einer Gruppe:**
  - nach einem Checkpoint: der Checkpoint;
  - nach einer anderen Begegnung: P des Vorgängers;
  - bei einer Site: deren Lichtung;
  - sonst: F.

**Ziel je Gegnergruppe** (nach `movementTarget` der Gegnerart)
- Basisstürmer laufen zu G, wenn G nicht leer ist. Wie in der Mission gewinnt die nächste Zielbasis.
- Alle anderen laufen zu P.
- Fliehende Gegner bekommen keine Route.

**Relevanz:** Eine Route zählt, wenn sie im Detailbereich endet.

**Anzeigemodus**

| Modus | Bedingung | Maps (Stand 2026-10-27) |
|---|---|---|
| Lagekarte | mindestens eine relevante Route | 02, 03, 06, 08, 10, 11, 13, 15, 18, 19, 20 |
| Gelände, Hinweis, Übersicht | Routen enden außerhalb. Hinweis „Front an der vorgelagerten Basis“, wenn sie an einer anderen Basis enden; „Gegner jagen die Spieler unterwegs“, wenn sie an einer Spielerposition enden | 04, 05, 12, 14, 17 und 16 |
| Nur Hinweis | keine persistente Basis oder Dawn | 00, 01, 07, 09 und Dawn |

### 6.4 Baubereich und Konflikte
- Der Baubereich ist der, den die Mission einfrieren würde: die Ausbaustufe des Hosts, begrenzt
  durch die Map.
- Konflikte berechnet dasselbe Zusammenführen wie die Mission (`PersistentBaseComposite`), mit der
  Drehung des Hosts. Die Kapazität ist exakt für den eigenen Beitrag. Für Mitspieler gilt sie als
  unbegrenzt, weil ihre Kapazität auf einem Gast nicht bekannt ist.

### 6.5 Laufwege
- Die Routen nutzen die Flowfield-Berechnung der Mission:
  - dasselbe Navigations-Setup;
  - dieselbe Spawnquellen-Regel wie der Generator;
  - dieselbe Hindernisgeometrie (`ArenaObstacleIndex`), hier aus Daten statt aus Phaser-Körpern.
- Ein Vertragstest hält die Geometrie aus Daten deckungsgleich mit der Mission.
- Topologie beim Missionsstart: Barrieren und Brücken im Anfangszustand, dazu die zusammengeführte
  Basis.
- Neu berechnet wird gebündelt nach dem Loslassen eines Objekts und nach dem Drehen.
- Die UI nennt die Strömung „Hauptroute“. In der Mission können Gedränge, Ausweichen und
  Durchbruch davon abweichen.

### 6.6 Gäste
- Gäste öffnen den Bauhof, sobald ihre Basis freigeschaltet ist.
- Gespeichert wird über die vorhandene Host-RPC `pble`. Der Host prüft Phase, Bereit-Status,
  World-Revision und Beitrags-Revision. Ein veralteter Entwurf meldet `stale` und wird neu geladen.

## 7. Architektur und Ownership

| Thema | Owner und Grenze |
|---|---|
| Lagekarte | Lokale Präsentation im Bauhof über einer lokalen, nicht teilnehmenden World. Keine Activity, keine Participation, keine Netzwerkidentität. |
| Drehung | Basisdokument des Hosts, gemeinsam mit den Belohnungen. Repliziert über `pbrs`, in der Mission eingefroren. |
| Bezugsrahmen | `PersistentBaseFrame` ist die einzige Transformation zwischen kanonisch und Welt. |
| Ziele und Modus | Reine Funktion aus authored Daten und denselben Zielregeln wie die Mission. |
| Laufwege | Gemeinsames Navigations-Setup und gemeinsamer Hindernis-Index. Kein zweites Wegmodell. |
| Darstellung der Routen | Eigene GPU-Schicht; die CPU arbeitet nur bei einer Neuberechnung, nicht pro Partikel. |
| Konflikte | `PersistentBaseComposite` bleibt die einzige Regel. |
| Autorität | Unverändert: Der Host prüft beim Speichern und beim Rundenstart. |
| Wire | `lsy` bekommt den Seed, `pbrs` die Drehung. `pble` bleibt unverändert. `PEER_PROTOCOL_VERSION` wird erhöht. |
| Map-Authoring | Das Feld `orientation` entfällt und wird abgelehnt. Sonst keine neuen Felder. |

## 8. Umsetzungspakete

| Paket | Inhalt |
|---|---|
| P0 | Basis-Belohnungen nur für den Host |
| P1 | `PersistentBaseFrame`, Drehung im Basisdokument des Hosts, Map-Ausrichtung entfernt |
| P2 | Gäste im Bauhof, Editor im Weltrahmen, „Drehen 90°“ |
| P3 | Einsatz-Seed |
| P4 | Layout-Cache mit Worker |
| P5 | Map-World im Bauhof mit Fort wie in der Mission, Miniübersicht, Mitspieler, Konflikte, Reichweitenringe |
| P6 | Routenmodell: Ziele, Anzeigemodus, Geometrie, Nachzeichnen |
| P7 | Void-Strömung als GPU-Schicht |
| P8 | Vorab erzeugtes Layout beim Rundenstart |

## 9. Grenzen in V2

- Das Wechselverhalten einzelner Gegner (`engage`, `basePreference` der Kabummtula) wird nicht
  abgebildet.
- Amphibische Gegner bekommen ihre Route ab dem nächsten erreichbaren Ufer.
- Auf Zerstörungsmaps (12, 13, 17) ist die Spielerposition für Jäger nur eine Näherung.
- Map 18 und Map 19 haben dieselben vier Spawnzonen. Weil die Lagekarte nur Richtungen zeigt, ist
  die Hauptrichtung nicht ablesbar. Nach dem Spieltest neu bewerten.
- Eine Lagekarte für Dawn gibt es nicht. Die Dawn-Pläne hängen vom Fortschritt des Hosts ab.

## 10. Entscheidungslog

- 2026-10-22: Lagekarte im Bauhof, keine Markierungen in der Lobby-World (E1). Keine Grundrisse pro
  Map (E7).
- 2026-10-22: Detail plus Miniübersicht, nur Richtungen, volle Routen, Gäste bearbeiten ihren Teil
  (E3–E5, E9).
- 2026-10-22: Einsatz-Seed in der Lobby (E13).
- 2026-10-22: Keine Map-Ausrichtung. Nur der Host dreht die ganze Basis (E8). Basis-Belohnungen
  verwaltet nur der Host (E10). Ansicht wie in der Mission (E14).
- 2026-10-27: Wege zum Spieler zählen. Die Vorschau erscheint nur, wo sie Sinn ergibt (E15, E16).
  Maps mit vorgelagerter Basis zeigen Gelände, Hinweis und Übersicht.
- 2026-10-27: Routenstil Void-Strömung (E17). Darstellung des Forts wie in der Mission, inklusive
  Fackeln, Feuerschalen und Turmschatten.
- 2026-10-27 (Sichtprüfung): Statt weißer Funken bewegt sich violetter Void-Dunst.
- 2026-10-28: Die Lagekarte zeigt die Tageszeit der Map statt einer festen Tageszeit. Ein Ladefenster
  überbrückt den Aufbau.
- 2026-10-28 (zweite Runde): Der Bauhof wird in der Lobby vorbereitet. Eine langlebige Bühne hält World,
  Rahmen und Übersicht für das Gelände der nächsten Runde; jede Sitzung legt nur Entwurf, Liste und Werkzeuge
  darüber. Aufgebaut wird in kleinen Schritten; schwere Schritte warten, bis der Spieler steht oder ein Menü
  offen ist. Nach einem Mapwechsel wartet der Aufbau drei Sekunden, in Bauhof-Nähe nicht. Vor dem Rundenstart
  wird die Bühne abgebaut. Auf allen Qualitätsstufen; ein dezenter Spinner an Button und Shift-Schild zeigt die
  Vorbereitung. Messbericht: [Bauhof-Vorbereitung](../reports/bauhof-vorbereitung-2026-10-28.md).
- 2026-10-28 (Playtest-Feedback): Nach einem Mapwechsel wartet die Vorbereitung nur 0,5 s. Die Übersicht färbt
  gegnerische Basen, Vorposten und Spawnbauwerke violett und zeigt Brücken. Schalter unter der Übersicht
  simulieren „Vorposten zerstört“ (eigene Basen vor der persistenten Basis fallen, Gegner und Spieler weichen
  zu ihr zurück), „Brücke gesprengt“ und „Teleporter aktiv“; jede Sitzung beginnt im Zustand des
  Missionsstarts. Jede Route endet am Außenrand der Basis, die sie erreicht, statt bei manchen erst an der
  Feuerstelle. Die Strömung leuchtet nachts stärker, trägt violette Void-Partikel wie der Void-Nebel und
  lässt den Boden entlang der Wege violett schimmern.
- 2026-10-28 (Layout): Fester World-Rahmen statt eines Rahmens, der mit der Map springt. Die Werkzeuge
  wandern aus der Zeile der Hauptaktionen in die Kopfzeile. Die Übersicht wird größer und bekommt eine
  Legende. Schalter (Reichweiten, Simulation) zeigen ihren Zustand als Kästchen. Die Liste ist kürzer
  und meldet „leer“ mittig.
- 2026-10-28 (Strom, Ausschnitt, Spawnzonen): Die Strömung wird als Striche gezeichnet. An Verzweigungen läuft der am
  besten ausgerichtete Arm in einer Rundung weiter, die übrigen fließen in den Stamm aus oder aus ihm heraus; Breite und
  Helligkeit wechseln weich. Ein Strom löst sich hinter seinem Ziel auf.
  Der Ausschnitt hat das Seitenverhältnis des Panels und füllt es; am Kartenrand verschiebt er sich, statt
  abgeschnitten zu werden. Spawnzonen sind rund (siehe Void-Gefahrenzonen V1).
- 2026-10-28 (Quellen, Nebel): Die Wirbel an den Quellen entfallen. Spawnzonen stehen im aktiven Zustand
  (Warnstärke 0,8–1, atmend) mit Void-Dunst und Nebel wie in der Mission; der Strom sammelt sich darin und
  tritt am Zonenrand heraus. Der Bauhof zeigt den Bodennebel der Runde (Spielereinstellung gilt), der
  Baubereich bleibt über einen weichen Nebelstempel frei. Gemessen: etwa 0,2 ms CPU je Frame, rund 18 ms im
  ruhegebundenen Aufbauschritt, 30 MB GPU-Speicher; Öffnen und Lobby unverändert. Die Ströme legen Void-Dunst
  entlang ihrer Wege (Nebelfarbe, Bodenschleier, Sporen), dicker Nebel verschleiert ihr Leuchten.
