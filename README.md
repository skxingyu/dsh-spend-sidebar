# dsh-spend-sidebar

一个**独立的** DSH 用量仪表盘插件：把用量做成侧边栏底部的双行卡片，点击弹出居中大窗口。

- 侧边栏卡片：**当月** 费用 + Token / **今日** 费用 + Token
- 点击卡片 → 居中模态框，四个标签页的完整仪表盘
- 零配置：内置 17 家厂商 / 131 个模型的定价知识库，自动识别 Code / Token 计费
- **不依赖上游 dsh-spend**，两者可并存或只用其一

> 本项目基于 [nonewind/dsh-spend](https://github.com/nonewind/dsh-spend)（作者 ziheng，
> MIT 许可）改造：保留其 host 数据层，重做挂载方式与展示形态，并独立命名。上游历史文档见
> [`UPSTREAM.README.md`](UPSTREAM.README.md)（描述的是改造前行为）。

---

## 界面

| 位置 | 表现 |
|---|---|
| 侧边栏底部（设置上方） | 两行卡片：**当月** 费用 + Token；**今日** 费用 + Token |
| 鼠标悬停 | **无任何响应** |
| 鼠标点击 | 居中弹出详情窗口（仪表盘四标签页） |

卡片与 [@kenz1117/dsh-ui-usage-billing](https://github.com/kenz1117/dsh-ui-usage-billing)
处在同一个插槽，billing 在上、本卡片在下。

## 与上游的差异

只改交互与挂载，数据流一行未动：

|  | 上游 | 本版 |
|---|---|---|
| 挂载 | `createRoot()` 挂到 `document.body` | 注册 `sidebar.footer.action` 插槽 |
| 定位 | `position:fixed; right:20px; bottom:20px` | 文档流内 `width:100%` |
| 客户端依赖 | `connection`, `locale` | 追加 `slots`（并用 `react-dom` 的 `createPortal`） |
| 卡片 | 单行：总费用 + 总 Token | **两行**：当月 / 今日 |
| 悬停 | 120ms 后弹出摘要浮层 | 无响应 |
| 点击 | 侧边栏内联面板（很窄） | 居中模态框，宽 `min(920px, 100vw-48px)` |
| 包 / 行 id | `dsh-spend` / `usage-stats` | `dsh-spend-sidebar` / `usage-stats-sidebar` |

保留不变：`usageStats/query` RPC、多厂商定价知识库、余额/套餐探测、四标签页仪表盘、
CSV / JSON 导出、`cordis.patch.yml` 的配置项。

命名与 id 全部换新，是为了让它**独立可装**：包名、客户端 bundle id、cordis 行 id、
CSS 的 `data-plugin` tag 都不与上游撞车，因此可以和上游并存而互不干扰（同槽位靠
`order` 排序，同 id 才不会互相覆盖）。

> 两处刻意**没有**改名：`usageStats` 这个 Remote 服务名与 `usageStats/query` 路由
> （host 与 client 一起发布，属于内部契约），以及 localStorage 里的
> `dsh-spend:currency`（改名会丢掉你已选的显示货币）。导出的 CSV/JSON 文件名已经换成
> 新名字。

### 两行的口径

- **当月**：`byDay` 中本月前缀的日行求和。**没有**用 `totals` —— 那个累计的是历史上
  扫描过的所有会话，当「本月」会偏高。
- **今日**：`byDay` 中当天那一行。
- 五个 token 计数由 `bucketTokens(row)` 统一相加，避免卡片与面板口径漂移。

### 模态框

点击卡片后经 `react-dom` 的 `createPortal` 渲染到 `document.body`，因此侧边栏多窄都
不影响可读性。支持点遮罩关闭、`Esc` 关闭、打开时锁 `body` 滚动；带 `role="dialog"`、
`aria-modal`、`aria-expanded`。

> 上游悬停浮层里的「套餐 / 余额」摘要在本版删除了：`Dashboard` 里的 `PlansSection`
> 本来就完整渲染同一批数据，点击即可见，摘要属于重复。

### 与 billing 卡片共存

两者注册到同一个 `list` 槽位。槽位按 `order` **升序**渲染
（见 `dsh-client-ui-slots/lib/index.js` 的 `a.options.order - b.options.order`）：

- billing：`order: -10`
- 本插件：`order: -9`

所以 billing 卡片在上、本卡片在下，且不依赖加载顺序。

## 安装

本插件**独立自包含**：它不依赖、不扩展、也不需要上游 `dsh-spend`。它有自己的一套
host 半边、自己的客户端 bundle id（`dsh-spend-sidebar`）、自己的 cordis 行 id
（`usage-stats-sidebar`），因此可以和上游并存，也可以单独装。

本仓库是源码副本，用脚本装进 DSH profile（**不发布到 npm**）：

```bash
node install.mjs             # 复制文件 + 写进 dsh.profile.bundles
node install.mjs --dry-run   # 只预览
node install.mjs --profile web
node install.mjs --uninstall # 只摘掉 bundles 条目，目录保留
```

脚本做两件事：把 `lib/` 与清单文件复制到
`~/.dsh/profiles/<profile>/node_modules/dsh-spend-sidebar/`，再把这个包名追加到
`dsh.profile.bundles`。第二件是必须的 —— 加载器只**过滤**现有的 bundles 列表
（`desktopBundleList`），从不依据 `dependencies` 推导它。脚本会先备份 `package.json`，
且是幂等的，重复运行不会写重复条目。

**不**写 `dependencies` 条目：DSH 对每个 bundle 用标准 Node 模块解析从 profile 目录
找包，再读它的 `dsh.bundle.patch`（见 `package-overlay-*.js` 的 `readCandidate`），
一个普通目录就够了。写 `file:` 反而把路径变成长期契约：仓库一挪，下次 `pnpm install`
就崩，而复制这一步已经让那个声明多余了。

> 加载器要求找到的 manifest 的 `name` **严格等于** bundle 名，所以目录名和
> `package.json` 的 `name` 都必须保持 `dsh-spend-sidebar`。

改完 host 半边后需要**重启 DSH Desktop**（插件在启动时组合）；只改客户端 bundle 的话
刷新页面即可。`dsh plugin` 的重装不会覆盖本插件 —— 它不来自 registry。

### 与上游 dsh-spend 的关系

两者可以并存（行 id 不同、客户端 id 不同、CSS tag 不同）。若你只想留一个，建议
**按包名禁用上游**，而不是删文件：DSH 的禁用状态在
`%APPDATA%\DSH Desktop\plugin-management\state.json`：

```json
{ "version": 1, "profiles": [ { "profileName": "desktop", "disabledBundles": ["dsh-spend"] } ] }
```

（schema 见 `desktop-plugins.js` 的 `parseState`；`version` 必须是 `1`。）

> 注意：往 profile 的 `cordis.patch.yml` 里写 `- id: usage-stats` + `disabled: true`
> **无效** —— 该层能禁用上游自带的层行（如 `strata`），但匹配不到 bundle 层
> `insert` 进去的行。这条我实测过，所以没采用。

## 测试

```bash
node test.mjs
```

通过 `window.__ModuleLoader__` 桩加载**真实的** `lib/client.js`，断言：

- 只注册 `sidebar.footer.action`，组件拿到 `{ t, query }`，**不再**向 `document.body` 挂浮层
- 卡片区没有任何 `onMouseEnter` / `onMouseLeave`（仪表盘图表自己的 tooltip 不算）
- 点击走 `createPortal` 弹窗，内联 `dsu-panel` 已消失
- 两行分别渲染当月 / 今日的费用与 Token，且当月由日行求和
- `card.thisMonth` / `card.today` 在中英两个字典里都有定义
- 以 `dsh-spend-sidebar` 注册，**不**占用上游的 `dsh-spend` id

这些断言都反证过确实能捕捉回归：把 `order` 改回 `-10`、给卡片加回 `onMouseEnter`、
或删掉英文的 `card.today`，测试都会以非零码失败。

## 目录

```
lib/client.js         浏览器半边：卡片 + 模态框（本仓库的主要改动）
lib/index.js          host 半边：usageStats/query、定价、余额探测
lib/stats.js          聚合与统计
lib/knowledge.js      内置厂商/模型定价知识库
cordis.patch.yml      profile 插入条目（行 id `usage-stats-sidebar`）与默认配置
install.mjs           安装 / 卸载脚本
test.mjs              冒烟测试
UPSTREAM.README*.md   上游原始文档（未改动，已标注为历史）
```

## 许可

MIT。原始版权归 ziheng（[nonewind/dsh-spend](https://github.com/nonewind/dsh-spend)），
改造部分归 skxingyu。完整声明见 [`LICENSE`](LICENSE)。
