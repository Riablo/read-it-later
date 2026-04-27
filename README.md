# 稍后阅读

一个使用 Bun 运行的本地稍后阅读服务。抓取标题和摘要的逻辑内置在项目里，不依赖外部 CLI。

## 运行

```bash
bun install
bun run dev
```

默认访问地址是 `http://127.0.0.1:3042`。

停止本地服务：

```bash
bun run stop
```

## 保存 URL

在浏览器中打开类似下面的地址即可保存：

```text
http://127.0.0.1:3042/save?url=https%3A%2F%2Fexample.com
```

服务会抓取目标页面的标题、摘要和来源信息，把结果存到本地，然后回到列表页。
