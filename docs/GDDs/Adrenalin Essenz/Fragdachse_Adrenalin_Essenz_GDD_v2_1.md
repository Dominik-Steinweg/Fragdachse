# Fragdachse – Adrenalin-Essenz GDD

**Status:** Fachliches Zielkonzept nach gemeinsamem Designreview; Entscheidungen abgeschlossen, siehe § 22.1. Umsetzung erfolgt erst in einem gesonderten Folgeauftrag.

**Dokumentversion:** 2.2 – Dokumentreview vom 07.09.2026; Dateiname für bestehende Referenzen beibehalten

**Arbeitsbegriff:** „Adrenalin-Orbs“; visuelle Zielidentität: leuchtende Adrenalin-Essenz/Tropfen

**Repository-Abgleich:** Ursprüngliche Analyse bei `0670b9a95c6576e3340dc802bda3d71cd711b186`; gezielter Dokumentreview am 07.09.2026 bei lokalem HEAD `505e5af0404e82e7bec2c499aca7344611fcc07a` plus vorhandenem, nicht sauberem Arbeitsbaum. Resource-Port, AcceptedHit, direkte Reward-Pfade, Geometrie und Lifecycle-Anker stichprobenartig geprüft; keine vollständige technische oder manuelle Abnahme.

**Combat-Stand:** Combat-Refactoring P0–P13 und technische Endabnahme `F` abgeschlossen; Coop-Startup-Bugfix integriert; erneute manuelle Gameplay-/Sichtabnahme `M` laut Migrationsstatus noch offen

**Geltungsbereich:** Primärwaffen-Trefferbelohnung, sammelbare Adrenalin-Essenz, Zugriffsgruppen, Magnettransfer, HUD-Feedback, Multiplayer, Performance und repository-konforme Verantwortungsgrenzen

**Nicht Bestandteil:** finales Waffenbalancing, neue Fernsammel-Upgrades, Audio-Polish, echte Flüssigkeitssimulation oder die Umwandlung sämtlicher Adrenalinquellen

---

## 0. Geltung und Dokumentrang

Dieses Dokument definiert die **verbindliche Spielerfahrung und fachliche Semantik** der Adrenalin-Essenz. Es ist kein Implementierungsplan und schreibt keine konkrete Klassenzahl oder Dateistruktur vor.

Für die spätere Umsetzung gelten zusätzlich die aktuellen Architekturverträge aus:

- `docs/GDDs/Combat Runtime Refactor/01_Combat_Runtime_Architecture_Core.md`
- `docs/GDDs/Combat Runtime Refactor/02_Combat_Runtime_Architecture_Details.md`
- `docs/GDDs/Gameplay Runtime Refactor/01_Gameplay_Runtime_Architecture_Core.md`
- `docs/GDDs/Gameplay Runtime Refactor/02_Gameplay_Runtime_Architecture_Details.md`
- `docs/GDDs/Projectile Runtime Refactor/01_Projectile_Runtime_Architecture_Core.md`
- `docs/GDDs/Projectile Runtime Refactor/02_Projectile_Runtime_Architecture_Details.md`

Bei einem Konflikt gilt:

1. Dieses GDD entscheidet die Spieler- und Balance-Semantik der Essenz.
2. Die Architekturgrundlagen entscheiden Ownership, Abhängigkeitsrichtung, Authority und Lifecycle.
3. Der Implementierungsplan entscheidet konkrete Verträge, Phasen und Dateischnitte, ohne die fachlichen Regeln dieses GDD still zu verändern.

Die hier genannten Repository-Klassen und -Dateien sind **aktuelle Integrationsanker**, keine Verpflichtung, die neue Mechanik in genau diesen Klassen zu implementieren.

Maßgeblich für technische Ist-Aussagen sind aktueller Code, öffentliche Types und passende Tests. Das [Architektur-Leitbild](../../ai/architecture-principles.md) und die aktuellen Verträge im [AI-Router](../../ai/index.md) ergänzen die Runtime-Dokumente; historische Migrationsstände ersetzen keinen aktuellen Nachweis.

Vor dem tatsächlichen Implementierungsstart ist ein gezieltes Delta-Review gegen den dann verwendeten Checkout einschließlich vorhandener Änderungen erforderlich. Der Status der manuellen Combat-Abnahme `M` wird im Preflight dokumentiert; sie ist spätestens vor dem produktiven Reward-Cutover in P2 abzuschließen. Dokumentreview und isolierte P1-Grundlagen benötigen diese Sichtabnahme nicht. Weder das Abschließen der Designfragen noch dieser Plan erteilen einen Implementierungsauftrag.

---

## 1. Vision

Primärwaffentreffer schreiben Adrenalin künftig nicht mehr unmittelbar und unsichtbar in die Ressource des Angreifers. Erfolgreiche, belohnungsberechtigte Treffer materialisieren stattdessen **blau-cyan leuchtende Adrenalin-Essenz** am Trefferort.

Die Essenz spritzt als kleine magische Flüssigkeitstropfen aus dem Ziel, landet in dessen Umgebung, kann mit naher Essenz zusammenfließen und wird erst anschließend durch räumliche Nähe magnetisch eingesammelt.

Die gewünschte Belohnungskette lautet:

> **Treffen → Essenz entsteht → Essenz liegt im Gefahrenraum → Spieler entscheidet sich für Nähe und Risiko → Essenz fliegt zum Spieler → Adrenalin wird gutgeschrieben**

Die Änderung verfolgt drei Hauptziele:

1. **Treffer stärker belohnen.** Ein Treffer hinterlässt sichtbaren, begehrenswerten Wert in der Welt.
2. **Gamefeel und Juice steigern.** Ausstoß, Landung, Zusammenfließen, Magnetflug und HUD-Reaktion bilden eine zusammenhängende Feedbackkette.
3. **Interessantere Bewegung erzeugen.** Sicherer Fernkampf bleibt möglich, liefert Adrenalin aber weniger zuverlässig als aktives Spiel im Kampfbereich.

Die verringerte Effizienz großer Distanz ist ein beabsichtigter Teil des Risk/Reward-Systems und kein Fehler, der im ersten Schritt vollständig kompensiert werden muss.

---

## 2. Ziele und Nicht-Ziele

### 2.1 Ziele der ersten vollständigen Implementierung

Die erste vollständige Implementierung soll:

- sämtliche heute unmittelbar primärtrefferbezogenen Adrenalingewinne sichtbar materialisieren;
- die bisherige Bruttomenge zunächst erhalten;
- jeden heute separat belohnten Treffer weiterhin separat werten;
- eine kurze, saftige Ausstoß- und Landungsphase erzeugen;
- Essenz für ungefähr acht Sekunden als räumliche Entscheidung anbieten;
- in Coop und Teammodi nachvollziehbare Teamverteilung ermöglichen;
- im Deathmatch persönliche Essenz eindeutig halten;
- mehrere hundert sichtbare Tropfen performant darstellen;
- ohne Netzwerkobjekt und Physikkörper pro sichtbarem Tropfen auskommen;
- Teilentnahme, parallele Transfers, Abbruch und werttreue Rückgabe unterstützen;
- genaue Diagnosewerte für das spätere Balancing liefern.

### 2.2 Nicht-Ziele der ersten vollständigen Implementierung

Nicht Bestandteil sind:

- finales Rebalancing der Waffenwerte;
- ein pauschaler Ausgleich für verfallene oder nicht eingesammelte Essenz;
- Fernsammler, Vakuumgranaten oder vergleichbare neue Utilities;
- neutrale oder gegnerisch stehlbare Essenz;
- Audio-Feedback;
- echte Tropfenphysik;
- echte Flüssigkeitssimulation oder aufwendiges Mesh-Morphing;
- individuelles dynamisches Licht pro Tropfen;
- die Umwandlung passiver Regeneration, unabhängiger Kill-Belohnungen, Adrenalin durch erlittenen Schaden oder anderer eigenständiger Ressourcenmechaniken.

### 2.3 Spätere Erweiterbarkeit

Die Lösung soll spätere Erweiterungen erlauben, ohne sie in der ersten vollständigen Implementierung vorwegzunehmen:

- größere Sammelradien durch Items oder Upgrades;
- Fernsammler und Sammelfelder;
- veränderte Lebensdauer oder Fluggeschwindigkeit;
- besondere Essenztypen;
- bewusst neutrale oder umkämpfte Varianten;
- Audio-Polish;
- aufwendigere Flüssigkeitsanimationen.

---

## 3. Verbindliche Designentscheidungen

| Thema | Entscheidung |
|---|---|
| Erzeugungsumfang | Alle unmittelbar an Treffer einer Primärwaffenaktivierung gebundenen Adrenalingewinne werden materialisiert. |
| Unabhängige Quellen | Regeneration, Damage-Taken-Reaktionen, unabhängige Kill-/Klassenbelohnungen, Power-ups und Rückerstattungen bleiben direkte Gutschriften. |
| Mehrfachtreffer | Jeder Treffer, der heute separat Adrenalin auszahlt, erzeugt weiterhin seinen vollständigen Wert. |
| Wertmodifikation | Erzeugerseitige Gewinnmodifikatoren werden genau einmal vor der Materialisierung angewandt und eingefroren. |
| Sammlermodifikator | Der Sammler modifiziert den gespeicherten Wert nicht erneut. |
| Volle Erzeuger | Auch bei voller eigener Ressource wird der vollständige theoretische Trefferwert erzeugt. |
| Bruchteile | Gebrochene Werte bleiben exakt; sichtbare Tropfen besitzen keine feste Ein-Punkt-Stückelung. |
| Coop | Alle berechtigten Coop-Spieler dürfen sammeln. |
| Team-Deathmatch | Nur das erzeugende Team darf sammeln. |
| Capture the Beer | Wie Team-Deathmatch: nur das erzeugende Team. |
| Deathmatch | Nur der zugerechnete Erzeuger darf sammeln. |
| Sichtbarkeit | Ein Peer sieht nur Essenz, die sein lokaler Spieler grundsätzlich sammeln darf. |
| Ausstoß | Tropfen fliegen kurz vom Trefferpunkt in dessen Umgebung und sind erst nach Landung sammelbar. |
| Bodenlebensdauer | Ausgangswert acht Sekunden ab Landung. |
| Magnetradius | Ausgangswert ungefähr 160 Weltpixel. |
| Zielpriorität | Nächster berechtigter Spieler; keine Erzeugerpriorität im Coop oder Team. |
| Sichtlinie | Einmalige Prüfung beim Transferstart; danach kein erneuter LoS-Abbruch. |
| Teilentnahme | Nur voraussichtlich aufnehmbarer Wert wird reserviert; Rest bleibt verfügbar. |
| Parallele Transfers | Ein Cluster darf gleichzeitig mehrere Spieler versorgen. |
| Gutschrift | Erst bei sichtbarer, autoritativ bestätigter Ankunft. |
| Abbruch | Tod, Burrow-Wind-up, Untergrund-/Tunnelübergang, World-Verlust oder Disconnect. |
| Rückgabe | Nicht gutgeschriebener Wert kehrt zur ursprünglichen Bodenposition zurück. |
| Ablauf im Flug | Rechtzeitig gestarteter Transfer darf ankommen; nach Ablauf abgebrochener oder nicht aufnehmbarer Rest verfällt. |
| Merge | Kompatible Essenz derselben Zugriffsgruppe darf räumlich-zeitlich zusammenfließen. |
| Visual | Kleine leuchtende Flüssigkeitstropfen, zwei bis drei Größenstufen, adaptive Dichte. |
| HUD | Dezenter Anflugakzent; gebündelter Ankunfts-Burst; kein Audio im Erstumfang. |
| Balancing | Nach der ersten vollständigen Implementierung auf Basis gemessener Sammelquoten. |

---

## 4. Begriffe und fachliches Modell

### 4.1 Primärtreffer-Reward-Intent

Die an einer konkreten Waffenwirkung mitgeführte Aussage, dass ein erfolgreicher Treffer einen bestimmten Adrenalinwert erzeugen soll. Der Intent ist noch kein ausgezahlter Wert und noch keine Essenz.

Er ist notwendig, weil weder `sourceSlot === 'weapon1'` noch eine Schadensart allein ausreichen:

- Ketten- und Folgetreffer können einen anderen Damage-Kind besitzen;
- Reaktionsschaden kann weiterhin dem Primärslot zugerechnet sein, ohne erneut Adrenalin erzeugen zu dürfen;
- dieselbe Primärwaffenaktivierung kann mehrere separat belohnte Trefferzweige besitzen.

### 4.2 Bestätigtes Reward-Faktum

Ein host-autoritatives, unveränderliches Ergebnis nach der kanonischen Target-Mutation. Es bestätigt, dass ein Reward-Intent tatsächlich einen belohnungsberechtigten Treffer erzeugt hat.

Das Faktum muss mindestens eindeutig bestimmen:

- World-, Activity- und Combat-Runtime-Scope;
- eindeutige Outcome- oder Reward-Identität;
- vollständige Combat-Herkunft;
- zugerechneten Spieler;
- Primärwaffenbezug und Trefferzweig;
- kanonische Trefferposition;
- die wertbildenden Reward-Komponenten vor dem allgemeinen Player-Gain-Multiplikator;
- die zur gültigen Attribution gehörende, an Aktivierung beziehungsweise Reflection eingefrorene allgemeine Gain-Basis;
- Zielreferenz;
- Host-Zeit und visuell stabilen Seed beziehungsweise eine daraus ableitbare stabile Identität.

Das bestätigte Faktum ist bewusst noch **keine Ressourcengutschrift**. Die nachgelagerte Reward-Projektion bildet aus Komponenten und eingefrorener Gain-Basis den exakten materialisierten Wert. Die Basis stammt aus dem Player-Resource-/Modifier-Bereich; Combat transportiert sie, besitzt aber weder den `ResourceSystem`-Owner noch dupliziert es dessen Regeln.

Die konkrete Vertragsbezeichnung wird im Implementierungsplan entschieden.

### 4.3 Reward-Beitrag

Ein exakter positiver Wertanteil, der aus genau einem heute belohnten Treffer hervorgeht. Er besitzt insbesondere:

- materialisierten Wert;
- Zugriffsgruppe;
- Ursprungs- und Bodenposition;
- Landungszeit;
- ursprüngliche Ablaufzeit;
- Herkunft für Diagnose und Balancing;
- `worldRevision`, `activityRevision` und relevante Runtime-/Life-Gültigkeit.

Ein Reward-Beitrag ist ein fachliches Konzept. Die Runtime darf kompatible Beiträge in kompakten Buckets verwalten, solange Wert, Ablauf, Attribution und Diagnose korrekt bleiben.

### 4.4 Essenz-Cluster

Eine logisch und visuell zusammengeführte Menge kompatibler Reward-Beiträge an nahezu derselben Position. Ein Cluster kann verschiedene Erzeuger, Trefferzweige und Ablaufzeitpunkte enthalten, sofern die Zugriffsgruppe identisch ist.

### 4.5 Visueller Tropfen

Ein rein dargestelltes Element. Ein visueller Tropfen:

- besitzt keine eigene Netzwerkidentität;
- besitzt keinen eigenen Physikkörper;
- muss keinem einzelnen Reward-Beitrag entsprechen;
- darf abhängig von Dichte und Wert mehr oder weniger als einen Adrenalinpunkt repräsentieren.

### 4.6 Transfer

Ein vom Host bestätigter, noch nicht abgeschlossener Magnetflug eines reservierten Teilwerts von einer Ursprungsposition zu genau einem Spieler.

### 4.7 Reward-Attribution und Zugriffsgruppe

Der **zugerechnete Erzeuger** ist der Spieler aus der fachlichen Combat-Attribution. Er darf nicht aus einer generischen `ownerId`, der Projektilfarbe oder allein aus Allegiance rekonstruiert werden.

Die **Zugriffsgruppe** wird bei der Materialisierung aus Spielmodus, Attribution und Team-/Relationship-Policy bestimmt und danach eingefroren:

- Coop-Gruppe;
- konkretes Team;
- konkrete Spieler-ID im Deathmatch.

Attribution und Zugriffsgruppe sind unterschiedliche Konzepte: Attribution beantwortet, wem der Treffer zugerechnet wird; die Zugriffsgruppe beantwortet, wer die entstandene Essenz einsammeln darf.

---

## 5. Erzeugung und Wertauflösung

### 5.1 Materialisierte Quellen

Materialisiert werden alle positiven Adrenalingewinne, die heute unmittelbar einem erfolgreichen Treffer einer Primärwaffenaktivierung zugerechnet werden, insbesondere:

- der normale konfigurierte `adrenalinGain` der Primärwaffe;
- primärtrefferbezogene Waffen- und Buildmodifikatoren;
- zusätzliche Trefferwerte wie `hitAdrenaline`;
- separat belohnte Projektile einer Salve;
- Split- und Kindprojektile, sofern sie die Reward-Herkunft behalten;
- Ketten- und Folgeziele, deren Treffer heute erneut Adrenalin vergeben;
- mehrere Treffer auf dasselbe Ziel, sofern die bestehende Auszahlungssemantik jeden davon belohnt;
- direkte Treffer durch Projectile, Hitscan und Melee.

### 5.2 Nicht materialisierte Quellen

Direkt bleiben insbesondere:

- passive Adrenalinregeneration;
- Adrenalin durch erlittenen Schaden;
- unabhängige Kill-Belohnungen;
- teamweite oder klassenspezifische Gewinne, die nicht der konkreten Primärwaffenwirkung entspringen;
- Power-up-Wirkungen;
- Refunds bereits bezahlter Kosten;
- Mini-Rocket-Rückerstattungen und vergleichbare Kostenrückgaben;
- Utility-, Sekundärwaffen- und Ultimate-Effekte ohne ausdrücklichen Primärtreffer-Reward-Intent.

### 5.3 Kanonische Auslösebedingung

Essenz entsteht ausschließlich nach einem bestätigten, host-autoritativen Outcome.

Für schadenstragende Ziele gilt als Standard:

- Das Outcome ist tatsächlich angewandt.
- Der kanonische State-Owner bestätigt einen positiven Effekt, normalerweise `actualDamage > 0`.
- Ein abgelehnter oder vollständig wirkungsloser Treffer erzeugt keinen Wert.
- Geblockte, immune, stale oder ungültige Interaktionen erzeugen keinen Wert.

Die Belohnung bleibt **trefferbasiert**, nicht schadensproportional: Ein gültiger Treffer erhält seinen vollständigen konfigurierten Reward, auch wenn wegen geringer Rest-HP nur ein kleinerer tatsächlicher Schaden angewandt wurde. Eine spätere Schadensskalierung des Rewards wäre eigenes Balancing.

Rüstungsverlust zählt zum tatsächlichen Schaden; reiner Kontakt, vollständig abgefangener Schaden oder ausschließlich ausgelöstes Trefferfeedback genügen nicht. Diese Regel korrigiert bewusst alte Auszahlungsstellen, die das Mutationsergebnis nicht durchgängig prüfen. Die Zusage zum Erhalt bisheriger Trefferwerte gilt für weiterhin berechtigte wirksame Treffer, nicht für diese wirkungslosen Legacy-Fälle.

### 5.4 Zielinventar des Cutovers

Der Implementierungsplan muss alle heutigen Auszahlungsstellen inventarisieren und exakt klassifizieren. Der erste Cutover darf die Zielmenge nicht versehentlich erweitern.

Insbesondere sind zu prüfen:

- Projectile-Treffer auf Spieler, Gegner und Decoys;
- Hitscan-Treffer auf Spieler, Gegner und Decoys;
- Melee-Treffer auf Spieler, Gegner und Decoys;
- Ketten- und Folgeziele;
- zusätzliche Melee-Trefferboni;
- Split-/Kindprojektilpfade.

Felsen, Basen, Zug, Konstruktionen und andere World-Objekte erzeugen nur dann Essenz, wenn der aktuelle fachliche Pfad dort bereits eine primärtrefferbezogene Adrenalinbelohnung vergibt. Dieses GDD führt dafür keine neue Belohnung ein.

### 5.5 Herkunft und Reflection

Die Reward-Herkunft muss die mehrdimensionale Combat-/Projectile-Provenance erhalten:

- Gameplay-Quelle;
- Actor;
- Attribution;
- Allegiance;
- authored Source-ID;
- Source-Slot;
- Lineage;
- Correlation.

Für die Essenz gilt:

- Nur eine Player-Attribution darf persönlichen oder teamgebundenen Adrenalinwert erzeugen.
- Der zugerechnete Erzeuger stammt aus `CombatSource.attribution` beziehungsweise der verlustfrei adaptierten Projectile-Attribution.
- Reflection oder Deflection darf Attribution und Allegiance fachlich verändern; die Essenz folgt der nach der Übernahme gültigen Attribution.
- `allegiance.ownerId` ist kein zulässiger Ersatz für die Reward-Attribution.

### 5.6 Mehrfachtreffer und Deduplizierung

Die bestehende Auszahlungssemantik bleibt erhalten:

- Ein Reward-Faktum pro heute separat ausgezahltem Treffer.
- Keine globale Begrenzung auf einen Reward pro Schuss, Ziel oder Aktivierung.
- Correlation und Lineage dienen Diagnose, Gruppierung und visueller Kohärenz, nicht der stillen Unterdrückung gültiger Rewards.
- Eine eindeutige Outcome-/Reward-ID verhindert ausschließlich echte Doppelverarbeitung desselben Faktums.

### 5.7 Wertmodifikation

Der materialisierte Wert wird erzeugerseitig genau einmal aufgelöst.

Dabei gelten folgende Regeln:

1. Waffen- und Buildmodifikatoren, die bereits den authored Trefferwert verändern, bleiben an ihrem heutigen kanonischen Auflösungspunkt.
2. Das bestätigte Reward-Faktum trägt diese wertbildenden Komponenten verlustfrei aus dem Trefferpfad heraus.
3. Der allgemeine Adrenalin-Gewinnmultiplikator wird über eine schmale Player-Resource-/Modifier-Capability bei Auslösung der Waffenaktivierung eingefroren. Bei fachlicher Übernahme durch Reflection/Deflection wird diese Basis durch die des neuen zugerechneten Erzeugers zum Übernahmezeitpunkt ersetzt. Die Reward-Projektion wendet ausschließlich die gültige eingefrorene Basis genau einmal auf die unskalierten Reward-Komponenten an; Multiplikatoren früherer Erzeuger werden nicht aufmultipliziert.
4. Der resultierende exakte Wert wird im Reward-Beitrag eingefroren.
5. Der aktuelle Füllstand oder das aktuelle Maximum des Erzeugers begrenzen die Erzeugung nicht.
6. Der Sammler wendet keinen eigenen Gewinnmultiplikator an.
7. Änderungen an Build, Team oder Gain-Multiplikator während Boden- oder Flugphase verändern bestehende Beiträge nicht.

Wenn mehrere Reward-Komponenten am selben Treffer entstehen, dürfen sie zusammengefasst werden, sofern jede Komponente exakt so aufgelöst wird wie im bisherigen Verhalten.

Salven, Ketten und Kindprojektile übernehmen die Gain-Basis ihrer Aktivierung, solange keine fachliche Übernahme erfolgt. Ein Buff, der zwischen Auslösung und Treffer endet oder beginnt, verändert diese Basis nicht. Dies ist eine bewusste Änderung gegenüber einem Gain-Lookup erst bei der bisherigen Direktgutschrift. Waffen-/Buildkomponenten behalten dagegen ihre bisherigen kanonischen Auflösungspunkte; die Festlegung betrifft den allgemeinen Player-Gain-Multiplikator. Fehlende Herkunft oder Gain-Basis wird nie aus einem Respawn-Build oder pauschal mit Faktor 1 ersetzt.

### 5.8 Exakte Werte und Präzision

Gebrochene Werte bleiben erhalten, beispielsweise `0,5`, `1,5` oder `3,25`.

Anforderungen:

- keine Rundung auf ganze Punkte;
- keine unsichtbare Restakkumulation bis zum nächsten Treffer;
- keine negative oder nicht endliche Essenz;
- dieselbe deterministische Präzisions-/Quantisierungsregel auf Host, Snapshot und Ressourcengrenze;
- visuelle Mindestgröße unabhängig von kleinen Bruchteilen.

Ein sichtbarer Tropfen darf beispielsweise 1,5 Adrenalin tragen und nur geringfügig größer wirken als ein Ein-Punkt-Tropfen. Der exakte Wert muss nicht optisch abzählbar sein.

### 5.9 Erzeugung bei voller Ressource

Auch ein Spieler mit voller Adrenalinressource erzeugt den vollständigen theoretischen Wert:

- im Coop für das Team;
- in Teammodi für das eigene Team;
- im Deathmatch als kurzlebigen persönlichen Vorrat.

Diese bewusste Balanceänderung wird gemessen, aber nicht vorab kompensiert.

### 5.10 Ressourcengutschrift bei Ankunft

Die Ankunft verwendet den kanonischen Player-Resource-Owner, aber mit einer **bereits aufgelösten exakten Gutschrift**:

- kein erneuter Gain-Multiplikator;
- atomare Cap-Prüfung gegen das aktuelle Maximum;
- atomare Rückgabe des tatsächlich gutgeschriebenen Werts an die Essenz-Runtime;
- korrekte Resource-Revision;
- korrekte Gain-Observer mit tatsächlich gutgeschriebenem Wert;
- keine Regen-Pause;
- keine lokale Direktmutation;
- kein semantischer Missbrauch eines Refund-Pfads.

Der Transfer darf die freie Kapazität nicht separat lesen und anschließend blind schreiben. Der Resource-Commit selbst bestimmt atomar den gutgeschriebenen Wert; nur dessen Differenz zum reservierten Wert kann anschließend zurückgegeben oder verworfen werden.

Die Erzeugung eines Reward-Beitrags löst noch keinen normalen Adrenalin-Gain-Observer aus. Erst die bestätigte Ankunft zählt als tatsächlich gewonnene Ressource.

---

## 6. Zugriffs-, Sichtbarkeits- und Persistenzregeln

### 6.1 Zugriffsgruppen nach Modus

| Modus | Berechtigte Sammler | Merge-Kompatibilität |
|---|---|---|
| Coop-Defense | alle interaktiven Coop-Spieler | alle Coop-Beiträge miteinander |
| Team-Deathmatch | Spieler des erzeugenden Teams | Beiträge desselben Teams |
| Capture the Beer | Spieler des erzeugenden Teams | Beiträge desselben Teams |
| Deathmatch | ausschließlich der zugerechnete Erzeuger | nur Beiträge desselben Erzeugers |

Innerhalb einer Coop- oder Teamgruppe besitzt der Erzeuger keine Sonderpriorität. Der nächste berechtigte Spieler gewinnt.

### 6.2 Eingefrorene Zugriffsgruppe

Die Zugriffsgruppe wird bei der Materialisierung festgelegt und während der Lebensdauer nicht nachträglich umgeschrieben. Ein späterer Team-, Profil- oder Buildwechsel verändert bereits liegende Essenz nicht.

Der Vergleich erfolgt mit der aktuellen Berechtigung des Sammlers: Ein Teamwechsel überträgt alte Teamessenz nicht ins neue Team. Verliert ein Sammler dadurch den Zugriff auf einen laufenden Transfer, wird dieser vor dem Commit abgebrochen. Temporär volle Ressource, Tod oder Burrow ändern die grundsätzliche Gruppensichtbarkeit nicht, solange die lokale World-Presentation weiterhin zulässig ist; sie verhindern nur die aktuelle Sammlung.

### 6.3 Sichtbarkeit

Ein lokaler Spieler sieht ausschließlich Essenz, die er grundsätzlich sammeln darf.

Daraus folgt:

- Coop-Spieler sehen die gemeinsame Coop-Essenz.
- Teamspieler sehen nur die Essenz ihres Teams.
- Deathmatch-Spieler sehen nur ihre eigene Essenz.
- Observer, `joining`, `leaving`, `none` und reine Preview-Consumer sehen keine sammelbare Essenz für sich.
- Nicht berechtigte Essenz wird nicht nur abgedunkelt, sondern vollständig ausgeblendet.

Die technische Netzwerkfilterung darf später optimiert werden; das sichtbare Ergebnis ist verbindlich.

### 6.4 Erzeugertod, Respawn und Disconnect

Bereits materialisierte Essenz bleibt einschließlich einer laufenden Ausstoßphase bis zu ihrem normalen Ablauf bestehen, auch wenn der Erzeuger:

- stirbt;
- respawnt;
- sich einbuddelt;
- die World verlässt;
- die Verbindung verliert.

Im Deathmatch kann persönliche Essenz nach einem schnellen Respawn noch eingesammelt werden. Verlässt der einzige Berechtigte die Partie, bleibt der Wert logisch bis zum Ablauf bestehen, wird aber niemand anderem zugänglich.

Noch aktive Waffenwirkungen dürfen nach Erzeugertod weiterhin Essenz erzeugen, sofern Combat ihren Treffer weiterhin als gültig bestätigt. Nach Disconnect gilt dies nur bei vollständig erhaltener kanonischer Herkunft und Wertbasis. Der neue Respawn-Zustand ersetzt niemals fehlende Daten einer alten Wirkung. Eine ungültig gewordene Combat-Wirkung wird dafür nicht wiederbelebt. Die Erzeuger-Life ist Herkunft; die beim Transfer gebundene Sammler-Life ist dagegen eine zwingende Commit-Gültigkeit.

### 6.5 World-, Activity- und Rundenende

Essenz besitzt keinen Meta- oder Save-Lifecycle.

Verbindlich:

- Activity-Detach/-Replacement und echtes Rundenende löschen alle Cluster, Beiträge und Transfers dieser Activity, auch wenn dieselbe World technisch weiterlebt.
- World-Teardown schließt die Activity und räumt deren Essenz dadurch ebenfalls vollständig ab.
- Stale Nachrichten einer älteren `activityRevision`, `worldRevision` oder Runtime-Generation bleiben inert.
- Interne Missionsschrittwechsel innerhalb derselben aktiven Activity löschen Essenz nicht automatisch.
- Lobby, nächste Map oder neue Runde übernehmen keinen Restwert.

---

## 7. Ausstoß, Landung und Bodenphase

### 7.1 Kanonischer Ursprung

Essenz entsteht an der kanonischen Weltposition des bestätigten Treffers. Direkte Treffer, Kettenziele und Kindprojektile besitzen jeweils ihren eigenen tatsächlichen Trefferort.

Die Position darf nicht aus Render-Sprites, Tracern oder lokaler Vorhersage rekonstruiert werden.

### 7.2 Kurzer Treffer-Ausstoß

Unmittelbar nach der Materialisierung eines bestätigten Reward-Beitrags spritzen kleine cyanfarbene Tropfen in einem kompakten Bereich auseinander.

Ausgangswerte:

- Landungszeit ungefähr 150–250 ms;
- Streuradius ungefähr 20–45 Weltpixel;
- geringfügig wertabhängige Dichte und Breite;
- keine proportional unbegrenzt wachsende Fläche.

Während des Ausstoßes ist der Wert noch nicht sammelbar.

### 7.3 Gültige Bodenpunkte

Jeder werttragende Anteil landet auf einem gültigen Punkt innerhalb der aktuellen World-Grenzen.

Zu vermeiden sind insbesondere:

- aktive Felsen und blockierende Placeables;
- Baumstämme beziehungsweise andere bestehende LoS-/Movement-Blocker;
- aktive Basis- und Barriereflächen;
- Positionen außerhalb der Arena;
- dauerhaft nicht erreichbare Zellen.

Die zentrale World-Geometrie ist die Quelle der Wahrheit. Der Landungsresolver darf nicht auf private Daten von `WorldCombatCore` oder auf Darstellungsmaße zugreifen.

Der aktuelle `WorldGeometryQueries`-Vertrag bietet World-Metriken, LoS und `isCircleBlocked`, aber noch keinen fertigen „nächsten sicheren Bodenpunkt“. Der Implementierungsplan muss diese schmale Geometrie-Capability ergänzen oder einen gleichwertigen World-owned Resolver vorsehen.

Bewegliche Sonderkörper:

- Die aktuelle Zugposition darf bei der initialen sicheren Platzierung berücksichtigt werden.
- Ein später vorbeifahrender Zug verschiebt, löscht oder transportiert gelandete Essenz nicht.
- Der Zug ist für den Erstumfang kein dauerhafter Magnet-LoS-Blocker; wall-artige World-Hindernisse bleiben maßgeblich.

Kann im unmittelbaren Streubereich kein gültiger Punkt gefunden werden, wird mit begrenzter deterministischer Suche ein naher gültiger Fallbackpunkt verwendet. Die normalen Rand-/Hindernisfälle müssen damit abgedeckt sein. Bestehende World-Geometrie und Layout-Gültigkeit reichen als Grundlage; hierfür wird kein neues Navigationssystem aufgebaut.

Dass auch die Fallbacksuche keinen gültigen Punkt liefert, gilt als unerwarteter Geometrie-/Platzierungsfehler. Dafür entstehen weder Warteschlange noch wiederholte Suche, Sonderphysik oder automatische Direktgutschrift. Der betroffene Wert wird einmalig als `placementFailedValue` erfasst und verworfen; eine Diagnose nennt Reward, World/Activity und Ursprung. Dies ist die ausdrücklich ausgewiesene Ausnahme zur Werterhaltung im regulären Ablauf, kein zulässiger Lastabbau. Im normalen Abnahmeszenario muss der Fehlerzähler null bleiben.

### 7.4 Determinismus

Host und Clients erhalten dieselben autoritativen Startdaten und einen stabilen Seed beziehungsweise eine stabile Reward-ID. Die clientseitige Ausstoßanimation führt dadurch zu konsistenten Landepositionen, ohne Positionsupdates pro Renderframe.

### 7.5 Bodenlebensdauer

Die Lebensdauer beginnt mit der Landung.

Ausgangswert:

- **8 Sekunden Bodenlebensdauer**

Die letzten ungefähr 1–1,5 Sekunden werden durch schnelleres Flackern, sinkenden Glow oder Verdunsten angekündigt.

### 7.6 Kein künstliches Verlängern

Die ursprüngliche Ablaufzeit eines Wertanteils wird durch keinen der folgenden Vorgänge erneuert:

- Merge;
- Aufteilen;
- Reservierung;
- Abbruch;
- Rückgabe;
- erneute Beanspruchung;
- visuelles Neuaufbauen;
- Full-Resync.

---

## 8. Cluster und Zusammenfließen

### 8.1 Zweck

Jeder Treffer darf zunächst sichtbar Tropfen ausstoßen. Dauerhaft sollen jedoch nicht hunderte unabhängige Gameplay-, Netzwerk- und CPU-Objekte entstehen.

Kompatible Essenz darf nach der Landung logisch und visuell zusammenfließen.

### 8.2 Kompatibilität

Merge ist nur erlaubt, wenn die Zugriffsgruppe identisch ist:

- Coop mit Coop;
- Team mit demselben Team;
- Deathmatch mit demselben persönlichen Erzeuger.

Der ursprüngliche Erzeuger, die Waffe, der Trefferzweig und Ablaufzeitpunkte bleiben für Diagnose und Balancing intern rekonstruierbar oder aggregiert erhalten.

### 8.3 Ausgangswerte

- Merge-Fenster: ungefähr 100–200 ms;
- Merge-Radius: ungefähr 24–40 Weltpixel.

Diese Werte sind Tuningparameter.

Das Merge-Zeitfenster beginnt mit der Landung des ersten Beitrags am festen Clusteranker; weitere Beiträge erneuern es nicht. Später eintreffende Essenz bildet nach Ende dieses Fensters einen eigenen Cluster, auch wenn dessen Darstellung nahe benachbart liegt.

Der Merge-Radius wird gegen eine feste, gültige Clusterposition geprüft. Zwischen einfließender Bodenposition und Clusterposition muss eine freie Verbindung gemäß der World-Geometrie bestehen. Der Cluster wandert nicht durch wiederholtes Merge weiter; jeder neue Beitrag muss selbst im erlaubten Einzugsbereich liegen. Eine Kette benachbarter Beiträge darf weder Wände überwinden noch Essenz über beliebige Distanzen verschieben. Eine Bewegung innerhalb dieses begrenzten Bereichs ist beabsichtigt und kann die Sammeldistanz entsprechend geringfügig ändern.

### 8.4 Exakte Wert- und Zeitsemantik

Merge verändert nicht:

- Gesamtwert;
- ursprüngliche Ablaufzeiten;
- Zugriffsgruppe;
- Attribution der Diagnosebeiträge;
- bereits laufende Reservierungen.

Ältere Teilwerte können aus einem Cluster verfallen, während jüngere bestehen bleiben. Die visuelle Perle schrumpft entsprechend.

### 8.5 Flüssigkeitswirkung

Das Zusammenführen soll wirken wie magische Flüssigkeit:

- kleine Tropfen ziehen sich leicht zusammen;
- kleine Tropfen schrumpfen;
- eine gemeinsame Perle wächst;
- wenige Satelliten dürfen verbleiben;
- die Perle darf sanft pulsieren oder minimal wabern;
- kein hart sichtbares Löschen und Ersetzen.

Für die erste vollständige Implementierung genügen technisch effiziente Mittel wie Skalierung, Bewegung und Überblendung; das sichtbare Ergebnis muss dennoch weich, kohärent und bewusst gestaltet wirken. Echte Flüssigkeit ist nicht erforderlich.

### 8.6 Überlastung

Bei logischer oder visueller Überlastung darf stärker aggregiert werden. Die Runtime darf Beiträge in Zeit-/Expiry-Buckets verdichten und die sichtbare Tropfenanzahl reduzieren.

Unzulässig sind:

- stilles Löschen von Wert;
- Vereinheitlichen der Lebensdauer auf einen jüngeren Zeitpunkt;
- Zusammenführen verschiedener Zugriffsgruppen;
- visuelle Kapazitätsdrops mit Gameplaywirkung.

---

## 9. Magnetische Zielwahl

### 9.1 Ausgangsradius

- Zielbereich: ungefähr 150–180 Weltpixel;
- Ausgangswert: ungefähr **160 Weltpixel**.

Der Radius liegt deutlich unter typischen Fernkampfentfernungen, erfordert aber kein pixelgenaues Überlaufen jedes Tropfens.

### 9.2 Berechtigter Kandidat

Ein Spieler darf Magnetziel sein, wenn er:

- zur Zugriffsgruppe gehört;
- `interactive` an der aktuellen World teilnimmt;
- eine aktive Spielfigur besitzt;
- lebt;
- nicht im Burrow-Wind-up ist;
- nicht unterirdisch, gefangen oder im Tunneltransit ist;
- mindestens etwas freie Adrenalinkapazität besitzt;
- nach Abzug bereits eingehend reservierter Werte voraussichtlich noch Kapazität besitzt;
- innerhalb des Magnetradius liegt;
- beim Start freie Sichtlinie zum Cluster besitzt.

Normale Bewegung, Dash, Knockback und oberirdische Recovery schließen die Zielwahl nicht aus.

### 9.3 Priorität

Der nächste berechtigte Spieler gewinnt. Im Coop und in Teammodi existiert keine Erzeugerpriorität.

Bei Gleichstand muss die Wahl stabil bleiben, beispielsweise über Distanz, Spieler-ID und Cluster-/Transfer-ID. Die Auswahl darf nicht zwischen Kandidaten oszillieren.

### 9.4 Einmalige Sichtlinie

Die LoS wird genau einmal vor der Reservierung geprüft.

Blockieren sollen die wall-artigen Hindernisse der zentralen World-Geometrie, insbesondere Felsen, Baumstämme, aktive Basen, Barrieren und vergleichbare statische Blocker.

Nach gültigem Start brechen folgende Ereignisse den Transfer nicht ab:

- spätere fehlende Sichtlinie;
- Verlassen des Magnetradius;
- normale Bewegung;
- Dash;
- Knockback;
- erlittener Schaden.

### 9.5 Host-getriebene Automatik

Die Zielwahl ist host-autoritativ und automatisch. Es gibt keinen Client-Pickup-Request pro Cluster oder Tropfen. Clients senden keine „ich bin nah genug“-Entscheidung und dürfen keine Reservierung selbst starten.

---

## 10. Transfer, Ankunft und Abbruch

### 10.1 Reservierung

Beim Transferstart wird ein Teilwert atomar aus dem frei verfügbaren Clusterbestand reserviert.

Der reservierte Wert ist:

- für andere Spieler vorübergehend nicht verfügbar;
- noch nicht als Adrenalin gutgeschrieben;
- weiterhin an Ursprungsbeiträge und Ablaufzeiten gebunden;
- mit einer für `(worldRevision, activityRevision)` eindeutigen Transfer-ID versehen;
- an die aktuelle Player-Life-/Participation-Identität des Zielspielers gebunden.

### 10.2 Teilentnahme

Reserviert wird höchstens die voraussichtlich freie Kapazität des Spielers unter Berücksichtigung bereits eingehender Transfers.

Beispiel:

- Cluster: 10;
- aktuelle freie Kapazität: 3;
- bereits eingehend: 1;
- neuer reservierbarer Wert: höchstens 2.

Der Rest bleibt am Boden.

### 10.3 Parallele Transfers

Ein Cluster darf mehrere Spieler gleichzeitig versorgen. Jeder Teiltransfer besitzt eine eigene Identität, Ziel-Life und Wertreservierung.

Parallele Reservierungen müssen atomar sein; dieselbe Wertmenge darf nie zweimal zugesprochen werden.

### 10.4 Flugdauer

Der Magnetflug ist entfernungsabhängig:

- nahe Essenz ungefähr 120 ms;
- Essenz am Rand des Radius bis ungefähr 300 ms;
- sichtbar zunehmende Beschleunigung zum Spieler.

Der Host verwaltet Zustand und Ankunftszeit, nicht eine per Frame simulierte Flugbahn.

### 10.5 Darstellung

Während des Flugs:

- löst sich ein Teil der Flüssigkeitsperle;
- ein oder mehrere visuelle Tropfen repräsentieren denselben Transfer;
- die Form streckt sich leicht;
- ein kurzer cyanfarbener Schweif ist erlaubt;
- die Darstellung folgt lokal der aktuellen Spielerposition;
- es existiert keine Gameplay-Kollision während des Magnetflugs.

### 10.6 Erfolgreiche Ankunft

Erst bei der autoritativ bestätigten Ankunft wird Adrenalin gutgeschrieben.

Synchron dazu:

- springt der Resource-Wert unmittelbar;
- aktualisiert sich der Statusring ohne Smoothing-Verzögerung;
- endet der Anflugakzent;
- startet ein gebündelter cyanfarbener Ankunfts-Burst;
- darf ein kurzer lokaler Weltakzent am Spieler erscheinen.

### 10.7 Erneute Kapazitätsprüfung

Bei Ankunft prüft der Host die aktuell freie Kapazität erneut.

Der tatsächlich gutgeschriebene Wert ist höchstens:

- reservierter Transferwert;
- aktuelle freie Kapazität.

Ein nicht aufnehmbarer Rest kehrt zur Ursprungsposition zurück, sofern dessen Ablaufzeit noch nicht überschritten ist.

### 10.8 Abbruchgründe

Ein Transfer wird abgebrochen, wenn der Zielspieler:

- stirbt oder seine gebundene Life-Identität verliert;
- den Burrow-Wind-up beginnt;
- anderweitig in einen Untergrund-/Tunnelzustand wechselt;
- seine `interactive` World-Participation verliert;
- die Berechtigung für die eingefrorene Zugriffsgruppe verliert;
- die World verlässt;
- disconnectet;
- beim Activity-/Runden-/World-Teardown invalidiert wird.

Der normale Burrow-Abbruch erfolgt bereits beim Beginn des Wind-ups. Ein erzwungener Tunnel- oder Untergrundübergang muss spätestens beim Zustandswechsel ebenfalls abbrechen.

### 10.9 Rückgabe

Beim Abbruch kehrt der noch nicht gutgeschriebene Wert zur ursprünglichen Bodenposition zurück.

Dort:

- vereinigt er sich mit einem kompatiblen Restcluster;
- oder bildet erneut eine kleine Essenzmenge;
- behält er seine ursprüngliche Ablaufzeit;
- bleibt er für alle ursprünglichen Berechtigten verfügbar;
- kann er nicht durch Tod oder Burrow räumlich transportiert werden.

Die Rückflussanimation darf kürzer und zurückhaltender als der normale Magnetflug sein.

### 10.10 Ablauf während des Transfers

Ein vor Ablauf gültig gestarteter Transfer darf noch ankommen.

Wenn die ursprüngliche Ablaufzeit inzwischen überschritten ist:

- erfolgreiche, aufnehmbare Ankunft wird noch gutgeschrieben;
- bei Abbruch entsteht kein neuer Bodenwert;
- ein bei Ankunft nicht aufnehmbarer Rest verfällt sofort;
- die Lebensdauer wird niemals pausiert oder erneuert.

### 10.11 Terminale Reihenfolge

Ankunft und Abbruch sind konkurrierende terminale Übergänge desselben Transfers. Genau einer darf gewinnen.

Verbindlich:

- Ist Tod, Burrow-/Untergrundbeginn, Participation-Verlust oder Teardown vor dem Arrival-Commit autoritativ wirksam geworden, wird abgebrochen.
- Ist der Arrival-Commit bereits abgeschlossen, wird die Gutschrift nicht nachträglich zurückgerollt.
- Ereignisse mit demselben Host-Zeitpunkt werden nach einer stabilen, im Implementierungsplan dokumentierten Reihenfolge verarbeitet.
- Mehrere gleichzeitig fällige Ankünfte werden stabil, beispielsweise nach `arrivalAt` und Transfer-ID, committed; jede spätere Ankunft prüft die dann noch freie Kapazität erneut.

---

## 11. Visuelle Identität

### 11.1 Leitbild

Adrenalin-Essenz wirkt wie:

> **kleine, magisch leuchtende Regentropfen aus flüssiger Energie**

Sie soll nicht primär wirken wie:

- Kristalle;
- Münzen;
- klassische Loot-Orbs;
- Edelsteine;
- flache Pfützen;
- große Power-up-Symbole.

### 11.2 Farbe

Die Essenz nutzt die vorhandene Adrenalin-Farbfamilie:

- gesättigtes Blau;
- helles Cyan;
- fast weißer Energiekern;
- dunkler blauer Rand oder Nachhall.

Sie muss eindeutig mit dem Adrenalinsegment des Spielerstatusrings verwandt sein.

### 11.3 Größe und Wertwahrnehmung

- Standardtropfen: nur wenige Pixel;
- zwei bis drei klar begrenzte Größenstufen;
- größere Perlen bleiben deutlich kleiner als eine Spielfigur;
- kleine Bruchteile erzeugen keine unlesbaren Mikrotropfen;
- größere Werte nutzen Dichte, Größenmix, Satelliten, Helligkeit und Halo;
- der exakte Wert muss nicht aus der Grafik ablesbar sein.

Die ursprüngliche Idee „ein Adrenalinpunkt ≈ ein Tropfen“ bleibt eine Dichteheuristik für normale kleine Werte, kein Datenvertrag.

### 11.4 Leuchten

Bevorzugt sind:

- additive helle Kerne;
- kleiner weicher Glow;
- aggregierter Halo pro Cluster;
- leichte cyanfarbene Umgebungswirkung;
- keine individuelle dynamische Lichtquelle pro Tropfen.

### 11.5 Zustandssprache

**Ausstoß**

- gestreckte schnelle Tropfen;
- kleiner Bogen;
- noch nicht sammelbar.

**Boden**

- kompakte Perlen;
- ruhiger Puls;
- klar sammelbar.

**Merge**

- kleinere Tropfen schrumpfen;
- gemeinsame Perle wächst;
- kurzer Flüssigkeitszug.

**Magnetflug**

- schnelle Beschleunigung;
- Streckung und kurzer Schweif;
- klarer Weg zum Spieler.

**Rückgabe**

- schneller Rückfluss zum Ursprung;
- erneutes Zusammenziehen oder Auflösen.

**Ablauf**

- sinkender Glow;
- Flackern oder Verdunsten;
- weiches Verschwinden.

### 11.6 Visuelle Hierarchie

Priorität:

1. Spieler, Gegner und Gefahren;
2. echte Projektile, Warnungen und Trefferfeedback;
3. sammelbare Essenz;
4. Satelliten, Mikroglanz und dekorative Details.

Bei hoher Dichte werden zuerst reduziert:

- Mikrotropfen;
- Satelliten;
- sekundärer Glow;
- Wabern;
- dekorative Schweife.

Erhalten bleiben:

- Clusterposition;
- grobe Mengenwirkung;
- Sammelbarkeit;
- Transferbewegung;
- Ankunft, Rückgabe und Ablauf.

### 11.7 Gestufte Umsetzung und verbindliche Zielqualität

Die technische Umsetzung darf die Presentation zunächst funktional aufbauen, **die abgeschlossene Erstimplementierung darf jedoch nicht auf Prototyp-Niveau stehen bleiben**.

Spätestens vor der finalen technischen Abnahme erforderlich:

- tropfenförmiger, klar vom Treffer ausgehender Ausstoß;
- kurze, weich lesbare Bogenflugbahn und Landung;
- gesättigte Blau-/Cyan-Familie mit hellem Energiekern und kontrolliertem Glow;
- zwei bis drei bewusst abgestimmte Größenstufen;
- wertabhängige adaptive Dichte ohne übergroße Loot-Orbs;
- ruhige, hochwertige Bodenperlen mit leichtem Puls beziehungsweise minimalem Wabern;
- plausibles Schrumpfen/Wachsen und sichtbares Zusammenziehen beim Merge;
- beschleunigter Magnetflug mit leichter Streckung und kurzem Schweif;
- visuell verständlicher Rückfluss und weiches Expiry;
- kohärentes HUD-Feedback in derselben Farbsprache;
- abgestimmte Quality-/LOD-Stufen, die bei Last zuerst Details und nie die Kernlesbarkeit reduzieren;
- keine offensichtlichen Platzhalterformen, Debug-Sprites, harten Pops oder nur technisch ausreichenden Übergänge.

Die Zieloptik muss in normaler Kampfdichte **und** in repräsentativen Stresssituationen attraktiv und lesbar bleiben. Die visuelle Hierarchie aus § 11.6 bleibt dabei verbindlich.

Optional bleiben auch nach der Erstimplementierung:

- ausgeprägte Oberflächenspannung;
- aufwendige Verbindungsschlieren;
- komplexes Mesh-/Metaball-Morphing;
- echte Flüssigkeitssimulation;
- zusätzliche dekorative Mikrodetails, sofern sie keinen klaren Qualitätsgewinn liefern.

---

## 12. HUD-Feedback

### 12.1 Anflug

Während mindestens ein Transfer zum lokalen Spieler unterwegs ist, schimmert das Adrenalinsegment dezent cyan.

Der Akzent darf mit der Zahl oder groben Gesamtstärke eingehender Transfers skalieren, zeigt aber **keine vorweggenommene feste Füllung** und keinen exakten Incoming-Wert.

### 12.2 Ankunft

Bei bestätigter Ankunft:

- aktualisiert sich die Ressource unmittelbar;
- endet der zugehörige Anflugakzent;
- folgt ein kurzer cyanfarbener Burst;
- erscheinen optional Sparks am Segmentende;
- skaliert die Stärke mit dem tatsächlich gutgeschriebenen Wert.

### 12.3 Bündelung

Mehrere tatsächliche Ankünfte innerhalb von ungefähr 80–150 ms werden visuell zu einem stärkeren, sauberen Burst gebündelt. Die Resource-Commits bleiben dennoch einzeln korrekt.

### 12.4 Explizites Essenzsignal

Der bestehende Statusring reagiert bereits generisch auf größere Adrenalinsteigerungen. Für die Essenz genügt diese indirekte Schwelle nicht, weil kleine oder gebrochene Ankünfte sonst ohne Burst bleiben können.

Die Implementierung benötigt daher ein explizites Presentation-Signal für:

- Incoming gestartet;
- Incoming beendet oder abgebrochen;
- tatsächlich gutgeschriebene Essenz angekommen.

Dieses Signal darf keine Ressource mutieren; es projiziert ausschließlich das autoritative Ergebnis.

### 12.5 Abbruch

Ein Abbruch erzeugt:

- keine Füllung;
- keinen positiven Burst;
- nur ein unauffälliges Auslaufen des Anflugschimmers.

### 12.6 Audio

Audio gehört nicht zum Erstumfang und ist kein Abnahmekriterium.

---

## 13. Authority, Replikation und Konsistenz

### 13.1 Host-Authority

Nur der Host entscheidet:

- Gültigkeit des Reward-Faktums und exakten materialisierten Wert;
- Zugriffsgruppe;
- Landepunkt und Landungszeit;
- Ablauf;
- Merge;
- Kandidaten und LoS;
- Reservierung;
- Transferstart und -abbruch;
- Ankunft;
- Resource-Commit;
- Rückgabe und Verfall.

Clients dürfen nur passive Darstellung und kosmetische Vorhersage ausführen.

### 13.2 Activity- und World-Scope

Der fachliche Essenz-State gehört genau zu einer Activity innerhalb einer World. Jede Identität und jeder Snapshot trägt beziehungsweise impliziert deshalb sowohl `worldRevision` als auch `activityRevision`.

Stale Daten einer älteren Activity, World oder lokalen Runtime dürfen:

- keine Cluster neu erzeugen;
- keinen Transfer abschließen;
- keinen HUD-Burst auslösen;
- keinen Wert gutschreiben;
- keinen neueren Zustand löschen.

Eine neue Activity in derselben World beginnt ohne Essenzbestand der Vorgängerin.

### 13.3 Keine Netzwerkentität pro Tropfen

Repliziert werden logische Cluster und Transfers, nicht sichtbare Tropfen.

Ein Cluster-Snapshot beziehungsweise -Delta beschreibt kompakt nur die für Gameplay und Darstellung benötigten Fakten. Ein Client rekonstruiert Tropfenanzahl, Größenmix und Animation aus Clusterzustand und Seed.

### 13.4 Zeitbasierte Darstellung

Das bestehende Netzwerk arbeitet tickbasiert. Die kurzen 120–300-ms-Flüge und 150–250-ms-Landungen müssen daher über Host-Zeitstempel beziehungsweise definierte Start-/Endzeiten dargestellt werden, nicht über gezählte Snapshot-Frames.

Es werden keine Positionsdaten pro Renderframe übertragen.

### 13.5 Delta und Full-Resync

Die Essenz erhält eine eigene, an `activityRevision` und `worldRevision` gebundene Replikationsprojektion mit:

- kompakten Upserts;
- Entfernungen beziehungsweise Tombstones;
- Transferänderungen;
- periodischem vollständigem Abgleich;
- Join-in-progress-Wiederherstellung;
- `activityRevision`, `worldRevision` und monotoner Zustandsrevision beziehungsweise gleichwertiger stale-sicherer Ordnung.

Das bestehende Boden-Power-up-Muster aus Delta plus Full-Resync ist eine sinnvolle Referenz, aber Adrenalin-Essenz bleibt aufgrund von Menge, Merge, Transfer und Lifetime eine eigene Domain und wird nicht in `PowerUpSystem` hineingezwungen.

### 13.6 Sichtbarkeitsprojektion

Das Netzwerk darf Daten bereits nach Zugriffsgruppe filtern oder der Client darf eine zulässige Projektion aus neutralen Zugriffsdaten ableiten. In beiden Fällen gilt:

- keine sammelbare Darstellung für Unberechtigte;
- keine Gameplayentscheidung durch Presentation;
- kein Zugriff über Spielerfarbe als Authority.

### 13.7 Idempotenz

Jeder Reward und Transfer besitzt eine eindeutige Identität.

Doppelte, verspätete oder wiederholte Nachrichten dürfen niemals:

- denselben Reward zweimal materialisieren;
- denselben Transfer zweimal gutschreiben;
- zurückgegebenen und angekommenen Wert gleichzeitig erhalten;
- abgelaufenen Wert wiederbeleben;
- einen neuen Cluster durch einen alten Tombstone löschen.

### 13.8 Ressourcensnapshot bleibt Quelle der Wahrheit

Die tatsächliche Adrenalinmenge bleibt im bestehenden Player-Resource-State und dessen Replikation kanonisch. Essenz-Snapshots ersetzen keinen Player-Resource-Snapshot.

Ein verlorenes kosmetisches Ankunftsevent darf höchstens den Burst verpassen lassen, niemals einen falschen Adrenalinwert erzeugen.

### 13.9 Verspätete Darstellung und Ankunft

Die sichtbare Flugphase ist keine Voraussetzung für den Host-Commit. Bei verspäteten Nachrichten wird der bestätigte Resource-State sofort übernommen; eine noch ausstehende Fluganimation wird verkürzt oder übersprungen. Es gibt weder eine künstliche Verzögerung der nutzbaren Ressource noch eine vorweggenommene Gutschrift für einen nur vorhergesagten Flug.

Presentation korreliert Transferabschluss und Resource-Revision. Bei vertauschter Empfangsreihenfolge darf ein kosmetischer Burst kurz zurückgestellt oder ausgelassen werden; der Resource-State wartet niemals auf ihn. Full-Resync und Join-in-progress rekonstruieren nur aktive Zustände und spielen keine historischen Arrival-Bursts erneut ab. Sichtbarkeit und vollständige Feedbackkette gelten für reguläre rechtzeitige Zustellung; Paketverlust darf entsprechend § 13.8 kosmetisches Feedback auslassen.

---

## 14. Repository-konforme Verantwortungsgrenzen

### 14.1 Aktueller Combat-Stand

Das frühere `CombatSystem` ist produktiv durch die neue Combat-Struktur ersetzt worden. Der relevante Aufbau besteht heute insbesondere aus:

- `CombatScope` und scope-festen Target-/Source-Referenzen;
- `CombatSource` mit getrennter Gameplay-Quelle, Actor, Attribution, Allegiance, Lineage und Correlation;
- unveränderlichen `TargetMutationOutcome`-Receipts;
- `WorldCombatRuntime` als world-owned Combat-Boundary;
- `WorldCombatCore` als konkretem Resolution-/Kompatibilitätskern;
- `CombatReactionPort` und `WorldCombatReactions` für geordnete Reaktionen nach bestätigten Outcomes;
- `ProjectileCombatContractAdapter` für verlustfreie Projectile-Provenance;
- `WorldGeometryQueries` als read-only World-Geometriegrenze;
- `WorldParticipation` als eigenständigem, repliziertem Teilnahme-Lifecycle.

Die Essenz muss sich in diese Grenzen einordnen und darf keine neue God Class oder zweite Combat-Authority erzeugen.

### 14.2 Zielverantwortung

| Verantwortung | Fachlicher Owner / Grenze |
|---|---|
| Combat-Mutation und bestätigtes Outcome | bestehende Combat-/Target-Owner |
| Reward-Intent an der Waffenwirkung | bestehende Execution-/Projectile-/Immediate-Attack-Verträge |
| Umwandlung eines bestätigten Rewards in Essenz | schmale post-commit Gameplay-Reaktion beziehungsweise Reward-Projektion |
| Cluster, Beiträge, Ablauf, Merge und Transfers | Activity-owned autoritative Essenz-Runtime beziehungsweise ein strikt activity-tokenisiertes Binding mit identischer Lifetime |
| Spielerressource | bestehender `ResourceSystem`-Owner hinter schmalem Resource-Port |
| Modus-/Teamzugriff | Domain-Policy auf Basis aktueller Mode-/Relationship-Daten |
| LoS und sicherer Boden | `WorldGeometryQueries` oder schmale Erweiterung dieser World-Capability |
| Tod, Life, Burrow und Participation | bestehende Player-/World-Lifecycle-Owner; Essenz konsumiert deren Ereignisse |
| Netzwerkzustand | eigene Activity-gebundene Essenz-Replikationsprojektion innerhalb der World |
| Tropfen, Glow, Merge und Transferanimation | Presentation/GPU-Renderer |
| HUD-Anflug und Ankunft | lokale HUD-Presentation |

### 14.3 Ownership folgt Activity-Lifetime

Alle vier Spielmodi besitzen einen `ActivityDescriptor`. Die Essenz entsteht ausschließlich während einer solchen Match-Activity und wird bei deren Ende vollständig verworfen. Ihre fachliche Lifetime ist deshalb **Activity**, nicht World.

Bevorzugtes Zielbild:

- eine Activity-owned Essenz-Runtime beziehungsweise ein Activity-Child besitzt Cluster, Beiträge und Transfers;
- sie konsumiert schmale world-owned Capabilities für Combat-Outcomes, Player-Ressourcen, Geometrie und Participation;
- ihre Presentation-Bindings fallen mit derselben Activity;
- World-Teardown schließt die Activity und räumt die Essenz dadurch automatisch mit ab.

Ein tokenisiertes Binding an einen scene- oder world-langlebigen technischen Service ist nur dann gleichwertig, wenn der gesamte fachliche State nachweislich mit `activityRevision` gebunden ist und beim Activity-Detach vollständig fällt. Ein Activity-Wechsel darf weder den world-owned Combat-Owner in die Activity verschieben noch allein für die Essenz einen zweiten Combat-Core erzeugen.

Der aktuelle Stand materialisiert bereits eigene Activity-Runtimes für Coop und Capture the Beer; Deathmatch und Team-Deathmatch besitzen zwar Activity-Descriptoren, aber noch keine gleichartige spezialisierte lokale Runtime. Der Implementierungsplan muss deshalb eine **einheitliche cross-mode Activity-Lifetime** herstellen, ohne Essenz-State in `ArenaLifecycleCoordinator` oder `HostUpdateCoordinator` zu verlagern. Mögliche technische Schnitte werden im Plan bewertet.

### 14.4 Kein Essenz-State im Combat-Core

Combat bestätigt Treffer und Herkunft. Combat besitzt nicht:

- Bodencluster;
- Lebensdauer;
- Magnetradius;
- Spielerwahl;
- Transferflug;
- Netzwerk-Snapshot;
- GPU-Tropfen;
- HUD-Animation.

Der Combat-Core darf höchstens eine schmale neutrale Reaction-/Sink-Grenze bedienen. Die konkrete Essenz-Runtime wird von Composition verdrahtet, nicht vom Combat-Core als Service gesucht.

### 14.5 Erforderlicher Reward-Vertrag

Der bestehende generische Damage-Observer reicht allein nicht aus: Er enthält zwar Schaden, Damage-Kind, Slot und Angreifer-ID, aber nicht die vollständige `CombatSource`-Provenance, Reward-Komponenten, Correlation und kanonische Trefferposition.

Der Implementierungsplan muss daher einen schmalen post-commit Vertrag beziehungsweise eine klar getrennte Reward-Pipeline vorsehen, die:

- ein bestätigtes Outcome konsumiert;
- die vollständige Combat-Herkunft erhält;
- den expliziten Reward-Intent kennt;
- die wertbildenden Reward-Komponenten verlustfrei trägt;
- die kanonische Trefferposition enthält;
- den allgemeinen Player-Gain-Multiplikator außerhalb des Combat-Owners genau einmal auflöst;
- daraus genau einen idempotenten materialisierten Reward-Beitrag erzeugt;
- Activity-, World- und Combat-Scope absichert.

Der aktuelle `CombatReactionPort.onAcceptedHit` ist bereits eine mögliche post-commit Naht, trägt heute aber nur Target, `CombatSource` und Mutation-Outcome; Reward-Intent und kanonische Trefferposition fehlen. Der Plan bewertet deshalb eine gezielte Erweiterung dieser Naht gegen einen eigenen kleinen Reward-Sink. Ein neuer globaler Event-Bus ist dafür nicht erforderlich.

Dieser Vertrag darf als Erweiterung einer bestehenden Reaktionsgrenze oder als eigener kleiner Reward-Sink entstehen. Er darf nicht aus Network-, Renderer- oder dem heutigen reduzierten Damage-Observer rückwärts rekonstruiert werden.

### 14.6 Aktuelle Gain-Pfade und Cutover

Der aktuelle Stand verteilt primärtrefferbezogene `addAdrenaline`-Aufrufe noch über mehrere konkrete Pfade, unter anderem:

- direkte Projectile-Treffer;
- Hitscan;
- Melee;
- Kettenziele;
- zusätzliche Melee-Trefferbelohnungen.

Der Cutover muss alle belohnungsberechtigten Pfade auf den neuen Reward-Vertrag umstellen. Unabhängige Adrenalinquellen bleiben direkt.

Ein Parallelbetrieb, bei dem derselbe Treffer sowohl Essenz erzeugt als auch direkt Adrenalin schreibt, ist unzulässig.

### 14.7 Attribution statt Allegiance-Owner

Der aktuelle Projectile-Vertrag definiert `attributionId` ausdrücklich als die Entität, der Treffer, Kills und Ressourcengewinn zugerechnet werden. Einzelne bestehende direkte Gain-Pfade greifen noch auf `allegiance.ownerId` zurück.

Diese Legacy-Abweichung darf nicht in das Essenzsystem übernommen werden. Der Implementierungsplan muss Reward-Attribution und Zugriffsgruppe sauber trennen und die neuen Tests insbesondere für Reflection/Deflection abdecken.

### 14.8 Resource-Port erweitern, nicht umgehen

`ResourceSystem.addAdrenaline` wendet heute den Gain-Multiplikator an und kappt am Maximum. `refundAdrenaline` umgeht den Multiplikator, besitzt aber eine andere fachliche Bedeutung.

Für die Essenz werden zwei saubere Semantiken benötigt:

1. erzeugerseitige Erfassung der Gain-Basis bei Aktivierung/Übernahme sowie spätere Auflösung des theoretischen Gewinns daraus ohne Cap-Commit;
2. sammlerseitiger atomarer Commit eines bereits aufgelösten Werts mit aktuellem Cap, Revision und Observern, der den tatsächlich gutgeschriebenen Wert zurückliefert.

Der Implementierungsplan soll dafür einen expliziten Resource-Vertrag ergänzen. `refundAdrenaline` ist kein zulässiger semantischer Shortcut; ebenso unzulässig ist eine Read-then-Write-Sequenz außerhalb des Resource-Owners.

### 14.9 Lifecycle-Fan-out

Der aktuelle Burrow-Start besitzt einen einzelnen Callback, der bereits für „Bier fallenlassen“ genutzt wird. Essenz darf diesen Callback nicht ersetzen und damit bestehendes Verhalten verlieren.

Der Plan muss entweder:

- einen echten Mehrfach-Observer/Fan-out anbieten;
- oder die bestehende Composition so erweitern, dass alle Reaktionen geordnet aus demselben Lifecycle-Faktum ausgeführt werden.

Dasselbe Prinzip gilt für Tod und Player-Unavailability: keine zweite konkurrierende Authority und kein Überschreiben bestehender Hooks.

### 14.10 Geometrie

`WorldGeometryQueries` ist der passende Ausgangspunkt für:

- World-Metriken;
- LoS;
- Blockerabfragen;
- stabile Teardown-Semantik.

Die fehlende sichere Bodenpunktsuche wird als schmale World-Geometrie-Capability ergänzt. Die Essenz greift nicht direkt auf `ArenaObstacleIndex`, private Combat-Felder oder Phaser-Sprites zu.

### 14.11 Presentation und GPU

Das Repository besitzt mit `GpuVfxSystem` bereits:

- zentrale GPU-Lanes;
- gepoolte Slots;
- Quality-/Admission-Control;
- Source-Lifecycle;
- Profiling;
- einen gemeinsamen Atlas.

Der aktuelle Lane-Katalog enthält noch keine Essenz-Lane. Der Implementierungsplan muss daher begründet entscheiden:

- kurzlebige Ausstoß-, Merge-, Ankunfts- und Rückgabeakzente über das gemeinsame `GpuVfxSystem`;
- lang lebende Bodenperlen und laufende Transfers über dafür geeignete neue Lane(s) oder einen dedizierten, weiterhin zentral gepoolten Essenz-Renderer mit Activity-gebundenem Binding.

Verbindlich:

- kein eigener ad-hoc `SpriteGPULayer` pro Cluster oder Effektcontroller;
- keine GPU-Source pro sichtbarem Tropfen oder Reward-Beitrag;
- Body- und Glow-Lanes nur, wenn Blend-Mode, Depth, Order und Lebensdauer dies tatsächlich erfordern;
- Kapazität und maximale Lebensdauer werden aus einem Stressprofil hergeleitet;
- Capacity-Drops reduzieren nur Details, nie Gameplaywert oder die Kernlesbarkeit eines Clusters.

### 14.12 HUD

Der aktuelle `PlayerStatusRing` besitzt bereits Adrenalin-Burst und Sparks, löst sie aber indirekt erst bei einer hinreichend großen relativen Erhöhung aus. Kleine gebrochene Essenzwerte dürfen dadurch nicht ohne Feedback bleiben.

Der Plan ergänzt deshalb explizite Presentation-Hooks für Incoming, Arrival und Cancel, statt die Gameplaylogik an die bestehende Schwellenprüfung anzupassen.

### 14.13 Balance Lab und Headless-Modelle

Der aktuelle Weapon Balance Lab Runtime misst `adrenalineGenerated` über tatsächlich beobachtete Resource-Gains. Nach Einführung der Essenz wäre dies ohne Anpassung in Wahrheit „eingesammeltes Adrenalin“ und zusätzlich von Entfernung, Landung und Settle-Zeit abhängig.

Der Implementierungsplan muss die Messbegriffe trennen:

- theoretisch/materialisiert erzeugter Wert;
- tatsächlich eingesammelter Wert;
- verfallener Wert;
- verbrauchter Wert.

Für reine Waffen-Bruttobalance ist ein deterministischer Headless-/Lab-Modus zulässig, der Essenz automatisch beziehungsweise sofort einsammelt oder direkt das Reward-Faktum misst. Dieser Modus darf nicht die Produktionssemantik verändern.

Bestehende Headless-Modelle, die `adrenalinGain` unmittelbar buchen, müssen entweder die neue Reward-Semantik abbilden oder ausdrücklich als Brutto-Reward-Modell dokumentiert werden.

---

## 15. Netzwerk- und Performance-Anforderungen

### 15.1 Erwartete Last

Mehrere hundert sichtbare Tropfen sind in intensiven Kämpfen normal. Das System muss auch mit dem aktuellen Maximum von bis zu zwölf Spielern, hohen Feuerraten, Ketten-/Split-Treffern und parallelen Transfers stabil bleiben.

### 15.2 Trennung von Gameplay und Darstellung

Gameplay arbeitet auf:

- Cluster-/Expiry-Buckets;
- exakten Werten;
- Zugriffsgruppen;
- Reservierungen und Transfers.

Presentation arbeitet auf:

- adaptiver Tropfenanzahl;
- Größenmix;
- Glow;
- lokalen Animationen.

Ein Cluster mit Wert 50 darf gameplayseitig exakt bleiben und visuell dennoch nur aus einer begrenzten Zahl Tropfen und einer größeren Perle bestehen.

### 15.3 CPU

Anforderungen:

- keine Physik und kein Gameplaytick pro sichtbarem Tropfen;
- keine LoS-Prüfung pro Renderframe;
- eine LoS-Prüfung pro Transferstart;
- räumliche Vorauswahl für Merge und Magnetkandidaten;
- keine ungebremste Allokation pro Treffer oder Frame;
- zeitbasierte Hostlogik unabhängig von Render-FPS;
- bounded work bei hoher Dichte durch Clusterung und Bucketing.

### 15.4 GPU

Anforderungen:

- vorallokierte beziehungsweise gepoolte Darstellung;
- stabile Instanzslots oder gleichwertig günstige Updates;
- Quality-Stufen;
- getrennte Diagnose für Spawnversuche, sichtbare Instanzen und visuelle Drops;
- keine individuellen Lichter;
- keine schweren GameObjects pro Tropfen.

### 15.5 Netzwerk

Anforderungen:

- kein Snapshot-Eintrag pro sichtbarem Tropfen;
- keine Positionsupdates pro Renderframe;
- kompakte Cluster- und Transfer-Deltas;
- Full-Resync;
- Join-in-progress;
- stale-sichere Activity-, World- und Zustandsrevisionen;
- Messung von Bytes pro Tick und Sekunde;
- kein Client-Pickup-RPC-Sturm.

### 15.6 Degradation

Bei hoher Last dürfen reduziert werden:

- Mikrotropfen;
- Satelliten;
- Wabern;
- sekundärer Halo;
- Merge-Übergänge;
- Flugschweife.

Nicht reduziert werden dürfen:

- Wert;
- Clusterposition;
- Sammelberechtigung;
- sichtbarer Kern eines relevanten Clusters;
- Transferlesbarkeit;
- Ankunft, Rückgabe und Ablauf.

### 15.7 Stressprofil

Der Implementierungsplan definiert mindestens einen reproduzierbaren Stressfall mit:

- mehreren hundert sichtbaren Tropfen;
- hohen Reward-Fakten pro Sekunde;
- maximal realistischer Spielerzahl;
- wiederholtem Merge;
- mehreren parallelen Transfers;
- Tod-/Burrow-Abbrüchen;
- Full-Resync während aktiver Transfers;
- reduzierter Grafikqualität.

Konkrete CPU-, GPU- und Netzwerkbudgets werden aus einem aktuellen Baseline-Trace abgeleitet und gehören in den Implementierungsplan, nicht in dieses GDD.

---

## 16. Balancewirkung und Diagnose

### 16.1 Ausgangsprinzip

Die heutigen Trefferwerte werden im ersten Schritt nicht pauschal angepasst. Das System soll zunächst zeigen, wie stark sich Sammelquote, Distanz und Teamverteilung tatsächlich verändern.

Der aktuelle Bite-Wert von 50 ist ein Platzhalter und keine Ziel- oder Kapazitätsgrundlage. Erwartet wird eher eine deutlich niedrigere Größenordnung, beispielsweise ungefähr 15. Die technische Lösung muss trotzdem größere Einzel- und Kombinationswerte tragen.

### 16.2 Beabsichtigte Wirkungen

- Fernkampf bleibt wirksam, generiert aber weniger zuverlässig nutzbares Adrenalin.
- Kurze und mittlere Distanz gewinnen an Wert.
- Vorstoß, Gefahr und Ablaufzeit erzeugen Entscheidungen.
- Frontspieler können Teamessenz aufnehmen.
- Mobilität gewinnt indirekt an Bedeutung.
- Nahkampf sammelt tendenziell zuverlässiger.
- Volle Spieler können Teamwert erzeugen.
- Deathmatch erlaubt kurze persönliche Vorratsbildung.

### 16.3 Messgrößen

Mindestens zu erfassen sind:

**Erzeugung**

- authored Reward vor allgemeinem Gain-Multiplikator;
- materialisierter Wert nach Erzeugermodifikatoren;
- Reward-Fakten nach Waffe, Trefferzweig, Target-Art und Distanz;
- deduplizierte beziehungsweise als stale verworfene Fakten.

**Bestand und Bewegung**

- aktiver Bodenwert;
- aktiver reservierter Flugwert;
- Zahl aktiver Cluster, Expiry-Buckets und Transfers;
- Merge-Häufigkeit;
- durchschnittliche Zeit bis Landung, Transferstart und Ankunft.

**Ergebnis**

- tatsächlich gutgeschriebener Wert;
- regulär verfallener Wert;
- bei Ankunft zurückgegebener Wert;
- nach Ablauf nicht mehr rückgabefähiger Wert;
- einmalig wegen fehlgeschlagener Bodenplatzierung verworfener Wert;
- bei Activity-/Runden-/World-Ende verworfener Restwert;
- Abbrüche nach Tod, Burrow, Untergrund, Participation und Teardown;
- Sammelquote nach Modus, Waffe, Distanz und Spielerrolle;
- Anteil Erzeuger versus Teammitglieder.

**Technik**

- CPU-Zeit für Spawn, Merge, Kandidatensuche und Transfer;
- Netzwerkbytes und Upserts/Removals;
- Full-Resync-Größe;
- sichtbare GPU-Instanzen;
- Quality- und Capacity-Drops;
- maximale Lane-/Renderer-Auslastung.

### 16.4 Werterhaltung

Für ein Messintervall innerhalb einer Activity gilt; Bestände werden an den Intervallgrenzen, Zu- und Abflüsse ausschließlich innerhalb desselben Intervalls gemessen:

```text
aktiver Bestand zu Intervallbeginn
+ im Intervall materialisierter Wert
= im Intervall tatsächlich gutgeschriebener Wert
+ im Intervall endgültig verfallener Wert
+ im Intervall durch Activity-/Runden-/World-Ende verworfener Wert
+ im Intervall wegen Platzierungsfehler verworfener Wert
+ aktiver Bestand zu Intervallende

aktiver Bestand
= noch nicht gelandeter Wert im Ausstoß
+ frei verfügbarer Bodenwert
+ reservierter Transferwert
```

Rückgabe und Merge sind interne Zustandsübergänge und dürfen nicht als zusätzlicher Gewinn oder endgültiger Verlust gezählt werden. Jeder Wert gehört jederzeit genau einer Bestandskategorie an. Eine kosmetische Rückflussanimation bildet keinen zusätzlichen Wertbestand. Teardown bilanziert den entfernten Bestand vor dem Löschen; Lifecycle-Verwurf bleibt vom normalen Zeitablauf getrennt. Zurückgewiesene oder deduplizierte Fakten zählen nicht als neu materialisierter Wert.

### 16.5 Besondere Beobachtungspunkte

- Bite und weitere Nahkampfwaffen;
- sehr schnelle Primärwaffen;
- Multi-Pellet, Split und Ketten;
- große Reichweiten;
- volle Erzeuger;
- Coop-Verteilung zwischen Front und Distanz;
- persönliche Vorräte im Deathmatch;
- passive Regeneration während des Flugs;
- Verhalten bei sehr kleinen Bruchteilen.

---

## 17. Tuningparameter

Alle Werte sind zentral und verständlich konfigurierbar. Sie verändern keine Authority- oder Ownership-Regel.

| Bereich | Parameter | Ausgangspunkt | Hauptwirkung |
|---|---|---:|---|
| Ausstoß | Zeit bis Landung | 150–250 ms | Sichtbarkeit des Trefferbursts versus Sammelverzögerung |
| Ausstoß | Streuradius | 20–45 px | Größe der Beutefläche |
| Ausstoß | wertabhängige Breite | gering | Wirkung großer Treffer ohne extreme Verteilung |
| Boden | Lebensdauer ab Landung | 8 s | Komfort versus Handlungsdruck und Bestand |
| Boden | Ablaufwarnung | 1–1,5 s | Lesbarkeit des Verfalls |
| Merge | Zeitfenster | 100–200 ms | Zusammenfassung schneller Trefferfolgen |
| Merge | Radius | 24–40 px | Clusterzahl versus Flüssigkeitsperlen |
| Magnet | Radius | ca. 160 px | Nähe-/Risikoanforderung |
| Magnet | Mindestflugzeit | ca. 120 ms | Sichtbarkeit kurzer Transfers |
| Magnet | Maximalflugzeit | ca. 300 ms | Sichtbarkeit und Abbruchfenster |
| Magnet | Beschleunigung | deutlich zunehmend | magnetisches Gefühl |
| HUD | Arrival-Bündelung | 80–150 ms | ruhiges statt hektisches Feedback |
| Visual | Mindesttropfengröße | wenige Pixel | Lesbarkeit kleiner Werte |
| Visual | Größenstufen | 2–3 | Mengenwirkung und visuelle Sprache |
| Visual | Tropfendichte | adaptiv | Regenwirkung versus GPU-Last |
| Visual | Cluster-Halo | schwach bis mittel | Auffindbarkeit versus Überstrahlung |
| Visual | Merge-Wabern | niedrig | Flüssigkeitsgefühl versus Unruhe |

Die stärksten Gameplayhebel sind Magnetradius, Bodenlebensdauer und Landungszeit. Die stärksten Juicehebel sind Ausstoßkurve, Tropfenform, Merge-Wachstum, Magnetbeschleunigung und synchroner HUD-Burst.

---

## 18. Umfang der vollständigen Erstimplementierung

### 18.1 Muss bis zur finalen Abnahme enthalten sein

- alle vier aktuellen Spielmodi;
- alle heute belohnungsberechtigten Primärtrefferpfade;
- Attribution über den kanonischen Combat-Source;
- exakte, gebrochene Werte;
- Erzeugung bei voller Ressource;
- gültige Landepunkte;
- acht Sekunden Bodenlebensdauer;
- Merge kompatibler Beiträge;
- Sichtbarkeit nur für Berechtigte;
- host-getriebene Magnetwahl;
- einmalige LoS;
- Teilentnahme;
- parallele Transfers;
- Abbruch und Rückgabe;
- Ablauf während des Flugs;
- Activity-owned beziehungsweise strikt Activity-gebundener, World-sicherer Teardown;
- eigene Activity-gebundene Delta-/Full-Replikation;
- GPU-optimierte Tropfen-/Perlendarstellung;
- Incoming- und Arrival-HUD-Signale;
- Diagnose und Stressfall;
- angepasste Balance-Lab-/Headless-Semantik;
- **visuell ausgereifte Essenzdarstellung gemäß § 11**, nicht nur eine funktionale Platzhalterdarstellung;
- abgestimmte Farben, Größen, Bewegungs- und Beschleunigungskurven, Merge-Übergänge, Glow/Halo und HUD-Intensitäten;
- adaptive Dichte und Quality-/LOD-Verhalten, das auch bei hoher Last attraktiv und lesbar bleibt.

### 18.2 Darf während der frühen Implementierungsphasen vereinfacht sein

Bis zur funktionalen Netzwerk-/Presentation-Integration dürfen vorläufig sein:

- exakte Waberintensität;
- sekundäre Satelliten-/Mikrotröpfchendichte;
- finale Farb-/Glowwerte;
- dekorative Merge-Schlieren;
- Rückflusskurven;
- Quality-/LOD-Schwellen;
- Feintuning der HUD-Intensität.

**Diese Punkte sind vor der finalen Abnahme gezielt zu polieren.** Ein technisch funktionaler, aber sichtbar prototypischer Zustand erfüllt § 19 nicht.

### 18.3 Auch nach der Erstimplementierung nicht erforderlich

- Audio;
- echte Flüssigkeit;
- individuelle Tropfenkollision;
- individuelles Licht;
- exakte optische Wertablesbarkeit;
- neue Sammelupgrades;
- finales Rebalancing;
- aufwendiges Mesh-/Metaball-Morphing, sofern die einfachere GPU-Lösung die Zielqualität erreicht.

---

## 19. Abnahmekriterien

### 19.1 Gameplay

- Ein Primärtreffer erzeugt sichtbar eine räumliche Belohnung statt unmittelbarer unsichtbarer Gutschrift.
- Der Spieler versteht Ausstoß, Landung und Magnetaufnahme ohne Texttutorial.
- Fernkampf bleibt möglich, ist beim Adrenalingewinn aber weniger zuverlässig.
- Teammitglieder profitieren in Coop und Teammodi nachvollziehbar voneinander.
- Deathmatch-Essenz bleibt persönlich.
- Unberechtigte Essenz ist weder sichtbar noch sammelbar.
- Teilentnahme, Abbruch, Rückgabe und Ablauf erzeugen keinen unerklärlichen Wertverlust.

### 19.2 Gamefeel und visuelle Qualität

- Treffer-Ausstoß, Landung, Bodenphase, Transfer und HUD wirken wie eine Kette.
- Die Essenz wirkt flüssig und energetisch statt kristallin oder münzartig.
- Merge wirkt wie Zusammenfließen.
- Magnetflug ist deutlich, aber nicht träge.
- Tod und Burrow-Abbruch sind nachvollziehbar.
- Große Mengen wirken wertvoll, ohne Gefahren und Gegner zuzudecken.
- Die abgeschlossene Darstellung besitzt keinen Platzhalter-/Debug-/Minimal-Prototyp-Look.
- Kleine und große Rewards sehen bewusst gestaltet aus, ohne dass große Werte zu übergroßen Loot-Orbs werden.
- Farbe, Kern, Glow, Halo und HUD bilden eine erkennbare gemeinsame Adrenalin-Farbsprache.
- Bewegungsübergänge wirken weich; Merge, Slot-Reuse, Return und Expiry erzeugen keine auffälligen Pops oder Sprünge.
- Quality-Degradation erhält die ästhetische Kernwirkung und reduziert zuerst dekorative Details.
- Die Essenz ist sowohl in Bewegung als auch in repräsentativen Standbildern visuell ansprechend, bleibt aber klar unterhalb von Gegnern, Gefahren und echten Projektilen in der Aufmerksamkeitshierarchie.

### 19.3 Authority und Korrektheit

- Kein Client bestätigt Reward, Reservierung oder Resource-Gain.
- Jeder heute belohnungsberechtigte und tatsächlich bestätigte Treffer erzeugt exakt einen entsprechenden Reward-Beitrag.
- Kein Treffer vergibt gleichzeitig direkte und materialisierte Belohnung.
- Attribution stammt aus dem Combat-Source, nicht aus Allegiance-Owner oder Farbe.
- Stale Activity-, World-, Runtime- und Life-Daten bleiben inert.
- Derselbe Transfer kann nicht doppelt ankommen.
- Resource-Multiplikatoren werden genau einmal angewandt.
- Resource-Revision und Gain-Observer spiegeln erst die tatsächliche Ankunft.
- Die Werterhaltungsgleichung stimmt in automatisierten Stressfällen.

### 19.4 Netzwerk

- Keine Tropfenposition wird pro Frame übertragen.
- Join-in-progress rekonstruiert aktive Cluster und Transfers.
- Delta-Verlust wird durch Full-Resync korrigiert.
- Alte Tombstones und Transfers beschädigen keine neue Activity oder World.
- Kein Pickup-RPC pro Tropfen oder Cluster ist erforderlich.

### 19.5 Performance

- Mehrere hundert sichtbare Tropfen verursachen keinen großen FPS-Einbruch.
- Gameplaykosten hängen an Clustern/Transfers, nicht an sichtbaren Tropfen.
- Quality-Degradation reduziert nur Details.
- GPU- und Netzwerkdiagnose zeigen nachvollziehbare Peaks und Drops.

### 19.6 Repository-/Architekturgates

- `WorldCombatCore` besitzt keinen Essenz-State.
- Die neue Runtime besitzt Activity-Lifetime, ist an `activityRevision` und `worldRevision` gebunden und teardown-sicher.
- Der Burrow-Hook überschreibt nicht die bestehende Beer-Reaktion.
- Sichere Bodenpunkte nutzen eine World-Geometrie-Capability.
- `refundAdrenaline` wird nicht als Arrival-Grant missbraucht.
- Belohnungsberechtigte direkte `addAdrenaline`-Pfade sind vollständig auf den Reward-Cutover umgestellt.
- Unabhängige direkte Adrenalinquellen bleiben funktional.
- Der Balance Lab benennt Materialisierung und Einsammlung korrekt getrennt.

### 19.7 Manuelle Abnahme

Vor finalem Abschluss werden mindestens geprüft:

- Host und Client;
- Coop, Team-Deathmatch, Capture the Beer und Deathmatch;
- Projectile, Hitscan, Melee, Kette und Split;
- Reflection/Deflection;
- volle Ressource;
- kleine Bruchteile;
- Tod, Burrow und Disconnect während des Flugs;
- Activity-/Runden-/World-Wechsel;
- hohe Effekt- und Gegnerdichte;
- reduzierte Grafikqualität;
- kleine, mittlere und große Essenzwerte auf Zielgröße und Farbsprache;
- Ausstoß, Landung, Merge, Magnetflug, Rückgabe und Expiry in Bewegung;
- sichtbare Qualität von Host und Client ohne Platzhalter-/Debug-Look;
- Lesbarkeit und ästhetische Wirkung bei normaler sowie hoher Essenzdichte.

---

## 20. Referenzszenarien

### 20.1 Normaler Fernkampftreffer

Ein Spieler trifft aus 500 px Entfernung mit einer Primärwaffe und erzeugt 10 materialisiertes Adrenalin.

- Der Treffer erzeugt einen sichtbaren Tropfenburst.
- Nach ungefähr 200 ms liegt die Essenz am Ziel.
- Der Schütze ist außerhalb von 160 px und erhält nichts unmittelbar.
- Die Essenz verfällt nach acht Sekunden, sofern kein Berechtigter näher kommt.

### 20.2 Erzeuger ist bereits voll

Ein voller Coop-Spieler erzeugt 8 Adrenalin.

- Vollständige 8 werden materialisiert.
- Ein naher Teamkamerad kann sie aufnehmen.
- Der Erzeuger wird wegen fehlender Kapazität nicht als Magnetziel gewählt.

### 20.3 Gebrochener Wert

Ein Treffer erzeugt nach Modifikatoren 3,5.

- Der Cluster speichert exakt 3,5.
- Die Darstellung kann drei kleine und einen geringfügig größeren Tropfen oder eine gleichwertige Perle zeigen.
- Es entsteht kein 0,5-Pixel-Mikrotropfen.
- Bei Ankunft werden exakt bis zu 3,5 gutgeschrieben.

### 20.4 Kettenziel

Ein Primär-Hitscan trifft ein erstes Ziel und zwei Kettenziele, die heute jeweils Reward vergeben.

- Drei Reward-Fakten entstehen an drei kanonischen Trefferpositionen.
- `damageKind === 'chain'` verhindert die Materialisierung nicht.
- Reaction-/Folgeschaden ohne Reward-Intent erzeugt dagegen keine Essenz.

### 20.5 Multi-Hit auf dasselbe Ziel

Drei separat belohnte Projektile derselben Aktivierung treffen dasselbe Ziel.

- Drei Reward-Beiträge entstehen.
- Sie dürfen nach Landung zusammenfließen.
- Correlation gruppiert Diagnose/Visual, unterdrückt aber keinen der drei Werte.

### 20.6 Teamcluster mit parallelen Sammlern

Ein Teamcluster enthält 30. Spieler A kann 8, Spieler B 12 aufnehmen.

- Zwei atomare Transfers mit 8 und 12 starten.
- 10 bleiben am Boden.
- Kein Teilwert wird doppelt reserviert.

### 20.7 Kapazität sinkt im Flug

Ein Transfer reserviert 10. Während des Flugs füllt Regeneration 6 freie Punkte.

- Bei Ankunft sind nur 4 frei.
- 4 werden exakt gutgeschrieben.
- 6 kehren zum Ursprung zurück, sofern noch nicht abgelaufen.

### 20.8 Tod im Flug

Ein Transfer startet und der Zielspieler stirbt vor Ankunft.

- Keine Gutschrift.
- Der Transfer wird an die gebundene alte Life-Identität nicht mehr abgeschlossen.
- Der Wert kehrt zum Ursprung zurück oder verfällt, falls die Ablaufzeit überschritten ist.
- Der respawnte Spieler kann Bodenessenz später neu beanspruchen.

### 20.9 Burrow-Wind-up

Ein Transfer ist unterwegs und der Spieler beginnt sich einzugraben.

- Abbruch erfolgt beim Wind-up-Start.
- Die bestehende Beer-Drop-Reaktion läuft weiterhin.
- Keine Ankunft und kein positiver HUD-Burst.

### 20.10 Ablauf im Flug

Ein Transfer startet 100 ms vor Ablauf und benötigt 250 ms.

- Er darf noch erfolgreich ankommen.
- Bei Abbruch nach Ablauf entsteht kein Bodenwert mehr.
- Nicht aufnehmbarer Rest verfällt bei Ankunft.

### 20.11 Reflection

Ein gegnerisches Primärprojektil wird fachlich von Spieler B übernommen und trifft anschließend gültig.

- Attribution und Allegiance der übernommenen Quelle entscheiden.
- Die Essenz wird Spieler B beziehungsweise dessen Zugriffsgruppe zugerechnet.
- Die ursprüngliche Quelle erhält keinen Reward.

### 20.12 Activity- oder World-Wechsel

Während Cluster und Transfers aktiv sind, endet die Activity beziehungsweise die World.

- Alle zugehörigen Werte werden ohne Resource-Gutschrift entfernt.
- Späte Deltas und Arrival-Nachrichten bleiben stale und inert.
- Die nächste Activity/World startet ohne Essenzrest.

### 20.13 Full-Resync

Ein Client verpasst Cluster- und Transfer-Deltas.

- Der nächste Full-Resync stellt den autoritativen Bestand wieder her.
- Bereits abgeschlossene Transfers erscheinen nicht erneut.
- Der Resource-Snapshot bleibt korrekt.

### 20.14 Ergänzende Review-Szenarien

| Fall | Erwartetes Ergebnis |
|---|---|
| Allgemeiner Gain-Buff endet zwischen Auslösung und Treffer. | Die bei Auslösung eingefrorene Basis gilt; ein späterer Respawn-Build ersetzt sie nicht. |
| Reflection übernimmt dieselbe Wirkung. | Basis des neuen Erzeugers ersetzt die alte; keine Multiplikation beider Gain-Faktoren. |
| Gültige Wirkung trifft nach Erzeugertod. | Essenz entsteht; nach Disconnect nur mit vollständig erhaltener Herkunft und Wertbasis. |
| Treffer verliert weder HP noch Rüstung. | Keine Essenz; Treffer mit positivem Rüstungsverlust oder nur 1 verbleibendem HP erhält dagegen den vollen Reward. |
| Nahe Bodenpositionen liegen auf verschiedenen Seiten einer Wand. | Kein Merge durch die Wand. Auch wiederholtes Merge verschiebt den festen Anker nicht. |
| Rückgabe wird während kosmetischem Rückfluss neu reserviert. | Genau ein Wertbestand und ein neuer Transfer; alte Animation erzeugt keinen zweiten Bodenwert. |
| Resource-Snapshot trifft vor dem Flug-/Arrival-Ereignis ein. | Ressource sofort korrekt; verspäteten Flug verkürzen/überspringen, kein historischer Doppelburst. |
| Begrenzte Fallbacksuche findet unerwartet keinen Landepunkt. | Einmaliger diagnostizierter Platzierungsverlust; kein Retry, kein unsichtbarer Direkt-Gain. |
| Activity endet während des Ausstoßes. | Restwert wird als Lifecycle-Verwurf bilanziert; keine spätere Landung oder Gutschrift. |

---

## 21. Verbindliche Invarianten

1. Nur ein bestätigtes, belohnungsberechtigtes post-commit Reward-Faktum materialisiert Wert.
2. Ein Reward-Intent allein erzeugt keinen Wert.
3. Der Erzeuger stammt aus Combat-Attribution, nicht aus Farbe oder pauschaler Owner-ID.
4. Nur Player-Attribution erzeugt sammelbares Player-Adrenalin.
5. Erzeugermodifikatoren wirken genau einmal vor Materialisierung.
6. Sammlermodifikatoren wirken nicht erneut.
7. Volle Erzeuger erzeugen den vollständigen theoretischen Wert.
8. Gebrochene Werte bleiben exakt.
9. Sichtbare Tropfen besitzen keine feste Wertstückelung.
10. Jeder heute separat belohnte Treffer bleibt separat werttragend.
11. Correlation unterdrückt keine gültigen Multi-Hits.
12. Abgelehnte oder vollständig wirkungslose Treffer erzeugen keine Essenz.
13. Vor Landung ist Essenz nicht sammelbar.
14. Ein Landepunkt ist world-gültig und nicht rendererabhängig.
15. Nur identische Zugriffsgruppen dürfen mergen.
16. Merge erneuert keine Ablaufzeit.
17. Unberechtigte Spieler sehen und sammeln keine Essenz.
18. Magnetziel ist nur ein interaktiver, lebender, oberirdischer Spieler mit Kapazität.
19. LoS wird genau einmal vor Transferstart geprüft.
20. Entfernung und spätere LoS brechen einen gültigen Transfer nicht ab.
21. Mehrere atomare Teiltransfers dürfen parallel laufen.
22. Eingehende Reservierungen werden bei weiterer Zielwahl berücksichtigt.
23. Adrenalin wird erst bei bestätigter Ankunft gutgeschrieben.
24. Die Ankunft prüft die aktuelle Kapazität erneut.
25. Nicht aufnehmbarer Rest kehrt werttreu zurück, solange er nicht abgelaufen ist.
26. Tod, Burrow/Untergrund und Participation-Verlust brechen den Transfer ab.
27. Rückgabe erfolgt zur Ursprungsposition, nicht zur Spielerposition.
28. Ein vor Ablauf gestarteter Transfer darf ankommen.
29. Ein nach Ablauf abgebrochener oder nicht aufnehmbarer Rest wird nicht wiederbelebt.
30. Erzeugertod oder Disconnect entfernt Bodenessenz nicht vorzeitig.
31. Activity-/Runden-/World-Ende entfernt zugehörige Essenz vollständig.
32. Stale Activity-, World-, Runtime- oder Life-Daten bleiben inert.
33. Kein Transfer und kein Reward kann doppelt committed werden.
34. Kein visueller oder technischer Kapazitätsgrenzwert vernichtet Gameplaywert.
35. Die tatsächliche Player-Ressource bleibt beim bestehenden Resource-Owner.
36. GPU- und HUD-Presentation mutieren kein Gameplay.
37. Bestehende Lifecycle-Reaktionen werden durch neue Hooks nicht überschrieben.
38. Die Werterhaltungsgleichung bleibt jederzeit nachvollziehbar.

---

## 22. Übergabe an den Implementierungsplan

### 22.1 Designreview und Entscheidungsstatus

Der gemeinsame Review ist fachlich abgeschlossen. Die folgenden Entscheidungen sind in die Regeln eingearbeitet. Technischer Preflight und spätere manuelle Abnahmen bleiben eigene Nachweise; der nächste Schritt benötigt einen gesonderten Implementierungsauftrag.

| ID | Entscheidung | Status am 07.09.2026 |
|---|---|---|
| D1 | Gültige Waffenwirkung darf nach Erzeugertod belohnen; nach Disconnect nur mit vollständiger Herkunft und Wertbasis. | Vom Nutzer bestätigt; § 6.4 |
| D2 | Merge gegen festen räumlichen Anker, mit Hindernisprüfung und ohne Kettenwanderung. | Vom Nutzer bestätigt; § 8.3 |
| D3 | Bestätigte Ressource sofort übernehmen; verspäteten Flug verkürzen oder überspringen. | Vom Nutzer bestätigt; § 13.9 |
| D4 | Ohne tatsächlichen HP-/Rüstungsverlust keine Essenz; wirkungslose Legacy-Zahlungen entfallen. | Vom Nutzer bestätigt; § 5.3 |
| D5 | Allgemeinen Gain-Multiplikator bei Aktivierung/Reflection einfrieren; Übernahme ersetzt die Basis. | Vom Nutzer bestätigt; § 5.7 |
| D6 | Kein komplexer Sonderpfad für unerwartet fehlenden Bodenpunkt. Begrenzter Fallback, danach diagnostizierter Platzierungsfehler ohne Retry. | Nutzerentscheidung für einfache Fehlerbehandlung; konkretisiert in § 7.3 |

Bereits im Ausgangskonzept festgelegt sind:

- Erzeugungsumfang;
- Modi und Zugriffsgruppen;
- volle Erzeuger;
- Bruchteile;
- Ausstoß, Landung und Lebensdauer;
- Merge;
- Magnetradius und LoS;
- parallele Transfers;
- Arrival-Commit;
- Abbruch und Rückgabe;
- Ablauf im Flug;
- Visualstil;
- HUD ohne Audio;
- nachgelagertes Balancing.

### 22.2 Technische Entscheidungen des Plans

Der Implementierungsplan entscheidet unter Einhaltung dieses GDD:

- exakte Form und Name des post-commit Reward-Vertrags;
- Cutover-Reihenfolge der heutigen Gain-Pfade;
- Resource-Port-Erweiterung;
- Cluster-/Expiry-Bucketing und räumlicher Index;
- Transfer-Identity und Host-Tick;
- Wire-Schema, Delta-/Full-Intervall und Relevanzfilterung;
- konkrete GPU-Lane- beziehungsweise Rendererstrategie;
- HUD-Hook-Schnittstelle;
- fünfphasige Cutover-/Integrationsreihenfolge;
- eigenes Visual-Polish-Gate vor dem finalen Hardening;
- Testphasen, Architecture-Gates und Performancebudgets.

### 22.3 Pflicht-Preflight vor Implementierung

Vor dem ersten Produktions-Cutover, nach gesondertem Implementierungsauftrag:

1. verwendeten Checkout einschließlich Arbeitsbaum gegen den dokumentierten Reviewstand vergleichen und § 22.1 abschließen;
2. erneute manuelle Combat-Abnahme `M` prüfen beziehungsweise abschließen;
3. alle primärtrefferbezogenen direkten Gain-Stellen inventarisieren;
4. aktuelle Weapon-/Balance-Lab-Baselines sichern;
5. aktuelle Performance- und Netzwerkbaseline aufnehmen;
6. sicherstellen, dass genau eine Activity den Essenz-State besitzt und Activity-Detach sowie World-Teardown ihn vollständig und idempotent zerstören.

Ein Delta-Review darf Integrationsnamen und technische Schnitte aktualisieren. Die fachlichen Entscheidungen dieses GDD werden nur bei einer ausdrücklich dokumentierten echten Gameplayverbesserung geändert.

---

## 23. Zielerfahrung

Der Spieler trifft einen Gegner. Cyanfarbene Flüssigkeitsenergie spritzt aus dem Treffer, fällt schnell auf den Boden und sammelt sich zu kleinen leuchtenden Perlen. Wer nah genug steht und freie Sicht besitzt, zieht die Essenz magnetisch an. Sie beschleunigt sichtbar zum Spieler, der Adrenalinring schimmert erwartungsvoll und füllt sich erst bei der tatsächlichen Ankunft mit einem klaren Burst.

Fernkampf bleibt sicher und wirksam, aber die Belohnung liegt dort, wo der Kampf stattfindet. Coop-Spieler teilen den Wert räumlich, Teams behalten ihre eigene Essenz und Deathmatch-Spieler sehen nur ihre persönliche Beute. Große Mengen wirken reichhaltig und flüssig, ohne Gameplay, Netzwerk oder Framerate mit einem Objekt pro Tropfen zu belasten.

> **Treffer werden sichtbar wertvoll, Nähe wird zu einer bewussten Entscheidung und Adrenalin entsteht als Teil des Kampfgeschehens statt als unsichtbare Zahl.**
