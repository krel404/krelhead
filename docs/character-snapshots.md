# Tome character snapshots

Tome Snapshot captures your own character's **level, equipment and learned talents** on WoW Forever (interface 16001). It does not inspect other players or collect chat, bags, bank, combat logs or credentials. Data stays local until you import it or configure an uploader.

**Live game validation is still needed.** The actual addon Lua has automated tests using Forever API doubles, and API signatures were checked against the Forever UI source. This does not establish compatibility with every launch build.

## Automatic setup (recommended)

Tome Companion is a desktop app for **Windows and macOS**. It bundles the addon and its own runtime: players do not install Node.js, edit file paths, run terminal commands, or manually import every snapshot.

**Operator prerequisite:** host the upload API at a stable HTTPS URL using the settings below. Without that endpoint, `/character connect` reports that automatic sync is not hosted. The current development installers lack trusted developer signing (macOS uses an ad-hoc signature); macOS distribution also needs notarization for reliable installation and login-item behavior. Windows execution, OS startup behavior, and the addon still need validation on players' machines.

1. Install and open **Tome Companion**. On macOS, move the app to Applications before enabling start at login. On Windows, run the installer.
2. In your guild's Discord, run `/character connect`. Download the private `tome-upload.json` connection file and use **Open connection file** in the companion. Nothing in this file needs editing. The app verifies the connection before accepting it.
3. Confirm your WoW folder and select your WoW account. Click **Install addon & start syncing**. Leave **Start automatically when I sign in** checked.
4. Restart WoW once and enable **Tome Snapshot** in AddOns if needed. Then play normally.

The addon captures automatically after login, equipment/level/talent changes, and on logout. WoW writes the file on **normal logout, game exit, or UI reload**. The companion detects that file and uploads it automatically; new characters on the selected account are discovered too. There is no routine `/tomesnapshot capture`, `/reload`, file picking, or `/character import` step. During a play session, Tome sees the last disk snapshot, not necessarily the gear currently equipped. A UI reload is an optional way to refresh sooner. Crashes/force quits might not save.

The companion keeps syncing in the background when its window closes. On macOS it has no menu bar icon; reopen Tome Companion from Applications or the Dock to return to settings, and use Quit Tome Companion (⌘Q) to stop it. On Windows it remains in the system tray. It shows the last upload time, retries connection failures, and provides pause, resume and local disconnect. Its connection is encrypted using the operating system's secure storage. The downloaded connection file remains private and can be deleted after setup. If the token expires (90 days) or is revoked, the app asks you to link again; it does not silently continue or ask for your Discord password.

All Tome snapshots from the selected WoW account are shared with the linked Discord server, including new characters. Other accounts, addons, and game versions are not scanned. These snapshots can inform public guild answers and be sent to the configured OpenAI provider. Use `/character list` in Discord to see what Tome has received. Data is self-reported, not Blizzard-verified.

## Manual fallback

Upgrading from Syl Snapshot: disable/remove the old `SylSnapshot` addon folder and install `TomeSnapshot`. Use `/tomesnapshot`; new saved files are named `TomeSnapshot.lua`. Update the file paths in your uploader config and use `tome-uploader.mjs`. Existing uploaded records, tokens, and old `SylSnapshot.lua` / `SYL1:` exports remain supported. You do not need to relink your characters.

1. Extract the release ZIP and copy `TomeSnapshot` into `World of Warcraft/_forever_/Interface/AddOns/`. Verify the final path is `Interface/AddOns/TomeSnapshot/TomeSnapshot.toc`, with no extra nested folder.
2. Enable **Tome Snapshot** in the AddOns list. Log in, leave combat and wait a few seconds.
3. Type `/tomesnapshot capture`, then `/reload`.
4. In Discord, run `/character import file:` and attach `World of Warcraft/_forever_/WTF/Account/<account>/<realm>/<character>/SavedVariables/TomeSnapshot.lua`.
5. Ask Tome **“what upgrades should I get for my current gear?”** If you have several characters, name the one you mean.

Imports link the snapshot to the Discord member uploading it and **share it with that server**. Tome may include it in public replies and send it to the configured OpenAI provider when answering. Ownership/data are self-reported, not Blizzard-verified. Other members cannot overwrite or delete an existing link owned by you.

Alternatively, `/tomesnapshot` opens a copyable export. Save the text into a `.txt` file and attach it to `/character import`, without needing `/reload`. Do not paste the long export into chat or upload your whole WTF folder. `/tomesnapshot status` shows the last capture this session.

Capture also happens after login, equipment/level/talent changes, and logout. Events are debounced. Combat defers collection; a restricted API failure preserves the previous export. Unloaded talents are unavailable, staged talent changes are pending, and missing equipment data is distinct from an empty slot. Item-instance strings preserve enchant/random-affix information when available. The addon never changes talents or forces reloads.

## Command-line uploader (advanced)

The addon cannot POST to an external service. WoW writes SavedVariables on **UI reload, logout or normal exit**. Capturing at login changes memory, not the file immediately. Neither capture nor upload proves the player is currently online.

Once the operator enables an upload endpoint:

1. Run `/character connect` and download the private `tome-upload.json` attachment.
2. Set `files` to full paths to only the characters you want to share. In Windows JSON, use forward slashes (`C:/Games/World of Warcraft/...`) or escape backslashes.
3. Install Node.js 22.18 or newer. In the extracted release directory, run `node tome-uploader.mjs /path/to/tome-upload.json`. Quote paths containing spaces. Add `--once` for one upload pass.
4. Keep it running. It checks those files every five seconds, uploads changes, retries failures after a minute, and never edits game files.

Keep the config private. Its token is scoped to your Discord account/server and expires in 90 days. `/character connect` rotates it. No bot token or OpenAI key belongs on a player's computer. Remote uploads require HTTPS; HTTP is allowed only on loopback. Redirects are rejected. The graphical companion handles discovery and OS startup; this optional script requires you to manage its process yourself. Hosting is not automatically provisioned. Discord import works without an upload service.

## Manage data

- `/character list`: your characters, IDs and capture age.
- `/character disconnect`: revoke this server's uploader token; snapshots remain.
- `/character forget id:...`: delete that character/history, revoke your uploader token to prevent re-upload, and clear recent server conversation context. With the companion, disable Tome Snapshot for that character and remove its saved snapshot file before reconnecting; otherwise account-wide discovery will upload it again. With the command-line uploader, remove the character's configured path. Explicit `/remember` facts and existing Discord messages remain separate.

Retention is **20 snapshots per character**, up to **25 characters per member/server**. Current records remain until deleted. Tome reads the latest snapshot; history has no UI yet. Data older than 24 hours is marked stale. Capture time comes from the client, receipt time from the server.

## Operator setup

Snapshots and hashed uploader tokens are in `DATA_DIR/characters.sqlite`. Keep this directory on persistent storage and backups private; it is ignored by Git. Run one bot process. Character commands work in slash-only mode too. After deployment, run `npm run register`, then build/restart Tome.

Optional remote uploader configuration:

```dotenv
SNAPSHOT_PORT=8787
SNAPSHOT_HOST=127.0.0.1
SNAPSHOT_PUBLIC_URL=https://your-tome-host.example/v1/snapshots
```

Use an HTTPS reverse proxy forwarding `POST /v1/snapshots`, `GET /v1/snapshots/status`, and the Authorization header to the local listener. The status route validates the connection and returns no character data. Limit bodies to 256 KB and requests to 30 seconds. The service has no public data read route, permits ten requests per member/server per minute, and checks current Discord membership. Identity comes from the token, never body fields. Containers may need `0.0.0.0` binding behind the proxy. A loopback HTTP URL works only for a companion/uploader on the bot's computer.

Leave these variables unset until hosting is available. `/character connect` then explains that automatic upload is not configured; `/character import` still works. The uploader and bot must remain running for automatic sync.

`npm run package:addon` creates `artifacts/TomeSnapshot-0.3.0.zip` with the addon, this guide and the standalone Node uploader. No credentials or user data are packaged.

Build the companion with `npm ci --prefix companion`, then `npm run package:companion:mac` (Apple Silicon and Intel ZIPs) or `npm run package:companion:win` (x64 installer). Outputs are in `artifacts/companion/`. Build Windows on Windows in CI for release validation. `npm run companion` runs development mode; `npm --prefix companion run smoke` checks the real renderer/preload/IPC with temporary app data and no linked player. OS startup registration is only enabled by the packaged app. Configure developer signing certificates and notarization before general distribution; the checked-in packaging configuration produces development builds.

## Format and validation

The saved file contains only `TomeSnapshotExport = "TOME1:<hex-encoded UTF-8 JSON>"`. Hex avoids Lua-string escaping ambiguity. The importer accepts this exact assignment, the export string, or JSON, and **never executes uploaded Lua**. Schema 1 is limited to Forever interfaces 16000–16999 and normalized with a field allowlist. It rejects duplicate slots/nodes, mismatched item IDs, oversized data and timestamps more than five minutes in the future. Older/duplicate captures never replace newer state.

Tests execute the actual Lua addon with API doubles, decode its export into SQLite, exercise the uploader against a local server, and check isolation, token lifecycle, malformed data, retention, ordering and Tome's character tools.

Live acceptance: compare level/gear/talents to the character sheet; equip and remove an item; apply a talent change; test a low-level character and an alt; confirm `/reload` writes the file and uploads work; revoke the token and confirm uploads fail. Pending/unavailable talents must not be interpreted as an empty build.

API sources: [Forever client observations](https://github.com/xIGBClutchIx/ForeverPlusPlus/blob/main/docs/forever-api.md), [Blizzard Forever traits](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/SharedTraitsDocumentation.lua), [Forever specialization API](https://github.com/Gethe/wow-ui-source/blob/forever/Interface/AddOns/Blizzard_APIDocumentationGenerated/SpecializationInfoDocumentation.lua).
