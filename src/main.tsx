import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './style.css';
// import './neon.css';        // 原霓虹青主题，回退时取消注释这一行
import './theme.css';          // FLOWLINE 暖色主题（neon.css 的调色版本）
import './ascii.css';
import './flowline-scale.css'; // 面板字号放大 + 4K 背景动画降级（删此行+此文件即可回退）
import './trading-card.css';   // Rapper 球星卡全息效果（删此行+此文件即可回退）
import './beef.css';           // BEEF 链视觉层：酸绿证据链+档案卡（删此行+此文件即可回退）
import './submit-menu.css';    // 右上角投稿中心下拉（删此行+此文件即可回退）
import {DatasetProvider} from './state/Dataset';
createRoot(document.getElementById('root')!).render(<React.StrictMode><DatasetProvider><App/></DatasetProvider></React.StrictMode>);
