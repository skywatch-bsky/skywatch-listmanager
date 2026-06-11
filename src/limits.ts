import { logger } from "./logger.js";

type RateLimitHeaders = Record<string, string | undefined>;

type RateLimitedResult = {
  headers?: RateLimitHeaders;
};

type RateLimiterOptions = {
  readonly buffer: number;
  readonly maxRetries: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

export type RateLimiter = {
  schedule<T extends RateLimitedResult>(fn: () => Promise<T>): Promise<T>;
};

const FALLBACK_WAIT_MS = 30_000;
const MIN_WAIT_MS = 1_000;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function headersOf(err: unknown): RateLimitHeaders | undefined {
  if (err && typeof err === "object" && "headers" in err) {
    const headers = (err as { headers?: unknown }).headers;
    if (headers && typeof headers === "object") {
      return headers as RateLimitHeaders;
    }
  }
  return undefined;
}

function statusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") {
      return status;
    }
  }
  return undefined;
}

export function createRateLimiter(
  name: string,
  options: RateLimiterOptions,
): RateLimiter {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;

  let remaining: number | null = null;
  let resetAtMs: number | null = null;

  function updateFromHeaders(headers: RateLimitHeaders | undefined): void {
    if (!headers) return;

    const remainingHeader = headers["ratelimit-remaining"];
    const resetHeader = headers["ratelimit-reset"];
    if (remainingHeader === undefined || resetHeader === undefined) return;

    const parsedRemaining = parseInt(remainingHeader, 10);
    const parsedReset = parseInt(resetHeader, 10);
    if (Number.isNaN(parsedRemaining) || Number.isNaN(parsedReset)) return;

    remaining = parsedRemaining;
    resetAtMs = parsedReset * 1000;
  }

  function waitUntilResetMs(): number {
    if (resetAtMs === null) return FALLBACK_WAIT_MS;
    return Math.max(resetAtMs - now(), MIN_WAIT_MS);
  }

  function clearState(): void {
    remaining = null;
    resetAtMs = null;
  }

  async function waitForCapacity(): Promise<void> {
    while (remaining !== null && remaining <= options.buffer) {
      const waitMs = waitUntilResetMs();
      logger.warn(
        { limiter: name, remaining, waitMs },
        "Rate limit low, waiting for reset",
      );
      await sleep(waitMs);
      clearState();
    }
  }

  return {
    async schedule<T extends RateLimitedResult>(
      fn: () => Promise<T>,
    ): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        await waitForCapacity();
        if (remaining !== null) {
          remaining--;
        }

        try {
          const result = await fn();
          updateFromHeaders(result.headers);
          return result;
        } catch (err) {
          updateFromHeaders(headersOf(err));

          if (statusOf(err) === 429 && attempt < options.maxRetries) {
            const waitMs = waitUntilResetMs();
            logger.warn(
              { limiter: name, attempt, waitMs },
              "Rate limited (429), waiting for reset before retry",
            );
            await sleep(waitMs);
            clearState();
            continue;
          }

          throw err;
        }
      }
    },
  };
}

export const authLimit = createRateLimiter("auth", {
  buffer: 5,
  maxRetries: 5,
});

export const writeLimit = createRateLimiter("write", {
  buffer: 50,
  maxRetries: 5,
});
