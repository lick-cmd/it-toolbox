import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './ui/Icon'

export interface ToolErrorBoundaryProps {
  toolName: string
  children: ReactNode
}

interface ToolErrorBoundaryState {
  error: Error | null
}

/**
 * 单个工具的渲染异常隔离。
 *
 * 崩溃被限制在工具面板内，侧栏与搜索仍然可用 —— 用户可以切到别的工具继续工作。
 * 调用方必须传入 key={toolId}，否则切换工具时错误态不会重置。
 */
export class ToolErrorBoundary extends Component<ToolErrorBoundaryProps, ToolErrorBoundaryState> {
  constructor(props: ToolErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ToolErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ToolErrorBoundary] 工具「${this.props.toolName}」渲染异常`, error, info)
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Icon name="alert" size={22} className="text-danger" />
        <p className="text-fg">「{this.props.toolName}」出现异常</p>
        <p className="code-text max-w-lg break-all text-muted">{error.message}</p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="h-6 rounded-sm border border-border bg-surface-2 px-3 text-[12px] hover:border-accent"
        >
          重试
        </button>
      </div>
    )
  }
}
