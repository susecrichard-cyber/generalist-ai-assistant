# Generalist AI Assistant

A chat app that can ask, explain, brainstorm, draft, plan, and summarize — in short, balanced, or detailed answers. It also has a web-search mode that cites its sources, and it saves your chats so you can come back to them.

Built by Richard Frimpong with Muse.

## What it does

- Six response styles: Ask, Explain, Brainstorm, Draft, Plan, Summarize
- Three answer lengths: Concise, Balanced, Detailed
- Optional web-search mode with cited sources
- Persistent chats with auto-generated, editable titles
- Rename, regenerate, copy, and delete controls

## Stack

- React 19 + TypeScript (client in `client/`)
- Server actions in `server/src/actions.ts`, schema in `server/src/schema.ts`
- Drizzle SQL migrations in `drizzle/`
- Bun

## Note

This project was originally built as a Muse space, so it runs in that environment and uses the Muse space SDK (`@hatch/space-sdk`). It is shared here as the source code for the app, not as a standalone deployment.

## Run it in Muse

Open the Generalist AI Assistant space in Muse to use it.
