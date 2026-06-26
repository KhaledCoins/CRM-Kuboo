import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase') || id.includes('node_modules/supabase')) return 'vendor-supabase'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'vendor-charts'
          if (id.includes('node_modules/@dnd-kit')) return 'vendor-dnd'
        },
      },
    },
  },
})
