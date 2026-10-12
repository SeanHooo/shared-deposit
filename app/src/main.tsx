import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClientProvider } from '@solana/react';
import { client } from './providers';
import { App } from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClientProvider client={client}>
      <App />
    </ClientProvider>
  </React.StrictMode>,
);

