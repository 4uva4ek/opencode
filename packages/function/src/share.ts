import { Hono } from "hono"

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Session sharing has been discontinued</title>
  </head>
  <body style="font-family: system-ui, sans-serif; max-width: 32rem; margin: 20vh auto; padding: 0 1.5rem; line-height: 1.5">
    <h1 style="font-size: 1.25rem">Session sharing has been discontinued</h1>
    <p>OpenCode no longer hosts shared sessions. This link and its content are no longer available.</p>
    <p><a href="https://opencode.ai">opencode.ai</a></p>
  </body>
</html>`

// V1 clients still create, sync, and remove shares on this host, and the V1 GitHub Action fails its run when share
// creation fails. Accept those requests without storing anything so existing clients keep working.
export default new Hono()
  .post("/api/share", async (c) => {
    const body = await c.req.json<{ sessionID: string }>()
    const id = body.sessionID.slice(-8)
    return c.json({ id, secret: "discontinued", url: new URL(`/share/${id}`, c.req.url).toString() })
  })
  .post("/api/share/:shareID/sync", (c) => c.json({}))
  .delete("/api/share/:shareID", (c) => c.json({}))
  .all("*", (c) => c.html(page, 410))
