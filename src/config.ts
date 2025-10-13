import dotenv from "dotenv";

dotenv.config();

export const BSKY_HANDLE = process.env.BSKY_HANDLE || "";
export const BSKY_PASSWORD = process.env.BSKY_PASSWORD || "";
export const DID = process.env.DID || "";
export const PDS = process.env.PDS || "bsky.social";
export const WSS_URL = process.env.WSS_URL || "";
export const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";

export function validateConfig(): void {
  const required = [
    { name: "BSKY_HANDLE", value: BSKY_HANDLE },
    { name: "BSKY_PASSWORD", value: BSKY_PASSWORD },
    { name: "DID", value: DID },
    { name: "WSS_URL", value: WSS_URL },
  ];

  const missing = required.filter((r) => !r.value);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map((m) => m.name).join(", ")}`,
    );
  }
}
