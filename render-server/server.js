/**
 * HTML → Figma Render Server v7.0
 * Based on BuilderIO/html-to-figma approach (reverse-engineered)
 * Key insight: FLAT extraction → separate text + visual layers → rebuild hierarchy after
 */
const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = 3005;
let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    console.log('[Server] Launching Chromium…');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security', '--font-render-hinting=none']
    });
  }
  return browser;
}

/* ═══════════════════════════════════════════════════════════════
   DESIGN EXTRACTOR — BuilderIO approach
   Step 1: querySelectorAll('*') → flat list of RECTANGLE layers
   Step 2: TreeWalker → flat list of TEXT layers
   Step 3: assemble into a single flat array
   (Hierarchy rebuild happens in Figma plugin if needed)
   ═══════════════════════════════════════════════════════════════ */
const EXTRACT = (vpW) => {
  /* ── Helpers ── */
  function parseColor(str) {
    if (!str || str === 'transparent' || str === 'rgba(0, 0, 0, 0)') return null;
    var m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
    if (m) { var a = m[4] !== undefined ? parseFloat(m[4]) : 1; if (a === 0) return null; return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: a }; }
    if (str.charAt(0) === '#') {
      var h = str.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: 1 };
    }
    return null;
  }
  function rgb3(c) { return c ? { r: c.r, g: c.g, b: c.b } : null; }
  function parsePx(v) { if (!v) return 0; var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function isHidden(el) {
    var t = el;
    while (t) {
      var s = getComputedStyle(t);
      if (s.display === 'none' || s.visibility === 'hidden') return true;
      if (s.overflow !== 'visible' && t.getBoundingClientRect().height < 1) return true;
      t = t.parentElement;
    }
    return false;
  }

  function getRect(el) {
    // For inline elements with children, compute from children bounds
    var cs = getComputedStyle(el);
    if (cs.display.indexOf('inline') !== -1 && el.children && el.children.length) {
      var r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    var r2 = el.getBoundingClientRect();
    return { left: r2.left, top: r2.top, width: r2.width, height: r2.height };
  }

  /* Non-default CSS props we care about */
  var CHECK_PROPS = ['opacity', 'backgroundColor', 'border', 'borderTop', 'borderLeft', 'borderRight', 'borderBottom',
    'borderRadius', 'backgroundImage', 'borderColor', 'boxShadow'];

  function hasNonDefaultStyle(el) {
    if (el instanceof HTMLImageElement || el instanceof HTMLVideoElement) return true;
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    var cs = getComputedStyle(el);
    var color = cs.color;
    var defaults = {
      opacity: '1',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      borderRadius: '0px',
      boxShadow: 'none'
    };
    if (cs.opacity !== '1') return true;
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') return true;
    if (cs.backgroundImage !== 'none') return true;
    if (cs.borderRadius !== '0px') return true;
    if (cs.boxShadow !== 'none') return true;
    // Check borders
    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    for (var i = 0; i < sides.length; i++) {
      var bw = cs['border' + sides[i] + 'Width'];
      var bs = cs['border' + sides[i] + 'Style'];
      if (bw && bw !== '0px' && bs && bs !== 'none') return true;
    }
    return false;
  }

  function parseShadow(shadowStr) {
    if (!shadowStr || shadowStr === 'none') return null;
    // Move color to end if it starts with rgb
    var s = shadowStr;
    if (s.startsWith('rgb')) {
      var cm = s.match(/(rgba?\(.+?\))(.+)/);
      if (cm) s = (cm[2] + ' ' + cm[1]).trim();
    }
    var isInset = s.indexOf('inset') !== -1;
    s = s.replace('inset', '').trim();
    var parts = s.split(/\s(?![^(]*\))/);
    var colorStr = parts[parts.length - 1];
    var nums = parts.filter(function (p) { return p !== colorStr && p !== 'inset'; }).map(parsePx);
    var c = parseColor(colorStr);
    if (!c) return null;
    return {
      color: { r: c.r, g: c.g, b: c.b, a: c.a },
      type: isInset ? 'INNER_SHADOW' : 'DROP_SHADOW',
      radius: nums[2] || 0,
      spread: nums[3] || 0,
      offset: { x: nums[0] || 0, y: nums[1] || 0 },
      blendMode: 'NORMAL',
      visible: true
    };
  }

  /* ── Icon font detection ── */
  var ICON_FONTS = ['material symbols', 'material icons', 'font awesome', 'fontawesome', 'ionicons', 'icomoon'];
  function isIconFont(ff) {
    var f = (ff || '').toLowerCase();
    for (var i = 0; i < ICON_FONTS.length; i++) if (f.indexOf(ICON_FONTS[i]) !== -1) return true;
    return false;
  }
  var ICON_CLS = ['material-symbols', 'material-icons', 'fa ', 'fas ', 'far ', 'fab ', 'fa-', 'bi-', 'ri-'];
  function hasIconClass(el) {
    var cls = (el.getAttribute && el.getAttribute('class')) || '';
    for (var i = 0; i < ICON_CLS.length; i++) if (cls.indexOf(ICON_CLS[i]) !== -1) return true;
    return false;
  }

  var iconIdx = 0;
  var layers = [];

  /* ═══ STEP 1: Process all elements (visual rectangles) ═══ */
  var root = document.getElementById('__figma_root__') || document.body;
  var allElements = root.querySelectorAll('*');

  for (var ei = 0; ei < allElements.length; ei++) {
    var el = allElements[ei];
    try {
      // Skip SVG internals (but process SVG root)
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      if (isHidden(el)) continue;

      // SVG root → extract as SVG
      if (el instanceof SVGSVGElement) {
        var svgRect = el.getBoundingClientRect();
        if (svgRect.width >= 1 && svgRect.height >= 1) {
          var svgHtml = el.outerHTML;
          var svgCS = getComputedStyle(el);
          svgHtml = svgHtml.replace(/currentColor/g, svgCS.color || 'rgb(0,0,0)');
          layers.push({
            type: 'SVG', svg: svgHtml,
            x: Math.round(svgRect.left), y: Math.round(svgRect.top),
            width: Math.round(svgRect.width), height: Math.round(svgRect.height)
          });
        }
        continue;
      }

      // Icon font element → mark for screenshot
      var elCS = getComputedStyle(el);
      if (hasIconClass(el) && (isIconFont(elCS.fontFamily) || el.childNodes.length <= 1)) {
        var iconRect = el.getBoundingClientRect();
        if (iconRect.width >= 1 && iconRect.height >= 1) {
          var iid = '__icon_' + (iconIdx++);
          el.setAttribute('data-figma-icon-id', iid);
          layers.push({
            type: 'ICON_SCREENSHOT',
            x: Math.round(iconRect.left), y: Math.round(iconRect.top),
            width: Math.max(Math.round(iconRect.width), 8), height: Math.max(Math.round(iconRect.height), 8),
            iconId: iid,
            name: (el.textContent || '').trim().replace(/_/g, ' ') || 'icon'
          });
        }
        continue;
      }

      // Image → extract src
      if (el instanceof HTMLImageElement) {
        var imgRect = el.getBoundingClientRect();
        if (imgRect.width >= 1 && imgRect.height >= 1) {
          var imgCS = getComputedStyle(el);
          layers.push({
            type: 'IMAGE',
            x: Math.round(imgRect.left), y: Math.round(imgRect.top),
            width: Math.round(imgRect.width), height: Math.round(imgRect.height),
            src: el.currentSrc || el.getAttribute('src') || '',
            alt: el.getAttribute('alt') || '',
            objectFit: imgCS.objectFit || 'fill',
            topLeftRadius: parsePx(imgCS.borderTopLeftRadius),
            topRightRadius: parsePx(imgCS.borderTopRightRadius),
            bottomLeftRadius: parsePx(imgCS.borderBottomLeftRadius),
            bottomRightRadius: parsePx(imgCS.borderBottomRightRadius)
          });
        }
        continue;
      }

      // Regular element → extract as RECTANGLE if it has visual styling
      if (!hasNonDefaultStyle(el)) continue;
      if (elCS.display === 'none') continue;

      var rect = getRect(el);
      if (rect.width < 1 || rect.height < 1) continue;

      // Off-screen filter
      if (rect.left > vpW + 10 || rect.left + rect.width < -10) continue;
      if (rect.top + rect.height < -10) continue;

      var fills = [];
      var bg = parseColor(elCS.backgroundColor);
      if (bg) {
        fills.push({ type: 'SOLID', color: rgb3(bg), opacity: bg.a });
      }

      // Background image
      if (elCS.backgroundImage && elCS.backgroundImage !== 'none') {
        var bgUrlMatch = elCS.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (bgUrlMatch) {
          fills.push({ type: 'IMAGE', url: bgUrlMatch[1], scaleMode: elCS.backgroundSize === 'contain' ? 'FIT' : 'FILL', imageHash: null });
        }
      }

      var layer = {
        type: 'RECTANGLE',
        x: Math.round(rect.left), y: Math.round(rect.top),
        width: Math.round(rect.width), height: Math.round(rect.height),
        fills: fills,
        opacity: parseFloat(elCS.opacity) || 1,
        clipsContent: (elCS.overflow !== 'visible' && elCS.overflow !== '')
      };

      // Border radius
      var tlr = parsePx(elCS.borderTopLeftRadius); if (tlr) layer.topLeftRadius = tlr;
      var trr = parsePx(elCS.borderTopRightRadius); if (trr) layer.topRightRadius = trr;
      var blr = parsePx(elCS.borderBottomLeftRadius); if (blr) layer.bottomLeftRadius = blr;
      var brr = parsePx(elCS.borderBottomRightRadius); if (brr) layer.bottomRightRadius = brr;

      // Strokes (borders)
      var borderStr = elCS.border;
      if (borderStr) {
        var bm = borderStr.match(/^([\d.]+)px\s*(\w+)\s*(.*)$/);
        if (bm && bm[1] !== '0' && bm[2] !== 'none') {
          var bc = parseColor(bm[3]);
          if (bc) {
            layer.strokes = [{ type: 'SOLID', color: rgb3(bc), opacity: bc.a }];
            layer.strokeWeight = Math.round(parseFloat(bm[1]));
          }
        }
      }
      // If no uniform border, check individual sides
      if (!layer.strokes) {
        var sides2 = ['Top', 'Right', 'Bottom', 'Left'];
        for (var si = 0; si < sides2.length; si++) {
          var sd = sides2[si];
          var bwVal = elCS['border' + sd + 'Width'];
          var bsVal = elCS['border' + sd + 'Style'];
          if (bwVal && bwVal !== '0px' && bsVal && bsVal !== 'none') {
            var bcVal = parseColor(elCS['border' + sd + 'Color']);
            if (bcVal) {
              layer.strokes = [{ type: 'SOLID', color: rgb3(bcVal), opacity: bcVal.a }];
              layer.strokeWeight = Math.round(parsePx(bwVal));
              break; // Use first border found
            }
          }
        }
      }

      // Shadows
      if (elCS.boxShadow && elCS.boxShadow !== 'none') {
        var shadow = parseShadow(elCS.boxShadow);
        if (shadow) layer.effects = [shadow];
      }

      // Name
      var elId = el.id;
      var elTag = el.tagName.toLowerCase();
      var nameMap = { header: 'Header', nav: 'Nav', main: 'Main', footer: 'Footer', section: 'Section', button: 'Button', a: 'Link', h1: 'H1', h2: 'H2', h3: 'H3', p: 'Paragraph' };
      layer.name = elId ? '#' + elId : (nameMap[elTag] || elTag);

      layers.push(layer);
    } catch (e) {
      // Skip errors
    }
  }

  /* ═══ STEP 2: Extract ALL text nodes via TreeWalker ═══ */
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  var textNode;
  while (textNode = walker.nextNode()) {
    try {
      var txt = (textNode.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) continue;

      var parent = textNode.parentElement;
      if (!parent) continue;
      if (isHidden(parent)) continue;

      var pcs = getComputedStyle(parent);

      // Skip icon font text — these are glyph names, not real text
      if (isIconFont(pcs.fontFamily) || hasIconClass(parent)) continue;

      var range = document.createRange();
      range.selectNode(textNode);
      var textRect = range.getBoundingClientRect();
      range.detach();

      // Adjust for line-height
      var lhPx = parsePx(pcs.lineHeight);
      if (lhPx && textRect.height < lhPx) {
        var diff = lhPx - textRect.height;
        textRect = { left: textRect.left, top: textRect.top - diff / 2, width: textRect.width, height: lhPx };
      }

      if (textRect.height < 1 || textRect.width < 1) continue;

      // Off-screen filter
      if (textRect.left > vpW + 10 || textRect.left + textRect.width < -10) continue;
      if (textRect.top + textRect.height < -10) continue;

      var textLayer = {
        type: 'TEXT',
        x: Math.round(textRect.left), y: Math.round(textRect.top),
        width: Math.round(textRect.width), height: Math.round(textRect.height),
        characters: txt
      };

      // Font properties from parent
      var textColor = parseColor(pcs.color);
      if (textColor) {
        textLayer.fills = [{ type: 'SOLID', color: rgb3(textColor), opacity: textColor.a }];
      }

      var fs = parsePx(pcs.fontSize);
      if (fs) textLayer.fontSize = Math.round(fs);

      textLayer.fontFamily = pcs.fontFamily || 'Inter';
      textLayer.fontWeight = parseInt(pcs.fontWeight) || 400;
      textLayer.fontStyle = pcs.fontStyle || 'normal';

      var lh = parsePx(pcs.lineHeight);
      if (lh) textLayer.lineHeight = { unit: 'PIXELS', value: Math.round(lh) };

      var ls = parsePx(pcs.letterSpacing);
      if (ls) textLayer.letterSpacing = { unit: 'PIXELS', value: ls };

      var tt = pcs.textTransform;
      if (tt === 'uppercase') textLayer.textCase = 'UPPER';
      else if (tt === 'lowercase') textLayer.textCase = 'LOWER';
      else if (tt === 'capitalize') textLayer.textCase = 'TITLE';

      var ta = pcs.textAlign;
      if (ta === 'center') textLayer.textAlignHorizontal = 'CENTER';
      else if (ta === 'right') textLayer.textAlignHorizontal = 'RIGHT';
      else if (ta === 'justify') textLayer.textAlignHorizontal = 'JUSTIFIED';
      else textLayer.textAlignHorizontal = 'LEFT';

      if (pcs.textDecorationLine) {
        if (pcs.textDecorationLine.indexOf('underline') !== -1) textLayer.textDecoration = 'UNDERLINE';
        if (pcs.textDecorationLine.indexOf('line-through') !== -1) textLayer.textDecoration = 'STRIKETHROUGH';
      }

      layers.push(textLayer);
    } catch (e) {
      // Skip errors
    }
  }

  /* ═══ STEP 2.5: Extract placeholder/value text from form elements ═══ */
  // TreeWalker misses these because placeholders are in shadow DOM
  var formEls = root.querySelectorAll('input, textarea, select');
  for (var fi = 0; fi < formEls.length; fi++) {
    try {
      var fel = formEls[fi];
      if (isHidden(fel)) continue;
      var felRect = fel.getBoundingClientRect();
      if (felRect.width < 1 || felRect.height < 1) continue;

      var felCS = getComputedStyle(fel);
      var formText = '';
      var isPlaceholder = false;

      var felTag = fel.tagName.toLowerCase();
      if (felTag === 'select') {
        // Get selected option text
        var selOpt = fel.options && fel.options[fel.selectedIndex];
        formText = selOpt ? selOpt.textContent.trim() : '';
        isPlaceholder = selOpt && selOpt.disabled;
      } else {
        // input or textarea
        if (fel.value && fel.value.trim()) {
          formText = fel.value.trim();
        } else if (fel.placeholder) {
          formText = fel.placeholder;
          isPlaceholder = true;
        }
      }

      if (!formText) continue;

      // Get text color — placeholders have special color
      var formColor = null;
      if (isPlaceholder) {
        // Placeholder color is usually lighter — try to get ::placeholder style
        // Fallback to the element's color with lower opacity
        var elColor = parseColor(felCS.color);
        if (elColor) {
          formColor = { r: elColor.r, g: elColor.g, b: elColor.b, a: Math.min(elColor.a, 0.4) };
        } else {
          formColor = { r: 0.6, g: 0.6, b: 0.65, a: 1 };
        }
      } else {
        formColor = parseColor(felCS.color);
      }

      // Position text inside the input (account for padding)
      var padLeft = parsePx(felCS.paddingLeft) || 16;
      var padTop = parsePx(felCS.paddingTop) || 0;
      var textX = felRect.left + padLeft;
      var textY = felRect.top + (felRect.height / 2) - (parsePx(felCS.fontSize) / 2) - 1;
      var textW = felRect.width - padLeft - (parsePx(felCS.paddingRight) || 16);

      var formLayer = {
        type: 'TEXT',
        x: Math.round(textX), y: Math.round(textY),
        width: Math.round(textW), height: Math.round(parsePx(felCS.fontSize) * 1.5),
        characters: formText
      };

      if (formColor) {
        formLayer.fills = [{ type: 'SOLID', color: rgb3(formColor), opacity: formColor.a }];
      }

      formLayer.fontSize = Math.round(parsePx(felCS.fontSize)) || 16;
      formLayer.fontFamily = felCS.fontFamily || 'Inter';
      formLayer.fontWeight = parseInt(felCS.fontWeight) || 400;
      formLayer.fontStyle = felCS.fontStyle || 'normal';

      var formLH = parsePx(felCS.lineHeight);
      if (formLH) formLayer.lineHeight = { unit: 'PIXELS', value: Math.round(formLH) };

      formLayer.textAlignHorizontal = 'LEFT';

      layers.push(formLayer);
    } catch (e) {
      // Skip errors
    }
  }

  /* ═══ STEP 3: Root frame wrapper ═══ */
  // Get ACTUAL page background color (not forced white)
  var bodyCS = window.getComputedStyle(document.body);
  var pageBg = parseColor(bodyCS.backgroundColor);
  var rootFills = [];
  if (pageBg) {
    rootFills.push({ type: 'SOLID', color: { r: pageBg.r, g: pageBg.g, b: pageBg.b }, opacity: pageBg.a });
  } else {
    rootFills.push({ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 });
  }

  var rootLayer = {
    type: 'FRAME',
    x: 0, y: 0,
    width: vpW,
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight || 800),
    fills: rootFills
  };

  // Insert at beginning
  layers.unshift(rootLayer);

  return layers;
};

/* ─── Screenshot icons ─── */
async function screenshotIcons(pg, layers) {
  var iconMap = {};
  for (var i = 0; i < layers.length; i++) {
    var n = layers[i];
    if (n.type === 'ICON_SCREENSHOT' && n.iconId) {
      try {
        var el = await pg.$('[data-figma-icon-id="' + n.iconId + '"]');
        if (el) {
          var buf = await el.screenshot({ type: 'png', omitBackground: true });
          n.screenshotBase64 = buf.toString('base64');
        }
      } catch (e) { }
    }
  }
}

/* ─── RENDER ENDPOINT ──────────────────────────────────────── */
app.post('/render', async (req, res) => {
  var html = req.body.html;
  var viewport = req.body.viewport || 390;
  if (!html) return res.status(400).json({ error: 'HTML required' });

  var ctx = null;
  try {
    var b = await getBrowser();
    ctx = await b.newContext({ viewport: { width: viewport, height: 800 } });
    var pg = await ctx.newPage();
    pg.setDefaultTimeout(60000);

    var fullHtml = '<!DOCTYPE html><html><head>'
      + '<meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<script src="https://cdn.tailwindcss.com"></script>'
      + '<script src="https://unpkg.com/lucide@latest"></script>'
      + '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">'
      + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@100;200;300;400;500;600;700;800;900&family=Roboto:wght@300;400;500;700&family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet">'
      + '<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">'
      + '<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">'
      + '<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Sharp:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet">'
      + '<style>*,*::before,*::after{box-sizing:border-box}'
      + 'html,body{margin:0;padding:0;width:' + viewport + 'px;font-family:"Inter",sans-serif;}</style>'
      + '</head><body>'
      + '<div id="__figma_root__">' + html + '</div>'
      + '<script>if(typeof lucide!=="undefined")lucide.createIcons();</script>'
      + '</body></html>';

    try {
      await pg.setContent(fullHtml, { waitUntil: 'load', timeout: 20000 });
    } catch (e) {
      console.warn('[Render] load timeout, using domcontentloaded');
      await pg.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 10000 });
    }
    await pg.evaluate(function () { return document.fonts.ready; }).catch(function () { });
    await pg.waitForTimeout(2000); // Extra time for icon fonts to fully load

    var layers = await pg.evaluate(EXTRACT, viewport);
    console.log('[Render] Extracted ' + layers.length + ' flat layers');

    // Screenshot icons
    await screenshotIcons(pg, layers);

    var iconCount = layers.filter(function (l) { return l.type === 'ICON_SCREENSHOT' && l.screenshotBase64; }).length;
    console.log('[Render] Captured ' + iconCount + ' icon screenshots');

    res.json({ layers: layers, viewport: viewport });

  } catch (err) {
    console.error('[Render Error]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    if (ctx) await ctx.close().catch(function () { });
  }
});

app.get('/health', function (req, res) { res.json({ ok: true, version: '7.0' }); });

app.listen(PORT, async function () {
  console.log('[Server] Running on http://localhost:' + PORT);
  await getBrowser().catch(console.error);
  try {
    var ngrok = require('@ngrok/ngrok');
    var listener = await ngrok.forward({ addr: PORT });
    console.log('[ngrok] URL: ' + listener.url());
  } catch (e) {
    console.log('[ngrok] Not configured (localhost only)');
  }
});
