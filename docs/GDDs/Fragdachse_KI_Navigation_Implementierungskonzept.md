# Fragdachse – KI- und Navigationskonzept

## Verlässliche Gegnerbewegung, nachvollziehbare Ziele und Vorbereitung auf große Schwärme

**Version:** 1.0  
**Datum:** 15. September 2026  
**Status:** Implementierungskonzept auf Basis der geklärten Anforderungen; noch nicht implementiert oder durch neue Spielmessungen validiert.  
**Zuletzt geprüfter Repository-Stand:** `main`, Commit `468d177b913a049f7dcf0667388c00b76f0d5a70` – „DeathFragment Performance“.  
**Erster Lieferumfang:** bessere KI für die bestehenden Gegner einschließlich verbündeter/wiederbelebter Einheiten; Leistungsziel stabile 60 FPS bei 100 Gegnern im Solospiel auf dem bisherigen High-End-Test-PC.  
**Späterer Ausbau:** mehrere hundert einfache Schwarmgegner gleichzeitig, weiterhin gemeinsam mit wenigen aufwendigeren Spezialgegnern.

> **Leitentscheidung:** Das 32-px-Weltraster bleibt bestehen. Die Navigation verwendet ein darauf ausgerichtetes 16-px-Punktraster, gemeinsam genutzte Flowfields und körperbewusste lokale Bewegung. Bewegung und Angriffe folgen einer gemeinsamen Absicht. Ein Mauerdurchbruch ist ein eigener, begründeter Auftrag – niemals die automatische Folge eines kurzen Stillstands.

### Verbindlichkeit dieses Dokuments

Die vereinbarten Spielregeln und der erste Lieferumfang sind verbindlich. Vorgeschlagene Modulnamen, Datenverträge, Rechenbudgets und Tuningwerte sind Umsetzungshilfen. Sie dürfen verbessert werden, solange Verhalten, Zuständigkeiten und Abnahmekriterien erhalten bleiben. Mit **Startwert** gekennzeichnete Zahlen sind keine Messergebnisse und keine zusätzlichen Nutzeranforderungen.

Die 16-px-Auflösung ist die gewählte technische Zielrichtung, nicht ein nachgewiesenes Performance-Optimum. Ihr Nutzen muss durch Geometrie- und Vergleichstests belegt werden. Das Konzept verlangt weder eine neue Engine noch einen vollständigen KI-Framework-Umbau.

## Inhalt

1. [Ziele und geklärte Anforderungen](#anforderungen)
2. [Lieferumfang und Abgrenzung](#umfang)
3. [Befund im Repository](#befund)
4. [Zielarchitektur und Zuständigkeiten](#architektur)
5. [16-px-Navigation auf einer 32-px-Welt](#geometrie)
6. [Geteilte Flowfields und Erreichbarkeit](#flowfields)
7. [Gemeinsame Zielentscheidung](#zielwahl)
8. [Angriffspositionen und Kampfausführung](#angriff)
9. [Lokale Bewegung, Separation und Verdrängung](#bewegung)
10. [Dichte und Stauvermeidung](#dichte)
11. [Fortschritt, Warten und Recovery](#recovery)
12. [Gezielter Durchbruch](#durchbruch)
13. [Dynamische Welt und Aktualisierungstakte](#aktualisierung)
14. [Spezialfähigkeiten und Verbündete](#faehigkeiten)
15. [Skalierung und Performance](#performance)
16. [Datenverträge und Konfiguration](#vertraege)
17. [Integration und Umsetzungsschritte](#umsetzung)
18. [Tests, Messung und Abnahme](#abnahme)
19. [Risiken und bewusste Nicht-Ziele](#risiken)
20. [Quellen und Übergabe](#quellen)

---

<a id="anforderungen"></a>
## 1. Ziele und geklärte Anforderungen

### 1.1 Die sechs übergeordneten Ziele

| Ziel | Gewünschtes Ergebnis |
|---|---|
| A – zuverlässige Navigation | Gegner bleiben deutlich seltener an Felsen und Engstellen hängen. Hindernisangriffe erfolgen nur bei einer tatsächlich notwendigen Wegöffnung. |
| B – nachvollziehbare Zielwahl | Ein Spielerjäger greift keine Basis an, nur weil er zufällig daran vorbeiläuft. |
| C – natürliche Gruppenbewegung | Gegner weichen sinnvoll aus, nutzen freie Angriffspositionen und überfüllen Engstellen nicht unnötig. |
| D – Skalierbarkeit | Die Architektur vermeidet unnötige Arbeit pro Gegner und hält den späteren Weg zu großen Schwärmen offen. |
| E – unterschiedliche Komplexität | Einfache Massengegner und aufwendigere Spezialgegner können gleichzeitig existieren. |
| F – früh nutzbarer Mehrwert | Zuerst müssen die bestehenden Gegner bis 100 Einheiten besser funktionieren. Der neue Schwarmgegner folgt später. |

### 1.2 Verbindliche Entscheidungen aus der Anforderungsklärung

| ID | Festlegung |
|---|---|
| R01 | Ein Gegner darf zu einem anderen Ziel wechseln, wenn es deutlich günstiger erreichbar ist. Kleine Schwankungen sollen keine ständigen Wechsel auslösen. |
| R02 | Ist der bisherige Spieler nur durch einen Durchbruch erreichbar, ein anderer gültiger Spieler aber über einen freien Weg, wird der erreichbare Spieler gewählt. |
| R03 | Ohne gültiges Spielerziel ist das Ersatzverhalten pro Gegnerart konfigurierbar. Standard: zur Basis; existiert keine geeignete Basis, zur letzten bekannten Spielerposition. |
| R04 | Basisangreifer dürfen ihre Belagerung für nahe Spieler nur unterbrechen, wenn ihre Gegnerart das ausdrücklich erlaubt. Standard: keine Unterbrechung. |
| R05 | Unbeabsichtigter Kollateralschaden bleibt möglich. Zielwahl und tatsächliche Treffer-/Schadensregeln werden nicht gleichgesetzt. |
| R06 | Geringe gegenseitige Überlappung von Gegnern ist akzeptabel. Vollständige physikalische Trennung jedes Körpers ist kein Ziel. |
| R07 | Leichte gegenseitige Verdrängung ist erwünscht, sofern sie sichtbar hilft und im Performancebudget bleibt. Große Gegner sollen schwerer verdrängbar sein. |
| R08 | Auch längere Umwege sind erlaubt, wenn sie wegen geringeren Staus voraussichtlich schneller zum Ziel führen. |
| R09 | Warteschlangen an unvermeidbaren Engstellen sind akzeptabel, solange zuverlässig nachgerückt wird. Bei heutigen Mengen sind sie noch kein zentrales Problem. |
| R10 | Nahkämpfer sollen freie Angriffspositionen um Spieler und Basen nutzen, statt sich ausschließlich hinter bereits angreifenden Gegnern zu sammeln. |
| R11 | Notwendige Durchbrüche dürfen Spielermauern, natürliche Felsen und blockierende, zerstörbare Türme beziehungsweise andere Konstrukte betreffen. |
| R12 | Auch ein Spielerjäger darf als letzten Ausweg eine feindliche Basis als Wegsperre angreifen. Das ist kein allgemeiner opportunistischer Basisangriff. |
| R13 | Jede normale Gegnerart soll grundsätzlich einen notwendigen Durchbruch schaffen können. Vorhandene Bite-Angriffe werden bevorzugt; ein fehlender geeigneter Angriff muss ergänzt werden. |
| R14 | Durchbruchsstellen werden nach geschätzter Gesamtdauer aus Anmarsch und Zerstörung gewählt, nicht allein nach Luftlinie. |
| R15 | Nahe Gegner sollen bevorzugt gemeinsam eine Öffnung schaffen. Kein unnötiges Aufteilen auf viele parallele Baustellen. |
| R16 | Ungefähr 250 ms bis zur Routen-Neuentscheidung nach einer relevanten Weltänderung sind akzeptabel. Kollisionsschutz und zeitkritische Spielregeln bleiben unmittelbar wirksam. |
| R17 | Die grundsätzlichen Anforderungen bestehender Sonderfähigkeiten bleiben erhalten. Ihre technische Implementierung darf umgebaut werden. |
| R18 | Wiederbelebte und sonstige verbündete Gegner erhalten die verbesserte Bewegung bereits im ersten Lieferumfang. |
| R19 | Leistungsziel: stabile 60 FPS auf dem bisherigen High-End-Test-PC, im Solospiel mit 100 Gegnern einschließlich normalem Kampfgeschehen. |
| R20 | Besonders wichtige Problemfälle sind felsreiche, dicht bebaute Maps. Fehlerhafte Basisangriffe sind unabhängig von einer bestimmten Map zu beheben. |
| R21 | Welt, Baupositionen und die meisten Hindernisse bleiben auf dem 32-px-Raster. Seltene runde Baumstümpfe müssen trotzdem geometrisch korrekt berücksichtigt werden. |
| R22 | Normale Gegner passen überwiegend durch 32-px-Lücken; größere Bosse benötigen eigene passende Bewegungsprofile. |

**Nicht vereinbart:** ein 60-FPS-Versprechen für Mittelklasse-PCs, fünf Koop-Spieler oder bereits 500–1.000 Gegner. Bestehende Koop-Funktionalität darf dennoch nicht beschädigt werden.

### 1.3 Ergänzende Designentscheidungen dieses Konzepts

Für bisher nicht vollständig ausformulierte Randfälle gelten folgende konservative Regeln:

- **„Basis als letzter Ausweg“:** Zuerst werden freie Wege geprüft, dann Durchbrüche ohne Basisschaden. Erst wenn innerhalb dieser zulässigen Möglichkeiten kein Weg herstellbar ist, darf eine angreifbare feindliche Basis Bestandteil des Durchbruchs werden. Innerhalb derselben Erlaubnisstufe zählt die geschätzte Gesamtdauer.
- **Keine bekannte Position:** Gibt es weder gültiges Spielerziel noch geeignete Basis noch eine zulässig gespeicherte letzte Spielerposition, hält der Gegner an einem sicheren Ort und prüft später erneut. Keine erfundene Zielposition.
- **Verbündete:** Die Verbesserung ihrer Bewegung ändert nicht ihre Fraktion oder ihr Recht, Schaden zu verursachen. Sie zerstören insbesondere nicht automatisch die eigenen Spielermauern oder Basen.
- **Angriffsreichweite statt Zielmittelpunkt:** Ein Gegner, der von einer sicher erreichbaren Position aus sein Ziel regelkonform angreifen kann, benötigt nicht allein deshalb einen Durchbruch, weil er den Mittelpunkt dieses Ziels nicht erreichen kann.

---

<a id="umfang"></a>
## 2. Lieferumfang und Abgrenzung

### 2.1 Erster Lieferumfang

Der erste Lieferumfang umfasst das neue Navigationsraster, gemeinsame Zielabsichten, körperbewusste Bewegung, lokale Gruppeninteraktion, Angriffspositionen, Recovery, Durchbruchsplanung, dynamische Hindernisaktualisierung und die Integration bestehender Spezial- und Ally-Verhaltensweisen. Ein leichter Dichte-Einfluss gehört dazu; ausgefeilte großräumige Schwarmorganisation ist noch kein Lieferziel.

Erfolgreich ist dieser Umfang, wenn eine gemischte Gruppe heutiger Gegner bei 20, 50 und 100 Einheiten nachvollziehbarer und zuverlässiger agiert als vorher. Ein deutlich reduziertes Festhängen auf felsreichen Maps hat Vorrang vor einem besonders spektakulären Flüssigkeitseffekt.

### 2.2 Späterer Ausbau

Später kommt ein einfacher, sehr kleiner und schneller Kontakt-Explosionsgegner hinzu. Er verwendet denselben Navigations- und Bewegungsunterbau, erhält aber ein bewusst schlankes Verhaltens- und Darstellungsprofil. Lasttests mit 250, 500 und gegebenenfalls 1.000 Einheiten bestimmen dann weitere Optimierungen.

### 2.3 Ausdrücklich nicht Teil des ersten Umbaus

Keine neue Physikengine, keine echte Flüssigkeits- oder Sandsimulation, keine vollständige GPU-KI, kein generischer Behavior-Tree-/GOAP-Baukasten, kein vollständiger Ersatz der Kampf- oder Netzwerkarchitektur und keine neuen Gegnerinhalte. 16 px sind eine Navigationsauflösung und keine Änderung am Bauraster oder an den Kollisionsgrößen.

---

<a id="befund"></a>
## 3. Befund im Repository

Die nachfolgend genannten Stellen wurden für dieses Dokument am oben angegebenen Commit erneut gelesen. Der neuere Commit ersetzt den in der Vorbesprechung verwendeten Stand `f18541ee`; die hier relevanten Zielwahl-, Bewegungs- und Flowfield-Pfade zeigen weiterhin die beschriebenen Ansatzpunkte. Dies ist eine Quellcodeprüfung, keine neue Browser-Performanceanalyse.

| Bereich | Beobachtung | Konsequenz |
|---|---|---|
| `EnemyManager.hostUpdateMovement()` | Wählt je nach Konfiguration unterschiedliche Flowfields und verarbeitet zahlreiche Bewegungs-Overrides; im regulären Pfad werden Flowrichtung, Separation und Glättung kombiniert. | Bewegungsentscheidung und Ausführung klarer bündeln, ohne Sonderfähigkeiten zu verlieren. [S2] |
| `CoopDefenseEnemyAttackSystem` | Allgemeine Zielauswahl beginnt bei Basen; Basen können höhere Priorität als lebende Ziele haben. Bewegungsauftrag und Waffen-Zielsuche sind nicht dieselbe Entscheidung. | Eine gemeinsame Zielabsicht muss den erlaubten Angriffskontext vorgeben. [S3] |
| Hindernisangriffe | `isObstacleAttackUnlocked()` erlaubt den Angriff nach `blockedMs` beziehungsweise bei einem aktiven `clearingObstacle`; ein gültiger Weg wird dort nicht nachgewiesen oder ausgeschlossen. | Stillstand löst Recovery aus; Durchbruch benötigt einen getrennten Nachweis. [S4] |
| `FlowFieldSources` | Weltzellen werden direkt in Navigationsraster eingetragen; ein koordinatenbasiertes Änderungsereignis schaltet eine Zelle. | Welt- und Navigationskoordinaten müssen zentral entkoppelt werden. [S5] |
| `FlowFieldCoordinator` | Worker-Berechnung, begrenzte laufende Jobs, Pufferverwaltung sowie versionierte Snapshots und atomare Aktivierung existieren bereits. | Diese Mechanik weiterverwenden, nicht parallel nachbauen. [S6] |
| Größenprofile | `CoopMissionCombatComposition` leitet das Raster aus `CELL_SIZE` ab und berechnet ein Boss-Clearance-Profil in ganzen Zellen. | Präzisere Geometrieprofile einführen; nicht nur `CELL_SIZE` ändern. [S7] |
| Update-Reihenfolge | Mission, Navigation, Köder-Locks, Bewegung, Nekromantie, Fähigkeiten und Angriffe haben eine Activity-eigene Reihenfolge. | Integration in den vorhandenen Activity-Ablauf statt zusätzliche unabhängige Schleife. [S8] |
| `NecromancySystem` | Besitzt eigene Ziel-/Leash-Entscheidungen, gemeinsame Besitzerfelder und Follow-Positionen. | Gemeinsame Bewegungsmechanik verwenden, aber Besitzerbindung und Wiederbelebungsregeln erhalten. [S9] |

Die früher vorgeschlagene reine Ergänzung „Dichtevektor zum Flowvektor addieren“ reicht für diese Anforderungen nicht: Sie beseitigt weder widersprüchliche Ziele noch falsche Durchbruchsfreigaben und kann ungünstige Wandbewegungen sogar verstärken.

---

<a id="architektur"></a>
## 4. Zielarchitektur und Zuständigkeiten

### 4.1 Ein gemeinsamer Ablauf

```text
Zulässige Wahrnehmung und vorhandene Zielkataloge
                       ↓
Gemeinsame Zielabsicht mit begründeten Wechseln
                       ↓
Geteilte Navigation und erreichbare Angriffsbereiche
                       ↓
Lokale Bewegung: Korridor, Nachbarn, Ausweichen, Anhalten
                       ↓
Bestehende Bewegungs-/Physikausführung
                       ↓
Fortschrittsrückmeldung: vorankommen, warten, Recovery

Angriffe/Fähigkeiten lesen dieselbe Absicht.
Bestätigt fehlender Weg → eigener Durchbruchsauftrag.
```

Zielsetzung, lokale Bewegungssteuerung und eigentliche Fortbewegung getrennt zu behandeln, entspricht dem Grundprinzip klassischer Steering-Architekturen. Das ist eine fachliche Orientierung, keine Verpflichtung zur Übernahme einer fremden Bibliothek. [E1]

### 4.2 Verantwortlichkeiten statt einer großen neuen Zentralklasse

| Verantwortung | Aufgabe | Darf nicht selbst übernehmen |
|---|---|---|
| Zielentscheidung | Primärziel, Ersatzverhalten, erlaubte Nebenangriffe, Wechselgrund | Treffer oder HP verändern |
| Navigation | Geometrieprofile, Flowfields, Erreichbarkeit, Wegkosten | Eigenständig Kampfziele außerhalb der erlaubten Zielmenge wählen |
| Lokale Bewegung | Sichere Wunschbewegung, Nachbarschaft, Angriffsposition, Recovery | Nach Belieben Fähigkeiten abbrechen oder teleportieren |
| Durchbruchsplanung | Notwendige Öffnung und ersten erreichbaren Blocker bestimmen | Hindernisse unmittelbar entfernen |
| Angriff/Fähigkeit | Bestehende Waffe oder Fähigkeit im erlaubten Kontext ausführen | Unabhängig ein neues strategisches Hauptziel setzen |
| Physik/Bewegungsausführung | Finale Bewegung und Kollision; bestehende Impulse/Slows erhalten | Ein zweites widersprüchliches KI-Ziel führen |

Diese Verantwortlichkeiten können als wenige Module im vorhandenen Activity-System umgesetzt werden. Sie verlangen nicht automatisch sechs neue Manager oder zahlreiche kleine Weiterleitungsinterfaces.

### 4.3 Ownership folgt der bestehenden Lifetime

Der KI-Laufzeitzustand gehört zur `CoopMissionRuntime` beziehungsweise der zugehörigen Activity. Die World liefert ihre aktuelle Hindernisgeometrie und die bestehenden Combat-/Bewegungszugriffe. Der `EnemyManager` bleibt Eigentümer seiner Gegner; eine neue Bewegungslogik erzeugt keinen zweiten Gegnerbestand und keine zweite HP-Verwaltung.

Die vorhandene Composition materialisiert die Systeme. Teardown entfernt Zielbindungen, Registrierungen, Reservationsdaten, Jobs und räumliche Sichten gemeinsam mit ihrer Lifetime. Ein Worker-Ergebnis einer früheren Activity darf niemals in einer neuen Runde aktiviert werden. Die vorhandenen Generations- und Snapshot-Prinzipien sind dabei weiterzuführen. [S6] [S7] [S8]

**Eine Instanz, eine Bewegungsentscheidung:** Reguläre Navigation und Nekromantie dürfen nicht im selben Schritt konkurrierend die Geschwindigkeit derselben Einheit schreiben. Spezialbewegungen erhalten ausdrücklichen Vorrang; die bestehende Physik bleibt die abschließende Ausführung.

---

<a id="geometrie"></a>
## 5. 16-px-Navigation auf einer 32-px-Welt

### 5.1 Vier verschiedene Rasterbegriffe

| Darstellung | Auflösung | Zweck |
|---|---:|---|
| Weltraster | 32 px | Mapdaten, Bauplätze, Objekte und Spielregeln |
| Navigationspunkte | 16 px Abstand | Körpergerechte Wegverbindungen und Flowfields |
| Dichtefeld | zunächst 32 px | Grobe Belegung und länger bestehender Stau |
| Räumlicher Gegnerindex | nach Abfragebedarf | Lokale Nachbarn und später weitere dynamische Kandidatenabfragen |

Die Strukturen dürfen unterschiedliche Auflösungen haben. Eine Kachelgröße darf nicht stillschweigend als universelle Konstante für alle Aufgaben verwendet werden. Getrennte Karten- und Navigationsauflösungen sind auch in bestehenden Pathfinding-Systemen vorgesehen; daraus folgt aber keine allgemeine Optimalität von 16 px für dieses Spiel. [E2]

### 5.2 Ausrichtung: die bisherigen Mittellinien bleiben enthalten

Navigationspunkte liegen relativ zum tatsächlichen Ursprung des Weltrasters bei:

```text
x = worldGridOriginX + i × 16
y = worldGridOriginY + j × 16
```

Damit sind insbesondere die Zentren der 32-px-Weltzellen enthalten: `16, 48, 80, …`. Punkte auf Kachelgrenzen sind nur dann nutzbar, wenn der Körper dort tatsächlich Platz hat. Punkte am äußeren Kartenrand werden für einen Körper mit positivem Radius normalerweise gesperrt.

Nicht verwenden: eine bloße Unterteilung in zellzentrierte 16-px-Zellen mit Punkten bei `8, 24, 40, …`, wenn dadurch die bisherigen Gangmittellinien verloren gehen.

**Geometrischer Prüfstein:** In einem 32-px-Gang darf der Mittelpunkt eines 30-px-Kreiskörpers nur zwischen 15 und 17 px liegen. Ein Punkt bei 16 passt, Punkte bei 8 und 24 nicht. Ein 56-px-Körper in einem 64-px-Gang benötigt entsprechend einen Mittelpunkt zwischen 28 und 36 px; 32 passt. Diese Beispiele setzen tatsächlich entsprechend große freie Geometrie voraus, nicht lediglich optisch so breite Texturen.

Bei Kartenbreite `W` kann ein randinkludierendes Punktraster bei durch 16 teilbaren Abmessungen `W/16 + 1` Spalten haben. Weltzellenzahl, Navigationspunktzahl und Randbehandlung dürfen nicht verwechselt werden. Maßgeblich sind die tatsächlichen World-Metriken jeder Map, nicht eine fest angenommene Standard-Arenagröße.

### 5.3 Tatsächliche Kollisionsgeometrie als Quelle

Der zentrale Geometrieadapter liest die gleichen Hindernisse und aktiven Zustände, die die Fortbewegung blockieren:

- Felsen, Mauern, Basen und andere rechteckige Körper mit ihren tatsächlichen Bounds;
- runde Baumstümpfe mit tatsächlichem Radius;
- Wasser und unpassierbare Kartenränder;
- aktive Missionsbarrieren entsprechend ihrer Spielregel;
- Konstrukte nur dann als Bewegungsblocker, wenn ihr Kollisionsmodus das verlangt.

Ein Bauplatz ohne Bewegungsblockade wird nicht allein wegen seiner Rasterbelegung zum Hindernis. Grafische Schatten, Moos, Waffen und Glows vergrößern nicht den Körper. Eine zerstörbare Mauer ist bis zu ihrer tatsächlichen Entfernung genauso Bewegungsblocker wie ein unzerstörbares Objekt.

### 5.4 Punkte und Kanten körpergerecht prüfen

Pro geometrischem Größenprofil werden sowohl gültige Standpunkte als auch gültige Nachbarverbindungen vorberechnet. Ein Punkt ist gültig, wenn der Kreis des Profils frei steht. Eine Kante ist gültig, wenn der gesamte zwischen ihren Endpunkten bewegte Kreis frei bleibt.

Für Kreis gegen Rechteck kann die Prüfung über den Abstand zur Rechteckfläche beziehungsweise einen Kreis-Sweep umgesetzt werden. Eine pauschal aufgeblähte Rechteck-AABB ist nur eine konservative Vorauswahl: An Ecken entspricht die genaue verbotene Fläche einem Rechteck mit gerundeten Erweiterungen. Diese Unterscheidung ist wichtig, damit die Navigation nicht unnötig freie Ecken sperrt.

Die zwei freien Endpunkte einer Kante sind kein ausreichender Durchgangsnachweis. Umgekehrt dürfen alte Regeln für diagonale Rasterzellen nicht unverändert auf das neue Punktraster übertragen werden, wenn die neue exakte Kantenprüfung einen sicheren Weg bereits korrekt beschreibt.

Im Laufzeitpfad kommt ein begrenzter geometrischer Schutz für die tatsächliche Bewegung hinzu. Das ist nötig, weil der Körper zwischen Punkten bewegt wird, weich ausweicht und von Impulsen beeinflusst werden kann.

### 5.5 Körperfreiheit, Komfort und Größenprofile

Harte Körperfreiheit entscheidet über Erreichbarkeit. Ein zusätzlicher Komfortabstand beeinflusst nur Kosten und lokale Präferenzen. In 32-px-Gängen darf ein 30-px-Körper nicht durch großzügige Sicherheitszuschläge künstlich ausgesperrt werden. Numerische Toleranzen sind klein, einheitlich und gegen die tatsächliche Physik zu testen.

Profile werden nach Kollisionsradius und notwendigen Bewegungsregeln geteilt, nicht nach Gegnername. Zunächst werden nur wirklich vorkommende Radiusklassen benötigt. Ein konservativ größeres gemeinsames Profil ist zulässig, solange es keinen für den kleineren Gegner benötigten Weg fälschlich verliert. Spätestens der spätere Mini-Gegner erhält bei Bedarf ein kleineres Profil.

Worker und Main Thread müssen für dasselbe Profil dieselben geometrischen Regeln verwenden. Ein Profil darf nicht nur eine andere Standpunktmaske erhalten, während Kanten, Anschlussprüfungen oder lokale Sicherheitsabfragen weiterhin unbeabsichtigt das Standardprofil benutzen. Gemeinsame Geometriefunktionen und entsprechende Gleichheitstests sichern diese Grenze.

Bei temporären Größenänderungen durch einen Dash bleibt die Spezialbewegung zuständig. Für den Zustand nach dem Dash muss wieder ein gültiger Platz des normalen Körpers existieren; kurzzeitige Schrumpfung darf nicht unabsichtlich zum allgemeinen Durchschlüpfen großer Gegner führen.

### 5.6 Weltpositionen dürfen nicht blind auf Rasterpunkte gerundet werden

Startposition und Zielbereich werden an nahe, tatsächlich sicher verbundene Navigationspunkte angebunden. „Nächster Punkt“ bedeutet nicht automatisch „erreichbarer Punkt“. Ein Punkt auf der anderen Seite einer dünnen Wand ist kein gültiger Anschluss.

Zielanschlüsse werden aus freien Annäherungs- oder Angriffspositionen gebildet. Eine Basiszelle im Hindernisinneren und die Mitte eines besetzten Turms sind keine begehbaren Zielpunkte. Steht ein Spieler in einer für den Gegner zu schmalen Passage, können freie Angriffspositionen davor trotzdem gültige Ziele sein.

### 5.7 Grenzen der Diskretisierung

Ein fehlender Rasterpfad ist zunächst ein Ergebnis des geprüften Navigationsgraphen, kein mathematischer Beweis für jede denkbare kontinuierliche Bewegung. Die 32-px-Gänge, Kurven, Bossdurchgänge und runden Baumstümpfe müssen deshalb durch konkrete Geometrie-Regressionstests abgesichert werden. Offensichtliche Anschluss-/Abtastprobleme werden als solche behandelt und nicht als Durchbruchsbegründung.

Für geometrisch auffällige Sonderfälle ist eine seltene, begrenzte präzisere Anschluss- oder Korridorprüfung zulässig. Das ist keine Einladung zu einem zweiten vollwertigen Navigationssystem. Der normale Pfad soll durch das korrekt ausgerichtete Punktraster bereits zuverlässig abgedeckt sein.

---

<a id="flowfields"></a>
## 6. Geteilte Flowfields und Erreichbarkeit

### 6.1 Gemeinsame Felder statt individueller Pfadsuche

Der bestehende Worker und Coordinator bleiben das Rückgrat. Ein Feld wird für ein geometrisches Profil und eine gemeinsam verwendete Zielmenge berechnet. Viele Gegner lesen dasselbe Feld; ihre Anzahl bestimmt nicht die Anzahl der vollständigen Feldberechnungen. [S6]

Die Schlüssel bestehen sinngemäß aus:

```text
Activity-Generation + Geometrieprofil + zulässige Zielmenge/konkretes Ziel
+ Zielversion + Topologieversion + optionale Staukostenversion
```

Nicht jedes Feld muss ständig existieren. Es werden nur angeforderte Kombinationen erzeugt; unbenutzte Kombinationen werden freigegeben. Felder je Spieler sind bei festen Spielerbindungen möglich. Hunderte Verfolger desselben Spielers erzeugen trotzdem nicht hunderte Felder.

### 6.2 Hauptziel und benutztes Feld müssen zusammenpassen

Eine gespeicherte Ziel-ID darf nicht Spieler A nennen, während die benutzte Mehrzielroute zu Spieler B führt. Zielquellenzuordnung und Flowfield werden zusammen aktiviert. In einem Mehrzielfeld wird die tatsächlich gewählte Quelle Bestandteil der gemeinsamen Absicht; ein fester Lock benötigt eine passende Zielbindung.

Nicht als Lösung verwenden: Ein Gegner behält nur für die Anzeige einen Ziel-Lock und folgt unabhängig davon immer dem nächsten Ziel des allgemeinen Feldes.

### 6.3 Erreichbarkeit und bevorzugter Weg sind unterschiedliche Fragen

Die harte Topologie enthält ausschließlich geometrisch zulässige Verbindungen. Dichte, Komfort und erwartete Wartezeit sind endliche weiche Kosten. Sie dürfen die Konnektivität nicht verändern.

Pro Größenprofil können zusammenhängende begehbare Regionen markiert werden. Zusammen mit gültigen Start-/Zielanschlüssen ergibt sich daraus eine günstige Prüfung, ob ein freier Weg existiert. Diese Information wird bei Geometrieänderung aktualisiert, nicht bei jeder Dichteschwankung. Ein eigener vollständiger zweiter Flowfield-Satz nur zum Ignorieren von Crowd-Kosten ist deshalb nicht grundsätzlich nötig.

### 6.4 Kosten nach Strecke und erwarteter Zeit

Wegbewertung nutzt eine konsistente Einheit, vorzugsweise eine geschätzte Reisezeit beziehungsweise darauf kalibrierte Kosten. Kantenlänge, Geländepräferenz, Komfort und geglätteter Stau gehen nachvollziehbar ein. Durch Halbierung des Punktabstands darf die gleiche Weltstrecke nicht unbeabsichtigt doppelte Basiskosten erhalten.

Für Zielwechsel und Umwege werden relevante Wegkosten verwendet, nicht allein die Luftlinie. Ein schneller Gegner und ein langsamer Koloss können dieselbe Geometrie nutzen; eine eigene Kostenfamilie ist nur nötig, wenn sich ihre tatsächlichen Routenpräferenzen unterscheiden.

### 6.5 Sichere Korridorführung statt Punkt-für-Punkt-Zickzack

Aus dem Feld wird ein kurzer vorausliegender Wegabschnitt gewonnen. Bei freiem Kreis-Korridor darf auf einen weiter entfernten Punkt dieses Abschnitts zugesteuert werden. In einem schmalen Knick bleibt der nahe sichere Abschnitt maßgeblich.

Vektoren werden nicht blind über Wände, gegensätzliche Zielquellen oder unzulässige Kanten gemittelt. Ein weiter voraus liegendes Ziel darf nur über eine tatsächlich freie Verbindung angesteuert werden. Das Raster beschreibt die sichere Route, nicht die sichtbare Schrittweite der Figur.

---

<a id="zielwahl"></a>
## 7. Gemeinsame Zielentscheidung

### 7.1 Ein kleiner verbindlicher Absichtszustand

Jede Einheit besitzt sinngemäß:

- Primärabsicht und Zielreferenz, etwa Verfolgen, Belagern, Folgen oder letzte bekannte Position untersuchen;
- erlaubte taktische Nebenangriffe und gegebenenfalls einen vorübergehenden Durchbruchsauftrag;
- die dazugehörige Navigationsbindung;
- einen nachvollziehbaren Entscheidungsgrund und begrenzte Wechselhysterese.

Der Zustand ist kein vollständiger neuer Verhaltensbaum. Er vereinheitlicht Informationen, die bereits heute verteilt gebraucht werden. Angriffsreichweite, Waffen-Cooldowns und Salven bleiben Eigentum der vorhandenen Waffen-/Fähigkeitslogik.

### 7.2 Drei Fragen strikt unterscheiden

**Existiert das Ziel noch?** Tod, Teardown oder Zerstörung machen eine Referenz ungültig.

**Darf dieser Gegner das Ziel aktuell kennen beziehungsweise angreifen?** Dafür gelten die bestehenden Wahrnehmungs-, Rauch-, Köder-, Einbuddel-, Fraktions- und sonstigen Targetability-Regeln.

**Existiert ein freier Weg zu einer passenden Annäherungs-/Angriffsposition?** Ein bekanntes Ziel kann gültig sein, obwohl ein Durchbruch nötig ist.

„Nicht in Waffenreichweite“ ist keine automatische Ungültigkeit einer Verfolgung. „Hinter einer Mauer“ ist nicht dasselbe wie „es gibt keinen Spieler“. Ein fehlendes oder veraltetes Worker-Ergebnis ist wiederum keine Aussage über geometrische Erreichbarkeit.

### 7.3 Standardverhalten eines Spielerjägers

1. Bestehende exklusive Fähigkeiten und verbindliche Köderregeln beachten.
2. Unter den gültigen, für dieses Profil erlaubten Spielerzielen einen freien Weg bevorzugen. Ist ein anderer Spieler frei erreichbar und der bisherige nur per Durchbruch, wechseln.
3. Sind mehrere Spieler frei erreichbar, anhand geschätzter Reisezeit wählen; erst bei deutlich besserer Alternative umschalten.
4. Sind gültige Spieler vorhanden, aber keiner über einen freien Weg beziehungsweise eine freie Angriffsposition erreichbar, eine zulässige gemeinsame Durchbruchsplanung anfordern.
5. Gibt es dagegen kein gültiges Spielerziel, das konfigurierte Ersatzverhalten anwenden: standardmäßig geeignete Basis, andernfalls letzte bekannte Spielerposition.
6. Existiert auch keine gespeicherte Position, sicher warten und später erneut prüfen.

Diese Reihenfolge verhindert, dass „alle Spieler hinter Mauern“ versehentlich als „keine Spieler vorhanden, irgendeine Basis angreifen“ interpretiert wird.

Eine Basis als ausdrückliches Ersatz-Ziel ist ein legitimer neuer Auftrag. Eine zufällige Basis neben der Verfolgungsroute ist es nicht. Eine bewaffnete Struktur, die nach den bisherigen Regeln etwa einen bemannten Turm beziehungsweise ein erlaubtes strategisches Ziel repräsentiert, bleibt über ihren ausdrücklich passenden Zieltyp ansprechbar.

### 7.4 Basisangreifer und Spezialprofile

Basisangreifer verfolgen standardmäßig ihr Belagerungsziel weiter. Ein naher Spieler führt nicht automatisch zur Unterbrechung. Gegnerarten können ausdrücklich erlauben, im Nahbereich zu reagieren oder während des Marsches eine Spielerwaffe zu verwenden.

So bleibt zum Beispiel „Boss läuft zur Basis und beschießt Spieler mit einer besonderen Salve“ möglich. Die entsprechende Fähigkeit besitzt eine erlaubte taktische Zielmenge; sie ersetzt nicht heimlich die Primärabsicht des Bosses.

Bestehende Gegnerkonfigurationen werden deshalb semantisch migriert: Was bisher ausdrücklich zur Gegnerfantasie gehört, bleibt als Profilregel erhalten. Die heutigen pauschalen Basenprioritäten werden nicht einfach in eine neue globale Prioritätenliste kopiert.

### 7.5 Zielwechsel mit Hysterese

Als Startwert kann eine Alternative etwa 20 % und mindestens 200 ms geschätzte Reisezeit besser sein müssen; eine kurze Mindestbindung von etwa 300 ms verhindert Pendeln. Diese Werte sind abstimmbar.

Tod, verlorene Targetability, ein verbindlicher Köderwechsel oder ein frei erreichbarer Spieler anstelle eines nur per Durchbruch erreichbaren Spielers umgehen die normale Wechselhysterese. Die Mindestbindung ist kein Grund, ein ungültiges Ziel weiter anzugreifen.

### 7.6 Erinnerung ohne versteckte Informationsvorteile

Letzte Spielerpositionen dürfen nur aus den bislang zulässigen Informationen stammen. Rauch oder Stealth dürfen nicht durch einen neuen globalen Zielkatalog unwirksam werden. Soweit vorhandene Regeln bewusst letzte bekannte Positionen oder laufende Salven zulassen, wird dieser Informationsstand explizit von einer aktuellen sichtbaren Position getrennt.

Beim Erreichen einer letzten bekannten Position wird nicht auf eine erfundene Person geschossen. Der Gegner wartet oder bewertet gültige Ziele neu. Das Fallback-Verhalten ist pro Art konfigurierbar, aber nicht zwingend pro einzelner Instanz individuell.

---

<a id="angriff"></a>
## 8. Angriffspositionen und Kampfausführung

### 8.1 Nicht alle Nahkämpfer auf denselben Punkt ziehen

Für ein Ziel werden mehrere sinnvolle Angriffspositionen aus seiner tatsächlichen Geometrie und der passenden Waffenreichweite abgeleitet. Bei einem Spieler liegen sie um den Körper; bei einer Basis entlang ihrer erreichbaren Oberfläche. Bei konkaven Basen darf nicht einfach ein Kreis um den Basismittelpunkt verwendet werden.

Eine Position ist nur gültig, wenn der Gegnerkörper dort stehen kann, der Weg dorthin frei ist und der vorgesehene Angriff unter den bestehenden Reichweiten-/Schusslinienregeln möglich ist. Kein pauschales „Zielzelle erreicht“ als Ersatz für die tatsächliche Angriffsprüfung.

### 8.2 Weiche, begrenzte Positionsreservierungen

Nahe Einheiten bevorzugen unbesetzte oder schwach beanspruchte Positionen. Bereits brauchbare Positionen bleiben kurzfristig stabil. Reservierungen verfallen bei Tod, Zielwechsel, großer Zielbewegung oder ausbleibender Annäherung.

Kein vollständiges globales Zuordnungsproblem über alle Gegner und alle Positionen pro Frame. Es genügen wenige Kandidaten pro naher Einheit und wiederverwendete Informationen pro Ziel. Kleine Änderungen dürfen nicht die gesamte Formation neu durchnummerieren.

Die zentrale Navigation führt zum Zielbereich. Die letzte Verteilung erfolgt lokal; sie rechtfertigt kein eigenes dauerhaftes Flowfield für jeden einzelnen Angriffsplatz. Ein Platz auf der anderen Seite der Basis darf nur gewählt werden, wenn der entsprechende Weg geprüft wurde. Nicht erreichbare lokale Kandidaten werden verworfen, statt per Luftlinie durch das Ziel zu laufen.

### 8.3 Wartende Einheiten und gemischte Größen

Sind alle nahen Angriffspositionen besetzt, warten nachrückende Gegner außerhalb des direkten Frontbereichs oder umrunden das Ziel über einen freien Weg. Große Einheiten belegen mehr Fläche. Bereits angreifende Einheiten werden nicht permanent aus ihrer Position herausgedrückt.

Die erste Umsetzung braucht weder perfekte gleichmäßige Ringe noch feste Formationen. Gefordert ist sichtbar besseres Ausnutzen erreichbarer freier Seiten.

### 8.4 Angriffsausführung bleibt im bestehenden System

Vor einer neuen Angriffsauslösung wird geprüft, ob das Ziel zur Primärabsicht, zu einer ausdrücklich erlaubten Nebenaktion oder zum aktuellen Durchbruchsauftrag gehört. Danach gelten unverändert die bestehenden Regeln für Cooldown, Windup, Sicht-/Schusslinie, Faction und Schaden.

Bereits abgefeuerte Projektile werden bei einem Zielwechsel nicht umgeschrieben. Kollateralschaden bleibt möglich. Die Erlaubnis „ich darf dieses Hindernis als Durchbruch angreifen“ darf nicht als allgemeiner Friendly-Fire-Schalter implementiert werden.

---

<a id="bewegung"></a>
## 9. Lokale Bewegung, Separation und Verdrängung

### 9.1 Gemeinsame Ausgangssicht

Die lokale Bewegungsberechnung liest einen konsistenten Positions-/Geschwindigkeitsstand der relevanten Einheiten. Ergebnisse werden gesammelt und anschließend angewendet, statt dass später verarbeitete Gegner bereits halb aktualisierte Nachbarn sehen. Ein stabiler ID-Tiebreak verhindert unnötige Reihenfolgeartefakte.

Ein räumlicher Index liefert nahe Kandidaten. Die genaue Nachbarzahl hängt von Dichte und Abfrageradius ab; ein Spatial Hash allein garantiert keine konstante Arbeit in einem vollständig gefüllten Bucket.

### 9.2 Wunschbewegung und sichere Alternativen

Aus der Route beziehungsweise einer legitimen Kampfposition entsteht eine Wunschgeschwindigkeit. In freier Umgebung kann sie direkt übernommen und weich angepasst werden. In Konfliktnähe bewertet die Bewegung wenige Alternativen: leicht seitlich, stärker seitlich, langsamer oder warten.

Bewertungskriterien sind Zielfortschritt, voraussichtliche Körperkonflikte, sichere Weltgeometrie, Abstand zur bisherigen Bewegung und unnötige Richtungswechsel. Ein kurzer geschwindigkeitsabhängiger Blick voraus verhindert, dass erst auf bereits entstandene Überlappung reagiert wird.

Das ist eine begrenzte lokale Kandidatenbewertung, kein komplexer globaler Crowd-Solver. Prädiktives Ausweichen ist aus Steering-Verfahren bekannt; daraus folgt keine Garantie absolut kollisionsfreier Mengenbewegung. Geringe Überlappung ist hier bewusst erlaubt. [E1]

### 9.3 Enge Korridore

An einer 32-px-Öffnung für einen fast ebenso breiten Körper sind seitliche Alternativen eingeschränkt. Die richtige Reaktion lautet einordnen, langsamer werden und nachrücken. Die Steuerung soll nicht beliebig starke Abstoßung erzeugen und deren Korrektur der Physik überlassen.

Weltgeometrie hat Vorrang vor Komfort. Eine zulässige Restbewegung entlang einer Wand ist besser als wiederholtes Drücken in die Wand. Gegenseitige Verdrängung darf einen Körper nie in Felsen, Wasser oder außerhalb der Arena schieben.

### 9.4 Größenabhängige Separation

Der relevante Abstand ergibt sich aus beiden Körperradien und einem kleinen einstellbaren Abstand. Der heutige feste großzügige Abstand wird nicht für alle Größen unverändert übernommen.

Ein Paar, das durch eine Wand getrennt ist, soll sich nicht allein wegen geringer euklidischer Distanz abstoßen. In Wandnähe muss die lokale räumliche Beziehung deshalb geometrisch plausibel geprüft werden. Eine gemeinsame weitläufige Connected Component allein reicht dafür nicht aus: Auch zwei Seiten derselben langen Wand können global verbunden sein.

### 9.5 Leichte Verdrängung als begrenzte Ergänzung

Verdrängung ist ein kleiner, gedämpfter Anteil der lokalen Bewegung oder eine begrenzte Überlappungskorrektur. Große Gegner besitzen geringere Verdrängbarkeit, kleine geben eher nach. Das Verhalten ist von dem vorhandenen Kampf-Knockback-Faktor getrennt: Ein schwer verschiebbarer Boss kann weiterhin seine eigenen bestehenden Rückstoßregeln haben.

Es gibt weder eine neue vollständige Enemy-vs-Enemy-Arcade-Kollision noch viele unbeschränkte Solver-Iterationen. Falls die einfache Korrektur in dichten Testgruppen schlechter aussieht oder mehr kostet als sie bringt, wird sie reduziert; die verlässliche Grundbewegung darf nicht davon abhängen.

Bereits aufladende oder fest positionierte Angreifer dürfen kurzfristig weniger nachgeben. Spielerfiguren werden durch diese Änderung nicht neu physisch verschoben. Alliiert-feindliche Kontakte folgen weiterhin ihren Kampfregeln; ein einheitlicher Raumindex macht nicht alle beteiligten Einheiten zu kooperativen Teamkollegen.

### 9.6 Glättung ohne neue Wandfehler

Beschleunigung und Richtungsänderung werden zeitbasiert geglättet. Anschließend muss die wirklich ausgeführte Bewegung noch sicher sein. Ein alter Geschwindigkeitsanteil darf den Gegner nicht durch eine Ecke tragen, obwohl die neu ausgewählte Richtung frei wäre.

Vorhandene Slows, Zeitblasen, Angriffspausen, Rückstöße und exklusive Bewegungen werden in einer nachvollziehbaren Reihenfolge zusammengesetzt. Die neue Steuerung glättet nicht versehentlich einen ausdrücklich sofortigen Dash oder Kampfimpuls weg.

---

<a id="dichte"></a>
## 10. Dichte und Stauvermeidung

### 10.1 Belegung statt bloßer Gegnerzahl

Ein zunächst 32-px-großes Dichtefeld erfasst belegte Körperfläche relativ zum verfügbaren Raum. Ein kleiner Gegner trägt weniger bei als ein großer. Die Erzeugung erfolgt gesammelt aus den Einheitenpositionen; nicht jeder Gegner fragt alle anderen nach einem Dichtewert ab.

Statische Geometrie ist kein zusätzlicher Gegner. Besetzte Fläche, grobe Bewegungsrichtung und tatsächlicher Rückstau müssen nicht dieselbe Größe sein. Ein dichtes, aber schnell fließendes Band ist weniger problematisch als ein gleich dichtes stehendes Gedränge.

Dichte wird räumlich und zeitlich geglättet, jedoch nicht unkritisch durch Wände hindurch. Der eigene Beitrag darf einen allein laufenden Gegner nicht in künstliche Ausweichbewegungen versetzen.

### 10.2 Zwei getrennte Wirkungen

**Lokale Wirkung:** Freieren Raum bevorzugen, kleine seitliche Ausweichbewegungen unterstützen und bei belegter Vorderzone abbremsen.

**Gemeinsame Routenwirkung:** Länger überfüllte Bereiche erhalten begrenzte zusätzliche Wegkosten. Dadurch können auch weiter entfernte Alternativzugänge attraktiver werden. Lokale Gradienten allein leisten diese großräumige Umplanung nicht.

Dynamische Potentialfelder sind eine Forschungsgrundlage für fließende Crowd-Bewegung. Hier wird nur die Idee geteilter, dichteabhängiger Kosten übernommen, nicht das vollständige Kontinuumsverfahren. [E3]

### 10.3 Stabilität und Vorrang der Geometrie

Staukosten bleiben endlich. Sie beeinflussen die Auswahl des schnelleren freien Wegs, niemals die Durchbruchsfreigabe. Das System darf einen sehr langen offenen Umweg nicht wegen eines endlichen Kosten-Sentinels als unerreichbar einstufen. Zahlenbereich und Unerreichbarkeitsmarker sind für die feinere Auflösung und zusätzliche Kosten zu prüfen.

Staukosten werden nicht mit jeder kleinen Positionsänderung aktualisiert. Hysterese, geglättete Belegung und begrenzte Kostenänderungen verhindern, dass alle Einheiten synchron zwischen zwei Routen pendeln. An einer unvermeidbaren Engstelle muss die Front weiterhin vorankommen; hohe Dichte hinter ihr darf ihre Geschwindigkeit nicht pauschal auf null setzen.

### 10.4 Umfang bei bis zu 100 Gegnern

Der Mechanismus bleibt bewusst einfach. Auf niedriger Dichte ist er nahezu neutral. Aufwendige Engpassreservierungen, globale Verkehrssteuerung und viele Richtungsfelder sind zunächst nicht nötig.

Für den ersten Umfang werden wenigstens lokale Belegung und ein einfacher zeitlich geglätteter Staukostenpfad geprüft. Erst wenn reproduzierbare Tests einen Bedarf zeigen, kommen komplexere Strategien hinzu. „Wie Sand“ ist ein gewünschter späterer visueller Eindruck, keine Forderung nach physikalischer Inkompressibilität.

---

<a id="recovery"></a>
## 11. Fortschritt, Warten und Recovery

### 11.1 Zustände mit unterschiedlichen Konsequenzen

| Zustand | Bedeutung | Erlaubte Reaktion |
|---|---|---|
| `moving` | Körper kommt entlang seines gültigen Auftrags voran. | Normal bewegen. |
| `engaging` / `holding` | Gegner greift an, lädt auf oder hält bewusst Abstand. | Den passenden Kampfzustand ausführen; kein Stuck-Timer wegen Stehenbleibens. |
| `yielding` | Die Vorderzone ist durch andere Einheiten vorübergehend besetzt. | Nachrücken oder lokal ausweichen; kein Hindernisangriff. |
| `route-pending` | Relevante Navigation fehlt oder wird neu berechnet. | Sichere Restbewegung oder warten; kein Durchbruchsnachweis. |
| `recovering` | Geometrischer Weg existiert, tatsächliche lokale Bewegung scheitert. | Begrenzte lokale Befreiung. |
| `blocked-confirmed` | Für gültige Anschlüsse und aktuelle Geometrie existiert kein freier Weg zu erlaubten Zielbereichen. | Zielwechsel oder Durchbruchsplanung. |
| `breaching` | Ein validierter Durchbruchsauftrag wird ausgeführt. | Nur den legitimen erreichbaren Blocker bearbeiten. |
| `no-objective` | Kein aktuelles Ziel und keine zulässige Erinnerung verfügbar. | Sicher warten und neu bewerten. |

### 11.2 Fortschritt messen

Die Überwachung verbindet tatsächliche Ortsänderung mit Fortschritt zum lokalen Korridorziel. Ein Gegner, der an derselben Ecke hin und her zittert, darf nicht allein durch minimale Ortswechsel dauerhaft als erfolgreich gelten.

Erwarteter Fortschritt hängt von aktueller Geschwindigkeit, Slow, Angriffspause und bewusstem Warten ab. Ein sehr langsamer Gegner wird nicht mit der gleichen absoluten Wegschwelle wie ein schneller Jäger bewertet. Kampf-Knockback wird nicht mit freiwilliger Vorwärtsbewegung verwechselt.

Bei neuen Flowfield-Versionen sind Integrationswerte nicht ungeprüft miteinander vergleichbar. Gleichzeitig darf eine alle 100 ms aktualisierte Zielposition nicht jedes längere Stuck-Fenster immer wieder löschen. Die Beobachtung stützt sich deshalb auch auf reale Bewegung und ein kurzzeitig stabiles lokales Referenzziel.

### 11.3 Recovery-Kette

Zunächst wird eine andere sichere lokale Richtung gewählt. Danach kann ein kurzer seitlicher oder rückwärtiger Weg zu einem erreichbaren Korridorpunkt helfen. Eine seltene begrenzte Pfadsuche auf derselben Geometrie ist zulässig; ihr Ergebnis wird kurz zwischengespeichert.

Wird ein Körper durch Rückstoß oder einen problematischen Bauzustand teilweise in Geometrie gedrückt, ist eine kontrollierte Entflechtung nötig. Ein Sweep, der grundsätzlich jeden Start-Overlap verwirft, kann diesen Fall nicht befreien. Eine solche Korrektur muss nachweisbar die Überschneidung abbauen und darf nicht durch das Hindernis hindurch teleportieren.

Allgemeines Teleportieren ist keine Standard-Recovery. Bereits existierende Teleport-/Leash-Regeln von Fähigkeiten und Verbündeten bleiben davon getrennt.

### 11.4 Recovery ist kein Hintereingang zum Durchbruch

Ein abgelaufenes Recovery-Budget oder wiederholter Stillstand ersetzt keinen Erreichbarkeitsnachweis. Bei vorhandenem Weg bleibt das ein Bewegungsproblem. Bei unvollständiger Suche bleibt es `pending`, nicht `unreachable`.

Außerhalb des normalen Testfalls kann eine diagnostizierte Recovery scheitern. Dann soll das Debugging einen nachvollziehbaren Grund liefern, statt durch zufälliges Anbeißen eines Felsens die eigentliche Ursache zu verdecken.

---

<a id="durchbruch"></a>
## 12. Gezielter Durchbruch

### 12.1 Freigabe nur mit gültiger Begründung

Ein neuer Durchbruchsauftrag darf nur entstehen, wenn sämtliche Voraussetzungen erfüllt sind:

1. Das eigentliche Ziel ist nach den Spielregeln gültig und bekannt.
2. Für das Körperprofil existiert aktuell kein freier Weg zu einer brauchbaren Ziel-/Angriffsposition.
3. Die negative Aussage beruht auf gültigen Start-/Zielanschlüssen und dem relevanten aktuellen Topologiestand.
4. Es gibt kein nach der Zielregel vorzuziehendes frei erreichbares Alternativziel; insbesondere gilt R02.
5. Die vorgesehene Öffnung betrifft erlaubte, tatsächlich zerstörbare und von der Einheit beschädigbare Hindernisse.
6. Die nächste Angriffsposition vor dem ersten Blocker ist bereits ohne fiktive Durchquerung erreichbar.

Diese Begründung wird als lesbarer Diagnosezustand gespeichert. Ein einzelnes `pathBlocked = true` genügt nicht.

### 12.2 Normaler Weg und Durchbruchsplanung bleiben getrennt

Im normalen Graphen sind Mauern und Felsen gesperrt. Ein möglicher Durchbruch wird erst nach bestätigtem Scheitern geprüft. Sonst würden hohe, aber endliche Mauerkosten bei einem langen freien Umweg irgendwann einen unerwünschten Abkürzungsangriff ermöglichen.

Der zusätzliche Planer verwendet dieselbe Geometrie und dieselben Objektidentitäten. Er simuliert gedanklich mögliche Öffnungen, aber verändert nicht das laufende Flowfield und erklärt Mauern nicht für bereits begehbar.

### 12.3 Erlaubnisklassen

**Stufe 1:** Freier Weg ohne Zerstörung. Diese Stufe hat Vorrang.

**Stufe 2:** Durchbruch durch feindliche Spielermauern, natürliche Felsen und sonstige erlaubte zerstörbare Blocker, einschließlich blockierender Türme/Konstrukte.

**Stufe 3:** Eine angreifbare feindliche Basis als letzter Ausweg, wenn kein zulässiger Weg der vorigen Stufen herstellbar ist.

Unzerstörbares Wasser, nicht angreifbare Barrieren, unzerstörbare Baumstümpfe oder die eigenen geschützten Strukturen werden nicht künstlich zerstörbar. Die bestehenden Fraktions- und Immunitätsregeln bleiben maßgeblich. Bei einer Basis muss außerdem geprüft werden, welche Geometrie ihre tatsächliche Zerstörung freigibt; „HP auf null“ ist kein allgemeiner Beweis, dass sämtliche Hindernisflächen verschwinden.

### 12.4 Auswahl nach erwarteter Gesamtdauer

Innerhalb der zulässigen Stufe lautet das Optimierungsziel:

```text
geschätzte Gesamtdauer = Anmarsch + notwendige Zerstörungszeit
                      + verbleibender Weg + wesentliche Wartezeit
```

Zerstörungszeit ergibt sich aus aktuellen HP, tatsächlich wirksamem Schaden, Angriffstakt und den Angreifern, die an der Öffnung real Platz finden. Hundert wartende Gegner sind nicht automatisch hundert gleichzeitig wirksame Angreifer.

Die Zeit ist eine Heuristik, kein Versprechen eines mathematisch global optimalen Plans. HP und Gruppenzusammensetzung ändern sich. Ein laufender brauchbarer Plan wird nur bei wesentlicher Verbesserung oder Ungültigkeit ersetzt, nicht mit jedem Treffer.

### 12.5 Logische Objekte statt Kosten pro Navigationspunkt

Eine 32-px-Mauer überdeckt mehrere 16-px-Punkte und Verbindungen. Ihre HP dürfen nicht für jeden davon erneut berechnet werden. Eine mehrzellige Basis ist ebenfalls ein logisches Schadensziel mit ihrer eigenen Geometrie und nicht eine Sammlung unabhängiger HP-Kacheln.

Der Planer muss die zu entfernenden logischen Objekte beziehungsweise Öffnungsgruppen kennen. Eine pro Kante summierte Strafzahl ohne Objektbezug kann dieselbe Mauer mehrfach berechnen und falsch priorisieren.

Für eine erste Umsetzung bietet sich an, an Grenzen erreichbarer Regionen wenige plausible Öffnungen zu prüfen und die daraus entstehenden Fortsetzungen zu bewerten. Mehrlagige Sperren brauchen begrenzte Folgeschritte. Konkreter Suchalgorithmus und Arbeitsbudget sind Implementierungsentscheidungen; die Objektidentität, Größenkorrektheit und unterscheidbare Antwort `pending` sind verbindlich.

### 12.6 Öffnungen müssen für den ganzen Körper reichen

Für einen großen Boss kann die Entfernung einer einzelnen 32-px-Mauer noch keinen passierbaren Gang erzeugen. Der Plan muss dann die benötigte Gruppe angrenzender Hindernisse berücksichtigen und den resultierenden Kreis-Korridor prüfen.

Bei mehrlagigen Mauern wird nur der jeweils erste erreichbare Blocker angegriffen. Kein Schaden durch die vordere Mauer hindurch, nur weil der Plan die dahinterliegende bereits kennt. Nach tatsächlicher Zerstörung wird die neue Topologie abgewartet beziehungsweise aktualisiert und der nächste Schritt freigegeben.

### 12.7 Gemeinsame Öffnung

Nahe Gegner mit kompatiblem Ziel, Körperprofil und Zerstörungsrecht teilen einen Durchbruchsauftrag. Die erste Version benötigt dafür keine dynamischen Clustering-Verfahren: dieselbe erreichbare Region und derselbe sinnvolle Zugang sind eine brauchbare Gruppierungsgrundlage.

Vorne werden wenige freie Angriffspositionen verwendet, hinten wird gewartet. Eine bevorzugte gemeinsame Öffnung ist keine Pflicht, alle Gegner der gesamten Map zu einem einzigen Mauerstück zu schicken. Getrennte Regionen oder stark unterschiedliche Körpergrößen dürfen eigene Pläne benötigen.

Der Cache berücksichtigt zumindest Activity-Generation, Topologieversion, Zielbindung, Startregion, Geometrieprofil und zulässige Blockerklassen. Kostenprofile oder vorhandene Angriffe müssen kompatibel sein. Kleine HP-Änderungen dürfen die teure Geometriesuche nicht ununterbrochen neu starten.

### 12.8 Ende und Abbruch des Auftrags

Ein Durchbruch endet, sobald ein normaler freier Weg verfügbar ist. Der Gegner kehrt zur Primärabsicht zurück. Auch wenn das aktuelle Hindernis noch lebt, ist weiteres Anbeißen dann nicht automatisch erlaubt.

Zielverlust, Fraktionswechsel, nicht mehr beschädigbares Hindernis oder neue relevante Geometrieänderungen erfordern eine Neubewertung. Bereits ausgelöste Waffenaktionen folgen ihren bisherigen Regeln; neue Angriffe benötigen wieder einen gültigen Kontext.

Existiert überhaupt kein herstellbarer Weg, wartet der Gegner oder nutzt ein ausdrücklich konfiguriertes Ersatzverhalten. Der Planer unterscheidet „nachgewiesen keine Lösung“ von „Suchbudget für diesen Schritt verbraucht“.

### 12.9 Geeigneter Angriff für jede normale Gegnerart

Vorhandene Bite-/Strukturangriffe werden wiederverwendet. Eine Konfigurationsprüfung stellt sicher, dass jede normale feindliche Gegnerart mindestens einen tatsächlich wirksamen Durchbruchsangriff besitzt. Dabei zählen auch Reichweite, Windup, Bewegungsstopps und schadensseitige Multiplikatoren.

Die KI ruft die bestehende Waffen- und Combat-Pipeline auf. Kein direkter HP-Abzug im Navigationsplaner. Für Spezialgegner bleiben ausdrücklich anders gestaltete Fähigkeiten möglich; ein späteres Schwarmprofil braucht eine eigene bewusste Regel, statt versehentlich die gesamte normale Waffenverwaltung zu erben.

---

<a id="aktualisierung"></a>
## 13. Dynamische Welt und Aktualisierungstakte

### 13.1 Physische Änderung sofort, Neuentscheidung mit Verzögerung

Beim Bauen einer Mauer wird ihr physischer Blocker sofort aktiv. Die Navigation markiert betroffene Daten als veraltet und fordert eine gebündelte Aktualisierung an. Ein Gegner darf bis dahin sicher weiterlaufen, abbremsen oder warten, aber nicht durch den neuen Blocker gehen.

Nach einer Felszerstörung muss ein neuer Durchgang nicht im selben Millisekundenmoment ausgenutzt werden. Er soll im vereinbarten Reaktionsfenster berücksichtigt werden. R16 betrifft die nutzbare Entscheidung, nicht nur das Absenden eines Worker-Jobs.

### 13.2 Versionsmodell

Mindestens unterschieden werden Activity-Generation, harte Topologieversion, Zielversion und weiche Staukostenversion. Feld, Zielquellenmapping und geometrisches Profil müssen zueinander passen. Der bestehende Coordinator bietet dafür bereits Versionierung und atomare Aktivierung. [S6]

Eine alte positive Route kann kurzfristig nur auf aktuell geprüften sicheren Teilstrecken weiterverwendet werden. Ein alter negativer Erreichbarkeitsbefund darf nach einer relevanten Änderung keinen neuen Durchbruch freigeben.

Zielversionen werden bei relevanten Zieländerungen erhöht, nicht wegen jeder unbedeutenden Fließkommaänderung. Staukosten dürfen nicht dieselbe harte Invalidierung wie eine neue Mauer auslösen. Andernfalls könnten ständig bewegte Ziele und Dichteänderungen jedes Ergebnis vor seiner Aktivierung entwerten.

### 13.3 Lokale Geometrieänderung, möglicherweise globale Routenwirkung

Ein geändertes Objekt betrifft geometrisch nur nahe Standpunkte und Verbindungen. Dieser Bereich wird um den größten relevanten Körperradius und die betroffenen Kanten erweitert. Eine Mauerkachel kann somit mehr als nur vier Navigationspunkte verändern.

Der Wegfall eines einzigen Blockers kann trotzdem Routen auf der ganzen Map ändern. Deshalb ist für die erste Version eine vollständige Neuberechnung der betroffenen gemeinsam genutzten Flowfields zulässig. Ein komplizierter vollständig inkrementeller Wegplaner ist nicht Voraussetzung.

Mehrere Änderungen derselben Zelle innerhalb eines kurzen Fensters werden zum gültigen Endzustand zusammengefasst. Bei mehreren übereinanderliegenden Hindernisquellen darf die Entfernung eines Objekts nicht blind die gesamte Stelle freigeben. Der Adapter liest die kanonische verbleibende Geometrie.

### 13.4 Vorgeschlagene Starttakte

| Aufgabe | Startwert / Auslöser | Wichtige Grenze |
|---|---|---|
| Physische Kollision und unmittelbare Sicherheitsprüfung | vorhandener Simulationstakt | Nicht auf 250 ms drosseln. |
| Lokale aufwendigere Nachbar-/Ausweichbewertung | etwa 20–30 Hz, verteilt | Bewegung dazwischen kontinuierlich; schnelle Einheiten gegebenenfalls häufiger. |
| Zielneubewertung | etwa 200 ms, versetzt | Ungültigkeit und verpflichtende Overrides sofort berücksichtigen. |
| Flowfields zu bewegten Zielen | etwa 100–150 ms bei relevant geänderten Eingaben | Keine Neuberechnung unveränderter Ziele. |
| Geometrieänderungen sammeln | höchstens etwa 50 ms als Startwert | Folgende Berechnung und Aktivierung zählen zur Gesamtlatenz. |
| Dichte erfassen / glätten | etwa 10 Hz | Kein Gegner-gegen-alle-Dichtepfad. |
| Staukosten für gemeinsame Planung veröffentlichen | etwa 250 ms bei relevanter Änderung | Nicht mit harter Erreichbarkeit verwechseln. |
| Durchbruchs-/Recovery-Suche | anlassbezogen, budgetiert, geteilt | Budgetende bedeutet `pending`. |

Die genauen Intervalle werden gegen R16 und R19 getestet. **Ein 250-ms-Timer plus 250-ms-Aktivierungstimer wäre keine 250-ms-Reaktion.** End-to-End gemessen wird von der Weltänderung bis zur für die betroffenen Gegner verfügbaren neuen Entscheidung. Fertige kritische Ergebnisse sollen am nächsten sicheren Simulationsanfang aktiv werden, nicht erst unnötig einen weiteren kompletten Entscheidungstakt warten.

### 13.5 Priorität und Überlast

Lebenszeit-/Zielinvalidierung und harte Hindernisänderungen haben Vorrang vor kosmetischer Stau-Neuplanung. Die Queue hat begrenzte Länge, fasst gleiche Anfragen zusammen und bevorzugt aktuelle relevante Zustände. Keine Aufholschleife, die nach einem langen Frame sämtliche verpassten KI-Ticks nachrechnet.

Bei Überlast bleiben Kollisionsschutz und existierende Kampfregeln erhalten. Staukosten und optionale Feinplanung werden seltener. Verzögerungen werden diagnostiziert, nicht durch ungeprüfte Durchbruchsfreigaben kaschiert. Dauerhafte Überschreitung des vereinbarten Reaktionsfensters im Referenzszenario ist ein zu behebender Abnahmefehler.

---

<a id="faehigkeiten"></a>
## 14. Spezialfähigkeiten und Verbündete

### 14.1 Gemeinsame Mechanik, unterschiedliche Verhaltensprofile

| Profil | Gemeinsamer Unterbau | Zusätzliche beziehungsweise reduzierte Arbeit |
|---|---|---|
| Standardgegner | Zielabsicht, Geometrie, Flowfield, lokale Bewegung, Durchbruch | Reguläre Waffen und überschaubare Zustände |
| Spezialgegner / Boss | Derselbe Navigations- und Bewegungszugriff, passendes Körperprofil | Zusätzliche Fähigkeiten, ausdrücklich erlaubte Nebenangriffe und exklusive Aktionen |
| Verbündeter / Wiederbelebter | Gemeinsame sichere Fortbewegung, Nachbarschaft und Annäherung | Besitzerbindung, Follow-Positionen, Leash und bisherige Kampfregeln |
| Späterer Schwarmgegner | Geteilte Route und dieselben grundlegenden Sicherheitsregeln | Wenige Zustände, begrenzte Steering-Details, sparsame Präsentation; keine unnötigen Spezialfähigkeiten |

Komplexität wird über benötigte Fähigkeiten und die zugelassenen Populationen gesteuert, nicht allein über Entfernung zur Kamera. Ein außerhalb des Bildes laufender Gegner bleibt eine echte Gameplay-Einheit.

### 14.2 Vorrang bestehender Fähigkeiten

Vor dem Umbau wird die aktuelle Priorität vorhandener Zustände als Regressionserwartung festgehalten. Das betrifft insbesondere Köder, Rauch, Panik, Seuchen-/Infektionsziele, Eingraben, Zeitbombenjagd, Ausweichen, Rückstoß, Zeitblasen, Zugreaktionen, Leash und Bossphasen.

Normale Fortbewegung, Kampfpositionierung und exklusive Sonderbewegung werden ausdrücklich unterschieden. Ein aktiver Dash darf nicht im nächsten lokalen Crowd-Schritt umgelenkt werden. Ein eingegrabener Gegner bekommt nicht versehentlich normale Wandkollision. Ein bewusst haltender Fernkämpfer wird nicht als festhängend klassifiziert.

Die jetzige Code-Reihenfolge enthält entsprechende frühe Ausstiege und spätere Overrides. Ihre beabsichtigte Wirkung bleibt erhalten; die konkrete Verteilung auf Methoden darf vereinfacht werden. [S2] [S8]

### 14.3 Fähigkeiten nur für ihre relevanten Besitzer

Ein System für eine seltene Fähigkeit soll vorzugsweise eine registrierte aktive Teilmenge bearbeiten. Es muss nicht jede normale Einheit durch eine teure Ziel-/Geometriesuche schicken, nur um danach festzustellen, dass sie die Fähigkeit nicht besitzt.

Eine einfache Registry oder wiederverwendete Teilmenge reicht. Ein vollständiger ECS-Umbau ist dafür nicht notwendig. Spawn, Fraktionswechsel, Tod und Teardown aktualisieren diese Teilmengen zuverlässig.

### 14.4 Integration von Nekromantie

Die bestehende Nekromantie behält Wiederbelebung, Limits, Auswahl stärkerer Verbündeter, Besitzerbezug, Leash und Teleportregeln. Ihre Ziel-/Follow-Absicht speist aber den gemeinsamen lokalen Bewegungsunterbau. Die bisherigen Follow-Plätze liefern bereits eine sinnvolle Ausgangsbasis für gruppenbezogene Ankunftspositionen. [S9]

Die Host-Schleife darf einen Verbündeten anschließend nicht noch einmal wie einen normalen Feind steuern. Gemeinsame räumliche Belegung ist hingegen erwünscht, damit auch gemischte Gruppen nicht beliebig ineinanderlaufen.

Die Pflicht zu einem Durchbruchsangriff aus R13 bezieht sich auf normale feindliche Gegnerarten. Die gemeinsame Bewegung von Verbündeten gibt ihnen kein neues Recht, eigene Konstrukte zu zerstören. Ihre vorhandenen legitimen Ziele und Rückkehrmechanismen bleiben maßgeblich.

---

<a id="performance"></a>
## 15. Skalierung und Performance

### 15.1 Was mit welcher Größe wächst

| Arbeit | Erwartete Skalierung / Risiko | Leitplanke |
|---|---|---|
| Navigationsgeometrie | Mit Punkt-/Kantenzahl und Körperprofilen | Beim Laden vorbereiten; relevante Bereiche nach Änderung aktualisieren. |
| Flowfield-Berechnung | Mit Rastergröße, Zahl angeforderter Felder und Rebuilds | Geteilte Felder, Worker, unveränderte Eingaben überspringen. |
| Dichteaufbau | Mit Einheiten plus bearbeiteten Dichtezellen bei begrenzter Eintragsarbeit | Wiederverwendete Puffer; keine Paarvergleiche. |
| Lokale Bewegung | Mit Einheiten und tatsächlich geprüften Nachbarn | Räumliche Vorauswahl, kurze Kandidatenliste, einfache freie Fälle. |
| Angriffsplätze | Mit nahen Angreifern und begrenzten Zielkandidaten | Pro Ziel vorbereiten; kein globaler Vollabgleich pro Frame. |
| Recovery / Durchbruch | Selten, kann im Einzelfall teuer sein | Jobs teilen, Budgets, Cache, keine Vollsuche pro Gegner und Frame. |
| Spezialfähigkeiten | Mit ihren aktiven Besitzern und ihrer individuellen Logik | Nicht über sämtliche Schwarmgegner laufen lassen. |
| Physik, Combat, Effekte, Netzwerk | Weiterhin eigenständige Lastquellen | Nicht durch günstigere Navigation automatisch als gelöst betrachten. |

Beim Halbieren des Punktabstands entstehen näherungsweise viermal so viele Rasterwerte; Randpunkte verändern das exakte Verhältnis. Das ist keine vierfache Gesamtspielzeit. Ein niedrigerer Berechnungstakt kann einen Teil des zusätzlichen Feldaufwands ausgleichen, ersetzt aber keine Messung.

### 15.2 Räumliche Infrastruktur teilen, Snapshot-Grenzen erhalten

Eine allgemeiner nutzbare dynamische Nachbarschaftssicht ist sinnvoll. Sie soll keine Gameplay-Regeln enthalten, sondern Kandidaten liefern. Bewegung, Combat und andere Verbraucher entscheiden selbst über Wirkung und Berechtigung.

„Gemeinsam“ bedeutet nicht, dass zwangsläufig genau ein Indexstand vor der Bewegung für jeden späteren Frameabschnitt korrekt wäre. Combat kann Positionen nach einer anderen Simulationsphase benötigen. Ein Indexstand muss seine Phase/Version beschreiben oder passend aktualisiert werden. Bestehende Projectile-/Combat-Verträge werden nicht zugunsten vermeintlich eingesparter Indexarbeit gebrochen.

Für diesen KI-Umbau genügt ein sauberer bewegungsseitiger Index mit geeigneter späterer Anschlussmöglichkeit. Eine vollständige Migration aller dynamischen Combat-Abfragen ist nur bei nachgewiesenem Bedarf Teil des ersten Umfangs.

### 15.3 Dichte Buckets bleiben ein Sonderrisiko

Eine Begrenzung auf beispielsweise die nächsten zwölf Nachbarn spart keine Sucharbeit, wenn vorher trotzdem tausend Kandidaten vollständig gelesen und sortiert werden. Bei späteren Schwärmen müssen tatsächliche Bucket-Belegung, besuchte Kandidaten und aufgewendete Zeit gemessen werden.

Approximationen oder aggregierte Zellinformationen sind für Crowd-Steering möglich. Sie dürfen nicht ungeprüft auf Trefferprüfungen übertragen werden: Ein Steuerungsbudget darf nicht bedeuten, dass ein Projektil echte Ziele überspringt oder eine Explosion zufällig nur einen Teil der Gegner trifft.

### 15.4 Erster Performance-Maßstab

Verbindlich sind 100 Gegner, Solospiel, bisheriger High-End-Test-PC und normales Kampfgeschehen. Der mathematische Zeitrahmen bei 60 FPS beträgt rund 16,67 ms pro Bild; CPU und GPU müssen dabei getrennt beobachtet werden.

Als internes anfängliches Richtbudget können etwa 3 ms p95 für die neuen beziehungsweise umgebauten KI-Main-Thread-Anteile dienen. Das ist ein zu prüfender Entwicklungswert, kein gemessener Istwert und keine Zusage für das gesamte Spiel. Ein bestandener isolierter KI-Benchmark ersetzt niemals den Browservergleich mit Physik, Waffen, Türmen und Effekten.

### 15.5 Späteres Schwarmprofil

Das spätere Profil reduziert Fähigkeiten, individuelle Zielarbeit und optionale Darstellungsdetails. Körpergröße, Leben, Schaden, Slow und Kontaktaktion bleiben echte autoritative Regeln. Eine sehr schnelle Kontakt-Explosion muss den zurückgelegten Weg berücksichtigen; eine nur alle 250 ms geprüfte Endposition reicht dafür nicht.

Zusätzliche Optimierungen an Physik, Replikation, HP-Anzeigen und Massentod-Effekten werden nach gemessener Last gewählt. Das Konzept setzt weder neue permanente Lichter pro Schwarmgegner noch einen pauschalen Netzwerk-Tick-Wechsel voraus.

### 15.6 Host und Client

Zielwahl, Bewegung und Durchbruch bleiben hostautoritativ. Der Client zeigt replizierte Zustände und Bewegung an; er entscheidet nicht selbst, welche Mauer zerstört wird. Neue interne Dichte- oder Flowfield-Puffer müssen nicht über das Netzwerk gesendet werden.

Obwohl das Leistungsziel zunächst Solo gilt, gehören grundlegende Koop-Regressionsprüfungen dazu: gleiche Ziele und Angriffe, keine Phantomgegner, keine ungewollten Doppelereignisse und sauberes Verhalten nach Runden-/Activity-Wechseln. Eine neue Leistungszusage für fünf Spieler entsteht dadurch nicht.

---

<a id="vertraege"></a>
## 16. Datenverträge und Konfiguration

### 16.1 Minimale fachliche Verträge

Die Namen sind Vorschläge, keine Vorgabe zur Einführung weiterer Framework-Schichten.

| Vertrag | Wesentliche Informationen |
|---|---|
| `EnemyIntent` | Primärabsicht, gültige Zielreferenz, bekannte Zielposition, Wechselgrund, erlaubte Nebenaktionen, temporärer Durchbruchsbezug |
| `NavigationBinding` | Geometrieprofil, Zielbindung, Feld-/Topologieversion, Startanschluss und Routenstatus |
| `NavigationResult` | `ready`, `pending`, `invalid-start`, `invalid-goal` oder `unreachable`; Versionen und gegebenenfalls sichere Fortsetzung |
| `LocomotionRequest` | Reguläre Bewegung, Halten, Rückzug oder exklusive Sonderbewegung; Wunschgeschwindigkeit und erlaubte lokale Anpassung |
| `MovementFeedback` | Tatsächlicher Fortschritt, Wartegrund, Hinderniskontakt, Recovery-Status |
| `BreachPlan` | Primärziel, bestätigte Blockade, Öffnungsobjekte, erster erreichbarer Blocker, zulässige Angriffspositionen, erwartete Kosten und Version |
| `NeighborhoodView` | Konsistente Phase/Version, Positionen, Radien, Geschwindigkeiten und räumliche Kandidatenabfragen |

Ein gültiges `unreachable` enthält die relevanten Versionen. Ein Timeout, ein fehlender Startanschluss oder eine noch laufende Suche darf nicht auf denselben Boolean reduziert werden.

Ziel- und Hindernisreferenzen müssen Lifecycle-Wechsel erkennen. Wo die bestehenden Combat-/Activity-Referenzen bereits Generationsinformationen führen, werden diese verwendet, statt parallele ungesicherte ID-Systeme einzuführen.

### 16.2 Konfiguration in wenigen fachlichen Gruppen

| Gruppe | Beispiele | Standardgedanke |
|---|---|---|
| Zielverhalten | Primärzielgruppe, Ersatzverhalten, Unterbrechung der Belagerung, erlaubte Nebenangriffe | Spielerjäger und Belagerer handeln unterschiedlich. |
| Bewegung | Geometrieprofil, Komfortabstand, Beschleunigung, Verdrängbarkeit | Physischer Radius bleibt von Komfort getrennt. |
| Gruppeneinfluss | Separation, Staukostenempfindlichkeit, begrenzte Nachbararbeit | Gleicher Unterbau, unterschiedliche Stärke. |
| Durchbruch | Passender Angriff, erlaubte Blockerklassen, kooperatives Verhalten | Normale Gegner besitzen eine wirksame Möglichkeit. |
| Fähigkeiten | Bestehende optionale Spezialfähigkeiten | Bestehende Anforderungen erhalten. |

Die Implementierung soll nicht jeden internen Algorithmusparameter je Gegnerart exportieren. Geometriesicherheit und Lifecycle-Regeln sind keine frei abschaltbaren Komfortoptionen. Ein späteres Performanceprofil darf nicht unbemerkt die grundlegende Ziel-/Schadenssemantik verändern.

### 16.3 Konfigurationsvalidierung

Beim Laden beziehungsweise in Tests werden mindestens fehlende Durchbruchsangriffe normaler Gegner, unpassende Größenprofile, widersprüchliche Zielregeln und nicht endliche Wegkosten erkannt. Ein Standardprofil muss ohne Spezialkonfiguration sinnvoll funktionieren.

Für jede vorhandene Gegnerart wird dokumentiert, welches Primärziel, welches Fallback, welche erlaubten Nebenangriffe und welcher Durchbruchsangriff nach der Migration gelten. Dadurch wird ein technischer Umbau nicht zu einer unbemerkten Neugestaltung sämtlicher Gegner.

---

<a id="umsetzung"></a>
## 17. Integration und Umsetzungsschritte

### 17.1 Anknüpfungspunkte

| Bestehender Bereich | Geplante Änderung |
|---|---|
| `src/systems/flowfield/FlowFieldSources.ts` | Weltgeometrie in navigationsunabhängigen Metriken bereitstellen; Änderungsevents korrekt auf betroffene Punkte/Kanten abbilden. |
| `FlowFieldKernel`, `FlowFieldEngine`, `FlowFieldProtocol`, `FlowFieldCoordinator` | Punkt-/Kantenprofile, geteilte Erreichbarkeit, Versionierung und optional weiche Staukosten integrieren; vorhandenen Worker-Lifecycle erhalten. |
| `src/systems/EnemyFlowFieldService.ts` | Körpergerechte Start-/Zielanschlüsse und konsistente Routenabfragen exponieren; alte Zellmittelpunktannahmen prüfen. |
| `src/entities/EnemyManager.ts` | Entity-Ownership erhalten, reguläres Steering und Zielentscheidungen nicht weiter im großen Bewegungszweig vermischen. |
| `src/systems/CoopDefenseEnemyAttackSystem.ts` | Gemeinsame Absicht beachten; pauschale Basenpriorität und Timer-Freigabe durch ausdrückliche Regeln ersetzen. |
| `src/systems/CoopDefenseEnemyCombatPositioningSystem.ts` | Kampfpositionierung an das aktuelle gemeinsame Ziel anbinden und gemeinsame lokale Bewegung nutzen. |
| `src/systems/NecromancySystem.ts` | Besitzer-/Follow-Regeln behalten; Bewegungswünsche an den gemeinsamen Unterbau übergeben. |
| `src/activity/CoopMissionCombatComposition.ts` und `CoopMissionEnemyBehaviourComposition.ts` | Neue Zuständigkeiten innerhalb der vorhandenen Activity-Lifetime verbinden. |
| `src/activity/CoopMissionHostUpdate.ts` | Konsistente Entscheidung, Snapshot-Nutzung, Bewegungsübergabe und Rückmeldung in den vorhandenen Ablauf einordnen. |
| `src/systems/HostPhysicsSystem.ts` | Bestehende Bewegung, Impulse und Kollisionen erhalten; kontrollierte Übergabe der finalen Wunschbewegung. |
| `src/config/coopDefenseEnemies.ts` / `.json` | Profile und fachliche Ziel-/Durchbruchsregeln migrieren und validieren. |

Zusätzliche Module wie `EnemyIntentResolver`, `EnemyLocomotionSystem`, `EnemyBreachPlanner` und `EnemyNeighborhoodIndex` sind mögliche Namen. Angriffspositionsverteilung und Recovery können zunächst klar getrennte Teile der Locomotion bleiben. Entscheidend ist die Zuständigkeit, nicht eine bestimmte Anzahl Dateien.

### 17.2 P0 – Referenz und Regressionen festhalten

Den Implementierungsstand pinnen, relevante Gegnerprofile erfassen und deterministische Problemkarten beziehungsweise feste Seeds anlegen. Baseline für felsreiche Maps und den Basis-Vorbeilauf aufnehmen. Tests sollen Absicht, Route, Angriffsauslösung und Bewegung unterscheiden können.

**Abschluss:** reproduzierbare Ausgangsfälle und dokumentierte bisherige Sonderregeln; noch keine Aussage, dass die neue Performance erreicht ist.

### 17.3 P1 – Geometrieadapter und 16-px-Navigation

Weltraster entkoppeln, korrekt ausgerichtete Navigationspunkte, sichere Kanten, Körperprofile und Start-/Zielanschlüsse einführen. Bereits existierende Worker-/Generation-Verträge weiterführen. Gelände- und Wegkosten auf Weltstrecken beziehen.

**Abschluss:** Geometrietests für 32-px-Lücken, Kurven, runde Trunks, passende Bossdurchgänge und dynamische Änderungen bestehen. Während der Entwicklung ist ein Vergleich gegen die alte Route möglich; kein dauerhafter doppelter Produktivpfad als Ziel.

### 17.4 P2 – Gemeinsame Absicht und Zielbindung

Primärziel, Fallback, Hysterese und erlaubte Nebenangriffe zusammenführen. Angriffs- und Positionierungssysteme daran anbinden. Die Verbündeten liefern ihre Besitzer-/Follow-Absicht in denselben fachlichen Vertrag.

**Abschluss:** Kein unerlaubter aktiver Basiswechsel beim Vorbeilaufen; erreichbarer Spieler vor Durchbruch; richtige Ersatzziele. Bestehende ausdrücklich erlaubte Boss-Nebenangriffe bleiben möglich.

### 17.5 P3 – Lokale Bewegung, Angriffsplätze und Recovery

Konsistente Nachbarschaft, sichere Korridorführung, vorausschauendes Ausweichen, größenabhängige Separation und begrenzte Verdrängung integrieren. Freie Angriffspositionen und die Zustandsunterscheidung für Fortschritt/Warten/Recovery ergänzen. Feinde und Verbündete nutzen diesen Unterbau.

**Abschluss:** Die vorhandenen felsreichen Problemfälle laufen sichtbar zuverlässiger. Wartende oder angreifende Gegner lösen kein unpassendes Recovery-Verhalten aus. Einheiten werden nicht durch die neue Glättung oder Verdrängung in Wände getragen.

### 17.6 P4 – Begründeter gemeinsamer Durchbruch

Aktuelle harte Erreichbarkeit als Freigabe verwenden. Geeignete Öffnungen, objektbezogene Kosten, gemeinsame Pläne, legitime Angriffspositionen und Basis-als-letzter-Ausweg implementieren. Vorhandene Bite-Angriffe anbinden und fehlende reguläre Durchbruchsfähigkeit validieren.

**Abschluss:** Vollständige Wegsperren werden geöffnet; freie Umwege, vorübergehender Stau und ausstehende Ergebnisse lösen keine Durchbruchsangriffe aus. Geöffnete Wege beenden einen laufenden Auftrag.

### 17.7 P5 – Dichte und Taktung abstimmen

Günstigen Dichteaufbau und begrenzte Staukosten ergänzen. Entscheidungen zeitlich verteilen, Jobs bündeln und End-to-End-Reaktionszeit prüfen. Optionales Feintuning darf die bereits bestandenen Sicherheits- und Verhaltensfälle nicht regressieren.

**Abschluss:** Sinnvolle Alternativwege werden genutzt; unvermeidbare Engstellen bleiben durchlässig; keine synchron pendelnde Menge. 250-ms-Routenreaktion im Referenztest erreicht.

### 17.8 P6 – Gesamtqualifikation des ersten Lieferumfangs

Produktionsbuild im Browser messen, Kampf-/Spezial-/Ally-Fälle durchspielen, vorhandene Core-, Integrations- und Architekturprüfungen ausführen. Übergangs- und Legacy-Code entfernen, Debug-Dokumentation und Messvergleich ablegen.

**Abschluss:** Ziel F ist erfüllt: bessere bestehende Gegner bis 100, stabile 60 FPS im festgelegten Solo-Referenzfall und keine bekannten grundlegenden Fähigkeits-/Koop-Regressionen.

### 17.9 Spätere Phase S – Schwarmgegner

Erst danach den neuen Kontaktgegner implementieren. Mit 250, 500 und gegebenenfalls 1.000 Einheiten isoliert und in Mischgruppen messen. Weitere Vereinfachungen nur an den gemessenen Engpässen durchführen. Diese Phase ist nicht Voraussetzung für die Abnahme von P6.

### 17.10 Rollout-Regel

Zwischenschritte müssen gezielt testbar sein. Solange Zielbindung, Durchbruch und Geometrie noch nicht gemeinsam vollständig sind, darf eine halbfertige Kombination nicht als fertige neue Standard-KI ausgeliefert werden. Ein temporärer Entwicklungsumschalter ist möglich; nach erfolgreicher Migration bleibt ein kanonischer Produktivpfad.

---

<a id="abnahme"></a>
## 18. Tests, Messung und Abnahme

### 18.1 Geometrie und dynamische Topologie

| Test | Erwartung |
|---|---|
| G01 – 30-px-Körper in 32-px-Gang | Sichere Mittellinie enthalten; Passage ohne Wanddurchtritt möglich. |
| G02 – horizontaler und vertikaler Gang mit 90°-Knick | Körper folgt dem tatsächlichen freien Korridor; keine abgeschnittene Innenecke. |
| G03 – 56-px-Körper in geometrisch freiem geradem 64-px-Gang | Das Profil findet die sichere mittlere Verbindung. |
| G04 – Boss vor tatsächlich zu schmaler Lücke | Keine fiktive Route durch die Lücke. |
| G05 – freie Endpunkte, blockierter Sweep | Verbindung wird verworfen. |
| G06 – runder Trunk neben rechteckigem Fels | Körperradius und seltene Rundgeometrie korrekt; kein voreiliger Durchbruch wegen fehlerhaftem Anschluss. |
| G07 – von der Standardkarte abweichender Ursprung und Abmessungen | Welt-/Nav-Koordinaten bleiben korrekt. |
| G08 – Mauerbau auf bisheriger Route | Sofortiger physischer Schutz; bis zur neuen Entscheidung `route-pending` statt unbegründetem Durchbruch. |
| G09 – Zerstörung öffnet den letzten Durchgang | Erreichbarkeit und benutzte Route werden aktualisiert. |
| G10 – Bau und Entfernung in kurzem Abstand | Endzustand korrekt; keine veraltete Sperre und keine Phantomöffnung. |
| G11 – mehrere Hindernisquellen auf einem Bereich | Entfernung einer Quelle entfernt nicht andere noch aktive Blocker. |
| G12 – Rundenteardown während Worker-Job | Kein altes Ergebnis wird in der neuen Activity aktiv. |

### 18.2 Ziel- und Kampfverhalten

| Test | Erwartung |
|---|---|
| Z01 – Spielerjäger läuft an Basis vorbei | Kein aktiver Basisangriff allein wegen Nähe. |
| Z02 – Schuss auf Spieler trifft unbeabsichtigt Basis | Bestehende Kollateralregel bleibt erhalten; nicht als Zielwahlfehler werten. |
| Z03 – zweiter Spieler wesentlich schneller erreichbar | Geordneter Zielwechsel ohne hektisches Pingpong. |
| Z04 – alter Spieler hinter Mauer, anderer frei erreichbar | Freier Spieler gewinnt; kein unnötiger Durchbruch. |
| Z05 – keine gültigen Spieler, geeignete Basis vorhanden | Standard-Fallback zur Basis. |
| Z06 – weder Spieler noch Basis, letzte Position bekannt | Zulässige Erinnerung wird angelaufen; keine Phantomangriffe. |
| Z07 – keinerlei Ziel oder Erinnerung | Sicher warten statt erfundener Zielkoordinate. |
| Z08 – Basisangreifer trifft nahen Spieler | Standard bleibt Belagerung; explizites Reaktionsprofil darf abweichen. |
| Z09 – Mehrzielfeld ändert Gewinner | Gespeicherte Zielabsicht und tatsächlich benutzte Route bleiben konsistent. |
| Z10 – Nahkämpfer an Spieler und konkaver Basis | Freie erreichbare Seiten werden genutzt; keine Luftlinie durch die Basis. |
| Z11 – Fernkämpfer kann von freier Position schießen | Kein unnötiger Durchbruch nur wegen unerreichbarem Zielmittelpunkt. |
| Z12 – Ziel verschwindet während Reservierung/Windup | Lifecycle-Regeln korrekt; keine neue Aktion auf ein veraltetes Objekt. |

### 18.3 Bewegung und Durchbruch

| Test | Erwartung |
|---|---|
| B01 – Ecke mit offenem Umweg | Recovery beziehungsweise Umweg, kein Durchbruchsangriff. |
| B02 – 100 Einheiten am unvermeidbaren Engpass | Erlaubtes Warten mit Durchfluss; kein dauerhaftes Zittern oder Freibeißen wegen Crowd. |
| B03 – kurzer überfüllter und längerer freier Weg | Die geschätzte Ankunftszeit beeinflusst die Verteilung sinnvoll; keine dauernde synchrone Seitenwechselwelle. |
| B04 – einziger Zugang durch Mauer versperrt | Bestätigter Durchbruchsauftrag auf erreichbare Öffnung. |
| B05 – wählbare schwache und starke Wegsperre | Anmarsch plus wirksame Zerstörungszeit entscheidet innerhalb der erlaubten Stufe. |
| B06 – mehrlagige Mauer | Zuerst vorderen erreichbaren Blocker entfernen, dann neu fortsetzen. |
| B07 – Boss benötigt breitere Öffnung | Mehrere notwendige Objekte als Öffnung berücksichtigen; nicht nach einem zu schmalen Loch loslaufen. |
| B08 – viele nahe Angreifer | Gemeinsamen Auftrag verwenden; wirksame Frontplätze begrenzen, Nachrücken ermöglichen. |
| B09 – anderer Gegner öffnet parallel freien Weg | Neue Durchbruchsangriffe einstellen und Primärziel wieder aufnehmen. |
| B10 – Basis als einzig herstellbarer Zugang | Letzter-Ausweg-Auftrag zulässig, sofern Fraktions-/Schadensregeln das erlauben. |
| B11 – Durchbruch ohne Basis noch möglich | Kein Basisschaden nur zur Abkürzung. |
| B12 – vollständig unzerstörbar eingeschlossen | Keine sinnlosen Angriffe; kontrollierter Zustand ohne herstellbaren Weg. |
| B13 – Suchbudget erschöpft oder Ergebnis veraltet | `pending`, nicht vermeintlich nachgewiesen unerreichbar. |
| B14 – geringes Gegner-Overlap und Verdrängung | Keine unbeschränkten Impulse, keine Bewegung durch Weltblocker, große Körper geben weniger nach. |
| B15 – teilweise eingebetteter Start nach Impuls | Kontrollierte Recovery ohne Wandteleportation. |
| B16 – normaler Gegner ohne passenden Bite | Konfigurationsprüfung schlägt nachvollziehbar fehl; kein stiller Verlust der Durchbruchsfähigkeit. |

### 18.4 Sonderfähigkeiten und Verbündete

Rauch-/Sichtregeln, Köderbindung, Panik, Infektionsziele, Eingraben, Ausweichen, Zeitblasen, Rückstoß, Zugreaktionen, Bossphasen und Salven werden mit ihrer vorher festgehaltenen Spielanforderung verglichen. Die Tests prüfen nicht nur, ob eine Methode noch aufgerufen wird, sondern ob die jeweilige Wirkung erhalten bleibt.

Für Verbündete werden Besitzerfolge, getrennte Follow-Plätze, Leash-Rückkehr, erlaubter Teleport, Tod des Besitzers, Fraktionswechsel und Gruppenbewegung neben normalen Gegnern getestet. Eigene Mauern/Basen dürfen nicht durch die gemeinsame Durchbruchslogik zu feindlichen Zielen werden.

### 18.5 Leistungsmessung

Baseline und neue Version werden mit identischer Map beziehungsweise Seed, gleichem Gegnerprofil-Mix, identischem Loadout, gleicher Grafik-/Auflösungseinstellung und vergleichbarem Ablauf im Produktionsbuild gemessen. Browser, Hardware, Bildwiederholrate und Renderauflösung werden beim Test dokumentiert; keine Hardwareeigenschaften aus einem anderen Benchmark übernehmen.

Die Basisfixture enthält 100 feindliche Gegner im Solo-Kampf. Zusätzlich gibt es eine klar dokumentierte Mischfixture mit insgesamt 100 KI-Einheiten einschließlich Verbündeter sowie einen normalen Nekromantie-Spieltest. So wird sichtbar, welche Population gerade gemessen wurde, ohne das vereinbarte Ziel stillschweigend auf einen beliebig größeren Bestand auszudehnen.

Messreihen mit 20, 50 und 100 Einheiten helfen bei der Skalierungsanalyse. Vorgeschlagen sind mehrere Wiederholungen mit Aufwärmphase und mindestens rund einer Minute normaler Arena-Simulation pro repräsentativer Reihe. Lade-/Lobbywechsel werden getrennt ausgewertet; Massenkills, Hindernisänderungen und normale Kampfspitzen bleiben Teil des Gameplay-Tests.

Zu erfassen sind Framezeiten/FPS, p50/p95/p99, Main-Thread-KI-Zeit, Worker-Rechenzeit, End-to-End-Routenlatenz, tatsächlich besuchte Nachbarn, aktive Felder/Jobs, Garbage-Collection-Spitzen sowie getrennte Physik-/Combat-/Darstellungskosten. Das 60-FPS-Ziel wird am Gesamtspiel beurteilt, nicht nur an einer leeren Bewegungsfixture.

### 18.6 Verhaltensmetriken

Neben Zeitmessungen werden gezählt: unbegründete aktive Basisangriffe, Durchbruchsangriffe trotz freiem Weg, bestätigte Blockaden, Recovery-Versuche und -Erfolg, Zeit ohne legitimen Fortschritt, Zielwechsel, Durchsatz an Engstellen und neu gestartete Durchbruchssuchen.

Für Z01 sowie B01 und B13 werden in den kontrollierten Fixtures null unzulässige neue Angriffsaufträge erwartet. Physikalischer Kollateralschaden und ausdrücklich erlaubte normale Belagerungsangriffe werden separat klassifiziert.

Verbesserung gegenüber der Baseline bedeutet weniger ungelöste Bewegungsklemmen und keine neue wiederkehrende Pendelbewegung. Mehr Pathfinding-Aufrufe allein sind kein Qualitätsmerkmal.

### 18.7 Debug-Ansicht

Eine optionale Ansicht zeigt ausgewählten Gegnern zugeordnet: Absicht und Ziel, Feld-/Topologieversion, sicheren nächsten Abschnitt, Zustand, aktuellen Warte-/Recovery-Grund, Angriffsposition und Durchbruchsobjekt. Raster, harte Blocker und weiche Dichte müssen unterscheidbar darstellbar sein.

Die Diagnose ist im normalen Betrieb abschaltbar. Kein umfangreiches Logging pro Gegner und Frame. Ereignisbasierte Übergänge und aggregierte Zähler reichen für die häufigsten Analysen.

### 18.8 Definition of Done des ersten Umfangs

Der erste Umfang ist abgeschlossen, wenn die verbindlichen Regeln R01–R22 in den passenden Tests abgedeckt sind, die 16-px-Geometrie insbesondere die bisherigen 32-px-Passagen erhält, die bestehenden Gegner und Verbündeten nachvollziehbar besser laufen und das vereinbarte 60-FPS-Soloziel im dokumentierten Referenzszenario erreicht wird.

Die Routenreaktion auf eine einzelne relevante Hindernisänderung soll im Referenztest innerhalb von ungefähr 250 ms nutzbar werden; Angriffswindup und die tatsächliche Zerstörung einer Mauer gehören nicht zu dieser Planungsreaktionszeit. Überlastfälle werden zusätzlich sichtbar dokumentiert.

Erforderlich sind bestandene relevante bestehende Tests, neue Regressionstests, ein Vorher-/Nachher-Bericht, dokumentierte Profilmigration und entfernter überflüssiger Übergangscode. Die spätere Schwarmmenge ist noch keine Abnahmebedingung.

---

<a id="risiken"></a>
## 19. Risiken und bewusste Nicht-Ziele

| Risiko | Gegenmaßnahme |
|---|---|
| 16-px-Punkte verlieren die sichere Gangmitte | Ausrichtung und konkrete Kreis-/Gangtests vor Integration des Verhaltens. |
| Präziser Endpunkt, aber unsichere Verbindung | Kanten-/Sweepprüfung und sichere tatsächliche Bewegung. |
| Zu konservatives Profil erklärt freie Wege für gesperrt | Körper/Komfort trennen, passende Profile, Anschlussprüfung und gezielte Geometriefälle. |
| Dichte wird wie eine Wand behandelt | Harte Konnektivität strikt von endlichen weichen Kosten trennen. |
| Ziel-Lock und Mehrzielfeld widersprechen sich | Zielquellenmapping gemeinsam mit dem Feld aktivieren. |
| Durchbruch wird eine billige Abkürzung | Freie Wege und erlaubte Alternativziele zuerst; getrennte Freigabe. |
| Viele Gegner rechnen denselben Durchbruch | Geteilte Planungsaufträge und versionierter Cache. |
| Eine Mauer wird mehrfach oder ein Bossloch zu klein berechnet | Logische Objekt- und Öffnungsgruppen statt Kosten je Rasterpunkt. |
| Neue Mauer und altes Worker-Ergebnis | Sofortiger Sicherheitsblock, Versionsprüfung, `pending` statt voreiliger Entscheidung. |
| Dauernde Dichte-/Zielupdates verdrängen jeden Job | Relevanzschwellen, getrennte Versionen, begrenzte aktuelle Queue. |
| Kollision oder Bewegung wird durch 250-ms-Trägheit unzuverlässig | Entscheidungs- und Ausführungstakt trennen. |
| Alle Systeme schreiben Geschwindigkeiten | Eine verbindliche Übergabe mit ausdrücklichen Spezial-Overrides. |
| Gute KI, aber weiterhin niedrige FPS durch andere Systeme | Gesamtspiel messen und Engpass klar zuordnen; keine falsche KI-Performancezusage. |
| Umfang wächst zu einer neuen allgemeinen Engine | Wenige Zuständigkeiten, vorhandene Runtime-/Combat-/Worker-Struktur beibehalten. |

Bewusst nicht garantiert werden perfekte lückenlose Packung, physikalisch exakte Flüssigkeitsbewegung, globale mathematische Optimalität jedes Durchbruchsplans oder beliebig viele Einheiten bei konstantem Aufwand. Diese Ziele sind für die vereinbarte Verbesserung nicht notwendig.

**Priorität bei Zielkonflikten:** korrekte Spielregeln und Weltkollision → verlässliches Erreichen des erlaubten Ziels → ruhige Bewegung → bessere Mengenverteilung → zusätzliche optische Schwarmwirkung. Ein schöner Fluss rechtfertigt keine falschen Angriffe oder Wanddurchtritte.

---

<a id="quellen"></a>
## 20. Quellen und Übergabe

### 20.1 Herkunft der Anforderungen

R01–R22 stammen aus der vorangegangenen Anforderungsklärung mit dem Nutzer. Die Festlegung des Referenzszenarios lautet ausdrücklich **High-End-Test-PC, Solospiel, 100 Gegner, 60 FPS**. Diese Angaben sind Produktanforderungen, keine Messdaten aus dem Repository.

### 20.2 Erneut geprüfte Repository-Quellen

Die Links sind auf den geprüften Commit fixiert, damit spätere Änderungen die Begründung dieses Dokuments nicht unbemerkt verändern.

| Quelle | Datei / geprüfter Zusammenhang |
|---|---|
| [S1] | Repository-Commit `468d177b913a049f7dcf0667388c00b76f0d5a70`, zuletzt abgefragter `main`-Stand. |
| [S2] | `src/entities/EnemyManager.ts`, insbesondere Zeilen 410–625: Flowfield-Auswahl, Overrides, Recovery-Anfahrt und reguläres Steering. |
| [S3] | `src/systems/CoopDefenseEnemyAttackSystem.ts`, Zeilen 400–680: Waffen-/Zielauswahl, Basenpriorität und Angriffsfortsetzung. |
| [S4] | Dieselbe Datei, Zeilen 935–1055: Fortschrittsüberwachung und Freigabe von Hindernisangriffen. |
| [S5] | `src/systems/flowfield/FlowFieldSources.ts`: Rasterquellen, Weltzelleneinträge und Änderungsereignisse. |
| [S6] | `src/systems/flowfield/FlowFieldCoordinator.ts`, Zeilen 1–195: Worker-/Puffereigentum, Feldverträge, Versionen und Diagnose. |
| [S7] | `src/activity/CoopMissionCombatComposition.ts`, Zeilen 85–223: Ownership, Rastermetriken und Feldregistrierung. |
| [S8] | `src/activity/CoopMissionHostUpdate.ts`, Zeilen 110–245: bisherige Reihenfolge der Activity-Updates. |
| [S9] | `src/systems/NecromancySystem.ts`, Zeilen 1–255: Besitzerlogik, gemeinsame Ziele, Follow-Plätze und Lebenszyklus. |

Die Integrationstabelle benennt darüber hinaus bekannte Anschlussstellen aus der Vorprüfung. Vor ihrer Änderung sind deren dann aktuelle Implementierung und Tests erneut zu lesen. Dieses Dokument behauptet weder einen vollständigen erneuten Audit des gesamten Repositories noch bereits durchgeführte Implementierungs- oder Browsertests.

### 20.3 Technische Primärquellen zur Einordnung

- [E1] Craig Reynolds: *Steering Behaviors for Autonomous Characters*. Grundlage für die Trennung von Zielsetzung, lokaler Steuerung und Fortbewegung sowie die Kombination einfacher Bewegungsverhalten.
- [E2] Offizielle Dokumentation des A* Pathfinding Project: *Pathfinding on tilemaps*. Belegt die Möglichkeit, Karten- und Navigationsauflösung zu trennen; keine Empfehlung einer universellen Zellgröße.
- [E3] Forschungsprojekt *Continuum Crowds*, University of Washington. Hintergrund zu dynamischen Potentialfeldern für Mengenbewegung; das hier vorgeschlagene System ist keine Implementierung dieses vollständigen Verfahrens.

### 20.4 Übergabe an die Implementierung

Vor Umsetzung den tatsächlichen Arbeitsstand mit diesem Referenzstand abgleichen. Die Anforderungen und Abnahmefälle haben Vorrang vor vorgeschlagenen Klassennamen. Bereits vorhandene passende Mechanismen sollen wiederverwendet werden; neuere Optimierungen an Combat, Projectiles und Effekten dürfen nicht auf Basis früherer Befunde zurückgebaut werden.

Abzuliefern sind der integrierte Quellcode, neue und angepasste Regressionstests, eine dokumentierte Zuordnung der Gegnerprofile, eine abschaltbare Diagnose und ein reproduzierbarer Vorher-/Nachher-Bericht. Abweichungen vom vorgeschlagenen technischen Weg werden kurz mit ihrem Nutzen und der Erfüllung der Anforderungen dokumentiert.

> **Ziel des ersten Umbaus ist nicht „mehr KI-Systeme“, sondern dieselben Gegner mit klareren Entscheidungen, sichereren Wegen und einem nachvollziehbaren Umgang mit Blockaden. Die spätere Schwarmfähigkeit entsteht aus diesem gemeinsamen Unterbau und gezielt reduzierter Arbeit pro Massengegner.**

[S1]: https://github.com/Dominik-Steinweg/Fragdachse/commit/468d177b913a049f7dcf0667388c00b76f0d5a70
[S2]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/entities/EnemyManager.ts#L410-L625
[S3]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/systems/CoopDefenseEnemyAttackSystem.ts#L400-L680
[S4]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/systems/CoopDefenseEnemyAttackSystem.ts#L935-L1055
[S5]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/systems/flowfield/FlowFieldSources.ts
[S6]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/systems/flowfield/FlowFieldCoordinator.ts#L1-L195
[S7]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/activity/CoopMissionCombatComposition.ts#L85-L223
[S8]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/activity/CoopMissionHostUpdate.ts#L110-L245
[S9]: https://github.com/Dominik-Steinweg/Fragdachse/blob/468d177b913a049f7dcf0667388c00b76f0d5a70/src/systems/NecromancySystem.ts#L1-L255
[E1]: https://www.red3d.com/cwr/steer/gdc99/
[E2]: https://arongranberg.com/astar/docs/tilemaps.html
[E3]: https://grail.cs.washington.edu/projects/continuum-crowds/
