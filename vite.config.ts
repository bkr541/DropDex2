import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const analyze = env.ANALYZE === 'true';

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      analyze && visualizer({ filename: 'dist/stats.html', open: true, gzipSize: true }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 3000,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Keep Supabase JS out of the main chunk — it's large and only
            // needed after auth resolves
            supabase: ['@supabase/supabase-js'],
            // Google GenAI only used on the Discovery/AI tab
            genai: ['@google/genai'],
          },
        },
      },
    },
  };
});
