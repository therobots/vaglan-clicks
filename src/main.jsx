import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import '@/index.css'
import { isSupabaseConfigured, supabaseUrl } from './lib/supabaseConfig'

if (isSupabaseConfigured && supabaseUrl) {
  const preconnect = document.createElement('link')
  preconnect.rel = 'preconnect'
  preconnect.href = new URL(supabaseUrl).origin
  preconnect.crossOrigin = 'anonymous'
  document.head.appendChild(preconnect)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
