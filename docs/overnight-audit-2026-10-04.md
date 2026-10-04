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
| Peer transport | Further pass in progress | Authority, handshake admission, delayed state after leave, reconnect grace and identity reuse checked and fixed. Packet framing/send queues read; pending-open cleanup under investigation. |
| Network state contracts | Initial pass complete | World/Activity mismatch rejection; participation reset; full-bootstrap keys; omitted/empty deltas; projectile static cache; rock tombstone recovery; enemy refresh/status/teleports; host-clock expiry. A05–A07 fixed. |
| Host RPC action validation | Initial pass complete | World revision and actor identity; authoritative origin/time; capability checks for actions, held actions, construction and pickups. Malformed aim and forged host events fixed. |
| Core / architecture / build baseline | Passed | `npm run check`: 535 Core files / 4,969 tests; 6 Architecture files / 54 tests; game, map editor and balance editor builds |
| Remaining codebase | In progress | Persistence / authored content now assigned; gameplay systems, entities, rendering resources, utilities and tools remain |
| Proven unused code | In progress | Candidates: unused PlayerRuntime navigation flag and unused peer helpers. Require repository and dynamic-reference search before removal. |
| Independent review | First cluster complete; final pending | Agents cross-reviewed lifecycle, enemy replication and root Bridge fixes. Plasma-clear regression discovered in review and corrected before commit. |

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

Additional hypotheses remain separate from confirmed findings; no speculative fixes are included.

## Verification

- Baseline `npm run check`: PASS. Complete local output: `tmp/overnight-audit/baseline-check.log`.
- First reviewed cluster `npm run check`: PASS, 535 Core files / 4,983 tests, 6 Architecture files / 54 tests, all three builds. Local output: `tmp/overnight-audit/cluster-1-check.log`.
- A03: concrete composition regressions red before fix; 227 targeted lifecycle tests green afterward; independent review completed.
- A04: `npm test -- tests/WorldChannelContracts.test.ts tests/LocalPlayerPrediction.test.ts tests/PlayerMovementAcknowledgements.test.ts`: 3 files / 35 tests PASS. Logs: `tmp/overnight-audit/input-validation-red.log` and `input-validation-green.log`.
- A05–A07: clock-skew, lost spawn/health, codec/short teleport and plasma-clear tests red before their respective fixes. Latest focused state run: 55 tests PASS (`NavigationPursuit`, `CoopDefenseBurrowingEnemies`, `EnemyClawNetwork`).
- A08: `tmp/overnight-audit/event-authority-red.log` and `event-authority-green.log`; 66 focused tests PASS.
- A09: `tmp/overnight-audit/queued-feedback-red.log` and `queued-feedback-green.log`; 25 focused tests PASS; independently reviewed.
- Transport agent additionally ran the integration suite: 62 files / 648 tests PASS. Later focused fixes were retested; rerun the whole suite after the next relevant cluster.
- Baseline game build reports the existing large-chunk warning; no build failure.
- The runtime-assets prebuild rewrites generated manifests and text-asset hashes due to checkout line endings. These unrelated generated changes were restored before commits; generated output remains available for verification.

## Local commits

- `d80bea24` — roll back partial player attachment.
- `029d97e9` — enforce peer authority, unique identity and World-state boundaries.
- `a82ab4c5` — refresh moving enemies and preserve teleport revisions.

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

## Work sessions

| UTC interval | Activity | Excluded idle time |
| --- | --- | --- |
| 2026-10-04 21:57:48 – 22:15 | Goal, isolated checkout, contract review, coverage mapping, first parallel audits, regressions, fixes, cross-review, complete gate and local commits | 0 |
| 2026-10-04 22:15 – ongoing | Further transport, persistence, content and unused-code audits; browser prerequisite check | 0 |

Knowledge writeback: No durable project knowledge discovered.
