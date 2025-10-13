import { decode } from "@atcute/cbor";
import { WSS_URL } from "./config.js";
import { LISTS } from "./constants.js";
import { addToList, removeFromList } from "./listmanager.js";
import { logger } from "./logger.js";
import { hasProcessed, markProcessed } from "./redis.js";
import { LabelEvent } from "./types.js";

let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 60000;
const INITIAL_RECONNECT_DELAY = 1000;

function getReconnectDelay(): number {
  const delay = Math.min(
    INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY,
  );
  reconnectAttempts++;
  return delay;
}

function extractDidFromUri(uri: string): string | null {
  if (uri.startsWith("did:")) {
    return uri;
  }
  return null;
}

async function handleLabelEvent(event: LabelEvent): Promise<void> {
  try {
    const did = extractDidFromUri(event.uri);
    if (!did) {
      logger.debug({ uri: event.uri }, "Skipping non-DID URI");
      return;
    }

    const list = LISTS.find((l) => l.label === event.val);
    if (!list) {
      logger.debug({ label: event.val }, "Label not configured in LISTS");
      return;
    }

    const neg = event.neg ?? false;

    if (await hasProcessed(did, event.val, neg)) {
      logger.debug(
        { did, label: event.val, neg },
        "Event already processed, skipping",
      );
      return;
    }

    if (neg) {
      await removeFromList(event.val, did);
    } else {
      await addToList(event.val, did);
    }

    await markProcessed(did, event.val, neg);
  } catch (err) {
    logger.error({ err, event }, "Error handling label event");
  }
}

function parseMessage(data: any): void {
  try {
    let parsed: any;

    if (data instanceof ArrayBuffer) {
      parsed = decode(new Uint8Array(data));
    } else if (data instanceof Uint8Array) {
      parsed = decode(data);
    } else if (typeof data === "string") {
      try {
        parsed = JSON.parse(data);
      } catch {
        logger.warn("Received non-JSON string message");
        return;
      }
    } else {
      parsed = data;
    }

    if (parsed.labels && Array.isArray(parsed.labels)) {
      for (const label of parsed.labels) {
        handleLabelEvent(label as LabelEvent);
      }
    } else if (parsed.label) {
      handleLabelEvent(parsed.label as LabelEvent);
    } else {
      logger.debug({ parsed }, "Message does not contain label data");
    }
  } catch (err) {
    logger.error({ err }, "Error parsing message");
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    logger.debug("WebSocket already connected or connecting");
    return;
  }

  logger.info({ url: WSS_URL }, "Connecting to firehose");

  ws = new WebSocket(WSS_URL);

  ws.addEventListener("open", () => {
    logger.info("Firehose connection established");
    reconnectAttempts = 0;
  });

  ws.addEventListener("message", (event) => {
    parseMessage(event.data);
  });

  ws.addEventListener("error", (event) => {
    logger.error({ event }, "Firehose WebSocket error");
  });

  ws.addEventListener("close", (event) => {
    logger.warn({ code: event.code, reason: event.reason }, "Firehose connection closed");
    scheduleReconnect();
  });
}

function scheduleReconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }

  const delay = getReconnectDelay();
  logger.info({ delay, attempt: reconnectAttempts }, "Scheduling reconnect");

  reconnectTimeout = setTimeout(() => {
    connect();
  }, delay);
}

export function startFirehose(): void {
  connect();
}

export function stopFirehose(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws) {
    logger.info("Closing firehose connection");
    ws.close();
    ws = null;
  }
}
