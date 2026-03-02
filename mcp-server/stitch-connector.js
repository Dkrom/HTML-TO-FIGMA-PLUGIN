/**
 * Stitch Connector — receives HTML from Google Stitch via MCP
 * and holds it for the Figma plugin to poll via HTTP.
 */

const EventEmitter = require("events");

class StitchConnector extends EventEmitter {
  constructor() {
    super();
    this._lastHtml = null;
    this._pending = null; // unconsumed HTML for polling
  }

  /** Called when Stitch pushes HTML through MCP */
  receive(html) {
    if (!html || typeof html !== "string") {
      console.warn("[StitchConnector] Ignored empty payload");
      return;
    }
    this._lastHtml = html;
    this._pending = html;
    console.log(
      `[StitchConnector] Received HTML (${html.length} chars)`
    );
    this.emit("html", html);
  }

  /** Returns pending HTML and clears it (read-once for polling) */
  consume() {
    const html = this._pending;
    this._pending = null;
    return html;
  }

  get lastHtml() {
    return this._lastHtml;
  }
}

module.exports = StitchConnector;
