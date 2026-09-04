# Fragdachse – Projectile Runtime Refactoring: Implementierungsplan

**Status:** Verbindlicher Migrationsplan für den Projectile-Runtime-Cutover
**Architekturvorgaben:** `01_Projectile_Runtime_Architecture_Core.md` und `02_Projectile_Runtime_Architecture_Details.md`
**Laufender Status:** `04_Projectile_Runtime_Migration_Status.md`
**Planungsbasis:** `main` @ `c6f83bc864c4cf8daa98d32bd6a29ee9a8926ab5`; der Projectile-Produktionscode ist gegenüber `2040afa7c339f68a5b35bbbd3a43e8730586d3c2` unverändert, das inzwischen abgeschlossene Test-Refactoring hat jedoch Runner, Suite-Grenzen und dauerhafte Testpolicy geändert

> Jede Phase ist als eigenständiger Auftrag für eine Coding-KI geschnitten.
> Die Phasen müssen **nicht** jeweils einen spielbaren oder global grünen Test-Zwischenstand erzeugen.
> Entscheidend ist der vollständig integrierte, getestete Endzustand nach Phase 15.
> **`npm run typecheck` muss nach jeder erfolgreich abgeschlossenen Phase grün sein.** Ein nicht typkompilierender Stand ist kein abgeschlossener Phasenstand.
> Einzelne Behavior-/Integrationstests dürfen nur innerhalb eines ausdrücklich benannten Cutover-Fensters vorübergehend rot sein; Ursache und Schließphase stehen dann knapp in `04`.
> Zwischenphasen dürfen absichtlich funktional unvollständig sein; künstliche duale Autorität oder parallele Runtime-States nur zur Erhaltung eines Zwischenstands sind verboten. Ein eng befristeter **Single-State Legacy Access Seam** auf denselben kanonischen Store ist ausschließlich gemäß §5.1 zulässig.

---

## 1. Zweck und Zielzustand

Dieses Refactoring ersetzt den historisch gewachsenen `ProjectileManager` durch eine echte world-owned Projectile Runtime mit klarer Autorität, geschlossener State-Oberfläche und getrennten Host-/Network-/Client-/Presentation-Verantwortlichkeiten.

Nach Abschluss gilt:

1. `WorldProjectileRuntime` ist die einzige öffentliche world-owned Projectile-Gameplay-Grenze.
2. Autoritativer Projectile-State gehört ausschließlich dieser World Runtime und wird nur auf dem Host fachlich mutiert.
3. Player-, Enemy-, Turret- und World-Execution erzeugen einen aufgelösten `ProjectileSpawnRequest`.
4. `TrackedProjectile` ist kein produktiver öffentlicher Contract mehr.
5. Flight, Guidance, Collision Candidate Generation und Projectile-lokale Mutation liegen im Projectile-Owner.
6. Collision erzeugt fachliche Kandidaten; Damage/Support/World-Wirkung bleibt beim kanonischen Domain-Owner.
7. `CombatSystem` iteriert keine aktiven Projectiles und besitzt keine Projectile-Geometry.
8. `ProjectileCombatPort` ist auf Combat-Semantik begrenzt und kein Universal-World-Effect-Port.
9. Explosion-/Domain-Effect-Fan-out liegt hinter einer eigenen schmalen Orchestrierungsgrenze.
10. Detonation, Deflection, Consume und Translocator greifen nicht auf mutierbare Runtime-Records zu.
11. AWP-/Fire-Imbue-/Travel-Mechaniken arbeiten über semantische Travel-/Environment-Grenzen.
12. Replication ist ein Adapter aus autoritativem State; Codec-/Resend-/Refresh-State liegt nicht in der Simulation.
13. Client Replica besitzt nur replizierten/interpolierten/extrapolierten State und keine Gameplay-Authority.
14. Projectile Presentation besitzt Renderer/VFX/Audio/Lighting/Shadow und interpretiert keine Gameplay-Regeln.
15. Der produktive `ProjectileManager` ist entfernt.
16. Same-Frame-Reihenfolge, Multiplayer-Semantik und bestehendes Gameplay bleiben erhalten.
17. Ein späterer Combat-Refactor kann unterhalb des stabilen `ProjectileCombatPort` erfolgen.

---

## 2. Verbindliche Abgrenzung

### 2.1 Im Scope

- world-owned `WorldProjectileRuntime`
- `ProjectileSpawnRequest` und Spawn-Port
- privater Projectile Store / Runtime Record
- Identity, Flight, Lifetime, Guidance, Homing
- capability-basierte lokale State-Komposition
- gezielte private Capability-Indizes
- Collision Candidate Generation
- Targetability / Barrier / Defense / Reflection / Deflection
- External Projectile Interactions
- Travel-/Environment-Interaction und Augments
- Direct Impact / Combat Request / authoritative Outcomes
- Explosion-/Domain-Effect-Orchestrierung
- Grenade- und Mini-Rocket-Continuation
- Hydra/Split, BFG/Gauss/Overlap/Penetration und weitere bestehende Projectile-Sonderfälle
- Rock/Base/Train/Support-Grenzen
- Projectile-Lifecycle-Outcomes / AK47-relevante Semantik
- Threat-/Position-/Diagnostics-Reads
- Host Replication Adapter
- Client Replica
- Projectile Presentation
- World Composition / Teardown / Host Frame
- Entfernung von `ProjectileManager` und `TrackedProjectile`-Leaks
- Testmigration und Architektur-Ratchets

### 2.2 Nicht im Scope

- neues Adrenalin-Orb-Gameplay
- Hit-Feedback-Redesign
- vollständiger Combat-Runtime-Refactor
- neues globales Explosion-System
- neues globales Status-/Effect-System
- globales ECS
- generischer Scheduler / Behavior Registry / Event Bus
- vollständiger Physics-Rewrite
- neues Projectile-Prediction-/Reconciliation-System
- vollständiges Redesign aller Weapon-/Loadout-Configs
- Balance- oder Featureänderungen
- kosmetische Umorganisation nicht betroffener Bereiche

Lokale Änderungen an `CombatSystem`, World-/Support-/Player-Gameplay oder Composition sind erlaubt, **wenn sie unmittelbar nötig sind, um die in 01/02 festgelegte Projectile-Grenze herzustellen**. Daraus darf kein vorgezogener Full-Combat-Refactor werden.

---

## 3. Maßgebliche Ist-Anker

Die Umsetzung soll bestehende gute Bausteine weiterverwenden.

### 3.1 Gute Anker

- `src/world/WorldWeaponExecutionRuntime.ts`
  - bestehende obere Shared-Execution-Grenze
- `src/world/AutomatedWeaponExecutionAdapter.ts`
- `src/world/SpecializedWeaponExecutionAdapter.ts`
  - bereits getrennte Player-/Automated-/Specialized-Execution
- `src/systems/ProjectileSpawnResolver.ts`
  - bestehende Spawn-/Body-Auflösung als Migrationsanker
- `src/entities/ProjectileHomingController.ts`
  - vorhandene pooling-/data-oriented Homing-Techniken
- `src/combat/rules/ProjectileImpactResolver.ts` bzw. der aktuelle Projectile-Impact-Resolver
  - Continuous-Collision-/Obstacle-Migrationsanker
- `src/network/projectileSnapshotCodec.ts`
  - bestehender Wire-Vertrag
- aktuelle langlebige Host-Frame-/World-Composition-Contracts aus Core-/Integration-/Architecture-Suites
  - sichtbare Host-Reihenfolge auf semantischer Ebene; der im Test-Refactoring entfernte `HostUpdatePhaseContracts`-Source-Ratchet wird nicht wiederhergestellt
- bestehende World-/Activity-Lifetime-Grenzen und `WorldScopedBinding`
- `ArenaObstacleIndex` / vorhandene gemeinsame Geometry-Indizes

### 3.2 Zentrale aktuelle Kopplungspunkte

Mindestens erneut durchsuchen:

- `src/entities/ProjectileManager.ts`
- `src/types.ts` (`TrackedProjectile`, `ProjectileSpawnConfig`, Synced Projectile Types)
- `src/systems/CombatSystem.ts`
- `src/systems/DetonationSystem.ts`
- `src/systems/TranslocatorSystem.ts`
- `src/systems/WeaponUpgradeSystem.ts`
- `src/systems/FlamethrowerUpgradeSystem.ts`
- `src/systems/CoopDefenseEnemyDodgeSystem.ts`
- `src/world/WorldCombatGameplayBinding.ts`
- `src/world/WorldSupportGameplayRuntime.ts`
- `src/world/WorldTrainRuntime.ts`
- `src/world/WorldGeometryBinding.ts`
- `src/world/WorldWeaponExecutionRuntime.ts`
- `src/world/AutomatedWeaponExecutionAdapter.ts`
- `src/world/SpecializedWeaponExecutionAdapter.ts`
- `src/scenes/ArenaScene.ts`
- `src/scenes/arena/ArenaContext.ts`
- `src/scenes/arena/HostUpdateCoordinator.ts`
- `src/scenes/arena/ClientUpdateCoordinator.ts`
- `src/scenes/arena/ArenaWorld*Composition.ts`
- Projectile Renderer / Burn / Lighting / Shadow Consumer
- Weapon Balance Lab / Debug Projectile Reads
- alle produktiven `ProjectileManager`, `TrackedProjectile`, `getActiveProjectiles`, `getProjectileById`, `destroyProjectile` und Projectile-Callback-Callsites

Die Liste ist Startpunkt, keine vollständige Inventarliste. Jede Phase durchsucht den aktuellen Code erneut.

---

## 4. Unverhandelbare Invarianten

### 4.1 Authority und Writer

- genau eine autoritative Projectile Registry pro World
- genau ein kanonischer Owner/Authority für Projectile-State und -Lifecycle
- keine duale alte/neue Projectile-Simulation und keine kopierte Legacy-Registry
- für dieselbe fachliche Mutation darf es nie parallele alte+neue Verarbeitung geben; bis zum jeweiligen Cutover darf ein in §5.1 benannter Legacy-Pfad denselben kanonischen State noch lesen bzw. bei unvermeidbarer Bestandssemantik mutieren
- ein temporärer Legacy-Zugriff darf nur auf **denselben kanonischen State** zeigen und nur für die in §5.1 benannten Consumer/Schließphasen existieren
- Client/Presentation/Replication erzeugen keine Gameplay-Wahrheit
- fremder Health-/Armor-/Integrity-/Progression-State wird nur beim kanonischen Owner mutiert

### 4.2 Identity und Provenance

Getrennt bleiben:

- Projectile Identity
- Gameplay Source
- Attribution
- Allegiance
- Lineage
- Correlation

Reflection/Deflection darf Attribution/Allegiance ändern, ohne Source/Lineage automatisch zu vernichten.

### 4.3 Zeit

- gameplay-relevante Zeit wird explizit als Host-/Frame-Zeit übergeben
- `real time` in den Architekturdocs bedeutet hostautoritative `nowMs`, nicht versteckte Wall Clock
- kein neues `Date.now()` in migrierter Projectile-Gameplay-Logik
- visual/client timing darf weiterhin geeignete Presentation-/Client-Clocks verwenden
- Time Bubble beeinflusst nur die dafür vorgesehenen simulierten Zeitdimensionen

### 4.4 State-Oberfläche

Verboten:

```ts
getActiveProjectiles(): ReadonlySet<ProjectileRuntimeRecord>
getProjectileById(id): ProjectileRuntimeRecord
```

für produktive externe Consumer.

Erlaubt sind nur kleine anwendungsbezogene Commands/Views.

### 4.5 Capability-Komposition

- neue optionale Top-Level-Capability nur bei wiederverwendbarer fachlicher Semantik
- weapon-spezifische Details erweitern den kleinsten passenden typisierten Zweig
- keine neue optionale Mega-Struktur als Ersatz für `TrackedProjectile`
- keine Gameplay-Verzweigung auf `projectileStyle`

### 4.6 Same-Frame-Reihenfolge

Mindestens erhalten:

1. externe Detonation vor normalem Hit desselben Projectiles
2. Fire Imbue vor anschließendem Same-Frame-Hit
3. Dome-/Leaf-Deflection vor normalem Target-Hit
4. Continuous Collision respektiert näheren World-Blocker
5. Penetration verarbeitet Kandidaten deterministisch entlang des Travel-Segments
6. Post-Projectile Gameplay läuft nach direkter Projectile-Auflösung
7. Mini-Rocket-Continuation erhält ihr korrektes Same-Frame-Feedback
8. Grenade Fuse bleibt Host-/Real-Time und wird nicht versehentlich Time-Bubble-skaliert
9. Spawn-during-stage/Reentrancy folgt einem explizit charakterisierten Stage-Contract; neue Child-/Interaction-Spawns werden nicht zufällig durch die Iterationssemantik der aktiven Collection noch im selben Stage verarbeitet

### 4.7 Keine künstliche Zwischenarchitektur

Da Zwischenphasen nicht spielbar sein müssen:

- keine dauerhafte Fassade nur für alten Call-Shape
- kein synchronisierter zweiter Projectile-State
- kein zweiter Registry-Owner und keine parallele alte+neue Mutation derselben Semantik
- keine „Legacy + New Runtime“-Doppelverarbeitung
- keine Universalabstraktion als Übergang
- kein zusätzlicher Spatial Index nur für den Cutover

Zulässig sind nur:

1. **schmale one-way Adapter**, die eine reale neue Zielgrenze isolieren, und
2. der in §5.1 definierte **Single-State Legacy Access Seam** für bereits existierende, noch nicht migrierte Consumer.

Dieser Legacy-Seam darf keinen State kopieren, keinen zweiten Lifecycle besitzen, keine neue allgemeine öffentliche Projectile-API werden und nur die benannten Restconsumer bis zu ihrer festgelegten Schließphase bedienen.

---

## 5. Cross-Phase Contract Manifest

Die Contract-Familien sind über alle Phasen stabil. Die konkrete Type-/API-Benennung wird in der ersten implementierenden Phase einmal festgelegt und danach in `04` dokumentiert.

| Contract-Familie | Rolle | Einführung | Späteste Übergangsschließung |
|---|---|---:|---:|
| `ProjectileSpawnPort` / `ProjectileSpawnRequest` | aufgelöste Execution → Projectile Spawn | 2A | 2B |
| `WorldProjectileRuntime` / Host Frame | öffentliche world-owned Gameplay-Grenze | 2B | 14 |
| privater `ProjectileStore` / Runtime Record | einzige autoritative Registry und lokale Mutation | 2B | 14 |
| `ProjectileExternalInteractionPort` | Detonate/Consume/Transform/Deflect Commands | 4 | 10 |
| Projectile Read Ports | Threat/Position/Diagnostics/Projection ohne Runtime-Record-Leak | 4 | 14 |
| Target/Geometry/Targetability Ports | immutable Target-/Geometry-Sicht | 6 | 14 |
| Barrier-/Defense-Contract-Familie | World-space Barrier vs. target-local Defense sauber getrennt; keine konkreten Defense-System-Imports | 6 | 10 |
| `ProjectileCombatPort` | Direct-Combat-Auflösung + Combat-Anteil von Explosionen | 7 | 10 |
| Projectile Domain-Effect / Explosion Resolution | Fan-out außerhalb Combat/Simulation | 8 | 10 |
| Lifecycle-/Outcome-Grenze | bestätigte Projectile Outcomes → Reactions | 7/10 | 10 |
| Replication Projection / Adapter | Host State → Wire Snapshot | 11 | 14 |
| `ProjectileClientReplica` | Wire State → nichtautoritative Replica | 12 | 14 |
| Projectile Presentation Projection / Runtime | Host/Replica → Renderer/VFX/Audio/Light | 13 | 14 |
| Geometry Binding | World Geometry → Projectile Runtime | 6/14 | 14 |

Regeln:

1. Die Familie bleibt stabil, auch wenn die konkrete Implementierung in mehrere kleine Interfaces geschnitten wird.
2. Keine spätere Phase erfindet für dieselbe Bedeutung eine zweite Fassade.
3. `04` enthält nur die **realisierten Namen**, keine ausführliche API-Dokumentation.
4. Temporäre Legacy-Adapter werden nicht in `04` historisiert; nur der aktuell noch offene Adapter wird unter „Aktive Transitionen“ geführt.
5. Wenn die reale Codebasis zeigt, dass eine Contract-Familie falsch geschnitten ist, wird nicht spekulativ eine Parallelarchitektur gebaut. Die Phase dokumentiert einen kurzen Architektur-Review-Bedarf in `04`.

### 5.1 Temporärer Single-State Legacy Access Seam

Phase 2B übernimmt bereits die **eine kanonische Registry**. Weil einzelne heutige Host-Consumer erst in späteren Phasen semantisch migriert werden, darf bis Phase 10 ein eng begrenzter Migration-Seam auf **denselben** Store existieren.

Harte Regeln:

- keine zweite Registry, keine Kopie, kein Sync zwischen alt/neu;
- keine zweite ID-Vergabe und kein zweiter Lifecycle;
- bis zum jeweiligen Cutover darf ein benannter Legacy-Consumer ausnahmsweise denselben kanonischen Record lesen/mutieren, **wenn** noch kein neuer Pfad dieselbe fachliche Mutation ausführt; bevorzugt sind owner-vermittelte schmale Operationen;
- der Seam ist kein öffentlicher Zielcontract und wird nicht an neue Consumer verteilt;
- nur heute bereits existierende, unten benannte Legacy-Consumer dürfen ihn nutzen;
- wenn Legacy-Shape unvermeidbar ist, ist er nur eine temporäre Sicht/Operation auf den kanonischen Store; neue Implementierung darf sich nicht daran orientieren;
- jeder Consumer wird spätestens in der angegebenen Phase auf seinen finalen semantischen Port migriert;
- nach Phase 10 existiert dieser Seam nicht mehr.

| Legacy-Consumer/-Zweck | temporär erlaubt ab 2B | finale Zielgrenze | spätestens geschlossen |
|---|---|---|---:|
| `DetonationSystem` Search/Detonate | begrenzter Search/Command-Adapter auf denselben Store | External Interaction | 4 |
| `TranslocatorSystem` Position/Consume | begrenzte ID/Position/Consume-Sicht | Translocator Projectile Port | 4 |
| Enemy Dodge / Diagnostics / Host Presentation Reads | readonly Legacy-Projection auf denselben State | Threat/Diagnostics/Presentation Reads | 4 |
| Fire Imbue / AWP Travel | eng begrenzte Travel-/Mutation-Brücke | Travel-/Environment-/Path Interaction | 5 |
| `CombatSystem` Projectile Target Collision | read/candidate-nahe Übergangsbrücke ohne zweiten Writer | Projectile Collision + Target/Geometry Ports | 6 |
| Direct Combat-/Defense-Mutation | schmaler Legacy Impact Adapter | `ProjectileCombatPort` / Defense Contracts | 7 |
| Explosion/Grenade-Fan-out | bestehende Callback-/Result-Brücke | Domain-Effect / Explosion Resolution | 8 |
| komplexe State-Machines / sonstige Host-Sonderfälle | nur falls nach Inventur real nötig | lokale Runtime-State-Machines / Outcomes | 9–10 |

Wenn Phase 2B einen heute existierenden Consumer entdeckt, der hier fehlt, darf er **nicht** stillschweigend eine neue allgemeine Fassade erhalten. Entweder wird er der kleinsten passenden Zeile zugeordnet und mit Schließphase in `04` dokumentiert oder als Architektur-Review-Bedarf gestoppt.

---

## 6. Arbeitsweise für Coding-KIs

### 6.1 Vor jeder Phase lesen

1. `01_Projectile_Runtime_Architecture_Core.md` vollständig.
2. Nur die für die aktuelle Phase unten referenzierten §§ aus `02_Projectile_Runtime_Architecture_Details.md`.
3. Aus diesem Dokument:
   - §§ 1–7
   - Cross-Phase Contract Manifest
   - nur die aktuelle Phase
   - Definition of Done / Stop-Kriterien bei Bedarf
4. `04_Projectile_Runtime_Migration_Status.md` vollständig.
5. `AGENTS.md`.
6. `docs/ai/architecture-principles.md`.
7. `docs/ai/testing.md` für Schutzwert, Runner-/Suite-Grenzen und Ratchet-Regeln.
8. relevante `docs/ai/*`-Seiten.

### 6.2 Phasenspezifischer Architektur-Router

| Phase | Zusätzlich aus `02_Projectile_Runtime_Architecture_Details.md` |
|---|---|
| 1 | §§ 1–2, 20, 24–30 |
| 2A | §§ 3, 6–8, 20, 25, 28 |
| 2B | §§ 3–6, 9–10, 23–24, 28 |
| 3 | §§ 4–5, 9–11, 24–27 |
| 4 | §§ 6, 17, 20, 24, 27–28 |
| 5 | §§ 8, 18, 20, 24–28 |
| 6 | §§ 12–14, 20, 23–28 |
| 7 | §§ 14–15, 19–20, 24–28 |
| 8 | §§ 15–17, 20, 24–28 |
| 9 | §§ 9–11, 16, 19, 24–27 |
| 10 | §§ 16–20, 24–28 |
| 11 | §§ 6, 20–21, 24, 26–28 |
| 12 | §§ 20–22, 26–28 |
| 13 | §§ 8, 20, 22, 26–28 |
| 14 | §§ 3, 6, 20, 23–30 |
| 15 | §§ 20, 24–30 sowie Fachabschnitte aller noch offenen Punkte |

Zusätzliche §§ nur laden, wenn der reale Change sie tatsächlich berührt.

### 6.3 Vor der Änderung

Die KI:

- sucht alle Call-Sites der betroffenen alten und neuen Contracts
- bestimmt Owner, Lifetime, Authority und aktuellen Writer
- prüft bestehende Tests
- prüft, ob ein Contract bereits in `04` materialisiert wurde
- verwendet vorhandene Ports/Resolver statt Parallelstrukturen

### 6.4 Nach der Änderung

Die KI:

1. erfüllt den **lokalen Abschluss** der Phase,
2. führt die angegebenen fokussierten Checks aus, soweit der aktuelle Integrationszustand sie sinnvoll ausführbar macht,
3. führt **immer `npm run typecheck`** aus; ein roter Typecheck verhindert den Phasenabschluss,
4. jagt keinen absichtlich roten Behavior-/Integrationstest hinterher, wenn die Ursache eine in `03` ausdrücklich offene Transition ist; Ursache und Schließphase stehen dann knapp in `04`,
5. unterscheidet geplante Transition von unbeabsichtigter Regression,
6. aktualisiert `04` knapp,
7. erstellt genau einen Commit **für eine erfolgreich abgeschlossene Phase**.

Empfohlenes Commit-Schema:

```text
refactor(projectile-runtime): phase 6 collision cutover
```

Bei `2A`/`2B` entsprechend `phase 2a` / `phase 2b`.

**Kein Commit-Hash wird in `04` eingetragen.** Die Commit-Historie liegt in Git; die Statusdatei wird im selben Commit aktualisiert.

Bei einem **echten Blocker** wird die Phase nicht als abgeschlossen markiert und es entsteht kein normaler Phase-Commit. Der Orchestrator stoppt nach dem sicheren Teil, setzt die Phase in `04` auf 🟧 und dokumentiert den Review-Bedarf. Ein separater WIP-/Blocker-Commit ist nur ausnahmsweise für Arbeitsstandsicherung zulässig und zählt ausdrücklich **nicht** als Phase-Commit.

### 6.5 Mehrere Phasen in einem Auftrag

Mehrere unmittelbar aufeinanderfolgende Phasen dürfen in einem Orchestrator-Auftrag umgesetzt werden.

Trotzdem gilt:

- Phasen der Reihe nach abschließen
- nach jeder Phase `04` aktualisieren
- pro Phase eigener Commit
- keine spätere Phase beginnen, wenn die vorige einen ungeplanten Blocker hinterlässt
- ein geplanter, im Plan benannter Integrationsbruch darf in die vorgesehene Schließphase weitergetragen werden

### 6.6 Keine Sichtprüfung durch Coding-KIs

Coding-KIs:

- starten keinen Browser für Sichtprüfung
- starten keinen Dev-Server nur zum Anschauen
- erzeugen keine Screenshots als Abnahme
- simulieren keine manuelle Gameplay-Prüfung

Die menschliche Prüfung erfolgt standardmäßig erst nach Phase 15.

---

## 7. Integrationsfenster statt grüner Zwischenstände

Die Phasen sind so geschnitten, dass große semantische Grenzen nacheinander hergestellt werden können, ohne Legacy nur für Zwischen-Spielbarkeit zu konservieren.

### Fenster A – Spawn/Owner-Cutover

**2A → 2B**

2A darf einen kleinen one-way Adapter vom neuen Spawn Request zur alten Spawn-Senke besitzen.
2B schließt **diesen Spawn-Adapter**, sobald der neue world-owned Store/Spawn Owner autoritativ übernimmt. Ab 2B existiert genau eine kanonische Registry; für noch nicht migrierte Host-Consumer darf ausschließlich der eng begrenzte Single-State Legacy Access Seam aus §5.1 bestehen.

### Fenster B – Host Interaction Cutover

**6 → 10**

Collision, Combat-Port, Explosion-Fan-out und Spezialfälle werden nacheinander migriert. In diesem Fenster dürfen gezielte Integrationstests vorübergehend rot sein. Verboten bleibt eine parallele alte und neue Hit-/Damage-Mutation.

### Fenster C – Projection Cutover

**11 → 13**

Replication, Client Replica und Presentation werden aus dem alten Manager herausgezogen. Der alte Manager darf in diesem Fenster noch Restcode enthalten, aber **keine autoritative Host-Projectile-Registry oder Gameplay-Mutation mehr besitzen**.

### Fenster D – Legacy Removal

**14**

Alle Restconsumer, Context-/Composition-Zugriffe und der produktive `ProjectileManager` werden entfernt.

---

# 8. Implementierungsphasen

## Phase 1 – Baseline und riskante Characterization

### Ziel

Vor dem strukturellen Cutover wird die tatsächlich relevante Projectile-Semantik ausreichend abgesichert, ohne ein großes dauerhaftes Testinventar anzulegen.

### Aufgaben

1. Aktuellen `main` und alle produktiven Projectile-Consumer erneut durchsuchen.
2. Vor Beginn einmal die **aktuelle Testarchitektur** aus `docs/ai/testing.md` und `package.json` verifizieren; entfernte historische Testnamen aus älteren Refactoring-Dokumenten nicht wiederherstellen.
3. Baseline ausführen, mindestens:
   - `npm run typecheck`
   - `npm run check`
   - `npm run test:architecture`
   - `npm run test:integration`
   - relevante aktuelle Projectile-/Combat-/Network-Core-Tests
   - `tests/stress/ProjectilePerformance.test.ts` über den Stress-Runner bzw. den aktuellen passenden fokussierten Aufruf
   - relevante Balance-Lab-Parität nur soweit sie den Projectile-Cutover schützt
4. Bestehende Tests gegen die Characterization-Liste aus 02 §26 prüfen.
5. Nur fehlende **riskante** Semantik ergänzen, insbesondere:
   - Sweep + näherer Obstacle
   - Starting-overlap
   - Multi-target penetration / dedupe
   - BFG/Gauss overlap
   - Hydra split
   - Fire Imbue vor Same-Frame-Hit
   - Tesla Reflection inkl. Spawn Grenade
   - Leaf Deflection
   - ASMD external detonation
   - Grenade real-time fuse
   - Time Bubble flight timing
   - Mini Rocket multi-explosion/coast/return/pickup
   - Rock/Base/Train Multi-Collider
   - Replication static resend / late join / removal by absence
6. Zusätzlich Spawn-during-stage/Reentrancy charakterisieren: insbesondere Hydra/Child-Spawns und weitere Interactions, die während eines laufenden Projectile-Stages neue Projectiles erzeugen. Nicht aus JS-Collection-Iteration auf Sollverhalten schließen.
7. Tests bevorzugt an langlebiger Semantik ausrichten; keine neue Testexplosion, kein authored Tuning als zweite Wahrheit.
8. Temporäre Cutover-Ratchets nur mit benanntem Exit-Kriterium anlegen; bereits im Test-Refactoring gelöschte historische Phase-/Source-Ratchets nicht wiederherstellen.

### Nicht tun

- noch keine neue Runtime implementieren
- keine vollständige Consumer-Matrix in `04` schreiben
- keine Datei-/Testliste als Statushistorie pflegen
- keine Balancewerte neu einfrieren

### Lokaler Abschluss

Die riskantesten vorhandenen Regeln sind entweder durch bestehende Tests abgedeckt oder gezielt charakterisiert.

### Fokussierte Verifikation

- neu/angepasste Characterization-Tests auf kleinster sinnvoller Ebene
- `npm run typecheck`
- Baseline-`npm run check`
- `npm run test:architecture`
- `npm run test:integration`
- relevanter Projectile-Stress-/Balance-Lab-Gate gemäß `docs/ai/testing.md`
- `git diff --check`

---

## Phase 2A – Spawn Contract, Provenance und Execution-Grenze

### Ziel

Die obere Execution-Seite spricht ab jetzt eine stabile semantische Projectile-Spawn-Sprache.

### Aufgaben

1. `ProjectileSpawnRequest` materialisieren:
   - origin
   - flight
   - provenance
   - interaction
   - passive presentation metadata/projection reference
2. `ProjectileSpawnPort` materialisieren.
3. Config-/Execution-Adapter so umbauen, dass:
   - Player
   - automated sources
   - specialized execution
   - Turret/World-Sources
   denselben aufgelösten Spawn-Contract verwenden.
4. Source / Attribution / Allegiance / SourceSlot / Turret / Lineage / Correlation korrekt trennen.
5. Child-/Split-Spawn-Contract vorbereiten.
6. `WorldProjectileRuntime` in dieser Phase noch nicht mit allen Runtime-Details beladen.
7. Falls nötig: **ein** schmaler one-way Legacy-Spawn-Adapter zum alten Manager; dieser darf nur `ProjectileSpawnRequest → bestehende Spawn-Senke` übersetzen und wird in 2B geschlossen.
8. Realisierte Contract-Namen in `04` eintragen.

### Nicht tun

- kein neuer `ProjectileContext`
- keine Gameplay-Regel aus `projectileStyle`
- kein vollständiger Config-Rewrite
- kein zweiter Spawn-Request-Typ für automated/specialized fire ohne echte Semantikabweichung

### Lokaler Abschluss

Alle produktiven Spawn-Quellen können über den neuen semantischen Spawn-Port beschrieben werden.

### Fokussierte Verifikation

- Execution-/Spawn-Contract-Tests
- Source-/Attribution-/Reflection-nahe pure Tests
- Source Search auf neue direkte `ProjectileManager.spawnProjectile`-Consumer
- `git diff --check`

---

## Phase 2B – WorldProjectileRuntime, Store, Identity und autoritativer Spawn-Cutover

### Ziel

Der neue world-owned Owner wird die einzige autoritative Projectile Registry und übernimmt Spawn/Identity/Physics-Lifetime-Grundlagen.

### Aufgaben

1. `WorldProjectileRuntime` **an die tatsächliche `WorldRuntime`-/World-Revision-Lifetime binden** und world-scoped materialisieren; dies ist bereits die echte fachliche Lifetime, kein nur nomineller Übergangsscope.
2. Privaten `ProjectileStore` / Runtime Record materialisieren.
3. Einzige ID-Vergabe und O(1)-ID-Lookup dort verankern.
4. Spawn:
   - Physics Handle erzeugen
   - resolved spec/state anlegen
   - Capability-Indizes initialisieren
   - Host-Zeit explizit setzen
5. Removal/teardown/idempotentes Destroy im neuen Owner verankern.
6. World Composition so umstellen, dass authoritative Host-Spawns in den neuen Store gehen.
7. Legacy-Spawn-Adapter aus 2A schließen.
8. `ProjectileManager` darf ab jetzt **keine zweite Host-Registry** mehr parallel produktiv führen.
9. Für noch nicht migrierte Host-Gameplay-Consumer ausschließlich den **Single-State Legacy Access Seam aus §5.1** anbinden: derselbe kanonische Store, keine Kopie, keine neue Consumer-Aufnahme, Schließphase je Consumer in `04` sichtbar halten.
10. Eventuell verbleibender Manager-Code für Network/Client/Presentation ist explizit nur Transition bis 11–13 und besitzt keine Host-Registry/Gameplay-Authority.
11. Realisierte Runtime-/Store-Namen sowie den aktuell noch aktiven Legacy-Seam knapp in `04` eintragen.

### Kritische Invariante

Nach dieser Phase existiert kein dualer Host-Projectile-State. Alle noch offenen Legacy-Consumer sehen – soweit überhaupt nötig – ausschließlich denselben kanonischen State über den befristeten Seam aus §5.1.

### Lokaler Abschluss

Neue Projectiles erhalten ID, Physics Handle und Core State ausschließlich im world-owned Projectile Owner; dessen Lifecycle ist bereits an die echte World-Lifetime gebunden.

### Fokussierte Verifikation

- Spawn/identity/removal/teardown Tests
- World-lifetime tests
- Source Search auf parallele Host-Registries und unbenannte Legacy-Access-Pfade
- `npm run typecheck`
- `git diff --check`

---

## Phase 3 – Flight, Lifetime, Homing und Core Runtime Processing

### Ziel

Die allgemeine per-frame Projectile-Simulation verlässt den Legacy-Manager und arbeitet auf dem privaten Runtime-State.

### Aufgaben

1. Core Flight/Lifetime migrieren:
   - simulated age
   - host age
   - range
   - velocity/drag/decay
   - hitbox growth
   - expiry bookkeeping
2. `Date.now()` aus migrierter Host-Projectile-Logik entfernen; `nowMs` explizit.
3. Time-Field-Port anbinden.
4. Homing Controller auf schmale Daten/Ports migrieren:
   - Kinematics
   - HomingSpec
   - HomingRuntimeState
   - Target Query
   - Targetability
   - Line of Fire
5. Bestehende Pooling-/Scratch-/TypedArray-Techniken erhalten.
6. Nur bei realem Nutzen private Capability-Indizes materialisieren.
7. Grenade-Fuse-Zeitdimension noch nicht mit Explosion-Fan-out vermischen.
8. Simple bounce/penetration-flight bookkeeping migrieren, soweit nicht an Candidate-Resolution gebunden.
9. Keine Renderer-Aufrufe im neuen Processor.

### Lokaler Abschluss

Der neue Owner kann Projectiles flight-/lifetime-seitig deterministisch fortschreiben, ohne `TrackedProjectile` als externen Contract.

### Fokussierte Verifikation

- Flight/lifetime/time-bubble tests
- homing tests
- grenade fuse characterization
- performance-relevante Homing-/allocation tests
- Source Check auf versteckte neue Host-Wallclock
- `git diff --check`

---

## Phase 4 – External Interaction und schmale Read Ports

### Ziel

Fremde Systeme greifen nicht mehr auf die aktive Projectile-Collection oder Runtime-Records zu.

### Aufgaben

1. `ProjectileExternalInteractionPort` materialisieren.
2. ASMD / Detonation auf semantische Search-/Detonate-Operation umstellen.
3. Consumable/Transform/Deflect-Command-Familie nur soweit reale Consumer existieren.
4. Translocator auf schmale Puck-Capability umstellen:
   - spawn
   - position read
   - consume
5. Enemy Dodge auf `ProjectileThreatReadPort` umstellen.
6. Weapon Balance / Diagnostics auf Summary-Read umstellen.
7. Host Presentation-Sonderreads wie BFG-in-flight nicht über Runtime-Record-Iteration bedienen.
8. `getActiveProjectiles()` / `getProjectileById()` für diese Consumer entfernen.
9. Private Capability-Indizes für `detonable`, `miniRocket`, o. ä. nur intern verwenden.
10. Realisierte External-/Read-Port-Namen in `04` eintragen.

### Lokaler Abschluss

Kein migrierter Fremdconsumer traversiert oder mutiert einen internen Projectile Runtime Record.

### Fokussierte Verifikation

- Detonation/ASMD tests
- Translocator tests
- Enemy Dodge tests
- Diagnostics/Balance Lab targeted tests
- Source Search auf die migrierten Legacy-Reads
- `git diff --check`

---

## Phase 5 – Travel-/Environment-Interaction und Augments

### Ziel

Flight-seitige Interaktionen werden semantisch beschrieben und mutieren Projectile-State nur über den Projectile-Owner.

### Aufgaben

1. Travel Segment / Capability View materialisieren.
2. Fire Imbue:
   - Environment/Fire Owner entscheidet fachliche Imbue-Semantik
   - Projectile Owner wendet `BurnAugment` an
   - Same-Frame-Hit sieht den Augment
3. Flamethrower-Upgrade-Pfad von `TrackedProjectile`-Mutation lösen.
4. AWP Corridor / Path Effect:
   - explizite Path-Capability
   - lokale Dedupe
   - Domain Requests für Damage/Fire/Impulse
   - keine `projectileStyle === 'awp'` Gameplay-Entscheidung
5. Fireball Trail / Ground Fire als World-/Fire-Request.
6. Augment-Provenance erhalten.
7. Legacy `WeaponUpgradeSystem` / `FlamethrowerUpgradeSystem` nur soweit nötig zu Rule-/Domain-Ownern reduzieren.
8. versteckte `Date.now()` im berührten AWP-/Travel-Pfad entfernen.

### Kritische Invariante

Travel-/Environment-Augments, die einen Hit beeinflussen, sind vor Target Interaction wirksam.

### Lokaler Abschluss

Kein Travel-/Upgrade-System mutiert fremde Projectile Runtime Records direkt.

### Fokussierte Verifikation

- Fire Imbue same-frame
- AWP corridor/path tests
- Fire trail tests
- Burn augment merge/provenance tests
- Source Search auf `getActiveProjectiles()` in migrierten Upgrade-Systemen
- `git diff --check`

---

## Phase 6 – Collision Candidate, Target-/Geometry-Grenzen und Defense/Deflection-Cutover

### Ziel

Projectile Target Collision verlässt `CombatSystem`; Geometry und Defense werden schmal konsumiert, ohne fremde Owner in die Simulation zu ziehen.

### Risiko

**Hoch.** Diese Phase verändert eine zentrale Same-Frame-Grenze und ist Grundlage für 7–10.

### Aufgaben

1. Aktuelle Reihenfolge innerhalb `CombatSystem.update()` und `HostUpdateCoordinator` erneut exakt kartieren.
2. `ProjectileTargetRef` und stabile Target Keys materialisieren.
3. immutable Target Query / Geometry Ports materialisieren.
4. Continuous Collision / Sweep / Overlap / Physics-Candidate-Generierung aus dem Combat-Pfad in Projectile verschieben.
5. Obstacle-Blocking und nearest-hit-Semantik erhalten.
6. Deterministische Candidate-Reihenfolge + Penetration/Dedupe anwenden.
7. Rock/Base/Train/Construction/Player/Enemy/Decoy/Projectile Targets normalisieren und **kanonische Target-Identität** erzwingen: dieselbe Entity darf nicht gleichzeitig unter zwei Target-Kinds/Dedupe-Keys erscheinen; insbesondere heutige Rock-/Placeable-Infrastruktur prüfen.
8. Barrier-/Defense-Contract-Familie materialisieren und die drei Pfade semantisch trennen:
   - World-space Barrier vor normaler Target-Interaction
   - target-local Defense im Direct-Impact-/Target-Owner-Pfad
   - aktive externe Deflection als External Interaction
   - keine Pflicht zu drei physischen Interfaces, solange Authority und Aufrufpunkt eindeutig bleiben
9. Tesla Dome als World-space Barrier:
   - keine direkte `TeslaDomeSystem`-Abhängigkeit im Projectile Core
   - Reflection mutiert Attribution/Allegiance im Projectile Owner
10. Player Energy Shield als target-local Defense verankern; nicht zusätzlich im vorgelagerten Barrier-Pfad entscheiden.
11. Leaf Deflection als External Interaction/Projectile↔Projectile-Transform abbilden.
12. `CombatSystem` darf nach dem Cutover keine aktive Projectile-Collection mehr für Target Collision iterieren.
13. Den Projectile-Interaction-Stage an der **semantisch korrekten Host-Frame-Stelle** einhängen.
    - Nicht blind an die bisherige `ProjectileManager.hostUpdate()`-Position verschieben.
    - Falls die bestehende `CombatSystem.update()`-Reihenfolge für andere Combat-Arbeit relevant ist, nur den minimal nötigen lokalen Stage-Schnitt herstellen.
14. Kein Full-Combat-Refactor.
15. Realisierte Target-/Defense-/Geometry-Namen in `04`.

### Übergang zu Phase 7

Collision darf vorübergehend einen schmalen Legacy-Impact-Adapter aufrufen. Es darf aber **keinen zweiten alten Collision-Writer** mehr geben.

### Lokaler Abschluss

Collision Candidate Authority liegt bei Projectile; `CombatSystem` iteriert keine Projectiles mehr zur Target-Collision.

### Fokussierte Verifikation

- Sweep / obstacle / starting overlap
- penetration / BFG / Gauss dedupe
- Tesla reflection
- Leaf deflection
- Rock/Base/Train candidate tests
- Host order contract
- Source Search: kein Projectile-Target-Loop in `CombatSystem`
- `git diff --check`

---

## Phase 7 – ProjectileCombatPort, Direct Impact und authoritative Outcomes

### Ziel

Projectile fordert Combat-Wirkung semantisch an; tatsächliche Combat-Mutation und bestätigte Outcomes bleiben beim Combat-/Domain-Owner.

### Aufgaben

1. `ProjectileCombatPort` materialisieren und eine **Combat-eigene Target-Teilmenge** von `ProjectileTargetRef` verwenden; World-/Construction-/Projectile-Targets laufen nicht nur wegen des gemeinsamen Collision-Typs durch Combat.
2. Direct Impact Request auf:
   - target
   - impact point
   - velocity
   - provenance
   - direct-hit spec
   - augments
   begrenzen.
3. Bestehende Damage/Armor/Shield/Burn-Regeln hinter den Port adaptieren.
4. Authoritative Direct Impact Outcome nur mit real benötigten Feldern materialisieren.
5. Gameplay Reactions auf bestätigte Outcomes umstellen:
   - tatsächlicher Hit/Damage
   - Kill/Death soweit benötigt
   - AK47-relevante Resultate
   - Legacy-Adrenalin als Reaction-Metadatum
6. `CombatSystem` darf keine Projectile-Objekte destroyen/spawnen.
7. Reflection-Ergebnis führt nur zu Projectile-Mutation im Projectile Owner.
8. Keine allgemeine Combat-/Damage-Neuarchitektur.
9. Lifecycle-/Outcome-Contract-Namen in `04`.

### Kritische Invariante

`Interaction Result` und `Authoritative Outcome` bleiben getrennt.

### Lokaler Abschluss

Direct Projectile Hits funktionieren konzeptionell über die stabile Projectile↔Combat-Grenze; Combat kennt keinen `TrackedProjectile`-Contract mehr.

### Fokussierte Verifikation

- direct impact tests
- shield/defense tests
- burn-on-hit tests
- AK47 hit/resolve
- support/no-damage cases soweit Direct Impact
- Source Search auf `TrackedProjectile` in neuen Combat-Port-Grenzen
- `git diff --check`

---

## Phase 8 – Explosion-/Domain-Effect-Orchestrierung, Grenades und Continuation

### Ziel

Explosionen bleiben Projectile-Ausgänge, aber ihr fachlicher Fan-out wird außerhalb der Projectile-Simulation und außerhalb eines aufgeblähten Combat-Ports orchestriert.

### Aufgaben

1. separate Projectile Explosion / Domain-Effect Resolution materialisieren.
2. `ProjectileCombatPort` auf Combat-Anteil begrenzt halten.
3. Fan-out sauber delegieren:
   - Combat AoE
   - Environment Damage
   - Knockback
   - Ground Fire
   - Fire Chunks
   - Black Hole
   - Reinforcement Matrix
   - Time Bubble
   - weitere vorhandene World/Support Effects
4. Standalone World-/Combat-Explosionen nicht künstlich in `WorldProjectileRuntime` ziehen.
5. Grenade terminal payloads migrieren:
   - damage
   - `spawn_enemy`
   - fire
   - time bubble
   - smoke
6. Reflection von Spawn Grenade:
   - Restfuse erhalten
   - Attribution/Allegiance korrekt mutieren
   - Source/Lineage nicht verlieren
   - terminaler `DomainEntitySpawnRequest` übernimmt Attribution/Allegiance aus der **aktuellen Projectile-Provenance zum Resolution-Zeitpunkt**, nicht aus einer am ursprünglichen Spawn eingefrorenen hostile Faction
7. Deferred Explosion Resolution relativ zu Post-Projectile Stage erhalten.
8. Mini-Rocket-Explosion-Continuation als kleinen spezifischen Rückkanal vorbereiten/verwenden.
9. kein generisches Workflow-/Promise-/ExplosionManager-Framework.
10. Domain-Effect-/Explosion-Contract-Namen in `04`.

### Lokaler Abschluss

Projectile Simulation erzeugt typisierte Explosion Requests; der gesamte Domain-Fan-out wird durch passende Domain-Owner ausgeführt.

### Fokussierte Verifikation

- rocket/explosion parity
- grenade payloads
- reflected spawn grenade
- environment/base/train explosion damage
- reinforcement/time-bubble/fire world effects
- deferred order tests
- `git diff --check`

---

## Phase 9 – Komplexe Projectile-State-Machines und sparse Feature-State

### Ziel

Die verbleibenden multi-frame Projectile-Sonderfälle werden in klaren lokalen State-Blöcken/Processor umgesetzt, ohne Weapon-Type-Systeme zu erzeugen.

### Aufgaben

1. Mini Rocket vollständig migrieren:
   - attack
   - explosion
   - coast
   - repeat stages
   - speed reduction
   - excluded target
   - spent
   - return reserve
   - owner return
   - pickup
   - destroyed/collected outcomes
2. Hydra:
   - bounce
   - split
   - child IDs
   - remaining range
   - lineage/correlation soweit benötigt
3. BFG:
   - overlap/proximity
   - per-target dedupe
   - pulse semantics
4. Gauss:
   - piercing/overlap
   - chain-/target dedupe semantics
5. Flame / Leaf Blower flight state:
   - decay/grow
   - stop threshold
   - projectile-local state
6. Grenade flight/bounce/friction state soweit noch Legacy.
7. Homing + special-state Integration, ohne Mini Rocket in generisches Homing zu pressen.
8. sparse State/Indices nur nach 02 §4.3.
9. keine `MiniRocketSystem`, `HydraSystem`, etc. als neue globale fachliche Owner; benannte lokale Processor sind nur bei echter State-Machine erlaubt.

### Lokaler Abschluss

Komplexe multi-frame Projectile-Semantik liegt vollständig im Projectile Owner und ist nicht mehr an den Legacy-Manager gebunden.

### Fokussierte Verifikation

- Mini Rocket vollständige State-Machine
- Hydra split/bounce inkl. explizitem Spawn-during-stage/Reentrancy-Vertrag
- BFG/Gauss
- Flame/Leaf flight
- grenade motion/fuse
- homing interaction
- `git diff --check`

---

## Phase 10 – Sonderfall-Parität und Host-Gameplay-Vollständigkeit

### Ziel

Vor Network/Client/Presentation wird die komplette autoritative Gameplay-Seite gegen die Referenzmatrix aus 02 §25 geschlossen.

### Aufgaben

1. Jede Zeile der Sonderfall-Matrix §25 gegen aktuellen Code prüfen.
2. Noch offene Gameplay-Branches aus `ProjectileManager` migrieren oder bewusst als nicht-Projectile-eigen klassifizieren.
3. Lifecycle Outcomes finalisieren:
   - resolved
   - mini-rocket-collected
   - mini-rocket-destroyed
4. AK47/Player-Behavior erhält nur semantische Outcome-Daten, kein Runtime-Record.
5. Energy Injector / Support Payload ohne Damage-Umweg verifizieren.
6. Reinforcement Matrix / Time Bubble / Spawn Grenade / Plasma Swarm / Tesla Bolt / Shotgun / Translocator / ASMD parity prüfen.
7. Rock/Base/Train/Support Direct- und AoE-Seams auf einen Writer prüfen.
8. External Interaction / Defense / Combat / Domain-Effect Übergangsadapter aus 6–9 schließen, soweit sie nicht finaler Adapter sind.
9. Source Search:
   - kein produktiver Host-Gameplay-Consumer nutzt `TrackedProjectile`
   - kein Host-Gameplay-Consumer traversiert `ProjectileManager`-State
10. Keine neuen Features hinzufügen.

### Lokaler Abschluss

Die autoritative Host-Projectile-Semantik ist funktional vollständig auf der Zielarchitektur abgebildet. Verbleibender Legacy-Code betrifft nur noch Replication/Client/Presentation/Composition.

### Fokussierte Verifikation

- gesamte Projectile-Characterization aus Phase 1
- `npm run typecheck`
- **verpflichtend `npm run check`**
- **verpflichtend `npm run test:architecture`**
- **verpflichtend `npm run test:integration`**
- relevanter Projectile-Teil aus `npm run test:stress` und `npm run test:balance-lab`; bei vertretbarer Laufzeit bevorzugt die vollständigen beiden Suites
- Host-Gameplay darf hier keine offene Projectile-Transition mehr als Testfehler hinterlassen; nur klar den Projection-/Legacy-Cutovers 11–14 zugeordnete Fehler dürfen noch als aktive Transition dokumentiert sein
- keine Wiederbelebung gelöschter historischer Host-Frame-Source-Ratchets; Reihenfolge über langlebigen Behavior-/Integration-/Architecture-Vertrag schützen
- `git diff --check`

---

## Phase 11 – Host Replication Adapter und Wire-Semantik

### Ziel

Host-Replication wird reine Projektion aus autoritativem Projectile-State.

### Aufgaben

1. `ProjectileReplicationAdapter` materialisieren.
2. Simulation liefert nur benötigte Projection.
3. Adapter besitzt:
   - static resend count
   - refresh cursor
   - full snapshot request
   - seen IDs
   - codec-Aufruf
4. bestehende Wire-Semantik zunächst erhalten:
   - `s` static
   - vollständiges `u` dynamic
   - removal by absence
   - full snapshot static for all active IDs
   - resend/refresh healing
5. keine internen Capability-/Dedupe-/Homing-/Physics-Strukturen replizieren.
6. `NetworkBridge` bleibt außerhalb Runtime/Simulation.
7. Wire-Format nur ändern, wenn die existierende Projection den Zielvertrag sonst nicht korrekt ausdrücken kann.
8. Realisierten Replication-Namen in `04`.

### Lokaler Abschluss

Autoritative Simulation besitzt keinen Network-/Codec-/Resend-State mehr.

### Fokussierte Verifikation

- ProjectileSnapshotCodec
- loss/static resend
- full snapshot / late join
- despawn by absence
- stale ID behavior
- Source Search auf NetworkBridge/codec in Simulation
- `git diff --check`

---

## Phase 12 – Client Projectile Replica

### Ziel

Client-State und Extrapolation werden aus dem Legacy-Manager in einen nichtautoritativen Replica-Owner verschoben.

### Aufgaben

1. `ProjectileClientReplica` materialisieren.
2. Decoded server state pro ID halten.
3. Empfangszeit / extrapolation anchor klar trennen.
4. Erhalten:
   - lineare Extrapolation normaler Projectiles
   - Flame/Leaf velocity decay parity
   - snapshot correction
   - removal by absence
5. Keine lokale:
   - collision authority
   - reflection
   - explosion decision
   - gameplay despawn rule
6. ClientUpdateCoordinator auf Replica-API umstellen.
7. Keine Renderer in der Replica.
8. Realisierten Replica-Namen in `04`.

### Lokaler Abschluss

Client-Projectile-State funktioniert ohne autoritativen Runtime Record und ohne Renderer-Besitz.

### Fokussierte Verifikation

- extrapolation tests
- snapshot correction
- removal
- packet-loss/late-join client behavior
- Source Search auf Combat/Domain-Owner in Replica
- `git diff --check`

---

## Phase 13 – Projectile Presentation Runtime

### Ziel

Renderer, VFX, Audio, Licht und Schatten liegen vollständig außerhalb der autoritativen Simulation und Client Replica.

### Aufgaben

1. `ProjectilePresentationRuntime` bzw. passende Presentation-Bindings materialisieren.
2. Host und Client auf ein möglichst gemeinsames Presentation Read Model bringen.
3. passive/opaque Presentation Metadata nur in Presentation interpretieren.
4. migrieren:
   - Bullet/Ball/Energy/Hydra/Spore/Flame/Fireball/Leaf/BFG/AWP/Gauss/Rocket/Grenade/Holy/Translocator/Tesla Renderer
   - Projectile Burn visuals
   - Muzzle/Impact/Bounce effects
   - shot audio
   - lighting samples
   - shadow samples
5. `projectileStyle` darf nur Presentation Dispatch sein.
6. eigenes predicted shot audio / duplicate suppression erhalten.
7. `suppressSpawnFx` als Presentation-Semantik erhalten.
8. Hydra-/despawn-basierte visuelle Heuristiken dürfen bleiben, solange sie keine Gameplay-Authority erzeugen.
9. HostUpdateCoordinator-BFG-Rumble über Presentation Read statt aktive Runtime-Records.
10. Realisierten Presentation-Namen in `04`.

### Lokaler Abschluss

Kein Renderer/Audio/Lighting/Shadow-Code befindet sich im autoritativen Projectile Owner oder Client Replica.

### Fokussierte Verifikation

- Presentation unit/contract tests soweit vorhanden
- host/client presentation projection parity
- no-double-spawn-audio tests
- Source Ratchets Renderer ↔ Simulation
- keine Browser-/Sichtprüfung
- `git diff --check`

---

## Phase 14 – World Composition, Host Frame, Legacy Removal und endgültiger Cutover

### Ziel

Alle neuen Teile werden über echte World-Lifetime komponiert; Restzugriffe auf den Legacy-Manager verschwinden.

### Risiko

**Hoch.** Kleine Composition-/Lifetime-Fehler können sehr viele Systeme gleichzeitig betreffen.

### Aufgaben

1. Die bereits seit Phase 2B bestehende echte World-Lifetime von `WorldProjectileRuntime` verifizieren und die **finale Composition-/Binding-Struktur** darauf bereinigen; Phase 14 führt keine neue fachliche Lifetime ein.
2. World teardown löscht:
   - authoritative store
   - private indices
   - pending interaction state
   - replication adapter state
   - client replica state soweit world-scoped
   - presentation state/binding
3. `ArenaContext` / Scene-/World-Composition so bereinigen, dass kein produktiver `ProjectileManager` mehr verteilt wird und keine scene-langlebige Rest-Ownership die World-Lifetime überlebt.
4. HostUpdateCoordinator final auf semantische Projectile Stage(s) umstellen.
5. Relative Reihenfolge aus 02 §24 endgültig absichern.
6. ClientUpdateCoordinator nur noch Replica + Presentation.
7. WorldGeometryBinding / WorldTrainRuntime / WorldCombatGameplayBinding / WorldSupportGameplayRuntime auf finale Ports.
8. Execution Runtime/Adapter erhalten nur `ProjectileSpawnPort`.
9. Activity-/Enemy-Composition erhält nur benötigte Read/Execution-/External-Ports.
10. alten `ProjectileManager` produktiv entfernen:
    - Datei löschen oder nur dann behalten, wenn kein produktiver Code sie mehr importiert und sie bewusst als sofort zu löschendes Testartefakt identifiziert ist; Ziel ist vollständige Entfernung
11. `TrackedProjectile` aus produktiven APIs entfernen; Typ löschen, sobald kein legitimer interner Migrationsbedarf mehr besteht.
12. tote Setter/Callbacks/Legacy-Adapter löschen.
13. keine Compatibility-Fassade stehen lassen.
14. Architektur-Ratchets aus 01/02 materialisieren.

### Lokaler Abschluss

Es existiert produktiv nur noch die neue Projectile Runtime + ihre Adapter/Projection-Owner; der alte `ProjectileManager` ist verschwunden.

### Fokussierte Verifikation

- World lifecycle / teardown
- aktuelle langlebige Host-Frame-/World-Composition-Contracts (nicht den entfernten historischen `HostUpdatePhaseContracts`-Test wiederherstellen)
- WorldCombatGameplayBinding
- Activity/World composition
- Network/client composition
- Source Ratchets über `npm run test:architecture`
- **`npm run typecheck` muss grün sein**
- **`npm run check` muss grün sein**
- **`npm run test:architecture` und `npm run test:integration` müssen grün sein**
- `npm run test:stress` und `npm run test:balance-lab` vollständig ausführen, sofern kein klar dokumentierter, nicht vom Projectile-Refactor berührter externer Flake vorliegt
- `git diff --check`

---

## Phase 15 – Finaler Cleanup, Gesamtverifikation und Knowledge Writeback

### Ziel

Der Refactor wird als vollständig integrierter, fehlerfreier Stand abgeschlossen.

### 15.1 Vollständiger Source-Cleanup

Prüfen und entfernen:

- `ProjectileManager`
- produktive `TrackedProjectile`-Imports
- `getActiveProjectiles`
- allgemeines `getProjectileById`
- Legacy Projectile Callback Setter
- Network-/Renderer-Imports im autoritativen Owner
- Gameplay-Switches auf `projectileStyle`
- parallele Projectile-Registry
- versteckte Host-Wallclock im migrierten Core
- alte Combat Projectile loops
- tote Transition-Adapter
- unnötige Capability-Indizes/Stores ohne realen Nutzen

### 15.2 Architektur-Ratchets

Mindestens absichern:

1. kein produktiver `ProjectileManager`
2. keine produktive API gibt `TrackedProjectile` zurück
3. Execution hängt nur am Spawn-Port
4. Combat importiert keinen internen Projectile Runtime State
5. Combat besitzt keine Projectile Target Collision
6. Simulation importiert keinen NetworkBridge/Codec
7. Simulation importiert keine Renderer/Audio
8. Client Replica importiert keinen Combat-/Domain-Mutation-Owner
9. Presentation importiert keinen mutierbaren Runtime Record
10. Detonation/Translocator traversieren keine Runtime Collection
11. Enemy Dodge erhält nur Threat Samples
12. Gameplay-Core verzweigt nicht auf Presentation Style
13. nur eine autoritative Projectile Registry
14. keine globale ECS-/System-/Behavior Registry
15. private Capability-Indizes werden nicht öffentlich
16. neue Capability-Felder folgen der semantischen Reuse-Regel
17. konkrete Defense-Systeme sickern nicht in die Simulation
18. Explosion/Domain-Effect-Fan-out bläht `ProjectileCombatPort` nicht zum Universal-Port auf

### 15.3 Testmigration

Bestehende Tests auf langlebige Zielverträge umstellen.

Nicht behalten:

- Tests, die ausschließlich `ProjectileManager`-Methodennamen/Dateiposition schützen
- künstliche Call-Shape-Tests ohne Schutzwert
- doppelte Tests für bereits besser geschützte Semantik

Behalten/umschreiben:

- Same-Frame-Verträge
- Snapshot/Wire/Loss
- Lifecycle/teardown
- collision/penetration/dedupe
- reflection/deflection
- complex state machines
- domain-owner boundaries

### 15.4 Knowledge Writeback

Prüfen und bei Bedarf aktualisieren:

- `docs/ai/gameplay.md`
- `docs/ai/networking.md`
- `docs/ai/rendering.md`
- `docs/ai/testing.md` nur falls sich durch den Refactor eine **dauerhafte** Testregel ändert; sonst unverändert lassen
- relevante Architektur-/Testing-Seiten

`01`, `02` und `03` werden von der Coding-KI nicht selbständig umdefiniert. Falls der tatsächliche Endzustand eine Architekturkorrektur verlangt, bleibt ein knapper Review-Hinweis in `04` und die normative Änderung erfolgt bewusst separat.

### 15.5 Automatisierter Final-Gate

Der **Final-Gate muss vollständig grün** sein.

Mindestens:

```bash
npm run typecheck
npm run check
npm run test:architecture
npm run test:integration
npm run test:stress
npm run test:balance-lab
npm run test:assets
```

`npm run test:assets` ist für den Projectile-Refactor voraussichtlich nur ein unverändertes repo-weites Abschlussgate; es sollen dafür keine neuen Pixel-/Assettests ohne Schutzwert entstehen. Zusätzlich die im aktuellen Repository vorhandenen relevanten Suites/Tests für:

- Projectile Simulation
- Projectile Collision
- Combat integration
- Reflection / Deflection
- ASMD / Detonation
- Travel / Fire Imbue / AWP
- Hydra / BFG / Gauss
- Grenade / Mini Rocket
- Rock / Base / Train / Support
- Snapshot codec / late join / packet loss
- Client extrapolation / removal
- World lifecycle / teardown
- Host frame order
- World/Activity composition

Falls das Test-Refactoring inzwischen spezialisierte Runner eingeführt hat, die passenden Runner ebenfalls ausführen. Keine veralteten Script-Namen aus diesem Plan erzwingen; `package.json` ist maßgeblich.

### 15.6 Status nach technischem Abschluss

`04` wird auf einen kleinen Abschlusszustand reduziert:

- alle Phasen ✅
- keine aktive Transition
- Final-Gate grün
- realisierte Contract-Namen
- eventuelle echte Architektur-Review-Notiz

Keine Historie ergänzen.

---

# 9. Teststrategie während des Cutovers

## 9.1 Kein global grüner Behavior-Gate pro Phase – aber immer grüner Typecheck

Zwischen 2A und 14 dürfen **gezielte Behavior-/Integrationstests** vorübergehend rot sein, wenn die Ursache unmittelbar aus einer ausdrücklich geplanten Transition folgt. `npm run typecheck` ist davon ausgenommen: **jede erfolgreich abgeschlossene Phase muss typkompilieren**.

Ein roter Behavior-/Integration-Zwischenstand ist nur akzeptabel, wenn:

- die Ursache unmittelbar aus einer geplanten Transition des Plans folgt,
- es keinen dualen Writer/keine zweite Registry gibt,
- die zuständige Schließphase benannt ist,
- `04` den aktuell offenen Bruch knapp nennt,
- die KI keine künstliche Parallelarchitektur nur zum Grünmachen einführt.

Ein roter Typecheck bedeutet: Phase nicht abgeschlossen, Phasenschnitt/Implementierung korrigieren oder als Blocker stoppen.

## 9.2 Was pro Phase geprüft wird

Immer:

- `npm run typecheck`
- betroffene neue/angepasste Tests auf der kleinsten sinnvollen Ebene
- Source Search auf die Zielgrenze
- `git diff --check`

Nach Schutzwert/Änderung zusätzlich:

- `npm test` für Core-Regressionen
- `npm run check` für Core + Build
- `npm run test:architecture` für dauerhafte Boundary-Ratchets
- `npm run test:integration` für World-/Composition-Zusammenspiel
- `npm run test:stress` für Projectile-Performance/hohe Last
- `npm run test:balance-lab` für Benchmark-/Config-Parität
- `npm run test:assets` nur bei Asset-/Pixel-/Maskenbezug bzw. im finalen Repo-weiten Gate

Die Testentscheidung folgt `docs/ai/testing.md`: keine neuen Tests ohne benennbaren langlebigen Schutzwert; bestehende passende Tests bevorzugt erweitern; authored Tuning/private Implementierungsform nicht einfrieren.

Ein roter globaler Behavior-Gate ist vor Phase 15 nicht automatisch ein Grund, Legacy zurückzubauen, solange er exakt einer benannten Transition zugeordnet ist. Phase 10 und Phase 14 besitzen jedoch die im Plan festgelegten härteren Integrationsgates.

## 9.3 Characterization vor Cutover, Zieltests nach Cutover

Tests sollen während der Migration von historischer Implementierungsform auf Zielsemantik umziehen.

Beispiel:

```text
alt:
CombatSystem iteriert Projectile X auf konkrete Weise

neu:
Collision erzeugt den korrekten Candidate
→ ProjectileCombatPort erhält den korrekten Request
→ authoritative Outcome verändert Projectile korrekt
```

---

# 10. Erwartete Zielabhängigkeiten

```text
Player / Enemy / Turret / World Execution
                |
                v
        ProjectileSpawnPort
                |
                v
       WorldProjectileRuntime
        |      |       |
        |      |       +--> private Read/Projection
        |      |
        |      +--> Collision / Interaction
        |               |
        |               +--> ProjectileCombatPort ------> Combat owner
        |               +--> Domain Effect Port --------> World/Support owners
        |               +--> local Projectile mutation
        |
        +--> External Interaction Port <--- Detonation / Deflection / Translocator

Host authoritative projection
        |
        +--> ProjectileReplicationAdapter --> Wire
        |
        +--> ProjectilePresentationRuntime

Wire
 |
 v
ProjectileClientReplica
 |
 v
ProjectilePresentationRuntime
```

Keine Rückkante von Client/Presentation/Replication in Gameplay-Authority.

---

# 11. Stop-Kriterien für Coding-KIs

Eine KI soll die Phase nicht durch spekulative Architektur ausweiten, wenn:

- ein sauberer Fix einen vollständigen Combat-Refactor verlangen würde
- eine Produkt-/Gameplayentscheidung aus Code/Tests nicht eindeutig ableitbar ist
- eine neue Universalabstraktion nur für einen einzigen Consumer nötig wäre
- eine Wire-Änderung nur „sauberer“ wirkt, aber keinen konkreten Bedarf besitzt
- ein zweiter Spatial Index nur aus Symmetrie entstehen würde
- eine Capability-Kombination widersprüchliche Semantik hat und keine bestehende Regel entscheidet
- Owner/Lifetime/Authority nicht aus Architektur + Code ableitbar ist
- eine Änderung Favor-the-Shooter-/Hitscan-Semantik in den Projectile-Scope ziehen würde

Dann:

1. sicheren Teil abschließen,
2. knappen Blocker/Review-Bedarf in `04` eintragen,
3. keine Parallelarchitektur erfinden.

---

# 12. Definition of Done

Der Projectile-Runtime-Refactor ist technisch abgeschlossen, wenn:

- alle Phasen in `04` ✅ sind
- `ProjectileManager` produktiv entfernt ist
- `TrackedProjectile` keine öffentliche/produktive Boundary mehr ist
- `WorldProjectileRuntime` alleiniger authoritative Projectile Owner ist
- Spawn nur über die stabile Spawn-Grenze erfolgt
- Collision/Interaction/Domain-Mutation sauber getrennt sind
- `CombatSystem` keine aktiven Projectiles iteriert
- Defense/Deflection über semantische Ports/Commands arbeitet
- Explosion-Fan-out nicht im Projectile Core oder Universal-Combat-Port steckt
- External Consumer keine Runtime Records lesen/mutieren
- Replication/Client/Presentation getrennt sind
- Same-Frame-Verträge erhalten sind
- World teardown stale-sicher ist
- finaler automatisierter Gate vollständig grün ist
- `04` wieder klein und ohne aktive Transition ist

Die anschließende menschliche Gameplay-/Sichtprüfung ist ein separater Abnahme-Gate und wird nicht von Coding-KIs durchgeführt.
