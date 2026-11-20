import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Inter, self-hosted from the bundle (latin subset, the four weights the UI uses).
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import './index.css'
import App from './App.tsx'
import { initMonitoring } from './monitoring'

initMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
