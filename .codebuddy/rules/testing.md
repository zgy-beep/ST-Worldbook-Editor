---
alwaysApply: false
paths: "test/**/*.mjs, ui-kit/test/**/*.js"
---

# 测试规范

改动测试文件时适用。

## 两套测试体系，不要混

| 命令 | 范围 | 数量 | 位置 |
|---|---|---|---|
| `npm test` | 扩展自身行为 | 38 | `test/*.test.mjs` |
| `npm run test:kit` | NVUI Kit 规范守护 | 354 | `ui-kit/test/test-ui-kit.js` |
| `npm run test:browser` | 浏览器端到端 | 1 套 | `test/browser-smoke.mjs` |

`ui-kit/test/` 属于上游 Kit 的自包含测试套件，**扩展业务测试不要往那里加**。

## 写法

- 用 `node:test` + `node:assert/strict`，无外部测试框架依赖。
- fixture 用**动态 import + query 后缀**隔离模块缓存：
  ```js
  const module = await import(`../src/runtime.js?case=${moduleId++}`);
  ```
  这样每个用例拿到全新的模块级状态（`migrationChecked` 这类标志位才能独立测试）。
- 用 `Object.defineProperty(globalThis, 'localStorage', {...})` 造宿主环境，
  装完记得恢复。
- 断言要**有区分力**：光断言「有值」测不出回归。列表类 fixture 要够长才能触发滚动/分页分支。

## 变异验证（重要）

写完回归测试后，**必须做一次变异验证**：把修复代码改回旧行为，确认测试**立即失败**。
只看到测试变绿不算证明测试有效。

```bash
# 改坏 → 跑测试 → 确认 AssertionError 且退出码 1 → 改回
npm test
```

## 浏览器冒烟测试

- 本机零依赖设计，必须显式给两个环境变量（见 AGENTS.md）。
- 脚本**不能抛裸 `MODULE_NOT_FOUND`**：缺依赖时打印可操作的修复方案。
- 模拟宿主与酒馆助手，**不调用真实模型、不读写用户已有世界书**。
- **fixture 必须内联宿主的 `!important` 覆盖规则**（`input:not([type])` / `select` / `input[type=checkbox]`），
  否则「浅色主题下控件是否跟随 Kit 令牌」这类断言恒成立、失去区分力。
- 移动端 Kit 会切成底部抽屉：`.nvui-tabs` 不可见，要点 `.nvui-bottom-nav-item[data-key="entries"]`。
- 移动端点过条目后 `show-edit` 状态会留着，测列表视图前要先点 `.wbe-back`。
- Kit 会持久化当前标签：断言块里切了 tab，结束前要切回后续流程期望的标签。

## 依赖边检查

`ui-contract.test.mjs` 会扫描 `src/` 下的相对 `import` 与 CSS `@import`，断言全部指向仓库内真实文件。
新增文件后这个检查必须仍然通过——**零断链**。
