# HTML to Figma Plugin

A Figma plugin that converts HTML/CSS into fully editable Figma designs.

## Features
- Converts HTML to editable Figma layers (no screenshots)
- Extracts backgrounds, borders, shadows, gradients
- Handles icon fonts (Material Symbols, Font Awesome) via element screenshots
- Extracts SVG icons as vector nodes
- Handles form element placeholders
- Supports 390px, 768px, and custom viewport widths

## Setup

### 1. Install dependencies
```bash
cd render-server
npm install
```

### 2. Start the render server
```bash
node server.js
```

### 3. Load plugin in Figma
- Open Figma → Plugins → Development → Import plugin from manifest
- Select `manifest.json` from this folder

### 4. Build the plugin (after code changes)
```bash
node build.js
```

## Tech Stack
- **Figma Plugin API** — renders layers in Figma
- **Playwright** — headless Chromium for HTML rendering & extraction
- **Express** — render server
