# Fragdachse – Persistente Basis
## Implementierungsplan Phase 3C – Campaign Integration & Progression Cleanup

**Status:** Ready for Implementation Planning  
**Zielgruppe:** Coding-KIs und Entwickler  
**Dokumenttyp:** Delta-orientierter Implementierungsplan  
**Voraussetzung:** Phase 3A und 3B sind abgeschlossen bzw. alle offenen 3B-Korrekturen sind vor Start von 3C integriert.

---

# 1. Ziel von Phase 3C

Phase 3C integriert die persistente Basis in den regulären Coop-Defense-Kampagnenfluss.

Nach Abschluss der Phase gilt:

- Map 1 führt narrativ zur zukünftigen Heimatbasis und schaltet sie nach Sieg frei.
- Ab Map 2 kann eine Map die persistente Basis explizit als ihre Main Base verwenden.
- Maps 2–8 verwenden sie.
- Map 9 verwendet sie ausdrücklich nicht.
- Maps 10–17 verwenden sie.
- Die persistente Basis ersetzt auf diesen Maps die bisherige authored Main Base vollständig.
- Persönliche persistente Konstruktionen werden in Kampagnenmissionen materialisiert und dürfen dort gebaut bzw. zurückgebaut werden.
- Sieg committed Änderungen.
- Niederlage oder Abbruch führt zum Rollback.
- Die Item-Progression wird auf Map 15–17 verschoben.
- Die technischen Persistent-Base-Testmaps 18 und 19 werden vollständig entfernt.

---

# 2. Zentrale Architekturregel

```text
Campaign Progress entscheidet:
    Ist die persistente Basis freigeschaltet?

World-/Map-Authoring entscheidet:
    Verwendet diese Map die persistente Basis?
    Wo steht sie?
    Wie ist sie orientiert?
```

Es darf keine globale Regel nach dem Muster:

```text
mapId >= 2 => persistentBase aktiv
```

entstehen.

Map 9 ist ein bewusster Gegenbeweis dafür.

Die bereits vorhandene `persistentBase`-Map-Konfiguration bleibt der explizite Opt-in-Mechanismus.

---

# 3. Fachlicher Scope

## 3.1 Map 1 – Unlock-Sonderfall

Map 1 verwendet die persistente Basis noch nicht als normale persistente Gameplay-Basis.

Der Ablauf ist:

1. Der bestehende Tutorial-Outpost bei Checkpoint 5 bleibt unverändert als Tutorial-/Missionsstruktur bestehen.
2. Der letzte Checkpoint `final-extraction` führt die Spieler zu einer zusätzlichen kanonischen Persistent Base.
3. Diese Basis stellt die zukünftige Heimatbasis dar.
4. Auf Map 1 werden dort keine gespeicherten persönlichen Konstruktionen materialisiert.
5. Auf Map 1 ist dort kein persistentes Bauen oder Rückbauen möglich.
6. Erst der erfolgreiche Missionsabschluss schaltet die persistente Basis dauerhaft frei.
7. Das bereits vorhandene Unlock-Feedback im ResultScreen wird weiterverwendet.
8. Ein Abbruch oder eine Niederlage darf keine Freischaltung erzeugen.

Der Map-1-Sonderfall darf nicht dazu führen, dass die normale Campaign-Integration mit Sonderbedingungen überladen wird.

Empfohlen ist ein klarer, kleiner Präsentations-/Unlock-Pfad für Map 1.

---

## 3.2 Kampagnenmaps mit Persistent Base

Folgende Maps verwenden die persistente Basis als Main Base:

- Map 2
- Map 3
- Map 4
- Map 5
- Map 6
- Map 7
- Map 8
- Map 10
- Map 11
- Map 12
- Map 13
- Map 14
- Map 15
- Map 16
- Map 17

Map 9 verwendet ausdrücklich keine persistente Basis.

Jede dieser Maps erhält eine explizite `persistentBase`-Konfiguration mit:

- Anchor
- optionaler Orientierung
- HP
- optionaler Build-Area-Konfiguration, sofern nötig

Die Position darf je Map frei gewählt bzw. an das Leveldesign angepasst werden.

---

# 4. Main-Base-Ersetzung

Auf einer Map mit aktiver Persistent Base ersetzt diese die bisherige authored Main Base vollständig.

Das bedeutet:

- bisherige Main-Base-Geometrie entfernen
- an diese Main Base gekoppelte Turrets entfernen
- an diese Main Base gekoppelte Power-up-Podeste entfernen
- keine Kompatibilitätsschicht zur alten Main Base bauen

Bewusste Folge:

Das bestehende Balancing darf sich verändern.

Eine spätere Balance-Runde ist vorgesehen und nicht Teil der technischen Kompatibilitätsanforderung von 3C.

---

## 4.1 Was erhalten bleibt

Folgende Inhalte sind eigenständiger Map-Content und werden nicht automatisch durch die Persistent Base ersetzt:

- Friendly Outposts
- Objective-Strukturen
- Spawn-Point-Strukturen
- hostile Bases
- Missionsstrukturen
- freistehende normale Map-Power-ups
- sonstige map-spezifische Strukturen, sofern sie nicht die ersetzte Main Base sind

Bei Maps mit mehreren Basen muss eindeutig nur die bisherige Main-/Heimatbasis ersetzt werden.

---

# 5. Basiskern und HP

Der kanonische Persistent-Base-Core bleibt unverändert.

Für 3C sollen alle Kampagnenmaps zunächst denselben `hpMax` für den Persistent-Base-Core verwenden.

Wichtig:

Die vorhandene technische Möglichkeit, pro Map einen abweichenden HP-Wert zu authoren, bleibt bestehen.

Es soll kein Refactor durchgeführt werden, der das Override entfernt.

Ziel ist lediglich:

```text
alle 3C-Maps verwenden zunächst denselben authored hpMax
```

Damit kann später getestet werden, ob ein global identischer HP-Wert ausreichend balancierbar ist.

---

# 6. Persistente Konstruktionen in Kampagnenmissionen

Ab Map 2 werden auf Maps mit Persistent Base die bestätigten persönlichen Beiträge der verbundenen Spieler materialisiert.

Während der Mission gelten die bereits vorgesehenen Persistent-Base-Regeln.

Erlaubt:

- neue persistente Konstruktionen bauen
- eigene persistente Konstruktionen zurückbauen
- Runtime-Zerstörung vorhandener persistenter Konstruktionen

Noch nicht erlaubt:

- bestehende persistente Konstruktionen verschieben

Repositioning ist Teil von Phase 3F.

---

# 7. Mission Working State, Commit und Rollback

Die bereits vorhandene Round-Outcome-Semantik wird verwendet.

Es soll kein zweiter Persistenzmechanismus für Campaign Maps entstehen.

## Sieg

```text
victory
    -> Working State committen
    -> nur noch lebende Runtime-Konstruktionen persistieren
```

Folgen:

- neu gebaute Konstruktionen bleiben dauerhaft
- zurückgebaute Konstruktionen bleiben entfernt
- im Kampf zerstörte persistente Konstruktionen bleiben nach Sieg zerstört

## Niederlage oder Abbruch

```text
defeat / host abort / technical abort
    -> rollback
```

Folgen:

- zuletzt bestätigter Stand bleibt erhalten
- neue Mission-Bauten werden verworfen
- Rückbauten werden verworfen
- im Kampf zerstörte persistente Konstruktionen werden nicht dauerhaft gelöscht

## Basiskern

HP und Beschädigung des Basiskerns sind ausschließlich Runtime-/Mission-State.

Sie sind niemals Teil des persistenten Base-Saves.

---

# 8. Item-Progression Cleanup

Der aktuelle Item-Unlock wird von Sieg Map 10 auf Sieg Map 15 verschoben.

## Neue Regeln

### Maps 10–14

- kein Item-Drop
- kein Item-Angebot nach Sieg

### Map 15

- Sieg schaltet das Item-System dauerhaft frei
- derselbe Sieg erzeugt direkt das erste Item-Angebot
- Item-Level: 1

### Map 16

- Item-Level: 1

### Map 17

- Item-Level: 2

Der Unlock und das erste Item-Angebot auf Map 15 gehören fachlich zusammen.

Es darf kein Zustand entstehen, in dem Map 15 gewonnen wurde, das Item-System freigeschaltet ist, aber das erste vorgesehene Angebot verloren geht.

---

# 9. Holy-Hand-Grenade auf Map 12

Die bestehende Holy-Hand-Grenade-Mechanik auf Map 12 bleibt in 3C unangetastet.

3C darf keine halbfertige persistente Reward-Variante einführen.

Die Umstellung auf:

- permanenten Base-owned Reward
- persistenten Placement-State
- Radialmenü-Integration

erfolgt erst in Phase 3D.

Falls die Main-Base-Ersetzung bestehende an die Main Base gekoppelte Podeste entfernt, ist zwischen diesen und der freistehenden/map-authored Holy-Hand-Grenade klar zu unterscheiden.

---

# 10. Maps 18 und 19 entfernen

Die technischen Persistent-Base-Testmaps:

- Map 18 / `foundation`
- Map 19 / `grundstein`

werden vollständig entfernt.

Scope:

- Map-Dateien löschen
- Registry-Einträge entfernen
- Tests aktualisieren oder entfernen
- Debug-/Dropdown-Referenzen entfernen
- Unlock-/Campaign-Order-Annahmen aktualisieren
- Dokumentations-/Audit-Referenzen bereinigen, sofern vorhanden

Die Maps werden nicht in einen internen Bereich verschoben.

---

# 11. Leveldesign-Scope

3C darf die betroffenen Maps so weit verändern, wie es für eine saubere Integration nötig ist.

Erlaubt sind insbesondere:

- Main Base verschieben oder ersetzen
- Persistent-Base-Anchor frei setzen
- Orientierung wählen
- Felsen verschieben oder entfernen
- Clearance herstellen
- Spawnräume anpassen
- Laufwege anpassen
- Missionsstrukturen verschieben
- Encounter oder Spawns anpassen, wenn die neue Basisposition dies erfordert
- Power-ups neu positionieren
- bestehende Main-Base-spezifische Balance entfernen

Nicht erforderlich:

- bisheriges Balancing künstlich konservieren
- exakte bisherige Verteidigungsgeometrie beibehalten
- Turrets oder Main-Base-Podeste als Übergangslösung retten

Die Maps sind noch nicht final und dürfen für das neue Zielbild angepasst werden.

---

# 12. Nicht Bestandteil von 3C

Explizit ausgeschlossen:

- Permanent Reward Framework
- persistentes Holy-Hand-Grenade-Podest
- weitere Base-owned Rewards
- größere Build Area / Radius-Progression
- Repositioning
- Radial Menu V2
- Cooldown-Anzeige im Radialmenü
- Nuke-Integration ins Radialmenü
- Structure Occupancy
- Wachturm
- Dachsbau

---

# 13. Implementierungsschritte

Die Phase wird in vier überschaubare Schritte geteilt.

---

## 3C-1 – Campaign Contract & Map-1-Unlock

### Ziel

Die Campaign-/World-Grenze und der Map-1-Sonderfall werden sauber festgelegt, bevor alle produktiven Maps umgebaut werden.

### Änderungen

- Persistent-Base-Unlock auf Sieg von Map 1 festlegen.
- Bestehendes ResultScreen-Unlock-Feedback weiterverwenden.
- Map 1 am `final-extraction` um den visuellen kanonischen Persistent-Base-Core ergänzen.
- Bestehenden Tutorial-Outpost bei Checkpoint 5 beibehalten.
- Map-1-Persistent-Base-Sonderfall:
  - keine Contribution-Materialisierung
  - kein persistentes Bauen
  - kein persistentes Rückbauen
- Sicherstellen, dass Niederlage/Abbruch keine Freischaltung erzeugt.
- Expliziten Map-Opt-in als einzige Quelle für normale Campaign-Persistent-Base-Nutzung beibehalten.
- Tests für Unlock und Map-1-Sonderfall ergänzen.

### Akzeptanzkriterien

- Neuer Spielstand startet ohne freigeschaltete Persistent Base.
- Map 1 zeigt am letzten Checkpoint den kanonischen Basiskern.
- Der Tutorial-Outpost funktioniert weiterhin.
- Gespeicherte Debug-/Alt-Contributions werden auf Map 1 nicht materialisiert.
- Spieler können dort nicht persistent bauen/rückbauen.
- Sieg Map 1 schaltet die Basis frei.
- Niederlage/Abbruch tut dies nicht.
- ResultScreen zeigt weiterhin das vorhandene Unlock-Feedback.

---

## 3C-2 – Productive Campaign Map Integration

### Ziel

Die produktiven Campaign Maps werden auf die Persistent Base umgestellt.

### Maps

Persistent Base aktiv:

- 2–8
- 10–17

Persistent Base inaktiv:

- 9

### Änderungen je aktiver Map

- bisherige Main Base identifizieren
- Main-Base-Geometrie entfernen
- Main-Base-Turrets entfernen
- Main-Base-Power-up-Podeste entfernen
- `persistentBase` explizit authoren
- geeigneten Anchor setzen
- Orientierung setzen, sofern nötig
- zunächst einheitlichen `hpMax` verwenden
- Clearance und Levelgeometrie anpassen
- relevante Spawn-/Encounter-/Objective-Positionen korrigieren

### Mehrbasis-Maps

Outposts, Objective Bases und hostile Bases bleiben erhalten.

Keine heuristische Erkennung zur Laufzeit.

Die Map-Konfiguration muss eindeutig ausdrücken, was Persistent Base und was übriger Map-Content ist.

### Akzeptanzkriterien

- Maps 2–8 und 10–17 starten mit der Persistent Base.
- Map 9 startet ohne Persistent Base.
- Keine dieser Entscheidungen wird aus der numerischen Map-ID abgeleitet.
- Die bisherige Main Base existiert auf den umgestellten Maps nicht parallel weiter.
- Deren Turrets und gekoppelte Podeste sind entfernt.
- Outposts/Objectives/hostile Bases funktionieren weiterhin.
- Alle aktiven Maps verwenden zunächst identische Persistent-Base-HP.
- Per-Map-HP-Override bleibt technisch möglich.

---

## 3C-3 – Campaign Working State & Persistence Validation

### Ziel

Die bereits implementierte Working-State-/Commit-/Rollback-Logik wird für echte Kampagnenmaps vollständig verdrahtet und abgesichert.

### Änderungen

- bestätigte Contributions beim Start einer geeigneten Kampagnenmap materialisieren
- laufende Mission als Working State behandeln
- Neubau in der Mission persistenzfähig halten
- Rückbau in der Mission persistenzfähig halten
- Runtime-Zerstörung in den Abschluss einbeziehen
- vorhandenen `victory -> commit`-Pfad verwenden
- vorhandenen `defeat/abort -> rollback`-Pfad verwenden
- keine zweite Campaign-spezifische Persistenzlogik aufbauen
- relevante Multiplayer-Fälle testen:
  - Host
  - Client
  - Join/Leave soweit bestehender 3B-Vertrag betroffen ist

### Akzeptanzkriterien

#### Sieg

- Neubau bleibt erhalten.
- Rückbau bleibt erhalten.
- zerstörtes persistentes Konstrukt bleibt entfernt.

#### Niederlage/Abbruch

- Neubau wird verworfen.
- Rückbau wird verworfen.
- zerstörtes persistentes Konstrukt ist im nächsten bestätigten Stand wieder vorhanden.

#### Sonstiges

- Basiskern-HP wird niemals persistiert.
- Map 9 erzeugt keinen Persistent-Base-Mission-State.
- Map 1 erzeugt trotz visueller Basis keinen normalen Contribution-Working-State.

---

## 3C-4 – Progression Cleanup & Technical Map Removal

### Ziel

Die Campaign-Progression wird auf das neue Persistent-Base-Zielbild bereinigt.

### Item-System

- Item-Unlock von Sieg Map 10 auf Sieg Map 15 verschieben.
- Item-Drops aus Maps 10–14 entfernen.
- Map 15:
  - Unlock nach Sieg
  - erstes Item-Angebot im selben Sieg
  - Item-Level 1
- Map 16:
  - Item-Level 1
- Map 17:
  - Item-Level 2

### Holy-Hand-Grenade

- bestehende Map-12-Mechanik nicht in ein persistentes Reward-System umbauen
- keine 3D-Logik vorwegnehmen

### Maps 18/19

- Dateien löschen
- Registry bereinigen
- Tests und Campaign Order aktualisieren
- Debug-/UI-Referenzen bereinigen
- Audit-/Dokumentationsreste entfernen

### Akzeptanzkriterien

- Maps 10–14 erzeugen keine Item-Angebote.
- Sieg Map 15 schaltet Items frei und erzeugt das erste Level-1-Angebot.
- Map 16 erzeugt Level-1-Items.
- Map 17 erzeugt Level-2-Items.
- Map 12 Holy-Hand-Grenade funktioniert weiterhin wie vor 3C.
- Maps 18 und 19 sind weder spielbar noch in Registry/Unlock-Reihenfolge vorhanden.
- Keine Tests oder Campaign-Audits erwarten weiterhin Maps 18/19.

---

# 14. Empfohlene Tests

Mindestens folgende Regressionstests sollten nach 3C vorhanden sein.

## Campaign Unlock

- neuer Save -> Persistent Base locked
- Map-1-Niederlage -> locked
- Map-1-Sieg -> unlocked

## Map Opt-in

- Map 2 -> active
- Map 8 -> active
- Map 9 -> inactive
- Map 10 -> active
- Map 17 -> active

## Map 1

- Core sichtbar
- keine Contributions
- kein Persistent Building
- Tutorial-Outpost weiterhin vorhanden

## Main-Base-Ersetzung

Mindestens eine einfache und eine komplexe Map testen.

Empfohlen:

- Map 11
- Map 12

Prüfen:

- alte Main Base entfernt
- gekoppelte Turrets/Podeste entfernt
- andere Friendly-/Hostile-/Objective-Strukturen erhalten

## Persistence

- Build + Victory -> persists
- Dismantle + Victory -> persists
- Destruction + Victory -> removed
- Build + Defeat -> rollback
- Dismantle + Defeat -> rollback
- Destruction + Defeat -> rollback

## Item Progression

- Map 10–14 -> kein Drop
- Map 15 first victory -> unlock + L1 offer
- Map 16 -> L1
- Map 17 -> L2

## Registry Cleanup

- Maps 18/19 nicht mehr in Campaign Order
- Unlock des Kampagnenendes funktioniert weiterhin korrekt

---

# 15. Technische Leitplanken

- Bestehende 3A-/3B-Domain-Modelle wiederverwenden.
- Keine Campaign-spezifische Kopie des Persistent-Base-Stores.
- Keine hartcodierte `mapId >= X`-Aktivierungslogik.
- Keine automatische Ableitung der Persistent-Base-Position aus alten Main Bases zur Laufzeit.
- Main-Base-Migration ist Authoring-Arbeit.
- `persistentBase` bleibt der explizite World-Vertrag.
- Per-Map-HP-Override nicht entfernen.
- Map 1 als klaren Sonderfall kapseln.
- Keine 3D-/3E-/3F-Funktionen vorwegnehmen.
- Keine Übergangslösungen für permanente Rewards.
- Tests sollen fachliche Zustände prüfen, nicht unnötig konkrete interne Implementierungsdetails festschreiben.

---

# 16. Definition of Done für Phase 3C

Phase 3C ist abgeschlossen, wenn:

1. Map 1 die zukünftige Heimatbasis am finalen Checkpoint zeigt und Sieg sie dauerhaft freischaltet.
2. Maps 2–8 und 10–17 explizit auf die Persistent Base umgestellt sind.
3. Map 9 ohne Persistent Base funktioniert.
4. Die bisherigen Main Bases samt gekoppelte Turrets/Podeste auf den umgestellten Maps entfernt sind.
5. Andere Missionsstrukturen weiterhin korrekt funktionieren.
6. Campaign Build/Dismantle/Destruction die vorhandene Commit-/Rollback-Semantik korrekt nutzen.
7. Alle Persistent-Base-Cores zunächst identische HP verwenden.
8. Item-Unlock und Item-Drops auf Map 15–17 verschoben sind.
9. Die Map-12-Holy-Hand-Grenade nicht versehentlich in 3D-Scope gezogen wurde.
10. Maps 18 und 19 vollständig entfernt sind.
11. relevante Regressionstests grün sind.
12. keine Abhängigkeit auf numerische Map-ID-Schwellen für Persistent-Base-Aktivierung eingeführt wurde.
