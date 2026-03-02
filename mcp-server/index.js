/**
 * MCP Server — local bridge between Google Stitch and the Figma plugin.
 *
 * HTTP endpoints (port 3003):
 *   POST /mcp/html    — Stitch pushes HTML here
 *   GET  /mcp/html    — Plugin polls for latest HTML
 *   GET  /mcp/health  — health check
 */

const express = require("express");
const cors = require("cors");
const StitchConnector = require("./stitch-connector");

const HTTP_PORT = 3003;

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.text({ limit: "5mb", type: "text/html" }));

const connector = new StitchConnector();

app.get("/mcp/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Stitch pushes HTML here
app.post("/mcp/html", (req, res) => {
  const html =
    typeof req.body === "string" ? req.body : req.body.html;

  if (!html) {
    return res.status(400).json({ error: "Missing html in body" });
  }

  connector.receive(html);
  res.json({ status: "received", length: html.length });
});

// Plugin polls for latest HTML
// Returns the HTML once, then clears it so the plugin doesn't re-process
app.get("/mcp/html", (_req, res) => {
  const html = connector.consume();
  if (html) {
    res.json({ type: "html", payload: html });
  } else {
    res.json({ type: "empty" });
  }
});

app.listen(HTTP_PORT, () => {
  console.log(`[MCP] HTTP server listening on http://localhost:${HTTP_PORT}`);
  console.log(`[MCP] Stitch should POST to http://localhost:${HTTP_PORT}/mcp/html`);
  console.log(`[MCP] Plugin polls GET http://localhost:${HTTP_PORT}/mcp/html`);
});
