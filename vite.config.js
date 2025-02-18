import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    allowedHosts: [
      'localhost',
      '250a-1-37-82-133.ngrok-free.app'
    ]
  },
  plugins: [react()],
  optimizeDeps: {
    include: [
      'tesseract.js',
      '@headlessui/react',
      'framer-motion'
    ]
  }
})
