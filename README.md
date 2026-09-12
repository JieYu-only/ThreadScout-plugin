# ThreadScout-plugin

面向 TRSS-Yunzai 的主题扫描、规则评分和安全回复队列插件。V1 首个平台为百度贴吧，默认观察模式。

## 已实现

- 标题与主楼正文扫描；强词、辅助词、组合规则、负面词和硬排除词评分
- 首次运行只建立基线，避免启动后处理历史帖
- SQLite 持久队列、重启恢复、超时作废、发送前重新拉取并复核
- 同主题全局成功去重、每小时/每日限额、连续失败熔断
- 加权模板池、最近模板避重复、资源变量与渲染校验
- 多账号配置结构（V1 建议只启用一个账号）
- TRSS 命令：`#巡贴帮助`（兼容 `#巡帖帮助`，渲染图片帮助卡片）、`#巡帖状态`、`#巡帖立即扫描`、`#巡帖模式 观察|自动|停止`、`#巡帖队列`、`#巡帖账号`、`#巡帖重载配置`、`#巡帖更新`、`#巡帖强制更新`
- Guoba-Plugin 可视化配置，账号 Cookie 只写不回显并使用 AES-256-GCM 加密保存
- 请求超时、有限重试、异常 HTML 检测、错误分类及可配置 HTTP/HTTPS 代理

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

1. 填写贴吧名称、扫描范围、评分阈值和回复模板。
2. 填写群号等回复资源。
3. 在“更新 Cookie”中绑定贴吧 Cookie；该字段只写不回显，凭证会加密保存。
4. 保持“观察”模式运行一段时间，确认匹配结果准确。
5. 确认无误后，在锅巴面板切换到“自动回复”，或由机器人主人发送 `#巡帖模式 自动`。

没有安装 Guoba-Plugin 时，也可以直接编辑 `config/config.yaml`；Cookie 可通过环境变量 `THREADSCOUT_TIEBA_COOKIE_MAIN` 提供。

> 默认模式为 `observe`（观察），只扫描、评分和记录，不会实际回帖。

### 更新插件

机器人主人可以直接发送：

```text
#巡帖更新
#巡帖强制更新
```

普通更新检测到本地代码修改时会停止，避免覆盖改动。强制更新会先将已跟踪文件的本地差异保存到 `data/update-backups/`，再同步当前分支的远端版本；不会执行 `git clean`，因此不会删除配置、数据库、Cookie 或其他未跟踪文件。更新完成后会自动安装依赖，并提示重启云崽。

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

本插件不保存账号密码，不提供验证码绕过、账号轮换规避限制或风控绕过。Cookie 加密文件和本机密钥位于 `data/auth.enc.json`、`data/auth.key`，两者都不能提交到 Git。遇到认证失效、限流或连续失败时会停止自动发送并回到观察模式。贴吧页面或接口变化时应先更新适配器，切勿盲目重试。

## 测试

```bash
npm install
npm test
npm run check
```

数据库默认位于 `data/threadscout.db`，首次运行自动创建，无需单独部署数据库服务。
