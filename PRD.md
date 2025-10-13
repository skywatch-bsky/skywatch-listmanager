# Skywatch List Manager

Skywatch emits a DAG-CBOR encoded firehose of moderation decisions at `wss://ozone.skywatch.blue/xrpc/com.atproto.label.subscribeLabels`. Currently, this firehose is used to manage lists of blocked users by label, and a very out of date ruby program is used for this. As Skywatch.blue's moderation stack is written in Typescript, I would like to implement a new tool in Typescript.

A label event looks like the following:

```json
"label": {
  "type": "object",
  "description": "Metadata tag on an atproto resource (eg, repo or record).",
  "required": ["src", "uri", "val", "cts"],
  "properties": {
    "ver": {
      "type": "integer",
      "description": "The AT Protocol version of the label object."
    },
    "src": {
      "type": "string",
      "format": "did",
      "description": "DID of the actor who created this label."
    },
    "uri": {
      "type": "string",
      "format": "uri",
      "description": "AT URI of the record, repository (account), or other resource that this label applies to."
    },
    "cid": {
      "type": "string",
      "format": "cid",
      "description": "Optionally, CID specifying the specific version of 'uri' resource this label applies to."
    },
    "val": {
      "type": "string",
      "maxLength": 128,
      "description": "The short string name of the value or type of this label."
    },
    "neg": {
      "type": "boolean",
      "description": "If true, this is a negation label, overwriting a previous label."
    },
    "cts": {
      "type": "string",
      "format": "datetime",
      "description": "Timestamp when this label was created."
    },
    "exp": {
      "type": "string",
      "format": "datetime",
      "description": "Timestamp at which this label expires (no longer applies)."
    },
    "sig": {
      "type": "bytes",
      "description": "Signature of dag-cbor encoded label."
    }
  }
},
```

`labels.uri` is the URI against which the label is applied. It can take two forms, a reference to a post in the form of an at-uri: `at://did:plc:7i7s4avtaolnrgc3ubcoqrq3/app.bsky.feed.post/3lf5u32pxwk2f` or a reference to a user in the form of a did: `did:plc:piwuaowuiykzaare644i5fre`. For the purposes of this program, we are only interested in users.

`labels.val` is the label value being emitted.

`labels.neg` is a boolean indicating whether this label is a negation label, overwriting a previous label.

## Requirements

- src/constants.ts should include a LISTS array which contains a list of labels and their corresponding rkeys. The array should be empty by default for users to configure. Example structure:

  ```Typescript
  export const LISTS: List[] = [
    // Example:
    // {
    //   label: "blue-heart-emoji",
    //   rkey: "3lfbtgosyyi22",
    // }
  ]
  ```
- lists can be constructed as `at://{DID}/app.bsky.graph.list/{rkey}` where DID is the account hosting the lists
- if `labels.neg` equals `true` then the user should be removed from the corresponding list by deleting the listitem record
- use @atcute/cbor and @atcute/car for parsing the DAG-CBOR encoded firehose
- use @atproto/api for authentication and list management operations
- use pino and pino-pretty for logging
- be mindful of bluesky rate-limits
- make this portable, so that others can use it as a part of their stack
- use dotenv for environment variables:
  - `WSS_URL`: WebSocket URL for the label firehose (leave blank for users to configure)
  - `BSKY_HANDLE`: Bluesky handle for authentication
  - `BSKY_PASSWORD`: Bluesky password for authentication
  - `DID`: DID of the account hosting the lists
  - `PDS`: Personal Data Server URL (e.g., bsky.social)
  - `REDIS_URL`: Redis connection URL (default: redis://redis:6379)
- use Redis for storing the most recent state for each did-label-negation triad. If we see the same did-label-negation status as we previously saw, we should skip processing it to avoid duplicate list entries or unnecessary API calls.
- an example of how to add a user to a list is found in `src/listmanager.ts`
- limits.ts contains rate limiting logic for API calls
- use bun as the runtime
- this will be running on a VM in a proxmox server. provide docker and docker-compose configuration
