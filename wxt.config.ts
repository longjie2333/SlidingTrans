import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    name: "SlidingTrans",
    description: "选中文本，即刻获得 AI 翻译、词典释义和发音。",
    permissions: ["storage"],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "SlidingTrans",
    },
  },
});
