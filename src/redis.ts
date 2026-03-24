import { createClient } from "redis";
import { REDIS_URL } from "./config.js";
import { logger } from "./logger.js";

export const redisClient = createClient({
  url: REDIS_URL,
});

redisClient.on("error", (err) => {
  logger.error({ err }, "Redis client error");
});

redisClient.on("connect", () => {
  logger.info("Redis client connected");
});

redisClient.on("ready", () => {
  logger.info("Redis client ready");
});

redisClient.on("reconnecting", () => {
  logger.warn("Redis client reconnecting");
});

export async function connectRedis(): Promise<void> {
  try {
    await redisClient.connect();
  } catch (err) {
    logger.error({ err }, "Failed to connect to Redis");
    throw err;
  }
}

export async function disconnectRedis(): Promise<void> {
  try {
    await redisClient.quit();
    logger.info("Redis client disconnected");
  } catch (err) {
    logger.error({ err }, "Error disconnecting Redis");
  }
}

function getCacheKey(did: string, label: string, neg: boolean): string {
  return `label:${did}:${label}:${neg}`;
}

export async function hasProcessed(
  did: string,
  label: string,
  neg: boolean,
): Promise<boolean> {
  try {
    const key = getCacheKey(did, label, neg);
    const exists = await redisClient.exists(key);
    return exists === 1;
  } catch (err) {
    logger.warn({ err, did, label, neg }, "Error checking Redis cache");
    return false;
  }
}

export async function markProcessed(
  did: string,
  label: string,
  neg: boolean,
): Promise<void> {
  try {
    const key = getCacheKey(did, label, neg);
    await redisClient.set(key, "1", {
      EX: 60 * 60 * 24 * 7,
    });
  } catch (err) {
    logger.warn({ err, did, label, neg }, "Error marking as processed in Redis");
  }
}

export async function clearProcessed(
  did: string,
  label: string,
  neg: boolean,
): Promise<void> {
  try {
    const oppositeKey = getCacheKey(did, label, !neg);
    await redisClient.del(oppositeKey);
  } catch (err) {
    logger.warn({ err, did, label, neg }, "Error clearing opposite state in Redis");
  }
}

function getListItemKey(label: string, did: string): string {
  return `listitem:${label}:${did}`;
}

export async function getListItemRkey(
  label: string,
  did: string,
): Promise<string | null> {
  try {
    return await redisClient.get(getListItemKey(label, did));
  } catch (err) {
    logger.warn({ err, label, did }, "Error reading list item rkey from Redis");
    return null;
  }
}

export async function setListItemRkey(
  label: string,
  did: string,
  rkey: string,
): Promise<void> {
  try {
    await redisClient.set(getListItemKey(label, did), rkey);
  } catch (err) {
    logger.warn({ err, label, did, rkey }, "Error storing list item rkey in Redis");
  }
}

export async function deleteListItemRkey(
  label: string,
  did: string,
): Promise<void> {
  try {
    await redisClient.del(getListItemKey(label, did));
  } catch (err) {
    logger.warn({ err, label, did }, "Error deleting list item rkey from Redis");
  }
}
