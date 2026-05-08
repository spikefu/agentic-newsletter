# Sequence: Bookmarklet-initiated run
**Requirements:** R139, R143, R145, R146, R147, R149, R150

The user clicks the installed bookmarklet on any page in any
debug-port-enabled Chrome window. A new tab opens on the
newsletter UI, and the run is scoped to that window's tabs.

```
SourcePage  Browser           WebUi            Server          BrowserTools/CDP
   |          |                 |                 |                  |
   |-click bm>|                 |                 |                  |
   |          | (bm JS runs)    |                 |                  |
   |          | nonce = rand()  |                 |                  |
   |          | window.open(`<origin>/?nl-nonce=N`)                  |
   |          |---- GET /?nl-nonce=N ------------>|                  |
   |          |<------------- index.html ---------|                  |
   |          |                 |                 |                  |
   |          |  (page reads ?nl-nonce on load)   |                  |
   |          |                 |---- GET /api/tabs?nonce=N -------->|
   |          |                 |                 |-- find target where URL contains N ->|
   |          |                 |                 |<-- targetId -------------------------|
   |          |                 |                 |-- Browser.getWindowForTarget(tid) -->|
   |          |                 |                 |<-- windowId --------------------------|
   |          |                 |                 |-- list all targets, filter by wid -->|
   |          |                 |                 |<-- scoped tabs -----------------------|
   |          |                 |<-- { tabs:[…] } |                  |
   |          |                 |  (renders the scoped tab list)     |
   |          |                 |                 |                  |
   |          |  (Generate proceeds via /api/stream — same as unscoped flow, R149)        |
```

Notes:
- The new tab Chrome opens in step 2 lives in the source window
  (Chrome's default `window.open` behavior). That's what makes the
  windowId resolution possible — the new tab IS in the window we
  want to scope to.
- If the nonce target isn't found in CDP (closed early, CDP
  unreachable), the handler falls back to the unscoped any-window
  list (R150).
- The bookmarklet itself contains only the URL with the nonce —
  no remote-controlled JS, no `eval`, no secrets (R144).
