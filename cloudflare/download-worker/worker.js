export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Root: landing page
    if (path === "/" || path === "") {
      return html(buildIndex());
    }

    // Directory listing for /android/
    if (path === "/android" || path === "/android/") {
      const list = await env.BUCKET.list({ prefix: "android/", delimiter: "/" });
      const files = list.objects
        .filter(o => o.key.endsWith(".apk"))
        .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime());
      return html(buildAndroidIndex(files));
    }

    // Serve file from R2 directly
    const key = path.startsWith("/") ? path.slice(1) : path;
    const object = await env.BUCKET.get(key);

    if (!object) {
      return new Response("File not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("Cache-Control", "no-cache, no-store, must-revalidate");

    if (key.endsWith(".apk")) {
      headers.set("Content-Type", "application/vnd.android.package-archive");
      headers.set("Content-Disposition", `attachment; filename="${key.split("/").pop()}"`);
    }

    return new Response(object.body, { headers });
  },
};

function html(body) {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function buildAndroidIndex(files) {
  const rows = files.length > 0
    ? files.map(f => {
        const name = f.key.replace("android/", "");
        const sizeMB = (f.size / 1024 / 1024).toFixed(1);
        const date = f.uploaded.toLocaleString("en-US", {
          month: "short", day: "numeric", year: "numeric",
          hour: "numeric", minute: "2-digit",
        });
        return `<tr>
          <td><a href="/android/${name}">${name}</a></td>
          <td>${sizeMB} MB</td>
          <td>${date}</td>
        </tr>`;
      }).join("\n")
    : `<tr><td colspan="3" style="color:#8a7e82">No builds yet</td></tr>`;

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Android Builds — Alpaca Playhouse</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #110e10; color: #f5f4ed; max-width: 700px; margin: 40px auto; padding: 20px; }
  h1 { color: #5cb85c; font-size: 22px; margin-bottom: 4px; }
  .sub { color: #8a7e82; font-size: 14px; margin-bottom: 24px; }
  a { color: #e99c48; text-decoration: none; }
  a:hover { text-decoration: underline; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; color: #8a7e82; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0; border-bottom: 1px solid #2e282b; }
  td { padding: 12px 0; border-bottom: 1px solid #1e1a1c; font-size: 14px; }
  td:nth-child(2), td:nth-child(3) { color: #8a7e82; }
  .back { display: inline-block; margin-bottom: 16px; font-size: 13px; }
</style>
</head><body>
<a href="/" class="back">&larr; Back</a>
<h1>Android Builds</h1>
<p class="sub">Alpaca Playhouse — Guest &amp; Resident App</p>
<table>
  <thead><tr><th>File</th><th>Size</th><th>Built</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
}

function buildIndex() {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Alpaca Playhouse — Downloads</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #110e10; color: #f5f4ed; max-width: 600px; margin: 40px auto; padding: 20px; }
  h1 { color: #5cb85c; font-size: 24px; }
  a { color: #e99c48; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .app { background: #1e1a1c; border-radius: 12px; padding: 20px; margin: 16px 0; }
  .app h2 { margin: 0 0 8px; font-size: 18px; }
  .app p { color: #8a7e82; margin: 4px 0; font-size: 14px; }
</style>
</head><body>
<h1>Alpaca Playhouse Downloads</h1>
<div class="app">
  <h2>Android — Alpaca Playhouse</h2>
  <p>Guest &amp; resident mobile app</p>
  <p><a href="/android/">Browse builds &rarr;</a></p>
</div>
</body></html>`;
}
