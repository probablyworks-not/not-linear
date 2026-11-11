# Subscription agents

Notlinear can connect a user's Claude and ChatGPT subscriptions in Settings → Models & keys → Subscriptions. Available models are fetched from connected accounts for the composer. Existing API-key providers remain available; subscription requests do not silently fall back to paid APIs.

## Setup

Install the optional companion with `python3 backend/agent_runtime/setup.py`, then restart Notlinear. Claude authentication uses the Claude Code runtime's own sign-in. ChatGPT authentication uses the documented browser authorization flow. Credentials are not stored in chat or Notes databases.

## Current verification

This integration is a prototype. Basic live Claude runtime streaming, ChatGPT model discovery, streaming and web research have been checked. Complete browser verification for chat, nested branches, canvas, Notes, attachments, cancellation, reload and cross-chat isolation remains outstanding. Provider capabilities and account eligibility can differ.

## Follow-up plan

1. Verify both providers across all existing features, including research status, sources, partial failures and persistence.
2. Measure worker startup, context preparation, time to first token, search and total response time before optimizing runtime reuse.
3. Improve grouped model selection, connection/error feedback, research progress and citations.
4. Consider file edits and command execution separately, with explicit folder selection and approval controls.
