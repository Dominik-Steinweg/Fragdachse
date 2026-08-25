# Fragdachse – Persistente Basis
## Implementierungsphase 1: Persistent Base Foundation

**Status:** Implementierungsspezifikation  
**Übergeordnetes Dokument:** `Fragdachse – GDD V3: Persistente Basis ab Map 16`  
**Phase:** 1 von 3

---

# 1. Zweck dieses Dokuments

Dieses Dokument konkretisiert ausschließlich **Implementierungsphase 1** des übergeordneten Persistent-Base-GDD.

Die Coding-KI erhält beide Dokumente.

Daher gilt:

- Das Haupt-GDD definiert Spielregeln, Vision und phasenübergreifende Architektur.
- Dieses Dokument definiert die **konkrete technische Umsetzung von Phase 1**.
- Regeln des Haupt-GDD werden hier nur wiederholt, wenn sie für eine Implementierungsentscheidung notwendig sind.
- Phase-2- und Phase-3-Funktionalität darf nicht vorgezogen werden, außer eine kleine technische Vorbereitung verhindert offensichtlich einen späteren Architekturbruch.

---

# 2. Ziel der Phase

Nach Abschluss von Phase 1 existiert eine funktionierende **persistente Host-Basis**.

Ein Host kann auf einer Persistent-Base-Testmap ein zulässiges dauerhaftes Konstrukt innerhalb der aktiven Persistent Zone bauen.

Nach erfolgreichem Missionsabschluss bleibt dieses Konstrukt erhalten über:

```text
Map 18
→ Sieg
→ Map 19
→ Reload
→ neuen Raum
```

Dabei werden keine Phaser-/Runtime-Objekte erhalten.

Persistiert wird ausschließlich ein stabiler Blueprint, aus dem bei jedem Arenaaufbau normale Runtime-Konstruktionen neu erzeugt werden.

Phase 1 beweist damit das Fundament:

```text
Save
+ Working/Committed State
+ Zone
+ Map Anchor
+ Victory Commit
+ Defeat Rollback
+ Restore
+ Dormancy
+ Capacity/Unlock Validation
+ Terrain Reservation
+ visuelle Basisfläche
```

---

# 3. Verbindliche Phase-1-Entscheidungen

Für diese Phase gelten folgende konkretisierte Entscheidungen.

## 3.1 Neuer Save-Schnitt

Die bestehende Progress-Generation wird bewusst beendet.

Phase 1 führt einen neuen Progress-Vertrag ein:

```text
fragdachse_progress_v3
```

mit:

```text
LOCAL_PROGRESS_SCHEMA_VERSION = 3
LOCAL_PROGRESS_EXPORT_VERSION = 3
```

Bestehende `fragdachse_progress_v2`-Spielstände müssen nicht migriert werden.

Sie werden nicht als V3 interpretiert.

Audio-/Grafiksettings bleiben davon unberührt.

---

## 3.2 Map 18 und 19 werden echte Kampagnenmaps

Phase 1 legt Map 18 und Map 19 regulär an und hängt sie hinter Map 17 an die bestehende Kampagnenregistry.

Damit ergibt sich:

```text
...
16
17
18
19
```

Die bestehende lineare Unlock-Logik bleibt unverändert und leitet die Freischaltung weiterhin aus der Registry-Reihenfolge ab.

Die Inhalte von Map 18/19 sind in Phase 1 bewusst technische Integrationsinhalte und noch kein finales Kampagnendesign.

---

## 3.3 Phase 1 bleibt beim heutigen Klassenmodell

Die Generalisierung des Bauens für Nicht-Inspector-Klassen gehört weiterhin zu Phase 2.

Phase 1 verändert deshalb nicht:

```text
Inspector = heutiges vollständiges Bausystem
Nicht-Inspector = kein neues Persistent-Base-Bausystem
```

Capacity und Unlocks werden beim Restore bereits vollständig berücksichtigt, verwenden aber den **zum Zeitpunkt von Phase 1 bestehenden Capacity-/Unlock-Vertrag**.

Insbesondere wird die spätere Trennung:

```text
Nicht-Inspector: 30 + Boni
Inspector:       100 + Boni
```

noch nicht eingeführt.

---

## 3.4 Persistenzmodell unterstützt bereits alle normalen dauerhaften Host-Bauten

Das Persistenzformat darf nicht Inspector-Türme fest verdrahten.

Persistierbar sind grundsätzlich alle normalen dauerhaft stehenden Placeables des Hosts, sofern sie:

- aus dem regulären Placement-System stammen,
- keinen zeitlich begrenzten Lifetime-Mechanismus besitzen,
- innerhalb der aktiven Zone als Persistent Candidate platziert wurden,
- zum jeweiligen Restore nach aktuellen Regeln zulässig sind.

Dazu gehören technisch insbesondere:

```text
ConstructionId-Konstruktionen
Rock Barrier
Fliegenpilzturm / SPORE_TURRET
weitere normale dauerhafte Placeable Utilities
```

Phase 1 muss deshalb sowohl:

```text
construction
```

als auch:

```text
utility
```

im Persistent-Blueprint repräsentieren können.

---

## 3.5 Persistent Anchor referenziert die bestehende Hauptbasis

Es wird kein zweiter unabhängiger Anchor authored.

Eine Persistent-Base-Map definiert stattdessen beispielsweise:

```ts
persistentBase: {
  baseId: 'coop-base'
}
```

`baseId` muss auf eine vorhandene freundliche Hauptbasis der Map zeigen.

Der bereits durch das Map-/Base-System aufgelöste Anchor dieser Basis ist gleichzeitig:

```text
Persistent Base Anchor
```

Damit besitzen:

- Hauptbasis,
- Persistent Zone,
- Kiesfläche,
- gespeicherte Relativkoordinaten,
- Generator-Reserve

denselben Bezugspunkt.

---

# 4. Nicht Bestandteil von Phase 1

Nicht implementieren:

- Guest-Session-Konstruktionen
- Client-Bauten über mehrere Maps
- Disconnect-Cleanup
- Construction-Radial für Nicht-Inspector
- 30/100-Klassen-Capacity
- Base-Owned Rewards
- permanente Reward-Missionen
- Replay-Sperren
- finaler Umbau Map 16
- finaler Umbau Map 17
- finaler Content Map 18/19
- Base Editor
- From Dachs Till Dawn

Ebenso keine neue Netzwerkarchitektur für Persistent Base.

Phase 1 nutzt die vorhandene Host-Autorität und normale Runtime-Replikation.

---

# 5. Modulstruktur

Empfohlene neue Domäne:

```text
src/persistentBase/
├─ PersistentBaseTypes.ts
├─ PersistentBaseRepository.ts
├─ PersistentBaseSession.ts
├─ PersistentBaseRestorePlanner.ts
└─ PersistentBaseZone.ts
```

Zentrale Konstanten können beispielsweise liegen in:

```text
src/config/persistentBase.ts
```

Die exakten Dateinamen dürfen geringfügig angepasst werden, die Verantwortlichkeiten jedoch nicht.

---

# 6. Save-Integration

## 6.1 Keine zweite Storage-Grenze

`src/utils/localPreferences.ts` bleibt die einzige direkte LocalStorage-Grenze.

`PersistentBaseRepository` darf deshalb **nicht selbst `window.localStorage` verwenden**.

Stattdessen:

```text
PersistentBaseRepository
→ typisierte get/set API
→ localPreferences
→ LocalStorage
```

Dadurch funktionieren automatisch auch:

- Cache-Verhalten
- Export
- Import
- Reset
- Storage-Fehlerbehandlung

über den bestehenden zentralen Mechanismus.

---

# 7. PersistentBaseState V1

Innerhalb des neuen Progress-V3-Dokuments erhält `coopDefense`:

```ts
persistentBase: PersistentBaseState
```

Der Persistent-Base-Zustand besitzt eine eigene interne Schema-Version:

```ts
interface PersistentBaseState {
  schemaVersion: 1;
  radiusCells: number;
  revision: number;
  constructions: PersistentConstruction[];
}
```

Dies erlaubt später Erweiterungen des Basissystems, ohne zwangsläufig erneut den gesamten Progress-Vertrag brechen zu müssen.

---

# 8. PersistentConstruction

Empfohlen wird, bestehende Tool-Referenzen wiederzuverwenden:

```ts
interface PersistentConstruction {
  persistentId: string;

  tool: {
    kind: 'construction' | 'utility';
    id: string;
  };

  relativeGridX: number;
  relativeGridY: number;

  angle: number;

  placementOrder: number;
}
```

Nicht speichern:

```text
Runtime-Rock-ID
ownerColor
currentHp
maxHp
Target
Cooldown
Buffs
VFX
Power-up-Zustand
Power-up-Respawn-Timer
Runtime-Turret-ID
```

`persistentId` ist eine stabile Blueprint-Identität und darf insbesondere nicht aus der Runtime-ID eines `SyncedPlaceableRock` abgeleitet werden.

---

# 9. Radius-Konfiguration

Folgende Werte müssen zentral konfigurierbar sein:

```ts
DEFAULT_PERSISTENT_BASE_RADIUS_CELLS
MAX_PERSISTENT_BASE_RADIUS_CELLS
PERSISTENT_BASE_CLEARANCE_CELLS
```

Für Phase 1 können als technische Startwerte verwendet werden:

```text
DEFAULT = 5
MAX     = 10
CLEARANCE = 2
```

Die ersten beiden Werte bleiben ausdrücklich Balancingparameter.

Kein System darf die Werte `5` oder `10` selbst hardcoden.

---

# 10. Definition der Persistent Zone

Phase 1 verwendet eine gemeinsame pure Zone-Funktion.

Sinngemäß:

```ts
isCellInsidePersistentBaseZone(
  relativeGridX,
  relativeGridY,
  radiusCells
): boolean
```

Für Phase 1 gilt als technische Definition:

```text
dx² + dy² <= radius²
```

Die Zone ist damit rasterbasiert, aber geometrisch kreisförmig um den Base Anchor.

Für Placeables mit mehreren Footprint-Zellen gilt:

> Ein Placement ist nur dann Persistent Candidate, wenn alle durch das Placeable belegten Zellen innerhalb der zum Placement-Zeitpunkt aktiven Zone liegen.

Diese Funktion muss gemeinsam verwendet werden durch:

- Placement-Klassifizierung
- Restore Planner
- Kiesdarstellung
- Grid-Overlay
- Save-Validierung
- Generator-/Reservation-Logik

Es dürfen keine voneinander abweichenden Radiusberechnungen entstehen.

---

# 11. Persistent Candidate beim Placement

Die Persistenzentscheidung wird **beim erfolgreichen Placement** getroffen.

Nach erfolgreichem normalen Placement prüft die `PersistentBaseSession`:

```text
supportsPersistentBase?
+
Host gehört das Objekt?
+
dauerhaftes Placeable?
+
alle Footprint-Zellen innerhalb aktiver Zone?
```

Wenn ja:

```text
Persistent Candidate
```

Wenn nein:

```text
Mission Build
```

Diese Entscheidung wird für die Lebensdauer dieses Runtime-Objekts nicht später neu berechnet.

Insbesondere darf ein später erhöhtes `radiusCells` ein älteres Außenobjekt niemals rückwirkend persistent machen.

---

# 12. Runtime-Metadaten

Persistent-Base-Metadaten sollen nicht unnötig in jedem normalen Netzwerk-Snapshot repliziert werden.

`PersistentBaseSession` hält deshalb hostseitig eine Zuordnung:

```text
Runtime Placeable ID
→ Persistent Runtime Metadata
```

Diese Metadaten enthalten mindestens:

```text
persistentId
placementOrder
origin = restored | new
```

Für außerhalb der Zone platzierte Mission Builds wird kein persistenter Blueprint-Eintrag benötigt.

---

# 13. Working und Committed State

## 13.1 Committed State

Der Repository-Zustand ist die langfristige Wahrheit:

```text
CommittedPersistentBaseState
```

Er verändert sich nur durch einen erfolgreichen Commit.

---

## 13.2 Working State

Beim Start einer Persistent-Base-Mission entsteht:

```text
Committed State
→ Clone
→ Working Session
```

Alle Änderungen während der Mission betreffen ausschließlich diesen Working-Kontext.

Kein:

```text
Damage
Dismantle
Placement
Destroy
```

darf unmittelbar den gespeicherten Blueprint verändern.

---

# 14. Mission Start

Bei Aufbau einer Persistent-Base-Map:

```text
1. Map-Konfiguration auflösen
2. referenzierte Hauptbasis auflösen
3. Persistent Base State laden
4. Zustand validieren
5. Restore Plan erzeugen
6. Arena normal erzeugen
7. Restore Plan in normale Runtime-Objekte materialisieren
8. normale abhängige Systeme registrieren
9. Mission starten
```

Der Restore muss abgeschlossen sein, bevor die Arena als spielbereit gilt.

---

# 15. Restore Planner

Der Restore Planner arbeitet deterministisch.

Reihenfolge:

```text
1. strukturell gültige Blueprint-Einträge
2. bekannte Tool-ID
3. innerhalb aktueller aktiver Zone
4. für aktuellen Fortschritt / aktuelle Klasse freigeschaltet
5. sortiert nach placementOrder
6. Zellkonflikte prüfen
7. aktuelle persönliche Capacity anwenden
```

Sekundärer Tie-Breaker:

```text
persistentId
```

---

# 16. Dormant State

Ein Blueprint-Eintrag wird nicht gelöscht, nur weil er aktuell nicht aktiviert werden kann.

Dormant bleiben insbesondere Einträge wegen:

```text
außerhalb aktuellem Radius
aktueller Klasse nicht erlaubt
aktuell nicht freigeschaltet
Capacity nicht ausreichend
Zellkonflikt
```

Sie verbleiben im Committed Blueprint.

Dormant bedeutet:

```text
im Save vorhanden
nicht Runtime-materialisiert
keine Capacity
kein Gameplay
```

---

# 17. Capacity-Auswahl

Nach Unlock-/Zone-Filter werden Kandidaten stabil nach `placementOrder` verarbeitet.

Für jeden Eintrag:

```text
cost <= remainingCapacity
→ aktivieren

cost > remainingCapacity
→ dormant
→ mit nächstem Eintrag fortfahren
```

Damit bleibt der Restore:

- deterministisch,
- prioritätsbasiert,
- trotzdem in der Lage kleinere spätere Konstrukte in verbleibende Capacity einzupassen.

Phase 1 verwendet hierfür ausschließlich die heute vorhandenen Capacity-Helfer.

Die Klassen-Generalisation erfolgt erst in Phase 2.

---

# 18. Restore darf Placement-Range nicht simulieren

Der normale Spieler-Placement-Pfad prüft unter anderem Reichweite und aktuelle Spielerposition.

Diese Regeln sind für Restore ungeeignet.

Deshalb darf Restore nicht durch künstliche Pointer-/Spielerpositionen an `tryPlaceConstruction()` oder ähnliche interaktive APIs „vorgetäuscht“ werden.

Stattdessen benötigt das `PlacementSystem` einen expliziten hostseitigen Materialisierungspfad für bereits validierte persistente Placeables.

Sinngemäß:

```ts
materializePersistentPlaceable(...)
```

Dieser Pfad:

- erzeugt eine neue Runtime-ID,
- trägt die Zellen regulär in `RockGridIndex` ein,
- verwendet dieselben Runtime-Datenmodelle,
- respektiert reale Zellkollisionen,
- erzeugt keine zweite Construction-Simulation.

---

# 19. Gemeinsame Post-Placement-Registrierung

Ein Restore darf nicht nur einen `SyncedPlaceableRock` in eine Map schreiben.

Alle abhängigen Systeme müssen denselben gültigen Zustand erhalten wie bei einem normalen Placement.

Falls die heutige Placement-Logik diese Registrierung über mehrere Aufrufer verteilt, soll der gemeinsame Teil extrahiert werden.

Sinngemäß:

```text
Normal Placement ─┐
                  ├→ registerPlacedRuntimeObject(...)
Restore ──────────┘
```

Dazu gehören abhängig vom Konstrukttyp insbesondere:

- Turret Runtime
- PowerUpSystem
- Energy Injector
- PowerUp-/Target-Registrierung
- Rendering
- Flowfield-/Grid-Invalidierung
- Netzwerk-Snapshot
- sonstige heute bereits an Placement gekoppelte Runtime-Systeme

Keine doppelte Restore-Sonderimplementierung dieser Systeme.

---

# 20. HP beim Restore

Gespeicherte HP existieren nicht.

Beim Restore wird `maxHp` aus den **aktuellen** Runtime-Regeln neu berechnet.

Anschließend gilt:

```text
hp = maxHp
```

Damit berücksichtigt ein Restore auch aktuelle:

- Upgrades
- Modifier
- Balancewerte

ohne alte berechnete Werte im Save zu konservieren.

---

# 21. Power-up-Podeste

Normale bereits verfügbare Inspector-Podeste können in Phase 1 wie andere normale Konstruktionen persistent sein.

Beim Restore:

```text
physisches Podest erzeugen
→ normal im PowerUpSystem registrieren
→ leer starten
→ neuen Respawn-Zyklus beginnen
```

Nicht wiederherstellen:

- vorher vorhandenes Power-up
- Restzeit des vorherigen Respawns

Dies ist unabhängig von den späteren **Base-Owned Reward-Podesten** aus Phase 3.

---

# 22. Victory Commit

Der Commit darf **nicht einfach alle momentan materialisierten Runtime-Objekte als neuen Save speichern**.

Grund:

Dormant Blueprint-Einträge müssen erhalten bleiben.

Der Commit arbeitet deshalb auf Basis des vorherigen Committed States.

## Für beim Missionsstart aktive persistente Einträge

```text
Runtime-Objekt existiert noch
→ Eintrag behalten

Runtime-Objekt zerstört oder rückgebaut
→ Eintrag entfernen
```

## Für beim Missionsstart dormant Einträge

```text
unverändert übernehmen
```

## Für neue Persistent Candidates

```text
existiert bei Missionsende noch
→ neuen Blueprint-Eintrag hinzufügen

vor Missionsende zerstört/rückgebaut
→ nicht hinzufügen
```

## Für Mission Builds außerhalb der Zone

```text
niemals hinzufügen
```

Anschließend:

```text
revision += 1
```

und genau dieser Zustand wird gespeichert.

---

# 23. Defeat / Abort / Reload während Mission

Bei Niederlage:

```text
Working State verwerfen
kein Write
```

Dasselbe gilt für einen Missionsabbruch ohne bestätigten Sieg.

Ein Browser-Reload während einer noch nicht gewonnenen Mission lädt deshalb automatisch wieder die letzte Committed Baseline.

Dadurch benötigt Phase 1 keinen separaten Crash-Recovery-Save für laufende Missionen.

---

# 24. Save-Validierung

Storage-Schema und Gameplay-Validierung werden getrennt.

## Storage-Validierung

Prüft beispielsweise:

- Schema-Version
- Array-/Objektform
- begrenzte Stringlängen
- Integer-Koordinaten
- finite Winkel
- gültige `placementOrder`
- eindeutige `persistentId`

## Restore-Validierung

Prüft:

- bekannte Tool-ID
- aktuelle Unlocks
- aktuelle Zone
- globalen Maximalradius
- Zellkollision
- Capacity
- Mapgeometrie

Ein semantisch derzeit nicht nutzbarer Blueprint-Eintrag darf keinen Crash verursachen.

Wo fachlich möglich bleibt er dormant statt gelöscht zu werden.

Diagnostisch auffällige Fälle sollen über die bestehende Diagnose-/Logging-Infrastruktur sichtbar sein.

---

# 25. Progress Reset, Export und Import

Der neue Persistent-Base-State gehört zum normalen Coop-Defense-Fortschritt.

Daher muss:

```text
resetStoredCoopDefenseCharacter()
```

auch die Basis auf ihren Default-Zustand zurücksetzen.

Progress-Export V3 enthält die Basis.

Progress-Import V3 stellt sie wieder her.

V2-Exporte sind mit dem neuen V3-Vertrag bewusst inkompatibel.

---

# 26. Map-Konfiguration

`CoopDefenseMapConfig` erhält eine optionale Persistent-Base-Konfiguration.

Empfohlen:

```ts
interface CoopDefenseMapPersistentBaseConfig {
  readonly baseId: string;
}

interface CoopDefenseMapConfig {
  ...
  readonly persistentBase?: CoopDefenseMapPersistentBaseConfig;
}
```

Damit bedeutet:

```text
persistentBase vorhanden
→ supportsPersistentBase = true

persistentBase fehlt
→ normales heutiges Mapverhalten
```

Ein zusätzliches redundantes Boolean ist nicht notwendig.

---

# 27. Map-Validierung

Beim Auflösen einer Persistent-Base-Map muss geprüft werden:

```text
baseId existiert
base ist friendly
base.role ist main oder der bestehende Default-Main-Base-Fall
Anchor ist auflösbar
MAX_RADIUS + Clearance passt vollständig in die Arena
```

Fehlerhafte authored Persistent-Base-Konfiguration soll beim Entwickeln deutlich diagnostiziert werden und nicht still auf eine andere Basis zurückfallen.

---

# 28. Generator-Reservation

Rund um den aufgelösten Persistent Anchor wird reserviert:

```text
MAX_PERSISTENT_BASE_RADIUS_CELLS
+
PERSISTENT_BASE_CLEARANCE_CELLS
```

Mit den Phase-1-Defaults:

```text
10 + 2 = 12 Zellen
```

Die Reservation verwendet **immer MAX**, niemals den aktuellen Spieler-Radius.

Innerhalb dieser Fläche dürfen Generatoren keine störende Weltgeometrie erzeugen.

Die Reservation muss mindestens in diejenigen Generierungs-/Authoringprüfungen einfließen, die heute erzeugen bzw. reservieren:

- Rocks
- Trees
- Tracks
- Ground Hazards
- Spawn-Strukturen
- sonstige blockierende Mapgeometrie

Die referenzierte eigene Hauptbasis selbst ist selbstverständlich von diesem Verbot ausgenommen.

---

# 29. Relative Koordinaten

Gespeichert wird:

```text
relativeGridX = construction.gridX - persistentAnchor.gridX
relativeGridY = construction.gridY - persistentAnchor.gridY
```

Restore:

```text
worldGridX = newAnchor.gridX + relativeGridX
worldGridY = newAnchor.gridY + relativeGridY
```

Keine absoluten Arena-Koordinaten speichern.

Map 18 und 19 sollen bewusst unterschiedliche absolute Anchor-Positionen oder Arenadimensionen verwenden, damit dieser Vertrag bereits in Phase 1 tatsächlich getestet wird.

---

# 30. Kies-Untergrund

Persistent-Base-Maps rendern innerhalb des **aktuell freigeschalteten Radius** Kies.

Technische Vorgabe:

> Keine neue Terrain-Technik entwickeln.

Die vorhandene Gras-/Dirt-/Blob-Infrastruktur wird wiederverwendet.
Hierfür kann kies47blob.png als Blob-Quelle genutzt werden.

Darüber hinaus werden über den Kies weitere Assets gezeichnet, so wie Moos über Gras/Dirt. Diese Assets liegen in Roh-Form in "public\assets\sprites\tmp". Sie müssen für die weitere Nutzung aufbereitet und aus aus dem temporären Assetbereich in einen regulären Assetpfad verschoben werden.

Wenn die beabsichtigten Quelldateien im `public\assets\sprites\tmp`-Bestand nicht eindeutig identifizierbar sind, ist nur diese Asset-Auswahl mit dem Benutzer zu klären; die Terrain-Architektur selbst bleibt vorgegeben.

Der Kies darf nicht bis zum Maximalradius vorausgerendert werden, sondern nur zum aktuell relevanten persistenBase-Radius.

---

# 31. Bau-Overlay

Während eines aktiven Construction-/Placement-Modus wird die aktuelle Persistent Zone zusätzlich rasterbasiert hervorgehoben.

Das Overlay:

- zeigt ausschließlich den aktuellen `radiusCells`,
- verwendet dieselbe Zone-Funktion wie Persistenz und Kies,
- ist rein visuell,
- ist relativ schlicht, zeigt ein leichtes Raster und eine leichte Grün-Färbung
- beeinflusst keine Validation.

Außerhalb der Zone bleibt normales Placement weiterhin möglich.

Es wird lediglich als Mission Build klassifiziert.

---

# 32. Temporäre Map 18

Map 18 ist die **Foundation-Testmap**.

Anforderungen:

- echte Map-ID `18`
- regulär in Registry
- sehr geringe Komplexität
- eine freundliche Main Base
- `persistentBase.baseId` auf diese Basis
- ausreichend große reservierte Fläche
- wenig zufällige Geometrie
- kurze, leicht gewinnbare Mission
- keine komplexen Secondary Objectives
- keine permanenten Rewards

Map 18 soll primär ermöglichen:

```text
bauen
zerstören
rückbauen
inside/outside testen
Mission schnell gewinnen/verlieren
```

---

# 33. Temporäre Map 19

Map 19 ist die **Restore-Testmap**.

Anforderungen analog Map 18, aber:

- anderer absoluter Base-Anchor oder andere Arenaabmessung,
- gleiches Persistent-Base-Konzept,
- kurze Mission.

Hauptzweck:

```text
Map 18 Commit
→ Map 19
→ relativer Restore sichtbar
```

Map 19 muss keine eigenen neuen Persistent-Base-Mechaniken einführen.

---

# 34. Map 16 und 17 in Phase 1

Map 16 und 17 werden in Phase 1 **noch nicht** auf das neue System umgebaut.

Die technische Architektur darf sie bereits unterstützen, aber ihre eigentliche Persistent-Base-Integration gehört zu Phase 3.

Damit bleibt Phase 1 auf die technische Teststrecke 18/19 fokussiert.

---

# 35. Implementierungsreihenfolge

Die Umsetzung soll in dieser Reihenfolge erfolgen.

## Schritt 1 – Save-Vertrag

- Progress V3
- PersistentBaseState
- PersistentConstruction
- Repository
- Reset
- Export/Import
- Tests

## Schritt 2 – Zone und Map-Vertrag

- Persistent-Base-Mapconfig
- Base-ID-Auflösung
- Zone-Helper
- Radiuskonfiguration
- Validation

## Schritt 3 – Generator-Reservation

- MAX + 2
- generierte Blocker ausschließen
- authored Konflikte prüfen

## Schritt 4 – Runtime Session

- Committed State
- Working State
- Runtime-Metadaten
- Persistent Candidate beim Placement

## Schritt 5 – Restore Planner

- Unlock
- Radius
- Capacity
- placementOrder
- Kollisionen
- Dormancy

## Schritt 6 – Runtime-Materialisierung

- gemeinsamer Placement-/Restore-Erzeugungspfad
- Turrets
- Utilities
- Power-up-Podeste
- abhängige Systeme

## Schritt 7 – Commit/Rollback

- Victory
- Defeat
- Destroy
- Dismantle
- neue Bauten
- dormant Einträge

## Schritt 8 – Map 18/19

- Registry
- Unlock-Kette
- technische Arenen

## Schritt 9 – Visualisierung

- Kies
- Zone-Overlay

## Schritt 10 – Integrations- und Regressionstests

---

# 36. Automatisierte Tests

Mindestens folgende Testgruppen ergänzen.

## Persistenz-Repository

- Default-State
- V3 Encode/Decode
- Export/Import
- V2 wird nicht als V3 geladen
- Reset löscht Basis
- duplicate persistentId wird abgefangen
- beschädigte Daten crashen nicht

## Zone

- Anchor-Zelle liegt innerhalb
- Grenzzellen korrekt
- außerhalb korrekt
- Footprint teilweise außerhalb → nicht persistent
- MAX-Radius unabhängig von aktuellem Radius

## Restore Planner

- stabile `placementOrder`
- Unlock-Gate
- Radius-Gate
- Capacity-Gate
- dormante Einträge bleiben erhalten
- Zellkonflikt deterministisch
- identisches Input → identischer Restore Plan

## Commit

- neuer Innenbau + Sieg → gespeichert
- Außenbau + Sieg → nicht gespeichert
- Innenbau + Niederlage → nicht gespeichert
- restored Konstrukt zerstört + Sieg → entfernt
- restored Konstrukt zerstört + Niederlage → bleibt
- Rückbau + Sieg → entfernt
- Rückbau + Niederlage → bleibt
- dormant Eintrag + Sieg → bleibt im Save

---

# 37. Manuelle Integrationsabnahme

Phase 1 gilt erst als abgeschlossen, wenn folgende reale Abläufe funktionieren.

## A – Basis-Persistenz

```text
Map 18
→ innerhalb Zone bauen
→ Sieg
→ Map 19
```

Erwartung:

- Konstrukt vorhanden
- korrekte relative Position
- volle HP
- normale Funktion

---

## B – Mission Build

```text
Map 18
→ außerhalb Zone bauen
→ Sieg
→ Map 19
```

Erwartung:

```text
Objekt nicht vorhanden
```

---

## C – Reload

```text
Map 19 mit persistenter Basis
→ Browser Reload
```

Erwartung:

```text
Committed Base identisch restauriert
```

---

## D – Neuer Raum

```text
Lobby
→ neuen Raum erzeugen
→ Persistent-Base-Map starten
```

Erwartung:

```text
Committed Base vorhanden
```

---

## E – Niederlagen-Rollback

```text
Committed Turm vorhanden
→ Mission starten
→ Turm zerstören
→ verlieren
→ Mission neu starten
```

Erwartung:

```text
Turm wieder vorhanden und vollständig repariert
```

---

## F – Verlust nach Sieg

```text
Committed Turm vorhanden
→ Turm zerstören
→ Mission gewinnen
→ nächste Persistent-Base-Map
```

Erwartung:

```text
Turm dauerhaft entfernt
```

---

## G – Radius-Klassifizierung

```text
aktueller Radius R
→ Objekt knapp außerhalb bauen
→ Sieg
→ Radius später erhöhen
```

Erwartung:

```text
altes Außenobjekt bleibt nicht persistent
```

---

## H – Blueprint größer als Capacity

Einen Save mit mehr gültigen Konstruktionen als aktueller Capacity laden.

Erwartung:

- deterministische Auswahl
- keine Capacity-Überschreitung
- überzählige Einträge dormant
- überzählige Einträge nicht aus Save gelöscht

---

## I – Unlock

Gespeichertes aktuell nicht freigeschaltetes Konstrukt laden.

Erwartung:

```text
nicht materialisiert
nicht gelöscht
```

---

## J – Relative Position

Map 18 und Map 19 besitzen unterschiedliche absolute Anchor-Positionen.

Erwartung:

```text
Konstrukt bleibt relativ zur Basis an derselben Rasterposition
```

Nicht:

```text
an derselben absoluten Weltposition
```

---

# 38. Regression-Anforderungen

Nach Phase 1 müssen insbesondere weiterhin funktionieren:

- Maps 0–17 ohne Persistent-Base-Konfiguration
- normale Inspector-Placements
- Dismantle
- Construction Capacity
- Upgrade Unlocks
- Power-up-Podeste
- Flowfields
- Energie-Injektor
- Turret Targeting
- bestehende Placement Preview
- Multiplayer-Replikation normaler Placeables
- Save Export/Import im neuen V3-Format
- normale Arena-TearDown-/Build-Lifecycles

Eine Map ohne `persistentBase` darf funktional keinen neuen Persistent-Base-Lifecycle benötigen.

---

# 39. Architektur-Invarianten

Nach Abschluss von Phase 1 müssen folgende Aussagen wahr sein:

```text
localPreferences bleibt einzige Storage-Grenze.
```

```text
Persistenz speichert Blueprint, keine Runtime.
```

```text
Restore erzeugt neue normale Runtime-Objekte.
```

```text
Persistent Anchor stammt aus einer existierenden Main Base.
```

```text
Persistenzentscheidung erfolgt beim Placement.
```

```text
Sieg verändert Committed State.
```

```text
Niederlage verändert ihn nicht.
```

```text
Dormant bedeutet niemals gelöscht.
```

```text
Capacity und Unlocks werden nicht durch Save-Daten umgangen.
```

```text
Generator plant immer für MAX_RADIUS + Clearance.
```

```text
Map 18 und 19 sind temporäre Integrationsmaps.
```

```text
Phase 1 führt keine Guest- oder Reward-Persistenz ein.
```

---

# 40. Definition of Done

Phase 1 ist abgeschlossen, wenn:

1. Progress V3 inklusive Persistent Base produktiv gespeichert werden kann.
2. Map 18 und 19 reguläre Kampagnenmaps sind.
3. beide Maps denselben Persistent-Base-Blueprint an unterschiedlichen Anchors verwenden können.
4. Host-Bauten innerhalb der Zone nach einem Sieg erhalten bleiben.
5. Bauten außerhalb der Zone nicht übernommen werden.
6. Niederlagen vollständig auf die letzte Committed Baseline zurückrollen.
7. Restore volle HP verwendet.
8. Reload und neuer Raum funktionieren.
9. Unlock-, Radius- und Capacity-Gates funktionieren.
10. dormant Blueprint-Einträge nicht verloren gehen.
11. Inspector-Podeste und andere unterstützte dauerhafte Placeables über normale Runtime-Systeme restauriert werden.
12. Kies und Build-Overlay dieselbe Zone visualisieren, die auch die Persistenzlogik verwendet.
13. der Generator `MAX_RADIUS + 2` dauerhaft freihält.
14. bestehende Maps ohne Persistent Base keine Regression zeigen.
15. keine Architektur aus Phase 2 oder 3 vorgezogen wurde.

Mit diesem Stand ist das Persistenzfundament abgeschlossen.

Phase 2 kann anschließend auf demselben Session-/Blueprint-/Restore-Modell Ownership, Guest-Session-Bauten, Nicht-Inspector-Bauen und klassenabhängige Capacity ergänzen, ohne Phase 1 neu entwerfen zu müssen.