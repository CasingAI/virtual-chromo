# jsproxy 原始源码（参考副本）

来自 [EtherDream/jsproxy-browser](https://github.com/EtherDream/jsproxy-browser/tree/master/src/proxy/src) 的浏览器端源码，MIT 许可。用于对照 `public/bundle.js` 黑盒，**不参与运行时加载**。完整第三方归属见仓库根目录 [THIRD-PARTY.md](../../THIRD-PARTY.md)。与上游的运行时耦合项见 [docs/jsproxy-legacy-decoupling.md](../../docs/jsproxy-legacy-decoupling.md)。

## 与 bundle 的对应关系

| Webpack module | 源文件 |
|----------------|--------|
| 0 | `urlx.js` |
| 1 | `hook.js` |
| 2 | `util.js` |
| 3 | `msg.js` |
| 4 | `env.js` |
| 5 | `path.js` |
| 6 | `cookie.js` |
| 7 | `route.js` |
| 8 | `signal.js` |
| 9 | `tld.js` + `tld-data.js` |
| 10 | `jsfilter.js` |
| 11 | `database.js` |
| 12 | `client.js` + `storage.js` + `fakeloc.js` |
| 13 | **`index.vc.js`**（virtual-chromo 定制；上游为 `index.js`） |
| 14 | `page.js` |
| 15 | `sw.js` + `cdn.js` + `network.js` + `inject.js` |

## virtual-chromo 定制

单用户全局状态（build `20260728-v12`+）：无 BrowserContext / `session.js`；cookie 单 jar；storage 按 siteOrigin；代理 URL 为 `/-----https://…`；热缓存为全局 `method+url+TTL`。清状态用 `VC_CLEAR_STATE`。

`index.vc.js` 相对上游 `index.js` 的改动（为双层 iframe 外壳）：

- **Shell 页检测**：不限于 `win === top`；viewer 外壳 iframe 也可初始化 jsproxy
- **子 frame**：调用 `parent.__init__` 而非 `top.__init__`
- **日志**：`[jsproxy] shell page inited`

## 单文件可读版

合并后的可读副本：`../bundle.reconstructed.js`（`npm run reconstruct:bundle` 重新生成）。

## 更新上游

```bash
# 按需重新拉取（会覆盖本地副本）
for f in cdn client cookie database env fakeloc hook index inject jsfilter msg network page path route signal storage sw tld urlx util tld-data; do
  curl -sL "https://raw.githubusercontent.com/EtherDream/jsproxy-browser/master/src/proxy/src/${f}.js" \
    -o "public/jsproxy-src/${f}.js"
done
npm run reconstruct:bundle
```

`index.vc.js` 为本地定制，更新上游后需人工核对是否仍适用。
