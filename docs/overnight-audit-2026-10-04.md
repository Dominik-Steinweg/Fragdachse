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
| Effects and rendering resources | Third pass reviewed | World teardown of BlackHole, GuardianSpirit, pickup and player/enemy spawn presentation fixed and cross-reviewed. Renderer maps, GPU source release, lighting teardown and worker job/transfer cancellation traced. |
| Construction moves / editor layouts | Reviewed | Host/client cell swaps, visual cleanup and target-bound injector effects now preserve object ownership through movement and rollback. Pure rotation is rejected by the existing editor contract, so no speculative rotation fix. |
| Standalone tools | Further pass reviewed | Voice workshop UTF-8 fix tested; map load/save races fixed. Balance editor uses busy/inert gates and versioned validation. Audio Studio request, generation queue, cancellation, path/hash/revision, export/recovery and cleanup transactions reviewed; complete offline Node/Python suite passed. No model/GPU generation or publishing performed. |
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
| A24 | Player/enemy spawn objects, tweens and delayed callbacks outlive their owner | Fixed: reusable spawn renderers own their transient objects/timers and clear on entity destruction or World teardown. Natural completion drops bookkeeping; retired callbacks cannot affect the next World. |
| A25 | AWP scope and a pending Shift press survive focus loss | Fixed: blur/hidden cancellation clears both scope clocks/fractions and the pending Shift edge. Real input updates previously fired a fully charged shot or activated burrow after focus returned. |
| A26 | Cancelling the save-file chooser leaves its promise pending | Fixed: the native cancel event resolves the existing no-file result without changing stored progress. |
| A27 | Balance runtime storage can throw on access or accept malformed result fields | Fixed: storage getter failures are contained; adrenaline and damage-by-kind values require the declared finite numeric shape. |
| A28 | Authored content accepts inherited type/audio reference keys | Fixed: the required-field/type tables and audio references require own keys. Valid authored content remains unchanged. |
| A29 | Finite imported XP/item levels can overflow derived runtime values | Fixed at import/sanitization: derived level thresholds and item base/affix/salvage values must stay finite. Existing XP arithmetic moved unchanged into a pure helper to avoid an initialization cycle. Invalid imports preserve the previous save atomically. |
| A30 | Maps/base/rewards accept inherited pedestal IDs | Fixed: all three pedestal authoring boundaries require own definition keys. |
| A31 | Swapping construction cells loses occupancy during snapshot/visual synchronization | Fixed: snapshot sync vacates all old cells before assigning the new layout; visual removal only clears a cell still owned by that object. Real host/client swap and idempotent replay covered. |
| A32 | Malformed scope parameters reach weapon math and charge resources | Fixed: the RPC boundary rejects nonboolean holding and nonfinite/non-numeric/out-of-range fractions before dispatch. This does not solve forged but well-typed charge duration (A35). |
| A33 | Moving a buffed construction leaves its energy-injector effect at the old position | Fixed: construction movement commits target-bound effect coordinates together with placement, including editor batches and rollback. Owner, effect identity, start and expiry remain unchanged. |
| A34 | Voice workshop corrupts UTF-8 text split across HTTP chunks | Fixed: collect the bounded byte chunks before decoding UTF-8. Real loopback HTTP regression previously persisted `M��ller` instead of `Müller`; response, memory and disk now agree. |
| A35 | A client can claim full AWP charge without holding first | Confirmed and open: a well-typed first request with both scope fractions set to 1 doubles damage in the real activation path. Needs an existing authoritative owner/timing design, beyond field validation; reproduction preserved. |
| A36 | Reliable messages buffered before fast-channel readiness lack a byte bound | Fixed using the existing receive budget. 513 valid 32 KiB strings stayed buffered before channel readiness in the red reproduction. Independent review complete. |
| A37 | Host links can remain unadmitted indefinitely by sending heartbeat replies | Fixed using the existing handshake duration from link readiness. A real room reproduction stayed connected for 20 seconds without sending hello. Independent review complete. |
| A38 | An older map load response replaces the newest selection or edits made while loading | Fixed with load tickets and a second discard decision when the previous document changes while a GET is pending. Success/failure and superseded-response paths covered. |
| A39 | Changing the Options locale leaks old slider pointer listeners | Fixed: normal hide/unbind runs before rebuilding controls. Removed the redundant activation sound in the same interaction. Two real ownership regressions pass. |
| A40 | Tutorial controls retain the previous locale across missions | Fixed: the long-lived panel releases and rebuilds its translated controls when the locale changes. Existing reset clears cached text/tweens; unchanged-locale updates do not rebuild. |
| A41 | Repeated map-editor save hotkeys start concurrent PUTs | Fixed by applying the existing saving gate to the hotkey path. Both successful and rejected saves preserve intervening edits and permit a later save with the correct revision. |
| A42 | Distinct identified rounds with an equal end timestamp lose item offers and skip after-round UI | Reproduced in the real Meta/persistence path. Optional existing room/round identity now propagates through queue, presentation, lazy opening and exact claim; independent review and complete gate pending. |
| A43 | Malformed tunnel grid anchors create fractional or NaN world endpoints | Fixed at the shared placement boundary: grid coordinates must be integers before index/occupancy access. Eight JSON-representable invalid inputs on both axes and a valid tunnel control tested. |
| A44 | Reload-resume inherits a stale ping acknowledgement and its new probe sequence is ignored | Reproduced with real PeerRoom encoding and the same resume token. Controller-local outstanding probe correlation and host duplicate-pair suppression pass focused tests; independent review and gate pending. |

Additional hypotheses remain separate from confirmed findings; no speculative fixes are included.

## Verification

- Baseline `npm run check`: PASS. Complete local output: `tmp/overnight-audit/baseline-check.log`.
- First reviewed cluster `npm run check`: PASS, 535 Core files / 4,983 tests, 6 Architecture files / 54 tests, all three builds. Local output: `tmp/overnight-audit/cluster-1-check.log`.
- Second reviewed cluster `npm run check`: PASS, 535 Core files / 5,010 tests, 6 Architecture files / 54 tests, all three builds. Integration: 62 files / 652 tests PASS. Logs: `tmp/overnight-audit/cluster-2-check.log` and `cluster-2-integration.log`.
- Third reviewed cluster `npm run check`: PASS, 537 Core files / 5,037 tests, 6 Architecture files / 54 tests, all three builds. Integration: 62 files / 653 tests PASS. Logs: `tmp/overnight-audit/cluster-3-check.log` and `cluster-3-integration.log`.
- Fourth reviewed cluster `npm run check`: PASS, 537 Core files / 5,079 tests, 6 Architecture files / 54 tests, all three builds. The simultaneous integration process exited natively with Windows code `0xC0000005` without an assertion failure or summary; the unchanged suite rerun separately passed 63 files / 663 tests. Logs: `cluster-4-check.log`, `cluster-4-integration.log`, `cluster-4-integration-retry.log` under `tmp/overnight-audit/`. No speculative source change was made for the process crash.
- A03: concrete composition regressions red before fix; 227 targeted lifecycle tests green afterward; independent review completed.
- A04: `npm test -- tests/WorldChannelContracts.test.ts tests/LocalPlayerPrediction.test.ts tests/PlayerMovementAcknowledgements.test.ts`: 3 files / 35 tests PASS. Logs: `tmp/overnight-audit/input-validation-red.log` and `input-validation-green.log`.
- A05–A07: clock-skew, lost spawn/health, codec/short teleport and plasma-clear tests red before their respective fixes. Latest focused state run: 55 tests PASS (`NavigationPursuit`, `CoopDefenseBurrowingEnemies`, `EnemyClawNetwork`).
- A08: `tmp/overnight-audit/event-authority-red.log` and `event-authority-green.log`; 66 focused tests PASS.
- A09: `tmp/overnight-audit/queued-feedback-red.log` and `queued-feedback-green.log`; 25 focused tests PASS; independently reviewed.
- Transport agent additionally ran the integration suite: 62 files / 648 tests PASS. Later focused fixes were retested; rerun the whole suite after the next relevant cluster.
- Baseline game build reports the existing large-chunk warning; no build failure.
- The baseline and subsequent game builds also warn about three font URLs left for runtime resolution. All three corresponding files exist in both public and built output with matching lengths (9,956 / 9,900 / 31,432 bytes); no missing asset was found. Actual browser loading remains unverified.
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
- A24: 2 ownership cases red; 5 new regressions and 131 focused tests across 4 files PASS. Logs: `spawn-lifetime-red.log` / `spawn-lifetime-green.log`. Independent review complete.
- A25: 4 focus-loss cases red; 64 tests / 2 files PASS. Logs: `scope-focus-red.log` / `scope-focus-green.log`. Independent review complete.
- A26/A29: cancellation and derived-overflow regressions pass in LocalPersistence; numeric import/item/progression run 78 tests / 3 files PASS. Evidence: `tmp/numeric-import-verification-2026-10-04.txt`. Both changes independently reviewed.
- A27/A28: storage regressions red before fix; 44 focused tests / 3 files PASS. Complete Balance-Lab suite after XP extraction: 21 files / 111 tests PASS. Evidence: `tmp/runtime-benchmark-storage-repro-2026-10-04.txt` and `tmp/content-own-key-verification-2026-10-04.txt`.
- A30: 6 authoring cases red, then 66 tests / 4 files PASS. Evidence: `tmp/map-pedestal-reference-verification-2026-10-04.txt`. Independent review complete.
- A31: 33 tests / 4 files and 68 additional construction tests / 9 files PASS; root and state review complete.
- A32: 15 malformed scope cases red before validation; RPC suite 36 PASS, plus 31 existing weapon tests and a real FakePeer path. Root review complete.
- A33: real construction-management reproduction red, then 32 tests in the extended integration file plus 19 related tests PASS. State and root reviews complete; fourth full integration gate also covers it.
- A34: existing Voice-Workshop baseline 13 PASS; added real HTTP regression red, then complete suite 14 PASS. Logs: `voice-workshop-baseline.log`, `voice-utf8-red.log`, `voice-utf8-green.log`. Independent lifecycle review complete. Only synthetic test audio/fake generation was used.
- A36/A37: latest PeerRoom/PeerLink/protocol run: 3 files / 70 tests PASS. The pending-inbox bound and unadmitted heartbeat cases failed before their fixes.
- A38/A41: map-editor focused run 5 files / 65 tests PASS; map-editor build passed after the load guards. The final save guard is also included in the next full gate.
- A39/A40: Options/Tutorial/living-UI focused run 6 files / 60 tests PASS; independent state and root review complete. Game build will be rerun with the next cluster.
- A43: malformed-anchor regressions red before the guard; Placement/Inspector/Ultimate/BurrowExit suites: 4 files / 64 tests PASS. The separately selected WorldPlayerGameplayLifecycle suite had temporary fixture failures from the parallel, unfinished A35 work; those are not attributed to this placement fix.
- A44: `ping-reload-red.log` demonstrates both inherited 140 ms without a probe and failure to obtain the fresh 40 ms response. `ping-reload-green.log`: 4 files / 74 tests PASS, including delayed/out-of-order/replayed acknowledgements and a long outage.
- Audio Studio `npm test`: Node adapter 16 and frontend 10 tests PASS; Python 158 PASS. The first Python attempt hit Windows global-temp permissions, and the unchanged rerun used an isolated worktree temp directory (`audio-studio-baseline-retry.log`). Existing Python environment reused without installs. Two dependency deprecation warnings remain; no GPU/model claim is made.
- An experimental Audio Studio double-worker hypothesis was rejected after tracing the only production caller: `Studio.generate` holds the store file lock through `Jobs.submit/start`. The artificial concurrent direct-call reproduction was removed from the suite and preserved only as `tmp/overnight-audit/audio-start-hypothesis-rejected.test.py`; no speculative production change.
- Navigation intent/breach/reservation and ally-lifetime follow-up: 3 files / 54 tests PASS. Carry/objective repair/placement reward/team buff follow-up: 4 files / 33 tests PASS. Ownership, pending search budgets, topology invalidation and authoritative timing traced without a new finding.
- Projectile stress subset: 2 files / 18 tests PASS, 2 comparison/benchmark files / 3 tests intentionally skipped because their opt-in environment was absent. Log: `projectile-stress.log`; no performance claim is inferred from skipped comparisons.
- Asset suite: initially 33 files PASS and 2 files failed solely because an ignored character-render reference was absent from the isolated checkout (178 tests passed, 2 failed). Copied the existing `art/poc/pipeline-v2/runs/v2-ai/badger/standard/render.json` unchanged from the main checkout; SHA-256 matched `404ECC5099E16D157B17270E688A77E0CF61F915FEC76E451A880C75F43E69AD`. Both affected suites then passed all 17 tests. Logs: `asset-suite.log`, `asset-fixture-recovery.log`. No asset source changed.
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
- `ee33e494` — remove the unused projectile removed-state alias and obsolete XP helper; correct the feature inventory.
- `2e35fd46` — release spawn presentation at owner teardown.
- `32c13b6d` — cancel scope and pending Shift on focus loss.
- `efab756e` — preserve cell ownership across layout swaps.
- `7df04f0c` — move target effects with their construction.
- `6913c32d` — reject malformed scope action parameters.
- `35c458bd` — tolerate unavailable lab storage and reject corrupt results.
- `b437cfcb` — require own keys in authored content reference tables.
- `397c94ad` — reject inherited pedestal identifiers.
- `7115311f` — decode complete HTTP request bytes as UTF-8.
- `e5ebfcad` — settle cancelled save-file selection.
- `b29c3a06` — reject imports with nonfinite derived state.
- `baa72d5c` / `37e59d80` — guard superseded map loads and edits made during a pending load.
- `395895bd` — unbind Options controls before a locale rebuild.
- `9c4a6e56` / `3622f47e` — bound pre-ready inbox bytes and require timely hello admission.
- `705812e8` — remove the unused benchmark distance helper/test import and overcharge state alias after repository-wide reference checks; 17 benchmark tests passed.
- `34229986` — serialize map-editor save requests.
- `069dec32` — refresh translated tutorial controls.
- `c5219f2d` — reject malformed placement grid coordinates.

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
- Equal-timestamp reward/presentation collisions are now confirmed (A42); the fix is being reviewed, separately from the already committed progression ledger.
- Cross-tab storage invalidation is exposed but not wired to a storage listener. Concurrent-tab persistence semantics remain an open investigation, not an assumed safe fix.
- A suspected synchronous World replacement inside projectile-explosion callbacks was rejected after tracing production callbacks and `ArenaRuntime`: host simulation finishes before round completion and World teardown are applied. No speculative guards added.
- Worker review covered terrain material transfer/cancellation and flow-field generation/job matching, buffer ownership, watchdog and inline fallback; no new confirmed defect in this pass.
- A35 is preserved in `tmp/overnight-awp-scope-authority-repro.md` and its `.test.ts.txt` companion. RPC type/range validation deliberately does not claim host-authoritative charge timing.
- A29 covers imported persisted values, not every direct debug setter, astronomical pure-math input or the sum of many extreme individually finite item values. Those remain separate potential numeric boundaries.
- Map-editor out-of-order responses and edits during a pending load were both reproduced and fixed (A38); the original probe remains in `tmp/map-loading-race-repro.mjs`.
- VoiceLibrary import/remove have no current production callers but are an explicitly documented supported package boundary; they were not removed merely because the current UI only selects bundled voices.

## Work sessions

| UTC interval | Activity | Excluded idle time |
| --- | --- | --- |
| 2026-10-04 21:57:48 – 22:15 | Goal, isolated checkout, contract review, coverage mapping, first parallel audits, regressions, fixes, cross-review, complete gate and local commits | 0 |
| 2026-10-04 22:15 – 22:40 | Further transport, persistence, content and unused-code audits; second full gate; browser prerequisite check; effects and enemy ownership review | 0 |
| 2026-10-04 22:40 – 23:12 | Malformed profile and host-clock reproductions; entity/effect cleanup; storage/content/import/move fixes; third and fourth gates; stress/assets/Voice tests; independent reviews and small local commits | 0 |
| 2026-10-04 23:12 – ongoing | Further transport resource boundaries, editor races, UI listener ownership and remaining codebase review | 0 |

Knowledge writeback: Updated docs/ai/local-persistence.md and docs/ai/networking.md with the verified per-room round-credit identity; corrected docs/ai/gameplay.md to match actual PlayerWorldRuntime feature ownership.
