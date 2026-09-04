import assert from "node:assert/strict";
import test from "node:test";

import { descriptionPreview } from "../extensions/wp-account/src/description-preview.js";

test("preview decodes HTML entities once without exposing another encoded layer", () => {
  assert.equal(descriptionPreview("&amp;lt;b&amp;gt;desk&amp;lt;/b&amp;gt;"), "&lt;b&gt;desk&lt;/b&gt;");
  assert.equal(descriptionPreview("&amp;quot;Desk&amp;quot; &amp;#39;tray&amp;#39;"), "&quot;Desk&quot; &#39;tray&#39;");
});
test("preview parses quoted tag attributes without leaking attribute fragments", () => {
  assert.equal(descriptionPreview('<p title="quality > cost">Desk</p>'), "Desk");
});
test("preview omits non-visible script, style, and template content", () => {
  assert.equal(descriptionPreview("<script>not visible</script><style>not visible</style><template>not visible</template><p>Desk</p>"), "Desk");
});
test("preview preserves normal visible text and line boundaries", () => {
  assert.equal(descriptionPreview("<p>Blue &amp; white<br>Desk</p>"), "Blue & white\nDesk");
  assert.equal(descriptionPreview("<P>One</P><p>Two</p>"), "One\nTwo");
});
test("encoded markup stays literal text after one parse", () => {
  assert.equal(descriptionPreview("&lt;b&gt;Desk&lt;/b&gt;"), "<b>Desk</b>");
});
test("preview handles comments and empty non-visible elements", () => {
  assert.equal(descriptionPreview("<p>Desk</p><!-- hidden --!><img src=x><p>Tray</p>"), "Desk\nTray");
});
test("preview keeps empty input and the existing 800 code-unit display limit", () => {
  assert.equal(descriptionPreview(null), "");
  assert.equal(descriptionPreview(""), "");
  assert.equal(descriptionPreview("<p>" + "文".repeat(1000) + "</p>"), "文".repeat(800));
});
test("preview handles deep and long input without recursive traversal failure", () => {
  assert.equal(descriptionPreview("<div>".repeat(12000) + "Desk" + "</div>".repeat(12000)), "Desk");
  assert.equal(descriptionPreview("<p>" + "x".repeat(100000) + "</p>").length, 800);
});
