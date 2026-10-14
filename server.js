// Static server for "Who is the Spy?" — runs on Node.js or Bun, no deps.
//   node server.js        (or: bun server.js, PORT=8080 node server.js)

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PORT = parseInt(process.env.PORT || "3000", 10);
const ROOT = path.resolve(__dirname);
// Bump APP_VERSION on every release and keep index.html asset URLs in sync
// (styles.css?v=N, script.js?v=N) so phones never run stale cached files.
const APP_VERSION = "16";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const GZIP_RE = /\.(html|css|js|json|svg|txt|webmanifest)$/;

function cacheControl(file, versioned) {
  if (/sw\.js$/.test(file)) return "no-cache, must-revalidate";
  if (/\.(woff2?|ttf|png|ico)$/.test(file)) return "public, max-age=31536000, immutable";
  if (/\.(wav|mp3|ogg)$/.test(file)) return versioned ? "public, max-age=31536000, immutable" : "public, max-age=3600";
  if (versioned && /\.(css|js|json|svg)$/.test(file)) return "public, max-age=31536000, immutable";
  if (/\.(css|js)$/.test(file)) return "public, max-age=3600";
  if (/\.html$/.test(file)) return "no-cache, must-revalidate";
  return "public, max-age=0, must-revalidate";
}

function send(req, res, filePath, stats, versioned) {
  const ext = path.extname(filePath).toLowerCase();
  const etag = `"${stats.size.toString(36)}-${Math.trunc(stats.mtimeMs).toString(36)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304);
    res.end();
    return;
  }

  const headers = {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": cacheControl(filePath, versioned),
    "ETag": etag,
    "Vary": "Accept-Encoding",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };

  const acceptGzip = (req.headers["accept-encoding"] || "").includes("gzip");
  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }
  if (acceptGzip && GZIP_RE.test(filePath)) {
    headers["Content-Encoding"] = "gzip";
    res.writeHead(200, headers);
    const src = fs.createReadStream(filePath);
    const gz = zlib.createGzip();
    src.on("error", () => { try { if (!res.headersSent) res.writeHead(500); res.end(); } catch (e) {} });
    gz.on("error", () => { try { res.end(); } catch (e) {} });
    res.on("close", () => { try { src.destroy(); gz.destroy(); } catch (e) {} });
    src.pipe(gz).pipe(res);
  } else {
    headers["Content-Length"] = stats.size;
    res.writeHead(200, headers);
    const src = fs.createReadStream(filePath);
    src.on("error", () => { try { if (!res.headersSent) res.writeHead(500); res.end(); } catch (e) {} });
    res.on("close", () => { try { src.destroy(); } catch (e) {} });
    src.pipe(res);
  }
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("method not allowed");
      return;
    }

    const rawUrl = req.url || "/";
    const qi = rawUrl.indexOf("?");
    let urlPath;
    try {
      urlPath = decodeURIComponent(qi >= 0 ? rawUrl.slice(0, qi) : rawUrl);
    } catch (e) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("bad request");
      return;
    }

    if (urlPath.includes("\0")) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("bad request");
      return;
    }

    let versioned = false;
    if (qi >= 0) {
      try {
        versioned = new URLSearchParams(rawUrl.slice(qi + 1)).get("v") === APP_VERSION;
      } catch (e) { versioned = false; }
    }

    const relPath = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    let filePath = path.resolve(ROOT, relPath);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("forbidden");
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (!err && stats.isDirectory()) filePath = path.join(filePath, "index.html");
      fs.stat(filePath, (err2, stats2) => {
        if (err2 || !stats2.isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("not found");
          return;
        }
        send(req, res, filePath, stats2, versioned);
      });
    });
  } catch (e) {
    try {
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("error");
    } catch (e2) { try { res.end(); } catch (e3) {} }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`spy server on http://localhost:${PORT}`);
});
