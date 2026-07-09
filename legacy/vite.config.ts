import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/demos/tusky-app',
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "plaid-threads/scss/variables";` // Automatically include variables globally
      }
    }
  }
})
