# 稍后阅读

一个使用 Bun 和 `readlater-cli` 运行的本地稍后阅读服务。

## 运行

```bash
bun install
bun run dev
```

默认访问地址是 `http://127.0.0.1:3042`。

## 保存 URL

在浏览器中打开类似下面的地址即可保存：

```text
http://127.0.0.1:3042/save?url=https%3A%2F%2Fexample.com
```

服务会调用 `readlater-cli fetch -j <url>`，把结果存到本地，然后回到列表页。
