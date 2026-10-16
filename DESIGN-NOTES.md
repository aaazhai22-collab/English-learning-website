# Reading Lab — International Typographic Style

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
