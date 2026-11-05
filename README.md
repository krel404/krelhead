# Tome — a WoW Forever guild companion

Renamed from Syl. On first startup after stopping the old bot, `data/syl.sqlite` migrates to `data/tome.sqlite`, with a `tome.sqlite.pre-rename.bak` backup. Saved facts and guild defaults are preserved. Character storage and uploader tokens are unchanged; older snapshot exports remain importable.

Tome is an OpenAI-powered WoW Forever guild companion. Mention her directly or reply to one of her messages to chat, retrieve real Wowhead tooltips, research game questions, or look up Discord members and roles. Ambient chat does not trigger a response.

Tome defaults to brief, direct answers: no flavor text, tangents, related information, or unsolicited follow-up offers. She expands when asked or when needed to complete the requested answer, keeping essential source links and uncertainty concise. Tooltip replies avoid repeating the card in prose.

Public replies always stay in threads. A main-channel mention starts a thread attached to your message (or reuses its existing thread); messages already in a thread are answered there. Lookup commands create or reuse a thread and give you a private link to the result. Help, setup, and memory confirmations remain private. Threads auto-archive after an hour of inactivity. If Discord prevents thread creation or delivery, Tome does not fall back to posting the answer in main chat.

Try `@Tome what's Frostbolt?`, `@Tome what's rogue BiS at level 25?`, or `@Tome list hunter-relevant gear from Gnomeregan`. Reply to her answer for follow-ups, even with reply notifications disabled. Research prefers Wowhead and Icy Veins and can search more broadly. Gear answers must explain assumptions and source coverage: the current lookup/search tools do not establish exhaustive dungeon loot or verified BiS sets.

Tome uses up to six recent exchanges per member/channel, held only in memory and discarded after 30 minutes of inactivity or a restart. Only `/remember` creates permanent facts. Saved facts are scoped to the member, server, and channel; they can inform public replies in that channel. The model cannot write memories itself.

Conversation context and personal facts are scoped to the reply thread. Use `/remember` within that thread for its saved preferences; facts from other channels or threads are not automatically copied into it. Guild-wide defaults still apply everywhere. Follow-ups require a direct mention or a reply to Tome, including inside threads.

Operator-configured guild game defaults are stored separately in SQLite and apply to every member and channel in that server. The current guild's defaults are **Horde** and **PvP**, explicitly requested by the owner. A member's explicit request or saved preference overrides these defaults. PvP advice can still recommend gear acquired through dungeons or quests. Updating guild defaults is an operator action; ordinary member memory commands cannot change them.

The official OpenAI SDK uses the Responses API with `store: false`. Chat, lookups, and final answer formatting use `gpt-6-luna` through `OPENAI_MODEL`. Web research uses `gpt-6.1-sol` through `OPENAI_RESEARCH_MODEL`. Both use low reasoning effort. Recent addressed messages, saved facts, and requested member details are sent to OpenAI to produce answers. Public research runs in a separate request receiving a game query; it does not receive the conversation or saved-fact records. Query generation is instructed to omit private details. This is an application boundary plus model instruction, not an automated guarantee that arbitrary text contains no personal data.

See [the Tome product direction and architecture](docs/tome.md) for the intended experience, data sources, implementation boundaries, and unresolved decisions.

**Character snapshots:** the Tome Snapshot addon captures level, equipment and talents for WoW Forever. Players share saved files through `/character import`; an optional authenticated desktop uploader syncs configured files after `/reload`, logout or exit. Tome can read linked characters and their latest snapshot, including age and unavailable-data indicators. See [installation and operator instructions](docs/character-snapshots.md). In-game compatibility still needs live validation.

**Not connected yet:** raid schedules/signups and a complete structured gear database. Calendar design remains deferred. The repository and package retain the `krelhead` name.

Cost policy: never use Astra for Tome. Astra model IDs, including dated variants, are rejected before any model request. The block applies to both model settings. Luna handles conversation and lookups; the research tool deliberately uses Sol. There is no automatic fallback to another model.

## Current commands

| Command | Example |
| --- | --- |
| `/search`, `/tooltip`, `/tt` | `/search query:Hogger` |
| `/item` | `/item query:Thunderfury` or `/item query:19019` |
| `/npc` | `/npc query:Hogger` |
| `/spell` | `/spell query:Frostbolt` |
| `/quest` | `/quest query:Hogger` |
| `/setup` | `/setup scope:channel mode:muted` |
| `/help` | Usage instructions, visible only to you |
| `/remember` | `/remember fact:I play an Alliance combat rogue` |
| `/memories` | Privately list your saved facts and their IDs in this channel |
| `/forget` | `/forget id:...` deletes your fact and clears recent context here |
| `/resetcontext` | Clear recent context here; preserve explicitly saved facts |
| `/character` | Import/list snapshots, connect/disconnect the uploader, or forget a character |

All search commands accept names, `type:ID` references, and `https://www.wowhead.com/forever/...` entity URLs. General search commands also accept an optional `type` filter. Bare IDs require a type because the same ID can identify an item, NPC, spell, or quest.

Autocomplete includes type, ID, and spell rank when available. A search displays the best match as a tooltip PNG with a Wowhead link. Up to 25 matches are available in a dropdown for the person who ran the command. Pickers expire after 15 minutes or a restart. Images are rendered locally from Wowhead’s tooltip text, with item rarity colors; they are not screenshots of Wowhead’s website. If image rendering fails, the bot sends a text embed.

## Run locally

Requires Node.js **22.18 or newer**, npm, and a Discord application.

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications), then create its bot and copy the bot token.
2. Run `npm ci`, then copy `.env.example` to `.env`.
3. Set `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, and `OPENAI_API_KEY`. Set `DISCORD_GUILD_ID` to a test server ID for immediate server-scoped command registration. Keep keys in `.env`; do not paste them into chat or commit them. Leave the OpenAI key empty to run only the legacy lookup commands.
4. Run `npm run invite`, open the printed URL, and invite the bot to your server. The URL requests View Channels, Send Messages, Create Public Threads, Send Messages in Threads, Read Message History, Embed Links, and Attach Files. Existing installations may need updated channel permissions, especially thread creation/delivery and Read Message History for reply detection.
5. Run `npm run register` after inviting the bot. This replaces this application's commands in the selected scope.
6. Run `npm run dev`, or `npm run build && npm start`.
7. Try `/item query:Thunderfury`, `/npc query:Hogger`, `/spell query:Frostbolt`, and `/quest query:Hogger` in Discord.

For conversation, enable **Message Content Intent** and **Server Members Intent** under Bot in the Discord Developer Portal. Tome subscribes to Guilds, Guild Messages, Guild Members, and Message Content. Startup checks that the privileged intents are enabled. Ambient messages are neither cached by the Discord client nor added to LLM context. Leave the application's Interactions Endpoint URL unset; interactions arrive through the gateway connection. Slash-only mode needs only Guilds.

For global registration, remove `DISCORD_GUILD_ID` and rerun `npm run register`. Global command propagation can take time. Guild registrations remain separate; remove old test registrations in Discord or through the Discord API if you no longer want them.

## Preferences

`/setup` mutes both conversation and lookups. It requires Manage Server for server preferences or Manage Channels for channel preferences. Thread overrides take priority over parent-channel preferences, then server preferences. `mode:reset` removes the override. Help, setup, and explicit memory controls remain available while muted.

Settings are written atomically to `DATA_DIR/settings.json`; explicit facts are stored in `DATA_DIR/tome.sqlite` (default directory: `./data`). Preserve this directory across restarts and deployments. Facts remain until deleted, with a limit of 20 facts of 400 characters per member/channel. Forgetting removes the fact from Tome's database and clears recent context; it does not delete prior Discord messages or change the provider's separate data-retention policies. Run one bot process. Autocomplete, result, and recent-context caches are intentionally in memory.

Requests are limited to three concurrent conversations, five accepted requests per member/server per minute, one active request per member/channel, 120 seconds per answer, six model turns, ten function calls, and two research calls (up to three built-in tool calls each). Research stops at 85 seconds, reserving 35 seconds for the final answer. Each research request is capped at 60 seconds or the remaining research time, whichever is shorter. A failed research call ends further searching; Tome answers from existing evidence and labels gaps. If final formatting also fails, collected research and its citations are returned as partial findings. Main model turns allow 2,500 output tokens; research allows 3,000. These bound request costs but are not a daily spending cap. Logs contain request IDs, timestamps, elapsed time, models, usage counts and error categories, not message bodies or keys. The local bot is available only while its process and host remain running.

## Forever data and source behavior

Forever launches November 4, 2026; source data may still be incomplete. Missing entries do **not** fall back to Classic, Retail, or another expansion. Formula placeholders in source tooltips are retained; the bot does not invent or recalculate game stats.

The initial integration was verified against live Forever responses on November 3, 2026:

- Search: `https://www.wowhead.com/forever/search?q=...`. Parses JSON data islands referenced by the item's/NPC's/spell's/quest's Listview; does not execute scripts. Exact names rank first, followed by prefix matches and Wowhead search popularity.
- Tooltips: `https://nether.wowhead.com/forever/tooltip/{type}/{id}`.
- Attribution and navigation link back to Wowhead; icons use its image CDN.

These are website endpoints, not a guaranteed public API. The parser may need updating when Wowhead changes its markup or payloads. Challenge pages and upstream errors are reported as source failures, not empty results. Search data is cached for one minute, tooltips for five minutes, identical concurrent requests are coalesced, and upstream concurrency is limited. HTTP 429 pauses new upstream requests. Autocomplete has a 1.8-second response budget; a slow search may populate the cache for the next request.

Reference behavior: [Wowhead Discord bot](https://www.wowhead.com/discord-bot#search-items). Source: [Wowhead Forever database](https://www.wowhead.com/forever/database).

Premium/account linking, localization, and automatic responses to unaddressed links are not implemented. Discord member lookup returns up to 25 prefix matches or a paginated roster sample; it does not equate Discord membership with in-game guild membership.

## Verify

```sh
npm run check
npm test
npm run build
npm run smoke
```

The first three commands run without credentials or network access after dependencies are installed. Tests also cover message gating, memory isolation/deletion/expiry, bounded model loops, research context isolation, and citation conversion. `npm run smoke` checks live Wowhead lookups and writes sample PNGs to `artifacts/`.

`npm run smoke:tome` checks OpenAI tool calling with a real Frostbolt lookup. `npm run smoke:tome -- --research` checks sourced gear research. These use the configured key and incur API charges, but do not send Discord messages. Both passed on November 4, 2026. Real mention/reply behavior should also be checked in your Discord server after startup.

## Container

```sh
docker build -t krelhead .
docker run --rm --env-file .env -v krelhead-data:/app/data krelhead
```

Register commands separately before starting the container. The image includes fonts for tooltip rendering and runs as the unprivileged Node user.

The Docker recipe has not yet been validated: the local build was stopped after Docker Hub's base-image metadata lookup stalled. The native Node build, automated tests, and live Wowhead smoke checks passed.
