# dsh-spend-sidebar

一个**独立的** DSH 用量仪表盘插件：把用量做成侧边栏底部的双行卡片，点击弹出居中大窗口。

- 侧边栏卡片：**当月** 费用 + Token / **今日** 费用 + Token
- 点击卡片 → 居中模态框，四个标签页的完整仪表盘
- 零配置：内置 17 家厂商 / 131 个模型的定价知识库，自动识别 Code / Token 计费
- **不依赖上游 dsh-spend**，装上即替换它（两者不能同时挂载，原因见下）

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
CSS 的 `data-plugin` tag 都不与上游撞车。不过**挂载层面它替换上游，不是并存** ——
两者都注册 `usageStats` 服务，同时挂会直接让插件树加载失败（见下方「必须替换」）。

> 两处刻意**没有**改名：`usageStats` 这个 Remote 服务名与 `usageStats/query` 路由
> （host 与 client 一起发布，属于内部契约），以及 localStorage 里的
> `dsh-spend:currency`（改名会丢掉你已选的显示货币）。导出的 CSV/JSON 文件名已经换成
> 新名字。

### 模型计价目录（来自 dsh-ui-usage-billing）

费率表主体移植自 [kenz1117/dsh-ui-usage-billing](https://github.com/kenz1117/dsh-ui-usage-billing)
的 `MODEL_CATALOG`（25 家厂商 / 75 个模型，含峰谷时段价与「估算价」标记），用
`tools/build-catalog.mjs` 从它的 TypeScript 源码**直接导入生成**
`lib/model-catalog-data.json` —— 数值就是 billing 所发布的，无手工转抄：

```bash
git clone --depth 1 https://github.com/kenz1117/dsh-ui-usage-billing /tmp/billing
node tools/build-catalog.mjs /tmp/billing        # 重新生成 lib/model-catalog-data.json
```

计价口径是本移植里最重要的差异：**每行价格保留原生币种**（`currency: "CNY" | "USD"`，
billing 目录里 57 条人民币价 + 19 条美元价），聚合时按宿主提供的实时汇率
（`getRates()` 的 `{ USD, CNY }` 报价）换算成显示币种——2 元人民币显示为美元即 ÷6.79。
旧版（上游 dsh-spend）把所有价格当美元，国内厂商会被悄悄算错好几倍。

匹配规则：

- 日志里的厂商 model id（如 `deepseek-v4-flash`）先过 billing 的 **88 条别名表**
  归并到目录键（`flash`），同一模型无论用哪个 id 记账，单价一致；
- 同一模型两边都有价时，**billing 目录优先**（它跟厂商调价更紧，如 DeepSeek
  2026-09-10 调价），`knowledge.js` 里手工维护的旧价只补目录没有的模型；
- 没有 `currency` 字段的行（旧手工行）按显示币种原样计价，行为不变。

`test-catalog.mjs` 验证以上全部口径，包括换算方向（CNY→USD 除以汇率、USD→CNY
乘以汇率、同币种不换算）——换算方向写反过一次，是这条测试抓出来的。

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

### 与 billing 卡片的位置关系

billing 的卡片用的是同一个 `sidebar.footer.action` 槽位（`list` 类型，按 `order`
升序渲染，见 `dsh-client-ui-slots/lib/index.js`）：billing `order: -10`、本插件
`order: -9`，同装时 billing 在上、本卡片在下。本插件的计价目录就来自它的
`MODEL_CATALOG`（见上方「模型计价目录」）——数据取自它的源码，但挂载互相独立：
它装不装都不影响本插件的费率表。

## 安装

本插件**独立自包含**：它不依赖、不扩展、也不需要上游 `dsh-spend`。它有自己的一套
host 半边、自己的客户端 bundle id（`dsh-spend-sidebar`）、自己的 cordis 行 id
（`usage-stats-sidebar`），可以单独安装。装它会**替换**上游（原因见下）。

本仓库是源码副本，用脚本装进 DSH profile（**不发布到 npm**）：

```bash
node install.mjs             # 复制文件 + 写进 dsh.profile.bundles
node install.mjs --dry-run   # 只预览
node install.mjs --profile web
node install.mjs --uninstall # 只摘掉 bundles 条目，目录保留
```

脚本做三件事：

1. 把 `lib/` 与清单文件复制到
   `~/.dsh/profiles/<profile>/node_modules/dsh-spend-sidebar/`
2. 把包名追加到 `dsh.profile.bundles` —— 这一步是必须的，加载器只**过滤**现有的
   bundles 列表（`desktopBundleList`），从不依据 `dependencies` 推导它
3. 把上游 `dsh-spend` 从 bundles（以及 `dependencies`，若该 profile 是 pnpm 管理的）
   里**移除** —— 两者不能共存，原因见下

脚本会先备份 `package.json`，且是幂等的，重复运行不会写重复条目。

**不**给本插件写 `dependencies` 条目：DSH 对每个 bundle 用标准 Node 模块解析从 profile
目录找包，再读它的 `dsh.bundle.patch`（见 `package-overlay-*.js` 的 `readCandidate`），
一个普通目录就够了。写 `file:` 反而把仓库路径变成长期契约：仓库一挪，下次 `pnpm install`
就崩，而复制这一步已经让那个声明多余了。

> 加载器要求找到的 manifest 的 `name` **严格等于** bundle 名，所以目录名和
> `package.json` 的 `name` 都必须保持 `dsh-spend-sidebar`。

### 桌面 profile 与 web profile

两个 profile 结构不同，脚本都支持：

| | `desktop` | `web` |
|---|---|---|
| 依赖声明 | 无（只有 bundles） | pnpm 管理，`dependencies` + `bundles` 都有 |
| 启动方式 | DSH Desktop 组合 | `dsh --profile web` |
| 脚本动作 | 复制 + 改 bundles | 复制 + 改 bundles + 改 dependencies |

web profile 的 `dshmarket` 只对「在 `dependencies` 但不在 `bundles`」的包做热挂载，
所以移除上游时**两处都要清**，否则 `pnpm install` 会把没人加载的包装回来。

> 两个 profile 各自的 `cordis.patch.yml` 里若残留 `- id: usage-stats` 条目，去掉即可 ——
> 该行已不存在，加载器会打印 `entry "usage-stats" not found` 警告（只是警告，不影响启动）。

改完 host 半边后需要**重启 DSH Desktop**（插件在启动时组合）；只改客户端 bundle 的话
刷新页面即可。`dsh plugin` 的重装不会覆盖本插件 —— 它不来自 registry。

### ⚠️ 必须替换，不能并存

上游 `dsh-spend` 与 `dsh-spend-sidebar` **不能同时挂载**：两者的 host 半边都注册
Cordis 服务 `usageStats`，而一个服务只能注册一次。同时装上会让整棵插件树加载失败：

```
plugin tree failed to load: service "usageStats" has been registered at <UsageStatsService>
```

这跟行 id 无关 —— 正因为本插件用了**不同的**行 id（`usage-stats-sidebar`），两个条目
才会都处于激活状态；若沿用同一个 id，反而会互相覆盖而不会冲突。

所以 `install.mjs` 写 bundles 时会把 `dsh-spend` **移除**，不让两者并存。

回退方式：`node install.mjs --uninstall` 会把 `dsh-spend-sidebar` 的条目摘掉，并在
上游文件仍在磁盘上时把 `dsh-spend` 加回 bundles。若上游目录已经不在（例如被 Desktop
的启动恢复流程删掉、或被 `pnpm install` 当作无引用包清理掉），脚本会明确告诉你需要
`dsh plugin add dsh-spend` —— 它**不会**加一条指向不存在目录的 bundles 条目，那样会
让整棵插件树启动失败。

**不要试图用「禁用」绕过**：Desktop 只在 market provider 为 `community` 时读取
`plugin-management` 状态里的 `disabledBundles`，其余情况该集合被强制置空
（`profile-DcyLDzp6.js` 的 `prepareDesktopProfile`）。实测在 `dsh-market` provider 下
写进去会被静默忽略。往 profile 的 `cordis.patch.yml` 写 `- id: usage-stats` +
`disabled: true` 同样无效 —— 该层能禁用上游自带的层行（如 `strata`），但匹配不到
bundle 层 `insert` 进去的行。两条路都实测过，所以最终改为直接改 bundles。

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
lib/stats.js          聚合与统计（含原生币种 → 显示币种换算）
lib/knowledge.js      厂商知识库 + 计价目录合并逻辑（目录优先）
lib/model-catalog-data.json  计价目录数据（tools/build-catalog.mjs 生成，勿手改）
tools/build-catalog.mjs      从 dsh-ui-usage-billing 源码重新生成目录
cordis.patch.yml      profile 插入条目（行 id `usage-stats-sidebar`）与默认配置
install.mjs           安装 / 卸载脚本
test.mjs              冒烟测试
test-catalog.mjs      计价目录与币种换算测试
UPSTREAM.README*.md   上游原始文档（未改动，已标注为历史）
```

## 许可

MIT。原始版权归 ziheng（[nonewind/dsh-spend](https://github.com/nonewind/dsh-spend)），
改造部分归 skxingyu。完整声明见 [`LICENSE`](LICENSE)。
