# FRAGDACHSE

**Game Design Document**

## Coop Defense – Ausbaustufe C · Dynamische Map-Ereignisse

**Version 2 – gestrafft auf vier Implementierungsschritte**

> **Leitidee**
>
> Ausbaustufe A strukturiert die Pflichtangriffe, Ausbaustufe B ergänzt freiwillige Nebenmissionen.
> Ausbaustufe C macht nun auch die **Arena selbst zu einem authored Teil der Dramaturgie**:
> Zugfahrten, Luftangriffe und Gefahrenflächen können gezielt durch Zeitpunkte, Encounter oder Bossphasen ausgelöst werden.
>
> C baut dafür **keine neue Effekt-Engine und keine Map-Skriptsprache**. Die vorhandenen Fachsysteme bleiben bestehen.
> Neu ist nur eine kleine gemeinsame Event-Schicht, die festlegt:
>
> **Wann startet welches Setpiece, wie wird es angekündigt und wann gilt es als beendet?**

**Designstatus:** Zielkonzept / Implementierungsgrundlage  
**Voraussetzung:** Ausbaustufe B technisch abgeschlossen.  
**Scope:** gemeinsame Event-Orchestrierung für **Zug, Airstrike und Ground Hazard**.

---

# 1. Ziele und Leitplanken

## 1.1 Ziele

- Die Arena kann sich während einer Runde authored verändern.
- Zug, Airstrike und Ground Fire werden über eine gemeinsame Map-Event-Konfiguration ausgelöst.
- Encounter können Events auslösen und auf abgeschlossene Events reagieren.
- Trigger und Lifecycle sind host-autoritativ.
- Gefährliche Events werden vor ihrer Wirkung klar telegraphiert.
- Bestehende Fachsysteme bleiben Eigentümer ihrer Mechanik.
- Nach der Migration bleiben keine parallelen Legacy-Sonderfelder bestehen.

## 1.2 Leitplanken

**Orchestrierung statt Neuimplementierung**

```text
MapEventDirector
    ↓ wann?
Train / Airstrike / Ground-Fire-System
    ↓ wie?
bestehende Fachmechanik
```

Der EventDirector implementiert keine Zugbewegung, Bombenwirkung oder Burn-Logik.

**Authored statt zufällig ausgewählt**

Welche Events existieren und wodurch sie starten, gehört zur Map. Zufall darf nur innerhalb eines Events vorkommen,
z. B. bei der Streuung einzelner Bombeneinschläge.

**Keine Action-Skriptsprache**

Keine frei kombinierbaren JSON-Actions wie:

```text
wait
spawn
branch
toggle
goto
```

C verwendet nur wenige feste Eventtypen und Trigger.

**Events pausieren den Encounterplan nicht automatisch.**

**Events sind keine Secondary Objectives.**

- kein Accept,
- kein Fail,
- kein Reward,
- kein Meta-Fortschritt.

## 1.3 Nicht-Ziele

Nicht Teil von C:

- Elite-/Champion-System,
- Challenge-Waves,
- Encounter-Varianten,
- prozedurale oder zufällig ausgewählte Events,
- allgemeine Quest-/Action-Skriptsprache,
- dynamische Tageszeit während einer Runde,
- mehrfaches An-/Ausschalten derselben Hazard-Definition,
- Trigger aus Secondary-Objective-Zuständen,
- `after-event` auf einzelne Wiederholungen eines Repeat-Events,
- vollständiges Kampagnenrework.

Das Kampagnenrework bleibt Ausbaustufe D.

---

# 2. Gemeinsames Event-Modell

## 2.1 Verantwortungsgrenzen

```text
CoopDefenseRoundStateSystem
→ Sieg / Niederlage

CoopDefenseMapDirector
→ Pflicht-Encounter

SecondaryObjectiveSystem
→ optionale B-Ziele und Rewards

CoopDefenseMapEventDirector
→ Event-Trigger, Event-Lifecycle, kleiner Präsentationszustand

Train-System
→ Zugmechanik

Airstrike-System
→ Warnung, Einschlag, Schaden, Sync

Ground-Fire-System
→ Gefahrenzellen, Burn, Schaden, Visuals

Boss-System
→ Bossphasen; liefert nur semantischen Zustand
```

Der MapDirector und EventDirector dürfen sich gegenseitig nur über semantische Zustände referenzieren.

## 2.2 Lifecycle

```text
dormant → scheduled → active → completed
                      ↓
                 waiting-repeat
```

| Zustand | Bedeutung |
|---|---|
| `dormant` | Startbedingung noch nicht erfüllt. |
| `scheduled` | Event ist angekündigt und wartet auf seinen Wirkzeitpunkt. |
| `active` | Fachmechanik läuft. |
| `waiting-repeat` | Wiederholbares Event wartet auf den nächsten Durchlauf. |
| `completed` | Endliches Event endgültig abgeschlossen. |

**Endliche Events**

- einmaliger Zug,
- einmaliger Airstrike-Barrage,
- zeitlich begrenzter Ground Hazard.

**Persistente / wiederholbare Events**

- Zug mit `repeatAfterExitMs`,
- Player-Hunt-Airstrikes,
- Ground Hazard ohne Dauer.

Nur endliche Events dürfen als `after-event`-Triggerquelle verwendet werden.

Rundenende beendet alle Events ohne Reward oder Persistenz.

## 2.3 Trigger

C unterstützt genau:

```text
time
after-encounter
after-event
boss-phase
base-destroyed
```

Regeln:

- `time` nutzt aktive Rundenzeit ohne Countdown.
- `after-encounter` liest `isEncounterCleared(id)`.
- `after-event` liest `completed` eines endlichen Events.
- `boss-phase` liest nur einen persistenten Bossphasen-Zustand.
- `base-destroyed` referenziert eine stabile Base-ID.
- `after-previous` bleibt Encounter-spezifisch.
- Secondary Objectives werden nicht zu Eventtriggern.

Optional kann ein Event nach erfülltem Trigger noch ein `delayMs` besitzen.

Beispiel:

```text
Encounter clear
→ 5 s Warnzeit
→ Zug fährt ein
```

Direkte und indirekte Triggerzyklen werden abgelehnt.

---

# 3. Die drei Eventtypen

## 3.1 Zug

Der Zug bleibt ein spezialisiertes Fachsystem.

C verändert nur sein Authoring:

```json
{
  "id": "rb54",
  "type": "train",
  "start": { "type": "after-encounter", "encounterId": "north-pressure" },
  "delayMs": 5000,
  "repeatAfterExitMs": 10000
}
```

Regeln:

- vorhandene Zugbewegung, Kollision, Schaden und Netzreplikation bleiben bestehen,
- Wiederholung bleibt relativ zum tatsächlichen Verlassen der Arena,
- einmaliger Zug erreicht nach dem Exit `completed`,
- wiederholbarer Zug bleibt bis Rundenende aktiv,
- `trackMode` bleibt Geometrie,
- Gleise ohne Zug sind erlaubt,
- `trackMode: void-fire` + Zug ist ungültig.

Kein generisches Moving-Hazard-System.

---

## 3.2 Airstrike

Die eigentlichen Einschläge bleiben im vorhandenen Airstrike-System.

C unterstützt drei feste Muster.

### `tutorial-sweep`

Erhält das heutige Eröffnungsbombardement:

- mehrere Einschläge,
- Sweep über den Tutorial-Felsbereich,
- hoher Felsschaden,
- `completed` nach dem letzten Einschlag.

### `player-hunt`

Erhält die heutigen Jagd-Airstrikes:

- Ziel nahe eines lebenden Spielers,
- Basisbereiche möglichst meiden,
- authored `intervalMs`,
- wiederholt sich bis Rundenende.

### `zone-barrage`

Neuer kleiner wiederverwendbarer C-Inhalt:

- authored Zielzone,
- feste Anzahl Einschläge,
- Streuung innerhalb der Zone,
- optional geordneter Sweep,
- `completed` nach dem letzten Einschlag.

Beispiel:

```json
{
  "id": "north-barrage",
  "type": "airstrike",
  "start": { "type": "after-encounter", "encounterId": "pressure-2" },
  "delayMs": 2500,
  "pattern": "zone-barrage",
  "strikeCount": 6,
  "area": {
    "gridX": 8,
    "gridY": 2,
    "widthCells": 12,
    "heightCells": 8
  }
}
```

Keine frei authorbare Strike-Sequenz.

---

## 3.3 Ground Hazard

Ground Hazards machen die vorhandene Ground-Fire-/Void-Fire-Mechanik zeitlich aktivierbar.

Die Zone wird deterministisch beim Arena-Aufbau erzeugt und startet inaktiv.

Vor Aktivierung:

- kein Schaden,
- kein Burn,
- keine aktive Feuerdarstellung.

Nach Aktivierung:

- vorhandene Ground-Fire-Logik,
- normaler oder Void-Fire-Look,
- host-autoritatives Gameplay.

Unterstützte Formen:

```text
random-patches
rectangle
cells
```

Dauer:

```text
durationMs fehlt
→ aktiv bis Rundenende

durationMs gesetzt
→ aktiv → Zeit abgelaufen → completed
```

Eine Hazard-Definition wird in C nur einmal aktiviert und nicht später erneut getoggelt.

Beispiel:

```json
{
  "id": "void-fire-phase-two",
  "type": "ground-hazard",
  "start": { "type": "boss-phase", "phase": 2 },
  "delayMs": 2500,
  "durationMs": 20000,
  "area": {
    "type": "rectangle",
    "gridX": 35,
    "gridY": 8,
    "widthCells": 8,
    "heightCells": 20
  },
  "effect": {
    "visualStyle": "void",
    "burnDurationMs": 2000,
    "burnDamagePerTick": 0.5
  }
}
```

---

# 4. Event- und Encounter-Kopplung

## 4.1 Encounter → Event

```text
Encounter A cleared
→ Event B startet
```

über:

```text
after-encounter
```

## 4.2 Event → Encounter

```text
Opening Barrage completed
→ Encounter B startet
```

über:

```text
after-event
```

Damit ersetzt C den heutigen Spezialtrigger:

```text
opening-airstrike-complete
```

durch:

```text
after-event(opening-barrage)
```

Der MapDirector kennt danach keine Airstrike-Sondersemantik mehr.

## 4.3 Bossphase

Bossphasen bleiben im Boss-System.

```text
Leerenjäger erreicht Phase 2
→ Ground-Hazard-Event startet
```

Der EventDirector kennt nur:

```text
hasBossReachedPhase(2)
```

und keine Boss-HP oder Fähigkeiten.

## 4.4 Base-Destroyed

Eine stabile Base-ID darf ein Event auslösen.

```text
äußerer Brutposten fällt
→ Notfall-Barrage
```

Keine Last-Hit- oder Reward-Logik.

---

# 5. Präsentation und Multiplayer

## 5.1 Telegraphing

Events erhalten keinen dritten großen Objective-Slot.

Priorität:

1. Welt-Telegraph,
2. Audio,
3. kurze Event-Ankündigung,
4. Countdown nur wenn für die Reaktion relevant.

Beispiele:

```text
RB 54 · ANKUNFT in 5 s
WARNUNG · BOMBERANFLUG NORD
LEERENBRAND AKTIVIERT
```

Mehrere Events dürfen gleichzeitig laufen, aber es gibt keine permanente Eventliste.

## 5.2 Kleiner Präsentationssnapshot

Der Host repliziert nur:

```text
eventId
eventType
state
occurrence
stateChangedAtMs
nextActionAtMs?
```

Statische Eventdaten kennt der Client aus der Map-Konfiguration.

Die Fachsysteme behalten ihre vorhandenen Netzpfade.

## 5.3 Host-Autorität und Latejoin

Der Host entscheidet über:

- Trigger,
- Scheduling,
- Lifecycle,
- Wiederholungsplanung,
- Event-Completion.

Clients führen keine Trigger- oder Completion-Logik aus.

Latejoiner erhalten den aktuellen Zustand, aber keine alten Ankündigungen.

`eventId` + `occurrence` verhindern doppelte Zugfahrten, Barrages oder Hazard-Aktivierungen bei Snapshot/Reconnect.

---

# 6. Map-Konfiguration, Validierung und Migration

## 6.1 Konfiguration

```text
Map
├─ Geometrie
├─ Basen
├─ Hauptziel
├─ Encounter
├─ Secondary Objectives
└─ Map Events
```

Gemeinsame Struktur:

```text
MapEvent
├─ id
├─ type: train | airstrike | ground-hazard
├─ start
├─ delayMs?
└─ typspezifische Daten
```

## 6.2 Validierung

Mindestens abzulehnen:

- leere oder doppelte Event-IDs,
- unbekannte Eventtypen,
- unbekannte Encounter-/Event-/Base-Referenzen,
- `after-event` auf persistente oder wiederholbare Events,
- direkte oder indirekte Triggerzyklen,
- Zug ohne gültige Gleisgeometrie,
- Zug bei `trackMode: void-fire`,
- ungültige Airstrike-Parameter,
- Ground Hazard außerhalb der Arena oder ohne gültige Zellen,
- `durationMs <= 0`,
- `intervalMs <= 0`,
- negative Delays.

Fail-closed zur Laufzeit: unbekannte oder ungültige Events starten nicht.

## 6.3 Migration

C ersetzt die heutigen Sonderfelder vollständig:

```text
map.train
→ mapEvents[type=train]

map.enemyAirstrikes.bombTutorialRock
→ mapEvents[type=airstrike, pattern=tutorial-sweep]

map.enemyAirstrikes.huntIntervalMs
→ mapEvents[type=airstrike, pattern=player-hunt]

map.permanentGroundFire
→ mapEvents[type=ground-hazard, start=time 0]

EncounterStart.opening-airstrike-complete
→ EncounterStart.after-event(opening-barrage)
```

Nach jeder Migration wird der alte Pfad entfernt; keine langfristige Kompatibilitätsschicht.

---

# 7. Codebase-Anker und Referenzmaps

Der aktuelle Code bietet bereits fast alle Fachmechaniken:

| Bedarf | Vorhanden |
|---|---|
| semantische Encounter-Trigger | ja |
| `after-encounter` | ja |
| Bossphase als persistenter Zustand | ja |
| `base-destroyed` | ja |
| Zug mit Exit-basierter Wiederholung | ja |
| Zug-Countdown | ja |
| Airstrike Warnung/Schaden/Sync | ja |
| Opening-Barrage | ja |
| Player-Hunt-Airstrikes | ja |
| Ground-Fire-Zonen | ja |
| normaler / Void-Fire-Look | ja |
| gemeinsamer EventDirector + Event-Snapshot | **neu** |

Referenzfälle:

**Map 11 – Bombergeschwader**

```text
opening-assault
→ opening-barrage
→ after-event(opening-barrage)
→ post-barrage-assault
```

**Map 12 – Gegenschlag**

Behavior-preserving Migration von Zug und Player-Hunt.

**Map 15 – Leerenjäger**

```text
permanentGroundFire
→ ground-hazard, start=time 0, ohne durationMs
```

Neue bossphasenabhängige Hazard-Zonen werden zunächst nur auf `00-test.json` geprüft.

---

# 8. Implementierungsreihenfolge

C wird bewusst in **vier technische Schritte** geteilt. Jeder Schritt wird separat umgesetzt und validiert.

## C1 – Event-Grundlage + Zug

Umfang:

- `mapEvents`-Union und Normalisierung,
- `CoopDefenseMapEventDirector`,
- Lifecycle und kleiner Event-Snapshot,
- Trigger `time` und `after-encounter`,
- `delayMs`,
- Zug als erster Event-Handler,
- einmalige und wiederholbare Zugfahrt,
- `map.train` migrieren und entfernen,
- grundlegende Validierung.

**Praxis-Test `00-test.json`:**

```text
Encounter 1 clear
→ 5 s Warnzeit
→ einmaliger Zug
→ Event completed
```

**Fertig wenn:**  
Der erste vollständige Host-/Client-Slice läuft und der EventDirector enthält keine Zug-Fachlogik.

---

## C2 – Airstrikes + `after-event`

Umfang:

- Airstrike-Handler,
- `tutorial-sweep`,
- `player-hunt`,
- `zone-barrage`,
- Barrage-Completion nach letztem Einschlag,
- Encounter-Trigger `after-event`,
- Event↔Encounter-Zyklusvalidierung,
- Map 11 auf `after-event(opening-barrage)` migrieren,
- `enemyAirstrikes` und `opening-airstrike-complete` entfernen.

**Praxis-Test `00-test.json`:**

```text
Encounter 1 clear
→ Zone-Barrage
→ Event completed
→ Encounter 2 startet
```

Zusätzlich ein wiederkehrender Player-Hunt.

**Fertig wenn:**  
Der MapDirector keine Airstrike-Sonderbedingung mehr kennt.

---

## C3 – Ground Hazards + semantische Trigger

Umfang:

- Ground-Hazard-Handler,
- prebuilt/inaktive Zonen,
- `random-patches`, `rectangle`, `cells`,
- optionale Dauer,
- normaler und Void-Fire-Look,
- Trigger `boss-phase` und `base-destroyed`,
- `permanentGroundFire` migrieren und entfernen,
- Zonen-/Trigger-Validierung.

**Praxis-Test `00-test.json`:**

```text
Trigger
→ Warnzeit
→ Hazard 15–20 s aktiv
→ completed
```

Zusätzlich ein permanenter Hazard als Ersatz des heutigen Map-15-Verhaltens.

**Fertig wenn:**  
Dynamische Gefahrenflächen ohne neue Runtime-Geometrie- oder Boss-Sonderlogik funktionieren.

---

## C4 – Integration, Multiplayer und Cleanup

Umfang:

- gemeinsame Event-Ankündigungen,
- Latejoin während Zug/Barrage/Hazard,
- Snapshot-/Reconnect-Idempotenz,
- Reset/Teardown,
- Performance- und Regressionstests,
- vollständige Kampagnenvalidierung,
- behavior-preserving Migration der betroffenen Maps,
- Prüfung auf verbliebene Legacy-Eventpfade,
- `00-test.json` enthält alle Eventfamilien und mindestens eine Event→Encounter-Kette.

**Fertig wenn:**  
C technisch vollständig abgeschlossen ist und danach keine Architektur- oder Funktionsänderungen mehr nötig sind.

---

## C5 – Manuelles Balancing und Setpiece-Finetuning

**Kein weiterer Vibe-KI-Architekturschritt.**

Nur noch Werte und konkrete Map-Auswahl:

- Zug-Warnzeit,
- Wiederholungsintervalle,
- Barrage-Anzahl und Streuung,
- Player-Hunt-Intervall,
- Hazard-Schaden,
- Hazard-Dauer,
- Telegraph-Dauer,
- Zonenpositionen,
- Auswahl weniger Maps für neue dynamische Setpieces.

Keine neuen Eventtypen, Trigger, Netzpfade oder Systemumbauten.

---

# 9. Definition of Done

C ist fertig, wenn:

- Zug, Airstrike und Ground Hazard datengetrieben über `mapEvents` laufen,
- EventDirector nur Trigger/Lifecycle/Präsentation besitzt,
- `time`, `after-encounter`, `after-event`, `boss-phase`, `base-destroyed` funktionieren,
- ungültige Referenzen und Triggerzyklen abgelehnt werden,
- einmalige Events sauber `completed` erreichen,
- wiederholbare/persistente Events nicht fälschlich Completion liefern,
- Airstrike-Barrage erst nach dem letzten Einschlag abgeschlossen ist,
- Ground Hazards vor Aktivierung ungefährlich und danach synchron wirksam sind,
- Latejoin/Reconnect kein Event doppelt auslösen,
- `train`, `enemyAirstrikes`, `permanentGroundFire` und `opening-airstrike-complete` als parallele Altpfade entfernt sind,
- alle drei Eventfamilien auf `00-test.json` direkt prüfbar sind,
- nach C4 nur noch C5-Werte-Finetuning offen ist.

---

# 10. Risiken

| Risiko | Leitplanke |
|---|---|
| EventDirector wird God-Object | nur Orchestrierung; Mechanik bleibt im Fachsystem |
| JSON wird Skriptsprache | drei Eventtypen, kleine Triggerunion |
| Events überladen Maps | gezielt einsetzen, nicht nach jedem Encounter |
| `after-event` wartet für immer | nur endliche Events als Quelle |
| Bosslogik wandert ins Eventsystem | Boss liefert nur semantische Phase |
| Hazard-Geometrie braucht komplexen Runtime-Sync | prebuilt/inaktiv |
| Latejoin startet Event erneut | `eventId` + `occurrence` |
| Legacy bleibt bestehen | alter Pfad wird im jeweiligen Migrationsschritt entfernt |
| C greift D vor | C migriert Technik; vollständiges Kampagnenrework bleibt D |

---

# 11. Zielbild

> **Angriff → Veränderung → Entscheidung → Konsequenz**

```text
Encounter endet
→ Bomberwarnung
→ Barrage verändert kurzfristig einen Bereich
→ nächster Angriff startet in der veränderten Situation
```

```text
Boss erreicht Phase 2
→ Leerenbrand-Zone wird angekündigt
→ sicherer Raum wird gefährlich
→ Team rotiert
```

```text
Carry-Mission läuft
→ RB 54 wird angekündigt
→ Spieler wartet mit dem Bier
→ Zug passiert
→ Transport geht weiter
```

C ergänzt keinen neuen großen Spielmodus. Es macht die bereits vorhandenen Setpieces **authorbar, kombinierbar und technisch einheitlich**.

---

# Anhang A – Event-Matrix

| Event | Endlich? | Wiederholbar? | Besitzer |
|---|---:|---:|---|
| Zug einmalig | ja | nein | Train-System |
| Zug wiederholt | nein | ja | Train-System |
| Airstrike · Tutorial Sweep | ja | nein | Airstrike-System |
| Airstrike · Zone Barrage | ja | nein | Airstrike-System |
| Airstrike · Player Hunt | nein | ja | Airstrike-System |
| Ground Hazard · Dauer | ja | nein | Ground-Fire-System |
| Ground Hazard · persistent | nein | nein | Ground-Fire-System |

---

# Anhang B – Authoring-Muster

```text
Map
├─ Encounter A
│
├─ Event 1 · Airstrike
│  └─ start: after-encounter(Encounter A)
│
├─ Encounter B
│  └─ start: after-event(Event 1)
│
└─ Event 2 · Ground Hazard
   └─ start: boss-phase(2)
```

---

**Ende des GDD – Ausbaustufe C · Version 2**
