# Fragdachse – Persistente Basis
## Kompakter Ausbauplan Phase 3C–3F

**Status:** Work in Progress  
**Zielgruppe:** Coding-KIs und Entwickler  
**Dokumenttyp:** Delta-orientierter Phasenüberblick  
**Voraussetzung:** Phase 3A und 3B sind umgesetzt bzw. werden vor Beginn von 3C abgeschlossen.

---

## 1. Zielbild

Die persistente Basis wird von einem technisch funktionierenden Persistenz- und Multiplayer-System zu einem produktiven Kampagnen- und Progressionssystem ausgebaut.

Die verbleibenden Ausbaustufen sind:

1. **3C – Campaign Integration & Progression Cleanup**
2. **3D – Permanent Rewards & Special Placement Framework**
3. **3E – Persistent Base Build-Area Progression**
4. **3F – Repositioning & Radial Menu V2**

Nach 3F soll die persistente Basis als vollständiges, produktionsfähiges System gelten.

Große neue Gameplay-Systeme wie **Structure Occupancy**, **Wachturm** und **Dachsbau** sind bewusst nicht Teil dieser Phase-3-Roadmap und werden später als eigene Projekte ergänzt.

---

# 2. Phase 3C – Campaign Integration & Progression Cleanup

## Ziel

Die persistente Basis wird in die normale Coop-Defense-Kampagne integriert.

Die einzelne Map entscheidet explizit, ob und wo die persistente Basis eingesetzt wird. Campaign Progress entscheidet nur, ob sie bereits freigeschaltet ist.

## Kernergebnisse

- Map 1 zeigt die zukünftige persistente Basis als finales Ziel und schaltet sie nach Sieg frei.
- Maps 2–8 verwenden die persistente Basis.
- Map 9 verwendet sie ausdrücklich nicht.
- Maps 10–17 verwenden sie.
- Die persistente Basis ersetzt auf diesen Maps die bisherige authored Main Base vollständig.
- Outposts, Missionsstrukturen und hostile Bases bleiben eigenständiger Map-Content.
- Persistent gespeicherte Konstruktionen werden ab Map 2 materialisiert.
- Während Kampagnenmissionen darf gebaut und zurückgebaut werden.
- Sieg committed den Working State.
- Niederlage oder Abbruch rollt auf den bestätigten Stand zurück.
- Die Item-Progression wird auf Map 15–17 verschoben.
- Technische Persistent-Base-Testmaps 18 und 19 werden vollständig entfernt.

## Abgrenzung

Nicht Bestandteil von 3C:

- permanente Basis-Rewards
- Holy-Hand-Grenade-Podest als persistenter Reward
- Bauflächen-Erweiterung
- Verschieben bestehender Konstruktionen
- vollständiger Radialmenü-Umbau
- Structure Occupancy
- Wachturm
- Dachsbau

---

# 3. Phase 3D – Permanent Rewards & Special Placement Framework

## Ziel

Kampagnenfortschritt kann dauerhafte, basisgebundene Spezialobjekte freischalten, die nicht zum persönlichen Konstruktion-Save eines Spielers gehören.

## Kernergebnisse

### Base-owned Rewards

Ein generisches Modell für permanente Basis-Rewards wird eingeführt.

Mindestens folgende Zustände müssen unterstützt werden:

- `locked`
- `unlocked + unplaced`
- `unlocked + placed`

Ein Reward gehört zur Basis bzw. zum Host-Kampagnenfortschritt, nicht dem Spieler, der ihn platziert.

### Special Placement Framework

Besondere platzierbare Inhalte dürfen keinen eigenen isolierten Placement-Sonderweg erhalten.

Das Framework muss mindestens unterstützen:

- normale Konstruktionen
- permanente Basis-Rewards
- perspektivisch Utilities
- perspektivisch Special Powers
- perspektivisch Management-Aktionen

### Holy-Hand-Grenade-Podest

Das Holy-Hand-Grenade-Podest ist der erste konkrete permanente Reward.

Die bisherige Map-12-Variante wird erst in dieser Phase in das neue persistente Reward-System überführt.

### Radialmenü-Vorbereitung

3D erweitert das zugrunde liegende Daten-/Aktionsmodell des Radialmenüs so weit, dass permanente Rewards darüber angeboten und platziert werden können.

Ein vollständiger UX- und Cooldown-Refactor des Radialmenüs ist ausdrücklich erst Teil von 3F.

## Perspektivische Erweiterbarkeit

Das Modell soll später ohne grundlegenden Umbau auch Spezialaktionen wie z. B. eine Nuke über das Radialmenü darstellen können.

Die Nuke selbst muss in 3D noch nicht umgestellt werden.

---

# 4. Phase 3E – Persistent Base Build-Area Progression

## Ziel

Der bebaubare Bereich der persistenten Basis wird als eigener Progressionswert ausgebaut.

## Kernergebnisse

- Die aktuelle kleine Build Area bleibt die Startstufe.
- Eine größere Build Area wird über Campaign Progress dauerhaft freigeschaltet.
- Der aktive Bereich wird nicht aus der aktuell gespielten Mapnummer erraten.
- Der Host-Kampagnenfortschritt bestimmt die verfügbare Ausbaufläche.
- Gäste bringen keine eigene Build-Area-Freischaltung in die Host-Kampagne ein.
- Bestehende Platzierungs-, Restore- und Composite-Systeme verwenden weiterhin dieselbe Build-Area-Abstraktion.
- Die technische Unterstützung für authored `square`- und `radius`-Build-Areas bleibt erhalten.

## Leitprinzip

```text
Campaign Progress
    -> freigeschaltete Base-Area-Stufe
        -> aktive Build Area
```

Damit können später weitere Ausbaugrößen ergänzt werden.

---

# 5. Phase 3F – Repositioning & Radial Menu V2

## Ziel

Die persistente Basis erhält ihre vollständigen Verwaltungsfunktionen und ein einheitliches Radialmenü für Konstruktionen, Utilities, Spezialobjekte und Management-Aktionen.

---

## 5.1 Repositioning

Persistente Konstruktionen können verschoben werden.

Das Verschieben ist eine atomare Mutation des bestehenden Objekts und darf nicht als:

```text
Rückbau -> Neubau
```

implementiert werden.

Erhalten bleiben insbesondere:

- Persistent-ID
- Owner
- Placement-Reihenfolge
- Reward-/Provenienz-Zuordnung
- sonstige persistente Metadaten

Ein ungültiges Ziel verändert die vorhandene Konstruktion nicht.

Dieselben Authority-, Ownership- und Persistenzregeln wie bei anderen Persistent-Base-Mutationen gelten weiterhin.

---

## 5.2 Radial Menu V2

Das Radialmenü wird von einem primären Ingenieur-Baumenü zu einer generischen Aktionsauswahl weiterentwickelt.

Ein Eintrag soll konzeptionell folgende Informationen unterstützen können:

- Kategorie
- Icon / Darstellung
- verfügbar / gesperrt
- Sperrgrund
- Cooldown
- Cooldown-Fortschritt
- Charges / Anzahl, falls relevant
- Placement erforderlich ja/nein
- Permission-/Owner-Regeln
- auszuführende Aktion

Mögliche Kategorien:

- `construction`
- `persistentReward`
- `utility`
- `specialPower`
- `managementAction`

Die konkreten TypeScript-Typen werden anhand der dann aktuellen Architektur festgelegt.

---

## 5.3 Cooldown-Darstellung

Cooldowns von Konstruktionen und Utilities werden direkt im Radialmenü sauber sichtbar.

Ein Eintrag auf Cooldown bleibt sichtbar.

Geeignete Darstellung:

- radialer Cooldown-Fill
- abgedunkeltes Icon
- Restzeit, sofern sinnvoll

Cooldown-Zustände dürfen nicht durch voneinander getrennte Sonderimplementierungen pro Itemtyp entstehen.

---

## 5.4 Management-Aktionen

Das Verschieben von Konstruktionen wird als Management-Aktion in das Radialmenü integriert.

Perspektivisch können weitere Verwaltungsaktionen über dasselbe Modell ergänzt werden.

---

# 6. Bewusst verschobene Großprojekte

Folgende Systeme werden nicht mehr in Phase 3 aufgenommen:

## Structure Occupancy

Generisches System für Spieler innerhalb von Gebäuden oder Strukturen.

Betroffene Domänen:

- Player State
- Movement Locks
- Weapon Permissions
- Damage Routing
- Enemy Targeting
- Netzwerkreplikation
- Death / Respawn
- Structure Destruction

Wegen dieser Breite wird es als eigenes Projekt behandelt.

## Wachturm

Besetzbare Kampfbasis-Struktur, die auf Structure Occupancy aufbaut.

Kein normaler automatischer Turm und deshalb nicht Teil von 3D.

## Dachsbau

Besetzbare Schutzstruktur für mehrere bzw. alle Spieler.

Baut ebenfalls auf Structure Occupancy auf.

---

# 7. Abhängigkeiten

```text
3A – Persistent Base Foundation
        |
        v
3B – Multiplayer / Composite / Ownership
        |
        v
3C – Campaign Integration & Progression Cleanup
        |
        v
3D – Permanent Rewards & Special Placement
        |
        v
3E – Build-Area Progression
        |
        v
3F – Repositioning & Radial Menu V2
```

3D benötigt die produktive Campaign-Integration aus 3C.

3E setzt die vorhandene Build-Area-Abstraktion voraus, verändert aber nicht das Reward-System.

3F baut auf den Aktionstypen aus 3D auf und führt sie zusammen mit Repositioning und Cooldowns zu einem einheitlichen Radialmenü.

---

# 8. Architektur-Leitlinien für alle verbleibenden Phasen

- Keine parallelen Sonderimplementierungen für dasselbe Gameplay-Konzept.
- Persistente Daten und Runtime-State strikt trennen.
- Host bleibt Autorität für die gemeinsame Session und Host-Kampagne.
- Persönliche Beiträge behalten stabile Ownership.
- Maps authoren World-spezifische Position und Nutzung; Campaign Progress authorisiert Freischaltungen.
- Keine impliziten Freischaltungen aus numerischen Map-IDs, wenn ein expliziter Progressionszustand möglich ist.
- Neue Systeme sollen auf vorhandenen Domain-Abstraktionen aufbauen statt Map-Sonderlogik einzuführen.
- GDDs und Implementierungspläne bleiben delta-orientiert und wiederholen bestehende Architektur-Dokumentation nur, wenn eine Phase davon bewusst abweicht.
