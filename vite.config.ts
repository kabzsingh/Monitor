import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { TanStackStartVite } from "@tanstack/start-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    TanStackRouterVite(),
    TanStackStartVite(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    process.env.NODE_ENV === "production" ? cloudflare() : null,
  ].filter(Boolean),
  ssr: {
    external: ["nodemailer"],
  },
  build: {
    target: "esnext",
  },
});
