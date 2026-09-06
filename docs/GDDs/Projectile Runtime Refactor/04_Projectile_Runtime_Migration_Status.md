# Fragdachse – Projectile Runtime Refactoring: Abschlussstatus

**Architektur:** `01_Projectile_Runtime_Architecture_Core.md` + `02_Projectile_Runtime_Architecture_Details.md`
**Plan/Gates:** `03_Projectile_Runtime_Implementation_Plan.md`
**Gesamtstatus:** ✅ Architektonisch und technisch abgeschlossen. Keine aktive Transition, kein offener Architekturblocker, keine weitere Refactoring-Phase.

## 1. Endabnahme

Der aktuelle `main` wurde unabhängig gegen 01–03 geprüft, einschließlich C1–C7, C8-Vorarbeiten
und Multiplayer-/Bounce-Änderungen. Frühere Findings waren Hinweise, keine abschließende Prüfliste.

Geprüft sind die einzige world-owned Registry und ihre Lifetime, monotone Identity über
Runtime-Rebuilds, getrennte Provenance, private Spec-/Runtime-/Feature-Daten, Physics-/Collision-/
Interaction-Grenzen, kanonische Targets, semantische Combat-/World-/Explosion-/External-Ports,
Same-/Next-Stage-Verträge, Reflection/Deflection mit stabiler ID sowie Replica-/Presentation-Parität.
Static-Resend/Refresh, Packet-Loss-Heilung, Bounce-Sequenzen und Same-ID-Appearance bleiben abgeleitet.

Drei reproduzierte Fehler sind korrigiert und durch bestehende Runtime-Tests abgesichert:

- Finalisierungsabsturz bei reentrantem World-Teardown.
- Verlust eines reentrant erzeugten Ersatzprojektils aus der Verarbeitungsliste.
- Zusätzliche externe Detonation eines bereits verbrauchten Projectiles vor dessen Freigabe.

Registry-Entfernung ist vor terminalen Reactions vollständig; Finalisierung verwendet eine feste
Startmenge mit Mitgliedschaftsprüfung. Architecture-Ratchets prüfen produktionsweit Legacy-/State-
Grenzen und relevante Abhängigkeiten anhand TypeScript-Syntax statt Konstruktorzeilen,
Kommentartexten oder privaten Array-Deklarationen.

### Automatisierter Final-Gate

Alle Gates auf dem finalen Produktionscode grün:

| Gate | Ergebnis |
|---|---|
| `npm run typecheck` | ✅ |
| `npm run check` | ✅ Core: 321 Dateien / 2620 Tests; Architecture: 6 / 32; Build |
| `npm run test:architecture` | ✅ separat und innerhalb von check |
| `npm run test:integration` | ✅ 14 Dateien / 167 Tests |
| `npm run test:stress` | ✅ 7 Dateien / 39 Tests |
| `npm run test:balance-lab` | ✅ 15 Dateien / 94 Tests |
| `npm run test:assets` | ✅ 4 Dateien / 44 Tests |
| fokussierte Projectile-/Combat-/Multiplayer-/Lifecycle-Tests | ✅ 32 Dateien / 239 Tests |
| `git diff --check` | ✅ |

Der Build meldet unveränderte, erst zur Laufzeit aufzulösende Font-Pfade. Das ist kein
Projectile-Architekturblocker. Keine Browser-/Sichtprüfung durchgeführt; menschliche
Gameplay-/Sichtabnahme bleibt gemäß 03 ein separater Gate.

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

| Korrekturphase | Status | Gegenstand |
|---|:---:|---|
| C1 | ✅ | Hydra-/Split-Entscheidung aus dem Physics-Binding gelöst; Child-Spawns explizit in die `next-stage`-Queue gegeben |
| C2 | ✅ | Phaser-Kontakte als technische Kandidaten melden; Rock/Base/Train/Support/Explosion nicht mehr im Binding fachlich entscheiden |
| C3 | ✅ | Collision-/Interaction-Authority konsolidiert und autoritative `projectileStyle`-Verzweigung entfernt |
| C4 | ✅ | World-/Activity-Consumer auf tatsächlich benötigte schmale Ports umgestellt; Universal-Forwarder abgebaut |
| C5 | ✅ | Runtime-Record-/Provenance-/Identity-Audit, dauerhafte Ratchets und erneute Gesamtverifikation |
| C6 | ✅ | Physics-Authority-Cut; technische Handles/Kontakte getrennt von Projectile-Lifecycle und Wirkung |
| C7 | ✅ | Interner resolved Spec-/Runtime-/Feature-State; kanonische Provenance, ein Physics-Handle/Homing-State und Redirects mit stabiler Identity |
| C8 | ✅ | Dependency-/Ownership-Ratchets, unabhängige Gesamtprüfung und vollständige technische Endabnahme |

---

## 3. Bewusst akzeptierte Ausprägungen

- `ProjectileImpactSource` bleibt ein breiter, schreibgeschützter Reaktions-DTO ohne
  Runtime-Record-/Physics-Zugriff. Eine Aufteilung nur nach Feldzahl verbessert die Authority-Grenze nicht.
- Der reine Payload-Adapter zu `ProjectileSpawnConfig` bleibt für Resolver, Presentation und
  Headless-Lab. Er besitzt weder aktiven State noch einen öffentlichen parallelen Spawn-Einstieg.
- Phaser Arcade Physics, technische synchrone Kontaktmeldungen und die getrennten Host-Interaction-/
  Finalisierungsaufrufe bleiben erhalten; die Runtime entscheidet ihre Semantik. Kein Physics-Rewrite,
  Scheduler oder allgemeines Framework ist erforderlich.
- Bestehende Combat-Regeln und der konkrete Domain-Fan-out bleiben hinter ihren Ports.
  Passive Presentation-Metadaten und begrenzte Bounce-Retention sind zulässige Projektionen,
  keine Legacy-Gameplay-Seams.

Diese Ausprägungen benötigen keine normative Architekturänderung. Das Projectile-Runtime-Refactoring
kann architektonisch endgültig abgeschlossen werden.

## 4. Realisierte Contract-Namen

| Contract-Familie | Realisierter Type/API |
|---|---|
| Spawn | `ProjectileSpawnPort`, `ProjectileSpawnRequest`, `ProjectileId`, `ProjectileSpawnResult` |
| World / interner State | `WorldProjectileRuntime`, `ProjectileHostStageResult`, `ProjectileStore`, `ProjectileIdentityScope`, `ProjectileRuntimeRecord`, `ProjectileResolvedSpec` |
| Physics / Geometry | `ProjectilePhysicsBindingPort`, `ProjectilePhysicsSpawnSpec`, `ProjectilePhysicsMechanics`, `ProjectilePhysicsHandle`, `ProjectileGeometryBindingPort` |
| World-Bindings | `ProjectileTrainBindingPort`, `ProjectileTrainImpactPort`, `ProjectileWorldImpactBindingPort`, `ProjectileLifecycleEventsBindingPort`, `ProjectileTimeFieldBindingPort`, `ProjectileHomingBindingPort`, `ProjectileSwarmReactionPort` |
| External / Reads | `ProjectileExternalInteractionPort`, `TranslocatorProjectilePort`, `ProjectileThreatReadPort`, `ProjectileDiagnosticsReadPort`, `ProjectilePresentationReadPort`, `ProjectileDetonableReadPort` |
| Travel / Environment | `ProjectileTravelReadPort`, `ProjectileTravelSample`, `ProjectileEnvironmentInteractionPort`, `ProjectileBurnAugment`, `ProjectileTimeFieldPort` |
| Collision / Targets | `ProjectileTargetRef`, `projectileTargetKey`, `projectileTargetPhysicalKey`, `ProjectileCollisionTargetQueryPort`, `ProjectileWorldBlockerPort`, `ProjectileTargetabilityPort`, `ProjectileImpactCandidate`, `ProjectilePhysicsContact`, `ProjectileCollisionOutcome` |
| Barrier / Defense | `ProjectileBarrierPort`, `ProjectileBarrierResolution`, `ProjectileDefenseResolution`, `deflectProjectile` |
| Combat / Explosion | `ProjectileCombatPort`, `ProjectileDirectImpactRequest`, `ProjectileDirectImpactOutcome`, `ProjectileExplosionResolutionPort`, `ProjectileExplosionRequest`, `ProjectileGrenadePayloadRequest`, `ProjectileExplosionOutcome` |
| Lifecycle / Stages | `ProjectileLifecycleProcessor`, `ProjectileMiniRocketProcessor`, `ProjectileMiniRocketStatePort`, `PROJECTILE_STAGE_SPAWN_CONTRACT`, `ProjectileImpactSource`, `ProjectileLifecycleOutcome` |
| Replication / Presentation | `ProjectileReplicationAdapter`, `ProjectileReplicationReadPort`, `ProjectileClientReplica`, `ProjectileClientReplicaFrame`, `ProjectilePresentationRuntime`, `ProjectilePresentationRenderers` |

Placeables sind kanonisch `rock` mit `obstacleKind`; Basen/Zug haben eigene World-Targets.
`projectileTargetPhysicalKey` dedupliziert Rock/Construction.

## 5. Knowledge Writeback

`docs/ai/gameplay.md`: verifizierte Ownership-, Identity- und Removal-Verträge. 01–03 unverändert.
