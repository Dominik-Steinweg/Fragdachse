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

- **Aktive Teilphase:** `8B – Negev Behavior` (nächster Schritt)
- **Zuletzt abgeschlossen:** `8A – AK47 Behavior` ✅
- **Gesamtstatus:** Lifecycle-, Read-View-, Action-Zeit-, Resource-/Readiness-Zeit-Grenzen und die world-composed Immediate-Weapon-Execution-Capabilities stehen. Construction-/Management-Readiness liegt im World-Construction-Owner und wird über einen schmalen Port von der Persistent-Base-Session genutzt; Konstruktion, Einzel-Rückbau und Persistent-Base-Repositionierung verwenden explizite Host-Zeit. Gemeinsame Projectile/Hitscan/Melee-Fälle laufen über `WeaponExecutionCapability`; Flamethrower, Leaf Blower, Reinforcement Matrix und Energy Injector über die benannte `SpecializedWeaponExecutionCapability`. Der World-Player-Owner besitzt mit `PlayerActionRuntime` die hostautoritative Weapon1/Weapon2-Action-Grenze, seit 6B die Held-Action-, Burrow- und Resource-Command-Grenze, seit 7A die semantische Utility-Action-Grenze, seit 7C die vollständige Player-Ultimate-Activation-Grenze und seit 8A die zustandsbehaftete AK47-Behavior-Grenze. `PlayerUtilityActionRuntime` ist der Single-Writer für Equipped-Utility-Cooldown/Commit, Temporary-Utility-Identity/Charges und die Utility-Routen; `TemporaryUtilityCollection` bleibt State-Owner für temporäre Instanzen. `PlayerUltimateBehaviorRuntime` besitzt alle Player-Ultimate-Activation-/Charge-/Commit-Pfade sowie Buff-/Aura-/Armageddon-Lifecycle, Rage-Drain, Ticks, Linger und die zugehörigen Active-/Modifier-Reads; Airstrike-Deferred-State bleibt im `WorldSupportGameplayRuntime`, Tunnel-Placement im `ConstructionWorldRuntime` und Gauss-Execution in der world-composed Gauss-Capability. `Ak47BehaviorRuntime` besitzt AK47-Stacks, Fire-Superiority-Schüsse, Shot-Identity, bestätigte Treffer, Strategic-Target-Refunds, Reset und HUD-Projektion; `LoadoutManager` liefert dafür nur Equipment-Konfiguration und delegiert die Shot-Vorbereitung. Objective-Rewards nutzen einen schmalen `TemporaryUtilityPort`, Construction erhält nur seine Placement-Capabilities. Gegner, Türme, Necromancy und Void-Hunter-Gauss behalten ihre automatische Boundary; Timing, Readiness und Autorität bleiben bei ihren jeweiligen Ownern.
- **Letzter verifizierter Repository-Stand:** Teilphase 8A – AK47 Behavior (dieser Commit)
- **Letzter grüner automatisierter 8A-Gate:** Fokussierter Lauf mit **5 Dateien / 43 Tests grün**; danach `npm run check` mit **351 Dateien / 2970 Tests grün**, 15 übersprungen, inklusive TypeScript-Check und grünem Vite-Build.
- **Bekannte Umgebungsflakiness:** Für 8A im vollständigen Check nicht aufgetreten; die Strategic-Target-Auswahl im Integrationstest ist deterministisch abgesichert.
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
| 4C | ✅ | `64407d50d7f43348f4ec4c493a18a41ad4e074c3` | Spezialisierte Immediate-Execution-Adapter |
| 5 | ✅ | `ef83a3c80aa1d7e58859d3642c01adfbf0e24948` | Construction-/Management-Readiness |
| 6A | ✅ | `6dcfb63edd7fdd682ee8804767bf1c30cbabbc8b` | Player Action Runtime + Weapon Activation |
| 6B | ✅ | `b78967526e080c9d358c3c4865aa78dab15c8fab` | RPC/Held/Weapon2-Prediction Cutover |
| 7A | ✅ | `fbe3ee7c2854fdc06644a1f73f8e1cf9c879ef23` | Utility Activation + Temporary Utilities |
| 7B | ✅ | `be2bd944b04ce7d17deb047b2dbe72321c210346` | Buff-/Armageddon-Ultimate Behavior |
| 7C | ✅ | `9c9bed5e24ca685dd4a81b6cf9f3dbfda704abd7` | Airstrike/Tunnel/Gauss Ultimate |
| 8A | ✅ | `Phase-8A-Commit (dieser Commit)` | AK47 Behavior |
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
| `world/WorldPlayerGameplayRuntime.ts` | Owner: baut `systems`, `bindLoadout`, `destroy`-Teardown, `configureResource/Burrow`; **seit 2A einziger Lifecycle-Writer** der Player-Children über `PlayerGameplayLifecyclePort`; seit 7C materialisiert er den vollständigen `PlayerUltimateBehaviorRuntime` und bindet dessen Activation-/Modifier-Reads sowie die world-composed Gauss-Capability; seit 8A materialisiert und lifecycle-bindet er den `Ak47BehaviorRuntime` | Owner/Lifecycle | 2A ✅ / 7B ✅ / 7C ✅ / 8A ✅ |
| `scenes/arena/ArenaWorldPlayerComposition.ts` | `new WorldPlayerGameplayRuntime`, `gameplay.player = …`, `worldRuntime.bind(…)` | Owner-Composition | 2A ✅ |
| `scenes/arena/ArenaLifecycleCoordinator.ts` | Lifecycle in 2A migriert. Reads in 2B migriert (`isBurrowed` → `PlayerGameplayStateReadView`). **Verbleibend:** die Port-Getter `getBurrowSystem/getLoadoutManager/getPlayerModifierSystem/getFlamethrowerUpgradeSystem` und `removeEnemyFromItemRuntime`, die ganze Child-Systeme bzw. eine Enemy-Mutation an die Activity-Composition (`createArenaCoopMissionPorts` / `CoopMissionComposition`) reichen | Lifecycle ✅ / Read ✅ / Activity-Handoff offen | 2A ✅ / 2B ✅ / 4B · 7A · 12C |
| `scenes/arena/ArenaRuntimeAdapters.ts` | Reads in 2B → Read-Views (`isBurrowed`/`isStunned`/`getEquippedUtilityConfig`/`getTemporaryUtilityConfig`/`hasActiveTranslocatorPuck`/`getAdrenaline`/`getAdrenalineRevision`/`getMaxAdrenaline`/`addAdrenaline*Observer`/`getAk47StrategicTargetNetSnapshot`). **6A:** Weapon1/Weapon2 gehen über `WorldPlayerGameplayRuntime.usePlayerAction`; **6B:** Held-Action-Start/Cancel/Consume/Clear, Burrow-Request und Balance-Lab-`setAdrenaline` gehen über benannte Player-Gameplay-Methoden; **7A:** Equipped- und Temporary-Utility gehen über dieselbe Player-Action-Grenze, während Tool-/Objective-Identitäten getrennt bleiben. Kein externer Zugriff auf `systems.*` verbleibt. | Read ✅ / Weapon-Action ✅ / Player-Gameplay-Mutationen ✅ / Utility-Action ✅ | 2B ✅ / 6A ✅ / 6B ✅ / 7A ✅ |
| `scenes/arena/HostUpdateCoordinator.ts` | `playerSystems` = `getPlayerGameplayRuntime()?.systems`; taktet `resource.regenTick`, `burrow.update`, `loadout.update`, `ultimateBehavior.update(delta, now)`, `tunnel.update`, `weaponUpgrade`, `ak47StrategicTarget`, `guardianSpirit`, `repairDrone`, `slimeTrail`, `flamethrowerUpgrade`, `itemRuntime`; Active-Ultimate-/Rage-Tint-/Net-Reads und Gauss-Charge-Reads kommen aus `ultimateBehavior`, AK47-HUD-Buffs und Fire-Superiority-Verfügbarkeit seit 8A aus `ak47Behavior`, die verbleibenden Loadout-Reads bleiben Equipment-/spätere Behavior-Reads | Host-Frame + Read | 7B ✅ / 7C ✅ / 8A ✅ / 12A |
| `scenes/arena/ClientUpdateCoordinator.ts` | `playerSystems`; `loadout.getEquipped*`, `getUltimateThresholds`, AK47-Fire-Superiority-Verfügbarkeit aus `ak47Behavior` mit repliziertem Buff-Fallback, `resource.getAdrenaline`, `burrow.isBurrowed` | Client-Frame Read | 8A ✅ / 12B |
| `scenes/arena/ArenaWorldCombatComposition.ts` | `playerRuntime?.systems.{itemRuntime,flamethrowerUpgrade}` | Combat-Composition (composition-inner, Ratchet-erlaubt) | 11 |
| `scenes/arena/ArenaWorldConstructionComposition.ts` | `gameplay.player?.systems.{playerModifier,tunnel,burrow}` für Construction-internes Composition-Wiring; Temporary-Utility-Akquisition über `gameplay.player?.addTemporaryUtility`, Utility- und Tunnel-Placement über getrennte schmale Capabilities | Construction-Composition | 5 / 7A ✅ / 7C ✅ |
| `scenes/arena/ArenaWorldEnvironmentComposition.ts` | `gameplay.player?.systems.{burrow,translocator}`; Support bindet Airstrike- und Armageddon-Capabilities an den Player-Ultimate-Owner | Support-Composition (composition-inner) | 7C ✅ / 12C |
| `scenes/arena/ArenaRuntime.ts` | 2B: `getTranslocatorActivePuckId`/`getTunnelNetSnapshot` → Read-Views. **Verbleibend:** `itemRuntime.getRemoteControlSnapshot` (Cross-Runtime-Join mit `turret`) | Read ✅ / Snapshot-Join offen | 2B ✅ / 12B |
| `scenes/arena/RockVisualHelper.ts` | 2B: `getClassId` → `getPlayerClassId`-Read-View; `playerSystems`-Getter entfernt | Read ✅ | 2B ✅ |
| `scenes/arena/ArenaPersistentBaseSession.ts` | nutzt `getConstructionReadiness()` für Reposition-Readiness; persistente Basisdaten und Move-Transaktionen bleiben im raumlanglebigen Room-Owner | Readiness-Port ✅ | 5 ✅ |
| `world/WorldCombatGameplayBinding.ts` | konsumiert `WorldPlayerGameplaySystems`-Typ + `getPlayerSystems()?.{loadout,ak47Behavior,playerModifier,burrow}`; bindet AK47-Hit-/Projectile-Resolve-Outcomes an den Behavior-Owner | Combat integration | 8A ✅ / 11A / 11B |

### `LoadoutManager` (direkte Typ-Consumer, nach Consumer-Art)

| Consumer-Art | Consumer (Datei → API) |
|---|---|
| Owner/Lifecycle | `WorldPlayerGameplayRuntime` (`createLoadoutManager`, `bindLoadout`, `destroy` löst alle Setter), `ArenaWorldPlayerComposition` (reicht `createLoadoutManager` und die Gauss-Capability), `ArenaLifecycleCoordinator` (`assignDefaultLoadout`, `syncSelectedLoadout`, `removePlayer`); `PlayerUltimateBehaviorRuntime` besitzt seit 7C den gesamten Player-Ultimate-Activation-State und `Ak47BehaviorRuntime` seit 8A den gesamten AK47-Combat-State; beide werden beim Player-/World-Teardown über die World-Runtime bereinigt |
| Action | Weapon1/Weapon2: `ArenaRuntimeAdapters` → `PlayerLoadoutRpcPort.usePlayerAction` → `WorldPlayerGameplayRuntime.usePlayerAction` → `PlayerActionRuntime`; Equipped Utility, Temporary Utility und Inspector-Utility: derselbe Player-Action-Port → `PlayerUtilityActionRuntime` mit getrennter Source-Identity; Construction bleibt der eigene Use-Case. Ultimate: `RpcCoordinator`/`PlayerLoadoutRpcPort.usePlayerAction` → `WorldPlayerGameplayRuntime.usePlayerAction` → `PlayerUltimateBehaviorRuntime.execute`; Airstrike, Tunnel und Gauss behalten getrennte Support-/Construction-/Execution-Capabilities. RPC bestimmt einen einzigen `hostNowMs`; Ultimate-Commit, Rage-Kosten und Attempt-Dedupe sind hostautoritativ. Weapon2-Antworten werden weiterhin um `worldRevision`/`authoritativeAdrenaline`/`adrenalineRevision` augmentiert; Held Actions, Burrow und Resource-Tooling mutieren ausschließlich über `WorldPlayerGameplayRuntime`-Commands. |
| Read/Presentation | `HostUpdateCoordinator`, `ClientUpdateCoordinator` (`getEquipped{Weapon,Utility,Ultimate}Config`, `ak47Behavior.getHudBuffs`, `ak47Behavior.isFireSuperiorityAvailable`, `getNegevHudBuffs`, `getShieldBuffHudState`, `getCooldownFrac`, `getAimNetState`, `getHeldItemSlot`, Rage-/Threshold-Reads), `PlayerUltimateBehaviorRuntime` (`isUltimateActive`, `getActiveUltimateId`, Gauss-Charge-Reads, Speed-/Damage-Modifier), `ArenaRuntimeAdapters` (`getEquippedUtilityConfig`, `getTemporaryUtilityConfig` über die Player-Read-View), Temporary-Utility-Projektion aus `PlayerUtilityActionRuntime` | Read/Presentation | 7A ✅ / 7B ✅ / 7C ✅ / 8A ✅ / 12A / 12B |
| Combat integration | `CombatSystem` (`setLoadoutManager` → generische Weapon-/Damage-Reads, `setAk47Behavior` → semantische AK47-Hit-/Reset-Outcomes), `WorldCombatGameplayBinding` (`handleKill`, `getEquippedWeaponConfig`, `getDamageMultiplier`, `getSpeedMultiplier`, `Ak47BehaviorRuntime.resolveProjectile` via `projectileManager.setProjectileResolvedCallback`), `HostPhysicsSystem` (`setLoadoutManager`), `Ak47StrategicTargetSystem` (`Ak47LoadoutReadPort`), `FlamethrowerUpgradeSystem` (`resolveUtilityConfig`, `getEquippedWeaponConfig`) | Combat integration | 8A ✅ / 11A / 11B |
| Construction / Persistent Base | `ConstructionWorldRuntime` (`useInspectorUtility`, Tunnel-Placement-Capability und `ConstructionReadinessPort`); Inspector-Utility wird an `PlayerUtilityActionRuntime` delegiert, Construction-/Persistent-Base-Rechte, Tunnel-Placement und Readiness bleiben im Construction-Owner; `ArenaWorldConstructionComposition` nutzt den `TemporaryUtilityPort` | Construction / Persistent Base | 5 / 7A ✅ / 7C ✅ |
| automated actor / Activity | `CoopDefenseEnemyAttackSystem`, `NecromancySystem` und `CoopDefenseVoidHunterSystem` erhalten `AutomatedWeaponExecution`; `CoopMissionComposition` / `CoopMissionEnemyBehaviourComposition` / `CoopMissionEnemySupportComposition` reichen nur diese Automatik-Boundary weiter. `CoopMissionObjectiveComposition` nutzt jetzt ausschließlich den `TemporaryUtilityPort`. | automated actor / Activity | 4B / 7A ✅ |
| Support-/Ultimate-Handler-Wiring | `WorldSupportGameplayRuntime` stellt Airstrike- und Armageddon-Capabilities bereit; `ArenaWorldEnvironmentComposition` bindet sie an `PlayerUltimateBehaviorRuntime`. `ConstructionWorldRuntime` stellt die Tunnel-Placement-Capability bereit. `LoadoutManager` besitzt keine Airstrike-/Tunnel-/Gauss-Setter mehr; Utility-Dispatch-Hooks für Translocator, Decoy, StinkCloud, Nuke und Placement liegen bei den jeweiligen World-/Behavior-Ownern. | Support-/Ultimate-Handler-Wiring | 7A ✅ / 7B ✅ / 7C ✅ |
| network adapter (Legacy) | `LoadoutManager.ts` selbst behält nur seine verbleibenden Weapon-/Ultimate-/Presentation-Bridge-Verträge (`getGameMode`, `isEnemyPair`, `broadcastExplosionEffect`, `broadcastShotFx`); Utility-Cooldown-, Temporary-Utility- und Held-Utility-Publikation liegen bei `PlayerUtilityActionRuntime`. | network adapter (Legacy) | 7A / 10B |
| Typ-/Sibling-only | `types.ts`, `loadout/BaseUltimate.ts`, `loadout/LoadoutRules.ts`, `loadout/ShotPlanResolver.ts`, `loadout/WeaponFireExecutor.ts` |

### Weapon-Dispatch-Cutover nach 6A

`LoadoutManager.use` und `WorldPlayerGameplayRuntime.useLegacyLoadoutAction` sind entfernt. Der produktive Player-Waffenpfad ist `ArenaRuntimeAdapters` → `PlayerLoadoutRpcPort.usePlayerAction` → `WorldPlayerGameplayRuntime.usePlayerAction` → `PlayerActionRuntime` → `LoadoutManager.activateWeapon`; Charakterisierungs- und Slot-Tests verwenden den semantischen Zielpfad bzw. `activateWeapon` direkt. `GameplayRuntimeCorrectionRatchets.test.ts` friert das Fehlen des alten Dispatches ein. Utility und Ultimate committen ausschließlich über ihre benannten Runtime-Owner; Airstrike, Tunnel und Gauss behalten getrennte Support-/Construction-/Execution-Capabilities. Die NetworkBridge bleibt für Weapon2-Prediction-Dedupe und Prediction-ID zuständig.

### Automatisierte und nicht-playergebundene Waffenquellen

4B ist abgeschlossen: `WorldCombatGameplayBinding` (Turm), `CoopDefenseEnemyAttackSystem`, `NecromancySystem` und `CoopDefenseVoidHunterSystem` verwenden keinen automatischen Fire-Service im `LoadoutManager` mehr. Die kleine `AutomatedWeaponExecutionAdapter`-Boundary delegiert Projectile/Hitscan/Melee an die world-composed `WeaponExecutionCapability`, führt die wenigen spezialisierten automatischen Payloads explizit aus und erhält Source-/Owner-/Allegiance-Metadaten. Enemy-/Turret-Cooldowns, Readiness und Salven bleiben in ihren Ownern.

4C ist abgeschlossen: `SpecializedWeaponExecutionAdapter` implementiert die getrennte `SpecializedWeaponExecutionCapability` für Flamethrower, Leaf Blower, Reinforcement Matrix und Energy Injector. Der Player-Loadout delegiert diese unmittelbaren Aufträge ebenso wie der automatische Adapter; der automatische Adapter behält davor seine eigene Pellet-/Damage-Skalierung. Der Adapter besitzt keinen Player-Lifecycle-, Ressourcen-, Cooldown- oder Commit-State und schreibt weiterhin ausschließlich in die bestehende `ProjectileManager`-Senke. NPC-/Activity-Gauss bleibt im automatischen Adapter; Player-Gauss erreicht denselben unmittelbaren Payload über die benannte Ultimate-Capability.

### Construction-/Management-Cooldown-Methoden

Produktiv in `ConstructionWorldRuntime` und `ArenaPersistentBaseSession` nur über den schmalen `ConstructionReadinessPort`. Owner: `ConstructionReadinessRuntime` im World-Construction-Owner; Lifetime bleibt Player-in-World durch Attach/Detach sowie World-Teardown. `LoadoutManager` besitzt weder diese Maps noch die Readiness-Methoden. Phase 5 ✅.

### Temporary-Utility-Methoden

`addTemporaryUtility`: `PlayerUtilityActionRuntime` als World-Owner, aufgerufen über `WorldPlayerGameplayRuntime` aus `ArenaWorldConstructionComposition` und `WorldPowerUpRuntime`. `getTemporaryUtilityConfig`: `WorldPlayerGameplayRuntime`/`PlayerUtilityActionRuntime`, gelesen über `ArenaRuntimeAdapters` und `HostUpdateCoordinator`. `releaseTemporaryUtilityForObjective`: `CoopMissionObjectiveComposition` über `TemporaryUtilityPort`. State-Owner: `TemporaryUtilityCollection`; Utility-Identität bleibt über `instanceId` erhalten. Phase 7A ✅.

### AK47 / Negev / Shotgun

- AK47: `Ak47BehaviorRuntime` besitzt Stacks, Fire-Superiority-Salven, Shot-Identity, bestätigte Treffer, Strategic-Target-Refunds, Reset und HUD-Projektion. `LoadoutManager` liefert nur die ausgerüstete Konfiguration und delegiert Shot-Vorbereitung/Commit über `Ak47BehaviorPort`; `CombatSystem`, `WorldCombatGameplayBinding` und `Ak47StrategicTargetSystem` melden semantische Hit-/Resolve-/Refund-Ergebnisse an denselben Owner. Zielphase 8A ✅.
- Negev: `WorldCombatGameplayBinding.handleKill` → `negevStates`; `update()` → `finishNegevKillstreak` (Streak-Gap `NEGEV_STREAK_GAP_MS`, expliziter Zeitwert aus dem Host-Update; verbleibender Default-Fallback → 8B); `setNegevKillstreakExplosionHandler` (`WorldPlayerGameplayRuntime`); HUD `getNegevHudBuffs`. Zielphase 8B.
- Shotgun: `WorldCombatGameplayBinding.handleKill` → `shotgunLightningQueue`; `processShotgunLightningQueue` in `update()` → `combatSystem.applyAoeDamage` + `bridge.broadcastExplosionEffect`; Chain-Generation. Zielphase 8C.

### Tesla-Dome / Energy-Shield / ShieldBuff Hooks

`WorldCombatGameplayBinding`: `setTeslaDomeSystem`, `setEnergyShieldSystem`, `setShieldBuffSystem`. Nutzung im Core: `activateTeslaDomeWeapon`/`activateEnergyShieldWeapon` aus `fireWeapon`; `deactivateNonAutonomousWeaponEffect` beim Slot-Claim (`claimWeaponSlot`); `hostDeactivateForPlayer` in `assignDefaultLoadout`/`removePlayer`/`destroy`; Speed-Multiplier-Zweige für `energy_shield`/`tesla_dome`. Zielphase 9.

### Zeitmigration nach 3A/3B: abgeschlossen, verbleibende Legacy-Stellen später zugeordnet

Die Zeitmigrationen von 3A und 3B sind im aktuellen Repository-Stand abgeschlossen:

- **3A ✅ (`936e5b87`):** `RpcCoordinator.registerLoadoutUseHandler` nimmt keinen Client-Timestamp (`ts`/`clientNow`) mehr an. Pro Loadout-Use wird ein einziger hostseitiger `hostNowMs` bestimmt und für `useLoadout`, `heldActions.consume`, `validateHostUtilityCharge` und `construction.useInspectorUtility` geteilt. Der `lu`-Wire-Pfad und der Host-Handler tragen damit keine Client-Uhr mehr.
- **3B ✅ (`14a0f04b`):** `ResourceSystem.drainAdrenaline(id, amount, nowMs)` und `ResourceSystem.regenTick(id, delta, nowMs)` erhalten die fachliche Zeit explizit; `HostUpdateCoordinator` reicht den Host-Frame-Zeitstempel an `regenTick`, `burrow.update` und `loadout.update` weiter. `LoadoutManager.fireWeapon` verwendet diesen Zeitwert für Adrenalin-Drain und Negev-Schusszeit, und die Negev-Abschlussexplosion übernimmt `event.nowMs`. Die internen `Date.now()`-Aufrufe des `ResourceSystem` sowie die alte `fireWeapon`-Zeitsetzung und die `bindLoadout`-`sourceId`-Zeitstelle aus der früheren Statusliste sind nicht mehr vorhanden.

Die folgenden Vorkommen sind deshalb **keine offenen 3A/3B-Aufgaben**. Sie bleiben als bewusst verschobene Legacy-Fallbacks bzw. direkt verdrahtete Zeitquellen bestehen und werden ihrer bereits geplanten späteren Fachphase zugeordnet. Die Liste umfasst den Player-Gameplay-/Action-/Behavior-/Integration-Pfad; UI-/Diagnose-Zeit, Netzwerk-Infrastruktur sowie die separat geplanten Projectile-/Combat-Refactorings werden nicht nachträglich 3A/3B zugerechnet.

| Spätere Fachphase | Verbleibende Legacy-Zeitstelle im Stand `Phase 8A` |
|---|---|
| **11B – PlayerCombatIntegration Outcomes/Reactions** | Die in 4C geprüften zeitbehafteten Defaults in `FlamethrowerUpgradeSystem` (`handleEnemyDeath`, `handleNaturalFlameExpiry`) und `EnergyInjectorSystem` gehören zu stateful Payload-/Effect-Reaktionen, nicht zur zustandsarmen unmittelbaren Ausführungs-Capability. Ihre spätere explizite Zeitübergabe bleibt beim Effect-/Outcome-Cutover; weder `SpecializedWeaponExecutionAdapter` noch `AutomatedWeaponExecutionAdapter` halten diesen Zustand. |
| **6B / 12A – verbleibende Player-Action-/Frame-Zeitbereinigung** | Die neue `PlayerActionRequest` trägt `hostNowMs` explizit durch Actor-Gate, Slot-Claim und Weapon-Activation; Resource-Drain, Cooldown und Commit erhalten damit keinen Client-Zeitwert. Die älteren optionalen Fallbacks in `LoadoutManager.update`, `getSpeedMultiplier` und `getHeldSelfPushVelocity` sowie die Zeitdefaults in `BurrowSystem.update`, `startWindUp`, `finalizeExit` und `finalizeTunnelTransit` liegen außerhalb des migrierten Weapon1/Weapon2-Requests und bleiben dem Held-/Frame-/Burrow-Cutover zugeordnet. |
| **6B / 12A – verbleibende Player-Action-/Frame-Zeitbereinigung** | `RpcCoordinator.registerHeldActionHandler` löst beim Start genau einen hostseitigen `Date.now()`-Wert auf und reicht ihn über die Player-Gameplay-Grenze weiter. Die älteren optionalen Fallbacks in `LoadoutManager.update`, `getSpeedMultiplier` und `getHeldSelfPushVelocity` sowie die Zeitdefaults in `BurrowSystem.update`, `startWindUp`, `finalizeExit` und `finalizeTunnelTransit` liegen außerhalb des migrierten Requests und bleiben dem Held-/Frame-/Burrow-Cutover zugeordnet. Der lokale `ArenaInputBindings`-Cooldown-/Prediction-Clock bleibt nichtautoritativ. |
| **7B – Buff-/Armageddon-Ultimate Behavior** | erledigt: `PlayerUltimateBehaviorRuntime.update(deltaMs, nowMs)` erhält die Host-Zeit explizit für Rage-Drain, Buff-/Aura-Ticks und Linger; `LoadoutManager.update()` taktet nur noch verbleibende Weapon-Reaktionen. Buff-/Aura-Modifier-Reads laufen über den Behavior-Owner. |
| **7C – Airstrike/Tunnel/Gauss Ultimate** | erledigt: `AirstrikeSystem` erhält `armedAt` explizit vom Support-/Ultimate-Owner, `TunnelSystem` erhält die explizite Transit-Endzeit und `PlayerUltimateBehaviorRuntime` besitzt Gauss-Charge/Release, Rage-/Stat-Commit sowie die Host-Zeit. `InputSystem` hält nur die lokale nichtautoritative Gauss-Anzeige; `CoopDefenseVoidHunterSystem.notifyNukeExploded` bleibt ein automatischer Nicht-Player-Fallback außerhalb dieser Player-Ultimate-Phase. |
| **8A – AK47 Behavior** | erledigt: `Ak47BehaviorRuntime` besitzt den AK47-State; Strategic-Target-Hit und Combat-Hit erhalten die Host-Frame-Zeit explizit, der Projectile-Resolve ist ein clock-freies semantisches Outcome. `LoadoutManager` und `Ak47StrategicTargetSystem` enthalten keine AK47-bezogenen `Date.now()`-Fallbacks mehr. |
| **8B – Negev Behavior** | Der Negev-Zweig in `LoadoutManager.update()` nutzt den bereits übergebenen Zeitwert für das Streak-Gap, aber `finishNegevKillstreak` hat noch einen `Date.now()`-Default. Der tatsächliche Fire-Zeitpunkt (`negevState.lastShotAt`) ist dagegen seit 3B explizit und bleibt abgeschlossen. |
| **9 – Tesla Dome / Energy Shield Behavior** | `LoadoutManager.getShieldBuffHudState` besitzt noch einen `Date.now()`-Default. Der Shield-/Dome-Anteil von `getSpeedMultiplier` und die dazugehörigen zeitabhängigen Reads werden mit der geplanten Sustained-Behavior-Grenze bereinigt. |
| **11A/11B – PlayerCombatIntegration** | `LoadoutManager.getDamageMultiplier`/`getWeaponDamageMultiplier` haben noch `Date.now()`-Defaults; `CombatSystem` übergibt an mehreren Legacy-Damage-Pfaden direkt `Date.now()`. Die Zuordnung gehört zur späteren Player-Combat-Integration für Modifier-Reads bzw. Hit-/Outcome-Reaktionen. Die verbleibenden zeitbehafteten Defaults in `CoopDefenseItemRuntimeSystem` sowie die direkten Zeitübergaben aus `ArenaWorldPlayerComposition`, `ArenaWorldCombatComposition` und `WorldCombatGameplayBinding` werden dort fachlich mitgeführt. |
| **12A/12B – Host-/Client-Frame und stabile Reads** | `LoadoutManager.getHeldItemSlot` hat noch einen `Date.now()`-Default, obwohl der Host-Frame ihn bereits mit `now` aufruft; die Bereinigung gehört zur stabilen Held-Item-/HUD-Read-Grenze in 12B. Die verbleibenden Frame-Caller, die Legacy-Systeme direkt mit `Date.now()` takten, werden im Stage-/Read-Cutover bewertet. |
| **separates Projectile-/Combat-Refactoring nach dem ersten Cutover** | Verbleibende fachliche Zeitstellen innerhalb von `ProjectileManager`/`CombatSystem` und deren unteren Interaktionspfaden sind nicht Teil von 3A/3B und werden nicht vorgezogen. Sie bleiben dem später geplanten Projectile- bzw. Combat-Runtime-Refactoring zugeordnet. |

### `clientX` / `clientY` im Player-Action-Use-Pfad

`RpcCoordinator.registerLoadoutUseHandler` liest `clientX`/`clientY` aus dem Wire und reicht sie für Weapon- und Utility-`PlayerActionRequest` an die benannte Positionspolicy weiter (der Client-Timestamp `ts`/`clientNow` wurde in 3A **entfernt**). Für Inspector-Utilities verwendet die Utility-Boundary die autoritative Spielerposition; normale Equipped-/Temporary-Utilities behalten den bisherigen Client-Positionsursprung. Positions- und Zeit-Authority sind getrennte Entscheidungen (3A ≠ 6A).

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

Stand nach Teilphase 8A.

| Semantik | Test(s) | Ist | Zielstatus |
|---|---|---|---|
| Held Action duplicate-safe / stale / Identity | `HostHeldActionSystem.test.ts` | abgedeckt (6B: duplicate-safe Start bewahrt den ursprünglichen Host-Startzeitpunkt; ungültiger Identity-/Duration-Consume verwirft keine laufende Charge) | geprüft bei 6B ✅ |
| Weapon2 Prediction Retry/Dedupe + authoritative Adrenalin/Revision | `Weapon2PredictionDedupe.test.ts`, `ClientWeaponAdrenalinePrediction.test.ts` | abgedeckt (6B geprüft; Prediction-ID bleibt Network-/Client-Korrelation, autoritativer Adrenalinwert und Revision werden nur vom Host-Ergebnis/Snapshot übernommen) | geprüft bei 6B ✅ |
| Temporary Utility Identity / Charges / Cooldown / Acquisition Order | `TemporaryUtilityLifecycle.test.ts`, `CoopDefenseObjectivePlacementReward.test.ts` | abgedeckt (7A: World-owned `PlayerUtilityActionRuntime`, `TemporaryUtilityCollection` als State-Owner, `instanceId`-Identität, Commit-vor-Charge/Cooldown und Objective-Provenienz) | geprüft bei 7A ✅ |
| Radial/Held RPC | `RadialActionRpc.test.ts`, `RadialActionInput.test.ts` | abgedeckt (7A: Utility-Activation über `PlayerActionRuntime`/`PlayerUtilityActionRuntime`; Held-Action-Identity und hostseitige Charge bleiben im World-Owner) | geprüft bei 7A ✅ |
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
| AK47 Focus-/Fire-Superiority-Stacks, Hit-/Refund-Identity (at-most-once), Pending-Resolve, Strategic Target und HUD | `Ak47CoopDefenseUpgrades.test.ts`, `WorldCombatGameplayBinding.test.ts`, `ProjectileTargetPiercing.test.ts`, `WorldPlayerGameplayLifecycle.test.ts` | abgedeckt (8A: `Ak47BehaviorRuntime` als State-Owner, deterministischer Strategic-Target-Binding-Test, Lifecycle-Reset/Remove/Destroy) | geprüft bei 8A ✅ |
| Gauss-Ultimate press/release/cancel Commit (nur bei Vollladung, at-most-once) | `RoomStatisticsGameplayHooks.test.ts`, `PlayerUltimateBehaviorRuntime.test.ts`, `GameplayRuntimeCorrectionRatchets.test.ts` | abgedeckt (Correction-Pass: expliziter Cancel, stabile `gaussChargeId` getrennt von `attemptId`, Host-Startzeit, stale A/B-Schutz, Reset-/Detach-Tombstones, bounded per-player History und Client-Reconciliation) | geprüft im Correction-Pass ✅ |
| Equipped-Utility-Sync bei Equipmentwechsel / No-op | `TemporaryUtilityLifecycle.test.ts` | abgedeckt (neue Utility startet bereit; vorheriger Cooldown wird nicht übertragen; No-op publiziert keine unnötige Temporary-Utility-Projektion) | geprüft im Correction-Pass ✅ |
| Single weapon dispatch path nach 6A | `GameplayRuntimeCorrectionRatchets.test.ts`, `GameplayRuntimeCutoverCharacterization.test.ts`, `WeaponSlotExclusivity.test.ts` | Ratchet und Tests abgedeckt (`LoadoutManager.use` sowie `useLegacyLoadoutAction` entfernt; semantisches `activateWeapon` bleibt) | geprüft im Correction-Pass ✅ |
| Buff-/Armageddon-Ultimate Accept-Reject, Commit, Rage-Drain, Ticks, Linger und Teardown | `PlayerUltimateBehaviorRuntime.test.ts`, `WorldPlayerGameplayLifecycle.test.ts` | abgedeckt (7B: duplicate-safe Buff-Commit, Armageddon-Capability, Rage-Drain, Armor-/Aura-Ticks, Linger sowie Player-/World-Teardown) | geprüft bei 7B ✅ |
| Airstrike-/Tunnel-Ultimate Accept-Reject + Rage-Kosten-Zeitpunkt | `PlayerUltimateBehaviorRuntime.test.ts` | abgedeckt (7C: Support-/Construction-Capability, Reject ohne Rage-Verbrauch, at-most-once Commit) | geprüft bei 7C ✅ |
| Tesla Dome / Energy Shield start/refresh/stop-Orchestrierung | `TeslaDomeSystem.test.ts`, `TeslaDomeCoopDefenseUpgrades.test.ts`, `WeaponSlotExclusivity.test.ts` | teilabgedeckt (System-Ebene) | Orchestrierung in 9 konkretisieren |
| World Player ownership boundary | `WorldGameplayCompositionContracts.test.ts` | Ratchet | migrieren bei 10B |
| Combat integration boundary | `WorldCombatGameplayBinding.test.ts` | Ratchet (AK47-Hit-/Resolve-Binding an `Ak47BehaviorRuntime`) | geprüft bei 8A ✅ / migrieren bei 11A / 11B |
| Arena source boundaries | `Phase11DependencyCutover.test.ts`, `ArenaFlowCheckpointC.test.ts`, `PlayerGameplayReadViewBoundary.test.ts` | Ratchet: Utility-/Temporary-Utility-Dispatch liegt nicht mehr in `LoadoutManager`; Composition- und Frame-Consumer bleiben bewusst als nächste spätere Boundary-Phasen markiert | geprüft bei 7A ✅
| **Player-in-World-Lifecycle- und Read-View-Grenze der Runtime** | `WorldPlayerGameplayLifecycle.test.ts` (attach/detach/reconcile/held-invalidation + wiederholte Detach-/Reset-/Destroy-Pfade + Read-Views), `PlayerGameplayReadViewBoundary.test.ts` (`.systems`-Ratchet) | abgedeckt (Correction-Pass ergänzt Idempotenz-Gate) | prüfen bei 12A / 12B |

---

## Bewusste Übergänge / bekannte Regressionen

Aktuell keine offenen Implementierungsübergänge innerhalb der abgeschlossenen Phasen. 2A/2B/3A/3B/4A/4B/4C/5/6A/6B/7A/7B/7C/8A bleiben abgeschlossen, und die nächste offene fachliche Transition ist 8B.

- **Gameplay-Runtime-Correction-Pass 1–7C:** Gauss besitzt einen hostautoritativen Press-/Release-/Cancel-Lifecycle mit stabiler Charge-Identity, getrenntem Commit-Attempt, stale-sicheren Tombstones, Cleanup bei Reset/Detach und Ergebnis-Reconciliation im Client. Invalid Attempt-IDs werden vor Mutation verworfen; retriable Commit-Historien bleiben pro Spieler bounded.
- **Equipment- und Dispatch-Korrekturen:** Ein tatsächlicher Utility-Wechsel übernimmt keinen alten Cooldown; ein No-op-Sync publiziert keine unnötige Projektion. Der alte slotförmige Weapon-Dispatch ist entfernt und durch den semantischen `activateWeapon`-/`PlayerActionRuntime`-Pfad ersetzt.

- **2A** kapselt die Player-Child-Lifecycle-Schritte (`resource`/`burrow`/`itemRuntime`/`loadout`/`tunnel`/`heldAction`/`playerModifier`) hinter `WorldPlayerGameplayRuntime`-Methoden. Zwei verhaltensneutrale Reorderings: im `detachLoadout`-Pfad läuft `worldPowerUpRuntime.system.removePlayer` jetzt nach `detachPlayerLoadout` (loadout+tunnel); in `syncHostLoadoutsFromCommittedSelections` läuft `resource.reconcilePlayerLimits` jetzt vor `combatSystem.reconcilePlayerRuntimeState`. Beide betreffen unabhängige Map-Löschungen bzw. getrennte Domains.
- **2B** routet die reinen Read-Zugriffe von `ArenaRuntimeAdapters`, `ArenaRuntime`, `RockVisualHelper` und `ArenaLifecycleCoordinator` über die `PlayerGameplayReadViews` derselben Runtime. Die Activity-System-Handoffs und Frame-Reads bleiben bewusst als `.systems.*` und sind im Ratchet `PlayerGameplayReadViewBoundary.test.ts` eingefroren; Weapon1/2 wurden in 6A aus diesem Zugriff herausgelöst, die verbleibenden Adapter-Mutationen in 6B.
- **3A** entfernt den Client-Timestamp (`ts` / `clientNow`) vollständig aus dem `lu`-RPC-Pfad (NetworkBridge-Wire + `LoadoutUseHandler`-Typ, `RpcCoordinator`, `ClientUpdateCoordinator.PredictedWeapon2Request`, `ArenaInputBindings`, `ArenaScene`). `RpcCoordinator.registerLoadoutUseHandler` bestimmt einen einzigen `hostNowMs = Date.now()` je Aktion und teilt ihn zwischen `useLoadout`, `heldActions.consume`, `validateHostUtilityCharge` und `construction.useInspectorUtility`. Verhaltensänderung nur im Missbrauchsfall: der bisherige ±200 ms-Client-Timestamp-Spielraum für Waffe-2-Cooldowns entfällt. Client-Prediction reconciled weiterhin über `weapon2PredictionAck` / `authoritativeAdrenaline`. `clientX`/`clientY` bleiben unverändert.
- **3B** stellt `ResourceSystem.drainAdrenaline(id, amount, nowMs)` und `ResourceSystem.regenTick(id, delta, nowMs)` auf explizite Host-Zeit um und entfernt die internen `Date.now()`-Aufrufe vollständig. `HostUpdateCoordinator` taktet `regenTick`, `burrow.update` und `loadout.update` mit dem Host-Frame-Timestamp `now`. `LoadoutManager.fireWeapon` reicht `now` an `drainAdrenaline` und den Negev-Zustand (`negevState.lastShotAt = now`) durch. Die Loadout-Multiplier-Reads (`getSpeedMultiplier`, `getHeldSelfPushVelocity`, `getDamageMultiplier`, `getAllyAuraMultiplier`, `getWeaponDamageMultiplier`) akzeptieren optional `now` und verwenden keine versteckte Wanduhr mehr bei Durchreichung. `WorldPlayerGameplayRuntime` bindet die Negev-Abschlussexplosion an `event.nowMs`. Item-lokale Readiness verbleibt unverändert bei `BaseWeapon`, `BaseUtility` und `TemporaryUtilityCollection`.
- **4A** zieht die gemeinsame Immediate-Weapon-Execution aus dem `LoadoutManager` heraus: neuer world-composed `WorldWeaponExecutionRuntime` (implementiert `WeaponExecutionCapability`) besitzt den `WeaponFireExecutor` und verdrahtet dessen `WeaponFireSink` einmalig mit `ProjectileManager` + `CombatSystem`. Der `LoadoutManager` baut den Executor nicht mehr selbst, sondern erhält die Capability per `setWeaponExecutionCapability(...)` (gebunden in `WorldPlayerGameplayRuntime.bindLoadout`, geleert im `destroy`) und delegiert seinen Player-Fire unverändert dorthin. Die per-Schuss-Metadaten (`ownerId`, `sourceSlot`, `shotId`, Muzzle-Origins, `sourceTurretId`, Damage-Multiplier, Payload-Metadaten) laufen 1:1 durch. Kein Projectile-/Combat-internes Verhalten geändert.
- **4B** migriert automatische Quellen an eine getrennte world-lokale `AutomatedWeaponExecution`-Boundary. `AutomatedWeaponExecutionAdapter` übernimmt Pellet-/Payload-Skalierung und die spezialisierten Flamethrower-/Leaf-Blower-/Reinforcement-Matrix-/Energy-Injector-/Gauss-Ausführungen; Projectile/Hitscan/Melee laufen über die gemeinsame `WeaponExecutionCapability`. Timing, Readiness, Salven und Host-Autorität bleiben bei Enemy-, Turret- bzw. Support-Ownern. `LoadoutManager` enthält keine `fireAutomatedWeapon`-/`fireAutomatedGaussWeapon`-Methoden mehr.
- **4C** führt `SpecializedWeaponExecutionCapability` mit `SpecializedWeaponExecutionAdapter` für die unmittelbaren Flamethrower-/Leaf-Blower-/Reinforcement-Matrix-/Energy-Injector-Fälle ein. `LoadoutManager` enthält deren Spawn-Logik nicht mehr; Player- und automatische Quellen reichen typed Fire-Aufträge an dieselbe world-composed Capability. Resource/Cooldown/Commit sowie die stateful Flamethrower-/Energy-Injector-Effect-Reaktionen bleiben außerhalb des Adapters.
- **5** verschiebt `constructionCooldowns` und `managementActionCooldowns` aus `LoadoutManager` in `ConstructionReadinessRuntime`, das ausschließlich vom `ConstructionWorldRuntime` besessen wird. Attach/Detach/Reset bleiben an die Player-in-World-Lifetime gebunden; World-Teardown leert den State. `ArenaPersistentBaseSession` erhält nur `ConstructionReadinessPort`, bleibt Owner der persistenten Basisdaten und markiert Reposition explizit mit dem vom Host-RPC gelieferten `hostNowMs`. Placement, Einzel-Rückbau und Repositionierung prüfen und schreiben damit denselben world-owned Readiness-State; die alten Loadout-Methoden und Maps sind entfernt.
- **6A** führt `PlayerActionRuntime` als World-owned Weapon1/Weapon2-Action-Grenze ein. `PlayerActionRequest` trägt Actor, Slot, Aim/Target, optionales Attempt-/Shot-Korrelationsfeld, `hostNowMs`, ability-spezifische Parameter und die explizite Client-Positionspolicy. Actor-/Capability-Gates, Loadout-Auflösung, Slot-Claim samt Channel-Wechsel und der Übergang in `LoadoutManager.activateWeapon` laufen nur noch über `WorldPlayerGameplayRuntime.usePlayerAction`; die bestehende Weapon-Commit-Reihenfolge (Dispatch vor Resource-/Cooldown-Mutation) und die shared/spezialisierte Execution-Capability bleiben unverändert. Utility und Nicht-Buff-Ultimates bleiben bis zu ihren dedizierten Phasen über die benannten Übergangspfade erreichbar.
- **6B** führt die Player-Gameplay-Command-Grenze für Held Actions, Burrow und Resource-Tooling aus `ArenaRuntimeAdapters` ein. `RpcCoordinator` bestimmt beim Held-Start genau einmal die Host-Zeit; `WorldPlayerGameplayRuntime` reicht Start/Cancel/Consume/Clear an den internen `HostHeldActionSystem` weiter, der weiterhin allein den Held-State besitzt. Identische Starts sind idempotent, stale IDs bleiben geschützt und abgelehnte Identity-/Duration-Consumes löschen keine laufende Charge. Die bestehende NetworkBridge-Dedupe-/Prediction-Korrelation sowie autoritativer Adrenalinwert und Revision bleiben unverändert; Utility und Nicht-Buff-Ultimates bleiben bis zu ihren dedizierten Phasen über die benannten Übergangspfade erreichbar.
- **7A** verschiebt die Utility-Aktivierung aus `LoadoutManager` in `PlayerUtilityActionRuntime` unter demselben `PlayerActionRequest`-Boundary wie Weapon1/Weapon2. Equipped-, Temporary- und Inspector-Utilities bleiben über getrennte Source-Identities adressiert; `TemporaryUtilityCollection` besitzt weiterhin die temporären Instanzen. Held-Action-Charge wird hostseitig über die passende Identity validiert, und Utility-Commit, Cooldown/Charges sowie Utility-Publikation schreiben erst nach erfolgreichem Dispatch. Objective-Rewards nutzen `TemporaryUtilityPort`; Construction bleibt ein eigener Use-Case mit Placement-Capability.
- **7C** verschiebt Airstrike-, Tunnel- und Gauss-Aktivierung aus `LoadoutManager` in `PlayerUltimateBehaviorRuntime`. Der Ultimate-Owner besitzt Charge-/Attempt-State, hostzeitautoritatives Gauss-Release, Rage-/Stat-Commit und Teardown; `WorldSupportGameplayRuntime` besitzt deferred Airstrike-Lifetime, `ConstructionWorldRuntime` besitzt Tunnel-Placement und die world-composed Gauss-Capability besitzt unmittelbare Execution. `AirstrikeSystem` erhält die explizite Arming-Zeit vom Host-Owner, `TunnelSystem` nutzt die explizite Transit-Endzeit, `RpcCoordinator` routet alle Ultimates über `PlayerLoadoutRpcPort.usePlayerAction`, und die alten Loadout-Setter/Ultimate-Methoden sind entfernt.
- **8A** verschiebt den gesamten veränderlichen AK47-Focus-/Fire-Superiority-State aus `LoadoutManager` in `Ak47BehaviorRuntime`. Der Behavior-Owner erzeugt Shot-Identity und abgeleitete Fire-Superiority-Payloads, führt bestätigte Treffer, Pending-Resolve und Strategic-Target-Refunds duplicate-safe, projiziert die AK47-HUD-Buffs und wird über Player-Lifecycle, Combat, Projectile-Resolve und Host-/Client-Reads gebunden. `Ak47StrategicTargetSystem` liest nur über `Ak47LoadoutReadPort` und meldet den semantischen Target-Hit an `Ak47BehaviorPort`; die bestehende Projectile-Payload bleibt unverändert.

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
| `PlayerActionRequest` | `interface PlayerWeaponActionRequest`, `interface PlayerUtilityActionRequest` und `interface PlayerUltimateActionRequest` in `src/world/PlayerActionRuntime.ts`, zusammengeführt als `PlayerActionRequest`-Union mit `category: 'weapon' | 'utility' | 'ultimate'`; `PlayerActionRuntime` bleibt die Weapon-Grenze, `PlayerUtilityActionRuntime` die Utility-Grenze und `PlayerUltimateBehaviorRuntime` die vollständige Ultimate-Grenze unter demselben `WorldPlayerGameplayRuntime.usePlayerAction`-Port. Explizite `hostNowMs`-Zeit, die bisherige Client-Positionspolicy und die gemeinsame optionale Attempt-ID-Validierung bleiben erhalten. | 6A / 7A / 7B / 7C / Correction-Pass |
| `PlayerGameplayActionPort` | `interface PlayerGameplayActionPort` in `src/world/WorldPlayerGameplayRuntime.ts`, implementiert von `WorldPlayerGameplayRuntime`. Es exponiert `usePlayerAction` sowie die hostautoritativen Commands für Weapon/Utility, Held Actions, Burrow und Resource-Tooling; externe Adapter traversieren nicht `systems.*`. `PlayerGameplayHeldActionIdentity` / `PlayerGameplayHeldActionResult` bleiben typed. | 6B / 7A |
| `TemporaryUtilityPort` | `interface TemporaryUtilityPort` in `src/world/PlayerUtilityActionRuntime.ts`, implementiert durch `PlayerUtilityActionRuntime` und über `WorldPlayerGameplayRuntime` exponiert. `addTemporaryUtility`/`releaseTemporaryUtilityForObjective` verwenden `TemporaryUtilityCollection` als State-Owner; Temporary-Utility-`instanceId`, Objective-Provenienz, Charges und Cooldown bleiben in derselben World-Lifetime. | 7A |
| `PlayerGameplayResourceCommandPort` | `interface PlayerGameplayResourceCommandPort` in `src/world/WorldPlayerGameplayRuntime.ts`, implemented by `WorldPlayerGameplayRuntime`; Balance-Lab `setAdrenaline` reaches the world-owned `ResourceSystem` only through this named command boundary. | 6B |
| `PlayerUltimateBehaviorRuntime` | `class PlayerUltimateBehaviorRuntime` in `src/world/PlayerUltimateBehaviorRuntime.ts`; besitzt Buff-/Aura-/Armageddon-State, Airstrike-/Tunnel-Activation, Gauss-Charge-/Release-/Cancel-State mit separater Charge-Identity und hostseitiger Startzeit, bounded per-player Commit-History/Tombstones, duplicate-safe Commit-/Press-Handling, Rage-Drain, Armor-/Aura-Ticks, Linger, Active-/Modifier-/Charge-Reads sowie Player-/World-Teardown. Die benannten `PlayerUltimateAirstrikeCapability`, `PlayerUltimateTunnelPlacementCapability` und `PlayerUltimateGaussExecutionCapability` werden an der World-Composition-Grenze aus Support, Construction und der world-composed Execution gebunden; `LoadoutManager` konsumiert nur die read-only `UltimateModifierReadPort` und bleibt Equipment-/Weapon-Owner. | 7B / 7C / Correction-Pass |
| `Ak47BehaviorPort` | `interface Ak47BehaviorPort` und `interface Ak47LoadoutReadPort` in `src/loadout/Ak47BehaviorPort.ts`; `Ak47BehaviorRuntime` in `src/world/Ak47BehaviorRuntime.ts` besitzt den veränderlichen AK47-Focus-/Fire-Superiority-State, Shot-Identity, Hit-/Resolve-/Refund-Semantik, HUD-Reads und Player-/World-Teardown. `LoadoutManager` konsumiert die schmale Behavior-Grenze nur für Shot-Vorbereitung und Commit; `Ak47StrategicTargetSystem`, `CombatSystem` und `WorldCombatGameplayBinding` erhalten keine konkrete State-Implementierung. | 8A |
| `WeaponExecutionCapability` | `interface WeaponExecutionCapability { fire(config: WeaponConfig, params: WeaponFireParams): boolean }` in `src/loadout/WeaponFireExecutor.ts`; einziger gemeinsamer Vertrag ist `WeaponFireExecutor.fire` (`class WeaponFireExecutor implements WeaponExecutionCapability`). World-composed Owner: `class WorldWeaponExecutionRuntime` (`src/world/WorldWeaponExecutionRuntime.ts`, `WorldScopedBinding`), erzeugt in `ArenaWorldPlayerComposition`, Slot `ArenaWorldGameplay.weaponExecution`. Die getrennten Boundaries `interface SpecializedWeaponExecutionCapability` / `class SpecializedWeaponExecutionAdapter` (4C) und `interface AutomatedWeaponExecution` / `class AutomatedWeaponExecutionAdapter` (4B) in `src/world/` halten Spezial- bzw. automatische Sonderfälle explizit. | 4A / 4B / 4C |
| `PlayerRelationshipPort` | — | — |
| `PlayerCombatIntegrationPort` | — | — |
| `PlayerGameplayFrameStages` | — | — |

---

## Nächster konkreter Schritt

**Teilphase 8B umsetzen – Negev Behavior extrahieren.**

Dabei:

1. Negev-Killstreak-State, Streak-Gap, Abschlussexplosion und Reset in einen eigenen Weapon-Behavior-Owner verschieben.
2. `LoadoutManager` auf Equipment-/Shot-Delegation für den Negev reduzieren.
3. Kill-/Update-/HUD-Callbacks als semantische Outcomes an den Behavior-Owner melden; explizite Host-Zeit und bestehende Explosion-Semantik erhalten.
4. Referenz: Phase-8B-Abschnitt in `03`.
5. Gate: Negev-Killstreak-, Streak-Gap-, Abschlussexplosions-, HUD- und TypeScript-Checks.

Hinweis für den Gate: Keine Sichtprüfung und kein Browser/Dev-Server; nur die vorgesehenen automatisierten Checks ausführen.

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
