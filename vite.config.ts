import preact from "@preact/preset-vite";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true,
    outDir: resolve(__dirname, "src/public"),
    lib: {
      entry: resolve(__dirname, "src/client"),
      name: "client",
      fileName: "client",
      formats: ["es"],
    },
    minify: true,
    terserOptions: {
      compress: true,
      mangle: true,
    },
  },
  plugins: [preact()],
});
