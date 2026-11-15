/**
 * Application entry point for the Gauchos Judíos frontend.
 * Sets up the interface languages (i18n.js), loads global Bootstrap 5.3
 * styles and mounts the root React component.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
// Imported for its side effect: i18next is ready before the first render.
import './i18n.js';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
