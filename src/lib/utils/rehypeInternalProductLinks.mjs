/**
 * Points blog links at our own resource pages instead of straight at TpT.
 *
 * Posts link to teacherspayteachers.com when they mention a resource, and nearly all of
 * those resources have a page on this site too. Sending the reader (and the ranking
 * signal) offsite on the first click wastes the strongest internal link available: a
 * topical article pointing at the commercial page for the thing it is about.
 *
 * TpT product URLs end in the numeric id that our own slugs also end in
 * (…/Product/Some-Resource-1234567), so the two can be matched without a lookup table.
 * Anything that does not match — store pages, an unlisted resource — stays external but
 * becomes nofollow noopener rather than passing signal on.
 *
 * Done here rather than by editing the Markdown so the CMS content stays canonical and
 * the mapping re-resolves on every build as the catalogue changes.
 *
 * Runs on the rehype (HTML) tree, after remark has produced anchor elements.
 */
import products from "../fixtures/tpt_products_MOST_RECENT.json";

const slugByTptId = new Map(products.map((product) => [product.slug.split("-").pop(), product.slug]));

const visit = (node, callback) => {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
};

/** `…/Product/Some-Resource-1234567?utm_source=…` -> "1234567" */
const tptIdFromHref = (href) => {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null; // relative or malformed — not a TpT link
  }
  if (!url.hostname.endsWith("teacherspayteachers.com")) return null;
  const lastSegment = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
  return lastSegment.match(/(\d{5,})$/)?.[1] ?? null;
};

export default function rehypeInternalProductLinks() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== "element" || node.tagName !== "a") return;
      node.properties ??= {};

      const href = node.properties.href;
      if (typeof href !== "string") return;

      const slug = slugByTptId.get(tptIdFromHref(href));

      if (slug) {
        node.properties.href = `/product/${slug}/`;
        delete node.properties.target;
        delete node.properties.rel;
        return;
      }

      // remark-external-links already marks offsite anchors; make sure the ones we are
      // deliberately leaving offsite do not pass ranking signal.
      if (/^https?:\/\//i.test(href)) {
        node.properties.rel = "nofollow noopener";
        node.properties.target = "_blank";
      }
    });
  };
}
