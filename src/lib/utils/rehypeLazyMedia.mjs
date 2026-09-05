/**
 * Adds `loading="lazy"` / `decoding="async"` to media inside Markdown content.
 *
 * Markdown images (`![alt](src)`) and the iframes remark-youtube generates are emitted
 * by plugins, so they cannot carry these attributes at the source. Without them every
 * blog post eagerly downloads its inline images and YouTube players.
 *
 * Runs on the rehype (HTML) tree, after the remark plugins have produced elements.
 */
const LAZY_TAGS = new Set(["img", "iframe"]);

const visit = (node, callback) => {
  callback(node);
  for (const child of node.children ?? []) visit(child, callback);
};

export default function rehypeLazyMedia() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type !== "element" || !LAZY_TAGS.has(node.tagName)) return;
      node.properties ??= {};
      node.properties.loading ??= "lazy";
      node.properties.decoding ??= "async";
    });
  };
}
