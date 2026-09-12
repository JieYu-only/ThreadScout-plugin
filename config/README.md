# 配置说明

首次启动会把 `default.yaml` 复制为 `config.yaml`。请至少修改回复资源中的群号。

账号 Cookie 不写入配置文件。请在 TRSS-Yunzai 的运行环境中设置配置项 `cookie_env` 指向的环境变量，例如 `THREADSCOUT_TIEBA_COOKIE_MAIN`。值应为完整 Cookie 字符串，且只在你有权使用该账号时配置。

默认 `mode: observe`：会扫描、评分和记录，但绝不会实际回帖。规则观察稳定后，执行 `#巡帖模式 自动` 才会进入自动模式。
