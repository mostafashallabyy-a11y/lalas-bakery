import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // مكتبات ثابتة في chunk واحد بيتكاش مع كل نشر — وعدد طلبات أقل للمنيو
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom", "@supabase/supabase-js"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
