
# CS2 BP TOOL BanPick工具
这是一个 Vibe Coding 出来的 小工具。如果遇到使用问题请您在 Issue 里 与我反馈！
CS2 在线 BanPick / 队长选人工具。纯静态网页，零构建，原生 HTML / CSS / JavaScript，支持本地单机、同一浏览器多标签联机以及跨设备 P2P 联机。

## 功能

- **两种组队方式**：随机分组（随机两名队长 + 其余 8 人随机分队）或队长选人（蛇形选人，每队 1 名队长 + 4 名队员）。
- **队长自行 Roll 点**：开启后由两位队长在各自设备上 Roll 1-100，点数大者先选人，并决定 BP 时先 BAN 还是后 BAN；平局自动重 Roll。
- **赛制**：BO1 / BO3 / BO5，支持 BAN、PICK、选边、决胜图全流程。
- **图池**：「现役七图」与「全部地图（21 张）」两种视图，现役地图只在 `js/active-maps.js` 中维护。
- **主题**：默认白天主题，右上角太阳 / 月亮开关切换，选择自动记忆。
- **在线房间**：房主创建房间，生成 A / B 队长专属链接；队长只能操作自己的队伍，普通房间码加入为观战模式。
- **战报**：BP 结束后可一键复制文字战报。
- **可配置站点**：品牌名、首页标题、GitHub 入口等在 `js/site-config.js` 中修改。

## 快速开始

### 方式一：Windows 一键启动

双击根目录的 `start-local.cmd`，会同时启动：

- 静态服务：<http://127.0.0.1:3000>
- 本地信令服务：`ws://127.0.0.1:9000/peerjs`

需要本机已安装 **Python** 与 **Node.js**。

### 方式二：手动启动

```bash
# 1. 静态服务（项目根目录）
python -m http.server 3000 --bind 127.0.0.1

# 2. 信令服务（首次运行前先安装依赖）
cd server
npm install
npm start
```

浏览器打开 <http://127.0.0.1:3000>。

> 只使用「单机模式」时无需启动信令服务。

## 联机说明

1. 房主点击「创建在线房间」，进入房间配置。
2. 确定两名队长（随机抽取或手动指定）。
3. 把 A / B 队长专属链接分别发给两位队长，队长在自己设备打开链接即可实时操作。
4. 其他玩家输入 5 位房间码加入为观战模式。

信令优先级：本地 PeerServer（主机名为 `localhost` / `127.0.0.1` 时）→ PeerJS 公共信令 → 同一浏览器多标签（BroadcastChannel）。

跨设备联机若不使用本地信令，可在地址后追加参数指定自建 PeerServer：

```text
?peerhost=你的主机&peerport=443&peerpath=/&peerkey=peerjs&peersecure=1
```

HTTPS 页面需要使用 `wss` 信令（`peersecure=1`）。刷新页面会退出当前房间。

## BP 规则

### Roll 点

- 队长确定后，两位队长各自 Roll 1-100，点数大的队伍先选人。
- 进入地图 BP 前，点数大的队伍选择「先 BAN 图」或「后 BAN 图」。
- 双方点数相同需重新 Roll。

### 队长选人

- 每队 1 名队长 + 4 名队员，共 8 手。
- 蛇形顺序：先手 A 时为 `A B B A A B B A`；先手 B 时相反。
- 队长不出现在可选名单中。

### 地图 BP

- **BO1**：图池需恰好 7 张，BAN 顺序 `A A B B B A`，剩余 1 张为唯一比赛地图。
- **BO3**：BAN ×2 → PICK ×2 → 继续 BAN 至剩 1 张，最后一张为决胜图。
- **BO5**：BAN 至剩 5 张 → PICK ×4，最后一张为决胜图。
- **选边**：被 PICK 的地图由对方选择起始阵营（A 选图则 B 选边，反之亦然）；决胜图由最后 BAN 方的对手选边。

## 目录结构

```text
.
├── index.html              # 页面入口与脚本引用
├── start-local.cmd         # Windows 一键启动静态服务 + 信令服务
├── css/
│   └── style.css           # 全部样式与白天 / 夜晚主题变量
├── js/
│   ├── site-config.js      # 站点文案 / 品牌 / GitHub 链接配置
│   ├── active-maps.js      # 现役地图清单（改地图只改这里）
│   ├── maps.js             # 21 张地图数据与查询
│   ├── draft.js            # 蛇形选人顺序
│   ├── mapbp.js            # BO1 / BO3 / BO5 步骤生成与结算
│   ├── share.js            # 战报文本生成
│   ├── state.js            # 房主权威状态、存档、操作
│   ├── net.js              # PeerJS / BroadcastChannel 联机
│   ├── app.js              # 视图渲染与交互
│   └── vendor/
│       ├── peerjs.min.js   # PeerJS
│       └── lucide.min.js   # Lucide 图标
└── server/
    ├── peer-server.js      # 本地 PeerServer 信令服务（默认 9000）
    └── package.json
```

## 配置

### 站点配置 `js/site-config.js`

| 字段 | 说明 |
| --- | --- |
| `brandMark` | 左上角徽标文字 |
| `brandLogo` | 徽标图片地址，填写后替代文字徽标 |
| `brandText` | 徽标右侧品牌名 |
| `heroTitle1` / `heroTitle2` | 首页大标题两行，支持 HTML |
| `githubUrl` | GitHub 链接，留空则不显示入口 |
| `githubLabel` | GitHub 入口文字 |

### 现役地图 `js/active-maps.js`

```js
var ACTIVE_IDS = ['ancient', 'anubis', 'dust2', 'inferno', 'mirage', 'nuke', 'cache'];
```

数组顺序即展示顺序，`id` 必须与 `js/maps.js` 中的地图 `id` 一致。

## 部署

本项目为纯静态站点，可直接部署到 Vercel、Netlify、GitHub Pages 或任意虚拟主机：

1. 上传 `index.html`、`css/`、`js/` 即可（`server/` 与 `start-local.cmd` 仅本地联机使用）。
2. 跨设备联机需要可访问的信令服务：可使用 PeerJS 公共信令，或单独部署 `server/peer-server.js` 并通过 URL 参数指定。

## 数据与重置

- 房间状态保存在浏览器 `localStorage`（`csbp.m1.v2`），刷新后自动恢复。
- 主题选择保存在 `csbp.theme.v1`。
- 顶栏「清空重开」可重置当前流程，重新进入房间配置。

## 浏览器支持

推荐最新版 Chrome / Edge / Firefox / Safari。联机依赖 WebRTC；同一浏览器多标签联机依赖 BroadcastChannel。
