# Words in Bloom / Reading Lab — 2026-10-18

当前改版以国际主义的网格、对齐、文字层级为基础，参考 Apple 网页的留白、系统无衬线字体、白与浅灰表面、克制蓝色操作及轻盈导航。阅读正文、中文释义与说明均补强了可读对比度。学习记录的存储键及业务数据保持原有契约。

- 阅读首页：介绍与可试听的单词卡并列，随后是进度、继续阅读、学习入口及文章列表。
- 词汇首页：先展示学习操作，再呈现词库进度。移动端统计改为紧凑网格。
- 阅读页：单句精读使用独立段落卡，练习模式保留原文和题目双栏；手机改为单栏。
- 单词、例句、搭配和文章继续支持美式/英式口音、语速与停止，系统语音静默启动时四秒后回退。
- 新主题文件为 `public/reading/polished.css` 与 `public/international.css`。书页图沿用已有素材。

验证：`node scripts/check-all.mjs` 覆盖词库、资源、脚本、阅读业务及十四个语音行为场景。浏览器检查桌面首页、精读、查词弹窗、词汇学习、键盘点读、口音/语速、切换停止和 390px 宽度布局。

## 上一版设计与素材来源存档

本次根据用户提供的 Swiss Brut 参考图重设计：纯白与黑灰、严格网格、超大无衬线标题、细横线、编辑式列表与一张黑白书页摄影。主导航改为顶部横排，移动端保留底部导航；阅读正文与词义解释使用舒适字号，巨型文字仅用于首页和分区入口。学习数据结构、导入、题目评分与复习调度保持原有契约。

## 图像素材

- 工具：内置 `image_gen`，全新生成，非参考图裁切或修改。
- 项目文件：`public/reading/editorial-book.png`，1536 × 1024。
- 提示词：

> Use case: photorealistic-natural. Asset type: premium editorial website hero photograph for a minimalist English reading learning platform. Create one striking black and white macro still-life photograph of a thick open book, fanned curved paper edges crossing diagonally from lower left toward upper right. Tightly cropped sculptural pages, a broad dark ink-black shadow on one side, luminous silver-gray white paper on the other, rich physical paper grain, high contrast directional studio lighting, minimalist Swiss International Style / luxury art-direction, genuine optical close-up photo, not a render. Landscape 3:2 composition, no people, no hands, no devices, no flowers, no colored geometric shapes, no borders, no typography, no readable letters, no logos or watermarks. The image should feel tactile, calm, intelligent, sophisticated and slightly abstract while still clearly a book. It will be cropped within the left half of a split website hero.

## 文件

- `public/reading/international.css`：新的主题与页面布局，基于现有交互基础样式。
- `public/reading/app.js`：顶部导航、首页、阅读索引与页脚的新结构。
- `public/reading/mark.svg`：黑白字母标识。
