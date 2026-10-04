# Fragdachse overnight audit — 2026-10-04

## Scope and working record

- Request: at least five, preferably eight hours of active investigation, small evidenced fixes, removal of proven dead code, tests and a final review. No merge or deployment.
- Start: 2026-10-04 21:57:48 UTC (23:57:48 Europe/Berlin).
- Base: `e095537bdcafcfb2216e6ade33df3c8ed221512e` (`main`).
- Branch: `codex/overnight-audit-2026-10-04`.
- Worktree: `C:/Users/domin/.codex/worktrees/overnight-audit-2026-10-04/Fragdachse`.
- Dependencies: the existing main-checkout `node_modules` is linked into this worktree; no dependency or lockfile changes requested.
- Existing untracked asset scripts in the main checkout are unrelated and untouched.
- Active elapsed time is recorded as wall-clock investigation/implementation/verification time, without multiplying parallel-agent time. Deliberate waits and external interruptions are excluded. The requested minimum is not yet achieved.

## Coverage ledger

| Area | Status | Evidence / next action |
| --- | --- | --- |
| Repository contracts and verification policy | Read | `AGENTS.md`, `docs/ai/index.md`, architecture principles, architecture, networking, gameplay and testing contracts |
| World / Activity / Round lifecycle | Initial pass complete | WorldLifecycle/ActivityLifecycle identity vs runtime; WorldRuntime/ActivityRuntimeHost ownership; generation/retry/render/terrain cancellation; readiness/admission; player attach/detach; train timers; boot preparation and async Scene imports. A03 fixed. |
| Peer transport | Second pass reviewed | Authority, handshake admission, delayed state after leave, reconnect grace and identity reuse checked and fixed. Packet framing/send queues read; pending-open cancellation and queued-handshake rejection fixed (A10). |
| Network state contracts | Initial pass complete | World/Activity mismatch rejection; participation reset; full-bootstrap keys; omitted/empty deltas; projectile static cache; rock tombstone recovery; enemy refresh/status/teleports; host-clock expiry. A05–A07 fixed. |
| Host RPC action validation | Initial pass complete | World revision and actor identity; authoritative origin/time; capability checks for actions, held actions, construction and pickups. Malformed aim and forged host events fixed. |
| Core / architecture / build baseline | Passed | `npm run check`: 535 Core files / 4,969 tests; 6 Architecture files / 54 tests; game, map editor and balance editor builds |
| Persistent base and local saves | Second pass complete; one open finding | Transaction rollback, outcome idempotency, dormant blueprints, owner leave/rejoin, capacity/priority, atomic decode and runtime-field stripping checked. Confirmed live-session save replacement bug remains open; async import/reset permission gates fixed. |
| Authored loadouts and settings | Second pass reviewed | Inherited registry keys and projectile-field type validation fixed. Item UID collisions, reward claims, class/construction positive lists and device-settings normalization checked. Cross-host progression dedupe fixed with existing round identities. |
| Projectile / Combat lifetimes | Second pass reviewed | Proximity pulses after release, mini-rocket safety expiry bypass and abandoned translocator puck expiry fixed. CombatScope/Vitals/WorldCombat/Resolution, primary hit reward, burn, chain lightning, plasma stacks and continuation paths traced. |
| UI / audio / input | In progress | Lazy overlays, asset cancellation, voice decoding/disposal, music unlock callbacks and sound cleanup read. Gauss focus-loss bug fixed. Other rendering resources, utilities and tools remain. |
| Enemy AI / mission / CTB | Second pass reviewed | Windup execution, salvo/lock expiry, teleport/throw/aura ownership, live target replacement, spawn countdown/stagger/retry/provenance and technical backstop checked. CTB own-home pickup blocked opponents depending on player order; fixed. |
| World entities / train / pickups | In progress | Train reentry, destruction timers and Activity ports; shooting-range guards, target respawn and teardown; pickup UID/delta/snapshot order checked. Base marker ownership fixed. Broader entity review continues. |
| Effects and rendering resources | In progress | World teardown of BlackHole, GuardianSpirit and pickup materialization fixed and cross-reviewed. Renderer maps, GPU source release and worker job/transfer cancellation traced. Entity-owned spawn effects remain to inspect. |
| Proven unused code | Removals reviewed | Removed unused PlayerRuntime navigation flag, two peer helper exports, two obsolete audio wrapper methods and private VALID_SLOTS constant. Full repository/reference search performed; live navigation remains owned by Activity flow fields. |
| Independent review | First two clusters complete; final pending | Agents cross-reviewed lifecycle, enemy replication, Bridge, PeerLink and input/audio fixes; root reviewed registry, projectile and save gates. Plasma-clear regression discovered in first review; range test isolation improved in second review. |

## Findings and changes

| ID | Finding | Status / evidence |
| --- | --- | --- |
| A01 | Client batches can overwrite global state and other players' state | Fixed: clients can write only declared keys for their own admitted identity; globals remain host-authored. Real PeerRoom/FakeNetwork regression covers forged `gph`, `inp`, `pbk`, pre-handshake and removed-link traffic. |
| A02 | Delayed fast state recreates a departed player or contaminates a reused identity | Fixed: received batches update existing players only; room player IDs increase monotonically. Repros cover queued and in-flight state after quit, plus old `frg=9` arriving after a replacement player's `frg=0`. Capacity and resume remain tested. |
| A03 | A failed player attach leaves resources, build, burrow or partial loadout state behind | Fixed by wiring existing rollback ports and cleaning the failing loadout step's partial state. Concrete regressions cover failure before/during loadout, cleanup failure, original error preservation, retry and detach. Independently reviewed. |
| A04 | Malformed remote aim reaches rotation/shield consumers | Fixed by enforcing the declared uint8 aim contract at `NetworkBridge.getPlayerInput`. Real wire-path regression failed on missing aim; checks valid boundaries and malformed values after fix. |
| A05 | Burning-ground expiry uses unsynchronized client time | Fixed: delta merge uses synchronized host time. Both +60s and -60s client-clock regressions failed before the fix. |
| A06 | Moving enemies never reach their rotating full-state refresh | Fixed: scheduled full refresh precedes movement deltas. Tests lose spawn, HP and plasma-clear updates while the enemy continues moving and verify recovery. Review caught and fixed the missing explicit plasma-stack zero in full state. |
| A07 | Enemy codec drops the teleport position revision | Fixed: revision survives the wire codec; initial movement baseline preserves ordinary interpolation and short teleports snap. Protocol version 23 prevents mixing incompatible codecs. |
| A08 | Clients can forge authoritative broadcast events | Fixed centrally in Bridge event dispatch: only the transport-stamped host sender is accepted. A real client broadcast / forged sender test previously triggered `trdes` twice; legitimate host events still reach all peers once. |
| A09 | Buffered combat effects and XP popups survive World replacement/clear | Fixed: both queues are discarded when the World revision changes or the World ends. Two regressions preserve same-world feedback, discard old feedback and allow new-world feedback. |
| A10 | Closing a pending PeerLink can leave its open promise unresolved or report a closed link ready | Fixed: own cancellation for PeerJS connections that never opened; guard after fast-channel await; stop queued inbox delivery immediately on close. Repro previously resolved open, delivered a later packet and notified close twice. |
| A11 | Prototype property names are accepted as loadout registry entries | Fixed: frozen ID registries use null prototypes and legacy alias resolution requires an own property. `constructor`, `toString`, `__proto__` previously reached non-config values and crashed loadout sanitization. |
| A12 | Projectile fire fields accept strings/null/booleans | Fixed: required speed, size and bounce fields must be numeric before the existing finite/range constraints apply. Malformed speed otherwise produces invalid flight math. |
| A13 | Expired projectiles can still emit proximity damage after release | Fixed: terminal release returns immediately. Lifetime/range regressions include a living pulse control and no pulse after removal. |
| A14 | A mini-rocket waiting for an explosion receipt or coasting can bypass its safety lifetime | Fixed: safety expiry precedes both continuation branches. Repros reject delayed effects after the terminal cap and release exactly once. |
| A15 | Gauss charging survives focus loss and fires on the next delayed frame | Fixed: blur/hidden/shutdown cancel the ultimate charge alongside utility interactions. Real InputSystem update regressions previously produced `press, release` instead of `press, cancel`. |
| A16 | Import/reset replaces local saves while a live session keeps the previous owner/revision | Confirmed and open: a lower reset revision can be overwritten by the old base on a later commit. Safe replacement requires host acknowledgement plus stale contribution/reward invalidation; no unsafe rebind or automatic room restart implemented. |
| A17 | Save import/reset can write after Lobby permissions are lost | Fixed: file import checks permission before opening and after asynchronous reading; reset rejects match/ready state before persistence. Pending file read regressions cover round start, readiness and UI lock. Follow-up fixes reset's boolean result so Scene does not refresh a rejected reset. |
| A18 | A stunned VoidStalker's abandoned translocator puck never expires | Fixed: flight marks grenade/puck lifetime expiry and lifecycle releases it. Existing stun deliberately drops the reference; the runtime now fulfills its normal-expiry contract. Tests cover real enemy stun and time factors 1 and 0.5. |
| A19 | A defender near its home beer prevents an opponent from picking it up | Fixed: a non-actionable own-team home interaction continues to the next player. Tests use disjoint player bodies, both within pickup reach, and both player orders. Dropped-beer returns remain unchanged. |
| A20 | Black-hole, guardian-spirit and pickup one-shot visuals outlive their World | Fixed: explicit ownership of transient images, CPU emitters, timers and tweens. Teardown cancels them; natural completion drops bookkeeping; stale callbacks cannot touch a subsequent World's objects. Pickup collection also stops the reveal tween targeting a plain proxy. Appearance and normal timing unchanged. |
| A21 | A host with an earlier clock can suppress a legitimate later round's XP | Fixed: completion preserves the existing round revision in state and result rows. Local progress keeps a per-room monotone revision ledger. Mixed revisions wait, new host times can be earlier, A/B/A replay remains deduplicated. Import/export/reset/legacy migration covered. Legacy and room-code reuse limits are documented. |
| A22 | A client's non-string player name crashes host profile extraction/update | Fixed: both profile paths narrow client-owned name state to a string before trimming. Two real-wire regressions failed before the fix; invalid updates preserve the previous name, initial invalid values use the existing default. |
| A23 | BaseEntity.destroy leaves its owned vulnerability marker alive | Fixed: the marker is destroyed and nulled by the entity itself. Other Activity paths normally clean it earlier, but direct entity teardown now fulfills the same complete ownership contract. |

Additional hypotheses remain separate from confirmed findings; no speculative fixes are included.

## Verification

- Baseline `npm run check`: PASS. Complete local output: `tmp/overnight-audit/baseline-check.log`.
- First reviewed cluster `npm run check`: PASS, 535 Core files / 4,983 tests, 6 Architecture files / 54 tests, all three builds. Local output: `tmp/overnight-audit/cluster-1-check.log`.
- Second reviewed cluster `npm run check`: PASS, 535 Core files / 5,010 tests, 6 Architecture files / 54 tests, all three builds. Integration: 62 files / 652 tests PASS. Logs: `tmp/overnight-audit/cluster-2-check.log` and `cluster-2-integration.log`.
- Third reviewed cluster `npm run check`: PASS, 537 Core files / 5,037 tests, 6 Architecture files / 54 tests, all three builds. Integration: 62 files / 653 tests PASS. Logs: `tmp/overnight-audit/cluster-3-check.log` and `cluster-3-integration.log`.
- A03: concrete composition regressions red before fix; 227 targeted lifecycle tests green afterward; independent review completed.
- A04: `npm test -- tests/WorldChannelContracts.test.ts tests/LocalPlayerPrediction.test.ts tests/PlayerMovementAcknowledgements.test.ts`: 3 files / 35 tests PASS. Logs: `tmp/overnight-audit/input-validation-red.log` and `input-validation-green.log`.
- A05–A07: clock-skew, lost spawn/health, codec/short teleport and plasma-clear tests red before their respective fixes. Latest focused state run: 55 tests PASS (`NavigationPursuit`, `CoopDefenseBurrowingEnemies`, `EnemyClawNetwork`).
- A08: `tmp/overnight-audit/event-authority-red.log` and `event-authority-green.log`; 66 focused tests PASS.
- A09: `tmp/overnight-audit/queued-feedback-red.log` and `queued-feedback-green.log`; 25 focused tests PASS; independently reviewed.
- Transport agent additionally ran the integration suite: 62 files / 648 tests PASS. Later focused fixes were retested; rerun the whole suite after the next relevant cluster.
- Baseline game build reports the existing large-chunk warning; no build failure.
- The baseline and subsequent game builds also warn about three font URLs left for runtime resolution. This pre-existing warning is separate from the audited code fixes; runtime asset verification remains to inspect.
- A10: focused PeerLink regressions red before fix; 67 transport tests passed before the additional queued-inbox regression; updated PeerLink suite passes 15 tests. Independent review complete.
- A11/A12: six inherited-key regressions and three malformed-number cases failed before fixes. Five focused files / 61 tests pass, including null/boolean cases and PeerLink.
- A13/A14: four lifetime regressions failed before fixes; 3 files / 95 tests pass. Root review requested and received an isolated range test; updated lifecycle suite: 14 PASS. Additional Combat/Collision suites: 5 files / 67 tests PASS.
- A15 and obsolete audio wrappers: 5 files / 81 tests PASS. Logs: `tmp/overnight-audit/input-focus-red.log` and `input-focus-green.log`. Independent review complete.
- A17: permission regressions failed before fixes; focused LocalPersistence/Meta/Lobby integration checks passed, followed by the full second-cluster gate.
- A18: 5 focused files / 121 tests PASS, including the real enemy translocator path and projectile lifecycle/flight/world contracts.
- A19: 6 focused files / 93 tests PASS; root review complete.
- A20: BlackHole regressions red, then 4 files / 46 tests PASS. PowerUp/Train/World follow-up: 7 files / 82 PASS. GuardianSpirit teardown regression red, then BlackHole/GuardianSpirit/PowerUp/ArenaPresentation: 4 files / 15 PASS. All three independently reviewed. Logs: `black-hole-lifetime-red.log`, `black-hole-lifetime-green.log`, `guardian-lifetime-red.log`, `guardian-lifetime-green.log` under `tmp/overnight-audit/`.
- A21: nine targeted red reproductions; Meta/LocalPersistence/ArenaExitLifecycle: 3 files / 98 PASS. Independent transport and root review complete, including legacy replay boundary monotonicity.
- A22: 2 red real-wire cases; PlayerName/PeerRoom/WorldChannel: 3 files / 62 PASS. Logs: `tmp/overnight-audit/player-name-wire-red.log` and `player-name-wire-green.log`. Independent review complete.
- A23: BaseGrounding ownership regression red; 7 focused files / 66 tests PASS, including repeated teardown.
- The runtime-assets prebuild rewrites generated manifests and text-asset hashes due to checkout line endings. These unrelated generated changes were restored before commits; generated output remains available for verification.

## Local commits

- `d80bea24` — roll back partial player attachment.
- `029d97e9` — enforce peer authority, unique identity and World-state boundaries.
- `a82ab4c5` — refresh moving enemies and preserve teleport revisions.
- `eb0f3768` — record initial audit coverage and verification.
- `c59155fd` — settle aborted peer-link handshakes.
- `89b38262` — reject inherited loadout IDs and invalid projectile fields.
- `9e969e83` — stop projectile effects at terminal lifetime boundaries.
- `728c5b37` — cancel Gauss charging on focus loss.
- `5be550e6` — remove verified unused compatibility helpers and player feature.
- `24124eec` — revalidate lobby permissions before replacing progress.
- `24c31306` — expire abandoned translocator pucks.
- `b66474f0` — allow enemy beer pickup beside a home defender.
- `b593d0a1` — release black-hole, guardian-spirit and pickup transient visuals at World teardown.
- `1d941a25` — release the base vulnerability marker.
- `8fcad7ac` — validate client names before profile extraction.
- `7de63795` — skip Scene refresh after a rejected reset.
- `ce814dc6` — credit identified rounds independently of host clock ordering.

No push, merge or deployment.

## Risks and open points

- Broad review is not proof that every gameplay path is defect-free.
- Browser verification is authorized. The prescribed `npm run dev:browser` attempt failed because port 8090 is already occupied (PID 9120); HTTP 200 belongs to the existing server, not a verified server for this worktree. No foreign process was terminated. Browser verification of this branch remains unverified.
- `ArenaScene` shutdown has no general active-World teardown; normal production code never stops/restarts this Scene. Kept as an unverified restart risk, not a speculative fix.
- Same-world Activity A→none→B can retain an old start anchor at the low-level API. Current production starts create a new World revision and reset the anchor, so no reachable bug was confirmed and no fix was made.
- A suspected WorldDescriptor validation issue was rejected: existing tests explicitly require dropping invalid optional parameters while preserving the World; malformed health rewards intentionally have a stricter contract.
- A suspected round-start missing-baseline race was rejected after tracing HostUpdate activation: the fresh start anchor is published before the host simulation resumes and the full-snapshot request survives to the network tick.
- Different codec versions intentionally cannot connect after A07; release coordination will require matching builds if this branch is later adopted.
- The requested active duration remains an explicit completion condition.
- Save replacement needs an explicit session boundary; no automatic reload/disconnection or weakened owner authorization has been introduced. Reproductions are retained under `tmp/overnight-save-replacement-repro.test.ts.txt` and `tmp/overnight-client-save-replacement-repro.test.ts.txt` with companion notes. The latter proves both stale `pbr` rewards and the old `pbk` revision-5 contribution return on the next real client session sync after reset.
- A21 removes cross-host clock ordering for identified rounds. Historical results without identity retain the old timestamp guard. An old save cannot reconstruct the namespace of an already credited result; the first identified replay may be credited again. A future reuse of an old random room code can inherit that code's revision ceiling. These explicit compatibility limits are not hidden by a invented migration.
- AfterRoundFlow and pending item-reward UI still use end timestamps as local presentation keys. Exact equal timestamps across different hosts remain an unverified follow-up, separate from the fixed progression ledger.
- Cross-tab storage invalidation is exposed but not wired to a storage listener. Concurrent-tab persistence semantics remain an open investigation, not an assumed safe fix.
- A suspected synchronous World replacement inside projectile-explosion callbacks was rejected after tracing production callbacks and `ArenaRuntime`: host simulation finishes before round completion and World teardown are applied. No speculative guards added.
- Worker review covered terrain material transfer/cancellation and flow-field generation/job matching, buffer ownership, watchdog and inline fallback; no new confirmed defect in this pass.

## Work sessions

| UTC interval | Activity | Excluded idle time |
| --- | --- | --- |
| 2026-10-04 21:57:48 – 22:15 | Goal, isolated checkout, contract review, coverage mapping, first parallel audits, regressions, fixes, cross-review, complete gate and local commits | 0 |
| 2026-10-04 22:15 – 22:40 | Further transport, persistence, content and unused-code audits; second full gate; browser prerequisite check; effects and enemy ownership review | 0 |
| 2026-10-04 22:40 – ongoing | Malformed profile and host-clock reproductions; entity/effect cleanup; independent review; third full gate | 0 |

Knowledge writeback: Updated docs/ai/local-persistence.md and docs/ai/networking.md with the verified per-room round-credit identity; corrected docs/ai/gameplay.md to match actual PlayerWorldRuntime feature ownership.
