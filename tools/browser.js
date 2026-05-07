// CRC: crc-BrowserTools.md | Seq: seq-fresh-run.md | R72
import CDP from 'chrome-remote-interface'
import http from 'http'
import fs from 'fs'

const DEBUG_PORT = parseInt(process.env.CHROME_DEBUG_PORT || '9222', 10)

// CRC: crc-BrowserTools.md
export function fetchChromeJson(path, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${DEBUG_PORT}${path}`, (res) => {
      let raw = ''
      res.on('data', (c) => (raw += c))
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', (e) =>
      reject(
        new Error(`Chrome not reachable on port ${DEBUG_PORT}: ${e.message}`)
      )
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error(`Timeout connecting to Chrome on port ${DEBUG_PORT}`))
    })
  })
}

async function withBrowserClient(fn) {
  const versionInfo = await fetchChromeJson('/json/version')
  const client = await CDP({ target: versionInfo.webSocketDebuggerUrl })
  try {
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

// CRC: crc-BrowserTools.md | Seq: seq-bookmarklet-run.md | R146, R147
export async function getWindowsForTargets(targetIds) {
  return withBrowserClient(async (client) => {
    const entries = await Promise.all(
      targetIds.map(async (id) => {
        try {
          const { windowId } = await client.Browser.getWindowForTarget({
            targetId: id,
          })
          return [id, windowId]
        } catch {
          return [id, null]
        }
      })
    )
    return new Map(entries)
  })
}

// CRC: crc-BrowserTools.md
async function withTab(fn) {
  let target = null
  let client = null
  try {
    target = await CDP.New({ port: DEBUG_PORT })
    client = await CDP({ target, port: DEBUG_PORT })
    const { Page, Runtime } = client
    await Page.enable()
    return await fn({ Page, Runtime })
  } finally {
    if (client) await client.close().catch(() => {})
    if (target)
      await CDP.Close({ port: DEBUG_PORT, id: target.id }).catch(() => {})
  }
}

async function navigate(Page, url, timeoutMs = 20000) {
  const loaded = new Promise((resolve) => Page.loadEventFired(resolve))
  await Page.navigate({ url })
  await Promise.race([loaded, new Promise((r) => setTimeout(r, timeoutMs))])
}

// CRC: crc-BrowserTools.md | Seq: seq-paste-urls.md | R231, R232
/**
 * Open `url` as a new tab in the debug Chrome instance and leave it open.
 *
 * Resolves with `{ id, url }` on success. Rejects with an Error whose message
 * is suitable for surfacing as a per-URL `failed` reason.
 *
 * Side effects: creates one tab in Chrome that persists after this call returns.
 */
export async function openTab(url) {
  const target = await CDP.New({ port: DEBUG_PORT, url })
  return { id: target.id, url: target.url || url }
}

// CRC: crc-BrowserTools.md | Seq: seq-fresh-run.md | R82
export async function webSearch(query, maxResults = 8) {
  try {
    return await withTab(async ({ Page, Runtime }) => {
      await navigate(
        Page,
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=us-en`
      )
      const { result } = await Runtime.evaluate({
        expression: `(function(max) {
          const items = [...document.querySelectorAll('.result')].slice(0, max);
          return JSON.stringify(items.map(el => ({
            title:   el.querySelector('.result__a')?.textContent?.trim()       || '',
            url:     el.querySelector('.result__url')?.textContent?.trim()     || '',
            snippet: el.querySelector('.result__snippet')?.textContent?.trim() || ''
          })).filter(r => r.title.length > 2));
        })(${maxResults})`,
      })
      const results = JSON.parse(result?.value || '[]')
      return results.length
        ? results
        : [{ title: 'No results found', url: '', snippet: '' }]
    })
  } catch (err) {
    if (err.message?.includes('connect'))
      return [
        {
          title: 'Chrome not available',
          url: '',
          snippet: `Start Chrome with --remote-debugging-port=${DEBUG_PORT}`,
        },
      ]
    return [
      {
        title: 'Search error',
        url: '',
        snippet: String(err.message).slice(0, 200),
      },
    ]
  }
}

// CRC: crc-BrowserTools.md | Seq: seq-fresh-run.md | R83
export async function printToPDF(url, outputPath) {
  return withTab(async ({ Page }) => {
    await navigate(Page, url, 30000)
    await new Promise((r) => setTimeout(r, 800))
    const { data } = await Page.printToPDF({
      printBackground: true,
      paperWidth: 8.5,
      paperHeight: 11,
      marginTop: 0.6,
      marginBottom: 0.6,
      marginLeft: 0.6,
      marginRight: 0.6,
      preferCSSPageSize: false,
    })
    fs.writeFileSync(outputPath, Buffer.from(data, 'base64'))
  })
}

function formatDate(raw) {
  if (!raw) return null
  try {
    const d = new Date(raw)
    if (isNaN(d.getTime())) return raw.slice(0, 40) // return as-is if unparseable
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return raw.slice(0, 40)
  }
}

// CRC: crc-BrowserTools.md | Seq: seq-fresh-run.md | R76, R77, R78, R79, R80, R81
export async function fetchPage(url, maxChars = 8000) {
  try {
    return await withTab(async ({ Page, Runtime }) => {
      await navigate(Page, url)
      const { result } = await Runtime.evaluate({
        expression: `(function() {
          // Extract date metadata BEFORE removing <script> tags (JSON-LD lives there)
          const dateSources = [
            document.querySelector('meta[property="article:published_time"]')?.content,
            document.querySelector('meta[property="og:updated_time"]')?.content,
            document.querySelector('meta[name="date"]')?.content,
            document.querySelector('meta[name="publish-date"]')?.content,
            document.querySelector('meta[name="pubdate"]')?.content,
            document.querySelector('meta[name="DC.date.issued"]')?.content,
            document.querySelector('time[datetime]')?.getAttribute('datetime'),
            (() => {
              try {
                for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
                  const d = JSON.parse(s.textContent || '{}');
                  const hit = d.datePublished || d.dateCreated
                    || d['@graph']?.find?.(n => n.datePublished)?.datePublished;
                  if (hit) return hit;
                }
              } catch {}
              return null;
            })()
          ].filter(Boolean);
          const date = dateSources[0] || null;

          // Now strip clutter and get readable text
          ['script','style','nav','footer','header','aside'].forEach(sel =>
            document.querySelectorAll(sel).forEach(el => el.remove())
          );
          const text = (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();

          return JSON.stringify({ text, date });
        })()`,
      })

      const parsed = (() => {
        try {
          return JSON.parse(result?.value || '{}')
        } catch {
          return {}
        }
      })()
      const text = parsed.text || ''
      const date = formatDate(parsed.date)
      const prefix = date ? `[Published: ${date}]\n\n` : ''
      return (prefix + text).slice(0, maxChars)
    })
  } catch (err) {
    if (err.message?.includes('connect'))
      return `Could not connect to Chrome on port ${DEBUG_PORT}. Start Chrome with --remote-debugging-port=${DEBUG_PORT}`
    return `Could not fetch ${url}: ${err.message}`
  }
}
