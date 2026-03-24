import { agent, isLoggedIn } from "./agent.js";
import { DID } from "./config.js";
import { LISTS } from "./constants.js";
import { limit } from "./limits.js";
import { logger } from "./logger.js";
import {
  getListItemRkey,
  setListItemRkey,
  deleteListItemRkey,
} from "./redis.js";

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

  const existingRkey = await getListItemRkey(label, did);
  if (existingRkey) {
    logger.info({ label: list.label, did }, "User already in list (per index)");
    return;
  }

  logger.info({ label: list.label, did }, "Adding user to list");

  const listUri = `at://${DID}/app.bsky.graph.list/${list.rkey}`;

  await limit(async () => {
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
      const rkey = response.data.uri.split("/").pop()!;
      await setListItemRkey(label, did, rkey);
      logger.info(
        { label: list.label, did, rkey },
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

  await limit(async () => {
    // 1. Try indexed rkey from Redis
    const indexedRkey = await getListItemRkey(label, did);
    if (indexedRkey) {
      try {
        await agent.com.atproto.repo.deleteRecord({
          repo: DID,
          collection: "app.bsky.graph.listitem",
          rkey: indexedRkey,
        });
        await deleteListItemRkey(label, did);
        logger.info(
          { label: list.label, did },
          "Successfully removed user from list (indexed rkey)",
        );
        return;
      } catch (e) {
        logger.warn(
          { err: e, label: list.label, did, rkey: indexedRkey },
          "Indexed rkey delete failed, falling back to listing",
        );
        await deleteListItemRkey(label, did);
      }
    }

    // 2. Fallback: list records and find by subject + list match
    const listUri = `at://${DID}/app.bsky.graph.list/${list.rkey}`;

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
          "List item not found, user may not be in list",
        );
      }
    } catch (e) {
      logger.error(
        { err: e, label: list.label, did },
        "Failed to remove user from list (fallback)",
      );
    }
  });
};
