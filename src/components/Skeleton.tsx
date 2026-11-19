/**
 * 首屏骨架屏：seed 数据先渲染，/api/data 返回后才换成线上数据。
 * 首次探测期间（checked=false）用它占位，避免内容闪变与数字跳动。
 */
export function HeroSkeleton() {
  return <section className="today-hero hero-skeleton" aria-label="正在载入" aria-busy="true">
    <div className="sk-corridor" aria-hidden="true">
      {Array.from({length: 12}, (_, i) => <span key={i} className={`sk-flyer ${i % 2 ? 'right' : 'left'}`} style={{animationDelay: `${-(i * 0.7).toFixed(1)}s`}} />)}
    </div>
    <div className="sk-stage">
      <div className="sk-card">
        <div className="sk-line sk-top" />
        <div className="sk-portrait" />
        <div className="sk-line sk-name" />
        <div className="sk-line sk-city" />
        <div className="sk-line sk-desc" />
        <div className="sk-line sk-desc short" />
        <div className="sk-stats"><span /><span /><span /></div>
      </div>
    </div>
    <div className="sk-bottom"><span className="sk-line" /><span className="sk-line short" /><span className="sk-line tiny" /></div>
  </section>;
}
