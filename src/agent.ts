import { setGlobalDispatcher, Agent as Agent } from "undici";
setGlobalDispatcher(new Agent({ connect: { timeout: 20_000 } }));
import { BSKY_HANDLE, BSKY_PASSWORD, PDS } from "./config.js";
import { AtpAgent } from "@atproto/api";
import { authLimit } from "./limits.js";

export const agent = new AtpAgent({
  service: `https://${PDS}`,
});

let loginPromise: Promise<void> | null = null;

export function ensureLoggedIn(): Promise<void> {
  if (!loginPromise) {
    loginPromise = authLimit
      .schedule(() =>
        agent.login({
          identifier: BSKY_HANDLE,
          password: BSKY_PASSWORD,
        }),
      )
      .then(() => undefined)
      .catch((err) => {
        loginPromise = null;
        throw err;
      });
  }
  return loginPromise;
}
