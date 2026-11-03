# GitHub Pages 发布

项目使用 GitHub Actions 构建静态站点并发布到 GitHub Pages。仓库地址为 <https://github.com/aaazhai22-collab/English-learning-website>。

## 访问入口

- 阅读工坊首页：<https://aaazhai22-collab.github.io/English-learning-website/>
- 词间日和：<https://aaazhai22-collab.github.io/English-learning-website/vocabulary.html>
- 动词词库：进入词间日和后，选择「词集库 → 动词词库」。

这两个地址是本仓库的 Pages 目标地址；实际发布状态以仓库 Actions 中的部署结果为准。

## 更新与构建

向 `main` 分支提交代码后，`.github/workflows/pages.yml` 会运行检查、构建并部署。也可以在仓库 Actions 页面手动运行「Publish GitHub Pages」。仓库 Settings → Pages 的发布来源使用 GitHub Actions。

本地构建只需 Node.js 24，无需安装额外依赖：

```sh
npm run check
npm run build:pages
node scripts/check-pages.mjs
```

输出目录为 `_site/`，不提交生成文件。工作流在构建后还会验证页面、模块及资源路径、运行时配置，以及原词库和 OCR 数据是否完整。默认路径前缀是 `/English-learning-website/`，也可覆盖：

```sh
node scripts/build-pages.mjs --base-path /English-learning-website/
```

构建会将阅读页作为首页，将词汇页输出为 `vocabulary.html`，并修正项目子目录中的样式、图片、脚本、词库与内部链接。OCR 引擎和中英文识别数据随站点一起发布。

## 学习数据和联网功能

学习记录、收藏、导入文章和词库进度保存在当前浏览器。新地址无法自动读取旧网站的本地数据：先在原站「学习画像与设置 → 备份与恢复」导出完整备份，再到新地址恢复；恢复时可勾选原词间日和词汇进度。

GitHub Pages 不运行 Node.js 或 Worker 后台。静态版在浏览器内处理本地词库、阅读、图片识别、复习及免费解析逻辑。在线词典、翻译、可选模型和备用发音仍取决于网络、服务额度与跨域策略；设备语音可用于点读。来源网页若不允许跨域读取，请打开原站并复制正文、题目，或使用图片导入。

站点不包含服务器密钥。若使用可选模型，在学习设置中输入的密钥仅用于本次浏览器会话；不要把密钥写入源码、GitHub Actions 配置或发布目录。静态站点也不提供跨设备自动同步。

原 Node/Worker 源码保留在仓库中供后续需要后台服务时使用，Pages 工作流只上传 `_site/`。

## 忽略文件

`.gitignore` 排除依赖目录、构建输出、测试截图与报告、临时文件、编辑器文件、本地环境变量、凭据及原托管平台元数据。发布目录由工作流生成，不包含 Git 历史、私有配置或本地学习数据。
