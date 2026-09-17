/**
 * DSH UI 原语（`@deepseek-ai/dsh-client-ui-primitives`）的本地类型表面。
 *
 * 该包由 harness 模块表在运行时提供、不列入本包依赖，所以这里自带一份最小
 * 声明，让 `tsc --noEmit` 无需该包的 node_modules 即可检查类型。只声明本插件
 * 实际消费的导出与 props 子集：既避免固化 DSH 内部实现细节，也让宿主版本
 * 差异收敛到这一处。
 */

import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** DSH Modal 原语 props（Portal 到 body 的居中遮罩 + 卡片，自带 Esc/遮罩关闭）。 */
export interface PrimitiveModalProps {
  open: boolean
  /** 对话框标题：即可见标题，也作为卡片的 aria-label。 */
  title: string
  /** 关闭按钮的无障碍标签（必填，供本地化）。 */
  closeLabel: string
  /** Esc 与点击遮罩时触发。 */
  onClose: () => void
  /** 追加到卡片元素上的类（用于覆盖卡片几何）。 */
  className?: string
  children?: ReactNode
  footer?: ReactNode
  /** true 时只渲染遮罩与卡片本体，不渲染默认头部/关闭按钮。 */
  headless?: boolean
}

/** DSH Button 原语 props：视觉族 × 尺寸，`--dsw-alias-button-*` 令牌驱动。 */
export interface PrimitiveButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
  size?: 'md' | 'sm'
  icon?: ReactNode
}

/** 原语模块中本插件用到的两个组件。 */
export interface PrimitiveModule {
  Modal: (props: PrimitiveModalProps) => ReactNode
  Button: (props: PrimitiveButtonProps) => ReactNode
}

/** 原语组件类型（可空：模块表未提供时为 null，由调用方降级）。 */
export type PrimitiveModal = PrimitiveModule['Modal']
export type PrimitiveButton = PrimitiveModule['Button']
