import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-slate-950" />}>
      <App />
    </Suspense>
  </React.StrictMode>
);
