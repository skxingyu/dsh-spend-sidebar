# dsh-spend-sidebar

把 [dsh-spend](https://github.com/nonewind/dsh-spend) 的用量卡片从**右下角悬浮窗**搬到
**左侧边栏底部**，并把「展开详情」改成一个**居中弹出的大窗口**。

> **这是第三方改造版，不是上游。** 原项目 [nonewind/dsh-spend](https://github.com/nonewind/dsh-spend)
> 由 ziheng 开发，MIT 许可。本仓库保留其数据层，只改交互与展示形态。上游历史文档见
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

保留不变：`usageStats/query` RPC、多厂商定价知识库、余额/套餐探测、四标签页仪表盘、
CSV / JSON 导出、`cordis.patch.yml` 的配置项。

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

本仓库是**源码副本**，通过脚本写入本机 DSH profile（不发布到 npm）：

```bash
node install.mjs            # 写入 ~/.dsh/profiles/desktop/node_modules/dsh-spend
node install.mjs --dry-run  # 只预览要复制什么
node install.mjs --profile web
```

安装后**刷新浏览器页面**生效（客户端 bundle 走浏览器缓存；host 半边未改动，无需重启）。

前提：目标 profile 里已经装了 `dsh-spend`（`dsh plugin add dsh-spend`），且
`package.json` 的 `dsh.profile.bundles` 含 `"dsh-spend"`。脚本只在缺 bundles 条目时
**警告**，不会替你改 profile —— 那是用户自己的决定。

> ⚠️ `dsh plugin update` 或重装 dsh-spend 会覆盖目标目录，重跑 `install.mjs` 即可。

### 包名为什么还叫 `dsh-spend`

profile 通过包名解析插件（`dependencies` + `dsh.profile.bundles` 都写的是 `dsh-spend`），
改名会导致装不上。所以 `package.json` 的 `name` 保持不变，只更正了 `description`、
`author`、`repository` 这些元数据。

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

这些断言都反证过确实能捕捉回归：把 `order` 改回 `-10`、给卡片加回 `onMouseEnter`、
或删掉英文的 `card.today`，测试都会以非零码失败。

## 目录

```
lib/client.js         浏览器半边：卡片 + 模态框（本仓库的主要改动）
lib/index.js          host 半边：usageStats/query、定价、余额探测
lib/stats.js          聚合与统计
lib/knowledge.js      内置厂商/模型定价知识库
cordis.patch.yml      profile 插入条目与默认配置
install.mjs           安装脚本
test.mjs              冒烟测试
UPSTREAM.README*.md   上游原始文档（未改动，已标注为历史）
```

## 许可

MIT。原始版权归 ziheng（[nonewind/dsh-spend](https://github.com/nonewind/dsh-spend)），
改造部分归 skxingyu。完整声明见 [`LICENSE`](LICENSE)。
