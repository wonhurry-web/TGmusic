import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerResilientApi } from './services/musicApi';
import resilientApi from './services/resilientApi';
import './index.css';
import './App.css';

// 在线曲库统一入口：个人 token 直连优先，失败降级服务端代理，再降级内置曲库
registerResilientApi(() => resilientApi);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
