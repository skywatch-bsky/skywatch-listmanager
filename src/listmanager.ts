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

  await limit(async () => {
    try {
      await agent.com.atproto.repo.createRecord({
        collection: "app.bsky.graph.listitem",
        repo: DID,
        record: {
          subject: did,
          list: listUri,
          createdAt: new Date().toISOString(),
        },
      });
      logger.info({ label: list.label, did }, "Successfully added user to list");
    } catch (e) {
      logger.error({ err: e, label: list.label, did }, "Failed to add user to list");
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
    try {
      const response = await agent.com.atproto.repo.listRecords({
        repo: DID,
        collection: "app.bsky.graph.listitem",
        limit: 100,
      });

      const listItem = response.data.records.find(
        (record: any) =>
          record.value.subject === did && record.value.list === listUri,
      );

      if (!listItem) {
        logger.warn(
          { label: list.label, did },
          "List item not found, user may not be in list",
        );
        return;
      }

      const rkey = listItem.uri.split("/").pop();

      await agent.com.atproto.repo.deleteRecord({
        repo: DID,
        collection: "app.bsky.graph.listitem",
        rkey: rkey!,
      });

      logger.info({ label: list.label, did }, "Successfully removed user from list");
    } catch (e) {
      logger.error(
        { err: e, label: list.label, did },
        "Failed to remove user from list",
      );
    }
  });
};
