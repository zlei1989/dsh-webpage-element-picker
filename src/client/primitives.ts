/**
 * DSH UI 原语绑定——本插件复用的官方组件从这里单点取得。
 *
 * 与 `react.ts` 同一套机制：浏览器模块表（shell 的静态种子表）通过注入的
 * `require` 提供 `@deepseek-ai/dsh-client-ui-primitives`；本包不携带它的运行时
 * 实现，只在 `package.json` 的 `dsh.client.external` 里声明这份依赖，让 host
 * 把它排进 boot 图（见 README「客户端依赖」）。
 *
 * 该模块表是 harness 的能力边界：极端情况下（宿主 DSH 未提供该种子）`require`
 * 会抛异常。此处捕获后回报 null，由 `index.ts` 降级渲染，避免整个输入框槽位
 * 因单个原语缺失而崩溃。
 *
 * 日志：与 client 入口同一格式（前缀 + 级别），调用方负责按级别输出。
 */

import type { PrimitiveModule } from './primitives-types'

/** 模块表里 UI 原语的 specifier（host 侧 dsh.client.external 必须是同一字符串）。 */
export const PRIMITIVES_MODULE = '@deepseek-ai/dsh-client-ui-primitives'

/** 探测结果：原语模块（不可用时为 null）与失败原因（成功时为空串）。 */
export interface PrimitivesProbe {
  module: PrimitiveModule | null
  error: string
}

/**
 * 从注入的 `require` 取原语模块，失败不抛出。
 * @returns 原语模块（可能为 null）与失败原因。
 */
export function loadPrimitives(): PrimitivesProbe {
  try {
    const mod = require(PRIMITIVES_MODULE) as PrimitiveModule | undefined
    // 只校验本插件真正要用的两个导出：模块表应答了不完整的表面时同样走降级
    if (!mod || typeof mod.Modal !== 'function' || typeof mod.Button !== 'function') {
      return { module: null, error: '模块表已应答但缺少 Modal/Button 导出' }
    }
    return { module: mod, error: '' }
  } catch (err) {
    const e = err as Error | null | undefined
    return { module: null, error: String((e && e.message) || err || '未知错误') }
  }
}

/** 模块加载时探测一次：bundle 求值发生在 boot 图排好序之后，此后模块表不再变化。 */
export const PRIMITIVES: PrimitivesProbe = loadPrimitives()
