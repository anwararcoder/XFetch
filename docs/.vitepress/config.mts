import { defineConfig } from "vitepress";

export default defineConfig({
  title: "XFetch",
  description: "Universal HTTP fetching library",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/getting-started" },
      { text: "API Reference", link: "/api/client" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Advanced Usage", link: "/guide/advanced" },
          { text: "SSR Support", link: "/guide/ssr" },
        ],
      },
      {
        text: "API Reference",
        items: [
          { text: "Core Client", link: "/api/client" },
          { text: "React Integration", link: "/api/react" },
          { text: "Vue Integration", link: "/api/vue" },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/anwararcoder/XFetch' }
    ],
    footer: {
      message: 'Released under the MIT License.',
      copyright: '© 2026 Anwar Ramadan - AR-Coder Company'
    },
  },
});
