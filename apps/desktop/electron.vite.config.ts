import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      rollupOptions: {
        preserveEntrySignatures: "exports-only",
        input: {
          index: "src/main/index.ts",
          "claude-policy-helper": "src/main/ai/claude-policy-helper.ts",
          "copilot-worker": "src/main/ai/copilot-worker.ts",
          "copilot-supervisor": "src/main/ai/copilot-supervisor.ts",
        },
        output: {
          chunkFileNames: "chunks/[name]-[hash].js",
          entryFileNames: (chunk) =>
            chunk.name === "claude-policy-helper"
              ? "claude-policy-helper.js"
              : "[name].js",
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: "out/preload",
      rollupOptions: {
        input: "src/preload/index.ts",
        output: {
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: "src/renderer/index.html",
      },
    },
  },
});
