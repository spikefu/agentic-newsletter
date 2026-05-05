# HTML renderer

**Language / environment:** Node.js 18+, ESM. Pure function — takes
a newsletter object, returns a complete standalone HTML document
string.

The renderer turns the JSON newsletter object emitted by the
Research agent into a self-contained HTML document with embedded
CSS. The same document is served by the server, downloaded by the
user, and printed to PDF.

## Document shape

```
<nav class="site-nav">  ← back-to-Home link
<header class="nl-header">
  Eyebrow ("Newsletter")
  Title
  Subtitle (optional, rendered as raw HTML — typically a credit
            link)
  Dateline (today's date or newsletter.generatedAt)
</header>
<div class="nl-intro"> …intro HTML… </div>
<div class="nl-section"> …per cluster… </div>
  Section number (zero-padded, e.g. "01")
  Section headline
  Section body (raw HTML)
  Further reading panel (key_links list, with optional dates)
<div class="nl-closing"> …closing HTML… </div>
<div class="nl-references"> …references HTML… </div>
```

The HTML and date fields in the JSON are inserted verbatim into the
document — only the title, link text, link URL, and link date go
through HTML escaping. This is deliberate: the agents are
instructed to emit `<p>`, `<strong>`, `<a>`, `<ul>` etc. inline.

## Visual design

Embedded CSS matches the design system of the host blog:
- Atkinson font (loaded from `/fonts/`)
- `--accent`     `#2337ff` (blue link color)
- `--black`      rgb(15,18,25)
- `--gray`       rgb(96,115,159)
- `--gray-light` rgb(229,233,240)
- 720px max-width content column
- Section dividers and a left-bordered "Further Reading" callout
- Dedicated print stylesheet that hides nav and zeroes wrapper
  padding

## Robustness

Missing fields are rendered as empty strings:
- No subtitle → no subtitle div.
- No closing → no closing div.
- No references → no references div.
- No sections → no section blocks.
- No `key_links` on a section → no further-reading panel.
- No `generatedAt` → today's date.
