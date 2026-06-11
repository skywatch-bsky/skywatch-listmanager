# Plan: Firehose Staleness Watchdog + Header-Based Rate Limiting

## Context

The deployed service went silent on 2026-06-05: the label firehose websocket to
`ozone.skywatch.blue` died without emitting a `close` event (half-open TCP), and
`firehose.ts` only reconnects on `close`. The pod sat "Running" but deaf for 6+ days.

Separately, list writes are throttled by a static `p-ratelimit` config with
`maxDelay: 60000`, which throws `RateLimitTimeoutError` and silently drops writes
when the queue stalls (observed 2026-06-02). The PDS returns `ratelimit-*` headers
that should drive throttling instead (pattern already proven in
`src/cli/batch-add-to-list.ts`).

## Changes

### 1. `src/firehose.ts` — staleness watchdog

- Track `lastActivityAt`, updated on connection attempt, `open`, and every `message`.
- Watchdog interval (every 30s): if a socket exists and no activity for 5 minutes,
  force-close it and reconnect immediately from the saved cursor. Covers both
  silently-dead OPEN sockets and connection attempts stuck in CONNECTING.
- Socket event handlers become generation-checked (`if (ws !== socket) return`) so
  a discarded zombie socket's late events cannot trigger duplicate reconnects.
- Watchdog starts in `startFirehose()`, stops in `stopFirehose()`.

### 2. `src/limits.ts` — header-driven rate limiter (replaces `p-ratelimit`)

- `createRateLimiter(name, options)` returning `schedule(fn)`:
  - Tracks `remaining` / `resetAt` from `ratelimit-remaining` / `ratelimit-reset`
    response headers (success and error responses both update state).
  - Before each call: if `remaining <= buffer`, sleep until `resetAt`.
  - On HTTP 429: update state from error headers, wait until reset, retry
    (bounded attempts). No `maxDelay` — writes wait instead of being dropped.
  - Injectable `now`/`sleep` for unit testing.
- Two instances: `authLimit` (createSession) and `writeLimit` (repo operations),
  since they are separate server-side buckets.

### 3. `src/agent.ts` — single rate-limited login

- Replace eager module-level `login()` + duplicate `login()` in `main()` with a
  memoized `ensureLoggedIn()` wrapped in `authLimit`. Removes the
  swallowed-error `isLoggedIn` boolean (failures now propagate).

### 4. `src/listmanager.ts` — route API calls through `writeLimit`

- `createRecord`, `deleteRecord`, and `listRecords` pagination calls each go
  through `writeLimit.schedule(...)`. Existing redis rkey index, dedupe, and
  `RecordAlreadyExists` handling unchanged.

### 5. `src/main.ts` — use `ensureLoggedIn()`.

### 6. Tests — `src/limits.test.ts`

- Unit tests for the limiter: header state updates, gating when remaining is at
  buffer, 429 retry-after-reset, bounded retries. Run via `tsx --test`.

## Validation

1. `npx tsc --noEmit`, `bunx eslint .`, run unit tests.
2. Build linux/amd64 image with podman, `podman save` → scp → `k3s ctr images import`
   on the node, `kubectl rollout restart deployment skywatch-listmanager`.
3. Watch logs: expect reconnect from cursor 5485082 and ~6 days of catch-up,
   including label events for `did:plc:52fanejcoro7uo7xb46ssila` (live test case).

## Out of scope (pre-existing, noted for later)

- `addToList` swallows non-429 write failures and the event is still marked
  processed (potential loss on persistent errors).
- AtpAgent internal session refresh calls are not routed through `authLimit`.
- Backpressure pause relies on processor drain; unchanged.
