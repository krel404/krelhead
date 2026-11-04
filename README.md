# Krelhead

A Discord bot for **World of Warcraft: Forever**, with item, NPC, spell, and quest lookup powered by Wowhead’s dedicated Forever database. This is an independent bot, not the official Wowhead bot.

## Commands

| Command | Example |
| --- | --- |
| `/search`, `/tooltip`, `/tt` | `/search query:Hogger` |
| `/item` | `/item query:Thunderfury` or `/item query:19019` |
| `/npc` | `/npc query:Hogger` |
| `/spell` | `/spell query:Frostbolt` |
| `/quest` | `/quest query:Hogger` |
| `/setup` | `/setup scope:channel mode:muted` |
| `/help` | Usage instructions, visible only to you |

All search commands accept names, `type:ID` references, and `https://www.wowhead.com/forever/...` entity URLs. General search commands also accept an optional `type` filter. Bare IDs require a type because the same ID can identify an item, NPC, spell, or quest.

Autocomplete includes type, ID, and spell rank when available. A search displays the best match as a tooltip PNG with a Wowhead link. Up to 25 matches are available in a dropdown for the person who ran the command. Pickers expire after 15 minutes or a restart. Images are rendered locally from Wowhead’s tooltip text, with item rarity colors; they are not screenshots of Wowhead’s website. If image rendering fails, the bot sends a text embed.

## Run locally

Requires Node.js **22.18 or newer**, npm, and a Discord application.

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), then create its bot and copy the bot token.
2. Run `npm ci`, then copy `.env.example` to `.env`.
3. Set `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID`. Set `DISCORD_GUILD_ID` to a test server ID for immediate server-scoped command registration. Keep the token in `.env`; do not paste it into chat or commit it.
4. Run `npm run invite`, open the printed URL, and invite the bot to your server. The URL requests the `bot` and `applications.commands` scopes and View Channels, Send Messages, Embed Links, and Attach Files permissions.
5. Run `npm run register` after inviting the bot. This replaces this application's commands in the selected scope.
6. Run `npm run dev`, or `npm run build && npm start`.
7. Try `/item query:Thunderfury`, `/npc query:Hogger`, `/spell query:Frostbolt`, and `/quest query:Hogger` in Discord.

The bot uses only the Guilds gateway intent. Message Content and other privileged intents are not required. Leave the application's Interactions Endpoint URL unset; interactions arrive through the gateway connection.

For global registration, remove `DISCORD_GUILD_ID` and rerun `npm run register`. Global command propagation can take time. Guild registrations remain separate; remove old test registrations in Discord or through the Discord API if you no longer want them.

## Preferences

`/setup` requires Manage Server for server preferences or Manage Channels for channel preferences. Channel overrides take priority. `mode:reset` removes the override; a channel then inherits the server preference. Help and setup remain available while lookups are muted.

Settings are written atomically to `DATA_DIR/settings.json` (default: `./data`). Preserve this directory across restarts and deployments. Run one bot process with this store; use a shared database before deploying multiple instances. Autocomplete and result caches are intentionally in memory.

## Forever data and source behavior

Forever launches November 4, 2026. Its pre-release database is incomplete. Missing entries do **not** fall back to Classic, Retail, or another expansion. Formula placeholders in source tooltips are retained; the bot does not invent or recalculate game stats.

The initial integration was verified against live Forever responses on November 3, 2026:

- Search: `https://www.wowhead.com/forever/search?q=...`. Parses JSON data islands referenced by the item's/NPC's/spell's/quest's Listview; does not execute scripts. Exact names rank first, followed by prefix matches and Wowhead search popularity.
- Tooltips: `https://nether.wowhead.com/forever/tooltip/{type}/{id}`.
- Attribution and navigation link back to Wowhead; icons use its image CDN.

These are website endpoints, not a guaranteed public API. The parser may need updating when Wowhead changes its markup or payloads. Challenge pages and upstream errors are reported as source failures, not empty results. Search data is cached for one minute, tooltips for five minutes, identical concurrent requests are coalesced, and upstream concurrency is limited. HTTP 429 pauses new upstream requests. Autocomplete has a 1.8-second response budget; a slow search may populate the cache for the next request.

Reference behavior: [Wowhead Discord bot](https://www.wowhead.com/discord-bot#search-items). Source: [Wowhead Forever database](https://www.wowhead.com/forever/database).

This first version focuses on the four lookup types. Premium/account linking, other game versions, localization, and automatic detection of links in chat are not implemented.

## Verify

```sh
npm run check
npm test
npm run build
npm run smoke
```

The first three commands run without Discord credentials or upstream network access after dependencies are installed. Tests cover real captured search/tooltip formats, version isolation, cache expiry, rate limiting, failures, rendering, permissions, and interaction handling. `npm run smoke` makes live Wowhead requests for all four types and writes sample PNGs to `artifacts/`; it requires network access but no Discord credentials. A real Discord connection still requires your application credentials and server invitation.

## Container

```sh
docker build -t krelhead .
docker run --rm --env-file .env -v krelhead-data:/app/data krelhead
```

Register commands separately before starting the container. The image includes fonts for tooltip rendering and runs as the unprivileged Node user.

The Docker recipe has not yet been validated: the local build was stopped after Docker Hub's base-image metadata lookup stalled. The native Node build, automated tests, and live Wowhead smoke checks passed.
