import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  root: "client",
  build: { outDir: mode === "pro" ? "../dist-pro" : "../dist" },
  server: { port: 5173, proxy: { "/trpc": "http://localhost:3000", "/api": "http://localhost:3000" } },
}));
