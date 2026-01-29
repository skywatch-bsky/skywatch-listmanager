# Skywatch List Manager Implementation Plan

## Overview

Build a TypeScript-based tool that subscribes to a DAG-CBOR encoded firehose of moderation labels and automatically manages Bluesky lists based on those labels. The tool will add users to lists when labels are applied and remove them when labels are negated.

## Architecture

### Core Components

1. **Firehose Subscriber** - Connects to WebSocket firehose, parses DAG-CBOR encoded label events
2. **Redis Cache** - Deduplicates events by tracking did-label-negation state
3. **List Manager** - Handles adding/removing users from Bluesky lists
4. **Configuration** - Environment variable management and validation
5. **Main Orchestrator** - Coordinates all components and handles lifecycle

### Technology Stack

- **Runtime**: Bun
- **WebSocket + CBOR**: @atcute/cbor, @atcute/car
- **Bluesky API**: @atproto/api (authentication and list operations)
- **Logging**: pino, pino-pretty
- **Cache**: Redis
- **Environment**: dotenv
- **Deployment**: Docker, docker-compose

## File Structure

```
skywatch-listmanager/
├── src/
│   ├── config.ts          # Environment variables and validation
│   ├── constants.ts       # LISTS array configuration
│   ├── types.ts           # TypeScript interfaces
│   ├── logger.ts          # Pino logger configuration
│   ├── redis.ts           # Redis client and cache operations
│   ├── agent.ts           # [EXISTING] Bluesky authentication
│   ├── limits.ts          # [EXISTING] Rate limiting
│   ├── listmanager.ts     # [UPDATE] Add/remove list operations
│   ├── firehose.ts        # WebSocket firehose subscriber
│   └── main.ts            # Entry point and orchestration
├── Dockerfile             # Container image definition
├── docker-compose.yml     # Multi-container orchestration
├── .env.example           # Example environment variables
├── package.json           # [UPDATE] Add new dependencies
└── tsconfig.json          # [EXISTING] TypeScript configuration
```

## Implementation Steps

### Phase 1: Setup & Configuration

#### 1.1 Update Dependencies
- Add to package.json:
  - `@atcute/cbor`
  - `@atcute/client` (for firehose subscription)
  - `redis` (Node.js Redis client)
  - `@types/redis`

#### 1.2 Create Type Definitions (src/types.ts)
```typescript
export interface List {
  label: string;
  rkey: string;
}

export interface LabelEvent {
  ver?: number;
  src: string;
  uri: string;
  cid?: string;
  val: string;
  neg?: boolean;
  cts: string;
  exp?: string;
  sig?: Uint8Array;
}

export interface CacheKey {
  did: string;
  label: string;
  neg: boolean;
}
```

#### 1.3 Environment Configuration (src/config.ts)
- Load and validate environment variables:
  - `WSS_URL` - WebSocket firehose URL
  - `BSKY_HANDLE` - Bluesky authentication handle
  - `BSKY_PASSWORD` - Bluesky authentication password
  - `DID` - DID of account hosting lists
  - `PDS` - Personal Data Server (default: bsky.social)
  - `REDIS_URL` - Redis connection (default: redis://redis:6379)
- Export typed configuration object
- Validate required fields at startup

#### 1.4 Logger Setup (src/logger.ts)
- Configure pino with pino-pretty for development
- Set appropriate log levels
- Export logger instance

#### 1.5 Constants (src/constants.ts)
- Define `LISTS` array with empty default
- Add example in comments
- Export List type

### Phase 2: Redis Integration

#### 2.1 Redis Client (src/redis.ts)
- Initialize Redis client with connection URL
- Export connection status check
- Implement cache operations:
  - `getCacheKey(did: string, label: string, neg: boolean): string`
  - `hasProcessed(did: string, label: string, neg: boolean): Promise<boolean>`
  - `markProcessed(did: string, label: string, neg: boolean): Promise<void>`
- Handle connection errors gracefully
- Add reconnection logic

### Phase 3: List Management

#### 3.1 Update src/listmanager.ts
- Keep existing `addToList(label: string, did: string)` function
- Update to use `DID` instead of `MOD_DID`
- Add new `removeFromList(label: string, did: string)` function:
  1. Find list by label from LISTS array
  2. Construct listUri: `at://{DID}/app.bsky.graph.list/{rkey}`
  3. Query for listitem record with subject=did and list=listUri
  4. Delete the listitem record if found
  5. Wrap in rate limiter
  6. Handle errors appropriately

### Phase 4: Firehose Subscriber

#### 4.1 Create src/firehose.ts
- Import @atcute/client for WebSocket subscription
- Parse DAG-CBOR encoded label events
- Filter logic:
  - Only process events where `uri` is a DID (not an at-uri)
  - Extract DID from uri field
  - Match label value against LISTS array
- Deduplication flow:
  1. Check Redis cache for did-label-neg combination
  2. If already processed, skip
  3. If not processed, continue to add/remove
  4. Mark as processed in cache
- Event handling:
  - If `neg === true`: call `removeFromList(label, did)`
  - If `neg === false` or undefined: call `addToList(label, did)`
- Error handling:
  - Log parse errors
  - Continue processing on individual event failures
  - Reconnect on WebSocket disconnect
  - Implement exponential backoff for reconnection

#### 4.2 Reconnection Strategy
- Detect disconnection events
- Implement exponential backoff (start at 1s, max 60s)
- Log reconnection attempts
- Reset backoff on successful connection

### Phase 5: Main Application

#### 5.1 Create src/main.ts
- Initialize logger
- Load configuration
- Connect to Redis
- Authenticate with Bluesky (using existing agent.ts)
- Start firehose subscriber
- Implement graceful shutdown:
  - Catch SIGTERM, SIGINT
  - Close WebSocket connection
  - Close Redis connection
  - Log shutdown completion

#### 5.2 Process Lifecycle
1. Validate configuration at startup
2. Test Redis connection
3. Authenticate with Bluesky
4. Start firehose subscription
5. Process events in main loop
6. Handle shutdown signals gracefully

### Phase 6: Docker & Deployment

#### 6.1 Dockerfile
- Base image: `oven/bun:latest`
- Working directory: `/app`
- Copy package files and install dependencies
- Copy source code
- Expose any necessary ports (none needed for this app)
- Command: `bun run src/main.ts`

#### 6.2 docker-compose.yml
- Define two services:
  1. **redis**: Official Redis image, data persistence volume
  2. **app**: Built from Dockerfile, depends on Redis
- Environment variables via .env file
- Restart policy: unless-stopped
- Network: bridge (default)
- Volumes for Redis data persistence

#### 6.3 .env.example
- Document all environment variables with descriptions
- Provide sensible defaults where appropriate
- Leave sensitive values blank

### Phase 7: Documentation & Polish

#### 7.1 Update README.md
- Installation instructions
- Configuration guide
- Docker deployment steps
- Development workflow
- Troubleshooting section

#### 7.2 Code Quality
- Add JSDoc comments to key functions
- Ensure consistent error handling
- Add type safety throughout
- Follow existing code style

## Data Flow

```
1. Firehose WebSocket
   ↓ (DAG-CBOR encoded label event)
2. Parse & Decode
   ↓ (LabelEvent object)
3. Filter (user DIDs only)
   ↓ (Valid user label event)
4. Check Redis Cache
   ↓ (Not processed before)
5. Match Label → List
   ↓ (Found matching list)
6. Add or Remove from List
   ↓ (API call with rate limiting)
7. Update Redis Cache
   ↓ (Mark as processed)
8. Continue → next event
```

## Error Handling Strategy

1. **Configuration Errors**: Fail fast at startup, log clearly
2. **Redis Connection**: Retry with backoff, continue if cache unavailable (log warning)
3. **WebSocket Disconnection**: Auto-reconnect with exponential backoff
4. **Parse Errors**: Log and skip individual event, continue processing
5. **API Errors**: Log, respect rate limits, continue processing
6. **Unknown Label**: Log at debug level, skip processing

## Testing Approach

1. **Manual Testing**: Deploy with test configuration, emit test labels
2. **Verification**: Check that users are added/removed from lists correctly
3. **Deduplication**: Verify Redis cache prevents duplicate operations
4. **Reconnection**: Test WebSocket recovery after disconnection
5. **Rate Limiting**: Verify rate limiter prevents API throttling

## Performance Considerations

- Redis cache prevents duplicate API calls
- Rate limiting respects Bluesky API limits
- Concurrent request limiting (already in limits.ts)
- Efficient WebSocket processing (don't block on I/O)
- Graceful degradation if Redis unavailable

## Security Considerations

- Credentials stored in environment variables, never committed
- Docker secrets support for sensitive values
- Redis connection over internal Docker network
- No exposed ports beyond necessary

## Deployment Notes

- Run on Proxmox VM
- Use docker-compose for easy management
- Configure systemd for auto-restart on boot
- Log rotation for long-term operation
- Monitor Redis memory usage
- Monitor log output for errors

## Bugfix: Redis Label State Cleanup (2026-01-29)

### Problem
When a label is applied and then removed, Redis retains both states:
1. Add event → caches `label:{did}:{label}:false`
2. Remove event → caches `label:{did}:{label}:true`

These are **separate keys**. The `false` key persists, so future add events get blocked.

### Solution
When processing a label event, also delete the **opposite** state key. This allows bidirectional transitions:
- Add label → marks `false`, clears `true` (can be removed later)
- Remove label → marks `true`, clears `false` (can be re-added later)

### Changes
1. `src/redis.ts` - Add `clearProcessed()` function to delete opposite state
2. `src/firehose.ts` - Call `clearProcessed()` after `markProcessed()`

---

## Success Criteria

- [x] Successfully connects to firehose WebSocket
- [x] Correctly parses DAG-CBOR encoded labels
- [x] Filters for user DIDs only
- [x] Adds users to lists when labels applied
- [x] Removes users from lists when labels negated
- [x] Deduplicates events using Redis cache
- [x] Respects rate limits
- [x] Auto-reconnects on disconnection
- [x] Runs in Docker with docker-compose
- [x] Graceful shutdown handling
- [x] Comprehensive logging
- [x] Portable and configurable
