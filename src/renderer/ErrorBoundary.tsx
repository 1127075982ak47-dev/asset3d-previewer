import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
  info: string
}

/**
 * 渲染进程的最后一道网。没有它，任何一个组件抛异常整个窗口就白屏，
 * 用户只能杀进程重开。
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('渲染进程异常', error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    const text = `${error.stack ?? error.message}\n${info}`
    return (
      <div className="fatal">
        <h2>界面出错了</h2>
        <p>这不该发生。你可以重新加载界面继续用；如果反复出现，把下面的错误信息发给作者。</p>
        <pre>{text}</pre>
        <div className="actions">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(text)
            }}
          >
            复制错误信息
          </button>
          <button className="primary" onClick={() => location.reload()}>
            重新加载
          </button>
        </div>
      </div>
    )
  }
}
