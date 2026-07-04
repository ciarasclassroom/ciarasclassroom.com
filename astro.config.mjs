import AutoImport from "astro-auto-import";
import config from "./src/config/config.json";
import icon from "astro-icon";
import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import remarkAutolinkHeadings from "remark-autolink-headings";
import remarkCollapse from "remark-collapse";
import remarkEmoji from "remark-emoji";
import remarkExternalLinks from "remark-external-links";
import remarkGfm from "remark-gfm";
import remarkHtml from "remark-html";
import remarkImages from "remark-images";
import remarkLint from "remark-lint";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import remarkSlug from "remark-slug";
import remarkToc from "remark-toc";
import remarkYoutube from "remark-youtube";
import sitemap from "@astrojs/sitemap";
import tailwind from "@astrojs/tailwind";
import { defineConfig, squooshImageService } from "astro/config";
import removeTagWhitespace from "astro-remove-whitespace";

// https://astro.build/config
export default defineConfig({
  site: config.site.base_url ? config.site.base_url : "https://ciarasclassroom.com",
  base: config.site.base_path ? config.site.base_path : "/",
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  image: {
    service: squooshImageService(),
  },
  integrations: [
    react(),
    sitemap({
      filter: (page) =>
        !page.includes("/admin") &&
        !page.endsWith("/search") &&
        // Exclude per-currency product variants (…-US, …-IE, …-AU, …). They are
        // orphaned near-duplicates that canonicalise to the base product URL, so
        // only the base page belongs in the sitemap.
        !/\/product\/.+-(US|CA|IE|UK|AU|NZ|SG|HK|ZA|IN|MY|PH|AE)\/?$/.test(page),
      changefreq: "weekly",
      priority: 0.7,
      lastmod: new Date(),
    }),
    tailwind({
      config: {
        applyBaseStyles: false,
      },
    }),
    AutoImport({
      imports: [
        "@/shortcodes/Button",
        "@/shortcodes/Accordion",
        "@/shortcodes/Notice",
        "@/shortcodes/Video",
        "@/shortcodes/Youtube",
        "@/shortcodes/Tabs",
        "@/shortcodes/Tab",
      ],
    }),
    mdx(),
    icon(),
    removeTagWhitespace(),
  ],
  markdown: {
    remarkPlugins: [
      remarkHtml,
      remarkYoutube,
      remarkAutolinkHeadings,
      remarkExternalLinks,
      remarkEmoji,
      remarkImages,
      remarkGfm,
      remarkToc,
      remarkSlug,
      remarkMath,
      remarkRehype,
      remarkLint,
      [
        remarkCollapse,
        {
          test: "Table of contents",
        },
      ],
    ],
    shikiConfig: {
      theme: "one-dark-pro",
      wrap: true,
    },
    extendDefaultPlugins: true,
  },
});
