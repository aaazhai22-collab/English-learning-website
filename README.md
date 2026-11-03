# 阅读工坊 · 词间日和

GitHub 仓库：<https://github.com/aaazhai22-collab/English-learning-website>

GitHub Pages：<https://aaazhai22-collab.github.io/English-learning-website/>

此仓库提供 GitHub Pages 静态发布：阅读工坊为首页，`vocabulary.html` 为完整词间日和，包含 168 条动词相关卡片。推送到 `main` 后，GitHub Actions 自动检查、构建和发布。发布说明与平台限制见 [GITHUB-PAGES.md](./GITHUB-PAGES.md)。

```sh
npm run check
npm run build:pages
```

构建结果位于 `_site/`；不提交生成文件、个人进度、密钥、临时材料或旧站托管配置。旧站和新站是不同地址，需要在旧站导出完整备份，再到新站的“设置与数据备份”导入。


现已融合「阅读工坊」作为网站首页：文章导入、零基础双语精读、点击查词、单词/短语/语法分类收藏、难题复习和间隔调度。原词间日和完整保留在 `/index.html`，原有浏览器词汇进度继续可用。新增功能、模型配置、联网范围与测试说明见 [READING-LAB.md](./READING-LAB.md)。

按参考网站 https://wordsinbloom-43-128-57-209.sslip.io/ 的词汇内容构建，保留词集库、沉浸学习、记忆卡片、测试、收藏与番茄钟。词库快照包含 40 个词集、2,557 个单词，资源均保存在项目内，无需连接原站后台。

2026-10-18 改版：阅读工坊与词汇站统一为国际主义网格及 Apple 网页风格的白灰蓝主题，使用系统无衬线字体、清晰的文字层级和响应式留白。首页增加可直接点读的单词卡；手机端优先展示学习操作，精读和词汇页保留全部原有功能。系统语音启动超过四秒无反馈时自动尝试在线备用发音。

## 本地运行

词间日和的「词集库」内提供「语法词库」与「动词词库」入口。动词词库收录 168 个动词、词形与搭配卡片，其中《英语零基础核心清单与逐句结构分析练习》的 120 个主要动词保留 75 个必背、45 个扩展标记及原表变化形式。be 的 am/is/are 标为现在时形式；旧词形卡关联原形，并配简短双语例句、用法和点读。手册原句与补充例句分别标注。此次只更新动词，语法词库共 235 个词条。

从动词词库进入学习、翻卡或三种记忆测试时，会保留分类、搜索和收藏筛选。选择题排除同义、同拼写及同原形词形的干扰项；例句填空只使用目标词形确实出现的例句。原 40 期常规词库、旧词条 ID、学习记录与已有朗读编号保持稳定。

`public/data/grammar-handbook.json` 保留手册词条和例句来源标记。`node scripts/import-core-handbook.mjs` 仅合并本次动词数据；`node scripts/import-grammar-handbook.mjs` 验证原常规词库哈希后生成总词库。运行 `npm run check` 检查 120 行原表、变化形式、范围及编号兼容性。

若托管地址暂时被网络服务拦截，可生成单文件离线词汇版：

```sh
node scripts/build-offline.mjs /absolute/path/words-in-bloom-grammar.html
```

生成文件可用浏览器直接打开，包含常规词库、语法词库、内嵌样式和点读逻辑，无需启动服务器。离线点读使用设备语音，不请求在线语音服务；不同浏览器和线上地址的学习进度各自保存。

需要 Node.js 18 或更新版本，无需安装第三方依赖：

```sh
npm run dev
```

打开 http://localhost:5173 。请通过 HTTP 服务访问，直接双击 HTML 会受到浏览器对模块及 JSON 文件访问的限制。设置 `PORT` 环境变量可更换端口。

## 点读

- 点击单词或旁边的喇叭、英文例句、常用搭配即可朗读。
- 右下角「点读」可切换英式/美式发音、调整 0.5–1.25 倍语速、试听、重播或停止。
- 点击新的文本会中断上一条；切换学习内容、离开页面或按 Esc 停止朗读。
- 键盘 Tab 聚焦后，Enter/空格也可点读。
- 优先使用浏览器 Web Speech API 中的英语语音，音色和口音可用性由设备决定。未安装英语语音或系统语音失败时，通过站点同源接口使用 Google 在线发音（需要网络）。接口只接受公开词库的整数序号，发送的内容限定为参考站点词条、例句和搭配；搜索内容与个人学习记录不会发送。不需要第三方语音 API 密钥。
- 学习进度、收藏和点读设置保存在当前浏览器，清理网站数据会清除这些记录。

## 文件

`public/reading.html` 与 `public/reading/app.js` 为阅读工坊，`public/reading/polished.css` 为阅读主题。`public/index.html` 为词汇页面，`public/international.css` 为词汇主题。`public/read-aloud.js` 接入词汇点读 UI，`public/speech.js` 管理发音。`public/data/catalog.json` 为参考站点公开词库快照。

```sh
npm run check
```

原 Worker 部署工具 `npm run build:worker`（需自行提供 `.openai/hosting.json`）将页面、图片与词库打包为 `dist/server/index.js`，可部署为 Cloudflare Worker；不需要数据库或额外密钥。`worker/index.js` 与本地服务器共享语音接口，拒绝任意文本和外部 URL。单独把 `public/` 部署为静态站点时，系统语音仍可用，在线备用需要同源 `/api/tts` 接口。

本地 Node.js 24 会读取 Windows 现有系统代理以访问在线发音；其他环境可设置 `HTTPS_PROXY`。网络不可用时，安装系统英语语音包后仍可通过浏览器语音点读。

参考页面、词库和图片来自用户指定网站。
