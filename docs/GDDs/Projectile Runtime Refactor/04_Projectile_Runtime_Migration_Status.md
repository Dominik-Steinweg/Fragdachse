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

- **Nächste Phase:** `6 – Collision + Targets + Defense`
- **Gesamtstatus:** Phase 5 abgeschlossen; Travel-/Environment-Augments und Path-Effects laufen über world-owned Capability- und Interaction-Ports, ohne direkte Projectile-Manager- oder Runtime-Record-Zugriffe in den migrierten Upgrade-Systemen
- **Baseline:** verifiziert mit `npm run typecheck`, `npm run check`, `npm run test:integration`, `npm run test:stress` und `npm run test:balance-lab` (alle grün)
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
| 6 | ⬜ | Collision + Targets + Defense |
| 7 | ⬜ | Combat Port + Direct Outcomes |
| 8 | ⬜ | Explosion / Domain Effects / Grenades |
| 9 | ⬜ | Complex Projectile State Machines |
| 10 | ⬜ | Sonderfall-Parität Host Gameplay |
| 11 | ⬜ | Host Replication Adapter |
| 12 | ⬜ | Client Replica |
| 13 | ⬜ | Presentation |
| 14 | ⬜ | Composition + Legacy Removal |
| 15 | ⬜ | Final Cleanup + Gesamtverifikation |

---

## 3. Aktive Transitionen / Blocker

Nur **aktuell offene** Punkte eintragen. Maximal wenige präzise Einträge; erledigte löschen.

Der §5.1-Seam ist der einzige Legacy-Zugriff und zeigt ausschließlich auf denselben kanonischen Store: `ProjectileOwnerSeam` (owner-vermittelter Spawn/Destroy/Release und Host-Frame-Port) und `LegacyProjectileStoreAccess` (Lesen, Deaktivieren, Step-Eintrag entfernen).

- [Transition] `ProjectileManager` verarbeitet Kollision, Wirkung, Snapshot und Presentation weiter auf dem kanonischen Store; Flight/Lifetime/Homing, Phase-4-External-/Read-Ports und Phase-5-Travel-/Environment-Ports sind im `WorldProjectileRuntime` geschlossen, spätere Fachbereiche folgen in den Phasen 6–14.
- [Transition] Legacy-Spawn-Shape `spawnProjectile(x, y, angle, ownerId, cfg)` der noch nicht migrierten Quellen, owner-vermittelt: `CombatSystem`-Deflection/Reflection/Schwarmkinder (6–7), übrige Gegner-Wurfquellen (9–10), interner Hydra-Split (3).
- [Transition] `toLegacyProjectileSpawnConfig` bildet den Spawn-Auftrag auf den Legacy-Record ab; entfällt mit dessen Ablösung (14).

Format bei Bedarf:

```text
- [Transition] alter Pfad → neuer Pfad; erwarteter temporärer Bruch; Schließphase X.
- [Blocker] konkrete ungeklärte Semantik; betroffene Phase; benötigte Review-Entscheidung.
```

---

## 4. Realisierte Contract-Namen

Nur tatsächliche Namen im Code dokumentieren.

| Contract-Familie | Realisierter Type/API |
|---|---|
| Projectile Spawn | `ProjectileSpawnPort`, `ProjectileSpawnRequest`, `ProjectileId`, `ProjectileSpawnResult` (`src/projectile/`) |
| World Projectile Runtime / Host Frame | `WorldProjectileRuntime`, `ProjectileHostStageResult`, `ProjectileTimeFieldPort` (`src/projectile/`) |
| Projectile Store / Runtime Record | `ProjectileStore`; Record bis zur Ablösung weiterhin `TrackedProjectile` |
| External Interaction | `ProjectileExternalInteractionPort`, `ProjectileDetonationSearchRequest`, `ProjectileDetonationTarget`, `ProjectileDetonationOutcome`, `TranslocatorProjectilePort`, `TranslocatorPuckSpawnRequest` (`src/projectile/ProjectileExternalInteractionPort.ts`) |
| Read Ports | `ProjectileThreatReadPort`, `ProjectileThreatSample`, `ProjectileDiagnosticsReadPort`, `ProjectileDiagnosticsSummary`, `ProjectilePresentationReadPort` (`src/projectile/ProjectileReadPorts.ts`) |
| Travel / Environment | `ProjectileTravelReadPort`, `ProjectileTravelSample`, `ProjectileTravelCapabilities`, `ProjectileFireTrailCapability`, `ProjectileAwpCorridorCapability`, `ProjectileEnvironmentInteractionPort`, `ProjectileBurnAugment`, `ProjectileInteractionAugment` (`src/projectile/ProjectileTravelPort.ts`); `ProjectilePathEffectKind` (`src/types.ts`) |
| Target / Geometry / Targetability | `ProjectileHomingRequest`, `ProjectileKinematics`, `ProjectileTargetQueryPort`, `ProjectileTargetabilityPort`, `LineOfFireReadPort`, `HomingRuntimeState` (`src/entities/`, `src/types.ts`) |
| Barrier / Defense | — |
| Projectile Combat | — |
| Domain Effect / Explosion Resolution | — |
| Lifecycle / Outcomes | — |
| Replication | — |
| Client Replica | — |
| Presentation | — |

---

## 5. Architektur-Review-Bedarf

Nur echte offene Abweichungen von `01`/`02`; keine Verbesserungsideen-Sammlung.

- keiner

---

## 6. Nächster Schritt

**Phase 6 starten; bei tatsächlichem Beginn Phase 6 auf 🟨 setzen.**

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
