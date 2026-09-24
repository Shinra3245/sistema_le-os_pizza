import React from 'react';
import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { App } from './react/App.jsx';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
