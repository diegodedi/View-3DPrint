import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/design-system.css';
import './styles/utilities.css';
import './styles/catpin-utilities.css';
import './styles/app.css';
import './styles/inspector.css';
import './styles/catpin.css';
import './styles/smart-slicer.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

