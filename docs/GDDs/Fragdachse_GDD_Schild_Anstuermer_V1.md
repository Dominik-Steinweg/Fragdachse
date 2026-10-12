# Fragdachse – GDD: Schild-Anstürmer

- **Version:** 1.0
- **Datum:** 12. Oktober 2026
- **Status:** Designentwurf; keine Implementierung
- **Spielmodus:** Coop Defense
- **Arbeitstitel:** Schild-Anstürmer
- **Vorgeschlagene Gegner-ID:** `shield-charger-badger` – noch nicht registriert

## 1. Ziel und Spielerlebnis

Der Schild-Anstürmer soll bereits früh im Spiel die bislang oft ausreichenden Strategien „stehen bleiben und schießen“ beziehungsweise „rückwärts laufen und schießen“ aufbrechen. Er verbindet gerichteten Schutz mit einem angekündigten Positionswechsel und einer anschließenden Gelegenheit zum Gegenangriff.

Der gewünschte Ablauf aus Spielersicht:

> Ich sehe den geschützten Gegner, erkenne seine Vorbereitung, entscheide mich zwischen weiterem Beschuss und frühem Ausweichen, lasse ihn vorbeistürmen und nutze seine offene Flanke oder Rückseite.

Das funktioniert bereits mit Glock, P90 und HE-Granate. Bestimmte Upgrades, Spezialwaffen oder eine neue Eingabe sind keine Voraussetzung. Flankieren verursacht zunächst normalen Schaden; ein zusätzlicher Rückentreffer-Multiplikator ist nicht erforderlich.

## 2. Vereinbarter Kern und Status der Details

Aus der gemeinsamen Planung festgelegt:

- Neue Gegnerart mit sehr früher Einführung.
- Annäherung mit der bestehenden gerichteten Schutzschildwaffe.
- Relativ langsames Drehen als tatsächliche Spielregel.
- Ansturm bei ausreichender Nähe zum Spieler und freier Sichtlinie.
- Sichtbare Ankündigung mit gesenktem Schild; der Gegner ist dabei angreifbar.
- Geradliniger Ansturm ohne nachträgliches Nachlenken.
- Der Positionswechsel ermöglicht Angriffe von hinten oder von der Seite.
- Eine Erholungsphase macht den Gegenangriff praktisch nutzbar.

Die nachfolgenden Ablauf-, Kollisions- und Abbruchregeln sind konkrete Vorschläge für Version 1. Zahlen sind Startpunkte für spätere Spieltests, keine bereits bestätigte Balance. Offene Entscheidungen stehen in Abschnitt 11.

## 3. Rolle und Zielwahl

Der Anstürmer bindet die Aufmerksamkeit eines Spielers und verändert die Geometrie eines Gefechts. Er soll mit Basisangreifern und anderen Gegnern zusammenwirken, ohne selbst zugleich Fernkämpfer, Flächenkontrolleur und Belagerer zu werden.

- Primäres Bewegungsziel sind Spieler.
- Zielwahl erfolgt über die gemeinsame Gegner-Zielbindung; die Fähigkeit wählt nicht unabhängig ein anderes Opfer.
- Die Annäherung nutzt reguläre Navigation. Ein Ansturm ist keine Abkürzung durch Hindernisse.
- Vor der Ankündigung braucht der Gegner ein gültiges Ziel, passende Entfernung, freie Sichtlinie und eine grundsätzlich begehbare Startbahn.
- Die Körperausrichtung muss ausreichend auf die geplante Bahn zeigen. Es gibt keinen sofortigen Drehungssprung beim Angriffsbeginn.
- Nach einer vollständig abgeschlossenen Attacke darf die gewöhnliche Zielwahl wieder aktualisiert werden.

Köder sollen über die vorhandenen Zielregeln dieselbe Rolle übernehmen können. Ein bereits angekündigter Ansturm schwenkt nicht zum wieder sichtbaren Spieler um.

## 4. Verhaltensablauf

| Phase | Bewegung und Ausrichtung | Schild | Übergang |
| --- | --- | --- | --- |
| Annäherung | Reguläre Verfolgung, begrenzte Drehgeschwindigkeit | Aktiv | Ziel und Ansturmvoraussetzungen erfüllt |
| Ankündigung | Steht; Richtung und Bahn werden festgelegt | Inaktiv | Warnzeit endet oder Angriff wird abgebrochen |
| Ansturm | Schnelle Bewegung entlang der festgelegten Bahn | Inaktiv | Endpunkt, feste Kollision oder Abbruch |
| Erholung | Kurzer Stillstand; zunächst keine Neuausrichtung | Inaktiv | Erholungszeit endet |
| Neuorientierung / Cooldown | Langsames Drehen und erneute Annäherung | Wieder aktiv | Nächster Ansturm frühestens nach Cooldown |

### 4.1 Annäherung und Schild

Der Schild schützt ausschließlich den sichtbar abgedeckten Frontbereich. Angriffe aus nicht geschützten Winkeln nutzen die gewöhnliche Schadensauflösung. Der bestehende Schild hat einen Blockbogen von 120 Grad; dies ist ein sinnvoller Ausgangspunkt.

Wiederverwendet werden Schildmechanik, Blocksemantik und Darstellung. Spielerbezogene Adrenalinkosten, Schadensbuffs und Upgradepfade werden nicht automatisch zu Gegnerfähigkeiten. Der Gegner besitzt in Version 1 keinen zusätzlichen Schild-Lebensbalken und keine Schildbruchphase.

Körper, Schild und Angriffsrichtung folgen derselben autoritativen Drehbegrenzung. Reine visuelle Drehglättung würde Flankieren nicht zuverlässig ermöglichen.

### 4.2 Ankündigung

Mit Beginn der Ankündigung sinkt der Schild vollständig. Der Gegner hält an. Der Host erfasst Ursprung, Richtung, maximale Strecke und Startzeit als zusammengehörigen Angriff.

- Die Richtung ist ab Beginn des sichtbaren Telegraphen fest.
- Die Warnung zeigt einen gerichteten Korridor einschließlich des geplanten Endpunkts.
- Die Bahn reicht über die beim Start anvisierte Spielerposition hinaus, sofern die World-Geometrie es erlaubt.
- Der Gegner nimmt während der gesamten Ankündigung normalen Schaden.
- Gewöhnliche Treffer lösen keinen automatischen Ansturm-Abbruch aus. Angreifbarkeit und Unterbrechbarkeit bleiben getrennte Eigenschaften.

Es entsteht die Wahl zwischen frühem Ausweichen in eine gute Position und zusätzlichem Schaden im offenen Fenster.

### 4.3 Ansturm

Der Gegner bewegt sich entlang der angekündigten Geraden. Zielbewegung, Zielwechsel oder ein späterer Sichtlinienverlust ändern diese Gerade nicht.

Vorschlag für Version 1:

- Ein getroffener Spieler erhält pro Ansturm höchstens einmal Schaden und einen klar begrenzten Rückstoß.
- Spielerberührung beendet den Ansturm nicht; der Gegner soll vorbeistürmen können.
- Gewöhnliche Gegner blockieren den Speziallauf nicht dauerhaft. Nach dem Ansturm gelten wieder die normalen Abstands- und Kollisionsregeln.
- Feste, für den Gegner blockierende World-Geometrie stoppt den Lauf am ersten gültigen Kontakt. Kein Durchtunneln und kein Abbiegen entlang einer Wand.
- Der Ansturm richtet keinen zusätzlichen Umgebungsschaden an und betäubt nicht automatisch andere Gegner.
- Schäden an Spielern durchlaufen die bestehenden Combat-, Schild- und Zugehörigkeitsregeln.

Die sichtbare Bahn bezeichnet den Bewegungskorridor einschließlich der Körperbreite, nicht nur eine Linie zwischen zwei Mittelpunkten. Während der Ankündigung neu entstehende Hindernisse können den tatsächlichen Lauf verkürzen, niemals verlängern.

### 4.4 Erholung und Rückkehr

Nach dem Ansturm bleibt der Gegner kurz stehen. Der Schild ist unten und die Blickrichtung bleibt zunächst in Ansturmrichtung. Anschließend beginnt er langsam zu drehen und nimmt den Schild wieder hoch.

Diese Phase ist die Belohnung für erfolgreiches Ausweichen. Sie darf nicht durch sofortige Navigation, Zielwechsel oder einen parallel ausgeführten Angriff überschrieben werden. Der nächste Cooldown beginnt beim Start des Ansturms; Erholung und Cooldown sind getrennte Voraussetzungen für einen erneuten Einsatz.

## 5. Sonderfälle und Unterbrechungen

Vorgeschlagene Regeln für Version 1:

| Ereignis | Verhalten |
| --- | --- |
| Tod / Entfernung / Ende der Activity | Angriff und Schild sofort beenden; keine verzögerten Treffer hinterlassen |
| Expliziter Stun während Vorbereitung oder Lauf | Angriff abbrechen; danach Erholung und eine Wiederholungssperre |
| Gewöhnliches Trefferzucken | Nur Darstellung; kein Neustart der Warnzeit |
| Verlust des bisherigen Ziels nach Beginn der Ankündigung | Festgelegte Bahn wird weiter ausgeführt, ohne Ersatzzielfindung |
| Ziel buddelt sich ein | Lauf kann weitergehen; Trefferberechtigung folgt dem aktuellen Combat-Zustand |
| Physische Verschiebung während der Vorbereitung | Vorbereitung abbrechen, wenn Ursprung und Telegraph sonst nicht mehr stimmen |
| Rückstoß während des Ansturms | Keine unsichtbare seitliche Umlenkung; konkrete Resistenzregel vor Implementierung festlegen |
| Wandkontakt | Lauf endet, reguläre Erholung beginnt; keine zusätzliche Wall-Stun-Mechanik |

Abbruchspamming darf nicht zu sofort wiederholten Warnungen führen. Bestehende besondere Vorrangregeln, etwa für Zuggefahr, müssen bei der Integration explizit mit diesem Ablauf abgestimmt werden.

## 6. Darstellung, Audio und Lesbarkeit

Orthografische 90-Grad-Top-down-Darstellung. Die Silhouette und das Schild zeigen die Front auch bei normalem Kameraabstand klar.

- **Annäherung:** sichtbarer Schildbogen; geblockte Treffer unterscheiden sich von Körpertreffern.
- **Ankündigung:** Schild klappt sichtbar ab, Körper nimmt eine vorbereitende Pose ein, Warnkorridor und kurzer ansteigender Sound kündigen den Start an.
- **Ansturm:** knapper Bewegungsakzent, Bodenkontakt und gerichteter Vorbeirausch-Sound. Effekte lassen Körper und Kollisionsbahn erkennbar.
- **Erholung:** sichtbares Abbremsen und kurze erschöpfte Pose; keine gefährlich wirkende Warnfläche mehr.
- **Neuorientierung:** Schild richtet sich zusammen mit dem Körper aus; kein vorauslaufender unsichtbarer Schutz.

Der Telegraph visualisiert die vom Host festgelegte Bahn. Clients erzeugen keine eigene Zielvorhersage. Kameraeffekte bleiben klein und lokal relevant. Globale Zeitlupe, Hitstop und zusätzliche Combo-Anzeigen gehören nicht zum Umfang.

## 7. Tuning als Testhypothese

| Parameter | Vorläufiger Startpunkt / Ziel |
| --- | --- |
| Schildbogen | 120 Grad als bestehende Referenz |
| Drehgeschwindigkeit | Etwa 90–120 Grad pro Sekunde; 180-Grad-Wende muss sichtbar Zeit benötigen |
| Ankündigung | Etwa 0,65–0,9 Sekunden |
| Ansturmgeschwindigkeit | Etwa 700–900 Weltpixel pro Sekunde |
| Erholung | Etwa 0,6–0,9 Sekunden |
| Wiederholungssperre | Etwa 3–5 Sekunden ab Start des Laufs |
| HP, Lauftempo, Schaden, Auslösedistanz und Strecke | Gemeinsam mit frühen Begegnungen abstimmen; noch keine festgelegten Werte |

Diese Bereiche sind nicht beliebig kombinierbare Vorgaben. Insbesondere Auslösedistanz, Vorwarnzeit, Laufstrecke und Geschwindigkeit müssen zusammen geprüft werden:

- Gewöhnliches gerades Rückwärtslaufen darf den Angriff bei typischer Kampfentfernung nicht grundsätzlich unwirksam machen.
- Seitliches Ausweichen muss für einen Spieler ohne Bewegungsupgrades rechtzeitig möglich sein.
- Der Ansturm soll tatsächlich am ausgewichenen Spieler vorbeiführen.
- Eine lange Vorwarnzeit darf nicht durch eine unverhältnismäßig große Reichweite kompensiert werden.
- Upgrades dürfen Vorteile geben; der Grundangriff bleibt ohne sie bewältigbar.

## 8. Einführung und Begegnungen

Empfehlung: frühe Einführung in Karte 1 nach den grundlegenden Bewegungs- und Schussaktionen; exakte Begegnung noch festlegen.

1. Einzelner Anstürmer in einem übersichtlichen Bereich mit mindestens zwei Ausweichmöglichkeiten.
2. Anstürmer mit wenigen gewöhnlichen Gegnern: Ausweichen und Zielwahl verbinden.
3. Später Kombination mit Basisangreifern: Rückzug hat eine räumliche Konsequenz.
4. Erst nach dem Erlernen Kombination mit Alien-Kegelangriff oder mehreren Anstürmern.

Anfangs nur ein gleichzeitig aktiver Anstürmer in der unmittelbaren Begegnung. Größere Gruppen sollen über authored Mengen und zeitversetzte Ankunft lesbar bleiben; ein neuer globaler Angriffs-Director ist keine Voraussetzung.

## 9. Technische Leitplanken und geprüfter Bestand

Stand der Codeprüfung: 12. Oktober 2026.

- [Gegnerdaten](../../src/config/coopDefenseEnemies.json) und [Gegnertypen / Normalisierung](../../src/config/coopDefenseEnemies.ts) sind die Einstiegspunkte für authored Konfiguration.
- [EnergyShieldSystem](../../src/systems/EnergyShieldSystem.ts) implementiert den gerichteten Schild, liest den Besitzer beim Blocken derzeit aber aus dem PlayerManager. Wiederverwendung durch Gegner benötigt eine gezielte Erweiterung dieser Grenze.
- [Schild-Waffendaten](../../src/loadout/content/data/weapons-plasma-energy.json) enthalten `ENERGY_SHIELD` und seinen 120-Grad-Blockbogen.
- [EnemyEntity](../../src/entities/EnemyEntity.ts) unterscheidet Gameplay-Ausrichtung und visuelle Glättung. Langsames Drehen muss autoritativ wirken.
- [EnemyIntentSystem](../../src/systems/navigation/EnemyIntentSystem.ts), [Gegnerangriffe](../../src/systems/CoopDefenseEnemyAttackSystem.ts) und [Gefechtspositionierung](../../src/systems/CoopDefenseEnemyCombatPositioningSystem.ts) sind vor neuen Abstraktionen zu berücksichtigen.

Der Host entscheidet Phase, Zeitpunkte, Schildzustand, Richtung, Bewegung und Treffer. Replikation transportiert eine eindeutige Angriffsidentität und den bestätigten Zustand. Renderer zeigen ihn an. Laufende Spezialaktionen besitzen Gegner-/Activity-Lifetime und werden bei Tod, Entfernung und Teardown vollständig aufgeräumt. Pausen und Countdown verschieben keine Angriffsphasen über eine unabhängige Wanduhr.

Architekturgrundlagen: [Leitbild](../ai/architecture-principles.md), [Gameplay-Verträge](../ai/gameplay.md), [visuelle Leitlinien](../ai/visual-guidelines.md).

## 10. Abnahme und spätere Verifikation

### Spielerlebnis

- Mit Glock, P90 und HE gelingt die Begegnung ohne spezielle Gegenwaffe.
- Der Spieler erkennt Schildrichtung und Angriffsstart ohne Erklärung durch Text.
- Seitliches Ausweichen eröffnet einen real nutzbaren Gegenangriff.
- Ein Gegner dreht Schild und Körper nicht sofort zum flankierenden Spieler.
- Kiting außerhalb der Auslösedistanz macht ihn in den vorgesehenen Begegnungen nicht bedeutungslos.
- Die Kombination mit anderen Gegnern erzeugt unterschiedliche sinnvolle Ausweichrichtungen.

### Verhalten und Invarianten

- Pro Ziel höchstens ein Treffer je Ansturm, auch bei niedriger Framerate.
- Keine Treffer durch feste Geometrie und kein Überspringen dünner Hindernisse.
- Schild deaktiviert sich rechtzeitig; keine unsichtbare Restschutzzeit in der Ankündigung.
- Tod, Stun und Teardown hinterlassen weder aktive Schilde noch verspätete Angriffe.
- Köder und Mehrspieler-Zielwechsel ändern keine bereits angekündigte Bahn.
- Host und Client zeigen übereinstimmende Phasen; veraltete Zustände starten keinen neuen Telegraphen.

Für die spätere Implementierung passende bestehende Tests erweitern und Prüfungen nach [Testing-Router](../ai/testing.md) ausführen. Browserprüfungen bleiben separat zu beauftragen. Dieses GDD selbst ist kein Nachweis eines Spieltests.

## 11. Noch offene Entscheidungen

- Endgültiger Name, ID, Artwork und exakte frühe Einführungsbegegnung.
- HP, Schaden, Auslösedistanz, Ansturmstrecke und Wiederholungstakt.
- Rückstoßresistenz während der verbindlichen Ansturmphase.
- Verhalten bei länger nicht erreichbaren Spielern: vorhandenen Durchbruchsvertrag nutzen oder einen einfachen Hindernisangriff benötigen.
- Exakte Trefferkategorie des Ansturms für vorhandene Schutzschilde und Reaktionen; eine einheitliche Regel vor Implementierung festlegen.

## 12. Bezug zum zweiten GDD

Der [Alien-Kegelangriff](Fragdachse_GDD_Alien_Kegelangriff_V1.md) ergänzt diese Rolle: Der Anstürmer überquert den Raum und eröffnet eine Rückseite; der Alien bleibt stehen und bedroht einen breiten Bereich vor sich. Beide Angriffe sollen unterschiedliche Ausweichentscheidungen erzeugen.

---

## 13. V1.1 – Entscheidungen & Ist-Code-Abgleich (12.10.2026)

Dieser Nachtrag beantwortet die offenen Punkte aus Abschnitt 11 und hält den umgesetzten Stand fest. Wo er von V1 abweicht, gilt der Nachtrag. Zahlen sind Startwerte (`src/config/coopDefenseEnemies.json`, Eintrag `shield-charger-badger`).

### 13.1 Entscheidungen

| Thema | Entscheidung |
| --- | --- |
| ID / Asset | `shield-charger-badger`; Blender-Asset „Turmschild“ (Form v1: gebogenes Plankenband, von oben ~126°), Clips `move`, `claw`, `windup`, `charge`, `recover`. |
| Schild | Blockt wie der Spieler-Energieschild im 120°-Frontbogen: Projektile werden verschluckt, Hitscan endet am Schild, Nahkampf, Tesla/Ketten und Explosionen mit Zentrum im Bogen; Schaden über Zeit geht durch. Darstellung: das modellierte Requisit plus ein dünner warm-metallischer Rand, der bei Blocks aufblitzt (kein Void-Lila). |
| Trefferkategorie Ansturm | Nahkampf: ein Spieler-Energieschild in Ansturmrichtung blockt den Schaden, der Rückstoß wirkt trotzdem. |
| Rückstoß | Im Lauf immun (keine unsichtbare Umlenkung, kein Treffer-Taumeln); deutliche Verschiebung während der Ankündigung bricht ab (danach Wiederholungssperre). |
| Nekromantie | Ein verbündeter Anstürmer stürmt gegen feindliche Gegner, nie gegen Spieler; sein Korridor ist nur dezent sichtbar (keine Warnfunktion). |
| Unerreichbare Spieler | Kein eigener Hindernisangriff: reguläre Navigation und der vorhandene Durchbruch-/Biss-Vertrag gelten weiter. |
| Kampagne | Einführung auf Karte 4 (`04-adrenalinrausch`): einzeln nach 9 s in der Eröffnung, einer mit den Basisangreifern in `adrenaline-mass`, zwei zeitversetzt im Finale. |

### 13.2 Startwerte

Drehrate 105°/s (180° ≈ 1,7 s), Auslösedistanz 120–380 px bei höchstens 12° Fehlausrichtung (kein Drehsprung), Ankündigung 700 ms, Ansturm 880 px/s, Bahn bis Ziel + 480 px (max. 820 px, an Geometrie, Arenarand, Zug und Wasser gekürzt), Erholung 750 ms, Cooldown 4 s ab Laufstart, Sperre nach Abbruch 1,5 s, Ansturmschaden 15 + Rückstoß. HP 120, Biss wie Rabid. Ausgelegt so, dass gerades Rückwärtslaufen aus typischer Entfernung eingeholt wird, ein Seitenschritt von ~35 px aber reicht.

### 13.3 Ist-Code-Abgleich

| GDD | Status | Umsetzung |
| --- | --- | --- |
| §3 Zielwahl | umgesetzt | gemeinsame Zielbindung (`EnemyIntentSystem`), Köder über die Köder-Zielwahl; Bahn nach Ankündigung fix |
| §4.1 Schild, Drehung | umgesetzt | generischer Gegner-Frontschild-Port in allen Schadenspfaden; autoritative Drehrate `turnRateDegPerSec` (gilt für Körper, Schild und Angriffe; abgewandt nur langsame Fortbewegung) |
| §4.2 Ankündigung | umgesetzt | Host legt Ursprung, Richtung, Länge, Zeitpunkte fest; eigenes angehängtes Snapshot-Feld (Protokoll 29), Clients sagen nichts vorher |
| §4.3 Ansturm | umgesetzt | Swept-Capsule, höchstens ein Treffer je Ziel und Ansturm, kein Tunneln (Bahn vorab mit Körperbreite gekürzt; unbekanntes Hindernis beendet den Lauf früher) |
| §4.4 Erholung | umgesetzt | Schild unten, Blick bleibt, keine Warnfläche; Schild hebt sich am Ende |
| §5 Sonderfälle | umgesetzt | Tod/Entfernung/Teardown räumen auf; Stun/Verschiebung brechen ab; Biss-/Gegnerangriffe während aller Phasen gesperrt |
| §6 Darstellung | umgesetzt | GPU-Korridor in Körperbreite (Randlinien, Lade-Füllung, Pfeile, Endbalken), Tempo-Schlieren, Staub, Schleifspuren; Clips folgen der replizierten Zeitachse |
| §10 Verifikation | teilweise | Unit-, Integrations- und Stresstests; Browser-Bögen Tag/Nacht auf Karte 4. Host+Client-Test braucht den PeerJS-Broker. Spieltests stehen aus. |
