import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './style.css';
// import './neon.css';        // 原霓虹青主题，回退时取消注释这一行
import './theme.css';          // FLOWLINE 暖色主题（neon.css 的调色版本）
import './ascii.css';
import './flowline-scale.css'; // 面板字号放大 + 4K 背景动画降级（删此行+此文件即可回退）
import './trading-card.css';   // Rapper 球星卡全息效果（删此行+此文件即可回退）
import './depth.css';          // 轻量 2.5D：卡片分层视差 + 关系网焦点景深
import './holo-cards.css';     // 人物页 three.js 3D 球星卡舞台
import './rapper-detail.css';  // 人物大卡 + 星级评分弹层
import './holo-foil.css';      // 镭射分层（参考 pokemon-cards-css 的技术思路重写）
import './beef.css';           // BEEF 链视觉层：酸绿证据链+档案卡（删此行+此文件即可回退）
import './submit-menu.css';    // 右上角投稿中心下拉（删此行+此文件即可回退）
import './today-hero.css';     // 今日首屏：五张实体卡摊开 + 今日翻牌 + BEEF 线索（删此行+此文件即可回退）
import './rank-panel.css';     // 榜单/收藏回访页（删此行+此文件即可回退）
import './skeleton.css';       // 首屏骨架屏 + 错误边界（删此行+此文件即可回退）
import './visual-upgrade.css'; // 美术升级 v2：深空背景/玻璃卡/街头字体/强化微动效（删此行+此文件即可回退）
import './immersive.css';
import './atlas.css';          // 斑块地图：不规则省份轮廓 + 圆形头像随机散布（删此行+此文件即可回退）
import {DatasetProvider} from './state/Dataset';
import {ErrorBoundary} from './components/ErrorBoundary';
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary label="页面">
    <React.StrictMode><DatasetProvider><App/></DatasetProvider></React.StrictMode>
  </ErrorBoundary>
);
