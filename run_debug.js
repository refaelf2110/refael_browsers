// Targeted debug runner. Set env vars to control what runs:
//   DEBUG_TARGET  — e.g. "selenium-chrome-135", "selenium-firefox-151", "selenium-edge-148"
//   DEBUG_HEADLESS — "true" or "false" (default: false)
//
// Example: docker run --rm -e RUN_MODE=debug -e DEBUG_TARGET=selenium-chrome-135 -e DEBUG_HEADLESS=false ...

const { getInstalledBrowsers, Browser } = require('@puppeteer/browsers');
const { Builder, Browser: WdBrowser } = require('selenium-webdriver');
const wdChrome  = require('selenium-webdriver/chrome');
const wdFirefox = require('selenium-webdriver/firefox');
const wdEdge    = require('selenium-webdriver/edge');
const fs   = require('fs');
const path = require('path');

const CACHE_DIR     = 'C:\\browsers';
const FF_DIR        = path.join(CACHE_DIR, 'firefox');
// Only x-refael goes to all domains via CDP (Authorization must NOT go to CDN — causes CORS failure).
// The Authorization header is embedded in the URL for the initial navigation so Chrome caches it
// for the session and automatically sends it on same-origin subrequests.
const CDP_HEADER    = { 'x-refael': '7e8afcbdd3' };
const FF_EXT_XPI    = 'C:\\app\\header-injector.xpi';
function geckoExeFor(ffMajor) {
  return Number(ffMajor) < 91
    ? path.join(CACHE_DIR, 'geckodriver', 'v0.30.0', 'geckodriver.exe')
    : path.join(CACHE_DIR, 'geckodriver', 'latest', 'geckodriver.exe');
}
const EDGE_MANIFEST = path.join(CACHE_DIR, 'edgedriver', 'manifest.json');
const TEST_URL      = 'https://obs.4.dev.cheqzone.com/tests/collector.html';
// URL with embedded Basic Auth credentials — used for navigation so Chrome sends Authorization
// only for obs.4.dev.cheqzone.com (cached per-origin) without leaking it to CDN subresources.
const TEST_URL_AUTHED = TEST_URL.replace('https://', 'https://admin:D$2sE%$R7aspBq@');
const SYNC_TIMEOUT  = 600000;

process.env.SE_CACHE_PATH = path.join(CACHE_DIR, 'selenium-manager');

// Parse DEBUG_TARGET: "selenium-chrome-135", "selenium-firefox-151", "selenium-edge-148", "selenium-edge-beta-149"
const rawTarget  = (process.env.DEBUG_TARGET || 'selenium-chrome-131').toLowerCase();
const headless   = (process.env.DEBUG_HEADLESS || 'false') === 'true';

// Extract parts: [driver, browser, ...version]
const parts = rawTarget.split('-');   // e.g. ["selenium","chrome","135"]
const driver  = parts[0];             // "selenium"
let   browser = parts[1];             // "chrome" | "firefox" | "edge"
let   channel = null;                 // "beta" | "dev" | null
let   major   = parts[parts.length - 1]; // last part is always the major version number

// Handle edge-beta-149, edge-dev-150
if (browser === 'edge' && parts.length === 4) {
  channel = parts[2];  // "beta" or "dev"
  // major = parts[3]  — already set above
}

const mode = headless ? 'headless' : 'headfull';
console.log(`\nTarget: ${rawTarget} | mode: ${mode}\n`);

// ── JS snippets ───────────────────────────────────────────────────────────────

// Async script: sets up a MutationObserver and calls back when sync-data is
// populated. Makes exactly ONE executeAsyncScript call so the browser's event
// loop stays completely idle between navigation and the callback — preventing
// starvation of requestIdleCallback-based detection code.
// arguments[arguments.length-1] is the WebDriver async callback.
// NOTE: must NOT wrap in an IIFE — inside an IIFE, `arguments` is the IIFE's own
// (empty) argument list, not the WebDriver-injected callback, causing cb to be undefined.
const WAIT_FOR_SYNC_JS = `
var cb = arguments[arguments.length - 1];
function check() {
  var el = document.getElementById('sync-data');
  var txt = el ? (el.textContent || '').trim() : '';
  if (txt.length > 0) { cb('READY:' + txt); return true; }
  return false;
}
if (check()) return;
// Watch for the element to be created or its content to change.
var obs = new MutationObserver(function() { if (check()) obs.disconnect(); });
obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
`;

// ── wait for sync (single async-script call, no polling) ─────────────────────

async function pollSync(driver) {
  const start = Date.now();
  try {
    await driver.manage().setTimeouts({ script: SYNC_TIMEOUT });
    const raw = await driver.executeAsyncScript(WAIT_FOR_SYNC_JS);
    const s   = ((Date.now() - start) / 1000).toFixed(1);
    const str = raw == null ? '' : String(raw);
    if (str.startsWith('READY:')) {
      const content = str.slice(6);
      console.log(`  +${s}s  SYNC RECEIVED: ${content.slice(0, 300)}`);
      return content;
    }
    console.log(`  +${s}s  unexpected result: "${str.slice(0, 80)}"`);
  } catch(e) {
    const s = ((Date.now() - start) / 1000).toFixed(1);
    const msg = e.message.split('\n')[0];
    if (msg.includes('timeout') || msg.includes('Timeout')) {
      console.log(`  TIMEOUT after ${SYNC_TIMEOUT/1000}s`);
    } else {
      console.log(`  +${s}s  script error: ${msg}`);
    }
  }
  return null;
}

// ── Chrome ────────────────────────────────────────────────────────────────────

async function runChrome() {
  const allInstalled = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
  const chrome = allInstalled.find(b =>
    b.browser === Browser.CHROME && b.buildId.startsWith(major + '.')
  );
  const driverB = allInstalled.find(b =>
    b.browser === Browser.CHROMEDRIVER && b.buildId.startsWith(major + '.')
  );

  if (!chrome)  { console.error(`Chrome ${major} not found in cache`);       process.exit(1); }
  if (!driverB) { console.error(`ChromeDriver ${major} not found in cache`); process.exit(1); }

  console.log(`Chrome:       ${chrome.executablePath}`);
  console.log(`ChromeDriver: ${driverB.executablePath}`);

  // Sanity-check: fetch the test URL with Node.js to confirm server is reachable
  // and to see what it returns to a plain HTTP client vs a Chrome browser.
  try {
    const nodeResp = await fetch(TEST_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' } });
    const nodeBody = await nodeResp.text();
    console.log(`[0] Node fetch: HTTP ${nodeResp.status}, ${nodeBody.length} bytes, body start: ${nodeBody.substring(0, 200).replace(/\n/g, ' ')}`);
  } catch(e) {
    console.log(`[0] Node fetch failed: ${e.message.split('\n')[0]}`);
  }

  const svc  = new wdChrome.ServiceBuilder(driverB.executablePath).setPort(19999);
  const opts = new wdChrome.Options();
  opts.setChromeBinaryPath(chrome.executablePath);
  opts.addArguments('--no-sandbox', '--disable-gpu');
  opts.excludeSwitches(['enable-automation']);
  opts.setUserPreferences({ 'useAutomationExtension': false });
  if (headless) opts.addArguments('--headless=new');

  let driver;
  try {
    console.log('\n[1] Building driver...');
    driver = await new Builder()
      .forBrowser(WdBrowser.CHROME)
      .setChromeService(svc)
      .setChromeOptions(opts)
      .build();
    console.log('[1] Driver built OK');

    await driver.sendDevToolsCommand('Network.enable', {});
    await driver.sendDevToolsCommand('Network.setExtraHTTPHeaders', { headers: CDP_HEADER });

    // Inject cleanup script before page loads, to remove ChromeDriver artifacts
    await driver.sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: [
        'Object.defineProperty(navigator,"webdriver",{get:()=>undefined});',
        'delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;',
        'delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;',
        'delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;',
        'delete window.cdc_adoQpoasnfa76pfcZLmcfl_JSON;',
        'delete window.cdc_adoQpoasnfa76pfcZLmcfl_;',
      ].join('')
    });
    console.log('[1b] CDP pre-page injection OK');

    console.log('[2] Navigating...');
    await driver.get(TEST_URL_AUTHED);
    console.log('[2] Navigation complete');
    const currentUrl = await driver.getCurrentUrl();
    const pageTitle  = await driver.getTitle();
    console.log(`[2a] URL: ${currentUrl} | Title: "${pageTitle}"`);

    // Diagnostic: page state, dimensions, network
    try {
      const wd   = await driver.executeScript('return String(navigator.webdriver);');
      const dims = await driver.executeScript('return "sw="+screen.width+" sh="+screen.height+" iw="+window.innerWidth+" ih="+window.innerHeight+" ow="+window.outerWidth+" oh="+window.outerHeight;');
      console.log(`[2b] webdriver=${wd} ${dims}`);

      // All resource requests — shows which domains were contacted and whether they succeeded
      const allRes = await driver.executeScript(`return performance.getEntriesByType('resource').map(function(r){
        return r.name.replace(/\\?.*$/,'').split('/').slice(0,4).join('/') + ' ('+r.transferSize+'b '+Math.round(r.duration)+'ms)';
      }).join('\\n  ')`);
      console.log('[2b] Resources:\n  ' + (allRes || '(none)'));

      // Raw HTML source — full dump to understand page structure
      const src = await driver.getPageSource();
      console.log('[2b] Page source (' + src.length + ' bytes):\n' + src.substring(0, 3000));

      // Detailed timing for cheqzone CDN f.js
      const cdnEntry = await driver.executeScript(`
        var e = performance.getEntriesByType('resource').find(function(r){return r.name.indexOf('b-cdn.net/f.js')>-1;});
        if(!e) return 'no-entry';
        return JSON.stringify({transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize,
          dur:Math.round(e.duration),status:e.responseStatus||'n/a',
          dns:Math.round(e.domainLookupEnd-e.domainLookupStart),
          connect:Math.round(e.connectEnd-e.connectStart),
          ttfb:Math.round(e.responseStart-e.requestStart)});
      `);
      console.log('[2b] CDN f.js timing: ' + cdnEntry);

      // Async fetch of f.js to see actual HTTP response
      const cdnFetch = await driver.executeAsyncScript(`
        var done = arguments[arguments.length-1];
        fetch('https://cheqzone.b-cdn.net/f.js',{mode:'no-cors'})
          .then(function(r){return r.text().then(function(t){done('type='+r.type+' status='+r.status+' size='+t.length);});})
          .catch(function(e){done('err='+String(e).substring(0,120));});
      `);
      console.log('[2b] CDN fetch result: ' + cdnFetch);

      // DOM structure — checks that sync-data exists and what's in it
      const divInfo = await driver.executeScript(`return (function(){
        var divs = document.querySelectorAll('body > div');
        var out = 'body>divs=' + divs.length;
        for(var i=0;i<divs.length;i++) out += ' ['+i+']='+divs[i].children.length+'ch txt=['+divs[i].textContent.trim().substring(0,40)+']';
        var el = document.getElementById('sync-data');
        out += ' sync-data=' + (el ? 'found txt=['+el.textContent.trim().substring(0,80)+']' : 'missing');
        return out;
      })()`);
      console.log('[2b] DOM: ' + divInfo);
    } catch(e) {
      console.log('[2b] diag failed:', e.message.split('\n')[0]);
    }

    // Try clicking the "Click here" button to trigger the SDK
    try {
      const { By } = require('selenium-webdriver');
      const btn = await driver.findElement(By.css('button'));
      await btn.click();
      console.log('[2c] Clicked the button');
    } catch(e) {
      console.log('[2c] Button click failed:', e.message.split('\n')[0]);
    }

    console.log('[3] Polling for sync element...');
    const syncContent = await pollSync(driver);
    console.log(syncContent != null ? '\nRESULT: SUCCESS — content: ' + String(syncContent).slice(0, 200) : '\nRESULT: sync not received');

    // Post-poll: check both sync-data and async-data to see which received content
    try {
      const divCheck = await driver.executeScript(`
        var s = document.getElementById('sync-data');
        var a = document.getElementById('async-data');
        return 'sync-data=[' + (s ? s.textContent.trim().substring(0,150) : 'missing') + '] | async-data=[' + (a ? a.textContent.trim().substring(0,150) : 'missing') + ']';
      `);
      console.log('[3b] div contents: ' + divCheck);
    } catch(e) {}

    // Final resource dump — shows everything loaded during the full poll window
    try {
      const finalRes = await driver.executeScript(`return performance.getEntriesByType('resource').map(function(r){
        return r.name.replace(/\\?.*$/,'').split('/').slice(0,4).join('/') + ' ('+r.transferSize+'b)';
      }).join('\\n  ')`);
      console.log('[4] Final resources:\n  ' + (finalRes || '(none)'));
    } catch(e) {}
  } catch(err) {
    console.error('\nFATAL:', err.message.split('\n')[0]);
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
}

// ── Firefox ───────────────────────────────────────────────────────────────────

async function runFirefox() {
  const ffExe = path.join(FF_DIR, major, 'firefox.exe');
  if (!fs.existsSync(ffExe)) {
    console.error(`Firefox ${major} not found at ${ffExe}`);
    process.exit(1);
  }
  const geckoExe = geckoExeFor(major);
  if (!fs.existsSync(geckoExe)) {
    console.error(`GeckoDriver not found at ${geckoExe}`);
    process.exit(1);
  }

  console.log(`Firefox:     ${ffExe}`);
  console.log(`GeckoDriver: ${geckoExe}`);

  const svc  = new wdFirefox.ServiceBuilder(geckoExe).setPort(19998);
  const opts = new wdFirefox.Options();
  opts.setBinary(ffExe);
  opts.setPreference('marionette.port', 2828);
  opts.setPreference('marionette.enabled', true);
  opts.setPreference('toolkit.startup.max_resumed_crashes', -1);
  opts.setPreference('browser.sessionstore.resume_from_crash', false);
  opts.setPreference('dom.webdriver.enabled', false);
  opts.setPreference('xpinstall.signatures.required', false);
  if (headless) opts.addArguments('-headless');
  const xpiExists = fs.existsSync(FF_EXT_XPI);
  console.log(`[ext] XPI file exists: ${xpiExists} (${FF_EXT_XPI})`);

  let driver;
  try {
    console.log('\n[1] Building Firefox driver...');
    driver = await new Builder()
      .forBrowser(WdBrowser.FIREFOX)
      .setFirefoxService(svc)
      .setFirefoxOptions(opts)
      .build();
    console.log('[1] Driver built OK');

    // Install extension via WebDriver installAddon (more reliable than capabilities)
    if (xpiExists) {
      try {
        const extId = await driver.installAddon(FF_EXT_XPI, true);
        console.log('[1a] Extension installed via installAddon, ID:', extId);
      } catch(e) {
        console.log('[1a] installAddon failed:', e.message.split('\n')[0]);
      }
    }

    // Navigate to about:debugging to verify extension is installed
    await driver.get('about:debugging#/runtime/this-firefox');
    await driver.sleep(2000);
    try {
      const dbgSrc = await driver.getPageSource();
      const hasExt = dbgSrc.includes('header-injector') || dbgSrc.includes('Auth Header');
      console.log('[1a] Extension in about:debugging: ' + hasExt);
      if (!hasExt) console.log('[1a] debugging page snippet: ' + dbgSrc.substring(dbgSrc.indexOf('Temporary'), dbgSrc.indexOf('Temporary') + 500).replace(/\s+/g, ' '));
    } catch(e) {
      console.log('[1a] debugging check failed:', e.message.split('\n')[0]);
    }

    await driver.get('about:blank');
    await driver.sleep(1500);

    // Navigate with embedded credentials (URL-embedded auth bypasses auth dialog)
    console.log('[2] Navigating...');
    await driver.get(TEST_URL_AUTHED);
    console.log('[2] Navigation complete');

    // Diagnostic: inspect page state and network
    try {
      const wd   = await driver.executeScript('return String(navigator.webdriver);');
      const div3 = await driver.executeScript('var d=document.getElementById("sync-data"); return d ? d.textContent.substring(0,200) : "missing";');
      const res  = await driver.executeScript(`return (function(){
        var e=performance.getEntriesByType('resource').filter(function(r){return r.name.indexOf('clicktrue')>-1;});
        if(!e.length) return 'no-entry';
        return 'status='+e[0].responseStatus+' dur='+Math.round(e[0].duration)+'ms size='+e[0].transferSize;
      })()`);
      const patched = await driver.executeScript('return String(window.__xrefael_patched);');
      const ctEntry = await driver.executeScript(`return (function(){
        var e=performance.getEntriesByType('resource').find(function(r){return r.name.indexOf('/ct')>-1;});
        if(e) return '/ct already loaded: '+e.transferSize+'b';
        // Find /ct script tag in DOM
        var scripts = Array.from(document.querySelectorAll('script[src]'));
        var ctScript = scripts.find(function(s){return s.src.indexOf('/ct')>-1;});
        return ctScript ? '/ct script tag: '+ctScript.src.substring(0,200) : '/ct not found yet';
      })()`);
      console.log(`[2b] webdriver=${wd} patched=${patched}`);
      console.log(`[2b] div[3] html: ${div3}`);
      console.log(`[2b] clicktrue resource: ${res}`);
      console.log(`[2b] ${ctEntry}`);

      // If /ct script is visible in DOM, test manually with and without x-refael
      const ctWithHdr = await driver.executeAsyncScript(`
        var done = arguments[arguments.length-1];
        var el = document.querySelector('script[src*="/ct"]');
        if (!el) { done('no /ct in DOM'); return; }
        var url = el.src;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.setRequestHeader('x-refael', '7e8afcbdd3');
        xhr.onload = function(){ done('WITH x-refael: status='+xhr.status+' size='+xhr.responseText.length); };
        xhr.onerror = function(){ done('error'); };
        xhr.send();
      `);
      console.log('[2b2] ' + ctWithHdr);

      const ctWithoutHdr = await driver.executeAsyncScript(`
        var done = arguments[arguments.length-1];
        var el = document.querySelector('script[src*="/ct"]');
        if (!el) { done('no /ct in DOM'); return; }
        var url = el.src;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onload = function(){ done('WITHOUT x-refael: status='+xhr.status+' size='+xhr.responseText.length); };
        xhr.onerror = function(){ done('error'); };
        xhr.send();
      `);
      console.log('[2b3] ' + ctWithoutHdr);
    } catch(e) {
      console.log('[2b] diag failed:', e.message.split('\n')[0]);
    }

    // Set up MutationObserver to capture dynamically-added script URLs (like /ct)
    try {
      await driver.executeScript(`
        window.__capturedScripts = [];
        var obs = new MutationObserver(function(mutations) {
          mutations.forEach(function(m) {
            m.addedNodes.forEach(function(n) {
              if (n.nodeType === 1 && n.tagName === 'SCRIPT' && n.src) {
                window.__capturedScripts.push(n.src);
              }
            });
          });
        });
        obs.observe(document.documentElement, {childList: true, subtree: true});
      `);
      console.log('[2c0] MutationObserver set up');
    } catch(e) {
      console.log('[2c0] MutationObserver failed:', e.message.split('\n')[0]);
    }

    // Inject x-refael into all future XHR and fetch requests before clicktrue.js calls /ct
    try {
      await driver.executeScript(`
        (function() {
          var H = 'x-refael', V = '7e8afcbdd3';
          window.__xhrCount = 0; window.__fetchCount = 0; window.__xhrErr = ''; window.__lastUrl = '';
          var origOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(m, u) {
            this.__u = u; return origOpen.apply(this, arguments);
          };
          var origSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function() {
            window.__xhrCount++; window.__lastUrl = this.__u || '?';
            try { this.setRequestHeader(H, V); } catch(e) { window.__xhrErr = String(e); }
            return origSend.apply(this, arguments);
          };
          var origFetch = window.fetch;
          window.fetch = function(input, init) {
            window.__fetchCount++;
            var url = (typeof input === 'string') ? input : (input && input.url) || '?';
            window.__lastUrl = url;
            init = init || {};
            if (init.mode === 'no-cors') {
              // no-cors blocks custom headers; skip to avoid silent failure
              return origFetch.call(window, input, init);
            }
            var h = init.headers;
            if (h && typeof h.set === 'function') { h.set(H, V); }
            else { init.headers = Object.assign({}, h || {}); init.headers[H] = V; }
            return origFetch.call(window, input, init);
          };
          window.__xrefael_patched = true;
        })();
      `);
      console.log('[2c] XHR/fetch patch injected');
    } catch(e) {
      console.log('[2c] patch failed:', e.message.split('\n')[0]);
    }

    // Click the button to trigger detection
    try {
      const btn = await driver.findElement(require('selenium-webdriver').By.css('button'));
      await btn.click();
      console.log('[2d] Clicked the button');
      await driver.sleep(3000);
      const patchStat = await driver.executeScript(
        'return "patched="+window.__xrefael_patched+" xhr="+window.__xhrCount+" fetch="+window.__fetchCount+" lastUrl="+window.__lastUrl+" xhrErr="+window.__xhrErr;'
      );
      const captured = await driver.executeScript('return (window.__capturedScripts||[]).join(" | ")');
      console.log('[2d] patch stats: ' + patchStat);
      console.log('[2d] captured scripts: ' + (captured || '(none)'));

      // Test: manually fetch the captured /ct URL with x-refael to see if header changes the response
      const ctManual = await driver.executeAsyncScript(`
        var done = arguments[arguments.length-1];
        var ctUrl = (window.__capturedScripts||[]).find(function(u){return u.indexOf('/ct')>-1;});
        if (!ctUrl) { done('no /ct URL captured'); return; }
        var xhr = new XMLHttpRequest();
        xhr.open('GET', ctUrl);
        xhr.setRequestHeader('x-refael', '7e8afcbdd3');
        xhr.onload = function(){ done('status='+xhr.status+' size='+xhr.responseText.length); };
        xhr.onerror = function(){ done('error'); };
        xhr.send();
      `);
      console.log('[2e] manual /ct with x-refael: ' + ctManual);

      // Without x-refael for comparison
      const ctNoHdr = await driver.executeAsyncScript(`
        var done = arguments[arguments.length-1];
        var ctUrl = (window.__capturedScripts||[]).find(function(u){return u.indexOf('/ct')>-1;});
        if (!ctUrl) { done('no /ct URL captured'); return; }
        var xhr = new XMLHttpRequest();
        xhr.open('GET', ctUrl);
        xhr.onload = function(){ done('status='+xhr.status+' size='+xhr.responseText.length); };
        xhr.onerror = function(){ done('error'); };
        xhr.send();
      `);
      console.log('[2f] manual /ct without x-refael: ' + ctNoHdr);
    } catch(e) {
      console.log('[2d] click failed:', e.message.split('\n')[0]);
    }

    console.log('[3] Polling for sync element...');
    const syncContent = await pollSync(driver);
    console.log(syncContent != null ? '\nRESULT: SUCCESS — content: ' + String(syncContent).slice(0, 200) : '\nRESULT: sync not received');

    try {
      const divCheck = await driver.executeScript(`
        var s = document.getElementById('sync-data');
        var a = document.getElementById('async-data');
        return 'sync-data=[' + (s ? s.textContent.trim().substring(0,150) : 'missing') + '] | async-data=[' + (a ? a.textContent.trim().substring(0,150) : 'missing') + ']';
      `);
      console.log('[3b] div contents: ' + divCheck);
    } catch(e) {}

    try {
      const finalRes = await driver.executeScript(`return performance.getEntriesByType('resource').map(function(r){
        return r.name.replace(/\\?.*$/,'').split('/').slice(0,4).join('/') + ' ('+r.transferSize+'b)';
      }).join('\\n  ')`);
      console.log('[4] Final resources:\n  ' + (finalRes || '(none)'));
    } catch(e) {}
  } catch(err) {
    console.error('\nFATAL:', err.message.split('\n')[0]);
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
}

// ── Edge ──────────────────────────────────────────────────────────────────────

async function runEdge() {
  if (!fs.existsSync(EDGE_MANIFEST)) {
    console.error('Edge manifest not found');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(EDGE_MANIFEST, 'utf8'));
  const key = channel ? channel : 'stable';
  const entry = manifest[key];
  if (!entry) { console.error(`Edge channel "${key}" not in manifest`); process.exit(1); }
  if (!fs.existsSync(entry.edgePath)) {
    console.error(`Edge binary not found: ${entry.edgePath}`);
    process.exit(1);
  }

  console.log(`Edge (${key}): ${entry.edgePath} v${entry.version}`);

  const opts = new wdEdge.Options();
  opts.setEdgeChromiumBinaryPath(entry.edgePath);
  opts.addArguments(
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-features=VizDisplayCompositor,Translate,AcceptCHFrame,MediaRouter,OptimizationHints',
    '--no-first-run',
    '--disable-gpu-sandbox',
    '--disable-software-rasterizer',
    '--disable-blink-features=AutomationControlled',
  );
  if (headless) opts.addArguments('--headless=new');

  let driver;
  try {
    console.log('\n[1] Building Edge driver...');
    driver = await new Builder()
      .forBrowser(WdBrowser.EDGE)
      .setEdgeOptions(opts)
      .build();
    console.log('[1] Driver built OK');

    await driver.sendDevToolsCommand('Network.enable', {});
    await driver.sendDevToolsCommand('Network.setExtraHTTPHeaders', { headers: CDP_HEADER });

    console.log('[2] Navigating...');
    await driver.get(TEST_URL_AUTHED);
    console.log('[2] Navigation complete');

    console.log('[3] Polling for sync element...');
    const syncContent = await pollSync(driver);
    console.log(syncContent != null ? '\nRESULT: SUCCESS — content: ' + String(syncContent).slice(0, 200) : '\nRESULT: sync not received');
  } catch(err) {
    console.error('\nFATAL:', err.message.split('\n')[0]);
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
}

// ── dispatch ──────────────────────────────────────────────────────────────────

(async () => {
  if (browser === 'chrome')   await runChrome();
  else if (browser === 'firefox') await runFirefox();
  else if (browser === 'edge')    await runEdge();
  else { console.error(`Unknown browser: ${browser}`); process.exit(1); }
})().catch(err => { console.error(err); process.exit(1); });
