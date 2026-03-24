import { readFileSync } from "fs";
import { login } from "../agent.js";
import { LISTS } from "../constants.js";
import { addToList } from "../listmanager.js";
import { logger } from "../logger.js";
import { connectRedis, disconnectRedis } from "../redis.js";

function printUsage(): void {
  console.log("Usage: npx tsx src/cli/batch-add-to-list.ts <file> <label>");
  console.log("");
  console.log("Arguments:");
  console.log("  file   Path to a text file with one DID per line");
  console.log("  label  The label whose list to add DIDs to");
  console.log("");
  console.log("Example:");
  console.log(
    '  npx tsx src/cli/batch-add-to-list.ts dids.txt "maga-trump"',
  );
  console.log("");
  console.log("Available labels:");
  for (const list of LISTS) {
    console.log(`  ${list.label}`);
  }
}

function parseDidsFromFile(filePath: string): string[] {
  const content = readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function main(): Promise<void> {
  const [filePath, label] = process.argv.slice(2);

  if (!filePath || !label) {
    printUsage();
    process.exit(1);
  }

  const list = LISTS.find((l) => l.label === label);
  if (!list) {
    logger.error({ label }, "List not found for label");
    console.log("");
    console.log("Available labels:");
    for (const l of LISTS) {
      console.log(`  ${l.label}`);
    }
    process.exit(1);
  }

  let dids: string[];
  try {
    dids = parseDidsFromFile(filePath);
  } catch (err) {
    logger.fatal({ err, filePath }, "Failed to read DIDs file");
    process.exit(1);
  }

  if (dids.length === 0) {
    logger.warn("No DIDs found in file");
    process.exit(0);
  }

  logger.info({ label, count: dids.length }, "Starting batch add");

  try {
    await connectRedis();
    await login();
    logger.info("Authenticated with Bluesky");

    let succeeded = 0;
    let failed = 0;

    for (const did of dids) {
      try {
        await addToList(label, did, { force: true });
        succeeded++;
      } catch (err) {
        logger.error({ err, did }, "Failed to add DID");
        failed++;
      }
    }

    logger.info(
      { total: dids.length, succeeded, failed },
      "Batch add complete",
    );
  } catch (err) {
    logger.fatal({ err }, "Batch add failed");
    process.exit(1);
  } finally {
    await disconnectRedis();
  }
}

main();
