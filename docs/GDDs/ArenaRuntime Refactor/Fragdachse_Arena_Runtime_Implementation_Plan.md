# Fragdachse – Arena Runtime Refactoring: Implementierungsplan

**Status:** Verbindlicher Migrationsplan  
**Architekturvorgabe:** `Fragdachse_Arena_Runtime_Architecture.md`  
**Laufendes Protokoll:** `Fragdachse_Arena_Runtime_Migration_Status.md`

## 1. Arbeitsweise für Coding-KIs

Vor jeder Phase:

1. Architektur-Dokument lesen.
2. Nur die aktuelle Phase dieses Plans als Implementierungsauftrag behandeln.
3. Migrationsstatus lesen und offene Transitional Debt / bekannte Probleme berücksichtigen.
4. Bestehenden Code vor Änderungen verifizieren; keine im Plan genannten Klassen oder Pfade blind voraussetzen.

Nach jeder Phase:

1. gezielte Tests und Checks des verschobenen Vertrags ausführen;
2. Transitional Debt im Status-Dokument aktualisieren;
3. erledigte und offene Punkte extrem kompakt festhalten;
4. erkannten Änderungsbedarf an Architektur oder Plan **nur im Status-Dokument als Review-Kandidat eintragen**;
5. Architektur- und Plan-Dokument niemals automatisch ändern.

Browser-/Sichtprüfungen sind bei diesem Refactoring eine manuelle User-Abnahme. Coding-KIs
starten dafür keinen Dev-Server oder Browser. Nach erfolgreich abgeschlossenen automatisierten
Checks nennen sie dem User die visuell zu prüfenden Übergänge; eine noch ausstehende manuelle
Sichtprüfung ist transparent zu dokumentieren, aber kein Fehlschlag des automatisierten Gates.

### Stop/Go-Regel

Eine geplante Abstraktion wird nur implementiert, wenn sie beim aktuellen Umbau einen realen Zweck erfüllt. Wenn der bestehende Owner nach vorherigen Phasen bereits die Zielverantwortung sauber erfüllt, wird er bevorzugt reduziert oder transformiert statt durch einen neuen Wrapper ersetzt.

### Migrationsprinzip

Die Phasen sind Arbeitsgrenzen, keine Release-Grenzen. Temporäre Compatibility ist erlaubt, wenn:
- die Source of Truth eindeutig ist;
- der Compatibility-Pfad benannt ist;
- seine Entfernung einer späteren Phase zugeordnet ist.

Keine umfangreichen Adapter nur für einen künstlich „sauberen“ Zwischenstand.

---

## 2. Prüfstrategie

### Nach jeder Phase

Mindestens:
- TypeScript-/Build-Check für den berührten Bereich, soweit technisch sinnvoll;
- relevante bestehende Tests;
- neue Contract-Tests für neu eingeführte Lifecycle-/Ownership-Semantik;
- keine bewusst unbekannte zweite mutable Wahrheit.

### Integrations-Checkpoint A – nach Phase 4

Prüft:
- World create / attach / detach / reattach;
- World ohne Activity;
- World Identity bleibt bei lokalem Runtime-Rebuild bestehen;
- World-scoped Teardown;
- Host/Client-Grundpfad weiterhin konsistent;
- Presentation-Handoff über alle bestehenden Übergänge: Matchstart aus der LobbyWorld, Match-Exit
  auf Host und Client, Lobby-Fast-Reinstance und Lobby-Rückkehr;
- jede freigegebene Presentation erreicht genau einen terminalen Ausgang – `adopt` oder `discard`;
- nach dem Ende einer World-Instanz existiert kein mutabler World-Gameplay-State mehr;
- der Abschluss des persistenten Basisbestands verändert keine übergebene Darstellung.

Wird Checkpoint A nach einer Stabilisierung von Phase 4/5 konsolidiert nachgeholt, prüft er
zusätzlich:
- vollständiger Wechsel `Activity A → Activity B` innerhalb derselben World ohne World-Rebuild;
- alle Child-Owner von B sind frisch materialisiert und A ist vollständig zerstört;
- keine Referenz, kein Callback und kein scoped State von A verbleibt in Shared Services;
- der Presentation-Handoff enthält weder aktiven Gameplay- noch Physics-State;
- Matchstart, Match-Exit, Lobby-Rückkehr und Lobby-Fast-Reinstance sind für Host und Client durch
  Contracts beziehungsweise vorhandene Integrationspfade abgesichert;
- Exit-Fade beendet World-, Player- und Enemy-Gameplay sofort und hält ausschließlich die
  erwartete eingefrorene Darstellung.

Die visuelle Kontrolle von World-, Player- und Enemy-Darstellung im Exit-Fade führt anschließend
der User manuell im Browser durch; Coding-KIs führen diese Browserprüfung nicht aus.

### Integrations-Checkpoint B – nach Phase 7

Prüft zusätzlich:
- Coop-Mission create / update / destroy;
- Activity-Wechsel innerhalb derselben World;
- `PlayerWorldRuntime` bleibt, `PlayerActivityRuntime` wird ersetzt;
- keine offensichtlichen Activity-State-Leaks;
- Activity Presentation folgt Activity-Lifetime.

### Integrations-Checkpoint C – nach Phase 10C

Prüft zusätzlich:
- Completion / Result Application;
- Persistent-Base Commit / Rollback;
- stale Revision / stale Completion;
- übergeordnete World-/Activity-Transitions;
- Lobby-Rückkehr;
- Matchstart, Match-Exit, Lobby-Fast-Reinstance und Lobby-Rückkehr behalten ihre Presentation-/Teardown-Reihenfolge;
- `WorldPresentationHandoff` liegt am tatsächlichen Flow-Owner;
- die Coop-Simulation behält ihre fachlich notwendige Frame-Position, ohne dass der Frame-Owner interne Missionssysteme kennt;
- der verbleibende Flow materialisiert keine konkrete Enemy-/Objective-/Flowfield-/PB-Composite-/Construction-/Train-Systemliste;
- der bisherige globale manuelle Arena-Teardown ist auf Owner-Teardown bzw. wenige echte Top-Level-Schritte reduziert;
- alter Lifecycle-Coordinator plus eventueller neuer Flow liegen zusammen im Review-Zielbereich von höchstens ca. 3.000–3.500 LOC. Die Zahl ist ein Warn-Gate, kein Selbstzweck: Ein kleinerer Flow durch bloßes Verschieben in einen neuen God-Composer gilt nicht als Erfolg.

### Finaler Abnahme-Gate – nach Phase 12

Vollständige relevante Regression inklusive:
- Multiplayer Host / Client;
- World-Wechsel;
- Activity-Wechsel;
- Runtime detach / reattach;
- Participation;
- Presentation;
- Persistent Base;
- Commit / Rollback;
- stale Revision / RPC / Completion;
- Match-Ende / Lobby-Rückkehr;
- Reconnect / Late Join;
- Leak-/Teardown-Verträge.

---

# 3. Implementierungsphasen

## Phase 1 – Contracts und Migrations-Sicherheitsnetz

### Ziel

Kritische bestehende Semantik absichern, bevor Ownership verschoben wird.

### Umsetzen

Gezielte Contracts für:
- World Identity / Revision;
- Activity Identity / Revision;
- World ohne Activity;
- Runtime detach ohne Ende der World Identity;
- Activity Start / Readiness;
- World Participation und bestehende Activity-/Round-Participation;
- Presentation;
- stale Network-/Revision-Fälle;
- Teardown-Idempotenz;
- bestehende Persistent-Base Commit-/Rollback-Semantik.

Bestehende Source-Structure-Tests nur dort behalten, wo sie während der Migration echten Schutz liefern.

### Nicht tun

- keine neue Runtime-Hierarchie implementieren;
- keine vollständige Test-Neuentwicklung;
- keine alte Struktur nur wegen bestehender String-/Source-Tests konservieren.

### Endzustand

Die riskantesten Semantiken sind durch gezielte Tests beobachtbar; spätere Phasen können Struktur verändern, ohne diese Verträge unbemerkt umzudeuten.

---

## Phase 2 – `WorldRuntime`-Fundament und Lifecycle-Anbindung

### Ziel

Einen echten World-Lifetime-Owner einführen, ohne bereits die komplette World-Materialisierung zu verschieben.

### Umsetzen

- `WorldRuntime` als Composition Owner;
- klare create/attach/update/destroy-Schnittstelle;
- Anbindung hinter dem bestehenden `WorldLifecycle`;
- `ActivityRuntimeHost`-Slot;
- definierte Slots/Verträge für World Presentation und Persistent-Base World Binding;
- idempotenter Runtime-Teardown;
- Ownership-/Teardown-Tests.

### Nicht tun

- noch keine große Coop-Migration;
- `ArenaRuntime` noch nicht als globalen Ersatz-Context einführen;
- keine generische Factory-/Plugin-Infrastruktur.

### Endzustand

`WorldLifecycle` besitzt weiterhin die Identity; eine lokale `WorldRuntime` kann für dieselbe World-Instanz erzeugt, zerstört und neu erzeugt werden.

---

## Phase 3 – World-Materialisierung in `WorldRuntime` verschieben

### Ziel

Physisch materialisierten World-State aus globalem Lifecycle/Context in den World-Owner verschieben.

### Umsetzen

Schrittweise gemeinsam mit Create/Destroy:
- Arena Layout / World Geometry;
- Rock-/Placement-Runtime;
- Base-Materialisierung;
- world-spezifische Runtime IDs;
- zugehörige Listener / Callbacks / Timer.

`ArenaContext` darf vorübergehend Compatibility-Zugriffe auf den neuen Owner anbieten.

### Nicht tun

- keine Activity-Systeme in `WorldRuntime` ziehen;
- keine generischen Domain-Systeme nur wegen World-Nutzung neu instanziieren.

### Endzustand

World-Geometrie und ihre lokale Materialisierung besitzen einen eindeutigen World-Lifetime-Owner.

Die Darstellung darf hier noch gemeinsam mit dem übrigen materialisierten World-State geführt
werden. Ihre eigene Lifetime bekommt sie in Phase 4 (Architektur 6.1); bis dahin ist ein benannter
Compatibility-Pfad für die bestehenden Übergänge zulässig.

---

## Phase 4 – World Bindings und World-Materialisierung

### Ziel

Die verbleibenden world-scoped Runtime-Verbindungen dem `WorldRuntime` zuordnen.

### Umsetzen

Zuerst die Presentation-Lifetime trennen (Architektur 6.1); erst danach die restlichen Bindings:

- `WorldPresentationBinding` aus der bestehenden World-Materialisierung herauslösen: es trägt die
  reine gebaute Darstellung samt des Geometriepuffers, den sie adressiert, aber keine Physics-
  Gruppen, Collision-Proxies, Runtime-Indizes oder anderen Gameplay-State;
- `WorldPresentationHandoff` oberhalb der `WorldRuntime` mit `release` / `adopt` / `discard`;
- die verbleibende World-Materialisierung – Bau-Runtime, Basen, Fels- und Verdeckungsindizes –
  endgültig an die `WorldRuntime`-Lifetime binden: sie fällt mit dem Ende der World-Instanz und
  nicht erst mit dem nächsten Arena-Teardown;
- die bestehenden Übergänge auf den Handoff umstellen: Matchstart aus der LobbyWorld, Match-Exit,
  Lobby-Fast-Reinstance und Lobby-Rückkehr;
- nur tatsächlich activity-unabhängige World-Navigation anbinden; die heutige Coop-spezifische
  Enemy-/Ally-/Boss-Flowfield-Lifetime gehört in Phase 5;
- benötigte Bindings scene-langlebiger Shared Services;
- `PersistentBaseWorldBinding` zunächst für echte World-Materialisierung;
- Update-Verantwortung der übernommenen world-scoped Bereiche verschieben;
- vollständigen WorldRuntime-Teardown testen.

Der Abschluss des persistenten Basisbestands – welche Runtime-Objekte die Runde überlebt haben –
läuft im Gameplay-Teardown und liegt hinter dem Presentation-Handoff. Er darf keine Darstellung
mehr erreichen; diese Reihenfolge ist ein Vertrag und keine Zeilenfolge.

### Nicht tun

- Activity-spezifischen Player-State noch nicht final trennen;
- Ownership des bestehenden `PlayerWorldRuntime` noch nicht verschieben; sie wird zusammen mit
  der Player-World-/Presentation-Trennung in Phase 7 behandelt;
- Persistent-Base Room-/Transaction-State noch nicht umbauen;
- die Übergangsreihenfolge selbst nicht neu erfinden: der Handoff bildet die bestehenden Übergänge
  ab, er ersetzt sie nicht. Der Flow-Owner entsteht erst in Phase 10.

### Endzustand

`WorldRuntime` ist der erkennbare Owner der lokalen World. Globale Owner müssen übernommene world-scoped Systeme nicht mehr einzeln erzeugen, ticken oder zerstören.

Mutabler World-Gameplay-State überlebt seine `WorldRuntime` nicht mehr; eine länger sichtbare
Darstellung existiert ausschließlich als übergebene Presentation.

**Danach: Integrations-Checkpoint A.**

---

## Phase 5 – `CoopMissionRuntime`: Composition, Encounter und Enemy-Ownership

### Ziel

Einen echten Owner für die Coop-Activity einführen und den ersten großen Activity-State aus globalen Arena-Ownern lösen.

### Umsetzen

- konkrete `CoopMissionRuntime`;
- Attach/Update/Destroy-Vertrag über `ActivityRuntimeHost`;
- Encounter-/Spawn-Runtime;
- Coop-spezifische Enemy-/Ally-/Boss-Navigation und Flowfields;
- activity-scoped Enemy Behaviour;
- Boss-/mission-spezifische Enemy Runtime;
- mission-spezifische Directors, soweit sie zu diesem Scope gehören;
- tatsächliche Ownership samt Teardown verschieben;
- den realen Materialisierungspfad als Activity-Factory/Blueprint erhalten, sodass ein Attach von
  Activity B in derselben World alle Child-Owner frisch erzeugt und keinen World-Rebuild braucht;
- Bindings scene-langlebiger Shared Services an Activity-Owner gerichtet anbinden und beim Detach
  vor dem Child-Teardown vollständig lösen.

Generische Combat-/Projectile-/Physics-/Fire-Mechaniken bleiben bei ihren Domain-Ownern.

### Nicht tun

- noch nicht sämtliche Objectives/Progression/Result-Folgen migrieren;
- keine allgemeine Activity Registry nur für Coop bauen.

### Endzustand

Enemy-/Encounter-/Boss-Lifecycle der Coop-Mission ist unter `CoopMissionRuntime` erkennbar gekapselt und wird nicht mehr als globale Activity-Systemliste verwaltet.

Ein erneuter Attach in derselben World erzeugt eine vollständig materialisierte Coop-Activity;
kein Child-Owner oder direkter Shared-Service-Verweis der Vorgänger-Activity überlebt.

---

## Phase 6 – Coop Objectives, Progress, Update und Presentation

### Ziel

Die restliche Coop-Activity so weit kapseln, dass globale Update-/Lifecycle-Pfade keine Coop-Systemliste mehr kennen müssen.

### Umsetzen

- Objectives;
- Mission Progress;
- mission-spezifische Completion-Ermittlung;
- Activity-spezifische lokale Presentation;
- Activity-interne Update-Reihenfolge;
- Activity-Teardown;
- relevante Coop-Consumer aus `HostUpdateCoordinator`, `ClientUpdateCoordinator` und Lifecycle-Code auf den Activity-Owner umstellen.

### Nicht tun

- Persistenz-/Reward-Folgen noch nicht in die Activity ziehen;
- allgemeine Presentation-Infrastruktur nicht activity-scoped machen.

### Endzustand

`WorldRuntime` kennt nur den Activity-Owner. Eine neue Coop-Mechanik benötigt keinen neuen globalen Update-Branch.

---

## Phase 7 – Player-Lifetimes trennen

### Ziel

World- und Activity-spezifischen Player-State sauber trennen und policyabhängigen Teardown absichern.

### Umsetzen

- `missionStatus` und weiteren activity-scoped Player-State aus `PlayerWorldRuntime` entfernen;
- konkreten `PlayerActivityRuntime` für Coop einführen, soweit benötigt;
- Materialization Ledger / äquivalentes Tracking tatsächlich erzeugter Player-Module;
- Attach-Rollback und idempotenten Detach absichern;
- Activity-Wechsel in derselben World testen.
- `PlayerWorldRuntime`-Ownership zum `WorldRuntime` verschieben, nachdem sichtbare
  Player-Presentation als eigener Transition-State abgesichert ist.

### Nicht tun

- kein generisches Player-Feature-Framework für hypothetische Activities;
- keine zweite mutable ActivityParticipation-Repräsentation einführen.

### Endzustand

`PlayerWorldRuntime` kann einen Activity-Wechsel überleben. Activity-spezifische Player-Module werden vollständig ersetzt.

**Danach: Integrations-Checkpoint B.**

---

## Phase 8 – Persistent Base nach Lifetimes trennen

### Ziel

Room-State, Activity Working State und World-Materialisierung zu eindeutigen Ownern machen.

### Umsetzen

Aus dem gemischten heutigen Zustand trennen:

- `PersistentBaseRoomSession`
  - committed Session State;
  - Contributions;
  - Session Revisions;

- `PersistentBaseTransaction`
  - Baseline;
  - Working State;
  - World-/Activity-Identity;
  - genau einmal `commit` oder `rollback`;

- `PersistentBaseWorldBinding`
  - Runtime IDs;
  - Site / Build Area;
  - World-Konflikte;
  - Materialisierung.

Profile Persistence bleibt außerhalb dieser Runtime-Owner.

Bestehende Store-APIs dürfen temporär delegieren, aber keine gleichwertige zweite Source of Truth erzeugen.

### Nicht tun

- keine Änderung des fachlichen Save-Formats ohne eigenen Bedarf;
- keine Persistenzmigration nebenbei.

### Endzustand

Jeder Persistent-Base-State besitzt genau die Lifetime, die er fachlich benötigt. Stale Transaction-Abschlüsse können keine neue Activity beeinflussen.

---

## Phase 9 – `ActivityCompletion` und `ResultApplication`

### Ziel

Activity-Abschluss von Persistenz-, Reward- und Progressionsfolgen trennen.

### Umsetzen

- revisionsgebundene `ActivityCompletion`;
- activity-spezifisches Coop-Result;
- `ResultApplication` oder äquivalent klarer Anwendungspfad;
- vorhandene konkrete Folgen aus Arena-/Lifecycle-Code extrahieren, z. B.:
  - Persistent-Base Outcome;
  - Progression / XP;
  - Rewards / Unlocks;
  - Statistics, falls heute real vorhanden.

Nur tatsächlich benötigte Use-Cases als eigene Abstraktion erzeugen.

### Nicht tun

- keine leeren Use-Case-Klassen für hypothetische spätere Features;
- Activity schreibt weiterhin nicht direkt in Local Persistence.

### Endzustand

Coop erzeugt ein fachliches Ergebnis. Nachgelagerte Owner entscheiden über dessen Konsequenzen. Stale Completion bewirkt nichts.

---

## Phase 10 – Composition aus dem God-Coordinator lösen und echten Arena-Flow formen

### Ausgangslage / Decision Gate nach Phase 9

Phase 10 startet **nicht** von einem bereits kleinen Flow-Owner. Auf dem Rebaseline-Stand
`324fee4ae2952f12077f6053bd6119c8a7aa8eee` hat `ArenaLifecycleCoordinator.ts` 7.856 Zeilen und
liegt gegenüber dem Pre-Refactor-Baseline-Commit `254f3c763ce1d58c35c138c2c14e59d8e6b84dbc`
bei `+1317 / -669`, also netto **+648 Zeilen**.

Die bisherige Migration hat die Lifetime-/State-Ownership wesentlich verbessert, die konkrete
Composition aber noch nicht ausreichend nachgezogen. Im Coordinator liegen weiterhin unter
anderem:

- `buildWorld()` mit World-Geometrie, Placement, Bases, Presentation und umfangreichem Shared-Service-Wiring;
- konkrete Coop-Materialisierung wie Navigation/Flowfields, Encounter, Objectives, Enemy-Behaviour und Specials;
- Persistent-Base-Composite-/Reward-Materialisierung und World-Konfliktbehandlung;
- Construction-/Inspector-/Dismantle-Gameplay-Pfade und weitere fachliche Helfer;
- ein großer manueller `tearDownArena()`-Pfad;
- Readiness, Participation, World-/Activity-Transitions und Presentation-Handoff, die tatsächlich Flow sind.

Deshalb wird Phase 10 in drei getrennte Implementierungsschritte mit je eigenem Commit und Review
geteilt. Ein Schritt wird erst freigegeben, wenn er **alten globalen Code tatsächlich entfernt**;
neue Owner oder Composer vor unverändertem God-Coordinator sind kein erfolgreicher Zwischenstand.

### Phase 10A – World-Composition und world-scoped Bindings

#### Ziel

Den konkreten Aufbau einer World aus dem globalen Lifecycle-Flow lösen, ohne Phase 11
(`ArenaContext`-/Dependency-Cutover) vorwegzunehmen.

#### Umsetzen

Aus `ArenaLifecycleCoordinator` herauslösen bzw. an eine kleine konkrete World-Composition-Grenze
delegieren:

- Auflösung des World-Runtime-Contexts und materialisierten World-Graphs;
- `WorldMaterialization` mit Arena-Gameplay-Runtime, Placement, Bases, Rocks und world-lokalen Indizes;
- `WorldPresentationBinding`-Erzeugung bzw. Adoption einer vorhandenen Presentation;
- `PersistentBaseWorldBinding`-Anlage als Child der World;
- `PlayerWorldRuntime`-Aufbaurezept, soweit es echte World-Composition ist;
- world-scoped Bindings scene-langlebiger Systeme, einschließlich symmetrischem Detach;
- die Teile des heutigen `tearDownArena()`, die durch `WorldRuntime.destroy()` bzw. ihre konkreten Bindings ersetzt werden können.

Eine Composition-Grenze darf z. B. Factory/Materializer/Builder sein; der Name ist nicht
vorgegeben. Sie besitzt keinen langlebigen Gameplay-State und wird nicht als Dependency-Bag an
Consumer weitergereicht.

`buildWorld()` muss am Ende entweder verschwunden oder auf eine kleine Flow-/Composition-
Orchestrierung reduziert sein. Der Flow darf nicht selbst wissen, wie Placement, Bases, Rock
Registry, Light Occluders oder konkrete Shared-Service-Callbacks aufgebaut werden.

#### Bewusst noch erlaubt

- bestehende `ArenaContext`-Compatibility-Felder und Getter, solange ihre Source of Truth die neuen
  Owner bleiben – Entfernung folgt in Phase 11;
- vorhandene Network-/RPC-Adapter;
- activity-spezifische Composition, soweit sie erst in 10B verschoben wird.

#### Nicht tun

- keinen universellen `WorldComposer` als neuen God-Container bauen;
- keine Gameplay-Regeln ändern;
- keine Wire-/Authority-/Tickrate-Änderungen;
- Phase-11-Context-Cutover nicht nebenbei vollständig durchführen.

#### 10A-Gate

- neuer World-Code wird an World-Ownern/Composition-Grenzen lokal verständlich;
- World-Teardown folgt überwiegend den tatsächlichen Ownern statt einer globalen Reset-Liste;
- der Coordinator verliert netto deutlich Code; reine Wrapper-Extraktion ohne Löschung des alten
  Aufbaus ist nicht ausreichend;
- R-2 (Presentation → PB-Finalisierung → World-Gameplay-Teardown) bleibt unverändert geschützt.

### Phase 10B – Activity-, Persistent-Base- und Gameplay-Composition

#### Ziel

Die großen fachlichen Runtime-Graphs aus dem globalen Coordinator entfernen, die bereits klare
Lifetime-Owner besitzen oder einen konkreten Domain-Owner brauchen.

#### Umsetzen

**Coop-Activity:**
- den gespeicherten realen Materialisierungspfad aus globalen Closures in eine konkrete
  Coop-Composition-Grenze verschieben;
- Navigation/Flowfields, Encounter/Spawn, Boss, Enemy-Behaviour, Enemy-Specials, Objectives,
  PlayerActivityRuntime und Map-Event-Runtime dort erzeugen;
- `CoopMissionRuntime` bleibt Lifetime-Owner; eine Factory/Materializer-Grenze baut den Graph, ohne
  selbst zum langlebigen Runtime-Container zu werden;
- A→B in derselben World materialisiert B weiterhin vollständig frisch.

**Persistent Base / World:**
- world-lokale Composite-/Reward-Materialisierung, Runtime-Bindings und Konfliktbehandlung aus dem
  Flow lösen;
- Verhalten an `PersistentBaseWorldBinding` oder einen unmittelbar von diesem World-Scope
  besessenen konkreten Collaborator binden;
- `PersistentBaseRoomSession` und `PersistentBaseTransaction` bleiben unverändert ihre jeweiligen
  Sources of Truth.

**Construction und weitere fachliche Composition:**
- Construction-/Inspector-/Dismantle-/Repositioning-Gameplay nicht im Flow belassen;
- Train-/Map-Event-/PowerUp-spezifische Composition dort lösen, wo sie tatsächlich World- oder
  Activity-Domain ist;
- scene-langlebige generische Systeme wie Combat/Projectiles/Physics/Fire nicht künstlich in eine
  Activity verschieben; nur ihre scoped Bindings werden passend angebunden.

#### Nicht tun

- keine allgemeine Activity-Registry für hypothetische Modi;
- keine neue generische Construction-/PB-/Train-Service-Locator-Schicht;
- keine Phase-11-RPC-/Context-Portierung erzwingen, sofern sie für die Composition nicht nötig ist;
- keine Gameplay-Balance oder fachliche Regeln ändern.

#### 10B-Gate

Der verbleibende Flow-/Lifecycle-Code importiert oder materialisiert keine konkrete Liste aus:
- `EnemyManager` und Coop-Enemy-Systemen;
- `FlowFieldCoordinator`/Enemy-Flowfield-Services;
- Coop-Objectives/Encounter/Directors;
- Persistent-Base-Composite-/Reward-Katalog- und Runtime-Materialisierung;
- Construction-Definitionen und konkrete Placement-Regeln;
- `TrainManager` oder konkrete Train-Event-Runtime.

Eine neue Coop-Mechanik darf danach keinen neuen Materialisierungszweig im globalen Arena-Flow
benötigen.

### Phase 10C – Arena Flow, Frame-Position und Top-Level-Composition

#### Ziel

Erst nachdem die fachfremde Composition entfernt ist, den tatsächlich verbleibenden
Top-Level-Owner formen.

#### Decision Gate

- bestehenden `ArenaLifecycleCoordinator` bevorzugt transformieren/reduzieren, wenn sein Rest
  kohärent Flow ist;
- nur bei echtem Nutzen separaten `ArenaFlowCoordinator` erzeugen;
- `ArenaRuntime` nur dann als kleinen scene-langlebigen Top-Level-Composition-Owner einführen, wenn
  er die nun real vorhandenen Top-Level-Owner bündelt; nie als neuen `ArenaContext`.

#### Flow besitzt nur übergeordnete Orchestrierung

- World Identity / World-Wechsel;
- Activity Identity / Activity-Wechsel;
- Readiness / Loading-Sequencing;
- Participation;
- Completion und Aufruf von `ResultApplication`;
- Lobby-/Next-World-Transition;
- `WorldPresentationHandoff`;
- Top-Level-Frame-Orchestrierung.

#### Frame-Position / RK-4

Die Coop-Simulation kann nicht korrekt in einen beliebigen `WorldRuntime.update()`-Zeitpunkt
verschoben werden. Ihre reale Frame-Position nach Netzwerksync und innerhalb der bestehenden
Countdown-/Gameplay-Gates bleibt erhalten.

Phase 10C verschiebt daher die **Aufrufstelle** auf den zukünftigen Arena-Runtime-/Frame-Owner, ohne
die interne Missionsreihenfolge wieder global zu machen:

```text
ArenaRuntime / Frame-Owner
    ├ world-scoped Frame-Anteile
    ├ benannter Activity-Step (`hostSimulationStep`, `hostPrePhysicsStep`, ...)
    └ weitere globale Frame-Phasen
```

Der Frame-Owner kennt ausschließlich den benannten Activity-Vertrag. Welche Objectives,
Flowfields oder Enemy-Systeme darin laufen, bleibt Eigentum der `CoopMissionRuntime`.

#### Nicht tun

- keine Gameplay-Regeln in den Flow;
- `ArenaRuntime` nicht als Service Locator verwenden;
- keinen Wrapper nur wegen des Zielklassennamens erzeugen;
- keine bereits korrekte Presentation-/Teardown-Reihenfolge umsortieren.

#### 10C-Gate / Erfolgskriterium Phase 10

Neben Checkpoint C gilt:

- alter `ArenaLifecycleCoordinator` plus eventueller neuer Flow zusammen Ziel **≤ ca. 3.000–3.500 LOC**;
- die LOC-Grenze ist ein Review-Warnsystem, kein Selbstzweck: ein 2.000-Zeilen-Flow plus 4.000-Zeilen-
  God-Composer besteht das Gate nicht;
- kein großer manueller globaler System-Teardown mehr;
- `WorldPresentationHandoff` liegt am tatsächlichen Flow-Owner;
- TD-2, TD-5 und TD-8 sind geschlossen;
- Flow und ArenaRuntime kennen nur ihre echten Top-Level-Verantwortungen.

Wenn diese Punkte nach einer ernsthaften 10A–10C-Umsetzung nicht erreichbar sind, Phase 11 **nicht**
automatisch beginnen, sondern das Gesamtrefactoring erneut als GO/NO-GO bewerten.

**Danach: Integrations-Checkpoint C.**

---

## Phase 11 – `ArenaContext` und globale Dependency-Pfade abbauen

### Ziel

Die durch neue Owner gewonnene Ownership auch in echte Context Locality übersetzen.

Phase 11 setzt voraus, dass Phase 10 die fachliche Composition bereits aus dem Flow entfernt hat.
Sie ist **kein Ersatz für eine unvollständige Phase 10**: Hier werden Zugriffspfade und
Compatibility abgebaut, nicht erst die großen World-/Activity-Graphs erfunden.

### Umsetzen

- migrierte nullable Runtime-Felder aus `ArenaContext` entfernen;
- Consumer auf kleine fachliche Interfaces / direkte Owner-Verträge umstellen;
- verbliebene globale Update-Zugriffe auf bereits migrierte Runtime-Bereiche entfernen;
- `HostUpdateCoordinator` und `ClientUpdateCoordinator` auf ihre tatsächlichen verbleibenden Aufgaben reduzieren;
- `RpcCoordinator` von großem `ArenaContext` / Lifecycle-Zugriff entkoppeln, soweit fachlich sinnvoll;
- neue oder migrierte Runtime-/Domain-Grenzen über kleine Network Ports anbinden.

### Network-Scope

Runtime-/Domain-Code soll `bridge` / `NetworkBridge` nicht direkt kennen.

Explizite Network-/RPC-/Transport-Adapter dürfen die konkrete Netzwerk-API weiterhin verwenden.

### Nicht tun

- keine Ports nur zum Verstecken jedes einzelnen `bridge`-Calls;
- Wire-Format, Transport, Tick Rates und Authority nicht ändern.

### Endzustand

`ArenaContext` ist kein primärer Runtime-State-Container mehr. Globale Coordinators kennen nur die Bereiche, die tatsächlich zu ihrer verbleibenden Verantwortung gehören.

---

## Phase 12 – Transitional Debt und Legacy entfernen

### Ziel

Die neue Architektur ohne parallele Altpfade für sich stehen lassen.

### Umsetzen

Transitional-Debt-Liste vollständig abarbeiten:
- Compatibility Getter / Forwarder;
- temporäre doppelte Felder;
- alte nullable Runtime-Felder;
- manuelle globale Teardown-Listen;
- obsolete `isCoopMission`-/Activity-Aufbauzweige;
- alte Update-Branches;
- temporäre Source-Structure-Tests;
- obsolete Runtime Feature Flags;
- veraltete direkte Dependency-Pfade;
- nicht mehr benötigte Imports / Adapter / Dead Code.

Dependency-/Architektur-Contracts auf den finalen Zustand ausrichten.

### Nicht tun

- keine neue Architektur mehr einführen, außer ein beim Cleanup sichtbar gewordenes konkretes Problem verhindert den Zielzustand;
- solchen Änderungsbedarf ansonsten im Status-Dokument zur manuellen Prüfung markieren.

### Endzustand

Keine unbeabsichtigte parallele Altarchitektur und keine offene Transitional Debt.

**Danach: finaler Abnahme-Gate.**

---

# 4. Abnahmekriterien des Gesamtrefactorings

Nach Phase 12 gilt:

1. World-, Activity- und Player-Lifetimes entsprechen der Zielarchitektur.
2. Update und Teardown folgen der tatsächlichen Ownership.
3. Coop-spezifische Systeme wachsen nicht mehr als globale Arena-Systemliste.
4. `ArenaContext` ist kein großer mutable Runtime-State-Container mehr.
5. Persistent Base trennt RoomSession, Transaction, WorldBinding und Profile Persistence.
6. Activity Results sind von ihren Persistenz-/Progressionsfolgen getrennt.
7. Runtime-/Domain-Code kennt keine konkrete Netzwerk-Infrastruktur.
8. Alle temporären Compatibility-Pfade sind entfernt oder als bewusst verbleibende Infrastruktur begründet.
9. Die relevanten Multiplayer-, Lifecycle-, Persistence- und Leak-Regressionen sind grün.
10. Eine zukünftige Activity wie From Dachs Till Dawn kann primär in eigenem Runtime-/Presentation-/Result-Scope implementiert werden.
11. Der finale Flow materialisiert keine konkreten World-/Coop-/PB-/Construction-/Train-Systemlisten.
12. Große Composition-Blöcke wurden nicht lediglich in neue God-Composer verschoben; typische Feature-Arbeit bleibt fachlich lokal.

### Größen-/Locality-Review nach Phase 12

Als **Review-Metrik**, nicht als Selbstzweck, gilt für den finalen Flow-/Lifecycle-Owner ein
Zielbereich von ungefähr **1.200–2.000 LOC**. Ein kohärenter Owner darf darüber liegen, wenn seine
Verantwortung tatsächlich zusammengehört; ab etwa **2.500 LOC** ist aber explizit zu begründen,
warum weitere fachliche Zerlegung keinen Locality-Gewinn bringt. Umgekehrt ist ein künstliches
Unterschreiten der Zahl durch Helper-/Forwarder-/God-Composer-Aufteilung kein Erfolg.

Entscheidend bleibt die Architekturprobe: Eine typische Coop-, Enemy-, Persistent-Base- oder
Construction-Änderung soll den Top-Level-Flow weder lesen noch ändern müssen, sofern sie keine
echte Transition oder Top-Level-Policy betrifft.
