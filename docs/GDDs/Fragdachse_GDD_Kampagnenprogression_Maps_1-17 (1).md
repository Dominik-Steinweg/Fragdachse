# Fragdachse – GDD Kampagnenprogression Maps 1–17

**Status:** Funktional vorbereitet am 12.09.2026; manuelles Solo-/Koop-Playtesting und Balancing stehen aus.
**Ziel:** Kampagnenprogression abwechslungsreicher, klarer und belohnender strukturieren, ohne unnötig neue technische Systeme einzuführen.  
**Umsetzung:** Primär durch Anpassung bestehender Map-Konfigurationen, Objectives, Gegner-Spawns, Rewards und vorhandener Hazard-/Persistent-Base-Strukturen.  
**Nachgelagert:** Manuelles Balancing und Finetuning nach funktionaler Umsetzung.

---

## 1. Designziel

Jede Kampagnenmap soll mindestens eine klar erkennbare eigene Rolle besitzen, z. B.:

- Einführung eines neuen Gegners
- neue Missions- oder Side-Mission-Struktur
- neue Map-Mechanik
- besondere langfristige Belohnung
- bewusst inszenierte Schwierigkeitsspitze

Nicht jede Map benötigt einen permanenten Unlock. Reine Zahlensteigerung bei Gegnerzahl/HP gilt **nicht** als ausreichende eigene Identität.

---

## 2. Ausgangslage vor dem Umbau

| Map | Name | Aktuelle Hauptrolle / Besonderheit | Aktuelle Belohnung / Progression |
|---|---|---|---|
| 1 | Feuertaufe | Advance-/Tutorial-Map, Zombie + Rabid, mehrere Tutorial-Checkpoints, Hold-Abschnitt | Persistent Base wird freigeschaltet |
| 2 | Zweite Front | Repel Assault, mehrere Fronten, Einführung Demon Badger | – |
| 3 | Rastlos | Repel Assault, dichterer Druck, Zombie/Demon/Rabid | – |
| 4 | Adrenalinrausch | Repel Assault, Power-Ups vorhanden, Adrenalin-/Health-Infrastruktur | Adrenalin-Podest |
| 5 | Grufttitan | Bossmap gegen Grave Titan | Klassen-Meilenstein um Map 5 |
| 6 | Sporenfront | Repel Assault, Einführung Spore Warden | Sporenturm |
| 7 | Medic | Repel Assault, Einführung Plague Medic | Health-Podest |
| 8 | Dimensionsbruch | Repel Assault, Void Stalker, Hold-Side-Mission mit beschädigten Vorposten | Raketenturm aktuell als normaler Victory-Reward |
| 9 | Überleben | Survival 120 s, limitierte Respawns, Einführung Stink Broodmother | – |
| 10 | Flammenkoloss | Bossmap gegen Inferno Colossus | Persistent-Base-Progressionsstufe |
| 11 | Bombergeschwader | Repel Assault, Airstrike-Mechanik | – |
| 12 | Gegenschlag | Destroy Hostile Bases, Alien Badger, Hold-Side-Mission | Holy-Hand-Grenade-Podest |
| 13 | Brutbomben | Destroy Hostile Bases, zerstörbare Spawnstrukturen, Thrower Badger | XP-Side-Mission-Reward |
| 14 | Brandschneise | Survival 120 s, Pyro Badger, Void-Fire aktuell primär als Gleisersatz/Hazard | – |
| 15 | Leerenjäger | Bossmap gegen Void Hunter, dynamische Void-Hazards | Item-System wird freigeschaltet |
| 16 | Zeitzünder | Repel Assault, Timebomb Badger, Void-Hazards, Spawnstrukturen, Hold-Side-Mission | – |
| 17 | Bierrettung | Destroy Hostile Bases + Carry-Side-Mission | Item-Meta-Reward + temporärer Team-Buff |

---

## 3. Ziel-Stand

| Map | Zielrolle | Zentrale Besonderheit | Reward / Progression |
|---|---|---|---|
| 1 | Tutorial / Advance | **Nur Zombie Badger**; Fokus vollständig auf Grundmechaniken | Persistent Base Unlock |
| 2 | Erste echte Defense | Demon Badger + Mehrfronten-Angriffe | – |
| 3 | Erste Schwierigkeitsspitze | **Einführung Rabid Badger**; deutlich aggressiverer Kampfdruck | – |
| 4 | Power-Up-Einführung | Power-Ups bewusst und sichtbar inszenieren statt nur vorhanden sein lassen | Adrenalin-Podest |
| 5 | Erster Boss-Meilenstein | Grave Titan | Klassen-Meilenstein |
| 6 | Sporen-Verteidigung | Spore Warden + **mehrere kleine freundliche Sporenturm-Vorposten** | Sporenturm |
| 7 | Advance / Ressourcenmanagement | **Advance-Map**, Plague Medic, viele HP-Podeste, **0 normale Respawns** | Health-Podest |
| 8 | Hold + Rocket Defense | Void Stalker, Vorposten hauptsächlich mit **Raketentürmen** verteidigen | **Raketenturm als Side-Mission-Reward** |
| 9 | Survival | Gegnerdruck über 120 s, Broodmother | – |
| 10 | Boss + Base-Meilenstein | Inferno Colossus | Persistent-Base-Progressionsstufe |
| 11 | Airstrike-Eskalation | Airstrikes als zentrale Map-Mechanik | **Persistent-Base-Radius 5 → 6 nach Sieg** |
| 12 | Offensive Basiszerstörung | Hostile Bases, Alien Badger, Hold-Side-Mission | Holy-Hand-Grenade-Podest |
| 13 | Produktionsnetz zerstören | Spawnstrukturen/Brutstätten aktiv ausschalten, Thrower Badger | XP-Side-Mission-Reward |
| 14 | Environmental Survival | Pyro Badger + **Void-Fire breitet sich von links nach rechts aus und verkleinert die Arena** | – |
| 15 | Boss + Meta-System | Void Hunter, eskalierende Void-Hazards | Item-System Unlock |
| 16 | Advance / Hinterhalte | **Advance-Map** mit vielen **Timebomb-Badger-Hinterhalten** | – |
| 17 | Carry-Finale | Bier transportieren unter Feinddruck | Item-Meta-Reward + Team-Buff |

---

## 4. Erforderliche Änderungen

### Map 1 – Feuertaufe
- Rabid und die ebenfalls vorhandenen Demon Badger durch Zombies ersetzen.
- Nur Zombie Badger als Gegner verwenden.
- Tutorial-, Advance-, Zug-, Hold- und Persistent-Base-Preview-Strukturen beibehalten.
- Ziel: maximale Lesbarkeit und minimale kognitive Last während des Tutorials.

### Map 3 – Rastlos
- Rabid Badger hier erstmalig in der Kampagne einführen.
- Erste Rabid-Begegnung bewusst inszenieren und nicht nur unauffällig in eine Spawn-Tabelle mischen.
- Schwierigkeit gegenüber Map 2 spürbar erhöhen.
- Keine zusätzliche große Mechanik nötig: **Rabid + erster echter Difficulty Spike sind die Identität.**

### Map 4 – Adrenalinrausch
- Vorhandene Power-Ups stärker zum Missionskern machen.
- Spawn-/Encounter-Timing so anpassen, dass Power-Ups sichtbar nützlich werden.
- Spieler möglichst natürlich in Situationen führen, in denen BFG/andere Power-Ups direkt erfahrbaren Mehrwert haben.
- Bestehenden Adrenalin-Podest-Reward beibehalten.

### Map 6 – Sporenfront
- Rund um die Basis mehrere kleine freundliche Vorposten ergänzen.
- Vorposten primär mit Sporentürmen ausstatten.
- Ziel: Spieler erleben Sporentürme **vor** ihrem Persistent-Base-Unlock aktiv im Einsatz.
- Bestehenden Sporenturm-Reward beibehalten.

### Map 7 – Medic
- Primärziel von Repel Assault auf **Advance** umbauen.
- Route mit mehreren Gesundheits-/Versorgungspunkten strukturieren.
- Relativ viele HP-Podeste entlang der Route verteilen.
- Normale Respawns auf **0** setzen.
- Plague Medic als zentralen Gegner der Map beibehalten.
- Vier Kampf-/Versorgungsabschnitte von der rechten persistenten Basis nach Westen, danach Extraktion.
- Keine zusätzliche Checkpoint-Wiederbelebung. Die Checkpoints dieser Map setzen keinen Respawnpunkt.

### Map 8 – Dimensionsbruch
- Beschädigte Vorposten stärker auf Raketentürme ausrichten.
- Raketenturm-Unlock aus dem normalen Victory-Reward entfernen.
- Raketenturm als Reward der bestehenden Hold-Side-Mission vergeben.
- Hauptmission muss weiterhin gewinnbar bleiben, wenn die Side Mission scheitert.
- Dadurch erhält die Side Mission einen echten langfristigen Wert.

### Map 11 – Bombergeschwader
- Bestehende Airstrike-Struktur beibehalten.
- Nach erfolgreichem Abschluss neuen Persistent-Base-Progressionsreward vergeben:
  - **Build-/Base-Radius von 5 auf 6 erhöhen**
- Unlock persistent speichern und im Base-System korrekt berücksichtigen.
- Sieg-/Unlock-Kommunikation im UI vorsehen.

### Map 14 – Brandschneise
- Aktuelles Void-Fire als bloßen Gleisersatz zurückbauen/ersetzen.
- Neue zentrale Hazard-Dramaturgie:
  - Void-Fire startet links.
  - Feuerfront breitet sich im Verlauf der Survival-Zeit nach rechts aus.
  - Nutzbare Kampffläche wird dauerhaft kleiner.
- Ausbreitung klar telegraphieren.
- Finale Restfläche muss für Koop und mobile Pyro Badgers ausreichend groß bleiben.
- Pyro Badger bleibt der zentrale neue Gegner.
- Zielunterscheidung:
  - Map 9 = Gegnerdruck überleben
  - Map 14 = Gegnerdruck + schrumpfende Arena überleben

### Map 16 – Zeitzünder
- Primärziel von Repel Assault auf **Advance** umbauen.
- Lineare bzw. segmentierte Route mit bewusst gesetzten Timebomb-Hinterhalten.
- Timebomb Badger als Kern der Encounter-Komposition.
- Fünf checkpointgesteuerte Hinterhalte von der rechten Basis nach Westen, danach Extraktion. Seitliche Spawnflächen, in späteren Abschnitten auch Angriffe von hinten.
- Alte Dauerproduktion, Hold-Mission und flächige Turmverteidigung entfallen; zwei kleine seitliche Void-Gefahren bleiben.
- Startwert: zwei normale Respawns je Spieler. Checkpoints verlegen den Respawnpunkt und gewähren keine zusätzlichen Leben.
- Ziel: „durch ein gefährliches Gebiet vorrücken, in dem jederzeit Timebomb-Hinterhalte ausgelöst werden können“.

---

## 5. Neue bzw. angepasste Mechaniken

### 5.1 Persistent-Base-Radius-Upgrade
**Trigger:** Sieg auf Map 11  
**Effekt:** Radius 5 → 6  
**Anforderungen:**
- persistent gespeichert
- rückwärtskompatibel mit bestehenden Saves
- Build-Area verwendet den freigeschalteten Radius
- Unlock nur einmalig
- UI-Kommunikation nach Sieg bzw. beim nächsten Base-Besuch
- Stufe 0 bleibt die anfängliche Fläche, Sieg auf Map 10 gewährt Stufe 1 (Radius 5), Sieg auf Map 11 Stufe 2 (Radius 6). Derselbe Resolver gilt für Speicherung, World-Parameter, Platzierung und Anzeige. Im Koop bestimmt die Host-World die Fläche.
- Keine zusätzliche Altsave-Migration und keine rückwirkende Freischaltung aus dem Mapfortschritt.

### 5.2 Side-Mission-basierter Konstrukt-Unlock
**Map 8:** Rocket Turret  
**Prinzip:** Konstrukte können über optionale Missionsziele dauerhaft freigeschaltet werden.

Wenn bestehende Reward-Strukturen bereits `persistentBaseRewardsOnComplete` unterstützen, **kein neues generisches Reward-System bauen**.

Erfolgreicher Hold-Abschluss gewährt den Unlock unmittelbar und idempotent. Er bleibt auch bei einer späteren Niederlage der Hauptmission erhalten. Ein Hold-Fehlschlag gewährt ihn nicht und beendet die Hauptmission nicht.

### 5.3 Schrumpfende Void-Fire-Zone
**Map 14**
- Hazard-Front bewegt sich von links nach rechts.
- Bereits verlorene Fläche bleibt gefährlich.
- Hazard soll möglichst bestehende Ground-Hazard-/Void-Fire-Systeme wiederverwenden.
- Startwerte: Ankündigung bei Sekunde 15, Zündung ab Sekunde 20, Ausbreitung über 90 Sekunden bis Sekunde 110. Survival endet weiter bei 120 Sekunden.
- Maximales Zielrechteck: linke 36 × 42 Zellen. Die rechten 24 Spalten bleiben frei, einschließlich persistenter Basis und Radius-6-Baubereich. Ein durchgehender Rückzugsweg verbindet die linke Kampfzone mit dem rechten Endbereich.
- `spread` ergänzt den Ground-Hazard-Vertrag: Richtung `left-to-right`, Ausbreitungsdauer, Konturunregelmäßigkeit und lokale Vorwarnzeit. Ausgangswerte: zwei Zellen Unregelmäßigkeit, drei Sekunden Warnsaum.
- World-Seed und Event-ID erzeugen einmalig eine geglättete Zündreihenfolge. Benachbarte Reihen rücken versetzt vor; die Kontur bleibt verbunden und bewegt sich ausschließlich vorwärts. Hindernisse blockieren weiterhin reale Feuerzellen; erreichte blockierte Zellen werden nach Freigabe nachgezündet.
- Nur der Host zündet und simuliert Schaden. Aktive Feuerzellen und der schmale Warnsaum werden für Clients und Late Join repliziert. Zukünftige, noch nicht angekündigte Zellen bleiben für Spawn und Bauen nutzbar.
- Ausbreitung ist nur für permanente rechteckige Void-Hazards vorgesehen; endliche und nichtrechteckige Hazards behalten ihre bisherige Logik.


### 5.4 Advance-Encounter mit Hinterhalten
**Map 16**
- Bestehende Advance-/Checkpoint-/Trigger-Strukturen wiederverwenden.
- Hinterhalte über vorhandene Encounter-Trigger oder räumliche Aktivierung realisieren.
- Kein neues universelles Encounter-Framework entwickeln, sofern bestehende Systeme aus Map 1/anderen Advance-Strukturen ausreichen.
- Maps 7 und 16 verwenden durchgehende Encounter-Barrieren zwischen den Abschnitten. Die finale Sperre öffnet nach Auflösung des letzten Encounters; erst dann ist die Extraktion erreichbar. Map-Abmessungen bleiben erhalten.

### 5.5 Allgemeiner Void-Fire-Basisbrand

- Jeder Kontakt von Void-Fire mit einer tatsächlichen, schadensfähigen Basiszelle entzündet die Basis. Konkave Aussparungen zählen nicht zur Basis. Normales Feuer erhält diesen zusätzlichen Status nicht.
- Startwerte: **200 HP pro Sekunde**, **vier Sekunden Nachbrennen** ab letztem zulässigen Kontakt. Mehrere Zellen oder Quellen stapeln den Schaden nicht; weiterer Kontakt erneuert die Laufzeit.
- Map-Hazards können freundliche und feindliche Basen entzünden. Spieler- und Gegnerquellen beachten die vorhandenen Fraktionsregeln. Explizit positive Hazard-Abstände zu Basen bleiben wirksam.
- Void-Fire darf Basisflächen erreichen. Felsen, Bäume und andere Hindernisse behalten ihre bestehende Blockadewirkung.
- Ein Activity-gebundener Owner verwaltet Kontakt und Brandticks. Schaden läuft über `applyBaseStatusDamage`, einschließlich Schutz, Verwundbarkeit und regulärer Zerstörungsfolgen.
- Host und Clients zeigen das Nachbrennen über vorhandene Void-Flammen und `SyncedBaseState.voidBurning`. Erlöschen, Zerstörung, Activity-Ende und Retry räumen den Status und seine Darstellung auf. HP und Brandstatus gehören nicht in Blueprints.
- Basisbrandparameter liegen zentral in `src/config/baseVoidFire.ts`, unabhängig von Map 14 und vom Spielerbrand.

Konfigurationsstellen, Ausgangswerte und Playtest-Fragen: [Tuning-Übersicht](Kampagnenprogression_Maps_1-17_Tuning.md).

---

## 6. Implementierungsplan

### Phase A – Daten-/Konfigurationsänderungen
**Niedriger Aufwand**
1. Map 1 Gegnerpool reduzieren.
2. Map 3 Rabid-Einführung und Encounter-Tuning.
3. Map 4 Power-Up-Platzierung und Encounter-Timing.
4. Map 6 kleine Sporenturm-Vorposten ergänzen.
5. Map 8 Raketenturm-Reward auf Side Mission verschieben.
6. Map 11 neuen Base-Radius-Reward anbinden.

### Phase B – Missionsumbauten
**Niedrig bis mittel**
1. Map 7 auf bestehende Advance-Struktur migrieren.
2. Route, HP-Podeste und 0-Respawn-Regel konfigurieren.
3. Map 16 auf Advance-Struktur migrieren.
4. Timebomb-Hinterhalte und Encounter-Abfolge definieren.
5. Alte Map-16-Elemente entfernen/reduzieren, wenn sie dem neuen Flow widersprechen.

### Phase C – Map-14-Hazard
**Mittel**
1. Vorhandenes Void-Fire-/Ground-Hazard-System prüfen und wiederverwenden.
2. Fortschreitende linke Hazard-Grenze konfigurieren bzw. minimal erweitern.
3. Telegraphing ergänzen.
4. Mehrere Ausbreitungsphasen an die 120-s-Survival-Dauer koppeln oder einen Zeitraum definieren in dem es sich kontinuierlich ausbreitet.
5. Multiplayer-Synchronität und Damage-Verhalten testen.

### Phase D – Progression & Persistenz
**Niedrig bis mittel**
1. Map-11-Radius-Unlock persistent speichern.
2. Radius-Auflösung in Persistent Base anbinden.
3. Unlock-Kommunikation prüfen.
4. Map-8-Side-Mission-Reward auf einmalige permanente Freischaltung testen.

### Phase E – Funktionaler Test
- Solo und Koop.
- Sieg/Niederlage/Retry.
- Side-Mission Erfolg und Fehlschlag.
- Host/Client-Synchronität.
- Persistenz nach Reload.
- Bereits freigeschaltete Alt-Saves.
- Map-Unlock-Folge weiterhin korrekt.

### Phase F – Manuelles Balancing / Finetuning
Nach funktionaler Fertigstellung bewusst **nicht** durch umfangreiche automatische Umbauten ersetzen.

Manuell abstimmen:
- Gegneranzahl und Spawnintervalle
- Rabid-Difficulty-Spike auf Map 3
- Nutzen und Timing der Power-Ups auf Map 4
- Stärke/Anzahl der Sporenturm-Vorposten auf Map 6
- Anzahl/Abstand der HP-Podeste auf Map 7
- Schwierigkeit der Map-8-Side-Mission
- Airstrike-Druck auf Map 11
- Geschwindigkeit und Restfläche des Void-Fire auf Map 14
- Anzahl, Richtung und Timing der Timebomb-Hinterhalte auf Map 16

---

## 7. Nicht-Ziele

- Kein vollständiges Refactoring des Kampagnensystems.
- Kein neues generisches Missionsframework.
- Kein neues universelles Reward-System, wenn bestehende Persistent-Base-Rewards ausreichen.
- Keine umfangreiche KI-/Gegnerlogik-Überarbeitung.
- Kein finales Balancing im Implementierungsschritt.
- Keine künstlichen permanenten Rewards für Maps, die bereits eine starke Gameplay-Identität besitzen.

---

## 8. Abnahmekriterien

Die Umsetzung gilt funktional als abgeschlossen, wenn:

1. jede Map 1–17 weiterhin start- und abschließbar ist;
2. die neue Gegnerprogression Map 1 → 3 korrekt ist;
3. Map 7 und Map 16 als Advance-Missionen funktionieren;
4. Map 8 den Raketenturm ausschließlich über die erfolgreiche Side Mission freischaltet;
5. Map 11 nach Sieg den Persistent-Base-Radius dauerhaft von 5 auf 6 erhöht;
6. Map 14 die nutzbare Arena während der Survival-Zeit nachvollziehbar von links nach rechts verkleinert;
7. bestehende Kampagnen-/Persistent-Base-Saves nicht beschädigt werden;
8. alle Änderungen im Koop host-/clientseitig konsistent funktionieren;
9. keine unnötigen neuen Architektur-Schichten eingeführt wurden.

---

## 9. Erwarteter Aufwand

Der Umbau sollte insgesamt **überschaubar** bleiben, da der Großteil auf vorhandenen Strukturen aufsetzt:

- Gegner- und Encounter-Konfiguration: gering
- Vorposten/Power-Ups/Rewards: gering
- Advance-Umbauten Map 7/16: gering bis mittel
- Persistent-Base-Radius-Unlock: gering bis mittel
- dynamische Void-Fire-Ausbreitung Map 14: mittel und wahrscheinlich technisch anspruchsvollster Einzelpunkt

Der Schwerpunkt liegt anschließend bewusst auf **manuellem Balancing und Playtesting**, nicht auf weiterer Systementwicklung.
