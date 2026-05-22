// Vercel deployment — Cloudflare plugin explicitly disabled.
// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";

const apiProxyTarget = (() => {
  const raw = process.env.VITE_API_URL?.trim();
  if (!raw) return "http://localhost:4000";
  return raw.replace(/\/+$/, "").replace(/\/api$/i, "");
})();

export default defineConfig({
  cloudflare: true,
  vite: {
    build: {
      sourcemap: true,
    },
    server: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [
      ViteImageOptimizer({
        // Default options are usually good enough (lossless compression)
        png: { quality: 80 },
        jpeg: { quality: 80 },
        jpg: { quality: 80 },
        webp: { lossless: true },
      }),
    ],
  },
});
