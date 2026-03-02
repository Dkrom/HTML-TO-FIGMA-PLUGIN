/**
 * Build script — reads ui.html and code.js,
 * replaces the __html__ token in code.js with the actual HTML string,
 * writes the result to dist/code.js.
 *
 * Run: node build.js
 */
const fs = require("fs");
const path = require("path");

const uiPath = path.join(__dirname, "ui.html");
const codePath = path.join(__dirname, "code.js");
const distDir = path.join(__dirname, "dist");
const outPath = path.join(distDir, "code.js");

// Read files
const uiHtml = fs.readFileSync(uiPath, "utf8");
const codeJs = fs.readFileSync(codePath, "utf8");

console.log("UI HTML length:", uiHtml.length, "chars");

// Turn the HTML into a valid JS string literal
const htmlAsString = JSON.stringify(uiHtml);

console.log("Stringified HTML length:", htmlAsString.length, "chars");

// Replace the __html__ token (the exact text, not a substring)
const marker = "__html__";
const idx = codeJs.indexOf(marker);

if (idx === -1) {
  console.error("ERROR: Could not find __html__ in code.js");
  process.exit(1);
}

const bundled = codeJs.substring(0, idx) + htmlAsString + codeJs.substring(idx + marker.length);

// Write output
fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outPath, bundled, "utf8");

console.log("Build complete:", outPath);
console.log("Output size:", bundled.length, "chars");
