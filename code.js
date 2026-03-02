/**
 * Figma Plugin — HTML to Figma v7.0
 * BuilderIO approach: flat layer rendering
 * Each layer is absolutely positioned inside a root frame
 * RECTANGLE = visual element, TEXT = text content, SVG = icon vector
 */

figma.showUI(__html__, { width: 520, height: 700 });

/* ═══ FONT CACHE ═══ */
var availFontsP = null;
var fontCache = {};

function normStyle(s) { return (s || '').toLowerCase().replace(/[\s_-]+/g, ''); }

function weightToStyle(w, italic) {
  var wt = w || 400;
  var s = wt >= 800 ? 'ExtraBold' : wt >= 700 ? 'Bold' : wt >= 600 ? 'SemiBold' : wt >= 500 ? 'Medium' : wt >= 300 ? 'Light' : 'Regular';
  return italic ? (s === 'Regular' ? 'Italic' : s + ' Italic') : s;
}

function resolveFont(family, weight, italic) {
  family = ((family || 'Inter').replace(/['"]/g, '').split(',')[0].trim()) || 'Inter';
  var styleName = weightToStyle(weight, italic === 'italic');
  var key = family + '::' + styleName;
  if (fontCache[key]) return fontCache[key];

  fontCache[key] = (async function () {
    if (!availFontsP) availFontsP = figma.listAvailableFontsAsync().catch(function () { return []; });
    var fonts = await availFontsP;
    var wantN = normStyle(styleName);
    var famFonts = fonts.filter(function (f) { return f.fontName.family === family; });

    var fn = null;
    // Exact match
    for (var i = 0; i < famFonts.length; i++) {
      if (normStyle(famFonts[i].fontName.style) === wantN) { fn = famFonts[i].fontName; break; }
    }
    // Regular fallback
    if (!fn) {
      for (var i = 0; i < famFonts.length; i++) {
        if (normStyle(famFonts[i].fontName.style).indexOf('regular') !== -1) { fn = famFonts[i].fontName; break; }
      }
    }
    // Any in family
    if (!fn && famFonts.length > 0) fn = famFonts[0].fontName;
    // Inter fallback
    if (!fn) fn = { family: 'Inter', style: 'Regular' };

    try { await figma.loadFontAsync(fn); }
    catch (e) {
      fn = { family: 'Inter', style: 'Regular' };
      try { await figma.loadFontAsync(fn); } catch (e2) { }
    }
    return fn;
  })();

  return fontCache[key];
}

/* ═══ RENDER A SINGLE LAYER ═══ */

async function renderLayer(layer, root, ox, oy) {
  var x = Math.round((layer.x || 0) - ox);
  var y = Math.round((layer.y || 0) - oy);
  var w = Math.max(Math.round(layer.width || 0), 1);
  var h = Math.max(Math.round(layer.height || 0), 1);

  /* ── FRAME (root wrapper) ── */
  if (layer.type === 'FRAME') {
    // Already handled as root
    return;
  }

  /* ── RECTANGLE (visual element) ── */
  if (layer.type === 'RECTANGLE') {
    try {
      var rect = figma.createRectangle();
      rect.x = x; rect.y = y;
      rect.resize(w, h);

      // Fills
      var fills = [];
      if (layer.fills && layer.fills.length) {
        for (var fi = 0; fi < layer.fills.length; fi++) {
          var f = layer.fills[fi];
          if (f.type === 'SOLID' && f.color) {
            fills.push({ type: 'SOLID', color: { r: f.color.r, g: f.color.g, b: f.color.b }, opacity: (f.opacity !== undefined ? f.opacity : 1) });
          }
        }
      }
      rect.fills = fills;

      // Strokes
      if (layer.strokes && layer.strokes.length) {
        var strokes = [];
        for (var si = 0; si < layer.strokes.length; si++) {
          var s = layer.strokes[si];
          strokes.push({ type: 'SOLID', color: { r: s.color.r, g: s.color.g, b: s.color.b }, opacity: (s.opacity !== undefined ? s.opacity : 1) });
        }
        rect.strokes = strokes;
        if (layer.strokeWeight) rect.strokeWeight = layer.strokeWeight;
        rect.strokeAlign = 'INSIDE';
      }

      // Radius
      var uniform = true;
      var radii = [layer.topLeftRadius || 0, layer.topRightRadius || 0, layer.bottomLeftRadius || 0, layer.bottomRightRadius || 0];
      for (var ri = 1; ri < 4; ri++) { if (radii[ri] !== radii[0]) { uniform = false; break; } }
      if (uniform) { rect.cornerRadius = Math.round(radii[0]); }
      else {
        rect.topLeftRadius = Math.round(radii[0]);
        rect.topRightRadius = Math.round(radii[1]);
        rect.bottomLeftRadius = Math.round(radii[2]);
        rect.bottomRightRadius = Math.round(radii[3]);
      }

      // Effects (shadows)
      if (layer.effects && layer.effects.length) {
        var effects = [];
        for (var ei = 0; ei < layer.effects.length; ei++) {
          var ef = layer.effects[ei];
          effects.push({
            type: ef.type || 'DROP_SHADOW',
            color: { r: ef.color.r, g: ef.color.g, b: ef.color.b, a: ef.color.a || 0.25 },
            offset: ef.offset || { x: 0, y: 0 },
            radius: Math.round(ef.radius || 0),
            spread: Math.round(ef.spread || 0),
            visible: true,
            blendMode: 'NORMAL'
          });
        }
        try { rect.effects = effects; } catch (e) { }
      }

      // Opacity
      if (layer.opacity !== undefined && layer.opacity < 1) {
        try { rect.opacity = layer.opacity; } catch (e) { }
      }

      rect.name = layer.name || 'Rectangle';
      root.appendChild(rect);
      return rect;
    } catch (e) {
      console.error('Rect error:', e.message);
    }
  }

  /* ── TEXT ── */
  if (layer.type === 'TEXT') {
    try {
      var text = layer.characters || '';
      if (!text.trim()) return;

      // Apply text case
      if (layer.textCase === 'UPPER') text = text.toUpperCase();
      else if (layer.textCase === 'LOWER') text = text.toLowerCase();
      else if (layer.textCase === 'TITLE') text = text.replace(/\b\w/g, function (c) { return c.toUpperCase(); });

      var fn = await resolveFont(layer.fontFamily, layer.fontWeight, layer.fontStyle);
      var t = figma.createText();
      t.x = x; t.y = y;
      t.fontName = fn;
      t.characters = text;
      t.fontSize = Math.max(layer.fontSize || 16, 1);

      // Line height
      if (layer.lineHeight && layer.lineHeight.value) {
        try { t.lineHeight = { value: Math.round(layer.lineHeight.value), unit: 'PIXELS' }; } catch (e) { }
      }

      // Letter spacing
      if (layer.letterSpacing && layer.letterSpacing.value) {
        try { t.letterSpacing = { value: layer.letterSpacing.value, unit: 'PIXELS' }; } catch (e) { }
      }

      // Fills (text color)
      if (layer.fills && layer.fills.length) {
        var textFills = [];
        for (var tfi = 0; tfi < layer.fills.length; tfi++) {
          var tf = layer.fills[tfi];
          if (tf.type === 'SOLID' && tf.color) {
            textFills.push({ type: 'SOLID', color: { r: tf.color.r, g: tf.color.g, b: tf.color.b }, opacity: (tf.opacity !== undefined ? tf.opacity : 1) });
          }
        }
        if (textFills.length) t.fills = textFills;
      }

      // Alignment
      if (layer.textAlignHorizontal) {
        t.textAlignHorizontal = layer.textAlignHorizontal;
      }

      // Decoration
      if (layer.textDecoration) {
        try { t.textDecoration = layer.textDecoration; } catch (e) { }
      }

      // Size text to browser dimensions — minimal buffer to avoid adjacent overlap
      if (w > 0) {
        try {
          // +1px width buffer — enough for rounding, won't cause overlap
          t.resize(Math.max(w + 1, 1), Math.max(h + 2, 1));
          t.textAutoResize = 'HEIGHT';
        } catch (e) { }
      }

      t.name = text.substring(0, 50);
      root.appendChild(t);
      return t;
    } catch (e) {
      console.error('Text error:', e.message);
    }
  }

  /* ── SVG ── */
  if (layer.type === 'SVG') {
    try {
      var svgNode = null;
      if (layer.svg) {
        try { svgNode = figma.createNodeFromSvg(layer.svg); } catch (e) { }
      }
      if (svgNode) {
        if (svgNode.width > 0 && w > 0) {
          var sc = Math.min(w / svgNode.width, h / svgNode.height);
          if (sc > 0 && Math.abs(sc - 1) > 0.01) {
            try { svgNode.rescale(sc); } catch (e) { }
          }
        }
        svgNode.x = x; svgNode.y = y;
        try { svgNode.resize(w, h); } catch (e) { }
        svgNode.name = 'Icon';
        root.appendChild(svgNode);
      }
      return svgNode;
    } catch (e) { }
  }

  /* ── ICON_SCREENSHOT ── */
  if (layer.type === 'ICON_SCREENSHOT') {
    try {
      var iconRect = figma.createRectangle();
      iconRect.x = x; iconRect.y = y;
      iconRect.resize(w, h);

      if (layer.screenshotBase64) {
        try {
          var imgBytes = figma.base64Decode(layer.screenshotBase64);
          var img = figma.createImage(imgBytes);
          iconRect.fills = [{ type: 'IMAGE', imageHash: img.hash, scaleMode: 'FILL' }];
        } catch (e) {
          iconRect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 }, opacity: 0.3 }];
        }
      } else {
        iconRect.fills = [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 }, opacity: 0.3 }];
      }

      iconRect.name = 'icon: ' + (layer.name || 'icon');
      root.appendChild(iconRect);
      return iconRect;
    } catch (e) { }
  }

  /* ── IMAGE ── */
  if (layer.type === 'IMAGE') {
    try {
      var imgR = figma.createRectangle();
      imgR.x = x; imgR.y = y;
      imgR.resize(w, h);
      imgR.fills = [{ type: 'SOLID', color: { r: 0.93, g: 0.93, b: 0.93 } }];

      // Apply radius
      if (layer.topLeftRadius) imgR.topLeftRadius = Math.round(layer.topLeftRadius);
      if (layer.topRightRadius) imgR.topRightRadius = Math.round(layer.topRightRadius);
      if (layer.bottomLeftRadius) imgR.bottomLeftRadius = Math.round(layer.bottomLeftRadius);
      if (layer.bottomRightRadius) imgR.bottomRightRadius = Math.round(layer.bottomRightRadius);

      imgR.name = layer.alt ? 'img: ' + layer.alt : 'Image';
      root.appendChild(imgR);
      return imgR;
    } catch (e) { }
  }
}

/* ═══ MESSAGE HANDLER ═══ */
figma.ui.onmessage = async function (msg) {
  if (msg.type === 'render-tree') {
    try {
      var layers = msg.layers || msg.nodes || [];
      var viewport = msg.viewport || 390;

      figma.ui.postMessage({ type: 'log', text: 'Loading fonts...' });

      // Preload Inter
      try {
        await Promise.all([
          resolveFont('Inter', 400, 'normal'),
          resolveFont('Inter', 500, 'normal'),
          resolveFont('Inter', 600, 'normal'),
          resolveFont('Inter', 700, 'normal'),
          resolveFont('Inter', 800, 'normal')
        ]);
      } catch (e) { }

      figma.ui.postMessage({ type: 'log', text: 'Rendering ' + layers.length + ' layers...' });

      // First layer should be FRAME (root)
      var rootLayer = layers[0];
      var rootW = (rootLayer && rootLayer.width) || viewport;
      var rootH = (rootLayer && rootLayer.height) || 800;
      var ox = (rootLayer && rootLayer.x) || 0;
      var oy = (rootLayer && rootLayer.y) || 0;

      var root = figma.createFrame();
      root.name = 'HTML Import – ' + viewport + 'px';
      root.resize(Math.max(rootW, 1), Math.max(rootH, 1));
      root.clipsContent = true;
      root.layoutMode = 'NONE';

      // Apply root fills
      if (rootLayer && rootLayer.fills && rootLayer.fills.length) {
        var rootFills = [];
        for (var fi = 0; fi < rootLayer.fills.length; fi++) {
          var f = rootLayer.fills[fi];
          if (f.type === 'SOLID' && f.color) {
            rootFills.push({ type: 'SOLID', color: { r: f.color.r, g: f.color.g, b: f.color.b }, opacity: (f.opacity !== undefined ? f.opacity : 1) });
          }
        }
        root.fills = rootFills.length ? rootFills : [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      } else {
        root.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      }

      // Render all layers (skip first = root frame)
      for (var i = 1; i < layers.length; i++) {
        await renderLayer(layers[i], root, ox, oy);
      }

      figma.currentPage.appendChild(root);
      figma.viewport.scrollAndZoomIntoView([root]);

      var total = layers.length;
      figma.ui.postMessage({ type: 'status', text: 'Done! Created ' + total + ' layers.' });

    } catch (e) {
      console.error('Render error:', e.message, e.stack);
      figma.ui.postMessage({ type: 'error', text: 'Error: ' + e.message });
    }
  }
};