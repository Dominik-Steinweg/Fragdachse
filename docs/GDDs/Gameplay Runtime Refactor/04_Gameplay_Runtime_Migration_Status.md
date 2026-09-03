# Fragdachse – Gameplay Runtime Refactoring: Migrationsstatus

**Architektur:** `01_Gameplay_Runtime_Architecture_Core.md` + `02_Gameplay_Runtime_Architecture_Details.md`  
**Plan:** `03_Gameplay_Runtime_Implementation_Plan.md`  
**Planungsbasis:** `main` @ `fcc6e3f5ac194fa29b08d23a1c2b3331f8dc3453`

> Temporäres Arbeitsprotokoll für Coding-KIs.
>
> Coding-KIs dürfen diese Datei nach jeder Teilphase fortschreiben.
> `01`, `02` und `03` werden nicht selbständig geändert.
> Keine Coding-KI führt Sichtprüfungen aus oder startet dafür Browser/Dev-Server.
> Manueller Gameplay-/Sicht-Gate erfolgt grundsätzlich erst nach dem vollständigen Cutover.

---

## Statuslegende

- ⬜ offen
- 🟨 aktiv
- 🟧 blockiert
- ✅ abgeschlossen

---

## Aktueller Stand

- **Aktive Teilphase:** `3A – Host-Zeit für Action- und Request-Pfad` (offen; nächster Schritt)
- **Zuletzt abgeschlossen:** `2B – Player-Gameplay Read Views und obere Consumer` ✅
- **Gesamtstatus:** Lifecycle- und Read-View-Grenze der Player-Gameplay-Runtime stehen; Zeit-/Action-/Execution-Cutover noch offen
- **Letzter verifizierter Repository-Stand:** Phase-2A-Commit + Phase-2B-Commit
- **Letzter vollständig grüner automatisierter Gate:** Phase 2B – `npx tsc --noEmit` grün; `npm run build` (tsc + vite) grün; `vitest run tests/` ohne die zwei bekannt flakigen Dateien: **344 Dateien / 2896 Tests grün** (inkl. neuer `PlayerGameplayReadViewBoundary.test.ts` und erweiterter `WorldPlayerGameplayLifecycle.test.ts`).
- **Bekannte Umgebungsflakiness (nicht durch dieses Refactoring verursacht):** Der volle `npm test`-Lauf ist in diesem Checkout nicht deterministisch grün. `tests/ArenaTransitionReadiness.test.ts` (4 Source-Scan-Tests mit `\n{…}`-Literalen) schlägt in einem CRLF-Checkout unabhängig vom Diff fehl; `tests/WorldCombatGameplayBinding.test.ts` (AK47 „random visible target") ist `Math.random`-flaky (0–1 Fehler pro Lauf). Beide scheitern auf unverändertem Stand vor 2A/2B identisch. Der Phase-Gate wird deshalb über `vitest run tests/` mit `--exclude` dieser beiden Dateien plus `npm run build` geführt.
- **Manueller Gate:** offen; bewusst erst nach vollständigem Refactoring
- **Projectile-/Combat-Full-Refactor:** ausdrücklich außerhalb dieses Plans

---

## Phasenstatus

| Teilphase | Status | Commit | Kurzgegenstand |
|---|---:|---|---|
| 1 | ✅ | `2b0db38d` | Baseline, Contracts, Migrationskarte |
| 2A | ✅ | `82322e93` | Player-Gameplay Lifecycle-Grenze |
| 2B | ✅ | Phase-2B-Commit (HEAD dieser Änderung) | Player-Gameplay Read Views |
| 3A | ⬜ | — | Host-Zeit im Action-/Request-Pfad |
| 3B | ⬜ | — | Resource/Readiness mit expliziter Zeit |
| 4A | ⬜ | — | Shared Immediate Weapon Execution |
| 4B | ⬜ | — | Automated-/Non-Player-Fire Cutover |
| 4C | ⬜ | — | Spezialisierte Immediate-Execution-Adapter |
| 5 | ⬜ | — | Construction-/Management-Readiness |
| 6A | ⬜ | — | Player Action Runtime + Weapon Activation |
| 6B | ⬜ | — | RPC/Held/Weapon2-Prediction Cutover |
| 7A | ⬜ | — | Utility Activation + Temporary Utilities |
| 7B | ⬜ | — | Buff-/Armageddon-Ultimate Behavior |
| 7C | ⬜ | — | Airstrike/Tunnel/Gauss Ultimate |
| 8A | ⬜ | — | AK47 Behavior |
| 8B | ⬜ | — | Negev Behavior |
| 8C | ⬜ | — | Shotgun/generische Weapon Reactions |
| 9 | ⬜ | — | Tesla Dome / Energy Shield Behavior |
| 10A | ⬜ | — | LoadoutManager final reduzieren |
| 10B | ⬜ | — | NetworkBridge aus Loadout/Ability-Core |
| 11A | ⬜ | — | PlayerCombatIntegration Reads/Modifier |
| 11B | ⬜ | — | PlayerCombatIntegration Outcomes/Reactions |
| 12A | ⬜ | — | Host Frame Player-Gameplay-Stages |
| 12B | ⬜ | — | Client Frame/HUD/Prediction Reads |
| 12C | ⬜ | — | Activity/Support/Construction Cleanup |
| 13 | ⬜ | — | Final Cleanup, Ratchets, Gesamtverifikation |

---

## Consumer-/Contract-Matrix (in Phase 1 erstellt, laufend fortgeschrieben)

Diese Liste wird während der Umsetzung **ersetzt/gekürzt**, nicht chronologisch erweitert. `L` = Loadout-/`WeaponFireExecutor`-intern (kein externer Cutover-Consumer).

### `WorldPlayerGameplayRuntime` / `.systems` / `WorldPlayerGameplaySystems`

| Consumer | Zugriff | Consumer-Art | Zielphase |
|---|---|---|---|
| `world/WorldPlayerGameplayRuntime.ts` | Owner: baut `systems`, `bindLoadout`, `destroy`-Teardown, `configureResource/Burrow`; **seit 2A einziger Lifecycle-Writer** der Player-Children über `PlayerGameplayLifecyclePort` | Owner/Lifecycle | 2A ✅ |
| `scenes/arena/ArenaWorldPlayerComposition.ts` | `new WorldPlayerGameplayRuntime`, `gameplay.player = …`, `worldRuntime.bind(…)` | Owner-Composition | 2A ✅ |
| `scenes/arena/ArenaLifecycleCoordinator.ts` | Lifecycle in 2A migriert. Reads in 2B migriert (`isBurrowed` → `PlayerGameplayStateReadView`). **Verbleibend:** die Port-Getter `getBurrowSystem/getLoadoutManager/getPlayerModifierSystem/getFlamethrowerUpgradeSystem` und `removeEnemyFromItemRuntime`, die ganze Child-Systeme bzw. eine Enemy-Mutation an die Activity-Composition (`createArenaCoopMissionPorts` / `CoopMissionComposition`) reichen | Lifecycle ✅ / Read ✅ / Activity-Handoff offen | 2A ✅ / 2B ✅ / 4B · 7A · 12C |
| `scenes/arena/ArenaRuntimeAdapters.ts` | Reads in 2B → Read-Views (`isBurrowed`/`isStunned`/`getEquippedUtilityConfig`/`getTemporaryUtilityConfig`/`hasActiveTranslocatorPuck`/`getAdrenaline`/`getAdrenalineRevision`/`getMaxAdrenaline`/`addAdrenaline*Observer`/`getAk47StrategicTargetNetSnapshot`). **Verbleibend (Mutationen):** `loadout.use`, `heldAction.start/cancel/consume/clearPlayer`, `burrow.handleBurrowRequest`, `resource.setAdrenaline` (Balance-Lab) | Read ✅ / Mutation offen | 2B ✅ / 3B · 6A · 6B |
| `scenes/arena/HostUpdateCoordinator.ts` | `playerSystems` = `getPlayerGameplayRuntime()?.systems`; taktet `resource.regenTick`, `burrow.update`, `loadout.update`, `tunnel.update`, `weaponUpgrade`, `ak47StrategicTarget`, `guardianSpirit`, `repairDrone`, `slimeTrail`, `flamethrowerUpgrade`, `itemRuntime`; liest ~30 Loadout-/Resource-Getter für HUD/Net-Snapshot | Host-Frame + Read | 12A |
| `scenes/arena/ClientUpdateCoordinator.ts` | `playerSystems`; `loadout.getEquipped*`, `getUltimateThresholds`, `isAk47FireSuperiorityAvailable`, `resource.getAdrenaline`, `burrow.isBurrowed` | Client-Frame Read | 12B |
| `scenes/arena/ArenaWorldCombatComposition.ts` | `playerRuntime?.systems.{itemRuntime,flamethrowerUpgrade}` | Combat-Composition (composition-inner, Ratchet-erlaubt) | 11 |
| `scenes/arena/ArenaWorldConstructionComposition.ts` | `gameplay.player?.systems.{loadout,playerModifier,tunnel,burrow,resource}`, `loadout.addTemporaryUtility` | Construction-Composition (composition-inner) | 5 / 7A |
| `scenes/arena/ArenaWorldEnvironmentComposition.ts` | `gameplay.player?.systems.{burrow,translocator,loadout}` | Support-Composition (composition-inner) | 12C |
| `scenes/arena/ArenaRuntime.ts` | 2B: `getTranslocatorActivePuckId`/`getTunnelNetSnapshot` → Read-Views. **Verbleibend:** `itemRuntime.getRemoteControlSnapshot` (Cross-Runtime-Join mit `turret`) | Read ✅ / Snapshot-Join offen | 2B ✅ / 12B |
| `scenes/arena/RockVisualHelper.ts` | 2B: `getClassId` → `getPlayerClassId`-Read-View; `playerSystems`-Getter entfernt | Read ✅ | 2B ✅ |
| `scenes/arena/ArenaPersistentBaseSession.ts` | `playerSystems.loadout.isManagementActionOnCooldown` (Read) + `.markManagementActionUsed` (Mutation) – bewusst **nicht** in 2B, weil Phase 5 die Management-Readiness komplett aus dem Loadout löst | — | 5 |
| `world/WorldCombatGameplayBinding.ts` | konsumiert `WorldPlayerGameplaySystems`-Typ + `getPlayerSystems()?.{loadout,playerModifier,burrow}` | Combat integration | 11A / 11B |

### `LoadoutManager` (direkte Typ-Consumer, nach Consumer-Art)

| Consumer-Art | Consumer (Datei → API) |
|---|---|
| Owner/Lifecycle | `WorldPlayerGameplayRuntime` (`createLoadoutManager`, `bindLoadout`, `destroy` löst alle Setter), `ArenaWorldPlayerComposition` (reicht `createLoadoutManager`), `ArenaLifecycleCoordinator` (`assignDefaultLoadout`, `syncSelectedLoadout`, `resetUltimateState`, `removePlayer`, `resetAllUltimateStates`) |
| Action | `ArenaRuntimeAdapters` (`loadout.use`) → `RpcCoordinator.registerLoadoutUseHandler` via `PlayerLoadoutRpcPort.useLoadout`; RPC reicht `clientNow ?? Date.now()`, `clientX`, `clientY` durch, augmentiert Weapon2-Antwort um `worldRevision`/`authoritativeAdrenaline`/`adrenalineRevision` |
| Read/Presentation | `HostUpdateCoordinator`, `ClientUpdateCoordinator` (`getEquipped{Weapon,Utility,Ultimate}Config`, `getAk47HudBuffs`, `getNegevHudBuffs`, `getShieldBuffHudState`, `getCooldownFrac`, `getAimNetState`, `getHeldItemSlot`, `getUltimate*`, `isUltimate*`), `ArenaRuntimeAdapters` (`getEquippedUtilityConfig`, `getTemporaryUtilityConfig`) |
| Combat integration | `CombatSystem` (`setLoadoutManager` → `getWeaponDamageMultiplier`, `getDamageMultiplier`, `registerAk47ProjectileHit`), `WorldCombatGameplayBinding` (`handleKill`, `getEquippedWeaponConfig`, `getDamageMultiplier`, `getSpeedMultiplier`, `beginUtilityCooldown`, `resolveAk47Projectile` via `projectileManager.setProjectileResolvedCallback`, `fireAutomatedWeapon` Turret-Pfad), `HostPhysicsSystem` (`setLoadoutManager`), `Ak47StrategicTargetSystem` (`getEquippedWeaponConfig`), `FlamethrowerUpgradeSystem` (`resolveUtilityConfig`, `getEquippedWeaponConfig`), `TranslocatorSystem` (Typ) |
| Construction / Persistent Base | `ConstructionWorldRuntime` (`isConstructionOnCooldown`, `markConstructionUsed`, `useInspectorUtility`, `isManagementActionOnCooldown`, `markManagementActionUsed`, `getManagementActionCooldownUntil` via `RadialActionModel`, `setPlaceableRockHandler`, `setTunnelPlacementHandler`), `ArenaWorldConstructionComposition` (`addTemporaryUtility`) |
| automated actor / Activity (Shared Fire Service) | `CoopDefenseEnemyAttackSystem` (`fireAutomatedWeapon`), `NecromancySystem` (`fireAutomatedWeapon`), `CoopDefenseVoidHunterSystem` (`fireAutomatedGaussWeapon`), `CoopMissionComposition` / `CoopMissionEnemyBehaviourComposition` / `CoopMissionEnemySupportComposition` (reichen `LoadoutManager` in Enemy-/Support-Systeme), `CoopMissionObjectiveComposition` (`addTemporaryUtility`, `releaseTemporaryUtilityForObjective`) |
| Support-/Ultimate-Handler-Wiring | `WorldSupportGameplayRuntime` (`setArmageddonSystem`, `setAirstrikeHandler`, `setStinkCloudSystem`) |
| network adapter (Legacy) | `LoadoutManager.ts` selbst: `this.bridge` → `getGameMode`, `publishUtilityCooldownUntil`, `publishTemporaryUtilityInstances`, `publishHeldUtilityId`, `isEnemyPair`, `broadcastExplosionEffect`, `broadcastShotFx`. Eingefrorener Consumer in `WorldGameplayCompositionContracts.test.ts` |
| Typ-/Sibling-only | `types.ts`, `loadout/BaseUltimate.ts`, `loadout/LoadoutRules.ts`, `loadout/ShotPlanResolver.ts`, `loadout/WeaponFireExecutor.ts` |

### `LoadoutManager.use` – einziger Produktiv-Call-Site

`ArenaRuntimeAdapters` → `PlayerLoadoutRpcPort.useLoadout` → `RpcCoordinator.registerLoadoutUseHandler`. Vorgelagerte hostautoritative Entscheidungen im RPC: Capabilities, Countdown, Dismantle/GlobalDismantle-Sonderpfade, Inspector-Class-Gate, `validateHostUtilityCharge` (`heldActions.consume`), Translocator-Recall (`heldActions.clearPlayer`). Zeit: `clientNow ?? Date.now()` fließt als `now` in den Core.

### `fireAutomatedWeapon` / `fireAutomatedGaussWeapon`

`fireAutomatedWeapon`: `WorldCombatGameplayBinding` (Turret), `CoopDefenseEnemyAttackSystem`, `NecromancySystem`. `fireAutomatedGaussWeapon`: `CoopDefenseVoidHunterSystem`.

### Construction-/Management-Cooldown-Methoden

Produktiv nur `ConstructionWorldRuntime`. Lifetime heute: `Map` im `LoadoutManager`, an `assignDefaultLoadout`/`removePlayer` gebunden (Player-in-World-Lifetime). Zielphase 5.

### Temporary-Utility-Methoden

`addTemporaryUtility`: `ArenaWorldConstructionComposition`, `CoopMissionObjectiveComposition`. `getTemporaryUtilityConfig`: `ArenaRuntimeAdapters`, `HostUpdateCoordinator`. `releaseTemporaryUtilityForObjective`: `CoopMissionObjectiveComposition`. State-Owner: `TemporaryUtilityCollection`. Zielphase 7A.

### AK47 / Negev / Shotgun

- AK47: `CombatSystem.registerAk47ProjectileHit`; `WorldCombatGameplayBinding` → `resolveAk47Projectile`; `WorldPlayerGameplayRuntime.setAk47StrategicTargetHitResolver`; HUD-Reads (`getAk47HudBuffs`, `isAk47FireSuperiority*`, `isAk47FocusAtMaxStacks`) im Host-/ClientUpdateCoordinator; `resetAk47State` in `assignDefaultLoadout`. State: `ak47States`-Map. Zielphase 8A.
- Negev: `WorldCombatGameplayBinding.handleKill` → `negevStates`; `update()` → `finishNegevKillstreak` (Streak-Gap `NEGEV_STREAK_GAP_MS`, `Date.now()`); `setNegevKillstreakExplosionHandler` (`WorldPlayerGameplayRuntime`); HUD `getNegevHudBuffs`. Zielphase 8B.
- Shotgun: `WorldCombatGameplayBinding.handleKill` → `shotgunLightningQueue`; `processShotgunLightningQueue` in `update()` → `combatSystem.applyAoeDamage` + `bridge.broadcastExplosionEffect`; Chain-Generation. Zielphase 8C.

### Tesla-Dome / Energy-Shield / ShieldBuff Hooks

`WorldCombatGameplayBinding`: `setTeslaDomeSystem`, `setEnergyShieldSystem`, `setShieldBuffSystem`. Nutzung im Core: `activateTeslaDomeWeapon`/`activateEnergyShieldWeapon` aus `fireWeapon`; `deactivateNonAutonomousWeaponEffect` beim Slot-Claim (`claimWeaponSlot`); `hostDeactivateForPlayer` in `assignDefaultLoadout`/`removePlayer`/`destroy`; Speed-Multiplier-Zweige für `energy_shield`/`tesla_dome`. Zielphase 9.

### Versteckte `Date.now()` im Player-Gameplay-Pfad (Ziel 3A/3B)

- `ResourceSystem.drainAdrenaline` (Regen-Pause setzen), `ResourceSystem.regenTick` (Pause prüfen) – **3B**.
- `LoadoutManager.update()` – `const now = Date.now()` für Spread-Decay, Negev-Streak-Gap, Ultimate-Drain/Ticks, Shotgun-Queue.
- `LoadoutManager` Default-Parameter `now = Date.now()`: `getHeldItemSlot`, `registerAk47ProjectileHit`, `resolveAk47Projectile`, `getAk47HudBuffs`, `getWeaponDamageMultiplier`, `getShieldBuffHudState`.
- `LoadoutManager.getSpeedMultiplier` / `getHeldSelfPushVelocity` / `getAllyAuraMultiplier` – `Date.now()` für Hold-Expire / Aura-Linger.
- `fireWeapon` NEGEV-Zweig: `negevState.lastShotAt = Date.now()` (bewusst Host-Wanduhr, muss zu `update()` passen).
- `bindLoadout` Negev-Killstreak-Handler: `Date.now()` im `sourceId`-String.
- `RpcCoordinator`: `Date.now()`-Fallback für `clientNow`; `Date.now()` in `heldActions.start/consume` und `validateHostUtilityCharge` – **3A**.

### `clientX` / `clientY` im Loadout-Use-Pfad

`RpcCoordinator.registerLoadoutUseHandler` liest `clientX`/`clientY`/`clientNow` aus dem Wire und reicht sie an `loadout.use(…, clientX, clientY)` durch. In `use()`: `x = clientX ?? player.x; y = clientY ?? player.y` – Ursprung für Weapon-Fire, Utility, Ultimate. Positions- und Zeit-Authority sind zwei getrennte Entscheidungen (3A ≠ 6A). **Testseitig fixiert** durch `GameplayRuntimeCutoverCharacterization.test.ts` (`use – Client-Position im Waffen-Pfad`).

### Source-Ratchets (String-Scan-Tests, die aktuelle Quellcodepositionen pinnen)

Diese Tests schützen heute alte Positionen und müssen von den jeweiligen Cutover-Phasen semantisch mitmigriert werden:

| Test | Pinnt | Migriert in |
|---|---|---|
| `Phase11DependencyCutover.test.ts` | **2A: Held-Action-Assertions auf `invalidateHeldActionsForPlayer` / `invalidateHeldActionsOnActivityEnd` umgestellt** (+ `flow` enthält kein `worldPlayerGameplayRuntime?.systems.heldAction` mehr). Verbleibend: `RpcCoordinator`-Portnamen, Frame-Read-Ports → 6B | 2A ✅ / 6B |
| `WorldGameplayCompositionContracts.test.ts` | eingefrorene `NetworkBridge`-Consumer-Liste inkl. `src/loadout/LoadoutManager.ts`; neue World-Owner frei von `NetworkBridge`/`ArenaContext`; `new WorldPlayerGameplayRuntime` nur in Composition | 2A / 10B |
| `ArenaFlowCheckpointC.test.ts` | Scene-facing Runtime-Oberfläche frei von `LoadoutManager` u. a.; `getWorldPlayerGameplayRuntime`-Gate des Balance-Lab (2B: `isReady` prüft nur noch Nicht-`null`); kein `new WorldPlayerGameplayRuntime` im Flow | 2A / 2B ✅ |
| `PlayerWorldRuntimeContracts.test.ts` | **2A: „genau ein Detach-Pfad"-Scan auf `detachPlayerLoadout(` / `detachPlayerBurrow(` umgestellt** (vorher `systems.loadout.removePlayer` / `systems.burrow.removePlayer`) | 2A ✅ |
| **`PlayerGameplayReadViewBoundary.test.ts`** | **neu (2B): friert die 9 verbleibenden externen `WorldPlayerGameplayRuntime.systems`-Consumer ein; prüft die migrierten Read-Call-Sites** – Ratchet gegen neue `.systems`-Leaks | schrumpft in 3B · 5 · 6A · 6B · 11 · 12A · 12B · 12C |
| `DachsOfSteelRockArmorDrop.test.ts` | **2B: Mock `getPlayerGameplayRuntime()` gibt jetzt `getPlayerClassId` statt `{ systems: { playerModifier } }`** | 2B ✅ |
| `WorldCombatGameplayBinding.test.ts`, `WorldMaterializationOwnership.test.ts`, `CoopMissionRuntimeOwnership.test.ts`, `ActivityRebindingContracts.test.ts` | World-/Combat-/Activity-Ownership-Scans mit `WorldPlayerGameplayRuntime`-Bezug | 11 / 12C |

---

## Test-Migrationskarte

Stand nach Phase 2B. `abgedeckt` = Ist-Semantik ausreichend charakterisiert; `Zielstatus` = was die genannte Phase mit dem Test tun muss.

| Semantik | Test(s) | Ist | Zielstatus |
|---|---|---|---|
| Held Action duplicate-safe / stale / Identity | `HostHeldActionSystem.test.ts` | abgedeckt | prüfen bei 3A / 6B |
| Weapon2 Prediction Retry/Dedupe + authoritative Adrenalin/Revision | `Weapon2PredictionDedupe.test.ts`, `ClientWeaponAdrenalinePrediction.test.ts` | abgedeckt | prüfen bei 6B |
| Temporary Utility Identity / Charges / Cooldown / Acquisition Order | `TemporaryUtilityLifecycle.test.ts` | abgedeckt | prüfen bei 7A |
| Radial/Held RPC | `RadialActionRpc.test.ts`, `RadialActionInput.test.ts` | abgedeckt | migrieren bei 6B / 7A |
| Shared automated fire + Source-/Owner-Metadaten | `AutomatedPelletWeapon.test.ts`, `InspectorSupportWeapons.test.ts`, `ReinforcementMatrixProjectile.test.ts` + Consumer-Tests (`CoopDefenseVoidHunterSystem`, `CoopDefenseInfernoColossusCombat`, `GraveTitanVoidPlasma`, `CoopDefenseStuckEnemyBite`) | abgedeckt | migrieren bei 4A / 4B |
| Shared Immediate Execution (Projectile/Hitscan/Melee) | `WeaponFireExecutor.test.ts` | abgedeckt | erweitern bei 4A |
| Weapon-Slot-Exklusivität / Channel-Switch-Deaktivierung | `WeaponSlotExclusivity.test.ts` | abgedeckt | prüfen bei 6A / 9 |
| Dynamischer Spread / aktiver Slot / Shot Identity | `AimSpreadModelActiveSlot.test.ts`, `ShotPlanResolverRuntimeRegression.test.ts`, `ProjectileSpawnResolver.test.ts` | abgedeckt | prüfen bei 6A |
| Resource Revision / Adrenalin-Observer / Cost-Modifier | `ResourceSystemObservers.test.ts` | abgedeckt | prüfen bei 3B |
| **`clientX`/`clientY` als Use-Ursprung** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)** | Zielprüfung 6A |
| **Waffen-Commit-Reihenfolge: Reject → keine Resource-/Cooldown-Mutation; Drain erst nach Dispatch** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)** | Zielprüfung 3B / 6A |
| **Negev-Killstreak-Runtime: Kill-Zahl, Streak-Gap-Ende in `update()`, Abschlussexplosion** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)** | migrieren bei 8B |
| **Shotgun-Lightning: Kill → Queue → `applyAoeDamage` + Broadcast** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)** | migrieren bei 8C |
| **Construction-/Management-Cooldown-Keying (pro Spieler/ID bzw. pro Aktion)** | `GameplayRuntimeCutoverCharacterization.test.ts`, `PersistentBaseRepositioning.test.ts` | **neu + abgedeckt** | migrieren bei 5 |
| AK47 hit/refund identity (at-most-once, pending-resolve) + Stacks | `Ak47CoopDefenseUpgrades.test.ts` | abgedeckt | migrieren bei 8A |
| Gauss-Ultimate press/release Commit (nur bei Vollladung, at-most-once) | `RoomStatisticsGameplayHooks.test.ts` | abgedeckt | migrieren bei 7C |
| Ultimate buff/airstrike/tunnel Accept-Reject + Rage-Kosten-Zeitpunkt | – | **Lücke** (nur Gauss) | in 7B/7C konkretisieren, dort Test ergänzen |
| Tesla Dome / Energy Shield start/refresh/stop-Orchestrierung | `TeslaDomeSystem.test.ts`, `TeslaDomeCoopDefenseUpgrades.test.ts`, `WeaponSlotExclusivity.test.ts` | teilabgedeckt (System-Ebene) | Orchestrierung in 9 konkretisieren |
| World Player ownership boundary | `WorldGameplayCompositionContracts.test.ts` | Ratchet | migrieren bei 10B |
| Combat integration boundary | `WorldCombatGameplayBinding.test.ts` | Ratchet (AK47-Ziel `Math.random`-flaky) | migrieren bei 11A / 11B |
| Arena source boundaries | `Phase11DependencyCutover.test.ts` (2A: Held-Action ✅), `ArenaFlowCheckpointC.test.ts` | Ratchet | migrieren bei 6B |
| **Player-in-World-Lifecycle- und Read-View-Grenze der Runtime** | `WorldPlayerGameplayLifecycle.test.ts` (attach/detach/reconcile/held-invalidation + Read-Views), `PlayerGameplayReadViewBoundary.test.ts` (`.systems`-Ratchet) | **neu (Phase 2A/2B)** | prüfen bei 3B / 12A / 12B |

---

## Bewusste Übergänge / bekannte Regressionen

Aktuell keine Implementierungsübergänge. 2A/2B sind reine Boundary-Moves ohne Semantikänderung:

- **2A** kapselt die Player-Child-Lifecycle-Schritte (`resource`/`burrow`/`itemRuntime`/`loadout`/`tunnel`/`heldAction`/`playerModifier`) hinter `WorldPlayerGameplayRuntime`-Methoden. Zwei verhaltensneutrale Reorderings: im `detachLoadout`-Pfad läuft `worldPowerUpRuntime.system.removePlayer` jetzt nach `detachPlayerLoadout` (loadout+tunnel); in `syncHostLoadoutsFromCommittedSelections` läuft `resource.reconcilePlayerLimits` jetzt vor `combatSystem.reconcilePlayerRuntimeState`. Beide betreffen unabhängige Map-Löschungen bzw. getrennte Domains.
- **2B** routet die reinen Read-Zugriffe von `ArenaRuntimeAdapters`, `ArenaRuntime`, `RockVisualHelper` und `ArenaLifecycleCoordinator` über die `PlayerGameplayReadViews` derselben Runtime. Genuine Mutationen (`loadout.use`, `heldAction.*`, `burrow.handleBurrowRequest`, `resource.setAdrenaline`) sowie die Activity-System-Handoffs und Frame-Reads bleiben bewusst als `.systems.*` und sind im neuen Ratchet `PlayerGameplayReadViewBoundary.test.ts` eingefroren.

Regel für Updates:

- nur aktive, noch relevante Transitionen hier aufführen,
- exakten alten und neuen Writer nennen,
- wenn ausnahmsweise ein Integrationstest bewusst rot ist: Testname + Grund + alter/neuer Writer + unmittelbar folgende Teilphase, die ihn schließen muss; Build/TypeScript und die verpflichtenden Phase-Gates bleiben grün,
- abgeschlossene Transitionen löschen.

---

## Architektur-/Dokumentations-Review-Kandidaten

Aktuell:

- `docs/ai/networking.md` wird nach Phase 10B voraussichtlich die konkrete Legacy-Consumer-Liste anpassen müssen.
- `docs/ai/gameplay.md` nach finalem Player-Action-/Loadout-Cutover gegen die neue öffentliche Boundary prüfen.
- Phasen 1–2B haben keinen `docs/ai/*`-Writeback ausgelöst: Consumer-Kartierung und Boundary-Moves sind Implementierungs-Ist, keine langlebige systemübergreifende Invariante. `docs/ai/gameplay.md` erst nach dem vollständigen Player-Action-Cutover gegen die dann stabile öffentliche Boundary prüfen.
- Normative `01`/`02` nur nach menschlicher Entscheidung ändern.

---

## Realisierte Contract-Namen

Diese Tabelle dokumentiert **nur die im Code tatsächlich eingeführten Namen** der im Plan vorgegebenen Contract-Familien. Sie definiert keine neue Architektur. Die einführende Teilphase trägt den finalen Namen ein; spätere Coding-KIs verwenden ihn weiter.

| Contract-Familie aus 03 | Realisierter Type/API | Eingeführt in |
|---|---|---|
| `PlayerGameplayLifecyclePort` | `interface PlayerGameplayLifecyclePort` in `src/world/WorldPlayerGameplayRuntime.ts`, implementiert von `WorldPlayerGameplayRuntime`. Methoden: `attachPlayerResources` / `detachPlayerResources` / `attachPlayerBurrow` / `detachPlayerBurrow` / `attachPlayerBuild` / `detachPlayerBuild` / `attachPlayerLoadout(playerId, selection?)` / `detachPlayerLoadout` / `reconcilePlayerLoadout(playerId, selection?)` / `reconcilePlayerBuildModifiers(builds, hasPlayer)` / `invalidateHeldActionsForPlayer` / `invalidateHeldActionsOnActivityEnd`. World-Teardown bleibt `WorldScopedBinding.destroy()`. | 2A |
| `PlayerGameplayReadViews` | Vier kleine Interfaces in `src/world/WorldPlayerGameplayRuntime.ts`, alle von `WorldPlayerGameplayRuntime` implementiert, plus `type PlayerGameplayReadViews` als deren Schnittmenge. `PlayerGameplayStateReadView` (`isBurrowed`/`isStunned`/`getPlayerClassId`); `PlayerGameplayLoadoutReadView` (`getEquippedUtilityConfig`/`getTemporaryUtilityConfig`/`hasActiveTranslocatorPuck`); `PlayerGameplayResourceReadView` (`getAdrenaline`/`getAdrenalineRevision`/`getMaxAdrenaline`/`addAdrenalineDrainObserver`/`addAdrenalineGainObserver`); `PlayerGameplaySnapshotReadView` (`getTranslocatorActivePuckId`/`getTunnelNetSnapshot`/`getAk47StrategicTargetNetSnapshot`). | 2B |
| `PlayerActionRequest` | — | — |
| `WeaponExecutionCapability` | — | — |
| `PlayerRelationshipPort` | — | — |
| `PlayerCombatIntegrationPort` | — | — |
| `PlayerGameplayFrameStages` | — | — |

---

## Nächster konkreter Schritt

**Teilphase 3A umsetzen – Host-Zeit für Action- und Request-Pfad.**

Dabei:

1. Am Action-/RPC-Adapter (`RpcCoordinator.registerLoadoutUseHandler`, `registerHeldActionHandler`) einen expliziten hostseitigen `nowMs` bestimmen; `RpcCoordinator` darf `clientNow` nicht mehr als autoritative Cooldown-/Commit-Zeit an den Gameplay-Core (`loadout.use(…, now, …)`) weiterreichen. Heute: `clientNow ?? Date.now()` in [RpcCoordinator.ts:403](../../src/scenes/arena/RpcCoordinator.ts).
2. `clientNow`/`clientX`/`clientY` nur erhalten, wo Prediction/Diagnose/Latenzbezug sie wirklich braucht; Request-/Attempt-Datentypen so benennen, dass Host-Zeit nicht mit Client-Zeit verwechselt wird. `clientX`/`clientY`-Positions-Semantik bleibt in 3A **unverändert** (Test `GameplayRuntimeCutoverCharacterization`).
3. Held Actions weiter über `HostHeldActionSystem` + Host-Zeit führen (bereits so; `RpcCoordinator` übergibt `Date.now()` an `heldActions.start/consume`).
4. Clock-Skew-Test ergänzen: extrem alte/neue Client-Zeit darf Host-Cooldown/Commit nicht manipulieren.
5. Referenz-§§: `02` §§ 8.1, 10.1, 23, 27–29.
6. Keine globale Clock, kein Networking-Redesign.

Hinweis für den Gate: `vitest run tests/` mit `--exclude tests/ArenaTransitionReadiness.test.ts --exclude tests/WorldCombatGameplayBinding.test.ts` (bekannte Umgebungsflakiness) plus `npm run build`.

---

## Update-Format nach jeder Teilphase

Die Coding-KI aktualisiert ausschließlich die folgenden Punkte:

- aktive Teilphase
- Phasenstatus
- letzter Repository-Stand
- letzter vollständig grüner automatisierter Gate
- Commit-Hash der abgeschlossenen Teilphase
- realisierte Contract-Namen, falls die Phase eine Contract-Familie erstmals materialisiert
- noch offene Transitionen/Regressionen
- Test-Migrationskarte, falls betroffen
- Dokumentations-Review-Kandidaten
- nächster konkreter Schritt

Keine Historie und keine ausführliche Zusammenfassung bereits abgeschlossener Arbeit pflegen.
