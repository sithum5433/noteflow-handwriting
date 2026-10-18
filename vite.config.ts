// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  optimizeDeps: { include: ["jspdf", "svg2pdf.js"] },
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "assets",
  },
});
