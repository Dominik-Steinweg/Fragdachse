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

- **Aktive Teilphase:** `4C – Spezialisierte Immediate-Execution-Adapter` (offen; nächster Schritt)
- **Zuletzt abgeschlossen:** `4B – Automatisierte und nicht-playergebundene Waffenquellen migrieren` ✅
- **Gesamtstatus:** Lifecycle-, Read-View-, Action-Zeit-, Resource-/Readiness-Zeit-Grenzen und die world-composed Immediate-Weapon-Execution-Capability stehen. Gegner, Türme, Necromancy und Void-Hunter-Gauss feuern über die benannte automatische Ausführungsgrenze; Timing, Readiness und Autorität bleiben bei ihren jeweiligen Ownern.
- **Letzter verifizierter Repository-Stand:** Correction-Pass auf Phase-4B-Stand `d104a9f9`
- **Letzter vollständig grüner automatisierter Gate:** Phase 4B – `npx tsc --noEmit` grün; `npm run build` (tsc + vite) grün; der Lauf von `npm run check` meldete **347 Dateien / 2942 Tests grün**, nur die 4 bekannten CRLF-Source-Scan-Fehler in `ArenaTransitionReadiness.test.ts` verbleiben. Isolierte 4B-Läufe für automatische Waffen, Gegnerangriffe, Void Hunter, Spezialgeschosse, Inspector-Waffen, Activity-Rebinding und World-Turm-Binding grün.
- **Bekannte Umgebungsflakiness (nicht durch dieses Refactoring verursacht):** `tests/ArenaTransitionReadiness.test.ts` (4 Source-Scan-Tests mit `\n{…}`-Literalen) schlägt in einem CRLF-Checkout unabhängig vom Diff fehl; `tests/WorldCombatGameplayBinding.test.ts` AK47-„random visible target" ist `Math.random`-flaky (~1/5 Läufe). Beide scheitern auf unverändertem Stand vor 2A identisch. Der Phase-Gate wird über `npm test` + `npm run build` geführt; die genannten Flaker separat isoliert geprüft.
- **Manueller Gate:** offen; bewusst erst nach vollständigem Refactoring
- **Projectile-/Combat-Full-Refactor:** ausdrücklich außerhalb dieses Plans

---

## Phasenstatus

| Teilphase | Status | Commit | Kurzgegenstand |
|---|---:|---|---|
| 1 | ✅ | `2b0db38d` | Baseline, Contracts, Migrationskarte |
| 2A | ✅ | `82322e93` | Player-Gameplay Lifecycle-Grenze |
| 2B | ✅ | `17d14634` | Player-Gameplay Read Views |
| 3A | ✅ | `936e5b87` | Host-Zeit im Action-/Request-Pfad |
| 3B | ✅ | `14a0f04b` | Resource/Readiness mit expliziter Zeit |
| 4A | ✅ | `0ee7093f` | Shared Immediate Weapon Execution |
| 4B | ✅ | `d104a9f9` | Automated-/Non-Player-Fire Cutover |
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
| Action | `ArenaRuntimeAdapters` (`loadout.use`) → `RpcCoordinator.registerLoadoutUseHandler` via `PlayerLoadoutRpcPort.useLoadout`; RPC bestimmt (3A) einen einzigen `hostNowMs` und reicht nur noch `clientX`/`clientY` durch, augmentiert Weapon2-Antwort um `worldRevision`/`authoritativeAdrenaline`/`adrenalineRevision` |
| Read/Presentation | `HostUpdateCoordinator`, `ClientUpdateCoordinator` (`getEquipped{Weapon,Utility,Ultimate}Config`, `getAk47HudBuffs`, `getNegevHudBuffs`, `getShieldBuffHudState`, `getCooldownFrac`, `getAimNetState`, `getHeldItemSlot`, `getUltimate*`, `isUltimate*`), `ArenaRuntimeAdapters` (`getEquippedUtilityConfig`, `getTemporaryUtilityConfig`) |
| Combat integration | `CombatSystem` (`setLoadoutManager` → `getWeaponDamageMultiplier`, `getDamageMultiplier`, `registerAk47ProjectileHit`), `WorldCombatGameplayBinding` (`handleKill`, `getEquippedWeaponConfig`, `getDamageMultiplier`, `getSpeedMultiplier`, `beginUtilityCooldown`, `resolveAk47Projectile` via `projectileManager.setProjectileResolvedCallback`), `HostPhysicsSystem` (`setLoadoutManager`), `Ak47StrategicTargetSystem` (`getEquippedWeaponConfig`), `FlamethrowerUpgradeSystem` (`resolveUtilityConfig`, `getEquippedWeaponConfig`), `TranslocatorSystem` (Typ) |
| Construction / Persistent Base | `ConstructionWorldRuntime` (`isConstructionOnCooldown`, `markConstructionUsed`, `useInspectorUtility`, `isManagementActionOnCooldown`, `markManagementActionUsed`, `getManagementActionCooldownUntil` via `RadialActionModel`, `setPlaceableRockHandler`, `setTunnelPlacementHandler`), `ArenaWorldConstructionComposition` (`addTemporaryUtility`) |
| automated actor / Activity | `CoopDefenseEnemyAttackSystem`, `NecromancySystem` und `CoopDefenseVoidHunterSystem` erhalten `AutomatedWeaponExecution`; `CoopMissionComposition` / `CoopMissionEnemyBehaviourComposition` / `CoopMissionEnemySupportComposition` reichen nur diese Automatik-Boundary weiter. `CoopMissionObjectiveComposition` nutzt `LoadoutManager` weiterhin ausschließlich für Temporary Utilities. |
| Support-/Ultimate-Handler-Wiring | `WorldSupportGameplayRuntime` (`setArmageddonSystem`, `setAirstrikeHandler`, `setStinkCloudSystem`) |
| network adapter (Legacy) | `LoadoutManager.ts` selbst: `this.bridge` → `getGameMode`, `publishUtilityCooldownUntil`, `publishTemporaryUtilityInstances`, `publishHeldUtilityId`, `isEnemyPair`, `broadcastExplosionEffect`, `broadcastShotFx`. Eingefrorener Consumer in `WorldGameplayCompositionContracts.test.ts` |
| Typ-/Sibling-only | `types.ts`, `loadout/BaseUltimate.ts`, `loadout/LoadoutRules.ts`, `loadout/ShotPlanResolver.ts`, `loadout/WeaponFireExecutor.ts` |

### `LoadoutManager.use` – einziger Produktiv-Call-Site

`ArenaRuntimeAdapters` → `PlayerLoadoutRpcPort.useLoadout` → `RpcCoordinator.registerLoadoutUseHandler`. Vorgelagerte hostautoritative Entscheidungen im RPC: Capabilities, Countdown, Dismantle/GlobalDismantle-Sonderpfade, Inspector-Class-Gate, `validateHostUtilityCharge` (`heldActions.consume`), Translocator-Recall (`heldActions.clearPlayer`). Zeit: seit 3A ein einziger hostseitiger `hostNowMs = Date.now()` je Aktion (kein Client-Timestamp mehr).

### Automatisierte und nicht-playergebundene Waffenquellen

4B ist abgeschlossen: `WorldCombatGameplayBinding` (Turm), `CoopDefenseEnemyAttackSystem`, `NecromancySystem` und `CoopDefenseVoidHunterSystem` verwenden keinen automatischen Fire-Service im `LoadoutManager` mehr. Die kleine `AutomatedWeaponExecutionAdapter`-Boundary delegiert Projectile/Hitscan/Melee an die world-composed `WeaponExecutionCapability`, führt die wenigen spezialisierten automatischen Payloads explizit aus und erhält Source-/Owner-/Allegiance-Metadaten. Enemy-/Turret-Cooldowns, Readiness und Salven bleiben in ihren Ownern.

### Construction-/Management-Cooldown-Methoden

Produktiv nur `ConstructionWorldRuntime`. Lifetime heute: `Map` im `LoadoutManager`, an `assignDefaultLoadout`/`removePlayer` gebunden (Player-in-World-Lifetime). Zielphase 5.

### Temporary-Utility-Methoden

`addTemporaryUtility`: `ArenaWorldConstructionComposition`, `CoopMissionObjectiveComposition`. `getTemporaryUtilityConfig`: `ArenaRuntimeAdapters`, `HostUpdateCoordinator`. `releaseTemporaryUtilityForObjective`: `CoopMissionObjectiveComposition`. State-Owner: `TemporaryUtilityCollection`. Zielphase 7A.

### AK47 / Negev / Shotgun

- AK47: `CombatSystem.registerAk47ProjectileHit`; `WorldCombatGameplayBinding` → `resolveAk47Projectile`; `WorldPlayerGameplayRuntime.setAk47StrategicTargetHitResolver`; HUD-Reads (`getAk47HudBuffs`, `isAk47FireSuperiority*`, `isAk47FocusAtMaxStacks`) im Host-/ClientUpdateCoordinator; `resetAk47State` in `assignDefaultLoadout`. State: `ak47States`-Map. Zielphase 8A.
- Negev: `WorldCombatGameplayBinding.handleKill` → `negevStates`; `update()` → `finishNegevKillstreak` (Streak-Gap `NEGEV_STREAK_GAP_MS`, expliziter Zeitwert aus dem Host-Update; verbleibender Default-Fallback → 8B); `setNegevKillstreakExplosionHandler` (`WorldPlayerGameplayRuntime`); HUD `getNegevHudBuffs`. Zielphase 8B.
- Shotgun: `WorldCombatGameplayBinding.handleKill` → `shotgunLightningQueue`; `processShotgunLightningQueue` in `update()` → `combatSystem.applyAoeDamage` + `bridge.broadcastExplosionEffect`; Chain-Generation. Zielphase 8C.

### Tesla-Dome / Energy-Shield / ShieldBuff Hooks

`WorldCombatGameplayBinding`: `setTeslaDomeSystem`, `setEnergyShieldSystem`, `setShieldBuffSystem`. Nutzung im Core: `activateTeslaDomeWeapon`/`activateEnergyShieldWeapon` aus `fireWeapon`; `deactivateNonAutonomousWeaponEffect` beim Slot-Claim (`claimWeaponSlot`); `hostDeactivateForPlayer` in `assignDefaultLoadout`/`removePlayer`/`destroy`; Speed-Multiplier-Zweige für `energy_shield`/`tesla_dome`. Zielphase 9.

### Zeitmigration nach 3A/3B: abgeschlossen, verbleibende Legacy-Stellen später zugeordnet

Die Zeitmigrationen von 3A und 3B sind im aktuellen Repository-Stand abgeschlossen:

- **3A ✅ (`936e5b87`):** `RpcCoordinator.registerLoadoutUseHandler` nimmt keinen Client-Timestamp (`ts`/`clientNow`) mehr an. Pro Loadout-Use wird ein einziger hostseitiger `hostNowMs` bestimmt und für `useLoadout`, `heldActions.consume`, `validateHostUtilityCharge` und `construction.useInspectorUtility` geteilt. Der `lu`-Wire-Pfad und der Host-Handler tragen damit keine Client-Uhr mehr.
- **3B ✅ (`14a0f04b`):** `ResourceSystem.drainAdrenaline(id, amount, nowMs)` und `ResourceSystem.regenTick(id, delta, nowMs)` erhalten die fachliche Zeit explizit; `HostUpdateCoordinator` reicht den Host-Frame-Zeitstempel an `regenTick`, `burrow.update` und `loadout.update` weiter. `LoadoutManager.fireWeapon` verwendet diesen Zeitwert für Adrenalin-Drain und Negev-Schusszeit, und die Negev-Abschlussexplosion übernimmt `event.nowMs`. Die internen `Date.now()`-Aufrufe des `ResourceSystem` sowie die alte `fireWeapon`-Zeitsetzung und die `bindLoadout`-`sourceId`-Zeitstelle aus der früheren Statusliste sind nicht mehr vorhanden.

Die folgenden Vorkommen sind deshalb **keine offenen 3A/3B-Aufgaben**. Sie bleiben als bewusst verschobene Legacy-Fallbacks bzw. direkt verdrahtete Zeitquellen bestehen und werden ihrer bereits geplanten späteren Fachphase zugeordnet. Die Liste umfasst den Player-Gameplay-/Action-/Behavior-/Integration-Pfad; UI-/Diagnose-Zeit, Netzwerk-Infrastruktur sowie die separat geplanten Projectile-/Combat-Refactorings werden nicht nachträglich 3A/3B zugerechnet.

| Spätere Fachphase | Verbleibende Legacy-Zeitstelle im Stand `d104a9f9` |
|---|---|
| **4C – spezialisierte Immediate-Execution-Adapter** | Die zeitbehafteten Defaults in `FlamethrowerUpgradeSystem` (`handleEnemyDeath`, `handleNaturalFlameExpiry`) und `EnergyInjectorSystem` gehören zu den spezialisierten unmittelbaren Payload-/Effect-Pfaden. Ihre Prüfung wird mit der ausdrücklich noch offenen 4C-Adapterprüfung vorgenommen; `AutomatedWeaponExecutionAdapter` wird hier nicht vorgezogen umgebaut. |
| **5 – Construction-/Management-Readiness** | `ConstructionWorldRuntime.placeInspectorConstruction` und `dismantleConstruction` bestimmen den Cooldown-Zeitpunkt noch direkt mit `Date.now()`. `ArenaPersistentBaseSession.movePersistentBaseObject` verwendet dies ebenfalls für die Management-Bereitschaft. Diese Zeitquelle wird erst mit der geplanten Readiness-Verlagerung in Phase 5 explizit eingespeist. |
| **6A – Player Action Runtime + Weapon Activation** | `LoadoutManager.update(delta, nowMs?)` fällt beim Spread-Decay noch auf `Date.now()` zurück, wenn der Aufrufer keinen Zeitwert liefert. `LoadoutManager.getSpeedMultiplier` und `getHeldSelfPushVelocity` verwenden für das Ablaufdatum von `heldFireSlots` weiterhin einen Default-Zeitwert. `BurrowSystem.update(delta, nowMs?)` sowie `startWindUp`, `finalizeExit` und `finalizeTunnelTransit` erzeugen bzw. prüfen Teile ihres Action-/Recovery-Zustands noch gegen `Date.now()`. Diese Stellen gehören zur expliziten Action-/Behavior-Zeitgrenze. |
| **6B – RPC-/Held-Action-Cutover** | `RpcCoordinator.registerHeldActionHandler` ruft beim Start einer Held Action weiterhin direkt `Date.now()` auf. Das ist bereits Host-Zeit, aber noch keine über die Player-Gameplay-Grenze eingespeiste Zeit; die Bereinigung gehört zum geplanten Held-Action-Cutover. Der lokale `ArenaInputBindings`-Cooldown-/Prediction-Clock bleibt nichtautoritativ und darf erst im jeweiligen Action-/Prediction-Cutover neu bewertet werden. |
| **7B – Buff-/Armageddon-Ultimate Behavior** | `LoadoutManager.update()` verwendet den Zeitwert noch für Ultimate-Drain und Buff-/Aura-Ticks. Die Default-Zeit in `getDamageMultiplier`/`getAllyAuraMultiplier` betrifft ebenfalls den heute noch im Loadout liegenden Buff-/Aura-State und wird mit dessen Behavior-Extraktion bereinigt. |
| **7A – Utility Activation und Temporary Utilities** | Die Default-/Direktzeit in `TimeBubbleSystem` und `DecoySystem` gehört zu den Utility-Lifecycles und wird beim Utility-Cutover explizit an die jeweilige Activation-/Effect-Zeit binden. |
| **7C – Airstrike/Tunnel/Gauss Ultimate** | `AirstrikeSystem` verwendet `Date.now()` beim Arming, `CoopDefenseVoidHunterSystem.notifyNukeExploded` besitzt noch einen Zeit-Default und `InputSystem` berechnet die lokale Gauss-Charge mit der lokalen Uhr. Diese Stellen gehören zur jeweiligen Ultimate-Activation; die lokale Anzeige bleibt bis dahin nichtautoritative Projektion. |
| **8A – AK47 Behavior** | `LoadoutManager.registerAk47ProjectileHit`, `resolveAk47Projectile` und `getAk47HudBuffs` sowie `Ak47StrategicTargetSystem.handleDirectAk47EnemyHit`, `isCurrentTarget` und `getNetSnapshot` besitzen noch `Date.now()`-Fallbacks. Die Fallbacks werden mit der AK47-State-/Outcome-Grenze entfernt; sie sind keine offene 3B-Resource-Zeitmigration. |
| **8B – Negev Behavior** | Der Negev-Zweig in `LoadoutManager.update()` nutzt den bereits übergebenen Zeitwert für das Streak-Gap, aber `finishNegevKillstreak` hat noch einen `Date.now()`-Default. Der tatsächliche Fire-Zeitpunkt (`negevState.lastShotAt`) ist dagegen seit 3B explizit und bleibt abgeschlossen. |
| **9 – Tesla Dome / Energy Shield Behavior** | `LoadoutManager.getShieldBuffHudState` besitzt noch einen `Date.now()`-Default. Der Shield-/Dome-Anteil von `getSpeedMultiplier` und die dazugehörigen zeitabhängigen Reads werden mit der geplanten Sustained-Behavior-Grenze bereinigt. |
| **11A/11B – PlayerCombatIntegration** | `LoadoutManager.getDamageMultiplier`/`getWeaponDamageMultiplier` haben noch `Date.now()`-Defaults; `CombatSystem` übergibt an mehreren Legacy-Damage-Pfaden direkt `Date.now()`. Die Zuordnung gehört zur späteren Player-Combat-Integration für Modifier-Reads bzw. Hit-/Outcome-Reaktionen. Die verbleibenden zeitbehafteten Defaults in `CoopDefenseItemRuntimeSystem` sowie die direkten Zeitübergaben aus `ArenaWorldPlayerComposition`, `ArenaWorldCombatComposition` und `WorldCombatGameplayBinding` werden dort fachlich mitgeführt. |
| **12A/12B – Host-/Client-Frame und stabile Reads** | `LoadoutManager.getHeldItemSlot` hat noch einen `Date.now()`-Default, obwohl der Host-Frame ihn bereits mit `now` aufruft; die Bereinigung gehört zur stabilen Held-Item-/HUD-Read-Grenze in 12B. Die verbleibenden Frame-Caller, die Legacy-Systeme direkt mit `Date.now()` takten, werden im Stage-/Read-Cutover bewertet. |
| **separates Projectile-/Combat-Refactoring nach dem ersten Cutover** | Verbleibende fachliche Zeitstellen innerhalb von `ProjectileManager`/`CombatSystem` und deren unteren Interaktionspfaden sind nicht Teil von 3A/3B und werden nicht vorgezogen. Sie bleiben dem später geplanten Projectile- bzw. Combat-Runtime-Refactoring zugeordnet. |

### `clientX` / `clientY` im Loadout-Use-Pfad

`RpcCoordinator.registerLoadoutUseHandler` liest `clientX`/`clientY` aus dem Wire und reicht sie an `loadout.use(…, clientX, clientY)` durch (der Client-Timestamp `ts`/`clientNow` wurde in 3A **entfernt**). In `use()`: `x = clientX ?? player.x; y = clientY ?? player.y` – Ursprung für Weapon-Fire, Utility, Ultimate. Positions- und Zeit-Authority sind zwei getrennte Entscheidungen (3A ≠ 6A). **Testseitig fixiert** durch `GameplayRuntimeCutoverCharacterization.test.ts` (`use – Client-Position im Waffen-Pfad`); 6A darf die Positionssemantik nur über einen benannten Request-/Position-Policy-Schritt ändern.

### Source-Ratchets (String-Scan-Tests, die aktuelle Quellcodepositionen pinnen)

Diese Tests schützen heute alte Positionen und müssen von den jeweiligen Cutover-Phasen semantisch mitmigriert werden:

| Test | Pinnt | Migriert in |
|---|---|---|
| `Phase11DependencyCutover.test.ts` | **2A: Held-Action-Assertions auf `invalidateHeldActionsForPlayer` / `invalidateHeldActionsOnActivityEnd` umgestellt** (+ `flow` enthält kein `worldPlayerGameplayRuntime?.systems.heldAction` mehr). Verbleibend: `RpcCoordinator`-Portnamen, Frame-Read-Ports → 6B | 2A ✅ / 6B |
| `WorldGameplayCompositionContracts.test.ts` | eingefrorene `NetworkBridge`-Consumer-Liste inkl. `src/loadout/LoadoutManager.ts`; neue World-Owner frei von `NetworkBridge`/`ArenaContext`; `new WorldPlayerGameplayRuntime` nur in Composition. **4A: `new WorldWeaponExecutionRuntime` + `worldRuntime.bind(weaponExecution)` in die Owner-/Bind-Liste aufgenommen** | 2A / 4A ✅ / 10B |
| `ArenaFlowCheckpointC.test.ts` | Scene-facing Runtime-Oberfläche frei von `LoadoutManager` u. a.; `getWorldPlayerGameplayRuntime`-Gate des Balance-Lab (2B: `isReady` prüft nur noch Nicht-`null`); kein `new WorldPlayerGameplayRuntime` im Flow. **4A: `new WorldWeaponExecutionRuntime` in die „nicht im Flow"-Liste aufgenommen** | 2A / 2B / 4A ✅ |
| `PlayerWorldRuntimeContracts.test.ts` | **2A: „genau ein Detach-Pfad"-Scan auf `detachPlayerLoadout(` / `detachPlayerBurrow(` umgestellt** (vorher `systems.loadout.removePlayer` / `systems.burrow.removePlayer`) | 2A ✅ |
| **`PlayerGameplayReadViewBoundary.test.ts`** | **neu (2B): friert die 9 verbleibenden externen `WorldPlayerGameplayRuntime.systems`-Consumer ein; prüft die migrierten Read-Call-Sites** – Ratchet gegen neue `.systems`-Leaks | schrumpft in 3B · 5 · 6A · 6B · 11 · 12A · 12B · 12C |
| `DachsOfSteelRockArmorDrop.test.ts` | **2B: Mock `getPlayerGameplayRuntime()` gibt jetzt `getPlayerClassId` statt `{ systems: { playerModifier } }`** | 2B ✅ |
| `TransitionRaceCases.test.ts` | **3A: `lu`-Payload-Destructure-Scan auf `{ …, px, py, wr }` umgestellt** (vorher `…, px, py, ts, wr` – `ts`-Feld entfernt) | 3A ✅ |
| **`WorldWeaponExecutionRuntime.test.ts`** | **neu (4A): Capability-Verdrahtung (Projectile/Hitscan/Melee), Metadaten-Durchreichung, `destroy`-Idempotenz; Ratchet `LoadoutManager` baut `new WeaponFireExecutor` nicht mehr selbst** | 4C |
| `WorldCombatGameplayBinding.test.ts`, `WorldMaterializationOwnership.test.ts`, `CoopMissionRuntimeOwnership.test.ts`, `ActivityRebindingContracts.test.ts` | World-/Combat-/Activity-Ownership-Scans mit `WorldPlayerGameplayRuntime`-Bezug (4B: Turm nutzt `AutomatedWeaponExecution`, Activity-Rebinding erhält die neue World-Boundary) | 11 / 12C |

---

## Test-Migrationskarte

Stand nach Phase 4B. `abgedeckt` = Ist-Semantik ausreichend charakterisiert; `Zielstatus` = was die genannte Phase mit dem Test tun muss.

| Semantik | Test(s) | Ist | Zielstatus |
|---|---|---|---|
| Held Action duplicate-safe / stale / Identity | `HostHeldActionSystem.test.ts` | abgedeckt (3A: unverändert, `start`/`consume` erhalten jetzt einen einzigen `hostNowMs` je Aktion) | prüfen bei 6B |
| Weapon2 Prediction Retry/Dedupe + authoritative Adrenalin/Revision | `Weapon2PredictionDedupe.test.ts`, `ClientWeaponAdrenalinePrediction.test.ts` | abgedeckt | prüfen bei 6B |
| Temporary Utility Identity / Charges / Cooldown / Acquisition Order | `TemporaryUtilityLifecycle.test.ts` | abgedeckt | prüfen bei 7A |
| Radial/Held RPC | `RadialActionRpc.test.ts`, `RadialActionInput.test.ts` | abgedeckt | migrieren bei 6B / 7A |
| Shared automated fire + Source-/Owner-Metadaten | `AutomatedPelletWeapon.test.ts`, `InspectorSupportWeapons.test.ts`, `ReinforcementMatrixProjectile.test.ts` + Consumer-Tests (`CoopDefenseVoidHunterSystem`, `CoopDefenseInfernoColossusCombat`, `GraveTitanVoidPlasma`, `CoopDefenseStuckEnemyBite`) | abgedeckt (4B: `AutomatedWeaponExecutionAdapter` nutzt die World-Capability; alte Loadout-Fire-Methoden und Activity-Weiterreichungen sind entfernt) | prüfen bei 4C |
| Shared Immediate Execution (Projectile/Hitscan/Melee) | `WeaponFireExecutor.test.ts`, `WorldWeaponExecutionRuntime.test.ts` | abgedeckt (4A: Capability world-composed, `WeaponFireExecutor implements WeaponExecutionCapability`) | prüfen bei 4C |
| Weapon-Slot-Exklusivität / Channel-Switch-Deaktivierung | `WeaponSlotExclusivity.test.ts` | abgedeckt | prüfen bei 6A / 9 |
| Dynamischer Spread / aktiver Slot / Shot Identity | `AimSpreadModelActiveSlot.test.ts`, `ShotPlanResolverRuntimeRegression.test.ts`, `ProjectileSpawnResolver.test.ts` | abgedeckt | prüfen bei 6A |
| Resource Revision / Adrenalin-Observer / Cost-Modifier | `ResourceSystemObservers.test.ts`, `ResourceSystemExplicitTime.test.ts` | abgedeckt (3B: explizite Zeit, Pause, Regen-Tick, Powerup-Interaktion) | prüfen bei 6A |
| **`clientX`/`clientY` als Use-Ursprung** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)**; in 3A bewusst unverändert (Positions-/Latenzsemantik ≠ Zeit-Authority) | Zielprüfung 6A |
| **Host-Zeit-Authority der Player-Aktion (Clock-Skew)** | `RadialActionRpc.test.ts` (ein `hostNowMs` je Aktion, geteilt mit Held-Action-Consume), `Weapon2PredictionDedupe.test.ts` (`lu`-Payload-`ts` erreicht den Host-Handler nicht) | **abgedeckt (Phase 3A ✅)** | prüfen bei 6A / 6B |
| **Waffen-Commit-Reihenfolge: Reject → keine Resource-/Cooldown-Mutation; Drain erst nach Dispatch** | `GameplayRuntimeCutoverCharacterization.test.ts` | abgedeckt (3B: mit expliziter Zeit `nowMs` gesichert) | Zielprüfung 6A |
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
| **Player-in-World-Lifecycle- und Read-View-Grenze der Runtime** | `WorldPlayerGameplayLifecycle.test.ts` (attach/detach/reconcile/held-invalidation + wiederholte Detach-/Reset-/Destroy-Pfade + Read-Views), `PlayerGameplayReadViewBoundary.test.ts` (`.systems`-Ratchet) | abgedeckt (Correction-Pass ergänzt Idempotenz-Gate) | prüfen bei 12A / 12B |

---

## Bewusste Übergänge / bekannte Regressionen

Aktuell keine Implementierungsübergänge. 2A/2B/3A/3B/4A sind reine Boundary-/Zeit-Moves ohne fachliche Semantikänderung:

- **2A** kapselt die Player-Child-Lifecycle-Schritte (`resource`/`burrow`/`itemRuntime`/`loadout`/`tunnel`/`heldAction`/`playerModifier`) hinter `WorldPlayerGameplayRuntime`-Methoden. Zwei verhaltensneutrale Reorderings: im `detachLoadout`-Pfad läuft `worldPowerUpRuntime.system.removePlayer` jetzt nach `detachPlayerLoadout` (loadout+tunnel); in `syncHostLoadoutsFromCommittedSelections` läuft `resource.reconcilePlayerLimits` jetzt vor `combatSystem.reconcilePlayerRuntimeState`. Beide betreffen unabhängige Map-Löschungen bzw. getrennte Domains.
- **2B** routet die reinen Read-Zugriffe von `ArenaRuntimeAdapters`, `ArenaRuntime`, `RockVisualHelper` und `ArenaLifecycleCoordinator` über die `PlayerGameplayReadViews` derselben Runtime. Genuine Mutationen (`loadout.use`, `heldAction.*`, `burrow.handleBurrowRequest`, `resource.setAdrenaline`) sowie die Activity-System-Handoffs und Frame-Reads bleiben bewusst als `.systems.*` und sind im Ratchet `PlayerGameplayReadViewBoundary.test.ts` eingefroren.
- **3A** entfernt den Client-Timestamp (`ts` / `clientNow`) vollständig aus dem `lu`-RPC-Pfad (NetworkBridge-Wire + `LoadoutUseHandler`-Typ, `RpcCoordinator`, `ClientUpdateCoordinator.PredictedWeapon2Request`, `ArenaInputBindings`, `ArenaScene`). `RpcCoordinator.registerLoadoutUseHandler` bestimmt einen einzigen `hostNowMs = Date.now()` je Aktion und teilt ihn zwischen `useLoadout`, `heldActions.consume`, `validateHostUtilityCharge` und `construction.useInspectorUtility`. Verhaltensänderung nur im Missbrauchsfall: der bisherige ±200 ms-Client-Timestamp-Spielraum für Waffe-2-Cooldowns entfällt. Client-Prediction reconciled weiterhin über `weapon2PredictionAck` / `authoritativeAdrenaline`. `clientX`/`clientY` bleiben unverändert.
- **3B** stellt `ResourceSystem.drainAdrenaline(id, amount, nowMs)` und `ResourceSystem.regenTick(id, delta, nowMs)` auf explizite Host-Zeit um und entfernt die internen `Date.now()`-Aufrufe vollständig. `HostUpdateCoordinator` taktet `regenTick`, `burrow.update` und `loadout.update` mit dem Host-Frame-Timestamp `now`. `LoadoutManager.fireWeapon` reicht `now` an `drainAdrenaline` und den Negev-Zustand (`negevState.lastShotAt = now`) durch. Die Loadout-Multiplier-Reads (`getSpeedMultiplier`, `getHeldSelfPushVelocity`, `getDamageMultiplier`, `getAllyAuraMultiplier`, `getWeaponDamageMultiplier`) akzeptieren optional `now` und verwenden keine versteckte Wanduhr mehr bei Durchreichung. `WorldPlayerGameplayRuntime` bindet die Negev-Abschlussexplosion an `event.nowMs`. Item-lokale Readiness verbleibt unverändert bei `BaseWeapon`, `BaseUtility` und `TemporaryUtilityCollection`.
- **4A** zieht die gemeinsame Immediate-Weapon-Execution aus dem `LoadoutManager` heraus: neuer world-composed `WorldWeaponExecutionRuntime` (implementiert `WeaponExecutionCapability`) besitzt den `WeaponFireExecutor` und verdrahtet dessen `WeaponFireSink` einmalig mit `ProjectileManager` + `CombatSystem`. Der `LoadoutManager` baut den Executor nicht mehr selbst, sondern erhält die Capability per `setWeaponExecutionCapability(...)` (gebunden in `WorldPlayerGameplayRuntime.bindLoadout`, geleert im `destroy`) und delegiert seinen Player-Fire unverändert dorthin. Die per-Schuss-Metadaten (`ownerId`, `sourceSlot`, `shotId`, Muzzle-Origins, `sourceTurretId`, Damage-Multiplier, Payload-Metadaten) laufen 1:1 durch. Kein Projectile-/Combat-internes Verhalten geändert.
- **4B** migriert automatische Quellen an eine getrennte world-lokale `AutomatedWeaponExecution`-Boundary. `AutomatedWeaponExecutionAdapter` übernimmt Pellet-/Payload-Skalierung und die spezialisierten Flamethrower-/Leaf-Blower-/Reinforcement-Matrix-/Energy-Injector-/Gauss-Ausführungen; Projectile/Hitscan/Melee laufen über die gemeinsame `WeaponExecutionCapability`. Timing, Readiness, Salven und Host-Autorität bleiben bei Enemy-, Turret- bzw. Support-Ownern. `LoadoutManager` enthält keine `fireAutomatedWeapon`-/`fireAutomatedGaussWeapon`-Methoden mehr.

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
| `PlayerGameplayLifecyclePort` | `interface PlayerGameplayLifecyclePort` in `src/world/WorldPlayerGameplayRuntime.ts`, implementiert von `WorldPlayerGameplayRuntime`. Methoden: `attachPlayerResources` / `detachPlayerResources` / `attachPlayerBurrow` / `detachPlayerBurrow` / `attachPlayerBuild` / `detachPlayerBuild` / `attachPlayerLoadout(playerId, selection?)` / `detachPlayerLoadout` / `reconcilePlayerLoadout(playerId, selection?)` / `reconcilePlayerBuildModifiers(builds)` mit `Pick<LoadoutCommitSnapshot, 'coopDefenseClassId' | 'coopDefenseProfile' | 'equippedItems'> | null` je Map-Wert / `invalidateHeldActionsForPlayer` / `invalidateHeldActionsOnActivityEnd`. Die Player-Existenzprüfung liegt intern beim `PlayerManager`; ein externer `hasPlayer`-Callback gehört nicht mehr zur Boundary. World-Teardown bleibt `WorldScopedBinding.destroy()`. | 2A / Correction-Pass |
| `PlayerGameplayReadViews` | Vier kleine Interfaces in `src/world/WorldPlayerGameplayRuntime.ts`, alle von `WorldPlayerGameplayRuntime` implementiert, plus `type PlayerGameplayReadViews` als deren Schnittmenge. `PlayerGameplayStateReadView` (`isBurrowed`/`isStunned`/`getPlayerClassId`); `PlayerGameplayLoadoutReadView` (`getEquippedUtilityConfig`/`getTemporaryUtilityConfig`/`hasActiveTranslocatorPuck`); `PlayerGameplayResourceReadView` (`getAdrenaline`/`getAdrenalineRevision`/`getMaxAdrenaline`/`addAdrenalineDrainObserver`/`addAdrenalineGainObserver`); `PlayerGameplaySnapshotReadView` (`getTranslocatorActivePuckId`/`getTunnelNetSnapshot`/`getAk47StrategicTargetNetSnapshot`). | 2B |
| `PlayerActionRequest` | — | — |
| `WeaponExecutionCapability` | `interface WeaponExecutionCapability { fire(config: WeaponConfig, params: WeaponFireParams): boolean }` in `src/loadout/WeaponFireExecutor.ts`; einziger gemeinsamer Vertrag ist `WeaponFireExecutor.fire` (`class WeaponFireExecutor implements WeaponExecutionCapability`). World-composed Owner: `class WorldWeaponExecutionRuntime` (`src/world/WorldWeaponExecutionRuntime.ts`, `WorldScopedBinding`), erzeugt in `ArenaWorldPlayerComposition`, Slot `ArenaWorldGameplay.weaponExecution`. Die getrennte 4B-Boundary `interface AutomatedWeaponExecution` / `class AutomatedWeaponExecutionAdapter` in `src/world/AutomatedWeaponExecutionAdapter.ts` hält automatische Payload-Sonderfälle explizit. | 4A / 4B |
| `PlayerRelationshipPort` | — | — |
| `PlayerCombatIntegrationPort` | — | — |
| `PlayerGameplayFrameStages` | — | — |

---

## Nächster konkreter Schritt

**Teilphase 4C umsetzen – spezialisierte Immediate-Execution-Adapter.**

Dabei:

1. Die `AutomatedWeaponExecutionAdapter`-Sonderpfade gegen die 4C-Verträge für spezialisierte Immediate-Ausführung prüfen und, falls erforderlich, in kleine fachliche Adapter überführen.
2. Gemeinsame Projectile/Hitscan/Melee-Ausführung weiterhin ausschließlich über `WeaponExecutionCapability` verwenden; keine universelle Ability- oder Execution-Context-Abstraktion einführen.
3. Referenz-§§: `02` §§ 13–15, 19, 26–29.
4. Gate: passende Adapter-/Execution-Tests, `npm run check`, anschließend die bekannten CRLF-Flaker separat bewerten.

Hinweis für den Gate: `npm test` (bekannte CRLF-Flaker in `ArenaTransitionReadiness` verbleiben) plus `npm run build`; berührte Flaker isoliert prüfen.

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
