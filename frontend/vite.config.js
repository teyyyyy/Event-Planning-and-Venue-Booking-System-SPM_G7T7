import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; // envDir points at the repo root so the shared .env (VITE_SUPABASE_*) is picked up.
export default defineConfig({ plugins: [react()], envDir: '..', server: { port: 5173 } });
