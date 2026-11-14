import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './style.css';
import './neon.css';
import {DatasetProvider} from './state/Dataset';
createRoot(document.getElementById('root')!).render(<React.StrictMode><DatasetProvider><App/></DatasetProvider></React.StrictMode>);
