/**
 * Self-contained "Build Analysis & App Diagnostics" widget injected into
 * every generated app's preview HTML.
 *
 * Renders a small floating button bottom-right of the user's app. Clicking it
 * opens an in-app modal window with REAL diagnostics:
 *   - Page load timing (DOMContentLoaded, fully-loaded, paint metrics)
 *   - DOM stats (element count, depth, memory)
 *   - JS errors / console warnings captured since page start
 *   - Resource counts (scripts, stylesheets, images)
 *   - LocalStorage usage (keys + bytes)
 *   - Viewport / device info
 *   - User-provided API keys detected (window.USER_SECRETS)
 *
 * All data is gathered live from the running app — no fake numbers.
 * The widget runs in its own IIFE namespace `__nexusDiag` to avoid
 * conflicts with the user's app code.
 */
const WIDGET_SCRIPT = `<script>(function(){
if (window.__nexusDiagInstalled) return; window.__nexusDiagInstalled = true;

var errors = [], warns = [];
var origErr = console.error, origWarn = console.warn;
console.error = function(){ try{ errors.push({ts:Date.now(),msg:Array.prototype.slice.call(arguments).map(String).join(' ')}); }catch(e){} return origErr.apply(console, arguments); };
console.warn  = function(){ try{ warns.push({ts:Date.now(),msg:Array.prototype.slice.call(arguments).map(String).join(' ')}); }catch(e){} return origWarn.apply(console, arguments); };
window.addEventListener('error', function(e){ try{ errors.push({ts:Date.now(),msg:(e.message||'Error')+' @ '+(e.filename||'?')+':'+(e.lineno||'?')}); }catch(_){} });
window.addEventListener('unhandledrejection', function(e){ try{ errors.push({ts:Date.now(),msg:'Unhandled promise: '+(e.reason && e.reason.message ? e.reason.message : String(e.reason))}); }catch(_){} });

function bytes(n){ if(n<1024) return n+' B'; if(n<1048576) return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(2)+' MB'; }
function depth(el,d){ d=d||0; var m=d, c=el.children; for(var i=0;i<c.length;i++){ var x=depth(c[i],d+1); if(x>m) m=x; } return m; }
function ago(ts){ var s=Math.floor((Date.now()-ts)/1000); if(s<60) return s+'s ago'; if(s<3600) return Math.floor(s/60)+'m ago'; return Math.floor(s/3600)+'h ago'; }

function gather(){
  var nav = (performance.getEntriesByType && performance.getEntriesByType('navigation')[0]) || null;
  var paint = (performance.getEntriesByType && performance.getEntriesByType('paint')) || [];
  var fp = paint.filter(function(p){return p.name==='first-paint';})[0];
  var fcp = paint.filter(function(p){return p.name==='first-contentful-paint';})[0];
  var resources = (performance.getEntriesByType && performance.getEntriesByType('resource')) || [];
  var totalBytes = 0; resources.forEach(function(r){ totalBytes += (r.transferSize||0); });

  var lsKeys = 0, lsBytes = 0;
  try { for (var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); var v=localStorage.getItem(k)||''; lsKeys++; lsBytes += k.length + v.length; } } catch(e){}

  var secretCount = 0; var secretNames = [];
  try { if (window.USER_SECRETS) { secretNames = Object.keys(window.USER_SECRETS); secretCount = secretNames.length; } } catch(e){}

  var mem = (performance && performance.memory) ? performance.memory : null;

  return {
    timing: {
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadComplete:     nav ? Math.round(nav.loadEventEnd)             : null,
      firstPaint:       fp  ? Math.round(fp.startTime)                  : null,
      firstContentful:  fcp ? Math.round(fcp.startTime)                 : null,
      ttfb:             nav ? Math.round(nav.responseStart - nav.requestStart) : null,
    },
    dom: {
      elements: document.getElementsByTagName('*').length,
      depth: depth(document.documentElement),
      images: document.images.length,
      scripts: document.scripts.length,
      stylesheets: document.styleSheets.length,
      iframes: document.getElementsByTagName('iframe').length,
    },
    resources: {
      total: resources.length,
      bytes: totalBytes,
      slowest: resources.slice().sort(function(a,b){return (b.duration||0)-(a.duration||0);}).slice(0,3).map(function(r){
        var u = r.name||''; var short = u.length>60 ? '...'+u.slice(-58) : u;
        return { url: short, ms: Math.round(r.duration||0) };
      }),
    },
    storage: { keys: lsKeys, bytes: lsBytes },
    secrets: { count: secretCount, names: secretNames },
    viewport: {
      width: window.innerWidth, height: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      ua: navigator.userAgent,
    },
    memory: mem ? {
      used:  mem.usedJSHeapSize,
      total: mem.totalJSHeapSize,
      limit: mem.jsHeapSizeLimit,
    } : null,
    errors: errors.slice(-25).reverse(),
    warns:  warns.slice(-25).reverse(),
    when: Date.now(),
  };
}

var COLORS = { bg:'#0a0a0f', card:'#12121c', border:'#1f2937', primary:'#00d4ff', text:'#e2e8f0', mute:'#94a3b8', good:'#22c55e', warn:'#fbbf24', bad:'#ef4444' };

function el(tag, attrs, kids){ var n = document.createElement(tag); if (attrs) for (var k in attrs){ if (k==='style') n.style.cssText = attrs[k]; else if (k==='html') n.innerHTML = attrs[k]; else n.setAttribute(k, attrs[k]); } if (kids) kids.forEach(function(c){ n.appendChild(typeof c==='string'?document.createTextNode(c):c); }); return n; }

function row(label, value, color){
  return el('div',{style:'display:flex;justify-content:space-between;padding:6px 10px;border-bottom:1px solid '+COLORS.border+';font-size:12px;font-family:ui-monospace,monospace'},
    [el('span',{style:'color:'+COLORS.mute},[label]), el('span',{style:'color:'+(color||COLORS.text)+';font-weight:600'},[String(value)])]);
}
function section(title, kids){
  var box = el('div',{style:'background:'+COLORS.card+';border:1px solid '+COLORS.border+';border-radius:6px;margin-bottom:10px;overflow:hidden'},[
    el('div',{style:'padding:8px 10px;background:rgba(0,212,255,0.06);border-bottom:1px solid '+COLORS.border+';font-size:11px;font-family:ui-monospace,monospace;color:'+COLORS.primary+';font-weight:700;letter-spacing:0.08em;text-transform:uppercase'},[title])
  ]);
  kids.forEach(function(k){ box.appendChild(k); });
  return box;
}

function buildPanel(d){
  var panel = el('div',{style:'position:fixed;inset:0;background:rgba(0,0,0,0.78);backdrop-filter:blur(8px);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif',id:'__nexusDiagPanel'});
  panel.addEventListener('click', function(e){ if (e.target===panel) close(); });

  var win = el('div',{style:'background:'+COLORS.bg+';border:1px solid '+COLORS.primary+';border-radius:10px;max-width:760px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 0 40px rgba(0,212,255,0.25);color:'+COLORS.text});

  // Header
  var header = el('div',{style:'display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid '+COLORS.border},[
    el('div',{},[
      el('div',{style:'font-size:16px;font-weight:700;color:'+COLORS.primary+';letter-spacing:0.05em'},['📊 BUILD ANALYSIS & APP DIAGNOSTICS']),
      el('div',{style:'font-size:11px;color:'+COLORS.mute+';font-family:ui-monospace,monospace;margin-top:2px'},['Live data from your running app · NexusElite Studio'])
    ])
  ]);
  var btnRow = el('div',{style:'display:flex;gap:8px'});
  var refreshBtn = el('button',{style:'background:transparent;border:1px solid '+COLORS.border+';color:'+COLORS.text+';padding:6px 12px;border-radius:4px;font-family:ui-monospace,monospace;font-size:11px;cursor:pointer'},['↻ REFRESH']);
  refreshBtn.onclick = function(){ render(); };
  var closeBtn = el('button',{style:'background:'+COLORS.bad+';border:none;color:#fff;padding:6px 12px;border-radius:4px;font-family:ui-monospace,monospace;font-size:11px;font-weight:700;cursor:pointer'},['✕ CLOSE']);
  closeBtn.onclick = close;
  btnRow.appendChild(refreshBtn); btnRow.appendChild(closeBtn);
  header.appendChild(btnRow);
  win.appendChild(header);

  // Body
  var body = el('div',{style:'padding:14px 18px;overflow-y:auto;flex:1'});

  // Health summary banner
  var health = d.errors.length===0 ? {label:'HEALTHY', color:COLORS.good} : d.errors.length<3 ? {label:'WARNINGS', color:COLORS.warn} : {label:'ERRORS DETECTED', color:COLORS.bad};
  body.appendChild(el('div',{style:'background:'+health.color+'15;border:1px solid '+health.color+'60;border-radius:6px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between'},[
    el('div',{style:'font-weight:700;color:'+health.color+';letter-spacing:0.06em'},['● APP STATUS: '+health.label]),
    el('div',{style:'font-size:11px;color:'+COLORS.mute+';font-family:ui-monospace,monospace'},[d.errors.length+' errors · '+d.warns.length+' warnings'])
  ]));

  // Performance
  body.appendChild(section('⚡ Performance Timing',[
    row('Time to First Byte',          d.timing.ttfb!=null            ? d.timing.ttfb+' ms'            : '—'),
    row('First Paint',                 d.timing.firstPaint!=null      ? d.timing.firstPaint+' ms'      : '—'),
    row('First Contentful Paint',      d.timing.firstContentful!=null ? d.timing.firstContentful+' ms' : '—', d.timing.firstContentful && d.timing.firstContentful<1500 ? COLORS.good : COLORS.warn),
    row('DOM Content Loaded',          d.timing.domContentLoaded!=null? d.timing.domContentLoaded+' ms': '—'),
    row('Fully Loaded',                d.timing.loadComplete!=null    ? d.timing.loadComplete+' ms'    : '—'),
  ]));

  // DOM
  body.appendChild(section('🧬 DOM Composition',[
    row('Total Elements',  d.dom.elements,    d.dom.elements>2000?COLORS.warn:COLORS.text),
    row('Tree Depth',      d.dom.depth),
    row('Images',          d.dom.images),
    row('<script> Tags',   d.dom.scripts),
    row('Stylesheets',     d.dom.stylesheets),
    row('Iframes',         d.dom.iframes),
  ]));

  // Resources
  var resKids = [
    row('Total Resources', d.resources.total),
    row('Transferred',     bytes(d.resources.bytes)),
  ];
  if (d.resources.slowest.length){
    resKids.push(el('div',{style:'padding:6px 10px;font-size:10px;color:'+COLORS.mute+';font-family:ui-monospace,monospace;text-transform:uppercase;letter-spacing:0.05em'},['Slowest:']));
    d.resources.slowest.forEach(function(r){ resKids.push(row(r.url, r.ms+' ms', r.ms>500?COLORS.warn:COLORS.text)); });
  }
  body.appendChild(section('📦 Resource Loading', resKids));

  // Memory
  if (d.memory){
    body.appendChild(section('🧠 JS Heap Memory',[
      row('Used',  bytes(d.memory.used),  d.memory.used/d.memory.limit>0.7?COLORS.warn:COLORS.good),
      row('Total Allocated', bytes(d.memory.total)),
      row('Heap Limit', bytes(d.memory.limit)),
    ]));
  }

  // Storage
  body.appendChild(section('💾 Local Storage',[
    row('Keys Stored', d.storage.keys),
    row('Bytes Used',  bytes(d.storage.bytes)),
  ]));

  // Secrets
  if (d.secrets.count > 0){
    var secKids = [row('API Keys Available', d.secrets.count, COLORS.good)];
    d.secrets.names.forEach(function(n){ secKids.push(row(n, '✓ injected', COLORS.good)); });
    body.appendChild(section('🔑 User-Provided API Keys', secKids));
  }

  // Viewport
  body.appendChild(section('🖥 Viewport & Device',[
    row('Window Size', d.viewport.width+' × '+d.viewport.height+' px'),
    row('Device Pixel Ratio', d.viewport.dpr),
    row('Browser', (d.viewport.ua.match(/(Firefox|Chrome|Safari|Edge)\\/[\\d.]+/)||['Unknown'])[0]),
  ]));

  // Errors
  if (d.errors.length){
    var errKids = [];
    d.errors.forEach(function(e){
      errKids.push(el('div',{style:'padding:8px 10px;border-bottom:1px solid '+COLORS.border+';font-family:ui-monospace,monospace;font-size:11px'},[
        el('div',{style:'color:'+COLORS.bad+';word-break:break-word;line-height:1.5'},[e.msg]),
        el('div',{style:'color:'+COLORS.mute+';font-size:10px;margin-top:2px'},[ago(e.ts)])
      ]));
    });
    body.appendChild(section('🔴 Console Errors ('+d.errors.length+')', errKids));
  }
  if (d.warns.length){
    var warnKids = [];
    d.warns.forEach(function(w){
      warnKids.push(el('div',{style:'padding:8px 10px;border-bottom:1px solid '+COLORS.border+';font-family:ui-monospace,monospace;font-size:11px'},[
        el('div',{style:'color:'+COLORS.warn+';word-break:break-word;line-height:1.5'},[w.msg]),
        el('div',{style:'color:'+COLORS.mute+';font-size:10px;margin-top:2px'},[ago(w.ts)])
      ]));
    });
    body.appendChild(section('⚠ Console Warnings ('+d.warns.length+')', warnKids));
  }

  // Footer
  body.appendChild(el('div',{style:'text-align:center;color:'+COLORS.mute+';font-size:10px;font-family:ui-monospace,monospace;padding:8px;letter-spacing:0.05em'},['NEXUSELITE STUDIO · DIAGNOSTICS v1.0']));

  win.appendChild(body);
  panel.appendChild(win);
  return panel;
}

var current = null;
function close(){ if (current && current.parentNode){ current.parentNode.removeChild(current); } current = null; }
function render(){
  close();
  current = buildPanel(gather());
  document.body.appendChild(current);
}

function buildButton(){
  var btn = el('button',{
    id:'__nexusDiagBtn',
    title:'Open Build Analysis & App Diagnostics',
    style:'position:fixed;bottom:16px;right:16px;z-index:2147483645;background:'+COLORS.bg+';color:'+COLORS.primary+';border:1px solid '+COLORS.primary+';border-radius:999px;padding:8px 14px;font-family:ui-monospace,monospace;font-size:11px;font-weight:700;letter-spacing:0.08em;cursor:pointer;box-shadow:0 0 16px rgba(0,212,255,0.35);transition:all 0.2s'
  },['📊 DIAGNOSTICS']);
  btn.onmouseover = function(){ btn.style.background = COLORS.primary; btn.style.color = COLORS.bg; };
  btn.onmouseout  = function(){ btn.style.background = COLORS.bg;       btn.style.color = COLORS.primary; };
  btn.onclick = render;
  return btn;
}

function install(){
  if (document.getElementById('__nexusDiagBtn')) return;
  document.body.appendChild(buildButton());
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install);
} else {
  install();
}
})();</script>`;

/**
 * Inject the diagnostics widget into the user's HTML, just before </body>.
 * Falls back to appending if no </body> tag is present.
 */
export function injectDiagnosticsWidget(html: string): string {
  if (!html) return html;
  if (html.includes("__nexusDiagInstalled")) return html; // idempotent
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${WIDGET_SCRIPT}</body>`);
  }
  return html + WIDGET_SCRIPT;
}
