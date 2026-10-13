import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { FONT } from './scene/materials'

new FontFace('JetBrains Mono', `url(${FONT})`, { weight: '500' })
  .load()
  .then((f) => document.fonts.add(f))
  .catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
