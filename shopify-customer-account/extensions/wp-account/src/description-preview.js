import { parseFragment } from "parse5";

const NON_VISIBLE_ELEMENTS = new Set(["script", "style", "template", "iframe"]);

/** Convert a preview fragment to display text, never to trusted HTML. */
export function descriptionPreview(value) {
  const fragment = parseFragment(String(value || ""));
  const parts = [];
  const pending = [...fragment.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (typeof node === "string") {
      parts.push(node);
      continue;
    }
    if (node.nodeName === "#text") {
      parts.push(node.value);
      continue;
    }
    if (NON_VISIBLE_ELEMENTS.has(node.tagName)) continue;
    if (node.tagName === "br") parts.push("\n");
    if (node.tagName === "p") pending.push("\n");
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  // parse5 already decoded entities exactly once. These characters remain text
  // children of s-text; never decode again or feed this result to an HTML sink.
  return parts.join("").trim().slice(0, 800);
}
