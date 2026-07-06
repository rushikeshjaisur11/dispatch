const http = require("http");

/** Fixed (not ephemeral) so it can be added once to Supabase's redirect-URL allow-list —
 * matches lib.rs's LOCAL_REDIRECT_PORT rationale (Supabase's wildcard localhost-port
 * matching is unreliable, supabase#34912). */
const LOCAL_REDIRECT_PORT = 53682;

function startLocalRedirectListener(win) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      const code = url.searchParams.get("code");
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>Signed in — you can close this tab.</body></html>");
      server.close();
      win.webContents.send("email-auth-redirect", { payload: { code } });
    });
    server.on("error", reject);
    server.listen(LOCAL_REDIRECT_PORT, "127.0.0.1", () => resolve(server.address().port));
  });
}

module.exports = { startLocalRedirectListener };
