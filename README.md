# tgautodown-js

[tgautodown](https://github.com/nasbump/tgautodown)（Go 版本）的 Node.js 重写版。订阅一个或多个 Telegram 频道/群组，通过 MTProto 协议自动下载媒体（视频、音频、图片、文档、BT 磁力链、纯文本笔记），使用 GramJS 库（`telegram`）。

## 功能特性

- 通过 [`telegram`](https://www.npmjs.com/package/telegram)（GramJS）建立 MTProto 连接，支持 SOCKS5 代理
- 订阅公共频道（`channelname`）或私有邀请链接（`+invitehash`）
- 消息到达自动下载——分块下载，由 GramJS 内置处理 `FileReference` 过期重试
- Web UI 完成首次登录（AppID/Hash/Phone → 短信码 → 2FA 密码，全程浏览器内完成）
- 热更新：编辑订阅频道列表后无需重启进程，自动重新挂监听
- `POST /tgad/messages/send` — 向任意频道/Bot/用户发送消息（支持 Bot 一对一私信）
- `POST /tgad/fetch-history` — 拉取频道最近历史消息并触发下载（补抓错过的内容）
- `GET /tgad/diag` — 运行时诊断接口（会话状态、DC 信息、已解析频道）
- 原子化的会话持久化（`.tmp` + rename 写入），进程中途被 kill 也不会写坏文件
- DC 迁移安全登录（检测到 stale auth key 时自动失效，避免卡在 `awaiting-code` 死循环）

## 安装

```bash
npm install
```

## 运行

```bash
# 首次启动——只起 Web UI
npm start

# 带频道 + 代理
npm run start -- -names +AjbQIYhiKlhhNzMx -proxy socks5://127.0.0.1:1080

# 开发模式（文件变更自动重启）
npm run dev
```

浏览器打开 <http://localhost:2020>，提交 `appid / apphash / phone`，等待「短信验证码」表单出现后输入收到的码。如果账号开启了 2FA，会再弹一个「两步验证密码」表单。登录成功后监听器自动启动。

## 配置

`data/config.json`（首次保存时自动创建）：

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

启动时若 `appid + apphash + phone` 已有值，自动启动监听器；否则只起 Web UI。命令行参数优先级高于配置文件（见下表）。

## 命令行参数

```
-cfg     <path>          配置文件路径（默认：./data/config.json）
-names   <a,+b,+c>       频道列表（私有频道前加 +）
-proxy   <url>           socks5://host:port
-f2a     <pwd>           2FA 密码（如果走 Web UI 可省）
-retrycnt <n>            重试预算
-h, --help
```

## HTTP API

| 方法 | 路径 | 请求体 | 用途 |
|---|---|---|---|
| GET  | `/tgad/login/status`       | –                                                  | 当前状态 + 账户信息 |
| POST | `/tgad/login/user`         | `{appid, apphash, phone}`                          | 发起登录 |
| POST | `/tgad/login/code`         | `{code}`                                           | 提交短信验证码 |
| POST | `/tgad/login/password`     | `{password}`                                       | 提交 2FA 密码 |
| GET  | `/tgad/channels/list`      | –                                                  | 已配置 + 已解析频道 |
| POST | `/tgad/channels/modify`    | `{channels: [...]}`                                | 更新订阅频道（自动重启监听器）|
| POST | `/tgad/messages/send`      | `{channel, text, replyTo?}`                        | 发送文本消息 |
| POST | `/tgad/fetch-history`      | `{channel, limit?}`                                | 拉取频道历史并触发下载 |
| GET  | `/tgad/diag`               | –                                                  | 运行时诊断 |

### 发送消息

`/tgad/messages/send` 的 `channel` 字段接受：
- 下拉框里已解析的频道名
- 任意公开用户名（`@public_name` 或 `public_name`）
- 私有邀请 hash（`+invitehash`）
- Bot 用户名（按一对一私信发送）

```json
POST /tgad/messages/send
{ "channel": "+AjbQIYhiKlhhNzMx", "text": "hello", "replyTo": 12345 }
→ { "rtn": 0, "msg": "succ", "id": 67890 }
```

### 补抓历史消息

新消息通过 `NewMessage` 事件实时接收。要拉取频道最近历史（比如监听器掉线期间发的、或刚订阅的旧消息）：

```json
POST /tgad/fetch-history
{ "channel": "+AjbQIYhiKlhhNzMx", "limit": 10 }
→ { "rtn": 0, "msg": "succ", "fetched": 10, "dispatched": 8, "errors": [] }
```

### 诊断接口

`GET /tgad/diag` 返回：

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

## 项目结构（与 Go 版镜像对应）

```
src/
├── main.js                # 入口：cfg.load → startHttp → kickLogin
├── state.js               # 共享状态对象（status / me / session）
├── session.js             # TgSession：解析频道 → 装 NewMessage 监听器
├── config/cfg.js          # Config 类 + CLI 参数解析 + JSON 读写（原子写入）
├── tg/
│   ├── client.js          # TgClient：connect / interactiveLogin / SOCKS5 / saveSession / invalidateSession
│   ├── auth.js            # waitForLoginCode / submitLoginCode / 2FA 桥接
│   ├── channel.js         # 公开/私有/Bot 解析（统一 classify()）
│   ├── download.js        # saveMedia + sanitizeFileName + fmtSize
│   └── handler.js         # dispatchMessage——按 media MIME 分流
├── handlers/              # 各类型处理器（photo / video / audio / document / note / magnet）
├── httpsrv/server.js      # node:http 服务，静态文件 + JSON API
├── logger/index.js        # 自实现 zerolog 风格 logger
└── utils/args.js          # 自定义 CLI 解析器（模仿 Go 的 xm）

static/                    # Web UI（运行时从磁盘服务，未嵌入二进制）
test/                      # node:test 单元测试（channel 解析 + saveMedia）
```

## 测试

```bash
npm test
```

使用 Node 内置的 `node:test`，无需额外安装测试框架。

## 外部依赖

- TG AppID + AppHash 申请地址：<https://core.telegram.org/api/obtaining_api_id>
- SOCKS5 代理（命令行 `-proxy` 指定）
- BT/磁力下载：需 `gopeed` 可执行文件，路径在 `config.json:gopeed`（项目：<https://github.com/GopeedLab/gopeed>）

## 与 Go 原版的差异

- Go 版手写 `UploadGetFile` 分块下载 + 显式 FileReference 刷新。GramJS 内部封装——`downloadMedia` 收到 `FILE_REFERENCE_EXPIRED` 自动重试。配置项少了，但代码量也少。
- Session 格式与 Go 版不兼容（编码方式不同）。
- Logger 是单进程控制台 logger；当设置 `logpath` 时使用内置的 gzip 压缩滚动写入器。
- 静态 UI 从磁盘（`static/`）服务，不嵌入二进制。
- **DC 迁移边界场景**：账号手机号绑定到非默认 DC 时，GramJS 可能在首次 `InvokeWithLayer` 期间轮换 auth key。运行时会检测这种情况并重新保存 session；下次重启直接加载正确的 DC key。如果 session 文件因任何原因失同步（可通过 `/tgad/diag` 的 `sessionInfo.dcId` 与实际 TG 账号 DC 比对发现），删除 `data/session.json` 重新登录即可。

## 许可证

MIT