import { login } from "../agent.js";
import { LISTS } from "../constants.js";
import { addToList } from "../listmanager.js";
import { logger } from "../logger.js";

function printUsage(): void {
  console.log("Usage: npx tsx src/cli/add-to-list.ts <did> <label>");
  console.log("");
  console.log("Example:");
  console.log('  npx tsx src/cli/add-to-list.ts "did:plc:example" "maga-trump"');
  console.log("");
  console.log("Available labels:");
  for (const list of LISTS) {
    console.log(`  ${list.label}`);
  }
}

async function main(): Promise<void> {
  const [did, label] = process.argv.slice(2);

  if (!did || !label) {
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

  try {
    await login();
    logger.info("Authenticated with Bluesky");

    await addToList(label, did);
    logger.info("Done");
  } catch (err) {
    logger.fatal({ err }, "Failed to add user to list");
    process.exit(1);
  }
}

main();
