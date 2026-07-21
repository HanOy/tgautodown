# tgautodown-js

Node.js rewrite of [tgautodown](https://github.com/nasbump/tgautodown) (Go). Subscribes to one or more Telegram channels/groups and auto-downloads media (video, audio, photo, document, BT-magnet, plain-text note) via MTProto, using the GramJS library (`telegram`).

## Features
- MTProto connection via [`telegram`](https://www.npmjs.com/package/telegram) (GramJS), with SOCKS5 proxy support
- Subscribe to public channels (`channelname`) or private invites (`+invitehash`)
- Auto-download media on arrival — chunked, with built-in `FileReference` refresh by GramJS
- Web UI for first-time login (AppID/Hash/Phone → SMS code → 2FA password, all in browser)
- Live updates: editing the channel list restarts the listener without a process restart
- `POST /tgad/messages/send` — send messages to any channel/bot/user (1-on-1 DM works for bots)
- `POST /tgad/fetch-history` — pull recent messages and dispatch them (backfill missed content)
- `GET /tgad/diag` — runtime diagnostics (session state, DC info, resolved channels)
- Atomic session persistence (`.tmp` + rename) survives mid-write kills
- DC-migration-safe login (invalidates a stale auth key instead of looping on `awaiting-code`)

## Install

```bash
npm install
```

## Run

```bash
# first launch — only the web UI is up
npm start

# with channel + proxy
npm run start -- -names +AjbQIYhiKlhhNzMx -proxy socks5://127.0.0.1:1080

# dev (auto-restart on file change)
npm run dev
```

Open `http://localhost:2020`, submit `appid / apphash / phone`, wait for the SMS code form, type it in. If your account has 2FA enabled, a second form for the cloud password will appear. After successful login the listener starts automatically.

## Configuration

`data/config.json` (created on first save):

```json
{
  "appid":    12345678,
  "apphash":  "your_hash",
  "phone":    "+8613800000000",
  "cfgdir":   "./data",
  "savedir":  "./download",
  "gopeed":   "",
  "httpaddr": ":2020",
  "loglevel": 0,
  "logpath":  "",
  "logsize":  314572800,
  "logcnt":   1,
  "socks5":   "socks5://127.0.0.1:1080",
  "f2aPwd":   "",
  "retryCnt": 10,
  "channels": ["+AjbQIYhiKlhhNzMx"]
}
```

When `appid + apphash + phone` are present at startup, the listener auto-launches; otherwise only the web UI starts. CLI flags override file values (see below).

## CLI flags

```
-cfg     <path>          config file (default: ./data/config.json)
-names   <a,+b,+c>       channels (private prefix +)
-proxy   <url>           socks5://host:port
-f2a     <pwd>           2FA password (skip if Web UI handles it)
-retrycnt <n>            retry budget
-h, --help
```

## HTTP API

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET  | `/tgad/login/status`       | –                                                  | current state + account info |
| POST | `/tgad/login/user`         | `{appid, apphash, phone}`                          | start login |
| POST | `/tgad/login/code`         | `{code}`                                           | submit SMS code |
| POST | `/tgad/login/password`     | `{password}`                                       | submit 2FA password |
| GET  | `/tgad/channels/list`      | –                                                  | configured + resolved channels |
| POST | `/tgad/channels/modify`    | `{channels: [...]}`                                | update subscribed channels (auto-restarts listener) |
| POST | `/tgad/messages/send`      | `{channel, text, replyTo?}`                        | send a text message |
| POST | `/tgad/fetch-history`      | `{channel, limit?}`                                | pull recent history and dispatch |
| GET  | `/tgad/diag`               | –                                                  | runtime diagnostics |

### Sending messages

`/tgad/messages/send` accepts the channel/bot as `channel`:
- a name from the dropdown (resolved at startup)
- a fresh public username (`@public_name` or `public_name`)
- a private invite hash (`+invitehash`)
- a bot username (sends as 1-on-1 DM)

```json
POST /tgad/messages/send
{ "channel": "+AjbQIYhiKlhhNzMx", "text": "hello", "replyTo": 12345 }
→ { "rtn": 0, "msg": "succ", "id": 67890 }
```

### Backfilling missed messages

New messages are received live via `NewMessage` events. To fetch recent history of a channel (e.g. messages posted before the listener was attached, or after a disconnect):

```json
POST /tgad/fetch-history
{ "channel": "+AjbQIYhiKlhhNzMx", "limit": 10 }
→ { "rtn": 0, "msg": "succ", "fetched": 10, "dispatched": 8, "errors": [] }
```

### Diagnostics

`GET /tgad/diag` returns:

```json
{
  "status": "listening",
  "paths": {
    "cwd": "...",
    "cfgdir": "...",
    "session": "...",
    "sessionExists": true,
    "sessionStat": { "size": 369, "mtime": "..." }
  },
  "sessionInfo": { "dcId": 5, "serverAddress": "...", "port": 443, "hasAuthKey": true },
  "me": { "id": "947175333", "username": null, "first": "..." },
  "session": {
    "status": "listening",
    "channels": ["+..."],
    "resolved": [{ "name": "+...", "kind": "channel", "id": "...", "title": "..." }],
    "handlerInstalled": true
  }
}
```

## Layout (mirrors the Go project)

```
src/
├── main.js                # entry: cfg.load → startHttp → kickLogin
├── state.js               # shared state object (status / me / session)
├── session.js             # TgSession: resolve channels → install NewMessage handler
├── config/cfg.js          # Config class + CLI parsing + JSON load/save (atomic)
├── tg/
│   ├── client.js          # TgClient: connect / interactiveLogin / SOCKS5 / saveSession / invalidateSession
│   ├── auth.js            # waitForLoginCode / submitLoginCode / 2FA promise bridge
│   ├── channel.js         # public/private/bot resolution (unified classify())
│   ├── download.js        # saveMedia + sanitizeFileName + fmtSize
│   └── handler.js         # dispatchMessage — chooses class by media MIME
├── handlers/              # per-class handlers (photo / video / audio / document / note / magnet)
├── httpsrv/server.js      # node:http server, static files + JSON API
├── logger/index.js        # tiny zerolog-style logger
└── utils/args.js          # custom CLI parser (mimics Go xm)

static/                    # embedded web UI (served at runtime, not embedded into binary)
test/                      # node:test unit tests (channel resolution + saveMedia)
```

## Tests

```bash
npm test
```

Uses Node's built-in `node:test`. No external test runner needed.

## External requirements

- TG AppID + AppHash from <https://core.telegram.org/api/obtaining_api_id>.
- SOCKS5 proxy reachable from the host (`-proxy`).
- For BT/magnet: `gopeed` binary on disk, path in `config.json:gopeed` (`https://github.com/GopeedLab/gopeed`).

## Caveats vs. the Go original

- The Go version rolls its own chunked downloader with explicit FileReference refresh. GramJS abstracts that — `downloadMedia` retries internally on `FILE_REFERENCE_EXPIRED`. Fewer knobs but less code.
- Session format is incompatible with the Go version (different encoding).
- Logger is a single-process console logger; rotation uses an internal gzip-based `RollWriter` when `logpath` is set.
- Static UI is served from disk (`static/`) rather than embedded into the binary.
- **DC migration edge case**: if your account's phone is bound to a non-default DC, GramJS may rotate the auth key during the first `InvokeWithLayer`. The runtime detects this and re-saves the session; on restart it loads the correct DC key directly. If the saved session ever gets out of sync (visible via `/tgad/diag`'s `sessionInfo.dcId` not matching TG), delete `data/session.json` and re-login.

## License

MIT