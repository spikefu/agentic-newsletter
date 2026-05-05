# UI: Main page layout
**Requirements:** R115, R116, R117, R118, R119, R120, R122, R123, R125, R127, R128, R129, R140, R141

Single-page layout. Cards stack vertically inside a 1100px max
content column. The Advanced toggle in the header reveals extra
panels.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  📰 Newsletter Agent           [provider/model]·  $0.0000   ⚙ Advanced  │  ← header (sticky)
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─ 📂 Chrome Tabs · N tabs ──────────────────────  bookmarklet ▾  ↺ ┐  │
│  │  • title (domain)                                                  │  │
│  │  • title (domain)  …                                               │  │
│  │  ┌─ Drag this to your bookmarks bar ────────────────────────────┐ │  │
│  │  │  [📰 Newsletter from this window]   (collapsed by default)   │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ Run · Saved ✓ ──────────────────────────────────────────────────┐   │
│  │ ┌─ What were you reading about?────────────────────────────────┐ │   │
│  │ │ [textarea]                                                   │ │   │
│  │ │ chips: [AI safety] [climate] [LLM tooling] …                 │ │   │
│  │ └──────────────────────────────────────────────────────────────┘ │   │
│  │ ┌─ Newsletter Style (Advanced) ────────────────────────────────┐ │   │
│  │ │ [textarea]                                                   │ │   │
│  │ └──────────────────────────────────────────────────────────────┘ │   │
│  │  [✨ Generate]   [⚡ Research Only*]   [↺ Clear & Redo*]   [🗑] │   │
│  │  Phase 1 banner: Discovery running...        (Advanced)         │   │
│  │  Phase 2 banner: Research running...         (Advanced)         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─ Settings (Advanced)*─────────────────────────────────────────────┐  │
│  │  agent     | model         | num_ctx | max tokens | thinking      │  │
│  │  Elicitor  | …             | …       | 512        | ▢             │  │
│  │  Discovery | …             | …       | 16000      | ▣             │  │
│  │  Research  | …             | …       | 16000      | ▣             │  │
│  │  Podcast   | …             | …       | 4000       | ▢             │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ Progress ────────────────────────────────────────────────────────┐  │
│  │  ① Discovery   pending  →  ② Research   pending  →  ③ Done       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ Agent Activity · model badge*─────────────────────────────────────┐ │
│  │  [streaming feed log with status, tool calls,                       │ │
│  │   thinking* and prompts*]                                           │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─ Discovery Clusters · N clusters (Advanced)*──────────────────────┐  │
│  │  [grid of cluster cards]                                           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ Newsletter Output [⬇ HTML] [⬇ PDF] [🎙 Podcast] [📁 Save] ────┐  │
│  │  [rendered newsletter HTML]                                       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─ Podcast Script · N words ────────────────────────────────────────┐  │
│  │  [script preview + ▶ play / ⏹ stop using browser SpeechSynthesis] │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘

* = Advanced-only element
```

References: WebUi (crc-WebUi.md), manifest-ui.md.
