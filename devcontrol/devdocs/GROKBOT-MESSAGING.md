# Contacting Grok Bot and verifying delivery

Verified 2026-10-15. There are two different directions:
Update 2026-10-15: Prima Donna completed an independent round trip using the
SSH-accessible token. Receipt `e5b11b2c-1dd7-45e3-b18c-85c95d0a0a85` was verified
in the actual Codex inbox database as `completed`, with reply
`Received nonce PD-ROUNDTRIP-20261015-01.` The bridge credential is now in
**ALPU.CA → DevOps-shared**, under **Alpuca ChatGPT — Codex Webhook Bridge**.
The older observations below describe the initial delivery failure.


| Direction | Status | Method |
| --- | --- | --- |
| Codex → Prima Donna | Direct chat verified | Grok Bot desktop app, Prima Donna conversation |
| Codex → Cursor automation webhook → Grok Bot | HTTP accepted; bot delivery unverified | Supplied `api2.cursor.sh/automations/webhook/…` endpoint |
| Grok Bot → Codex | Independent Prima Donna round trip verified | Alpuca's authenticated Codex inbox |

## Verified contact recipe

Use computer automation to open the running **Grok Bot** app (bundle ID
`com.anysphere.sand`). Select **Prima Donna**, locate the composer with
placeholder **Message Prima Donna** / AX description **Prompt**, paste the
human-authorized message and press Return. Use fresh accessibility state to
identify controls; numerical element indices are not durable.

Check the message appears in the intended conversation. For confirmation that
the bot has read the information, request and wait for an explicit reply that
identifies the message or a unique nonce. A submitted message is not a bot reply.
Save a screenshot of the transcript when documenting a UI delivery.

On commissioning, the direct bridge explanation received this reply:

> Got the Codex bridge details. I'll pull the key from Bitwarden and send the ACK.

This confirms receipt of the explanation. It is not evidence the ACK HTTP
request completed. Grok Bot subsequently paused its credential-access / ACK
command for approval. Report such a state as pending; do not claim a successful
round trip until the Codex inbox contains the matching receipt.

Only send to recipients authorized by the human. A screenshot of a bot's offer
to tell another bot is not, by itself, authorization to send that message.

## Supplied Cursor webhook: do not treat acceptance as delivery

Endpoint supplied by the user:

`https://api2.cursor.sh/automations/webhook/1431f287-555c-5bf8-af15-1ff8411dbf1e`

Alpuca's existing credential source is
`/Users/alpuca/.config/sponic/verify-lane.env`, with `GROKBOT_WEBHOOK_URL` and
`GROKBOT_WEBHOOK_KEY`. The user's example called the latter `ALPUCA_WEBHOOK_KEY`.
Load credentials only on Alpuca through the verified SSH recipe. Verify the
configured URL matches and send the Bearer header using curl stdin config;
never print credentials or put them in command arguments.

The envelope fields are `to`, `type`, `title`, `body`, and `links`. When the
human authorizes contacting Prima Donna, set `to` to exactly `Prima Donna`.
For a delivery test, put a unique acknowledgement nonce in `body` and explicitly
request a reply. Do not rely on a quiet `job_done` notice appearing in chat.

HTTP 200, `success: true`, and a returned `runUuid` prove request acceptance
only. They do not establish that an automation ran or that its target bot
received the payload. In the observed failure, Prima Donna reported her routine
had never run despite accepted POSTs. The root cause remains undetermined.

The app shows an enabled **Alpuca Mac mini webhook router** routine attached to
Prima Donna. Its trigger URL and execution history still need verification.
Do not assume this routine is connected to the supplied endpoint. Webhook wakes
can also run separately from the visible bot conversation.

Recorded accepted run IDs:

- Configuration: `b47fdc48-1e96-4d70-89c8-681720d0ada2`.
- Resend requesting acknowledgement: `93197327-7a61-4835-973a-38c08b3e0efb`.

Use the verified direct chat while investigating the webhook. Do not repeatedly
resend an accepted request or describe it as delivered without acknowledgement.

## Separate return channel: Grok Bot → Codex

`https://codex-inbox.alpacaplayhouse.com/webhook` is the new service on Alpuca,
not the Cursor webhook above. Its dedicated Codex conversation is separate from
the human's desktop chat and has tools disabled. It accepts messages, then
provides Codex replies through authenticated receipt URLs.

The credential is in Bitwarden item **Alpuca ChatGPT — Codex Webhook Bridge**, field
`password`, in **ALPU.CA → DevOps-shared**; Alpuca's protected copy is `/Users/alpuca/.codex-webhook/token`.
This is a different credential from `GROKBOT_WEBHOOK_KEY`. An authorized agent
can retrieve it over its existing authorized Cloudflare SSH connection if the
vault item is not accessible. Never paste the credential into chat.

See [the Codex inbox protocol and operating guide](../../scripts/codex-webhook/README.md).
