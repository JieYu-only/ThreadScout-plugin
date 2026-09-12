# ThreadScout-plugin

面向 TRSS-Yunzai 的主题扫描、规则评分和安全回复队列插件。V1 首个平台为百度贴吧，默认观察模式。

## 已实现

- 标题与主楼正文扫描；强词、辅助词、组合规则、负面词和硬排除词评分
- 首次运行只建立基线，避免启动后处理历史帖
- SQLite 持久队列、重启恢复、超时作废、发送前重新拉取并复核
- 同主题全局成功去重、每小时/每日限额、连续失败熔断
- 加权模板池、最近模板避重复、资源变量与渲染校验
- 多账号配置结构（V1 建议只启用一个账号）
- TRSS 命令：`#巡贴帮助`（兼容 `#巡帖帮助`，渲染图片帮助卡片）、`#巡帖状态`、`#巡帖立即扫描`、`#巡帖模式 观察|自动|停止`、`#巡帖队列`、`#巡帖记录 [任务标识]`、`#巡帖账号`、`#巡帖账户管理`、`#巡帖扫码登录`、`#巡帖重载配置`、`#巡帖更新`、`#巡帖强制更新`
- Guoba-Plugin 可视化配置，保存后即时同步到运行实例并输出不含敏感值的后台日志；账号 Cookie 只写不回显并使用 AES-256-GCM 加密保存，连续两次确认认证失效后自动清理插件保存的旧 Cookie
- 请求超时、有限重试、异常 HTML 检测、错误分类及可配置 HTTP/HTTPS 代理
- 贴吧网页触发百度安全验证时，主题列表与正文扫描自动切换到贴吧客户端接口

## 安装

请先进入 TRSS-Yunzai / Miao-Yunzai 根目录，再选择下面任意一种方式安装。

### 方式一：Gitee 安装（国内推荐，无需登录）

```bash
git clone https://gitee.com/jieyu19960111/thread-scout-plugin.git ./plugins/ThreadScout-plugin/
pnpm install --filter=threadscout-plugin
```

### 方式二：GitHub 安装

直连 GitHub：

```bash
git clone https://github.com/JieYu-only/ThreadScout-plugin.git ./plugins/ThreadScout-plugin/
pnpm install --filter=threadscout-plugin
```

国内加速（仅适用于公开仓库）：

```bash
git clone https://gh-proxy.com/https://github.com/JieYu-only/ThreadScout-plugin.git ./plugins/ThreadScout-plugin/
pnpm install --filter=threadscout-plugin
```

### 方式三：手动复制

将完整项目目录复制到 Yunzai 的 `plugins/ThreadScout-plugin/`：

```text
plugins/ThreadScout-plugin/
├── index.js
├── guoba.support.js
├── package.json
├── apps/
├── lib/
├── config/
│   └── default.yaml
└── data/
```

随后在 Yunzai 根目录安装依赖：

```bash
pnpm install --filter=threadscout-plugin
```

### 首次启动与配置

安装完成后重启 Yunzai：

```bash
pnpm restart
```

也可以前台运行：

```bash
node app.js
```

首次加载会自动生成 `plugins/ThreadScout-plugin/config/config.yaml` 和 SQLite 数据库，无需单独安装数据库服务。

推荐通过 **Guoba-Plugin → 插件配置 → ThreadScout 巡帖** 完成以下设置：

1. 锅巴提供“贴吧任务 1～3”三个独立区块；每个区块分别填写贴吧名称、使用账号、扫描范围、群号/资源和回复模板，最多管理三个贴吧。
2. 在强关键词、辅助词、负向词和排除词区域配置三个贴吧共用的扫描规则；带分数的关键词使用 `关键词 | 标题分 | 正文分` 格式。
3. 每个贴吧任务的“群号与回复资源”均可填写多行，格式为 `资源标识 | 类型 | 内容`，例如 `tarkov_main | qq_group | 123456`；该任务的模板使用 `{{resource:tarkov_main}}` 引用。不同任务建议使用不同的资源标识。
4. 在“更新 Cookie”中直接粘贴浏览器复制的完整 Cookie；插件会自动解析、去重并只保留贴吧登录所需字段，然后加密保存。该字段只写不回显。
5. 保持“观察”模式运行一段时间，确认匹配结果准确。
6. 确认无误后，在锅巴面板切换到“自动回复”，或由机器人主人发送 `#巡帖模式 自动`。

新任务默认每 180 分钟（3 小时）实际扫描一次；需要临时检查时可发送 `#巡帖立即扫描`。升级不会覆盖已有任务的扫描间隔，请在锅巴的对应任务区块中手动调整为 180 分钟。

观察模式下，每次实际扫描完成后会在服务器后台输出任务名称、读取数、检查数、自动命中数、候选数、排除数、忽略数和入队数；未达到扫描间隔而跳过时不输出汇总。机器人主人可发送 `#巡帖记录` 查看最近 8 条自动命中、候选或排除记录，也可发送 `#巡帖记录 <任务标识>` 只查看指定贴吧任务。记录包含帖子标题、评分、匹配原因和帖子链接；首次扫描仅建立基线，因此不会产生历史帖记录。

也可以由机器人主人私聊发送 `#巡帖扫码登录`，使用百度 App 扫描机器人返回的二维码并在手机上确认。登录成功后插件会先验证贴吧昵称，再将 Cookie 加密保存；群聊中不会发送二维码。多账号可用 `#巡帖扫码登录 账号标识` 指定绑定目标。

### 锅巴保存与账号状态说明

在锅巴面板点击“保存”后，配置会写入 `config/config.yaml` 并立即同步到当前运行实例，不需要再发送 `#巡帖重载配置`。保存成功时，服务器后台会出现以下日志：

```text
[ThreadScout][锅巴配置] 已保存并同步到运行实例
```

如果本次同时更新了 Cookie，日志还会显示账号标识和提取到的字段数量，但不会记录 Cookie 内容：

```text
[ThreadScout][锅巴配置] 已保存并同步到运行实例；账号 main_account 的 Cookie 已提取 N 个字段并加密保存
```

“更新 Cookie”是只写输入框，保存成功后自动清空属于正常现象，避免敏感凭证再次显示在网页中。请通过锅巴中的“绑定状态”或 `#巡帖账号` 检查结果。常见状态含义如下：

聊天回复会将 Cookie 来源显示为中文：`encrypted_file` 对应“锅巴加密保存”，`environment` 对应“服务器环境变量”。`main_account` 等账号标识为了供管理指令准确引用会保留原值，并与中文配置名称分行显示。

- `未绑定`：没有找到插件加密保存或环境变量提供的 Cookie。
- `已绑定 / encrypted_file`：Cookie 已由插件加密保存；这只代表存储成功，最终能否使用仍以在线验证结果为准。
- `已绑定但验证失败 / AUTH_EXPIRED`：贴吧已明确判定 Cookie 无效或过期，请重新绑定。
- `已绑定但验证失败 / AUTH_UNCONFIRMED`：插件已使用 `tbs` 与账号资料接口交叉验证，但服务器端仍未能确认登录状态；不会因此累计失败或清理 Cookie，可以继续测试扫描，自动回复前仍需确认凭证可用。
- `已绑定但验证失败 / ERROR: fetch failed`：服务器没有成功连接到贴吧，通常是网络、DNS、证书或代理配置问题，不能据此判定 Cookie 已过期。
- `ACCESS_DENIED` 或 `HTTP 403`：百度安全验证拒绝了当前服务器 IP 或请求方式，需要检查出口网络、代理或稍后重试。此状态不会累计 Cookie 失效次数，也不会自动清理 Cookie。

代理地址中的 `127.0.0.1` 指向运行 Yunzai 的服务器本机。只有代理程序也运行在该服务器上时，才能填写类似 `http://127.0.0.1:7890` 的地址；否则请填写服务器能够访问的代理地址，或留空使用直连。

### 账号管理

发送 `#巡帖账户管理`（兼容 `#巡帖账号管理`）可查看图片管理卡片。以下修改指令仅允许机器人主人私聊使用：

```text
#巡帖账户管理
#巡帖添加账号 <账号标识> <显示名称>
#巡帖启用账号 <账号标识>
#巡帖停用账号 <账号标识>
#巡帖解绑账号 <账号标识>
#巡帖删除账号 <账号标识>
#巡帖任务账号 <任务标识> <账号标识>
```

账号标识只能包含字母、数字、下划线和短横线。被任务引用的账号不能停用或删除，需要先用 `#巡帖任务账号` 将任务切换到其他已启用账号。解绑只删除加密保存的 Cookie；环境变量中的 Cookie 需要在服务器环境中手动删除。

没有安装 Guoba-Plugin 时，也可以直接编辑 `config/config.yaml`；Cookie 可通过环境变量 `THREADSCOUT_TIEBA_COOKIE_MAIN` 提供。

> 默认模式为 `observe`（观察），只扫描、评分和记录，不会实际回帖。

### 更新插件

机器人主人可以直接发送：

```text
#巡帖更新
#巡帖强制更新
```

普通更新检测到本地代码修改时会停止，避免覆盖改动。强制更新会先将已跟踪文件的本地差异保存到 `data/update-backups/`，再同步当前分支的远端版本；不会执行 `git clean`，因此不会删除配置、数据库、Cookie 或其他未跟踪文件。存在 Gitee 远端时优先使用 Gitee。更新回复样式与常见 Yunzai 插件一致：先提示正在更新，再显示最后更新时间，并通过合并转发展示本次更新日志和 Gitee 详情链接；更新完成后复用 TRSS-Yunzai 内置的重启与回执机制，在 2 秒后自动重启，启动完成后向原会话报告结果。即使代码已经是最新版本，更新指令也会重新检查依赖，以便恢复曾在依赖安装阶段中断的更新。

也可以在 Yunzai 根目录手动更新：

Gitee 安装：

```bash
git -C ./plugins/ThreadScout-plugin pull gitee main
pnpm install --filter=threadscout-plugin
pnpm restart
```

GitHub 安装：

```bash
git -C ./plugins/ThreadScout-plugin pull github main
pnpm install --filter=threadscout-plugin
pnpm restart
```

如果克隆后远端名称为默认的 `origin`，将上述命令中的 `gitee` 或 `github` 改为 `origin` 即可。

运行数据保存在插件的 `data/` 目录，配置保存在 `config/config.yaml`；两者均不会被 Git 更新覆盖。升级前仍建议备份这两个目录。

## 安全说明

本插件不保存账号密码，不提供验证码绕过、账号轮换规避限制或风控绕过。Cookie 加密文件和本机密钥位于 `data/auth.enc.json`、`data/auth.key`，两者都不能提交到 Git。插件保存的 Cookie 连续两次确认认证失效后会自动清理；环境变量由服务器管理，插件只会报告失效，无法代为删除。遇到认证失效、限流或连续失败时会停止自动发送并回到观察模式。贴吧页面或接口变化时应先更新适配器，切勿盲目重试。

## 测试

```bash
npm install
npm test
npm run check
```

数据库默认位于 `data/threadscout.db`，首次运行自动创建，无需单独部署数据库服务。
