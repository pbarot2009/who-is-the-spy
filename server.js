// Static server for "Who is the Spy?" — runs on Node.js or Bun, no deps.
//   node server.js        (or: bun server.js, PORT=8080 node server.js)

const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PORT = parseInt(process.env.PORT || "3000", 10);
const ROOT = __dirname;
// Bump APP_VERSION on every release and keep index.html asset URLs in sync
// (styles.css?v=N, script.js?v=N) so phones never run stale cached files.
const APP_VERSION = "12";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const GZIP_RE = /\.(html|css|js|json|svg|txt|webmanifest)$/;

function cacheControl(file, versioned) {
  if (/\.(woff2?|ttf|png|ico)$/.test(file)) return "public, max-age=31536000, immutable";
  // versioned (?v=N)CSS/JS are unique per release — cache hard, they can't go stale
  if (versioned && /\.(css|js|json|svg)$/.test(file)) return "public, max-age=31536000, immutable";
  if (/\.(css|js)$/.test(file)) return "public, max-age=3600";
  // HTML entry point must revalidate every load so updates reach phones
  if (/\.html$/.test(file)) return "no-cache, must-revalidate";
  return "public, max-age=0, must-revalidate";
}

function send(req, res, filePath, stats, versioned) {
  const ext = path.extname(filePath).toLowerCase();
  const etag = `"${stats.size.toString(36)}-${stats.mtimeMs.toString(36)}"`;
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
    fs.createReadStream(filePath).pipe(zlib.createGzip()).pipe(res);
  } else {
    headers["Content-Length"] = stats.size;
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  }
}

const server = http.createServer((req, res) => {
  try {
    const qi = req.url.indexOf("?");
    const urlPath = decodeURIComponent(qi >= 0 ? req.url.slice(0, qi) : req.url);
    const versioned = qi >= 0 && req.url.slice(qi + 1).split("&").some(p => p === `v=${APP_VERSION}`);
    // resolve inside ROOT; blocks "../" escapes
    let filePath = path.normalize(path.join(ROOT, urlPath === "/" ? "index.html" : urlPath.slice(1)));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
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
    res.writeHead(500);
    res.end("error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`spy server on http://localhost:${PORT}`);
});
