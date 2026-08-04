import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Espelha o alias "@/*" do tsconfig.json para que os testes possam importar
// os mesmos caminhos usados pelo app (src/lib/analysis, src/lib/core, ...).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
