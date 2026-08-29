# Fragdachse – GDD Persistente Basis
## Phase 3E – Build-Area-Progression

**Status:** Implementierungs-GDD  
**Voraussetzung:** Phase 3C und 3D abgeschlossen  
**Ziel:** Freischaltbare Erweiterung der bebaubaren Persistent-Base-Fläche ohne neue Placement-/Restore-Architektur.

---

## 1. Zielbild

Die Persistent Base besitzt zwei Area-Stufen:

| Stage | Build Area | Freischaltung |
|---|---|---|
| `0` | `square`, 3×3 Zellen | mit Freischaltung der Persistent Base |
| `1` | `radius`, Radius 5 Zellen | nach Sieg auf Map 10 |

Die aktive Fläche wird aus dem Campaign Progress des Hosts abgeleitet:

```text
Campaign Progress
→ Persistent Base Area Stage
→ Host Session Capability
→ PersistentBaseBuildArea
```

Die aktuelle Mapnummer darf die Area-Stufe nicht direkt bestimmen.

---

## 2. Area-Stage-Domain

Die Progression wird als semantische Area Stage modelliert, nicht als bloßer Radiuswert.

Beispiel:

```ts
type PersistentBaseAreaStage = 0 | 1;
```

Zentrale Auflösung:

```text
Stage 0 → { kind: 'square', sizeCells: 3 }
Stage 1 → { kind: 'radius', radiusCells: 5 }
```

Die Stage ist der persistente Progressionswert.  
Die konkrete `PersistentBaseBuildArea` wird daraus für die jeweilige World abgeleitet.

Die Auflösung soll zentral bleiben, damit spätere Area-Stufen ergänzt werden können, ohne Placement oder Restore erneut umzubauen.

---

## 3. Freischaltung auf Map 10

Ein erfolgreicher Abschluss von **Map 10** schaltet für jeden berechtigten Spieler dauerhaft frei:

- Persistent Base Area Stage 1
- Inspector Gadachs

Inspector Gadachs wird damit von seiner bisherigen Freischaltung nach Map 8 auf Map 10 verschoben.

Die bestehenden generischen Campaign-/Klassen-Unlock-Pfade sollen weiterverwendet werden. Es darf kein Inspector-spezifischer Sonderpfad entstehen.

Die Freischaltung ist ein persistiertes Entitlement. Heuristiken wie `currentMap >= 10` oder `highestMap >= 10` dürfen nicht als Ersatz verwendet werden.

---

## 4. Multiplayer- und Aktivierungslogik

Jeder berechtigte Spieler erhält nach dem Sieg auf Map 10 seine persönliche Area-Stage-Freischaltung.

Für die gemeinsam genutzte Persistent Base gilt jedoch ausschließlich der Campaign-Stand des Hosts:

```text
Host Stage 0 + Guest Stage 1 → aktive Area Stage 0
Host Stage 1 + Guest Stage 0 → aktive Area Stage 1
```

Die größere Fläche wird **nicht während der laufenden Map 10** aktiviert.

Ablauf:

```text
Map 10 läuft
→ bisherige Area bleibt aktiv

Sieg
→ Stage 1 wird gespeichert
→ ResultScreen zeigt Reward

anschließende LobbyWorld
→ Host Stage wird neu aufgelöst
→ Stage 1 erstmals aktiv
```

Eine World behält ihre Build Area für ihre gesamte Lebensdauer unverändert.

---

## 5. Bestehende Systeme weiterverwenden

Phase 3E führt keine neue Persistent-Base-Architektur ein.

Unverändert weiterzuverwenden sind insbesondere:

- `PersistentBaseBuildArea`
- Square-/Radius-Geometrie
- Placement-Prüfung
- Persistent-Base Composite
- Restore / Materialisierung
- Conflict Handling
- persönliche Konstruktionen
- Base Pedestals
- Base Turrets
- Gravel-/Ground-Darstellung
- bestehende World-/Host-Replikationsarchitektur

Die aktive `PersistentBaseBuildArea` bleibt die gemeinsame Geometriequelle.

### Konstruktionen außerhalb der aktiven Area

Gespeicherte Konstruktionen außerhalb der aktuell aktiven Build Area:

- bleiben gespeichert,
- werden nicht verschoben,
- werden nicht gelöscht,
- werden lediglich nicht materialisiert.

Der bestehende `outside-build-area`-Konflikt soll weiterverwendet werden.

### Base Pedestals

Base Pedestals verwenden weiterhin die normale Build Area und profitieren automatisch von Stage 1.

### Base Turrets

Base Turrets bleiben unverändert auf den vorhandenen `base-surface`-Zellen des Basiskerns beschränkt. Die größere Build Area erzeugt keine zusätzlichen Turret-Slots.

---

## 6. Maps und Darstellung

Die vorhandene Gravel-/Ground-Darstellung soll die aufgelöste Stage-1-Area (`radius 5`) ohne eigenes neues Visualsystem darstellen.

Eine allgemeine Überarbeitung der Campaign-Maps gehört nicht zu 3E.

Die bestehende Persistent-Base-Reservierung ist bereits für größere Radien ausgelegt. Deshalb genügt ein Regressionstest für:

- Map 2–8
- Map 10–17
- LobbyWorld

Nur konkret gefundene Konflikte mit authored Map-Inhalten werden korrigiert.

Map 9 bleibt ohne Persistent Base.

Eine Persistent-Base-Map darf eine bereits vom Host freigeschaltete Area-Stufe nicht künstlich verkleinern.

---

## 7. ResultScreen

Beim erstmaligen Sieg auf Map 10 soll der ResultScreen die Flächenerweiterung als eigenen Reward anzeigen, z. B.:

**BASISGELÄNDE ERWEITERT**

Zusätzlich erscheint über den bestehenden Class-Unlock-Pfad die Freischaltung von Inspector Gadachs.

Der vorhandene ResultScreen-Reward-Mechanismus soll lediglich um einen Area-Expansion-Delta ergänzt werden; kein neues Reward-System.

---

## 8. Persistenz und Save-Kompatibilität

Die Area Stage wird dauerhaft im persönlichen Campaign Progress gespeichert und darf nach einer Freischaltung nicht wieder sinken.

Für Phase 3E ist **keine Migration bestehender Test-Saves erforderlich**. Alte Teststände dürfen zurückgesetzt werden.

Legacy-Radiuswerte sollen deshalb keine zusätzliche Migrations- oder Kompatibilitätslogik verursachen.

---

## 9. Implementierungsschritte

### 3E-1 – Area Progression & World Resolution

- Area-Stage-Domain einführen
- Stage 0 → `square 3`
- Stage 1 → `radius 5`
- Stage persistent speichern
- Sieg auf Map 10 schaltet Stage 1 frei
- Inspector-Unlock auf Map 10 verschieben
- Host Stage bestimmt die aktive Build Area
- Aktivierung erst mit der nächsten World
- bestehende Placement-/Composite-/Restore-Systeme weiterverwenden

### 3E-2 – Presentation & Regression

- ResultScreen-Reward für Area-Erweiterung ergänzen
- i18n ergänzen
- Inspector-Unlock-Tests anpassen
- Stage-0-/Stage-1-Resolution testen
- Host-/Guest-Semantik testen
- Aktivierung nach Lobby-Wechsel testen
- gespeicherte Konstruktionen außerhalb der aktiven Area testen
- Pedestal- und Turret-Regeln absichern
- Gravel-Darstellung mit Radius 5 testen
- Campaign-Maps auf Stage-1-Clearance regressionsprüfen

---

## 10. Nicht Bestandteil von 3E

- Repositioning bestehender Konstruktionen
- Radial Menu V2
- universeller Zugriff auf Basenbau
- weitere Area-Stufen
- neue Permanent Rewards
- neue Placement-/Restore-Systeme
- allgemeiner Map-Umbau
- Legacy-Save-Migration

Diese Themen bleiben Phase 3F oder späteren Erweiterungen vorbehalten.

---

## 11. Definition of Done

Phase 3E ist abgeschlossen, wenn:

- Stage 0 weiterhin der bisherigen 3×3-Build-Area entspricht,
- Sieg auf Map 10 dauerhaft Stage 1 freischaltet,
- Stage 1 eine kreisförmige Build Area mit Radius 5 verwendet,
- Inspector Gadachs ebenfalls erst nach Map 10 freigeschaltet wird,
- jeder berechtigte Spieler seinen persönlichen Unlock erhält,
- ausschließlich die Stage des Hosts die gemeinsame Session-Area bestimmt,
- die größere Fläche erst ab der anschließenden LobbyWorld aktiv ist,
- bestehende Konstruktionen außerhalb der aktiven Area gespeichert bleiben,
- Base Pedestals die größere Area nutzen können,
- Base Turrets weiterhin nur `base-surface` verwenden,
- Gravel-/Ground-Darstellung die neue Area korrekt übernimmt,
- der ResultScreen die erstmalige Erweiterung als Reward anzeigt,
- die produktiven Persistent-Base-Maps Radius 5 ohne Regression unterstützen,
- und keine parallelen Placement-, Restore-, Geometry-, Reward- oder Multiplayer-Systeme eingeführt wurden.
