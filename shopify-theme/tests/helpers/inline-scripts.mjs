import { parseFragment } from "parse5";

const CLASSIC_SCRIPT_TYPES = new Set([
  "", "text/javascript", "application/javascript", "text/ecmascript", "application/ecmascript",
]);

/** Read inline classic JavaScript source without executing or sanitizing it. */
export function inlineClassicScripts(source) {
  const fragment = parseFragment(source, { sourceCodeLocationInfo: true });
  const scripts = [];
  const pending = [...fragment.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (node.tagName === "script") {
      const attributes = new Map(node.attrs.map(({ name, value }) => [name, value]));
      const type = (attributes.get("type") || "").trim().toLowerCase();
      if (!attributes.has("src") && CLASSIC_SCRIPT_TYPES.has(type)) {
        const location = node.sourceCodeLocation;
        if (!location?.startTag || !location.endTag) {
          throw new Error("Inline script must have an explicit closing tag");
        }
        scripts.push(source.slice(location.startTag.endOffset, location.endTag.startOffset));
      }
    }
    // A template's content is inert and is not part of childNodes.
    const children = node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return scripts;
}
