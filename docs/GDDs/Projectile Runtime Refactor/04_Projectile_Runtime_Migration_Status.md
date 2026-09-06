# Fragdachse – Projectile Runtime Refactoring: Migrationsstatus

**Architektur:** `01_Projectile_Runtime_Architecture_Core.md` + `02_Projectile_Runtime_Architecture_Details.md`
**Plan:** `03_Projectile_Runtime_Implementation_Plan.md`
**Test-Basis:** abgeschlossenes Test-Refactoring; Runner/Policy aus `package.json` und `docs/ai/testing.md`

> Kleiner aktueller Zustandszettel für Coding-KIs – **keine Historie**.
> Git ist die Commit-Historie; hier werden **keine Commit-SHAs** geführt.
> Keine vollständigen Datei-, Consumer- oder Testinventare eintragen.
> Erledigte Transitionen/Blocker löschen statt archivieren.
> Zielgröße: möglichst unter **8 KB**. Wenn die Datei wächst, vor dem nächsten Commit verdichten.
> `01`, `02` und `03` werden von Coding-KIs nicht selbständig umdefiniert.

---

## Statuslegende

- ⬜ offen
- 🟨 aktiv
- 🟧 blockiert
- ✅ abgeschlossen

---

## 1. Aktueller Stand

- **Nächste Phase:** C8 – Architekturabschluss und technische Endabnahme (offen, nicht begonnen)
- **Gesamtstatus:** Phasen 1–15 und C1–C7 umgesetzt; C8 bleibt für den Architekturabschluss notwendig
- **C7-Abnahme:** Typecheck, `npm run check` (Core, Architecture, Build), Integration, Stress und Balance Lab grün. Gezielte Verträge sichern stabile Redirect-Identity, getrennte Attribution/Allegiance, Child-Lineage, Homing-Reacquisition, Kontaktgedächtnis, Restfuse, Static-Resend nach Übernahme und reentranten World-Teardown.
- **C8-Vorarbeiten:** World-Contact-Dedupe cached das vollständige Ergebnis reihenfolgeunabhängig; stabile Same-ID-Redirects replizieren owner-/farb-/quellenabhängige Presentation; tote parallele Homing-/TimeField-/Presentation-Seams sind entfernt. Diese Vorarbeiten markieren C8 nicht als abgeschlossen.
- **Typecheck-Regel:** jede erfolgreich abgeschlossene Phase muss `npm run typecheck` grün halten
- **Final-Gate:** vollständiger Abgleich gegen 01–03 und sämtliche Endabnahme-Suites bleiben C8; C8 ist noch nicht final abgeschlossen, die unabhängige vollständige C8-Endabnahme steht noch aus
- **Manuelle Prüfung:** nicht durch Coding-KI; standardmäßig erst nach technischem Abschluss

---

## 2. Phasenstatus

| Phase | Status | Kurzgegenstand |
|---|:---:|---|
| 1 | ✅ | Baseline + Characterization |
| 2A | ✅ | Spawn Contract + Provenance |
| 2B | ✅ | World Runtime + Store + Spawn Authority |
| 3 | ✅ | Flight + Lifetime + Homing |
| 4 | ✅ | External Interaction + Read Ports |
| 5 | ✅ | Travel / Environment / Augments |
| 6 | ✅ | Collision + Targets + Defense |
| 7 | ✅ | Combat Port + Direct Outcomes |
| 8 | ✅ | Explosion / Domain Effects / Grenades |
| 9 | ✅ | Complex Projectile State Machines |
| 10 | ✅ | Sonderfall-Parität Host Gameplay |
| 11 | ✅ | Host Replication Adapter |
| 12 | ✅ | Client Replica |
| 13 | ✅ | Presentation |
| 14 | ✅ | Composition + Legacy Removal |
| 15 | ✅ | Final Cleanup + Gesamtverifikation |

---

## 2a. Korrekturphasenfolge

Die Folge ist nach der erneuten Prüfung von `01`–`03` und dem Code-Stand definiert; jede Korrekturphase ist ein zusammenhängender Ownership-Schnitt.

| Korrekturphase | Status | Gegenstand |
|---|:---:|---|
| C1 | ✅ | Hydra-/Split-Entscheidung aus dem Physics-Binding gelöst; Child-Spawns explizit in die `next-stage`-Queue gegeben |
| C2 | ✅ | Phaser-Kontakte als technische Kandidaten melden; Rock/Base/Train/Support/Explosion nicht mehr im Binding fachlich entscheiden |
| C3 | ✅ | Collision-/Interaction-Authority konsolidiert und autoritative `projectileStyle`-Verzweigung entfernt |
| C4 | ✅ | World-/Activity-Consumer auf tatsächlich benötigte schmale Ports umgestellt; Universal-Forwarder abgebaut |
| C5 | ✅ | Runtime-Record-/Provenance-/Identity-Audit, dauerhafte Ratchets und erneute Gesamtverifikation |
| C6 | ✅ | Physics-Authority-Cut; technische Handles/Kontakte getrennt von Projectile-Lifecycle und Wirkung |
| C7 | ✅ | Interner resolved Spec-/Runtime-/Feature-State; kanonische Provenance, ein Physics-Handle/Homing-State und Redirects mit stabiler Identity |
| C8 | ⬜ | Dauerhafte Dependency-/Ownership-Ratchets, Gesamtprüfung gegen 01–03 und technische Endabnahme |

---

## 3. Aktive Transitionen / Blocker

Nur **aktuell offene** Punkte eintragen. Maximal wenige präzise Einträge; erledigte löschen.

- C8: Die bekannten Vorarbeiten sind erledigt; unabhängiges abschließendes Audit, vollständiger Abgleich gegen 01–03 und alle technischen Endabnahme-Gates stehen weiterhin aus.

C7 speichert keinen flachen `ProjectileSpawnConfig` mehr. Der verbleibende reine Payload-Adapter bedient Spawn-/Body-Resolver, Presentation und das Headless-Lab; Provenance bleibt separat. Der öffentliche Config-Spawn-Einstieg ist entfernt. Reflection/Deflection verändern den bestehenden Record und behalten Source, Parent-Lineage, Correlation, Kontaktgedächtnis und Lifetime; Replication und Presentation aktualisieren dieselbe ID ohne neue Gameplay-Authority. Der C6-Physics-Cut und die Stage-Reihenfolge bleiben erhalten. Die C8-Vorarbeiten stabilisieren zusätzlich die vollständige World-Contact-Resolution und die owner-/farb-/quellenabhängige Presentation bei gleicher ID; die unabhängige vollständige C8-Endabnahme ist noch offen.

---

## 4. Realisierte Contract-Namen

Nur tatsächliche Namen im Code dokumentieren.

| Contract-Familie | Realisierter Type/API |
|---|---|
| Spawn | `ProjectileSpawnPort`, `ProjectileSpawnRequest`, `ProjectileId`, `ProjectileSpawnResult` |
| World / Host / Store | `WorldProjectileRuntime`, `ProjectileHostStageResult`, `ProjectileTimeFieldPort`, `ProjectileStore`, `ProjectileIdentityScope`; internes `ProjectileRuntimeRecord`, `ProjectileResolvedSpec`, `ProjectileInteractionState`, `ProjectileMiniRocketState`, `ProjectileContactMemory`, passive `ProjectilePresentationMetadata` |
| Physics Binding | `ProjectilePhysicsBindingPort`, `ProjectilePhysicsSpawnSpec`, `ProjectilePhysicsMechanics`, `ProjectilePhysicsHandle`; technische Ressourcen/Kontakte/Geometrie ohne Runtime-Record-Zugriff |
| World Boundary | `ProjectileGeometryBindingPort`, `ProjectileTrainBindingPort`, `ProjectileTrainImpactPort`, `ProjectileWorldImpactBindingPort`, `ProjectileLifecycleEventsBindingPort`, `ProjectileTimeFieldBindingPort`, `ProjectileHomingBindingPort`, `ProjectileSwarmReactionPort` |
| External / Reads | `ProjectileExternalInteractionPort`, `TranslocatorProjectilePort`, `ProjectileThreatReadPort`, `ProjectileDiagnosticsReadPort`, `ProjectilePresentationReadPort` |
| Travel / Environment | `ProjectileTravelReadPort`, `ProjectileTravelSample`, `ProjectileTravelCapabilities`, `ProjectileEnvironmentInteractionPort`, `ProjectileBurnAugment`, `ProjectileInteractionAugment`, `ProjectilePathEffectKind` |
| Target / Geometry | `ProjectileTargetRef`, `projectileTargetKey`, `projectileTargetPhysicalKey`, `ProjectileCollisionTargetQueryPort`, `ProjectileWorldBlockerPort`, `ProjectileTargetabilityPort`, `ProjectileImpactCandidate`, `ProjectilePhysicsContact`, `ProjectilePhysicsContactTarget`, `ProjectileCollisionMode` |
| Collision Resolution | `ProjectileCollisionOutcome`; World-Kandidaten und technische Kontakte werden pro Host-Zeitpunkt über die Runtime dedupliziert |
| Barrier / Defense | `ProjectileBarrierPort`, `ProjectileBarrierRequest`, `ProjectileBarrierResolution`, `ProjectileDefenseResolution`; `deflectProjectile` für Projectile↔Projectile-Transform |
| Combat / Domain Effects | `ProjectileCombatPort`, `ProjectileDirectImpactRequest`, `ProjectileDirectImpactOutcome`, `ProjectileExplosionResolutionPort`, `ProjectileExplosionRequest`, `ProjectileGrenadePayloadRequest`, `ProjectileExplosionOutcome` |
| Complex State / Lifecycle | private Verarbeitung durch `ProjectileLifecycleProcessor` und `ProjectileMiniRocketProcessor`; `ProjectileMiniRocketStatePort`, `PROJECTILE_STAGE_SPAWN_CONTRACT`, `ProjectileImpactSource`, `ProjectileLifecycleOutcome`; WorldRuntime besitzt Explosion-/Continuation-, Direct-Impact-, Detonation-, Burn-, Swarm- und Next-Stage-Authority |
| Detonable / Replication | `ProjectileDetonableReadPort`, `ProjectileDetonableSample`, `ProjectileReplicationAdapter`, `ProjectileReplicationRecord`, `ProjectileReplicationReadPort` |
| Client / Presentation | `ProjectileClientReplica`, `ProjectileClientReplicaState`, `ProjectileClientReplicaFrame`, `ProjectileClientExtrapolatedState`, `ProjectilePresentationRuntime`, `ProjectilePresentationRenderers` |

Phase-6-Normalisierung: Combat liefert `player`/`enemy`/`decoy`; Placeables laufen als `rock` mit `obstacleKind`, Basen/Zug als eigene World-Targets. `projectileTargetPhysicalKey` dedupliziert Rock/Construction.

---

## 5. Architektur-Review-Bedarf

Nur echte offene Abweichungen von `01`/`02`; keine Verbesserungsideen-Sammlung.

- Die oben benannten Abschlussphasen beheben reale Abweichungen von 01/02; keine normative Architekturänderung erforderlich.

---

## 6. Nächster Schritt

**C8 ist die nächste offene Phase. Die dokumentierten Vorarbeiten sind kein Abschluss der Phase: C8 ist noch nicht final abgeschlossen, und die unabhängige vollständige C8-Endabnahme steht noch aus.**

---

## Update-Regel nach jeder Phase

Nur:

1. abgeschlossene Phase auf ✅ setzen.
2. `Nächste Phase` auf die folgende offene Phase aktualisieren; sie bleibt ⬜, solange ihre Bearbeitung noch nicht begonnen hat.
3. Erst beim tatsächlichen Beginn einer Phase deren Status auf 🟨 setzen.
4. aktive Transitionen/Blocker ersetzen oder löschen.
5. neue realisierte Contract-Namen eintragen.
6. Baseline/Final-Gate aktualisieren, falls betroffen; Typecheck-Abschluss ist Voraussetzung für ✅.
7. Nur aktuell relevante Test-/Runner-Abweichungen dokumentieren; keine Testinventare oder gelöschte historische Ratchets wieder aufbauen.
8. nächsten Schritt auf genau die nächste Phase setzen.

Danach die abgeschlossene Phase **inklusive dieser Statusänderung** committen. Kein SHA-Nachtrag. Ein späterer Start der nächsten Phase setzt deren Status erst dann auf 🟨.
