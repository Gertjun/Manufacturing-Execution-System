import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const p = (f: string) => fileURLToPath(new URL(f, import.meta.url));
export default defineConfig({
  base: "./",
  resolve: {
    alias: [
      { find: /^pg$/, replacement: p("./src/stubs.ts") },
      { find: /^@fastify\/jwt$/, replacement: p("./src/stubs.ts") },
      { find: /^@fastify\/type-provider-typebox$/, replacement: p("./src/typebox.ts") },
      { find: /^typebox(\/.*)?$/, replacement: p("./node_modules/typebox") + "$1" },
    ],
  },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  build: { target: "es2022", outDir: "dist", emptyOutDir: false, chunkSizeWarningLimit: 4000 },
  server: { fs: { allow: [".."] } },
});
