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

- **Nächste Phase:** `2B – WorldProjectileRuntime, Store, Identity und autoritativer Spawn-Cutover`
- **Gesamtstatus:** Phase 2A abgeschlossen; die Execution-Seite spricht den semantischen Spawn-Contract, der autoritative Store folgt in 2B
- **Baseline:** verifiziert mit `npm run typecheck`, `npm test`, `npm run build`, `npm run test:architecture`, `npm run test:integration`, `npm run test:stress` und `npm run test:balance-lab` (alle grün)
- **Typecheck-Regel:** jede erfolgreich abgeschlossene Phase muss `npm run typecheck` grün halten
- **Final-Gate:** ausstehend
- **Manuelle Prüfung:** nicht durch Coding-KI; standardmäßig erst nach technischem Abschluss

---

## 2. Phasenstatus

| Phase | Status | Kurzgegenstand |
|---|:---:|---|
| 1 | ✅ | Baseline + Characterization |
| 2A | ✅ | Spawn Contract + Provenance |
| 2B | ⬜ | World Runtime + Store + Spawn Authority |
| 3 | ⬜ | Flight + Lifetime + Homing |
| 4 | ⬜ | External Interaction + Read Ports |
| 5 | ⬜ | Travel / Environment / Augments |
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

- [Transition] `LegacyProjectileSpawnAdapter`: `ProjectileSpawnRequest` → bestehende `ProjectileManager.spawnProjectile`-Senke; nur one-way, ohne State/Identity; Schließphase 2B.
- [Transition] noch nicht migrierte Spawn-Aufrufer der Legacy-Senke: `TranslocatorSystem` und der Puck von `CoopDefenseEnemyAbilitySystem` (Schließphase 4), `CombatSystem`-Deflection/Reflection/Schwarmkinder (Schließphase 6–7), übrige Gegner-Wurfquellen als Host-Sonderfall (Schließphase 9–10), interner Hydra-Split im `ProjectileManager` (Schließphase 2B/3).

Ab Phase 2B darf zusätzlich ausschließlich der in `03 §5.1` definierte Single-State Legacy Access Seam mit konkret benannten Schließphasen hier stehen.

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
| World Projectile Runtime / Host Frame | — |
| Projectile Store / Runtime Record | — |
| External Interaction | — |
| Read Ports | — |
| Target / Geometry / Targetability | — |
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

**Phase 2B starten; bei tatsächlichem Beginn Phase 2B auf 🟨 setzen.**

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
