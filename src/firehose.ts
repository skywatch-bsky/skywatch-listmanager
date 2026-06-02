import { decodeFirst } from "@atcute/cbor";
import { readFileSync, writeFile, writeFileSync } from "fs";
import { WSS_URL } from "./config.js";
import { LISTS } from "./constants.js";
import { createEventProcessor, type EventProcessor } from "./event-processor.js";
import { addToList, removeFromList } from "./listmanager.js";
import { logger } from "./logger.js";
import { hasProcessed, markAndClearProcessed } from "./redis.js";
import { LabelEvent } from "./types.js";

let ws: WebSocket | null = null;
let reconnectTimeout: NodeJS.Timeout | null = null;
let reconnectAttempts = 0;
let cursor: string = "";
let processor: EventProcessor | null = null;
let backpressurePaused = false;

const MAX_RECONNECT_DELAY = 60000;
const INITIAL_RECONNECT_DELAY = 1000;
const CURSOR_FILE = "./cursor.txt";
const CURSOR_FLUSH_INTERVAL_MS = 5000;

let cursorDirty = false;
let cursorFlushTimer: NodeJS.Timeout | null = null;

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

  await markAndClearProcessed(did, event.val, neg);
}

function updateCursor(seq: string): void {
  cursor = seq;
  cursorDirty = true;
}

function flushCursor(): void {
  if (!cursorDirty) return;
  cursorDirty = false;

  writeFile(CURSOR_FILE, cursor, "utf8", (err) => {
    if (err) {
      logger.warn({ err }, "Failed to save cursor");
    } else {
      logger.debug({ cursor }, "Flushed cursor to disk");
    }
  });
}

export function flushCursorSync(): void {
  if (!cursorDirty) return;
  cursorDirty = false;
  try {
    writeFileSync(CURSOR_FILE, cursor, "utf8");
    logger.info({ cursor }, "Flushed cursor on shutdown");
  } catch (err) {
    logger.warn({ err }, "Failed to flush cursor on shutdown");
  }
}

function startCursorFlush(): void {
  if (cursorFlushTimer) return;
  cursorFlushTimer = setInterval(flushCursor, CURSOR_FLUSH_INTERVAL_MS);
}

function stopCursorFlush(): void {
  if (cursorFlushTimer) {
    clearInterval(cursorFlushTimer);
    cursorFlushTimer = null;
  }
  flushCursor();
}

function loadCursor(): string {
  try {
    const saved = readFileSync(CURSOR_FILE, "utf8").trim();
    logger.info({ cursor: saved }, "Loaded cursor from file");
    return saved;
  } catch (err) {
    logger.info("No cursor file found, starting from live");
    return "";
  }
}

function parseMessage(data: any): void {
  try {
    let buffer: Uint8Array;

    if (data instanceof ArrayBuffer) {
      buffer = new Uint8Array(data);
    } else if (data instanceof Uint8Array) {
      buffer = data;
    } else if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (parsed.seq) {
          updateCursor(parsed.seq.toString());
        }
        processLabels(parsed);
        return;
      } catch {
        logger.warn("Received non-JSON string message");
        return;
      }
    } else {
      processLabels(data);
      return;
    }

    const [header, remainder] = decodeFirst(buffer);
    const [body] = decodeFirst(remainder);

    if (body && typeof body === "object" && "seq" in body) {
      updateCursor(body.seq.toString());
    }

    processLabels(body);
  } catch (err) {
    logger.error({ err }, "Error parsing message");
  }
}

function enqueueEvent(event: LabelEvent): void {
  if (!processor) return;

  const accepted = processor.enqueue(() => handleLabelEvent(event));

  if (!accepted && !backpressurePaused) {
    backpressurePaused = true;
    logger.warn(
      { pending: processor.pending() },
      "Backpressure: queue full, pausing websocket",
    );
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close(4000, "backpressure");
    }
  }
}

function processLabels(parsed: any): void {
  if (parsed.labels && Array.isArray(parsed.labels)) {
    for (const label of parsed.labels) {
      enqueueEvent(label as LabelEvent);
    }
  } else if (parsed.label) {
    enqueueEvent(parsed.label as LabelEvent);
  } else {
    logger.debug({ parsed }, "Message does not contain label data");
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    logger.debug("WebSocket already connected or connecting");
    return;
  }

  const url = cursor ? `${WSS_URL}?cursor=${cursor}` : WSS_URL;
  logger.info({ url, cursor }, "Connecting to firehose");

  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    logger.info("Firehose connection established");
    reconnectAttempts = 0;
    backpressurePaused = false;
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

  const delay = backpressurePaused ? 1000 : getReconnectDelay();
  logger.info({ delay, attempt: reconnectAttempts, backpressurePaused }, "Scheduling reconnect");

  reconnectTimeout = setTimeout(() => {
    connect();
  }, delay);
}

export function startFirehose(): void {
  cursor = loadCursor();

  processor = createEventProcessor({
    concurrency: 16,
    highWaterMark: 512,
    lowWaterMark: 128,
  });

  processor.onDrain(() => {
    if (backpressurePaused) {
      logger.info("Backpressure relieved, reconnecting");
      backpressurePaused = false;
      connect();
    }
  });

  startCursorFlush();
  connect();
}

export async function stopFirehose(): Promise<void> {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws) {
    logger.info("Closing firehose connection");
    ws.close();
    ws = null;
  }

  if (processor) {
    logger.info({ pending: processor.pending() }, "Draining event processor");
    await processor.drain();
    processor = null;
  }

  stopCursorFlush();
  flushCursorSync();
}
