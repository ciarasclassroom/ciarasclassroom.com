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
import rehypeInternalProductLinks from "./src/lib/utils/rehypeInternalProductLinks.mjs";
import { isThinTaxonomyUrl } from "./src/lib/utils/thinTaxonomies.mjs";
import rehypeLazyMedia from "./src/lib/utils/rehypeLazyMedia.mjs";

// https://astro.build/config
export default defineConfig({
  site: config.site.base_url ? config.site.base_url : "https://ciarasclassroom.com",
  base: config.site.base_path ? config.site.base_path : "/",
  // Must stay "always". The site is served by GitHub Pages, which 301-redirects
  // /foo to /foo/ for every directory-backed page. With "never", every canonical
  // tag, sitemap entry and Merchant feed link pointed at the redirecting form, so
  // Search Console logged them as "Page with redirect" rather than indexing the URL
  // as submitted. Emitting the slash matches what the host actually serves.
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  image: {
    service: squooshImageService(),
  },
  integrations: [
    react(),
    sitemap({
      filter: (page) =>
        !page.includes("/admin") &&
        // Matches with or without the trailing slash: the site emits "/search/", so an
        // endsWith("/search") test silently stopped excluding it when trailingSlash
        // became "always", and the noindexed search page went back into the sitemap.
        !/\/search\/?$/.test(page) &&
        // Exclude per-currency product variants (…-US, …-IE, …-AU, …). They are
        // orphaned near-duplicates that canonicalise to the base product URL, so
        // only the base page belongs in the sitemap.
        !/\/product\/.+-(US|CA|IE|UK|AU|NZ|SG|HK|ZA|IN|MY|PH|AE)\/?$/.test(page) &&
        // Tag/category listings with a single post behind them are near-duplicates of
        // that post. They are noindexed, so keep them out of the sitemap too rather
        // than submitting URLs we have told Google not to index.
        !isThinTaxonomyUrl(page),
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
    rehypePlugins: [rehypeLazyMedia, rehypeInternalProductLinks],
    shikiConfig: {
      theme: "one-dark-pro",
      wrap: true,
    },
    extendDefaultPlugins: true,
  },
});
