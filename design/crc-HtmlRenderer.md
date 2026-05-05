# HtmlRenderer
**Requirements:** R107, R108, R109, R110, R111, R112, R113, R114

Pure function. Takes a newsletter object, returns a complete
standalone HTML document string ready to serve, save, or print to
PDF.

## Knows
- Embedded CSS — host-blog design system (Atkinson font, `#2337ff`
  accent, gray palette, 720px max-width, 18px base, print
  stylesheet)
- Document structure (nav, header, intro, sections, closing,
  references)

## Does
- `renderNewsletterHTML(newsletter)` — builds the HTML in one go;
  HTML-escapes only the title, link text, link URL, and link date
  (other fields are inserted verbatim because the agents emit
  inline HTML deliberately)
- Computes the dateline from `newsletter.generatedAt` (falling back
  to today)
- Skips the subtitle, closing, references, sections, and
  Further-Reading panels gracefully when their fields are absent
- Numbers each section with a zero-padded "01"-style prefix

## Collaborators
- Server: passes the cached newsletter object, writes the result
  to `cache/newsletter.html`, points BrowserTools.printToPDF at it

## Sequences
- seq-fresh-run.md
