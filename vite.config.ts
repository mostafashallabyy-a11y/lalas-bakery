import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import imageMap from "./src/lib/image-map.json";

/**
 * بيدخّل خريطة الصور جوه HTML نفسه. السكربت الصغير اللي في index.html بيستخدمها
 * عشان يبدأ تحميل أول صور المنيو قبل ما حزمة الجافاسكريبت تنزل — ده بيقصّر
 * أكبر جزء في زمن LCP (تأجيل طلب الصورة).
 */
function inlineImageMap(): Plugin {
  return {
    name: "inline-image-map",
    transformIndexHtml(html) {
      return html.replace("/*__IMAGE_MAP__*/ {}", JSON.stringify(imageMap));
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineImageMap()],
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
