# Fragdachse – Map-Editor V1

**Konzeptversion:** 2  
**Stand:** 21. September 2026  
**Status:** Überarbeitetes Konzept auf Basis der abgestimmten Anforderungen; keine bereits erfolgte Implementierung.  
**Grundlage:** Die in der vorherigen Konzeptfassung dokumentierte statische Prüfung der relevanten Dateien aus `Dominik-Steinweg/Fragdachse`, Branch `main`. Die verbleibenden Quellen sind am Ende aufgeführt; sie wurden für diese redaktionelle Überarbeitung nicht erneut geprüft.

## 1. Ziel und verbindlicher Umfang

Der Editor ist ein internes Werkzeug, um die räumliche Gestaltung und die Gegnerzusammenstellung bestehender Maps gemeinsam zu bearbeiten. **Encounter-Bearbeitung und tatsächliche Map-Bearbeitung mit Vorschau sind gleichwertige Kernbestandteile von V1.** Keine der beiden Funktionen wird auf einen späteren Ausbau verschoben.

Bearbeitet werden die Gestaltungsvorgaben, nicht ein eingefrorenes Zufallsergebnis. Der vorhandene Generator erzeugt daraus weiterhin unterschiedliche Spielrunden. Die Oberfläche soll funktional, gut lesbar und schnell bedienbar sein; ausgearbeitete Spielgrafik und aufwendiges Oberflächendesign sind nicht erforderlich.

| Bereich | Festlegung für V1 |
|---|---|
| Einstieg | Separates lokales Browserwerkzeug, ohne Start des eigentlichen Spiels. |
| Encounter | Zweistufige Bearbeitung: Encounter-Übersicht und vollständige Gegnerartenliste je Encounter. |
| Auswertung | XP je Encounter, Encounter-XP-Summe und klar getrennte weitere XP-Quellen. |
| Landschaft | Map-Größe, Felsdichte, Baumanzahl, Korridore, Wasser und Felswände. |
| Tutorial | Tutorial-Felsflächen anzeigen und über ihre gekoppelten Tutorial-Anker verschieben. |
| Missionsgeometrie | Bestehende Startbereiche, Checkpoints, Basen/Missionspositionen und Spawnzonen anpassen. |
| Boss | Separaten Boss-Slot bearbeiten. |
| Vorschau | Schematische Draufsicht auf das tatsächlich generierte Layout, mit bearbeitbaren Vorgaben als Überlagerung. |
| Zufall | Vorschau-Seed festhalten oder neu würfeln; im Spiel bleibt die bisherige Variation erhalten. |
| Speichern | Ausdrücklich ausgelöstes direktes Speichern in lokale Projektdateien. |
| Nicht enthalten | Neuanlage von Maps, integrierter Spieltest, Belohnungseditor, Missionsartwechsel, allgemeiner Ereigniseditor und Einzelplatzierung beliebiger Bäume/Felsen. |

Die nachstehenden Bedienungsdetails sind Ausarbeitungen dieses Umfangs. Insbesondere bedeutet „Tutorial-Felsflächen bearbeiten“ in V1 das Verschieben der gekoppelten Flächen, nicht das freie Skalieren des Tutorial-Fensters.

Das Tool soll von Anfang an so aufgebaut werden, dass spätere Erweiterungen einfach möglich sind. Die konkrete Architektur, die detaillierte Ausarbeitung von Validierung, Fehlermeldungen und Rückgängig sowie Implementierungsreihenfolge und Abnahme werden im späteren Implementierungsplan festgelegt.

## 2. Oberfläche und Arbeitsablauf

Als Einstieg ist ein neuer Befehl wie `npm run map:editor` vorgesehen. Dieser Name ist ein Vorschlag; in der für die vorherige Konzeptfassung geprüften `package.json` war er noch nicht enthalten. [R7] Das Werkzeug startet einen eigenen lokalen Server und eine eigene Browserseite. Es lädt keine Lobby und startet weder Multiplayer noch Spielsimulation.

Die gemeinsame Kopfzeile enthält Map-Auswahl, Datei/Map-ID, Speichern, Rückgängig/Wiederholen und den Änderungsstatus. Die aktuelle Missionsart bleibt sichtbar, aber schreibgeschützt.

Es gibt zwei Hauptansichten:

**Karte:** Links eine nach Elementtypen gegliederte Objektliste, in der Mitte die zoombare Vorschau und rechts die Eigenschaften des ausgewählten Elements. Mausbearbeitung und Zahlenfelder verändern dieselben Daten. Layer lassen sich ein- und ausblenden.

**Encounter:** Oben die Encounter-Tabelle, darunter die Gegnerliste des ausgewählten Encounters. Die Übersicht bleibt beim Bearbeiten sichtbar. Ein kleiner zusätzlicher Bereich enthält den separaten Boss und die XP-Zusammenfassung. „Spawngebiet auf Karte bearbeiten“ wechselt zur Kartenansicht und selektiert genau die zugehörige Gruppe. Beim Zurückwechseln bleiben Auswahl und Scrollposition erhalten.

Diese Anordnung braucht kein frei konfigurierbares Fenster- oder Dockingsystem. Beide Ansichten bearbeiten denselben Map-Entwurf; Änderungen bleiben beim Wechsel zwischen Karte und Encountern erhalten.

Der typische Ablauf lautet: Map öffnen, Encounter und Gelände ändern, mit festem Seed vergleichen, weitere Varianten prüfen, Validierung beachten, bewusst speichern. Der anschließende Spieltest erfolgt wie bisher im regulären Spiel.

## 3. Encounter-Bearbeitung

### 3.1 Stufe 1: Übersicht

| Spalte | Verhalten |
|---|---|
| Reihenfolge / ID | Stabile Identität und tatsächliche Reihenfolge im Quelldokument. |
| Startbedingung | Bestehenden Triggertyp auswählen und dessen Parameter bearbeiten. |
| Pause danach | Sekundenfeld; Speicherung entsprechend dem vorhandenen Millisekundenvertrag. |
| Gegneranzahl | Summe direkt eingeplanter Gegner, nicht unbeschriftet inklusive Folgegegner. |
| Encounter-XP | Berechnetes festes XP-Potenzial; dynamische Anteile separat kennzeichnen. |
| Hinweise | Ungültige Referenzen, unvollständige Werte und besondere Triggersemantik. |

Encounter können angelegt, dupliziert, gelöscht und über eindeutige Auf-/Ab-Aktionen verschoben werden. Eine rein visuelle Tabellensortierung darf die Ausführungsreihenfolge nicht heimlich verändern.

Die bestehenden Startbedingungen werden als typisierte Formulare angeboten, nicht als frei programmierbare Ausdrücke: Zeit, vorheriger Encounter, bestimmter Encounter, Checkpoint, Verteidigung, Ereignis, Bossphase oder zerstörte Basis. Auswahlfelder beziehen ihre Ziele aus dem aktuellen Entwurf. [R1]

IDs werden nicht automatisch neu durchnummeriert. Beim Duplizieren eines Encounters entsteht eine neue eindeutige ID, während dessen sonstige Einstellungen übernommen werden. Vor dem Löschen und Umordnen prüft der Editor Referenzen im gesamten Dokument – auch in nicht editierbaren Ereignissen und Nebenzielen. Eine Löschung mit verbleibenden Referenzen wird blockiert und mit Verweisen auf die betroffenen Stellen erklärt. Eine Umordnung mit `after-previous` zeigt die dadurch veränderte Abhängigkeit.

Missionsartspezifische Bedeutungen müssen den vorhandenen Resolvern entsprechen. Eine Pause nach dem letzten Encounter oder ein im jeweiligen Modus nicht wirksamer Parameter darf nicht als scheinbar aktive Einstellung präsentiert werden.

### 3.2 Stufe 2: Alle Gegnerarten

Für den ausgewählten Encounter werden alle bekannten Gegnerarten aus der zentralen Gegnerdatenquelle angezeigt. Die Hauptspalten sind **Name/Art, Menge, direkte XP pro Gegner und XP-Beitrag**. Suche und „Nur verwendete anzeigen“ sind zusätzliche Hilfen; standardmäßig ist die vollständige Liste sichtbar.

**0 bedeutet nicht enthalten.** Eine positive ganze Zahl legt eine Gruppe an oder ändert deren Menge. Nullen werden nicht als echte Spawn-Gruppen gespeichert. Negative Werte, Brüche und ungültige Eingaben sind Fehler. Ein kurzzeitig leeres Eingabefeld beim Tippen ist noch kein Löschbefehl.

Gegnerarten, die nach den bestehenden Regeln nicht in reguläre Encounter gehören, bleiben mit Begründung sichtbar, sind dort aber nicht auswählbar. Gegnerwerte und globale XP pro Art werden in diesem Werkzeug nicht verändert.

### 3.3 Mehrere Gruppen derselben Gegnerart

Das bestehende Modell erlaubt unterschiedliche Verzögerungen, Spawnfenster und Spawnorte pro Gruppe. Diese Information darf die vereinfachte Mengenliste nicht verlieren. [R1]

Bei genau einer Gruppe ist die Menge direkt in der Hauptzeile bearbeitbar. Bei mehreren Gruppen zeigt die Hauptzeile die berechnete Gesamtmenge und beispielsweise „2 Spawn-Gruppen“. Die Gesamtmenge ist dann schreibgeschützt. Aufklappbare Unterzeilen erlauben das Bearbeiten der einzelnen Mengen sowie das Hinzufügen und Entfernen von Gruppen. Der Editor verteilt keine Gesamtänderung eigenmächtig auf mehrere Gruppen.

Pro Gruppe sind `delayMs`, `spawnStaggerMs` und entweder `front` oder `spawnArea` bearbeitbar. Eine neue Gruppe startet mit einer sichtbar bezeichneten Standard-Spawnvorgabe; sie erbt nicht unbemerkt einen fremden Spawnort. Rechteckige Spawngebiete lassen sich auf der Karte aufziehen, verschieben und skalieren. Die Zugehörigkeit zu Encounter, Gegnerart und Gruppe bleibt sichtbar.

Ein vollständig geleerter Encounter darf als Zwischenstand im Entwurf existieren. Er wird nicht automatisch gelöscht. Ob er gespeichert werden darf, entscheidet die bestehende fachliche Validierung.

### 3.4 Separater Boss

Der Boss-Slot wird außerhalb der normalen Gegnerliste bearbeitet. V1 unterstützt Hinzufügen/Entfernen im Rahmen der bestehenden Missionsregeln, Auswahl einer zulässigen Gegnerart und den Spawnzeitpunkt. Der vorhandene Vertrag enthält `enemyKind` und `spawnAtMs`; ein frei positionierbarer Boss-Spawnpunkt wird nicht erfunden. [R2]

Das Entfernen eines für das Missionsziel benötigten Bosses wird als Fehler behandelt. Bossabhängige Trigger werden mitgeprüft. Boss-XP erscheinen separat und werden nicht ein zweites Mal in die Encounter-Summe eingeschleust.

## 4. XP-Auswertung

Die Hauptkennzahlen sind **XP des ausgewählten Encounters** und **Summe der XP aller Encounter**. Sie aktualisieren sich nach einer gültig abgeschlossenen Eingabe unmittelbar. Eine Geländeneugenerierung ist dafür nicht notwendig.

V1 verwendet einen ausdrücklich angezeigten Referenzkontext mit einem Spieler. Bearbeitet werden die ursprünglichen Mengen, nicht bereits für mehrere Spieler skalierte Runtime-Werte. Das Ergebnis beschreibt das konfigurierte XP-Potenzial, nicht die garantierte individuelle Ausbeute eines tatsächlichen Durchlaufs.

Für eine Gegnergruppe gilt konzeptionell:

`Feste Gruppen-XP = Menge × (direkte Gegner-XP + feste Folge-XP je Gegner)`

Feste Folgegegner, beispielsweise konfigurierte `deathSpawns`, werden durch gemeinsame Fachlogik berücksichtigt. Direkte und Folge-XP bleiben getrennt einsehbar. Rekursive oder unbekannte Konfigurationen dürfen nicht zu Endlosschleifen oder stillschweigend zu „0 XP“ führen; die Auswertung wird dann als unvollständig markiert.

| Anzeige | Abgrenzung |
|---|---|
| Encounter-XP gesamt | Nur die festen XP-Anteile der Encounter einschließlich definierter Folgegegner. |
| Boss-XP | Separater Slot, genau einmal berücksichtigt. |
| Weitere feste XP | Vorhandene Nebenzielbelohnungen, schreibgeschützt und als bedingt erreichbar gekennzeichnet. |
| Dynamische Zusatz-XP | Laufzeitabhängige Beschwörungen und permanente Spawnquellen; keine scheinbar exakte Gesamtsumme. |

Referenzwerte für dauerhafte Quellen dürfen zusätzlich angezeigt werden, sofern Bezugsdauer und Annahmen sichtbar sind. Sie werden nicht ohne Beschriftung zu den festen Encounter-XP addiert. Die Auswertung verändert weder Gegner-XP noch die Levelkurve und trifft keine automatische Balancingentscheidung.

Die vorhandene Balance-Auswertung ist Ausgangspunkt, aber nicht unverändert zu übernehmen: In `buildCoopDefenseBalanceMapSnapshot` kann `dynamic ||= addEncounterTotals(...)` nach dem ersten dynamischen Encounter die Addition nachfolgender Encounter überspringen. Berechnung und Setzen des Flags müssen getrennt werden. Die Auswertung muss auch nach einem dynamischen Encounter weiterhin sämtliche Encounter berücksichtigen. [R3]

## 5. Bearbeitung der Map

### 5.1 Gemeinsame Regeln

Die Bearbeitung erfolgt im vorhandenen Zellkoordinatensystem. Umrechnung, Ursprung und Zellgröße kommen aus den gemeinsamen Weltmetriken, nicht aus duplizierten Editor-Konstanten. Auswählen, Ziehen, Zahlenfelder und optionale Rasterbindung sind die grundlegenden Werkzeuge. Ein Ziehvorgang entspricht einer einzigen rückgängig machbaren Änderung.

Bestehende optionale Parameter zeigen ihren wirksamen Standardwert und die Herkunft „Standard“ oder „explizit gesetzt“. Das bloße Öffnen einer Map schreibt keine Standardwerte in sämtliche bisher fehlenden Felder.

| Element | Bedienumfang in V1 |
|---|---|
| Map-Größe | Breite/Höhe bearbeiten, Grenzen sichtbar machen. Beim Verkleinern außerhalb liegende Elemente auflisten, nicht heimlich abschneiden. |
| Fels-/Baumparameter | Felsdichte, vorhandener Felsfeldmodus, Dichteskalierung und Baumanzahl bearbeiten. Unwirksame Parameter kennzeichnen. |
| Korridore | Anlegen, löschen, duplizieren; Wegpunkte hinzufügen, verschieben und entfernen; Radius und vorhandene globale Zufallsparameter bearbeiten. |
| Wasser | Rechteckige `waterAreas` anlegen, verschieben, skalieren und löschen. Bestehende einzelne Wasserzellen sichtbar und über ein einfaches Zellwerkzeug bearbeitbar halten. |
| Felswände | Rechteckige `rockWalls` anlegen, verschieben, skalieren, duplizieren und löschen. |
| Tutorial-Felsflächen | Haupt-Tutorial und vorhandene Tutorial-Schritte auswählen, ihre gekoppelten Anker verschieben. |
| Start/Checkpoints | Bestehende Positionen und vorhandene räumliche Ausdehnungen bearbeiten. |
| Basen/Missionspositionen | Bestehende räumliche Anker und Zielzonen bearbeiten; deren Missionsfunktion erhalten. |
| Spawngebiete | Rechteckige Gebiete einer Encounter-Gruppe zuordnen und auf der Karte bearbeiten. |

Das räumliche Verschieben eines Checkpoints ist kein Auftrag, eine neue Missionskette zu erzeugen. Missionsart, Ereignisse, Belohnungen und nicht freigegebene Verhaltensparameter bleiben erhalten und schreibgeschützt. Abgeleitete Elemente, etwa ein aus einem Checkpoint bestimmter Vorschauanker, werden über ihre tatsächliche Quelle bearbeitet, nicht als zweites unabhängiges Objekt.

Felsdichte muss zum Generierungsmodus passend dargestellt werden: Ein geschlossenes `solid`-Felsfeld verwendet nicht dieselbe Dichtesteuerung wie organisches Gelände. Die bestehenden Parameter und ihre Wirkung sind bereits dokumentiert. [R1, R2]

### 5.2 Tutorial-Felsflächen

Tutorial-Flächen sind keine gewöhnlichen frei gezeichneten Felswände. Der vorhandene Code leitet die Grundfläche aus der Größe des Tutorial-Fensters, dessen Anker und der Steuerungsvariante ab; zusätzliche Tutorial-Schritte besitzen eigene Anker. [R4]

Die Vorschau zeigt Hinweisrechteck, abgeleiteten Felsbereich und den zugehörigen Randbereich unterscheidbar. Beim Ziehen wird der richtige `tutorialAnchor` beziehungsweise `tutorialSteps[].anchor` geändert. Hinweis und Untergrund bewegen sich gemeinsam. Ein Checkpoint bleibt der Auslöser des Tutorial-Schritts; ihn zu verschieben bedeutet nicht automatisch, auch den separat konfigurierten Tutorial-Anker zu bewegen.

**Kein freies Skalieren dieser Tutorial-Flächen in V1.** Ihre Größe bleibt an die tatsächlichen Hinweismaße gekoppelt. Für unabhängig gestaltete Hindernisflächen dient das normale Felswandwerkzeug. Fehlende explizite Anker werden mit ihrem wirksamen Standard angezeigt und erst durch eine Änderung explizit gespeichert.

Die Runtime-Verbraucher müssen diese Positionierung ebenfalls respektieren. Insbesondere sind bestehende Tutorial-Abwurfmuster in die Integrationsprüfung einzubeziehen; nur die Editorvorschau an einen neuen Ort zu verschieben wäre nicht ausreichend. [R8]

## 6. Vorschau und Zufall

Die schematische Vorschau verwendet das **echte Ergebnis des vorhandenen Generators**, nicht einen vereinfachten Nachbau. Felsen, Wasser, Bäume, Gleise, Strukturen und relevante Missionsflächen werden als einfache Formen dargestellt. Darüber liegen die bearbeitbaren Vorgaben: Korridorlinien, Anker, Flächen und Marker. [R5]

Die Erzeugung folgt diesem Datenfluss:

`Unveränderter Rohentwurf → validierte/normalisierte Kopie → explizite Weltmetriken und vollständige relevante Map-Eingaben → vorhandener Generator → Vorschau`

Eine reine World-Projektion reicht nicht für jeden Fall: Tutorial-Flächen, Missionsbarrieren und andere missionsabhängige Reservierungen müssen wie im Spiel berücksichtigt werden. Der vorhandene World-/Activity-Split ist zu respektieren, ohne diese zusätzlichen Eingaben bei der Vorschau versehentlich abzuschneiden. [R5, R6]

Der Vorschau-Seed ist ein Editorzustand und wird nicht in die Map-Datei geschrieben. „Aktualisieren“ verwendet denselben Seed; „Neue Variante“ setzt einen neuen. Der Seed bleibt beim Bearbeiten konstant. Der Generator darf weiterhin seine vorhandenen Wiederholungsversuche verwenden. Gleicher Seed bedeutet keine Garantie, dass nach einer Konfigurationsänderung alle anderen Teilbereiche unverändert bleiben.

Für V1 wird die vollständige Neugenerierung ausdrücklich ausgelöst. Bearbeitete Vorgaben reagieren sofort; solange das generierte Ergebnis noch zum alten Stand gehört, steht gut sichtbar **„Vorschau veraltet“**. Das vermeidet eine aufwendige Generierung bei jedem Mausereignis. Eine automatische Aktualisierung ist nicht erforderlich.

Ein kleiner zusätzlicher Aufruf „5 Varianten prüfen“ erzeugt nacheinander eine begrenzte Seed-Stichprobe und meldet auffällige Ergebnisse. Er läuft nicht automatisch bei jeder Eingabe oder jedem Speichern und ist kein Ersatz für einen Spieltest.

Die Bedienung soll auch während der Vorschauerzeugung nutzbar bleiben. Überholte Ergebnisse dürfen einen neueren Dokumentstand nicht überschreiben.

Reine Mengenänderungen ohne geometrische Auswirkung benötigen keine neue Vorschau. Änderungen an Spawngebieten oder anderen vom Generator gelesenen Missionsdaten dagegen schon. Diese Abhängigkeit wird aus den tatsächlichen Generatoreingaben abgeleitet, nicht pauschal aus der gerade geöffneten Registerkarte.

## 7. Direkte lokale Speicherung

Der Editor hält die ursprünglichen Authoring-Daten vollständig im Speicher und ändert gezielt die bearbeiteten Felder. Auswertung und Vorschau verwenden daraus abgeleitete Kopien. **Normalisierte Runtime-Daten sind niemals die Quelle für das Zurückspeichern.** Das ist unter anderem für `waterAreas` wichtig, die bei der Normalisierung zu Wasserzellen werden. [R2, R6]

Nicht unterstützte Felder und unveränderte Gruppen bleiben semantisch erhalten. Die Reihenfolge bestehender Daten wird nicht ohne fachlichen Anlass verändert. Ohne Dokumentänderung gibt es keinen Schreibvorgang. Beim tatsächlichen Speichern bleibt die Ausgabe möglichst nah an der vorhandenen JSON-Formatierung.

Das Werkzeug liest und speichert ausschließlich die vorgesehenen lokalen Projektdateien bestehender Maps. Eine allgemeine Dateiverwaltung, Shell-Zugriff oder eine offene Netzwerkfreigabe sind nicht vorgesehen.

Vor dem Speichern wird geprüft, ob sich die Datei zwischenzeitlich außerhalb des Editors geändert hat, etwa durch Codex. Bei einem Konflikt bleiben Datei und Entwurf erhalten; es erfolgt kein automatisches Überschreiben. Die Oberfläche bietet erneutes Laden nach ausdrücklicher Entscheidung und einen Weg, den eigenen Entwurf zur Konfliktklärung zu sichern.

Vor einem erfolgreichen Speichern laufen fachliche Prüfungen. Die Datei wird erst vollständig vorbereitet und dann ersetzt. Fehlgeschlagene Schreibvorgänge dürfen die Originaldatei nicht als leere oder teilweise geschriebene Datei hinterlassen. Automatische Git-Commits oder Pushes gibt es nicht.

Ungespeicherte Änderungen bleiben bei Ansichtswechseln erhalten. Map-Wechsel und Neuladen warnen davor, sie zu verlieren. Änderungen an Quelldateien dürfen über Entwicklungs-Hot-Reload nicht unbemerkt den aktiven Entwurf ersetzen.

## 8. Aufwand und Grenzen

Das Vorhaben ist ein **mittelgroßes internes Werkzeugprojekt**, kein kleiner zusätzlicher Einstellungsdialog. Die schematische Darstellung und das Wiederverwenden bestehender Datenverträge begrenzen den Umfang. Der Hauptaufwand liegt in verlustfreier Bearbeitung, räumlichen Werkzeugen, korrekter Referenzbehandlung und der Vorschauanbindung.

Ein vollständiger Umbau der Runtime ist kein geplantes Ziel. Technische Integrationsfragen werden im späteren Implementierungsplan behandelt.

Spielgrafik als Vorschau, direkter Spieltest, Belohnungs-, Missionsart- und Ereignisbearbeitung, unabhängige Einzelobjekte sowie lokale Neugenerierung sind nicht Bestandteil von V1.

**V1 ist erfolgreich, wenn eine bestehende Map räumlich und hinsichtlich ihrer Encounter sinnvoll geändert, mit mehreren Zufallsvarianten überprüft und sicher in ihrer vorhandenen Projektdatei gespeichert werden kann – ohne manuelle JSON-Nacharbeit am unterstützten Umfang.**

## 9. Quellen und dokumentierte Integrationspunkte

Die nachfolgenden Quellen und Befunde wurden aus der vorherigen Konzeptfassung übernommen. Für diese redaktionelle Überarbeitung wurden sie nicht erneut geprüft. Die Kennungen verweisen auf damals dokumentierte Datenverträge und Integrationspunkte, nicht auf bereits implementierte Editorfunktionen. Es wurden bei dieser Überarbeitung keine Tests ausgeführt und keine Repository-Dateien verändert.

| Referenz | Quelle / relevanter Befund |
|---|---|
| R1 | `src/config/coopDefenseMaps.ts`: Encounter- und Gruppenverträge, Startbedingungen, Korridore und Felswände. Insbesondere `CoopDefenseMapEncounterConfig`, `CoopDefenseMapEncounterGroupConfig`, `CoopDefenseMapRockFieldConfig`. |
| R2 | `src/config/coopDefenseMaps.ts`: `CoopDefenseMapBossConfig`, `CoopDefenseMapAuthoringConfig`, `waterAreas`, Tutorial-Anker, Startbereich und räumliche Missionskonfiguration. |
| R3 | `src/debug/coopDefenseBalance/analyzer.ts`: vorhandene endliche/persistente XP-Auswertung, separater Boss und `dynamic ||= addEncounterTotals(...)` in `buildCoopDefenseBalanceMapSnapshot`. |
| R4 | `src/config/coopDefenseTutorial.ts` sowie `src/arena/ArenaGenerator.ts`: Ableitung der Tutorial-Felsregion aus Anker/Fenstermaßen und Einbindung zusätzlicher Step-Anker. |
| R5 | `src/arena/ArenaGenerator.ts`: `ArenaGenerationInput`, `ArenaGenerationMapConfig`, `ArenaGenerator.generate`, Generatorversion/Fingerprint und Wiederholungsversuche mit `seed + attempt`. |
| R6 | `src/config/authoring/coopDefenseAuthoringAdapter.ts`: bestehender World-/Activity-Split, Projektion normalisierter Daten und bewusst unterschiedliche World-/Missions-Generatoreingaben. |
| R7 | `package.json`: in der vorherigen Konzeptfassung dokumentierte TypeScript-/Vite-Werkzeuge; dort noch kein Map-Editor-Startskript. |
| R8 | `src/systems/CoopDefenseAirstrikeEventHandler.ts`: bestehender Tutorial-Sweep und dessen Abhängigkeiten als mitzuprüfender Verbraucher der Tutorial-Position. |
| R9 | `src/config/coopDefenseEnemies.ts`: zentrale Gegnerdaten und feste Death-Spawn-Konfigurationen. |
