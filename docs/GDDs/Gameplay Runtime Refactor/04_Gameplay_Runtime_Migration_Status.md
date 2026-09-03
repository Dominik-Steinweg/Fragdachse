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

- **Aktive Teilphase:** `7A – Utility Activation und Temporary Utilities` (nächster Schritt)
- **Zuletzt abgeschlossen:** `6B – RPC-, Held-Action- und Weapon2-Prediction-Cutover` ✅
- **Gesamtstatus:** Lifecycle-, Read-View-, Action-Zeit-, Resource-/Readiness-Zeit-Grenzen und die world-composed Immediate-Weapon-Execution-Capabilities stehen. Construction-/Management-Readiness liegt jetzt im World-Construction-Owner und wird über einen schmalen Port von der Persistent-Base-Session genutzt; Konstruktion, Einzel-Rückbau und Persistent-Base-Repositionierung verwenden explizite Host-Zeit. Gemeinsame Projectile/Hitscan/Melee-Fälle laufen über `WeaponExecutionCapability`; Flamethrower, Leaf Blower, Reinforcement Matrix und Energy Injector laufen über die benannte `SpecializedWeaponExecutionCapability`. Der World-Player-Owner besitzt mit `PlayerActionRuntime` die hostautoritative Weapon1/Weapon2-Action-Grenze sowie seit 6B die semantische Held-Action-, Burrow- und Resource-Command-Grenze. Die NetworkBridge behält ausschließlich Weapon2-Prediction-Dedupe und Reconciliation-Identität; RPC/Adapter greifen nicht mehr über konkrete Player-Gameplay-Child-Systeme durch. Utility/Ultimate verwenden bis 7A/7B/7C weiterhin den benannten Legacy-Pfad. Gegner, Türme, Necromancy und Void-Hunter-Gauss behalten ihre automatische Boundary; Timing, Readiness und Autorität bleiben bei ihren jeweiligen Ownern.
- **Letzter verifizierter Repository-Stand:** Phase-6B-Commit (dieser Commit)
- **Letzter grüner automatisierter Phase-Gate:** `npm run typecheck` grün; der fokussierte Phase-6B-Lauf meldete **7 Dateien / 52 Tests grün** (Held-Action-Identity und Retry-Semantik, Weapon2-Prediction/Dedupe, autoritativer Adrenalinwert/-revision, Radial-RPC und Player-Gameplay-Boundary); `npm run build` (tsc + vite) grün. Der vollständige Testlauf meldete **347 Dateien / 2949 Tests grün**, 15 übersprungen; `npm run check` bleibt wegen der fünf bekannten Baseline-Fehler rot (vier CRLF-Source-Scans in `ArenaTransitionReadiness.test.ts`, ein `Math.random`-Flaker in `WorldCombatGameplayBinding.test.ts`).
- **Bekannte Umgebungsflakiness (nicht durch dieses Refactoring verursacht):** `tests/ArenaTransitionReadiness.test.ts` (4 Source-Scan-Tests mit `\n{…}`-Literalen) schlägt in einem CRLF-Checkout unabhängig vom Diff fehl; `tests/WorldCombatGameplayBinding.test.ts` AK47-„random visible target" ist `Math.random`-flaky (~1/5 Läufe). Beide Fehlergruppen wurden im vollständigen Lauf separat isoliert bewertet; TypeScript, fokussiertes Phase-6B-Gate und Build sind grün.
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
| 4C | ✅ | `Phase-4C-Commit` | Spezialisierte Immediate-Execution-Adapter |
| 5 | ✅ | `Phase-5-Commit` | Construction-/Management-Readiness |
| 6A | ✅ | `Phase-6A-Commit` | Player Action Runtime + Weapon Activation |
| 6B | ✅ | `Phase-6B-Commit` | RPC/Held/Weapon2-Prediction Cutover |
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
| `scenes/arena/ArenaRuntimeAdapters.ts` | Reads in 2B → Read-Views (`isBurrowed`/`isStunned`/`getEquippedUtilityConfig`/`getTemporaryUtilityConfig`/`hasActiveTranslocatorPuck`/`getAdrenaline`/`getAdrenalineRevision`/`getMaxAdrenaline`/`addAdrenaline*Observer`/`getAk47StrategicTargetNetSnapshot`). **6A:** Weapon1/Weapon2 gehen über `WorldPlayerGameplayRuntime.usePlayerAction`; Utility/Ultimate bleiben als benannter Legacy-Pfad. **6B:** Held-Action-Start/Cancel/Consume/Clear, Burrow-Request und Balance-Lab-`setAdrenaline` gehen über benannte Player-Gameplay-Methoden; kein externer Zugriff auf `systems.*` verbleibt. | Read ✅ / Weapon-Action ✅ / Player-Gameplay-Mutationen ✅ | 2B ✅ / 6A ✅ / 6B ✅ |
| `scenes/arena/HostUpdateCoordinator.ts` | `playerSystems` = `getPlayerGameplayRuntime()?.systems`; taktet `resource.regenTick`, `burrow.update`, `loadout.update`, `tunnel.update`, `weaponUpgrade`, `ak47StrategicTarget`, `guardianSpirit`, `repairDrone`, `slimeTrail`, `flamethrowerUpgrade`, `itemRuntime`; liest ~30 Loadout-/Resource-Getter für HUD/Net-Snapshot | Host-Frame + Read | 12A |
| `scenes/arena/ClientUpdateCoordinator.ts` | `playerSystems`; `loadout.getEquipped*`, `getUltimateThresholds`, `isAk47FireSuperiorityAvailable`, `resource.getAdrenaline`, `burrow.isBurrowed` | Client-Frame Read | 12B |
| `scenes/arena/ArenaWorldCombatComposition.ts` | `playerRuntime?.systems.{itemRuntime,flamethrowerUpgrade}` | Combat-Composition (composition-inner, Ratchet-erlaubt) | 11 |
| `scenes/arena/ArenaWorldConstructionComposition.ts` | `gameplay.player?.systems.{loadout,playerModifier,tunnel,burrow,resource}`, `loadout.addTemporaryUtility` | Construction-Composition (composition-inner) | 5 / 7A |
| `scenes/arena/ArenaWorldEnvironmentComposition.ts` | `gameplay.player?.systems.{burrow,translocator,loadout}` | Support-Composition (composition-inner) | 12C |
| `scenes/arena/ArenaRuntime.ts` | 2B: `getTranslocatorActivePuckId`/`getTunnelNetSnapshot` → Read-Views. **Verbleibend:** `itemRuntime.getRemoteControlSnapshot` (Cross-Runtime-Join mit `turret`) | Read ✅ / Snapshot-Join offen | 2B ✅ / 12B |
| `scenes/arena/RockVisualHelper.ts` | 2B: `getClassId` → `getPlayerClassId`-Read-View; `playerSystems`-Getter entfernt | Read ✅ | 2B ✅ |
| `scenes/arena/ArenaPersistentBaseSession.ts` | nutzt `getConstructionReadiness()` für Reposition-Readiness; persistente Basisdaten und Move-Transaktionen bleiben im raumlanglebigen Room-Owner | Readiness-Port ✅ | 5 ✅ |
| `world/WorldCombatGameplayBinding.ts` | konsumiert `WorldPlayerGameplaySystems`-Typ + `getPlayerSystems()?.{loadout,playerModifier,burrow}` | Combat integration | 11A / 11B |

### `LoadoutManager` (direkte Typ-Consumer, nach Consumer-Art)

| Consumer-Art | Consumer (Datei → API) |
|---|---|
| Owner/Lifecycle | `WorldPlayerGameplayRuntime` (`createLoadoutManager`, `bindLoadout`, `destroy` löst alle Setter), `ArenaWorldPlayerComposition` (reicht `createLoadoutManager`), `ArenaLifecycleCoordinator` (`assignDefaultLoadout`, `syncSelectedLoadout`, `resetUltimateState`, `removePlayer`, `resetAllUltimateStates`) |
| Action | Weapon1/Weapon2: `ArenaRuntimeAdapters` → `PlayerLoadoutRpcPort.usePlayerAction` → `WorldPlayerGameplayRuntime.usePlayerAction` → `PlayerActionRuntime`; Utility/Ultimate: benannter Legacy-Pfad `useLegacyLoadoutAction` → `LoadoutManager.use`. RPC bestimmt (3A/6B) einen einzigen `hostNowMs`, die Action-Grenze löst `clientX`/`clientY` über eine benannte Positionspolicy auf und augmentiert die Weapon2-Antwort weiterhin um `worldRevision`/`authoritativeAdrenaline`/`adrenalineRevision`. Held Actions, Burrow und Resource-Tooling mutieren ausschließlich über `WorldPlayerGameplayRuntime`-Commands; identische Held-Starts sind idempotent, fehlerhafte Consumes bleiben ohne Mutation. |
| Read/Presentation | `HostUpdateCoordinator`, `ClientUpdateCoordinator` (`getEquipped{Weapon,Utility,Ultimate}Config`, `getAk47HudBuffs`, `getNegevHudBuffs`, `getShieldBuffHudState`, `getCooldownFrac`, `getAimNetState`, `getHeldItemSlot`, `getUltimate*`, `isUltimate*`), `ArenaRuntimeAdapters` (`getEquippedUtilityConfig`, `getTemporaryUtilityConfig`) |
| Combat integration | `CombatSystem` (`setLoadoutManager` → `getWeaponDamageMultiplier`, `getDamageMultiplier`, `registerAk47ProjectileHit`), `WorldCombatGameplayBinding` (`handleKill`, `getEquippedWeaponConfig`, `getDamageMultiplier`, `getSpeedMultiplier`, `beginUtilityCooldown`, `resolveAk47Projectile` via `projectileManager.setProjectileResolvedCallback`), `HostPhysicsSystem` (`setLoadoutManager`), `Ak47StrategicTargetSystem` (`getEquippedWeaponConfig`), `FlamethrowerUpgradeSystem` (`resolveUtilityConfig`, `getEquippedWeaponConfig`), `TranslocatorSystem` (Typ) |
| Construction / Persistent Base | `ConstructionWorldRuntime` (`useInspectorUtility`, Construction-Handler und `ConstructionReadinessPort`), `ArenaPersistentBaseSession` über den schmalen Readiness-Port, `ArenaWorldConstructionComposition` (`addTemporaryUtility`) |
| automated actor / Activity | `CoopDefenseEnemyAttackSystem`, `NecromancySystem` und `CoopDefenseVoidHunterSystem` erhalten `AutomatedWeaponExecution`; `CoopMissionComposition` / `CoopMissionEnemyBehaviourComposition` / `CoopMissionEnemySupportComposition` reichen nur diese Automatik-Boundary weiter. `CoopMissionObjectiveComposition` nutzt `LoadoutManager` weiterhin ausschließlich für Temporary Utilities. |
| Support-/Ultimate-Handler-Wiring | `WorldSupportGameplayRuntime` (`setArmageddonSystem`, `setAirstrikeHandler`, `setStinkCloudSystem`) |
| network adapter (Legacy) | `LoadoutManager.ts` selbst: `this.bridge` → `getGameMode`, `publishUtilityCooldownUntil`, `publishTemporaryUtilityInstances`, `publishHeldUtilityId`, `isEnemyPair`, `broadcastExplosionEffect`, `broadcastShotFx`. Eingefrorener Consumer in `WorldGameplayCompositionContracts.test.ts` |
| Typ-/Sibling-only | `types.ts`, `loadout/BaseUltimate.ts`, `loadout/LoadoutRules.ts`, `loadout/ShotPlanResolver.ts`, `loadout/WeaponFireExecutor.ts` |

### `LoadoutManager.use` – verbleibender Legacy-Call-Site

`ArenaRuntimeAdapters` → `PlayerLoadoutRpcPort.useLoadout` → `RpcCoordinator.registerLoadoutUseHandler` bleibt ausschließlich für Utility/Ultimate und deren Sonderpfade bestehen. Weapon1/Weapon2 gehen über `PlayerLoadoutRpcPort.usePlayerAction` in `PlayerActionRuntime`; dessen Loadout-Port ruft die gemeinsame `activateWeapon`-Implementierung genau einmal auf. Vorgelagerte hostautoritative Entscheidungen im RPC: Capabilities, Countdown, Dismantle/GlobalDismantle-Sonderpfade, Inspector-Class-Gate, `validateHostUtilityCharge` (`heldActions.consume`), Translocator-Recall (`heldActions.clearPlayer`). Held-Action-Start erhält in 6B einmalig `hostNowMs` und wird über die World-Player-Gameplay-Grenze an `HostHeldActionSystem` gereicht; der interne Owner bleibt der einzige Held-State-Writer. Die NetworkBridge bleibt für Weapon2-Prediction-Dedupe und Prediction-ID zuständig.

### Automatisierte und nicht-playergebundene Waffenquellen

4B ist abgeschlossen: `WorldCombatGameplayBinding` (Turm), `CoopDefenseEnemyAttackSystem`, `NecromancySystem` und `CoopDefenseVoidHunterSystem` verwenden keinen automatischen Fire-Service im `LoadoutManager` mehr. Die kleine `AutomatedWeaponExecutionAdapter`-Boundary delegiert Projectile/Hitscan/Melee an die world-composed `WeaponExecutionCapability`, führt die wenigen spezialisierten automatischen Payloads explizit aus und erhält Source-/Owner-/Allegiance-Metadaten. Enemy-/Turret-Cooldowns, Readiness und Salven bleiben in ihren Ownern.

4C ist abgeschlossen: `SpecializedWeaponExecutionAdapter` implementiert die getrennte `SpecializedWeaponExecutionCapability` für Flamethrower, Leaf Blower, Reinforcement Matrix und Energy Injector. Der Player-Loadout delegiert diese unmittelbaren Aufträge ebenso wie der automatische Adapter; der automatische Adapter behält davor seine eigene Pellet-/Damage-Skalierung. Der Adapter besitzt keinen Player-Lifecycle-, Ressourcen-, Cooldown- oder Commit-State und schreibt weiterhin ausschließlich in die bestehende `ProjectileManager`-Senke. Gauss bleibt als spezieller automatischer Pfad im automatischen Adapter.

### Construction-/Management-Cooldown-Methoden

Produktiv in `ConstructionWorldRuntime` und `ArenaPersistentBaseSession` nur über den schmalen `ConstructionReadinessPort`. Owner: `ConstructionReadinessRuntime` im World-Construction-Owner; Lifetime bleibt Player-in-World durch Attach/Detach sowie World-Teardown. `LoadoutManager` besitzt weder diese Maps noch die Readiness-Methoden. Phase 5 ✅.

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

| Spätere Fachphase | Verbleibende Legacy-Zeitstelle im Stand `Phase 6B` |
|---|---|
| **11B – PlayerCombatIntegration Outcomes/Reactions** | Die in 4C geprüften zeitbehafteten Defaults in `FlamethrowerUpgradeSystem` (`handleEnemyDeath`, `handleNaturalFlameExpiry`) und `EnergyInjectorSystem` gehören zu stateful Payload-/Effect-Reaktionen, nicht zur zustandsarmen unmittelbaren Ausführungs-Capability. Ihre spätere explizite Zeitübergabe bleibt beim Effect-/Outcome-Cutover; weder `SpecializedWeaponExecutionAdapter` noch `AutomatedWeaponExecutionAdapter` halten diesen Zustand. |
| **6B / 12A – verbleibende Player-Action-/Frame-Zeitbereinigung** | Die neue `PlayerActionRequest` trägt `hostNowMs` explizit durch Actor-Gate, Slot-Claim und Weapon-Activation; Resource-Drain, Cooldown und Commit erhalten damit keinen Client-Zeitwert. Die älteren optionalen Fallbacks in `LoadoutManager.update`, `getSpeedMultiplier` und `getHeldSelfPushVelocity` sowie die Zeitdefaults in `BurrowSystem.update`, `startWindUp`, `finalizeExit` und `finalizeTunnelTransit` liegen außerhalb des migrierten Weapon1/Weapon2-Requests und bleiben dem Held-/Frame-/Burrow-Cutover zugeordnet. |
| **6B / 12A – verbleibende Player-Action-/Frame-Zeitbereinigung** | `RpcCoordinator.registerHeldActionHandler` löst beim Start genau einen hostseitigen `Date.now()`-Wert auf und reicht ihn über die Player-Gameplay-Grenze weiter. Die älteren optionalen Fallbacks in `LoadoutManager.update`, `getSpeedMultiplier` und `getHeldSelfPushVelocity` sowie die Zeitdefaults in `BurrowSystem.update`, `startWindUp`, `finalizeExit` und `finalizeTunnelTransit` liegen außerhalb des migrierten Requests und bleiben dem Held-/Frame-/Burrow-Cutover zugeordnet. Der lokale `ArenaInputBindings`-Cooldown-/Prediction-Clock bleibt nichtautoritativ. |
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
| `Phase11DependencyCutover.test.ts` | **2A: Held-Action-Assertions auf `invalidateHeldActionsForPlayer` / `invalidateHeldActionsOnActivityEnd` umgestellt** (+ `flow` enthält kein `worldPlayerGameplayRuntime?.systems.heldAction` mehr). Verbleibend: `RpcCoordinator`-Portnamen, Frame-Read-Ports → 6B | 2A ✅ / 6B ✅ |
| `WorldGameplayCompositionContracts.test.ts` | eingefrorene `NetworkBridge`-Consumer-Liste inkl. `src/loadout/LoadoutManager.ts`; neue World-Owner frei von `NetworkBridge`/`ArenaContext`; `new WorldPlayerGameplayRuntime` nur in Composition. **4A: `new WorldWeaponExecutionRuntime` + `worldRuntime.bind(weaponExecution)` in die Owner-/Bind-Liste aufgenommen** | 2A / 4A ✅ / 10B |
| `ArenaFlowCheckpointC.test.ts` | Scene-facing Runtime-Oberfläche frei von `LoadoutManager` u. a.; `getWorldPlayerGameplayRuntime`-Gate des Balance-Lab (2B: `isReady` prüft nur noch Nicht-`null`); kein `new WorldPlayerGameplayRuntime` im Flow. **4A: `new WorldWeaponExecutionRuntime` in die „nicht im Flow"-Liste aufgenommen** | 2A / 2B / 4A ✅ |
| `PlayerWorldRuntimeContracts.test.ts` | **2A: „genau ein Detach-Pfad"-Scan auf `detachPlayerLoadout(` / `detachPlayerBurrow(` umgestellt** (vorher `systems.loadout.removePlayer` / `systems.burrow.removePlayer`) | 2A ✅ |
| **`PlayerGameplayReadViewBoundary.test.ts`** | **neu (2B): friert die verbleibenden externen `WorldPlayerGameplayRuntime.systems`-Consumer ein; prüft die migrierten Read-Call-Sites** – 6A entfernt den Weapon-Action-Leak, 6B entfernt den vollständigen Player-Gameplay-Mutations-Leak aus `ArenaRuntimeAdapters`; der Ratchet bleibt für Composition- und Frame-Consumer aktiv | schrumpft in 3B · 5 · 6A ✅ · 6B ✅ · 11 · 12A · 12B · 12C |
| `DachsOfSteelRockArmorDrop.test.ts` | **2B: Mock `getPlayerGameplayRuntime()` gibt jetzt `getPlayerClassId` statt `{ systems: { playerModifier } }`** | 2B ✅ |
| `TransitionRaceCases.test.ts` | **3A: `lu`-Payload-Destructure-Scan auf `{ …, px, py, wr }` umgestellt** (vorher `…, px, py, ts, wr` – `ts`-Feld entfernt) | 3A ✅ |
| **`WorldWeaponExecutionRuntime.test.ts`** | **neu (4A): Capability-Verdrahtung (Projectile/Hitscan/Melee), Metadaten-Durchreichung, `destroy`-Idempotenz; 4C-Ratchet: `LoadoutManager` baut keinen Executor und enthält keine alten Spezial-Fire-Methoden** | 4A / 4C ✅ |
| **`SpecializedWeaponExecutionAdapter.test.ts`** | **neu (4C): unmittelbare Flamethrower-/Leaf-Blower-/Reinforcement-Matrix-/Energy-Injector-Aufträge, Muzzle-/Source-Metadaten und Abgrenzung zu Shared-/Sustained-Typen** | 4C ✅ |
| `WorldCombatGameplayBinding.test.ts`, `WorldMaterializationOwnership.test.ts`, `CoopMissionRuntimeOwnership.test.ts`, `ActivityRebindingContracts.test.ts` | World-/Combat-/Activity-Ownership-Scans mit `WorldPlayerGameplayRuntime`-Bezug (4B: Turm nutzt `AutomatedWeaponExecution`, Activity-Rebinding erhält die neue World-Boundary) | 11 / 12C |

---

## Test-Migrationskarte

Stand nach Phase 6B. `abgedeckt` = Ist-Semantik ausreichend charakterisiert; `Zielstatus` = was die genannte Phase mit dem Test tun muss.

| Semantik | Test(s) | Ist | Zielstatus |
|---|---|---|---|
| Held Action duplicate-safe / stale / Identity | `HostHeldActionSystem.test.ts` | abgedeckt (6B: duplicate-safe Start bewahrt den ursprünglichen Host-Startzeitpunkt; ungültiger Identity-/Duration-Consume verwirft keine laufende Charge) | geprüft bei 6B ✅ |
| Weapon2 Prediction Retry/Dedupe + authoritative Adrenalin/Revision | `Weapon2PredictionDedupe.test.ts`, `ClientWeaponAdrenalinePrediction.test.ts` | abgedeckt (6B geprüft; Prediction-ID bleibt Network-/Client-Korrelation, autoritativer Adrenalinwert und Revision werden nur vom Host-Ergebnis/Snapshot übernommen) | geprüft bei 6B ✅ |
| Temporary Utility Identity / Charges / Cooldown / Acquisition Order | `TemporaryUtilityLifecycle.test.ts` | abgedeckt | prüfen bei 7A |
| Radial/Held RPC | `RadialActionRpc.test.ts`, `RadialActionInput.test.ts` | abgedeckt (6B: Held-Commands über die World-Player-Gameplay-Grenze; Utility-Activation bleibt fachlich bis 7A im Legacy-Pfad) | geprüft bei 6B ✅ / 7A |
| Shared automated fire + Source-/Owner-Metadaten | `AutomatedPelletWeapon.test.ts`, `InspectorSupportWeapons.test.ts`, `ReinforcementMatrixProjectile.test.ts` + Consumer-Tests (`CoopDefenseVoidHunterSystem`, `CoopDefenseInfernoColossusCombat`, `GraveTitanVoidPlasma`, `CoopDefenseStuckEnemyBite`) | abgedeckt (4B/4C: `AutomatedWeaponExecutionAdapter` delegiert Spezialfälle an die gemeinsame Spezial-Capability; alte Loadout-Fire-Methoden und Activity-Weiterreichungen sind entfernt) | prüfen bei 5 |
| Spezialisierte unmittelbare Fire-Aufträge | `SpecializedWeaponExecutionAdapter.test.ts`, `InspectorSupportWeapons.test.ts`, `ReinforcementMatrixProjectile.test.ts`, `FlamethrowerUpgrades.test.ts`, `ReinforcementMatrixSystem.test.ts` | abgedeckt (4C: benannter Adapter für Flamethrower, Leaf Blower, Reinforcement Matrix und Energy Injector; Muzzle-/Source-Metadaten bleiben im Auftrag) | geprüft bei 6A ✅ / 11B |
| Shared Immediate Execution (Projectile/Hitscan/Melee) | `WeaponFireExecutor.test.ts`, `WorldWeaponExecutionRuntime.test.ts` | abgedeckt (4A/4C: gemeinsame Capability bleibt auf Projectile/Hitscan/Melee begrenzt; Spezialpfade sind separat) | geprüft bei 6A ✅ |
| Weapon-Slot-Exklusivität / Channel-Switch-Deaktivierung | `WeaponSlotExclusivity.test.ts` | abgedeckt | geprüft bei 6A ✅ / 9 |
| Dynamischer Spread / aktiver Slot / Shot Identity | `AimSpreadModelActiveSlot.test.ts`, `ShotPlanResolverRuntimeRegression.test.ts`, `ProjectileSpawnResolver.test.ts` | abgedeckt | geprüft bei 6A ✅ |
| Resource Revision / Adrenalin-Observer / Cost-Modifier | `ResourceSystemObservers.test.ts`, `ResourceSystemExplicitTime.test.ts` | abgedeckt (3B: explizite Zeit, Pause, Regen-Tick, Powerup-Interaktion) | geprüft bei 6A ✅ |
| **`clientX`/`clientY` als Use-Ursprung** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)**; 6A erhält die Semantik über `resolvePlayerActionPosition` unverändert | geprüft bei 6A ✅ |
| **Host-Zeit-Authority der Player-Aktion (Clock-Skew)** | `RadialActionRpc.test.ts` (ein `hostNowMs` je Aktion, geteilt mit Held-Action-Consume), `Weapon2PredictionDedupe.test.ts` (`lu`-Payload-`ts` erreicht den Host-Handler nicht) | **abgedeckt (Phase 3A/6B ✅)** | geprüft bei 6B ✅ |
| **Waffen-Commit-Reihenfolge: Reject → keine Resource-/Cooldown-Mutation; Drain erst nach Dispatch** | `GameplayRuntimeCutoverCharacterization.test.ts` | abgedeckt (3B: mit expliziter Zeit `nowMs` gesichert) | geprüft bei 6A ✅ |
| **Negev-Killstreak-Runtime: Kill-Zahl, Streak-Gap-Ende in `update()`, Abschlussexplosion** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)** | migrieren bei 8B |
| **Shotgun-Lightning: Kill → Queue → `applyAoeDamage` + Broadcast** | `GameplayRuntimeCutoverCharacterization.test.ts` | **neu (Phase 1)** | migrieren bei 8C |
| **Construction-/Management-Cooldown-Keying (pro Spieler/ID bzw. pro Aktion)** | `GameplayRuntimeCutoverCharacterization.test.ts`, `PersistentBaseRepositioning.test.ts`, `PersistentBaseManagementAllClasses.test.ts` | **abgedeckt (Phase 5: World-Construction-Owner, Player-in-World-Lifetime, explizite Host-Zeit)** | geprüft bei 6A ✅ |
| AK47 hit/refund identity (at-most-once, pending-resolve) + Stacks | `Ak47CoopDefenseUpgrades.test.ts` | abgedeckt | migrieren bei 8A |
| Gauss-Ultimate press/release Commit (nur bei Vollladung, at-most-once) | `RoomStatisticsGameplayHooks.test.ts` | abgedeckt | migrieren bei 7C |
| Ultimate buff/airstrike/tunnel Accept-Reject + Rage-Kosten-Zeitpunkt | – | **Lücke** (nur Gauss) | in 7B/7C konkretisieren, dort Test ergänzen |
| Tesla Dome / Energy Shield start/refresh/stop-Orchestrierung | `TeslaDomeSystem.test.ts`, `TeslaDomeCoopDefenseUpgrades.test.ts`, `WeaponSlotExclusivity.test.ts` | teilabgedeckt (System-Ebene) | Orchestrierung in 9 konkretisieren |
| World Player ownership boundary | `WorldGameplayCompositionContracts.test.ts` | Ratchet | migrieren bei 10B |
| Combat integration boundary | `WorldCombatGameplayBinding.test.ts` | Ratchet (AK47-Ziel `Math.random`-flaky) | migrieren bei 11A / 11B |
| Arena source boundaries | `Phase11DependencyCutover.test.ts` (2A: Held-Action ✅), `ArenaFlowCheckpointC.test.ts`, `PlayerGameplayReadViewBoundary.test.ts` (6B: Adapter-Mutations-Leak entfernt) | Ratchet | geprüft bei 6B ✅ |
| **Player-in-World-Lifecycle- und Read-View-Grenze der Runtime** | `WorldPlayerGameplayLifecycle.test.ts` (attach/detach/reconcile/held-invalidation + wiederholte Detach-/Reset-/Destroy-Pfade + Read-Views), `PlayerGameplayReadViewBoundary.test.ts` (`.systems`-Ratchet) | abgedeckt (Correction-Pass ergänzt Idempotenz-Gate) | prüfen bei 12A / 12B |

---

## Bewusste Übergänge / bekannte Regressionen

Aktuell keine offenen Implementierungsübergänge innerhalb der abgeschlossenen Phasen. 2A/2B/3A/3B/4A/4B/4C/5/6A/6B sind Boundary-/Zeit-Moves ohne fachliche Semantikänderung:

- **2A** kapselt die Player-Child-Lifecycle-Schritte (`resource`/`burrow`/`itemRuntime`/`loadout`/`tunnel`/`heldAction`/`playerModifier`) hinter `WorldPlayerGameplayRuntime`-Methoden. Zwei verhaltensneutrale Reorderings: im `detachLoadout`-Pfad läuft `worldPowerUpRuntime.system.removePlayer` jetzt nach `detachPlayerLoadout` (loadout+tunnel); in `syncHostLoadoutsFromCommittedSelections` läuft `resource.reconcilePlayerLimits` jetzt vor `combatSystem.reconcilePlayerRuntimeState`. Beide betreffen unabhängige Map-Löschungen bzw. getrennte Domains.
- **2B** routet die reinen Read-Zugriffe von `ArenaRuntimeAdapters`, `ArenaRuntime`, `RockVisualHelper` und `ArenaLifecycleCoordinator` über die `PlayerGameplayReadViews` derselben Runtime. Die Activity-System-Handoffs und Frame-Reads bleiben bewusst als `.systems.*` und sind im Ratchet `PlayerGameplayReadViewBoundary.test.ts` eingefroren; Weapon1/2 wurden in 6A aus diesem Zugriff herausgelöst, die verbleibenden Adapter-Mutationen in 6B.
- **3A** entfernt den Client-Timestamp (`ts` / `clientNow`) vollständig aus dem `lu`-RPC-Pfad (NetworkBridge-Wire + `LoadoutUseHandler`-Typ, `RpcCoordinator`, `ClientUpdateCoordinator.PredictedWeapon2Request`, `ArenaInputBindings`, `ArenaScene`). `RpcCoordinator.registerLoadoutUseHandler` bestimmt einen einzigen `hostNowMs = Date.now()` je Aktion und teilt ihn zwischen `useLoadout`, `heldActions.consume`, `validateHostUtilityCharge` und `construction.useInspectorUtility`. Verhaltensänderung nur im Missbrauchsfall: der bisherige ±200 ms-Client-Timestamp-Spielraum für Waffe-2-Cooldowns entfällt. Client-Prediction reconciled weiterhin über `weapon2PredictionAck` / `authoritativeAdrenaline`. `clientX`/`clientY` bleiben unverändert.
- **3B** stellt `ResourceSystem.drainAdrenaline(id, amount, nowMs)` und `ResourceSystem.regenTick(id, delta, nowMs)` auf explizite Host-Zeit um und entfernt die internen `Date.now()`-Aufrufe vollständig. `HostUpdateCoordinator` taktet `regenTick`, `burrow.update` und `loadout.update` mit dem Host-Frame-Timestamp `now`. `LoadoutManager.fireWeapon` reicht `now` an `drainAdrenaline` und den Negev-Zustand (`negevState.lastShotAt = now`) durch. Die Loadout-Multiplier-Reads (`getSpeedMultiplier`, `getHeldSelfPushVelocity`, `getDamageMultiplier`, `getAllyAuraMultiplier`, `getWeaponDamageMultiplier`) akzeptieren optional `now` und verwenden keine versteckte Wanduhr mehr bei Durchreichung. `WorldPlayerGameplayRuntime` bindet die Negev-Abschlussexplosion an `event.nowMs`. Item-lokale Readiness verbleibt unverändert bei `BaseWeapon`, `BaseUtility` und `TemporaryUtilityCollection`.
- **4A** zieht die gemeinsame Immediate-Weapon-Execution aus dem `LoadoutManager` heraus: neuer world-composed `WorldWeaponExecutionRuntime` (implementiert `WeaponExecutionCapability`) besitzt den `WeaponFireExecutor` und verdrahtet dessen `WeaponFireSink` einmalig mit `ProjectileManager` + `CombatSystem`. Der `LoadoutManager` baut den Executor nicht mehr selbst, sondern erhält die Capability per `setWeaponExecutionCapability(...)` (gebunden in `WorldPlayerGameplayRuntime.bindLoadout`, geleert im `destroy`) und delegiert seinen Player-Fire unverändert dorthin. Die per-Schuss-Metadaten (`ownerId`, `sourceSlot`, `shotId`, Muzzle-Origins, `sourceTurretId`, Damage-Multiplier, Payload-Metadaten) laufen 1:1 durch. Kein Projectile-/Combat-internes Verhalten geändert.
- **4B** migriert automatische Quellen an eine getrennte world-lokale `AutomatedWeaponExecution`-Boundary. `AutomatedWeaponExecutionAdapter` übernimmt Pellet-/Payload-Skalierung und die spezialisierten Flamethrower-/Leaf-Blower-/Reinforcement-Matrix-/Energy-Injector-/Gauss-Ausführungen; Projectile/Hitscan/Melee laufen über die gemeinsame `WeaponExecutionCapability`. Timing, Readiness, Salven und Host-Autorität bleiben bei Enemy-, Turret- bzw. Support-Ownern. `LoadoutManager` enthält keine `fireAutomatedWeapon`-/`fireAutomatedGaussWeapon`-Methoden mehr.
- **4C** führt `SpecializedWeaponExecutionCapability` mit `SpecializedWeaponExecutionAdapter` für die unmittelbaren Flamethrower-/Leaf-Blower-/Reinforcement-Matrix-/Energy-Injector-Fälle ein. `LoadoutManager` enthält deren Spawn-Logik nicht mehr; Player- und automatische Quellen reichen typed Fire-Aufträge an dieselbe world-composed Capability. Resource/Cooldown/Commit sowie die stateful Flamethrower-/Energy-Injector-Effect-Reaktionen bleiben außerhalb des Adapters.
- **5** verschiebt `constructionCooldowns` und `managementActionCooldowns` aus `LoadoutManager` in `ConstructionReadinessRuntime`, das ausschließlich vom `ConstructionWorldRuntime` besessen wird. Attach/Detach/Reset bleiben an die Player-in-World-Lifetime gebunden; World-Teardown leert den State. `ArenaPersistentBaseSession` erhält nur `ConstructionReadinessPort`, bleibt Owner der persistenten Basisdaten und markiert Reposition explizit mit dem vom Host-RPC gelieferten `hostNowMs`. Placement, Einzel-Rückbau und Repositionierung prüfen und schreiben damit denselben world-owned Readiness-State; die alten Loadout-Methoden und Maps sind entfernt.
- **6A** führt `PlayerActionRuntime` als World-owned Weapon1/Weapon2-Action-Grenze ein. `PlayerActionRequest` trägt Actor, Slot, Aim/Target, optionales Attempt-/Shot-Korrelationsfeld, `hostNowMs`, ability-spezifische Parameter und die explizite Client-Positionspolicy. Actor-/Capability-Gates, Loadout-Auflösung, Slot-Claim samt Channel-Wechsel und der Übergang in `LoadoutManager.activateWeapon` laufen nur noch über `WorldPlayerGameplayRuntime.usePlayerAction`; die bestehende Weapon-Commit-Reihenfolge (Dispatch vor Resource-/Cooldown-Mutation) und die shared/spezialisierte Execution-Capability bleiben unverändert. Utility/Ultimate verwenden bis 7A/7B/7C ausschließlich den benannten Legacy-Pfad.
- **6B** führt die Player-Gameplay-Command-Grenze für Held Actions, Burrow und Resource-Tooling aus `ArenaRuntimeAdapters` ein. `RpcCoordinator` bestimmt beim Held-Start genau einmal die Host-Zeit; `WorldPlayerGameplayRuntime` reicht Start/Cancel/Consume/Clear an den internen `HostHeldActionSystem` weiter, der weiterhin allein den Held-State besitzt. Identische Starts sind idempotent, stale IDs bleiben geschützt und abgelehnte Identity-/Duration-Consumes löschen keine laufende Charge. Die bestehende NetworkBridge-Dedupe-/Prediction-Korrelation sowie autoritativer Adrenalinwert und Revision bleiben unverändert; Utility/Ultimate verwenden bis 7A/7B/7C weiterhin den benannten Legacy-Pfad.

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
| `ConstructionReadinessPort` | `interface ConstructionReadinessPort` und `type ConstructionManagementAction` in `src/world/ConstructionReadinessRuntime.ts`; implementiert von `ConstructionReadinessRuntime` und exponiert durch `ConstructionWorldRuntime`. Der Port umfasst Construction-ID-Cooldowns sowie keyed Management-Aktionen mit explizitem `nowMs`; `ConstructionReadinessRuntime` besitzt beide Maps und deren Player-/World-Lifetime. | 5 |
| `PlayerActionRequest` | `interface PlayerActionRequest` in `src/world/PlayerActionRuntime.ts` with `category: 'weapon'`, `playerId`, `slot`, `angle`, target, explicit `hostNowMs`, optional `attemptId`, `shotId`, ability parameters and `clientPosition`; `PlayerActionRuntime` is world-owned by `WorldPlayerGameplayRuntime` and is exposed through `usePlayerAction`. `resolvePlayerActionPosition` preserves the prior `clientX`/`clientY` fallback to the host actor position. The RPC port uses `usePlayerAction` for Weapon1/Weapon2; `useLoadout` remains only for the legacy Utility/Ultimate path. | 6A |
| `PlayerGameplayActionPort` | `interface PlayerGameplayActionPort` in `src/world/WorldPlayerGameplayRuntime.ts`, implemented by `WorldPlayerGameplayRuntime`. It exposes `usePlayerAction` plus the named host-authoritative mutation boundaries `handleBurrowRequest`, `startHeldAction`, `cancelHeldAction`, `consumeHeldAction` and `clearHeldActionsForPlayer`; the external adapter never traverses `systems.*`. `PlayerGameplayHeldActionIdentity` / `PlayerGameplayHeldActionResult` preserve the existing typed identity and charge result. | 6B |
| `PlayerGameplayResourceCommandPort` | `interface PlayerGameplayResourceCommandPort` in `src/world/WorldPlayerGameplayRuntime.ts`, implemented by `WorldPlayerGameplayRuntime`; Balance-Lab `setAdrenaline` reaches the world-owned `ResourceSystem` only through this named command boundary. | 6B |
| `WeaponExecutionCapability` | `interface WeaponExecutionCapability { fire(config: WeaponConfig, params: WeaponFireParams): boolean }` in `src/loadout/WeaponFireExecutor.ts`; einziger gemeinsamer Vertrag ist `WeaponFireExecutor.fire` (`class WeaponFireExecutor implements WeaponExecutionCapability`). World-composed Owner: `class WorldWeaponExecutionRuntime` (`src/world/WorldWeaponExecutionRuntime.ts`, `WorldScopedBinding`), erzeugt in `ArenaWorldPlayerComposition`, Slot `ArenaWorldGameplay.weaponExecution`. Die getrennten Boundaries `interface SpecializedWeaponExecutionCapability` / `class SpecializedWeaponExecutionAdapter` (4C) und `interface AutomatedWeaponExecution` / `class AutomatedWeaponExecutionAdapter` (4B) in `src/world/` halten Spezial- bzw. automatische Sonderfälle explizit. | 4A / 4B / 4C |
| `PlayerRelationshipPort` | — | — |
| `PlayerCombatIntegrationPort` | — | — |
| `PlayerGameplayFrameStages` | — | — |

---

## Nächster konkreter Schritt

**Teilphase 7A umsetzen – Utility Activation und Temporary Utilities.**

Dabei:

1. Equipped Utility und Temporary Utility über dieselbe Player-Action-Grenze adressieren, ihre Identitäten aber getrennt halten.
2. `TemporaryUtilityCollection` als bestehenden State-Owner weiterverwenden.
3. Utility-Typen nach vorhandenen Execution-/Behavior-Capabilities routen; Construction bleibt eigener Use-Case.
4. Charged Utility mit Held-Action-Identity, hostseitiger Charge und at-most-once Commit migrieren.
5. Charges/Cooldown erst nach erfolgreichem Commit fortschreiben und `instanceId` erhalten.
6. Referenz-§§: `02` §§ 3, 8.1, 9–13, 27–29; Phase-7A-Abschnitt in `03`.
7. Gate: TemporaryUtilityLifecycle, Radial Action Input/RPC, Translocator, Decoy/StinkCloud/TimeBubble/Nuke, Construction/Objective utility tests und TypeScript-Check.

Hinweis für den Gate: Keine Sichtprüfung und kein Browser/Dev-Server; den vollständigen automatisierten Lauf inklusive der bekannten CRLF-Source-Scans und des sporadischen AK47-Flakers ausführen und berührte Flaker isoliert prüfen.

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
