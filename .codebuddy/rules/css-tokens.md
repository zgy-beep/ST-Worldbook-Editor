---
alwaysApply: false
paths: src/**/*.css
---

# 样式约束

改动 `src/styles/` 下 CSS 时适用。这些约束由 `test/ui-contract.test.mjs` 直接断言。

## 业务样式 `src/styles/style.css`

- 颜色**只能**用 `var(--nvui-*)` 令牌。令牌定义在 `ui-kit/tokens.css`（dark 110 个 / light 47 个）。
- 禁止出现：`!important`、`#hex` 颜色、`rgb()` / `rgba()` / `hsl()` / `hsla()`、
  `z-index: <数字>`、`position: fixed`、`--SmartTheme`。
- **所有普通选择器必须以 `#wbe-overlay` 开头**（逗号分隔的每一段都要）。
  `@` 开头的 at-rule 跳过检查。
- `@import` 必须位于所有业务规则**之前**。

## 宿主隔离层 `src/styles/host-isolation.css`

这是**唯一**允许使用 `!important` 的文件——专门用来对抗宿主主题的全局 `!important`。
若该文件不再需要 `!important`，测试会失败（断言必须真的用上）。

- 同样禁止颜色字面量与 `--SmartTheme`。
- 同样所有选择器必须限定在 `#wbe-overlay` 内。
- 取值只能走 Kit 令牌。
- 必须被 `style.css` 引入：`@import url('./host-isolation.css');`
  测试用正则匹配 `@import\s+url\(['"]?\.?\/host-isolation\.css['"]?\)`。

## 令牌一致性

- `ui-kit/tokens.json` 必须与 `ui-kit/tokens.css` 完全一致（dark 110/110、light 47/47，值零差异）。
- 解析陷阱：`.nvui-theme-light` 在**注释里**先出现，做块提取时必须用行首锚定的正则，
  否则会误取 dark 块。
- `--nvui-tab-ind-{w,h,x,y}` 未在 tokens.css 定义**不是缺陷**——由 `nvui-api.js` 运行时
  `setProperty` 动态写入几何，CSS 侧带 `0px` 兜底。不要试图「补齐」它。

## 其它

- 禁止 `url()` / `@font-face` 指向外部 CDN。
- 动态插入的内容需转义后再入 DOM。
