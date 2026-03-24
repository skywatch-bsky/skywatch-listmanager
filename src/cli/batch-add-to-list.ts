import dotenv from "dotenv";
dotenv.config();

import { readFileSync } from "fs";
import { AtpAgent } from "@atproto/api";
import { LISTS } from "../constants.js";

const BSKY_HANDLE = process.env.BSKY_HANDLE || "";
const BSKY_PASSWORD = process.env.BSKY_PASSWORD || "";
const DID = process.env.DID || "";
const PDS = process.env.PDS || "bsky.social";

const RATE_LIMIT_BUFFER = 50;

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

async function waitForRateLimit(
  remaining: number | null,
  reset: number | null,
): Promise<void> {
  if (remaining === null || reset === null) return;
  if (remaining > RATE_LIMIT_BUFFER) return;

  const now = Math.floor(Date.now() / 1000);
  const waitSeconds = Math.max(reset - now, 1);
  console.log(
    `Rate limit low (${remaining} remaining), waiting ${waitSeconds}s until reset...`,
  );
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
}

function parseRateLimitHeaders(headers: Record<string, string | undefined>): {
  remaining: number | null;
  reset: number | null;
} {
  const remaining = headers["ratelimit-remaining"];
  const reset = headers["ratelimit-reset"];
  return {
    remaining: remaining ? parseInt(remaining, 10) : null,
    reset: reset ? parseInt(reset, 10) : null,
  };
}

async function main(): Promise<void> {
  const [filePath, label] = process.argv.slice(2);

  if (!filePath || !label) {
    printUsage();
    process.exit(1);
  }

  const list = LISTS.find((l) => l.label === label);
  if (!list) {
    console.error(`List not found for label: ${label}`);
    console.log("");
    console.log("Available labels:");
    for (const l of LISTS) {
      console.log(`  ${l.label}`);
    }
    process.exit(1);
  }

  if (!BSKY_HANDLE || !BSKY_PASSWORD || !DID) {
    console.error(
      "Missing required env vars: BSKY_HANDLE, BSKY_PASSWORD, DID",
    );
    process.exit(1);
  }

  let dids: string[];
  try {
    dids = parseDidsFromFile(filePath);
  } catch (err) {
    console.error(`Failed to read file: ${filePath}`, err);
    process.exit(1);
  }

  if (dids.length === 0) {
    console.log("No DIDs found in file");
    process.exit(0);
  }

  const agent = new AtpAgent({ service: `https://${PDS}` });
  await agent.login({ identifier: BSKY_HANDLE, password: BSKY_PASSWORD });
  console.log("Authenticated");

  const listUri = `at://${DID}/app.bsky.graph.list/${list.rkey}`;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const did of dids) {
    try {
      const response = await agent.com.atproto.repo.createRecord({
        collection: "app.bsky.graph.listitem",
        repo: DID,
        record: {
          subject: did,
          list: listUri,
          createdAt: new Date().toISOString(),
        },
      });
      succeeded++;
      console.log(
        `[${succeeded + failed + skipped}/${dids.length}] added ${did}`,
      );

      const { remaining, reset } = parseRateLimitHeaders(response.headers);
      await waitForRateLimit(remaining, reset);
    } catch (e: any) {
      if (e.message?.includes("RecordAlreadyExists")) {
        skipped++;
        console.log(
          `[${succeeded + failed + skipped}/${dids.length}] already listed ${did}`,
        );
      } else if (e.headers) {
        const { remaining, reset } = parseRateLimitHeaders(e.headers);
        if (e.status === 429) {
          console.log(
            `[${succeeded + failed + skipped}/${dids.length}] rate limited on ${did}, waiting...`,
          );
          await waitForRateLimit(0, reset);
          failed++;
        } else {
          failed++;
          console.error(
            `[${succeeded + failed + skipped}/${dids.length}] FAILED ${did}: ${e.message}`,
          );
          await waitForRateLimit(remaining, reset);
        }
      } else {
        failed++;
        console.error(
          `[${succeeded + failed + skipped}/${dids.length}] FAILED ${did}: ${e.message}`,
        );
      }
    }
  }

  console.log("");
  console.log(
    `Done: ${succeeded} added, ${skipped} already listed, ${failed} failed (${dids.length} total)`,
  );
}

main();
