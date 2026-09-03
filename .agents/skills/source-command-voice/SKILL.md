---
name: "source-command-voice"
description: "Switch to voice input for the rest of this session — questions go through Spokenly dictation instead of plain text."
---

# source-command-voice

Use this skill when the user asks to run the migrated source command `voice`.

## Command Template

# /voice — ask via Spokenly for the rest of this session

From this point forward in the current session, whenever you would ask the
user a question or wait on their input, call
`mcp__spokenly__ask_user_dictation` (load it first via `ToolSearch` with
query `select:mcp__spokenly__ask_user_dictation` if it is not already
loaded) instead of just asking in plain text.

This applies only to this session — it is not a standing rule, and does not
persist to other sessions or projects. If the user says "stop" / "back to
text" / similar, go back to asking normally in plain text for the rest of
the session.

Note: the Spokenly MCP server (`spokenly`) is registered at user scope,
so it should be available in every project on this machine. If
`ask_user_dictation` still isn't loadable via ToolSearch, say so plainly
rather than silently falling back to text without mentioning it.

Acknowledge in one short line that voice mode is on for this session, then
continue with whatever the user asks next.
