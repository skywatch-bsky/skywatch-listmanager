import { pRateLimit } from "p-ratelimit"; // TypeScript

// create a rate limiter that allows up to 30 API calls per second,
// with max concurrency of 10

export const limit = pRateLimit({
  interval: 30000,
  rate: 280,
  concurrency: 48,
  maxDelay: 60000,
});
