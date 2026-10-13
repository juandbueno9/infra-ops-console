import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' permite servir el build bajo cualquier ruta (p. ej. /estado/)
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
});
