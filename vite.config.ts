import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: resolve(__dirname, "./src") }],
  },
  build: {
    sourcemap: true,
    outDir: resolve(__dirname, "src/public"),
    lib: {
      entry: resolve(__dirname, "src/client"),
      name: "client",
      fileName: "client",
      formats: ["es"],
    },
  },
  plugins: [preact(), tailwindcss()],
});
