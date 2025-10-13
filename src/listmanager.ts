import { agent, isLoggedIn } from "./agent.js";
import { DID } from "./config.js";
import { LISTS } from "./constants.js";
import { limit } from "./limits.js";
import { logger } from "./logger.js";

export const addToList = async (label: string, did: string) => {
  await isLoggedIn;

  const list = LISTS.find((l) => l.label === label);
  if (!list) {
    logger.warn(
      { label },
      "List not found for label. Likely a label not associated with a list",
    );
    return;
  }

  logger.info({ label: list.label, did }, "Adding user to list");

  const listUri = `at://${DID}/app.bsky.graph.list/${list.rkey}`;
  const rkey = `${list.rkey}-${did.replace(/:/g, "_")}`;

  await limit(async () => {
    try {
      await agent.com.atproto.repo.createRecord({
        collection: "app.bsky.graph.listitem",
        repo: DID,
        rkey: rkey,
        record: {
          subject: did,
          list: listUri,
          createdAt: new Date().toISOString(),
        },
      });
      logger.info(
        { label: list.label, did },
        "Successfully added user to list",
      );
    } catch (e: any) {
      if (e.message?.includes("RecordAlreadyExists")) {
        logger.info({ label: list.label, did }, "User already in list");
      } else {
        logger.error(
          { err: e, label: list.label, did },
          "Failed to add user to list",
        );
      }
    }
  });
};

export const removeFromList = async (label: string, did: string) => {
  await isLoggedIn;

  const list = LISTS.find((l) => l.label === label);
  if (!list) {
    logger.warn(
      { label },
      "List not found for label. Likely a label not associated with a list",
    );
    return;
  }

  logger.info({ label: list.label, did }, "Removing user from list");

  const listUri = `at://${DID}/app.bsky.graph.list/${list.rkey}`;

  await limit(async () => {
    // To remove a list item, we need to know its rkey.
    // In the old system, the rkey was a random TID, so we had to list records to find it.
    // In the new system, we create records with a deterministic rkey.
    // The new `removeFromList` will first try to delete using the deterministic rkey.
    // If that fails, it will fall back to the old (slow) method to support deleting
    // items that were created before this change.

    // 1. Try deleting with the new deterministic rkey
    const deterministicRkey = `${list.rkey}-${did.replace(/:/g, "_")}`;
    let recordDeleted = false;

    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: DID,
        collection: "app.bsky.graph.listitem",
        rkey: deterministicRkey,
      });
      logger.info(
        { label: list.label, did },
        "Successfully removed user from list (deterministic rkey)",
      );
      recordDeleted = true;
    } catch (e) {
      // This is expected to fail if the record uses the old rkey scheme, or if it doesn't exist at all.
      // We'll proceed to the fallback.
    }

    if (recordDeleted) {
      return;
    }

    // 2. Fallback to old method for legacy records
    logger.info(
      { label: list.label, did },
      "Deterministic delete failed, trying fallback for legacy record",
    );

    try {
      let cursor: string | undefined;
      let listItemUri: string | undefined;

      do {
        const response = await agent.com.atproto.repo.listRecords({
          repo: DID,
          collection: "app.bsky.graph.listitem",
          limit: 100,
          cursor: cursor,
        });

        const listItem = response.data.records.find(
          (record: any) =>
            record.value.subject === did && record.value.list === listUri,
        );

        if (listItem) {
          listItemUri = listItem.uri;
          break;
        }

        cursor = response.data.cursor;
      } while (cursor);

      if (listItemUri) {
        const rkey = listItemUri.split("/").pop();
        await agent.com.atproto.repo.deleteRecord({
          repo: DID,
          collection: "app.bsky.graph.listitem",
          rkey: rkey!,
        });
        logger.info(
          { label: list.label, did },
          "Successfully removed user from list (fallback)",
        );
      } else {
        logger.warn(
          { label: list.label, did },
          "List item not found, user may not be in list (checked via fallback)",
        );
      }
    } catch (e) {
      logger.error(
        { err: e, label: list.label, did },
        "Failed to remove user from list (in fallback)",
      );
    }
  });
};
