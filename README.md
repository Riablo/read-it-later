# 稍后阅读

一个轻量的本地稍后阅读服务，支持 Node.js 本地开发和 Bun / Docker 运行。标题和摘要的抓取逻辑内置在项目里，不依赖外部 CLI。

## 本地开发（Node.js）

安装 **Node.js 24 或更新版本**，在当前 worktree 目录直接运行：

```bash
npm run dev
```

打开 **http://127.0.0.1:3043**。运行服务不需要安装依赖，也不需要启动 Docker。

- 修改 `src/` 内的代码，Node 会自动重启服务。
- 修改 `public/index.html`、`public/styles.css` 或 `public/app.js` 后，刷新浏览器即可看到变化，静态资源不缓存。
- 按 `Ctrl+C` 停止当前开发进程。
- 开发默认使用 **3043** 端口，与 Docker 的 **3042** 端口分开。
- 数据保存在**当前 worktree** 的 `data/readlater.json`，首次保存时创建；不会修改原工作目录里的 Docker 数据，也不会提交到 Git。新 worktree 的列表起初为空。

需要指定其他端口或数据文件时：

```bash
PORT=3045 READLATER_DATA=./data/preview.json npm run dev
```

如果希望用已有收藏预览，可将原工作目录的 `data/readlater.json` **复制**到当前 worktree 的同名路径。保留独立副本即可分别调试。

也可以继续用 Bun 开发：

```bash
bun install --frozen-lockfile
bun run dev:bun
```

`npm run start:node` 或 `bun run start` 可直接运行服务（默认端口 3042，无自动重启）。原来的 `bun run stop` 用于旧版 LaunchAgent / tmux 服务；当前 worktree 开发请使用 `Ctrl+C` 停止。

## 验证

Node 端到端检查无需额外依赖，使用临时数据和本地测试页面，不会访问真实收藏：

```bash
npm run test:smoke
```

完整检查（需要 Bun）：

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun scripts/smoke.mjs
```

## Docker 运行

Docker 继续使用原来的 Bun 镜像、3042 端口和数据挂载：

```bash
docker compose up -d --build
```

访问 `http://127.0.0.1:3042`。项目的 `./data` 目录挂载到容器里的 `/app/data`，容器重建不会删除 `data/readlater.json`。

在新 worktree 中完成调整、提交并合并回原分支后，回到**原工作目录**执行：

```bash
docker compose up -d --build
```

Docker 会将合并后的 `src/` 和 `public/` 打包，沿用原目录的收藏数据。本地开发不引入额外构建产物。

查看日志或停止容器：

```bash
docker compose logs -f
docker compose down
```

## 保存 URL

在浏览器中打开下面的地址即可保存（本地开发使用 3043；Docker 使用 3042）：

```text
http://127.0.0.1:3043/save?url=https%3A%2F%2Fexample.com
```

服务会抓取目标页面的标题、摘要和来源信息，保存到本地后回到列表页。

收件箱中的链接打开后会自动移入回收站；留存中的链接可重复打开。回收站支持恢复、留存和确认后永久清空。
