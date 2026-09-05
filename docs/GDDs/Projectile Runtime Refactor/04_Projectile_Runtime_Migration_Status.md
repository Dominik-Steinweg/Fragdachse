# Fragdachse – Projectile Runtime Refactoring: Migrationsstatus

**Architektur:** `01_Projectile_Runtime_Architecture_Core.md` + `02_Projectile_Runtime_Architecture_Details.md`
**Plan:** `03_Projectile_Runtime_Implementation_Plan.md`
**Repository-Basis vor Refactoring:** `main` @ `c6f83bc864c4cf8daa98d32bd6a29ee9a8926ab5`
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

- **Nächste Phase:** `11 – Host Replication Adapter und Wire-Semantik` (offen)
- **Gesamtstatus:** Phase 10 abgeschlossen; autoritatives Host-Gameplay nutzt semantische Projectile-Quellen, Lifecycle-Outcomes und einen schmalen Detonable-Read-Port
- **Baseline:** verifiziert mit `npm run typecheck`, `npm run check` sowie den fokussierten Explosion-, Grenade-, Reflection-, Environment-, World-Effect-, Plasma- und Continuation-Suiten (alle grün)
- **Typecheck-Regel:** jede erfolgreich abgeschlossene Phase muss `npm run typecheck` grün halten
- **Final-Gate:** ausstehend
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
| 11 | ⬜ | Host Replication Adapter |
| 12 | ⬜ | Client Replica |
| 13 | ⬜ | Presentation |
| 14 | ⬜ | Composition + Legacy Removal |
| 15 | ⬜ | Final Cleanup + Gesamtverifikation |

---

## 3. Aktive Transitionen / Blocker

Nur **aktuell offene** Punkte eintragen. Maximal wenige präzise Einträge; erledigte löschen.

Der §5.1-Seam ist der einzige Legacy-Zugriff und zeigt ausschließlich auf denselben kanonischen Store: `ProjectileOwnerSeam` (owner-vermittelter Spawn/Destroy/Release und Host-Frame-Port) und `LegacyProjectileStoreAccess` (Lesen, Deaktivieren, Step-Eintrag entfernen).

- [Transition] `ProjectileManager` verarbeitet Physics-/Obstacle-Reste, Snapshot und Presentation weiter auf demselben kanonischen Store; typisierte Explosion-/Grenade-Requests werden an die deferred Domain-Orchestrierung ausgegeben, während Target-Collision, semantische Combat-Aufträge, Interaction-Stage und Mini-Rocket-State in `WorldProjectileRuntime` liegen.
- [Transition] `ProjectileStageContract` benennt die Spawn-Reentrancy: bestehende Plasma-Swarm-Interaction-Spawns dürfen im selben Collision-Stage verarbeitet werden; Hydra-/sonstige Child-Splits folgen der Next-Stage-Policy.
- [Transition] `HostUpdateCoordinator` ist der schmale `ProjectileExplosionResolutionPort`-Adapter: Combat-AoE läuft über `ProjectileCombatPort`, Environment-/Fire-/Knockback-/World-Effect-Owner bleiben außerhalb der Projectile-Simulation; Standalone-Explosionen werden dort gepuffert und nicht in die Runtime-Registry aufgenommen.
- [Transition] `ProjectileIdentityScope` gehört zur `WorldLifecycle`-Lifetime und wird an jede lokale `WorldRuntime`-Materialisierung derselben `worldRevision` weitergereicht; er endet erst mit `endInstance`.
- [Transition] `TrackedProjectile.provenance` ist die kanonische vollständige Provenance; Legacy-Spawn-Shape und flache Legacy-Felder bleiben nur bis zu ihren späteren Cutovers als Adapter-/Migrationsdaten bestehen.
- [Transition] Legacy-Spawn-Shape `spawnProjectile(x, y, angle, ownerId, cfg)` der noch nicht migrierten Quellen, owner-vermittelt: übrige Gegner-Wurfquellen (9–10), interner Hydra-Split (3).
- [Transition] `toLegacyProjectileSpawnConfig` bildet den Spawn-Auftrag auf den Legacy-Record ab; entfällt mit dessen Ablösung (14).

---

## 4. Realisierte Contract-Namen

Nur tatsächliche Namen im Code dokumentieren.

| Contract-Familie | Realisierter Type/API |
|---|---|
| Projectile Spawn | `ProjectileSpawnPort`, `ProjectileSpawnRequest`, `ProjectileId`, `ProjectileSpawnResult` (`src/projectile/`) |
| World Projectile Runtime / Host Frame | `WorldProjectileRuntime`, `ProjectileHostStageResult`, `ProjectileTimeFieldPort` (`src/projectile/`) |
| Projectile Store / Runtime Record | `ProjectileStore`, `ProjectileIdentityScope`; Record bis zur Ablösung weiterhin `TrackedProjectile` mit kanonischer `provenance` |
| External Interaction | `ProjectileExternalInteractionPort`, `ProjectileDetonationSearchRequest`, `ProjectileDetonationTarget`, `ProjectileDetonationOutcome`, `TranslocatorProjectilePort`, `TranslocatorPuckSpawnRequest` (`src/projectile/ProjectileExternalInteractionPort.ts`) |
| Read Ports | `ProjectileThreatReadPort`, `ProjectileThreatSample`, `ProjectileDiagnosticsReadPort`, `ProjectileDiagnosticsSummary`, `ProjectilePresentationReadPort` (`src/projectile/ProjectileReadPorts.ts`) |
| Travel / Environment | `ProjectileTravelReadPort`, `ProjectileTravelSample`, `ProjectileTravelCapabilities`, `ProjectileFireTrailCapability`, `ProjectileAwpCorridorCapability`, `ProjectileEnvironmentInteractionPort`, `ProjectileBurnAugment`, `ProjectileInteractionAugment` (`src/projectile/ProjectileTravelPort.ts`); `ProjectilePathEffectKind` (`src/types.ts`) |
| Target / Geometry / Targetability | `ProjectileTargetRef`, `projectileTargetKey`, `projectileTargetPhysicalKey`, `ProjectileCollisionTargetQueryPort`, `ProjectileCollisionTarget`, `ProjectileWorldBlockerPort`, `ProjectileTargetabilityPort`, `ProjectileImpactCandidate`, `ProjectileCollisionMode` (`src/projectile/ProjectileTargetPort.ts`, `src/types.ts`); Homing-Reads bleiben daneben bestehen |
| Barrier / Defense | `ProjectileBarrierPort`, `ProjectileBarrierRequest`, `ProjectileBarrierResolution`, `ProjectileDefenseResolution` (`src/projectile/ProjectileInteractionPorts.ts`); `ProjectileExternalInteractionPort.deflectProjectile` für Projectile↔Projectile-Transform |
| Projectile Combat | `ProjectileCombatPort`, `ProjectileCombatTargetRef`, `ProjectileDirectImpactRequest`, `ProjectileDirectImpactOutcome`, `ProjectileCombatExplosionRequest`, `ProjectileCombatExplosionOutcome`, `ProjectileAk47HitContext`, `ProjectileEnergyInjectorImpact`, `ProjectilePlasmaSwarmImpact` (`src/projectile/ProjectileCombatPort.ts`, `src/projectile/ProjectileExplosionPort.ts`) |
| Domain Effect / Explosion Resolution | `ProjectileExplosionResolutionPort`, `ProjectileExplosionRequest`, `ProjectileGrenadePayloadRequest`, `ProjectileExplosionOutcome`, `ProjectileExplosionContinuationPort` (`src/projectile/ProjectileExplosionPort.ts`); `HostUpdateCoordinator.resolveProjectileExplosion` als Domain-Adapter |
| Complex Projectile State | `ProjectileMiniRocketProcessor`, `ProjectileMiniRocketStatePort`, `ProjectileStageSpawnPolicy`, `PROJECTILE_STAGE_SPAWN_CONTRACT` (`src/projectile/`) |
| Lifecycle / Outcomes | `ProjectileDirectImpactOutcome`, `ProjectileReactionMetadata`, `ProjectileExplosionContinuationPort`, `ProjectileImpactSource`, `ProjectileLifecycleOutcome`, `MiniRocketPickupSpec`, `ProjectileMiniRocketCollectedOutcome`, `ProjectileMiniRocketDestroyedOutcome` (`src/projectile/ProjectileGameplayPort.ts`) |
| Detonable Combat Read | `ProjectileDetonableReadPort`, `ProjectileDetonableSample` (`src/projectile/ProjectileGameplayPort.ts`) |
| Replication | — |
| Client Replica | — |
| Presentation | — |

Phase-6-Normalisierung: Combat liefert `player`/`enemy`/`decoy`; statische und runtime-gebundene Placeables werden als `rock` mit `obstacleKind`, Basen und Zug als eigene World-Targets geführt. Der Projectile-Owner ergänzt aktive `projectile`-Targets; `projectileTargetPhysicalKey` dedupliziert Rock/Construction.

---

## 5. Architektur-Review-Bedarf

Nur echte offene Abweichungen von `01`/`02`; keine Verbesserungsideen-Sammlung.

- keiner

---

## 6. Nächster Schritt

**Phase 11 bearbeiten; Host-Replication-Adapter und unveränderte Wire-Semantik materialisieren.**

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
