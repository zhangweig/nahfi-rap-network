import {Component, type ErrorInfo, type ReactNode} from 'react';

/**
 * 错误边界：任一子树渲染抛错时只替换那一块，不再整站白屏。
 * 用 resetKey 在切换区块 / 重试时自动清除错误状态。
 */
interface Props { children: ReactNode; label?: string; resetKey?: string | number }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State { return {error}; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label || 'UI'}] 渲染失败:`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({error: null});
  }

  private retry = () => this.setState({error: null});

  render() {
    if (!this.state.error) return this.props.children;
    return <div className="error-fallback" role="alert">
      <span className="error-fallback-mark">!</span>
      <h3>这块内容没能显示</h3>
      <p>{this.props.label ? `「${this.props.label}」出错` : '页面某处出错'}，其他部分仍可正常使用。可以重试或刷新页面。</p>
      <details><summary>错误详情</summary><code>{this.state.error.message}</code></details>
      <button onClick={this.retry}>重试</button>
    </div>;
  }
}
