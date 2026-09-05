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

- **Nächste Phase:** Korrekturschleife abgeschlossen (C5)
- **Gesamtstatus:** Korrekturphasen C1–C5 technisch abgeschlossen; Phasen 1–15 bleiben abgeschlossen
- **Baseline:** Phase-15-Gates und die Korrektur-Gates C1–C5 sind grün; die Runtime-Record-/Provenance-/Identity-Verträge sind ratifiziert
- **Typecheck-Regel:** jede erfolgreich abgeschlossene Phase muss `npm run typecheck` grün halten
- **Final-Gate:** vollständig grün
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

---

## 3. Aktive Transitionen / Blocker

Nur **aktuell offene** Punkte eintragen. Maximal wenige präzise Einträge; erledigte löschen.

- keiner.

---

## 4. Realisierte Contract-Namen

Nur tatsächliche Namen im Code dokumentieren.

| Contract-Familie | Realisierter Type/API |
|---|---|
| Spawn | `ProjectileSpawnPort`, `ProjectileSpawnRequest`, `ProjectileId`, `ProjectileSpawnResult` |
| World / Host / Store | `WorldProjectileRuntime`, `ProjectileHostStageResult`, `ProjectileTimeFieldPort`, `ProjectileStore`, `ProjectileIdentityScope`, internes `ProjectileRuntimeRecord` mit `provenance` |
| Physics Binding | `ProjectilePhysicsBindingPort`, `ProjectileRuntimeOwnerPort`, `ProjectilePhysicsBinding`, `ProjectilePresentationPort` |
| World Boundary | `ProjectileGeometryBindingPort`, `ProjectileTrainBindingPort`, `ProjectileWorldImpactBindingPort`, `ProjectileLifecycleEventsBindingPort`, `ProjectileTimeFieldBindingPort`, `ProjectileHomingBindingPort`, `ProjectileSwarmReactionPort` |
| External / Reads | `ProjectileExternalInteractionPort`, `TranslocatorProjectilePort`, `ProjectileThreatReadPort`, `ProjectileDiagnosticsReadPort`, `ProjectilePresentationReadPort` |
| Travel / Environment | `ProjectileTravelReadPort`, `ProjectileTravelSample`, `ProjectileTravelCapabilities`, `ProjectileEnvironmentInteractionPort`, `ProjectileBurnAugment`, `ProjectileInteractionAugment`, `ProjectilePathEffectKind` |
| Target / Geometry | `ProjectileTargetRef`, `projectileTargetKey`, `projectileTargetPhysicalKey`, `ProjectileCollisionTargetQueryPort`, `ProjectileWorldBlockerPort`, `ProjectileTargetabilityPort`, `ProjectileImpactCandidate`, `ProjectilePhysicsContact`, `ProjectilePhysicsContactTarget`, `ProjectileCollisionMode` |
| Collision Resolution | `ProjectileCollisionOutcome`; World-Kandidaten und technische Kontakte werden pro Host-Zeitpunkt über die Runtime dedupliziert |
| Barrier / Defense | `ProjectileBarrierPort`, `ProjectileBarrierRequest`, `ProjectileBarrierResolution`, `ProjectileDefenseResolution`; `deflectProjectile` für Projectile↔Projectile-Transform |
| Combat / Domain Effects | `ProjectileCombatPort`, `ProjectileDirectImpactRequest`, `ProjectileDirectImpactOutcome`, `ProjectileExplosionResolutionPort`, `ProjectileExplosionRequest`, `ProjectileGrenadePayloadRequest`, `ProjectileExplosionOutcome` |
| Complex State / Lifecycle | `ProjectileMiniRocketProcessor`, `ProjectileMiniRocketStatePort`, `ProjectileStageSpawnPolicy`, `PROJECTILE_STAGE_SPAWN_CONTRACT`; WorldRuntime führt die explizite Next-Stage-Queue; `ProjectileImpactSource`, `ProjectileLifecycleOutcome` |
| Detonable / Replication | `ProjectileDetonableReadPort`, `ProjectileDetonableSample`, `ProjectileReplicationAdapter`, `ProjectileReplicationRecord`, `ProjectileReplicationReadPort` |
| Client / Presentation | `ProjectileClientReplica`, `ProjectileClientReplicaState`, `ProjectileClientReplicaFrame`, `ProjectileClientExtrapolatedState`, `ProjectilePresentationRuntime`, `ProjectilePresentationRenderers` |

Phase-6-Normalisierung: Combat liefert `player`/`enemy`/`decoy`; Placeables laufen als `rock` mit `obstacleKind`, Basen/Zug als eigene World-Targets. `projectileTargetPhysicalKey` dedupliziert Rock/Construction.

---

## 5. Architektur-Review-Bedarf

Nur echte offene Abweichungen von `01`/`02`; keine Verbesserungsideen-Sammlung.

- keiner; die genannten Punkte sind planbare Forward-Fixes und kein Architekturblocker.

---

## 6. Nächster Schritt

**Korrekturschleife abgeschlossen; keine weitere Phase offen.**

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
