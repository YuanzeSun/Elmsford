import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // /auth/callback: where Sign in with ChatGPT comes back to (registered as 127.0.0.1:8787).
    proxy: { "/api": "http://127.0.0.1:8787", "/auth": "http://127.0.0.1:8787" },
  },
});
