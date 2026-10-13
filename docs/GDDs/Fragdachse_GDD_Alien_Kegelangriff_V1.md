# Fragdachse – GDD: Alien-Kegelangriff

- **Version:** 1.0
- **Datum:** 12. Oktober 2026
- **Status:** Designentwurf; keine Implementierung
- **Spielmodus:** Coop Defense
- **Betroffener Gegner:** Alien-Dachs, bestehende ID `alien-badger`
- **Arbeitstitel des Angriffs:** Energie-Fächer
- **Vorgeschlagene Waffen-ID:** `ALIEN_BADGER_ENERGY_CONE` – noch nicht registriert

## 1. Ziel und Spielerlebnis

Der Alien-Dachs erhält einen angekündigten Energieangriff für mittlere Entfernung. Der Angriff trifft einmalig einen breiten Bereich vor ihm. Der Gegner bleibt dabei stehen. Seine vorhandene Plasmawaffe bleibt auf größere Entfernung sowie während des Kegel-Cooldowns nutzbar.

Der gewünschte Ablauf aus Spielersicht:

> Der Alien hält an und markiert einen breiten Energie-Fächer. Abhängig von meiner Entfernung verlasse ich ihn seitlich, nach hinten oder durch Bewegung an seiner Flanke vorbei. Nach dem Impuls kann ich den Bereich sofort wieder nutzen.

Das erweitert die Bewegungsentscheidungen bereits mit einfachen Waffen. Der Angriff erfordert keinen bestimmten Build und keine zusätzliche Fähigkeit des Spielers.

## 2. Vereinbarter Kern und Status der Details

Aus der gemeinsamen Planung festgelegt:

- Der bestehende Alien-Dachs erhält den neuen Angriff; keine zusätzliche Gegnerart.
- V-förmiger Flächenangriff mit Energie-Waffenoptik auf mittlere Entfernung.
- Klare Ankündigung vor dem Schaden.
- Der Alien steht während des Angriffs still.
- Einmaliger Schaden; keine länger betroffene Fläche und kein Schadensfeld.
- Eigener Cooldown.
- Plasma bleibt auf größere Entfernung und während des Kegel-Cooldowns verfügbar.

Arbeitsannahme dieses GDDs: Das V beschreibt einen **ausgefüllten Fächer/Kreissektor**, nicht nur zwei gefährliche Linien mit einer sicheren Mitte. Diese geometrische Präzisierung ist vor der Umsetzung zu bestätigen.

Die folgenden Prioritäts-, Geometrie- und Abbruchregeln sind Vorschläge für Version 1. Testwerte sind keine bereits bestätigte Balance.

## 3. Bestehender Alien-Dachs

Stand der Codeprüfung: 12. Oktober 2026. Laut [Gegnerdaten](../../src/config/coopDefenseEnemies.json):

| Eigenschaft | Aktueller Basiswert / Verhalten |
| --- | --- |
| Lebenspunkte | 180 |
| Laufgeschwindigkeit | 150 |
| Körpergröße | 30 |
| Bewegungsziel | Spieler |
| Fernwaffe | `ALIEN_BADGER_PLASMA`, Zielmodus `players` |
| Biss | `ALIEN_BADGER_BITE`, aktuell Zielmodus `structures` |
| Bevorzugter Kampfabstand | 256 Weltpixel, Toleranz 32 |
| Rückzugsgeschwindigkeit | Faktor 0,85 |
| Einbuddeln | Vorhanden, einschließlich eingegrabenem Spawn |

Der neue Angriff ergänzt diese Identität. Er ersetzt Plasma nicht und führt keine neue Nahkampfrolle ein. Besonders der bestehende bevorzugte Abstand muss mit dem Einsatzbereich des Kegels zusammenpassen.

## 4. Angriffsauswahl und Cooldowns

Die normale Gegner-Zielbindung bleibt maßgeblich. Der Angriff erzeugt keine zweite unabhängige Zielsuche.

| Situation | Gewünschtes Verhalten |
| --- | --- |
| Ziel in mittlerer Entfernung, Kegel bereit, klare Sicht, keine exklusive Aktion | Kegel vorbereiten |
| Ziel in mittlerer Entfernung, Kegel im Cooldown | Plasma gemäß dessen eigenem Cooldown und vorhandenen Ziel-/Sichtregeln einsetzen |
| Ziel auf größere Entfernung innerhalb der Plasmareichweite | Plasma einsetzen |
| Ziel außerhalb des Kegelbereichs | Reguläres Alien-Verhalten; nicht untätig auf einen Kegel warten |
| Kegel wird angekündigt oder ausgelöst | Keine zusätzlichen neuen Plasmaschüsse und keine gewöhnliche Laufbewegung |
| Kegel-Erholung | Kurze Aktionspause; danach Plasma wieder freigeben, auch wenn der Kegel-Cooldown noch läuft |
| Gegner eingegraben, gestunnt oder in anderer exklusiver Aktion | Kein neuer Kegelstart |

Vorschläge für eine eindeutige Ausführung:

- Der Kegel hat beim Start einer neuen Aktion Vorrang, wenn seine Bedingungen erfüllt sind. Er unterbricht keinen bereits ausgeführten Plasmaschuss rückwirkend.
- Bereits fliegende Plasmaprojektile bleiben unabhängig vom Kegel aktiv.
- Kegel- und Plasma-Cooldown sind getrennt. Die Kegelvorbereitung setzt den Plasma-Cooldown nicht zusätzlich zurück.
- Der Kegel-Cooldown beginnt mit dem Schadensimpuls und läuft während der Erholung weiter.
- Ein abgebrochener Vorlauf erhält eine kurze Wiederholungssperre; er darf nicht im nächsten Tick erneut starten.
- Reguläre Bewegung, Zielausrichtung und vorhandenes Rückzugsverhalten dürfen die angekündigte Pose nicht überschreiben.

„Plasma während des Cooldowns“ bedeutet normale verfügbare Folgeangriffe nach dem Kegelablauf, nicht gleichzeitiges Dauerfeuer während der Ankündigung.

## 5. Ablauf des Kegelangriffs

### 5.1 Startvoraussetzungen

Der Alien steht auf der Oberfläche, besitzt ein aktuell gültiges Ziel und hat freie Sichtlinie zu diesem Ziel. Es befindet sich im vorgesehenen mittleren Entfernungsbereich. Der Kegel ist bereit und keine andere exklusive Aktion beansprucht den Gegner.

Die Prüfung verwendet die tatsächliche World-Geometrie. Ein Gegner startet keinen Warnbereich durch eine Wand, nur weil sein Ziel geometrisch nahe liegt.

### 5.2 Ankündigung

Der Host erfasst Ursprung, Blickrichtung, Reichweite, Öffnungswinkel, Startzeit und Auslösezeit unter einer eindeutigen Angriffsidentität.

- Der Gegner bleibt stehen.
- Die Ausrichtung wird zu Beginn der sichtbaren Warnung festgelegt.
- Der gesamte gefährliche Bereich wird sichtbar, einschließlich Außenkante und Reichweitenende.
- Eine kurze Energieaufladung am Ursprung und ein anschwellender Sound kündigen den Impuls an.
- Der Alien bleibt normal angreifbar; die Vorbereitung gewährt weder Schild noch Unverwundbarkeit.
- Der Kegel folgt dem Spieler nicht nach. Ein Verlassen des Bereichs ist eine erfolgreiche Reaktion und beendet nicht automatisch die Attacke.

### 5.3 Impuls

Am angekündigten Zeitpunkt wird der Sektor genau einmal gegen die dann gültigen Zielpositionen und die aktuelle Deckung aufgelöst.

- Jedes berechtigte Ziel erhält höchstens einen Treffer pro Attacke.
- Es gibt keine zufälligen Lücken zwischen einzelnen Projektilen: Der ausgefüllte Sektor ist die Schadensform.
- Animationen dürfen Energie vom Ursprung nach außen zeigen, verändern aber nicht den einmaligen Trefferzeitpunkt.
- Keine nachlaufende Schadenswelle, keine Restfläche, kein zusätzlicher DoT, kein zusätzlicher Stun in Version 1.
- Keine vorgemerkten Treffer auf Spieler, die während der Warnung im Bereich standen, ihn aber vor der Auslösung verlassen haben.

### 5.4 Erholung

Der Energieeffekt klingt schnell ab. Der vormals markierte Bereich ist sofort wieder begehbar, ohne weitere Schadenswirkung dieses Angriffs. Der Alien bleibt für eine kurze Erholung stehen und kehrt dann zu Plasma und regulärer Gefechtspositionierung zurück.

## 6. Geometrie, Deckung und Ausweichmöglichkeiten

Die Grundform ist ein endlicher Kreissektor mit Ursprung am festgelegten Angriffsansatz des Alien-Dachses. Für einen Punkt gilt: Er ist im Sektor, wenn seine Entfernung höchstens der Reichweite entspricht und sein Winkel zur Angriffsrichtung höchstens dem halben Öffnungswinkel entspricht.

Die endgültige Trefferprüfung berücksichtigt die physische Zielgröße. Zielgröße und Warnrand dürfen keinen unsichtbaren zusätzlichen Schadensbereich erzeugen; die grafische Warnung muss diese Randfälle verständlich vermitteln.

Feste schussblockierende Deckung schützt vor dem Impuls. Vorschlag: Warnsektor an der blockierenden World-Geometrie begrenzen. Neu entstehende oder entfernte Deckung muss vor dem Impuls in der Darstellung aktualisiert werden; Ursprung und Richtung bleiben dabei unverändert. Gewöhnliche Figuren bilden keine verlässliche Deckung für andere Figuren.

Der Abstand soll die beste Reaktion beeinflussen:

- **Nahe am Ursprung:** seitlich an der Flanke vorbeiziehen; der Weg zur Seitenkante ist kurz.
- **Nahe am Reichweitenende:** nach hinten aus der Reichweite gehen.
- **Nahe einer Seitenkante:** kurzer seitlicher Weg, anschließend günstige Schussposition halten.
- **Hinter fester Deckung:** Schutz nutzen, sofern der Weg rechtzeitig erreichbar ist.

Öffnungswinkel, Reichweite und Vorwarnzeit müssen zusammen abgestimmt werden. Ein sehr schmaler Fächer wäre nur ein weiterer Seitenschritt. Ein zu breiter Fächer mit zu kurzer Warnzeit würde dagegen normale Spieler ohne Bewegungsupgrades zwangsläufig treffen.

Die Umsetzbarkeit ist mit den langsamsten regulären Spieler-Builds, realen Körperradien und Hindernissen zu prüfen. Ein Dash kann eine günstigere Anschlussposition ermöglichen, darf aber nicht jede normale Ausgangslage zwingend voraussetzen.

## 7. Unterbrechungen und Koop

Vorgeschlagene Regeln für Version 1:

| Ereignis | Verhalten |
| --- | --- |
| Tod vor dem Impuls | Angriff und Warnung enden; kein posthumer Impuls |
| Tod nach dem Impuls | Bereits bestätigter Schaden bleibt; keine erneute Auslösung |
| Expliziter Stun während der Ankündigung | Abbruch und kurze Wiederholungssperre |
| Gewöhnliches Trefferzucken | Kein Neustart oder automatischer Abbruch |
| Physische Verschiebung des Ursprungs durch Rückstoß | Abbruch statt still verschobenem Trefferbereich |
| Ziel verlässt den Kegel / wird ungültig | Festgelegter Angriff läuft weiter, sofern der Alien selbst weiter handeln darf |
| Einbuddeln | Während der Fähigkeit nicht beginnen; erzwungener Wechsel bricht die Vorbereitung ab |
| Activity-Ende / Entfernung | Vollständiges Aufräumen von Phase, Warnung, Timern und Replikationszustand |

Köder können gemäß den gemeinsamen Zielregeln die ursprüngliche Ausrichtung bestimmen. Nach Beginn der Warnung erfolgt keine Umlenkung zu einem anderen Spieler. Beim Impuls können mehrere berechtigte Ziele im Sektor getroffen werden; es bleibt bei einem Treffer pro Ziel.

Die neue Angriffsart muss vorhandene Schilde konsistent berücksichtigen. Welche bestehende Schadens-/Blockkategorie dafür verwendet wird, ist vor der Implementierung ausdrücklich festzulegen. Eine neue Energieoptik darf nicht stillschweigend sämtliche Schutzmechaniken umgehen.

## 8. Darstellung und Audio

Orthografische 90-Grad-Top-down-Darstellung. Der Effekt soll zum Alien und seinen Energiewaffen gehören, aber klar von kleinen Plasmaprojektilen zu unterscheiden sein.

- **Vorbereitung:** erkennbare Waffen-/Körperpose und lokales Energieladen.
- **Telegraph:** zwei klare Seitenkanten, sichtbares Reichweitenende und eine transparente Füllung. Helligkeitsentwicklung vermittelt die verbleibende Warnzeit.
- **Impuls:** kurzer, flächiger Energie-Fächer mit prägnantem Startsound; kein dichter Partikelvorhang.
- **Abklingen:** schnelle Auflösung, die das Ende der Gefahr eindeutig zeigt.

Die konkrete Palette folgt den aktuellen feindlichen Energieeffekten und den [visuellen Leitlinien](../ai/visual-guidelines.md). Sie muss im Wald auch über Helligkeit und Form lesbar sein. Ein rein farblicher Hinweis genügt nicht.

Audio macht Vorbereitung und Auslösung unterscheidbar. Kameraeffekte sind optional und klein; regelmäßige Kegelattacken sollen das Zielen nicht erschweren. Kein globaler Hitstop und keine Zeitlupe.

## 9. Tuning als Testhypothese

| Parameter | Vorläufiger Startpunkt / Ziel |
| --- | --- |
| Bereich für den Start | Etwa 120–280 Weltpixel Zielentfernung |
| Gesamter Öffnungswinkel | Etwa 70–90 Grad |
| Reichweite des Impulses | Etwa 320–360 Weltpixel |
| Ankündigung | Etwa 0,9–1,2 Sekunden |
| Erholung | Etwa 0,3–0,5 Sekunden |
| Eigener Cooldown | Etwa 4–6 Sekunden ab Impuls |
| Schaden und Abbruchsperre | Noch anhand des regulären Alien-Kampfes abstimmen |

Die Werte sind gemeinsame Testhypothesen. Der Einsatzbereich enthält bewusst den aktuellen bevorzugten Kampfabstand von 256 Weltpixeln. Der größere Wirkungsradius soll gerades Zurückweichen nicht in jeder Situation zur automatisch besten Antwort machen.

Akzeptanzkriterien für das Tuning:

- Im mittleren Kampfbereich tritt der Kegel regelmäßig auf.
- Während des Cooldowns bleibt der Alien durch Plasma aktiv.
- Je nach Entfernung sind verschiedene Ausweichrichtungen sinnvoll.
- Warnzeit und erreichbare sichere Fläche passen zusammen.
- Bei mehreren Aliens bleiben überlagerte Angriffe durch passende Begegnungsmenge und Staffelung bewältigbar.
- Starke Builds dürfen Angriffe durch frühe Kills verhindern; normale Startwaffen müssen das offene Fenster trotzdem sinnvoll nutzen können.

## 10. Technische Leitplanken und Quellen

Vorhandene Einstiegspunkte:

- [Gegnerkonfiguration](../../src/config/coopDefenseEnemies.json) und [Types / Normalisierung](../../src/config/coopDefenseEnemies.ts).
- [Energiewaffen-Konfiguration](../../src/loadout/content/data/weapons-plasma-energy.json).
- [Gegnerangriffssystem](../../src/systems/CoopDefenseEnemyAttackSystem.ts) für bestehende Waffenwahl und angekündigte Angriffe.
- [Gefechtspositionierung](../../src/systems/CoopDefenseEnemyCombatPositioningSystem.ts) für Abstand und Bewegung.
- [EnemyIntentSystem](../../src/systems/navigation/EnemyIntentSystem.ts) für die gemeinsame Zielbindung.
- [EnemyEntity](../../src/entities/EnemyEntity.ts) für Pose und Gegner-Lifecycle.

Der Host besitzt Angriffsidentität, eingefrorene Geometrie, Zeitpunkte, Cooldown und Trefferentscheidung. Die Darstellung liest diesen Zustand. Ein Client rekonstruiert weder Zielrichtung noch Trefferzeit aus eigener KI oder lokaler Wanduhr.

Eine exklusive Angriffsphase muss Navigation, Körperausrichtung und Plasmaausführung nachvollziehbar koordinieren. Vorhandene Angriffs- und Combat-Verträge sind zu erweitern, bevor ein paralleles Fähigkeitssystem geschaffen wird. Die Dokumente legen keine neue globale Architektur fest.

Relevante Verträge: [Architektur-Leitbild](../ai/architecture-principles.md), [Gameplay](../ai/gameplay.md), [Testing](../ai/testing.md).

## 11. Abnahme und spätere Verifikation

### Spielerlebnis

- Der Spieler erkennt die sichere Richtung ohne Zahlen oder erklärenden Text.
- Der Unterschied zum [Schild-Anstürmer](Fragdachse_GDD_Schild_Anstuermer_V1.md) ist deutlich: Der Alien bleibt stehen, die Gefahr betrifft einen breiten Sektor.
- Nach dem Impuls kann der Spieler sofort durch den bisherigen Warnbereich laufen.
- Plasma bleibt als Fernangriff und Cooldown-Füller erkennbar erhalten.
- Normale Waffen reichen aus, um während der Vorbereitung Schaden zu verursachen.

### Verhalten und Invarianten

- Plasma schießt im Kegel-Cooldown, sofern die gewöhnlichen Bedingungen erfüllt sind.
- Keine neuen Plasmaschüsse oder reguläre Rückzugsbewegung während der exklusiven Kegelphase.
- Richtung bleibt nach Beginn der Warnung unverändert, auch bei Zielwechseln.
- Deckung, Reichweite, Öffnungswinkel und Zielradien werden konsistent geprüft.
- Pro Angriffsidentität höchstens ein Impuls und pro Ziel höchstens ein Schaden, auch bei Frame-Sprüngen oder wiederholten Netzwerkzuständen.
- Ein vor dem Impuls getöteter oder entfernter Alien verursacht keinen späteren Kegelschaden.
- Ein Client, der einen laufenden Angriff erstmals sieht, zeigt die verbleibende Phase statt die gesamte Warnzeit neu zu starten.
- Zustandsabbau und Cooldowns verwenden die fachliche Simulationszeit und überleben keine neue Activity als Altlast.

Spätere Implementierungsprüfung gemäß Projekt-Testmatrix. Browserprüfung und konkrete Spieltests benötigen einen separaten Auftrag. Die vorliegenden Werte sind noch nicht visuell oder spielerisch verifiziert.

## 12. Noch offene Entscheidungen

- Bestätigung der ausgefüllten Sektorgeometrie gegenüber zwei V-Linien.
- Endgültige Bezeichnung, Waffen-ID, Palette und konkrete Animation.
- Schaden, Cooldown, Vorwarnzeit und Abbruchsperre nach Spieltests.
- Bestehende Combat-/Schildkategorie für den Energieimpuls.
- Technische Darstellung des an Deckung begrenzten Warnbereichs.
- Erste Einführungsbegegnung innerhalb der bestehenden Alien-Progression; keine pauschale Vorverlegung aller Alien-Vorkommen.

---

## 13. Umsetzungsstand V1.1 (13. Oktober 2026)

Dieser Nachtrag hält die Entscheidungen vom 13.10.2026 und den Umsetzungsstand fest. Bei Abweichungen zu V1 gilt dieser Nachtrag.

| Bereich | Status | Umsetzung |
| --- | --- | --- |
| Fächer und Ankündigung | umgesetzt | Ausgefüllter Fächer; rote Gefahrenfamilie der Nahkampfangriffe, an schussblockierender Deckung abgeschnitten. Der Host misst während der Ankündigung 16 Strahlen und aktualisiert sie alle 120 ms. Rote Keil-Fläche über `EnemyClawRenderer.syncSector`. |
| Treffer und Schild | umgesetzt | `WorldCombatCore.resolveConeImpulse`: Sichtlinie vom Ursprung, Schildprüfung und Köder über das Köder-System. Der Spieler-Energieschild blockt den Impuls; Richtung vom Ursprung des Aliens aus, Kategorie `tesla`. |
| Fraktionen | umgesetzt | Ziele sind die gegnerische Fraktion: feindliche Aliens treffen Spieler, Köder und verbündete Gegner; verbündete Aliens (Nekromantie) treffen feindliche Gegner und zeigen eine sehr dezente jadegrüne Ankündigung. |
| Ablauf und Replikation | umgesetzt | Activity-owned `CoopDefenseEnergyConeSystem`; replizierter Zustand `energyCone` als angehängtes Snapshot-Feld, Protokoll 30. Plasma bleibt außerhalb von Ankündigung und Erholung frei. Abbruch bei Stun, Einbuddeln, Spezialaktion, Verschiebung, Fraktionswechsel oder Tod. |
| Pose und Impuls | umgesetzt | Aufladepose ist die Ausholhälfte des `claw`-Clips. Void-lila GPU-Optik über `AlienConeGpuLayer`/`AlienConeShader`: Schönheit vor exakter Anzeige; die rote Ankündigung trägt den Schadensbereich. Impulsdauer 0,9 s, kein Restschaden. |
| Begegnungen | entschieden | Keine Staffelung gleichzeitiger Fächer. Einführung automatisch mit dem ersten Auftreten der Aliens auf Karte 12 über Persistent-Spawns. |
| Audio | Platzhalter | `sfx_alien_cone_charge` und `sfx_alien_cone_pulse`, ersetzbar. |

**Werte als Testhypothesen:** `src/config/coopDefenseEnemies.json` → `alien-badger.energyCone`: Startband 120–280 px, Öffnung 80°, Reichweite 340 px, Ankündigung 1000 ms, Erholung 400 ms, Cooldown 5 s ab Impuls, Abbruchsperre 1,2 s, Verschiebe-Abbruch 18 px, Schaden 30.

**Darstellung:** Beim Aufladen spiralförmig angesogene Partikel, Runenring und pulsierender Kern. Beim Impuls ein turbulentes Plasma-Band mit Nachhall-Ringen, Energieströmen, verzweigten Blitzen, Funken, Glut und ausfransenden Flanken.

**Offen:** Echte Sounds, Spieltest-Tuning und gegebenenfalls ein eigener Cast-Clip.
