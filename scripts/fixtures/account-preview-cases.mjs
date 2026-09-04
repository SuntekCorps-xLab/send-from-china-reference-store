// Synthetic input only. No live Shopify or account API is used by this fixture.
const encodedImage = '<img src="https://example.invalid/preview-probe" onerror="globalThis.__accountPreviewExecuted += 1">';

export const accountPreviewCases = [
  {
    name: "paragraphs-and-entities",
    description: "<p>Synthetic A &amp; B</p><p>Second<br>line</p>",
    expected: "Synthetic A & B\nSecond\nline",
  },
  {
    name: "single-entity-decoding",
    description: "&amp;lt;script&amp;gt;synthetic&amp;lt;/script&amp;gt;",
    expected: "&lt;script&gt;synthetic&lt;/script&gt;",
  },
  {
    name: "discard-non-content-and-active-elements",
    description: '<p>Visible synthetic text</p><script>globalThis.__accountPreviewExecuted += 1; fetch("https://example.invalid/preview-probe")</script><style>@import "https://example.invalid/preview-probe";</style><template>Hidden template</template><iframe src="https://example.invalid/preview-probe">Hidden frame</iframe><img src="https://example.invalid/preview-probe" onerror="globalThis.__accountPreviewExecuted += 1">',
    expected: "Visible synthetic text",
  },
  {
    name: "encoded-markup-stays-text",
    description: '&lt;img src="https://example.invalid/preview-probe" onerror="globalThis.__accountPreviewExecuted += 1"&gt;',
    expected: encodedImage,
  },
  {
    name: "mixed-case-and-comment-boundaries",
    description: '<P>Safe<!-- synthetic comment --><BR>text</P><ScRiPt>globalThis.__accountPreviewExecuted += 1</ScRiPt>',
    expected: "Safe\ntext",
  },
  {
    name: "numeric-entities",
    description: "&#x20AC; &#39; &quot; &#x1F642;",
    expected: "€ ' \" 🙂",
  },
  {
    name: "bounded-preview",
    description: `<p>${"S".repeat(950)}</p><img src="https://example.invalid/preview-probe" onerror="globalThis.__accountPreviewExecuted += 1">`,
    expected: "S".repeat(800),
  },
];
