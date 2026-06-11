import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimiter } from "./limits.js";

type FakeTime = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
};

function makeFakeTime(start = 0): FakeTime {
  let current = start;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: (ms: number) => {
      sleeps.push(ms);
      current += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

function responseWith(remaining: number, resetEpochSeconds: number) {
  return {
    headers: {
      "ratelimit-remaining": String(remaining),
      "ratelimit-reset": String(resetEpochSeconds),
    },
  };
}

test("passes results through without waiting when capacity is high", async () => {
  const time = makeFakeTime();
  const limiter = createRateLimiter("test", {
    buffer: 2,
    maxRetries: 3,
    now: time.now,
    sleep: time.sleep,
  });

  const result = await limiter.schedule(() =>
    Promise.resolve(responseWith(100, 60)),
  );

  assert.equal(result.headers["ratelimit-remaining"], "100");
  assert.deepEqual(time.sleeps, []);
});

test("waits until reset when remaining drops to the buffer", async () => {
  const time = makeFakeTime(0);
  const limiter = createRateLimiter("test", {
    buffer: 2,
    maxRetries: 3,
    now: time.now,
    sleep: time.sleep,
  });

  await limiter.schedule(() => Promise.resolve(responseWith(2, 60)));

  let called = false;
  await limiter.schedule(() => {
    called = true;
    return Promise.resolve(responseWith(100, 120));
  });

  assert.ok(called);
  assert.deepEqual(time.sleeps, [60_000]);
});

test("retries after reset on 429 and succeeds", async () => {
  const time = makeFakeTime(0);
  const limiter = createRateLimiter("test", {
    buffer: 2,
    maxRetries: 3,
    now: time.now,
    sleep: time.sleep,
  });

  let calls = 0;
  const result = await limiter.schedule(() => {
    calls++;
    if (calls === 1) {
      return Promise.reject({
        status: 429,
        headers: {
          "ratelimit-remaining": "0",
          "ratelimit-reset": "30",
        },
      });
    }
    return Promise.resolve(responseWith(100, 90));
  });

  assert.equal(calls, 2);
  assert.equal(result.headers["ratelimit-remaining"], "100");
  assert.deepEqual(time.sleeps, [30_000]);
});

test("gives up after maxRetries consecutive 429s", async () => {
  const time = makeFakeTime(0);
  const limiter = createRateLimiter("test", {
    buffer: 2,
    maxRetries: 2,
    now: time.now,
    sleep: time.sleep,
  });

  let calls = 0;
  await assert.rejects(
    limiter.schedule(() => {
      calls++;
      return Promise.reject({
        status: 429,
        headers: {
          "ratelimit-remaining": "0",
          "ratelimit-reset": String((calls + 1) * 10),
        },
      });
    }),
    (err: { status: number }) => err.status === 429,
  );

  assert.equal(calls, 3);
});

test("non-429 errors propagate without retry", async () => {
  const time = makeFakeTime(0);
  const limiter = createRateLimiter("test", {
    buffer: 2,
    maxRetries: 3,
    now: time.now,
    sleep: time.sleep,
  });

  let calls = 0;
  await assert.rejects(
    limiter.schedule(() => {
      calls++;
      return Promise.reject(new Error("InvalidRequest"));
    }),
    /InvalidRequest/,
  );

  assert.equal(calls, 1);
  assert.deepEqual(time.sleeps, []);
});
