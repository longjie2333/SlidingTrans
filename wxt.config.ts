import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  publicDir: "images",
  manifest: {
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    name: "SlidingTrans",
    description: "选中文本，即刻获得 AI 翻译、词典释义和发音。",
    icons: {
      16: "logo-square.png",
      32: "logo-square.png",
      48: "logo-square.png",
      128: "logo-square.png",
    },
    permissions: ["storage"],
    host_permissions: ["<all_urls>"],
    web_accessible_resources: [{ resources: ["logo-round.png"], matches: ["<all_urls>"] }],
    action: {
      default_title: "SlidingTrans",
      default_icon: {
        16: "logo-round.png",
        32: "logo-round.png",
        48: "logo-round.png",
        128: "logo-round.png",
      },
    },
  },
});
