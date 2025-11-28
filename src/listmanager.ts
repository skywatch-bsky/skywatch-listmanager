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
  const rkey = `${list.rkey}${did.replace(/[^a-zA-Z0-9]/g, "")}`;

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
    // We try multiple deterministic rkey formats, then fall back to listing records.
    // Format priority:
    //   1. New alphanumeric format: {listRkey}{didAlphanumeric}
    //   2. Old format with separators: {listRkey}-{didWithUnderscores}
    //   3. Legacy: list all records and find by subject/list match

    const alphanumericRkey = `${list.rkey}${did.replace(/[^a-zA-Z0-9]/g, "")}`;
    const legacySeparatorRkey = `${list.rkey}-${did.replace(/:/g, "_")}`;

    // 1. Try new alphanumeric format
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: DID,
        collection: "app.bsky.graph.listitem",
        rkey: alphanumericRkey,
      });
      logger.info(
        { label: list.label, did },
        "Successfully removed user from list (alphanumeric rkey)",
      );
      return;
    } catch (e) {
      // Expected to fail if record uses different format
    }

    // 2. Try old separator format
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: DID,
        collection: "app.bsky.graph.listitem",
        rkey: legacySeparatorRkey,
      });
      logger.info(
        { label: list.label, did },
        "Successfully removed user from list (legacy separator rkey)",
      );
      return;
    } catch (e) {
      // Expected to fail if record uses different format
    }

    // 3. Fallback to listing records
    logger.info(
      { label: list.label, did },
      "Deterministic deletes failed, trying fallback for legacy record",
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
