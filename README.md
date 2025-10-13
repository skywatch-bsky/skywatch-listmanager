# Skywatch List Manager

Automated list management for Bluesky based on label events from a DAG-CBOR encoded firehose.

## Overview

This tool subscribes to a WebSocket firehose of moderation labels and automatically manages Bluesky lists. When a label is applied to a user, they are added to the corresponding list. When a label is negated, they are removed.

## Features

- 🔥 Real-time firehose subscription with DAG-CBOR decoding
- 🔄 Automatic reconnection with exponential backoff
- 📋 Multi-list management based on label mappings
- 🚫 Deduplication using Redis cache
- ⚡ Rate limiting to respect Bluesky API limits
- 🐳 Docker and docker-compose ready
- 📊 Structured logging with pino

## Prerequisites

- [Bun](https://bun.sh) (for local development)
- Docker and docker-compose (for deployment)
- A Bluesky account with list management permissions
- Access to a label firehose WebSocket endpoint

## Installation

### Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

3. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

4. Configure your environment variables in `.env`:
   - `BSKY_HANDLE`: Your Bluesky handle
   - `BSKY_PASSWORD`: Your Bluesky password or app password
   - `DID`: DID of the account hosting the lists
   - `PDS`: Personal Data Server (usually `bsky.social`)
   - `WSS_URL`: WebSocket URL for the label firehose
   - `REDIS_URL`: Redis connection URL (default: `redis://redis:6379`)

5. Configure your lists in `src/constants.ts`:
   ```typescript
   export const LISTS: List[] = [
     {
       label: "blue-heart-emoji",
       rkey: "3lfbtgosyyi22",
     },
     // Add more lists as needed
   ];
   ```

6. Run locally:
   ```bash
   bun run dev
   ```

### Docker Deployment

1. Complete steps 1-5 from Local Development

2. Build and start the containers:
   ```bash
   docker-compose up -d
   ```

3. View logs:
   ```bash
   docker-compose logs -f app
   ```

4. Stop the containers:
   ```bash
   docker-compose down
   ```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BSKY_HANDLE` | Yes | - | Your Bluesky handle |
| `BSKY_PASSWORD` | Yes | - | Your Bluesky password or app password |
| `DID` | Yes | - | DID of the account hosting the lists |
| `PDS` | No | `bsky.social` | Personal Data Server URL |
| `WSS_URL` | Yes | - | WebSocket URL for the label firehose |
| `REDIS_URL` | No | `redis://redis:6379` | Redis connection URL |
| `LOG_LEVEL` | No | `info` | Logging level (debug, info, warn, error) |

### List Configuration

Edit `src/constants.ts` to map labels to list rkeys:

```typescript
export const LISTS: List[] = [
  {
    label: "spam-account",
    rkey: "3lfbtgosyyi22",
  },
  {
    label: "harassment",
    rkey: "3lfbtgosyyi23",
  },
];
```

The `rkey` is the unique identifier for each list. You can find it in the list's AT-URI:
`at://{DID}/app.bsky.graph.list/{rkey}`

## How It Works

1. **Firehose Connection**: Connects to the WebSocket firehose and listens for label events
2. **Event Parsing**: Decodes DAG-CBOR encoded messages and extracts label information
3. **Filtering**: Only processes events where the URI is a DID (user labels, not post labels)
4. **Deduplication**: Checks Redis cache to avoid processing duplicate events
5. **List Management**:
   - If `neg: false` (or missing): Adds user to the corresponding list
   - If `neg: true`: Removes user from the corresponding list
6. **Caching**: Marks the event as processed in Redis
7. **Rate Limiting**: Respects Bluesky API rate limits

## Development

### Project Structure

```
skywatch-listmanager/
├── src/
│   ├── agent.ts          # Bluesky authentication
│   ├── config.ts         # Environment configuration
│   ├── constants.ts      # List mappings
│   ├── firehose.ts       # WebSocket subscriber
│   ├── limits.ts         # Rate limiting
│   ├── listmanager.ts    # List add/remove operations
│   ├── logger.ts         # Logging configuration
│   ├── main.ts           # Application entry point
│   ├── redis.ts          # Redis cache operations
│   └── types.ts          # TypeScript type definitions
├── Dockerfile            # Container image
├── docker-compose.yml    # Multi-container setup
└── .env                  # Environment variables (not committed)
```

### Scripts

- `bun run dev` - Run with hot reload
- `bun run start` - Run in production mode
- `bun run format` - Format code with Prettier
- `bun run lint` - Lint code with ESLint
- `bun run lint:fix` - Fix linting issues

## Troubleshooting

### Connection Issues

- Verify `WSS_URL` is correct and accessible
- Check that Redis is running and accessible
- Ensure Bluesky credentials are valid

### No Events Being Processed

- Verify lists are configured in `src/constants.ts`
- Check that label values match your configuration
- Review logs for filtering or parsing errors

### Rate Limiting

- The application includes rate limiting by default
- Adjust settings in `src/limits.ts` if needed

### Redis Connection Errors

- Ensure Redis container is healthy: `docker-compose ps`
- Check Redis logs: `docker-compose logs redis`
- Verify `REDIS_URL` is correct

## License

See LICENSE file for details.

## Support

For issues and feature requests, please open an issue on the repository.
