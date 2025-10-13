import { login } from "./agent.js";
import { validateConfig } from "./config.js";
import { LISTS } from "./constants.js";
import { startFirehose, stopFirehose } from "./firehose.js";
import { logger } from "./logger.js";
import { connectRedis, disconnectRedis } from "./redis.js";

async function main() {
  try {
    logger.info("Starting Skywatch List Manager");

    logger.info("Validating configuration");
    validateConfig();

    logger.info({ lists: LISTS }, `Loaded ${LISTS.length} list configuration(s)`);

    if (LISTS.length === 0) {
      logger.warn(
        "No lists configured in constants.ts. The application will run but no events will be processed.",
      );
    }

    logger.info("Connecting to Redis");
    await connectRedis();

    logger.info("Authenticating with Bluesky");
    await login();
    logger.info("Successfully authenticated with Bluesky");

    logger.info("Starting firehose subscriber");
    startFirehose();

    logger.info("Skywatch List Manager is running");
  } catch (err) {
    logger.fatal({ err }, "Failed to start application");
    process.exit(1);
  }
}

async function shutdown() {
  logger.info("Shutting down gracefully");

  stopFirehose();
  await disconnectRedis();

  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main();
