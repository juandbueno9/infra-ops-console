import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { ToastProvider } from './components/Toasts.jsx';
import { HostActionsProvider } from './hooks/useHostActions.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <HostActionsProvider>
        <App />
      </HostActionsProvider>
    </ToastProvider>
  </StrictMode>,
);
