import { createRoot } from 'react-dom/client'
import { App } from './App'
import './pin.css'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<App />)
}
