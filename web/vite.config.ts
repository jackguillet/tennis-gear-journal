// The new Tennis Hub front end (React + Tailwind + shadcn/ui). It builds into public/next/ and is
// served at /next/ beside the current app until it covers every tab; see web/README.md.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  base: "/next/",
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": here("./src"),
      // The models are shared with the current app, the API and the chat connector. Import them, don't copy them.
      "@models": here("../public"),
    },
  },
  server: {
    // `npm run dev` (port 3000) serves the API; the Vite dev server sends API calls there.
    proxy: { "/api": "http://localhost:3000" },
    fs: { allow: [here("..")] },
  },
  build: { outDir: here("../public/next"), emptyOutDir: true },
});
