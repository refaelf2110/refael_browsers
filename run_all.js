// Suppress Windows file-lock errors from Firefox temp-profile cleanup races.
// These errors fire both as unhandledRejection (promise path) and as uncaughtException
// (sync throws inside Puppeteer's rimraf cleanup after browser.close() resolves).
process.on('unhandledRejection', reason => { console.error('[unhandledRejection swallowed]', (reason && reason.message) || reason); });
process.on('uncaughtException',  err    => { console.error('[uncaughtException swallowed]', (err && err.message) || err); });

// ── Exit diagnostics — detect premature process.exit() calls ─────────────────
{
  const _fsSync = require('fs');
  const _dbgLog = 'C:\\browsers\\debug.log';
  const _origExit = process.exit.bind(process);
  process.exit = function diagExit(code) {
    try {
      _fsSync.appendFileSync(_dbgLog,
        `[${new Date().toISOString()}] process.exit(${code}) called\n${new Error().stack}\n`, 'utf8');
    } catch(_) {}
    _origExit(code);
  };
  process.on('exit', code => {
    try {
      _fsSync.appendFileSync(_dbgLog,
        `[${new Date().toISOString()}] process 'exit' event code=${code}\n`, 'utf8');
    } catch(_) {}
  });
}

const { chromium, firefox } = require('playwright');
const { getInstalledBrowsers, Browser } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer-core');
const { Builder, Browser: WdBrowser, By } = require('selenium-webdriver');
const wdChrome  = require('selenium-webdriver/chrome');
const wdFirefox = require('selenium-webdriver/firefox');
const wdEdge    = require('selenium-webdriver/edge');
const { remote: wdioRemote } = require('webdriverio');
const taiko = require('taiko');
// Taiko installs an 'exitOnUnhandledFailures' handler that calls process.exit(1).
// Remove it so that Firefox temp-profile EBUSY errors and other async cleanup
// noise cannot kill the process mid-run.
for (const fn of process.rawListeners('unhandledRejection')) {
  if (fn.name === 'exitOnUnhandledFailures') process.removeListener('unhandledRejection', fn);
}
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const { generateHTML } = require('./generate_html');
const { saveRun }      = require('./db');

const CACHE_DIR     = 'C:\\browsers';
const FF_DIR        = path.join(CACHE_DIR, 'firefox');
function geckoExeFor(ffMajor) {
  return Number(ffMajor) < 91
    ? path.join(CACHE_DIR, 'geckodriver', 'v0.30.0', 'geckodriver.exe')
    : path.join(CACHE_DIR, 'geckodriver', 'latest', 'geckodriver.exe');
}
const EDGE_MANIFEST = path.join(CACHE_DIR, 'edgedriver', 'manifest.json');

const AUTH_HEADER = {
  'x-refael': '7e8afcbdd3',
  'Authorization': 'Basic ' + Buffer.from('admin:D$2sE%$R7aspBq').toString('base64'),
};
// CDP-safe subset — Authorization is intentionally excluded so it is NOT forwarded to CDN
// subresources (which would trigger CORS preflight failures on cheqzone.b-cdn.net).
const CDP_HEADER  = { 'x-refael': '7e8afcbdd3' };
// Prefer the container-built XPI; fall back to a local copy; auto-build from source
// if running on the host (outside the container) and no prebuilt file exists.
function resolveHeaderInjectorXpi() {
  const containerPath = 'C:\\app\\header-injector.xpi';
  const localPath = path.join(__dirname, 'header-injector.xpi');
  if (fs.existsSync(containerPath)) return containerPath;
  if (fs.existsSync(localPath)) return localPath;
  const srcDir = path.join(__dirname, 'header-injector');
  if (!fs.existsSync(srcDir)) return localPath;
  try {
    const { execSync } = require('child_process');
    const tmp = localPath.replace('.xpi', '.zip');
    execSync(`powershell -Command "Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${tmp}' -Force"`, { stdio: 'ignore' });
    if (fs.existsSync(tmp)) fs.renameSync(tmp, localPath);
    if (fs.existsSync(localPath)) console.log('[init] Built header-injector.xpi from source');
  } catch (_) {}
  return localPath;
}
const FF_EXT_XPI = resolveHeaderInjectorXpi();
process.env.SE_CACHE_PATH = path.join(CACHE_DIR, 'selenium-manager');
const RESULTS_FILE = path.join(CACHE_DIR, 'results_full.html');
const TEST_URL     = 'https://obs.4.dev.cheqzone.com/tests/reasons-debug.html';
// URL with embedded credentials — Chrome/Edge cache auth per-origin so subrequests to
// obs.4.dev.cheqzone.com are authenticated without leaking Authorization to CDN domains.
const TEST_URL_AUTHED = TEST_URL.replace('https://', 'https://admin:D$2sE%25$R7aspBq@');
const NAV_TIMEOUT  = 30000;  // page navigation
const SYNC_TIMEOUT = 90000;  // waiting for sync element to fill
const CONCURRENCY  = 6;

// Reason codes excluded from detection by default (user can toggle in the results page).
const EXCLUDED_REASONS = new Set(['100', '112', '214']);

// ── Runtime filters ────────────────────────────────────────────────────────────
// Narrow which combinations run via env vars (all accept comma-separated values):
//   FRAMEWORK=playwright,selenium      framework names (see list below)
//   BROWSER=chrome,firefox             browser label as recorded in results
//   VERSION=131,136                    major version numbers
//   HEADLESS=true|false                omit to run both modes
//
// Framework names:  playwright  puppeteer  selenium  webdriverio  taiko  cypress  testcafe
// Browser labels:   chromium  firefox-pw  chrome  firefox  edge  edge-beta  edge-dev
const FILTER_FRAMEWORK = process.env.FRAMEWORK
  ? new Set(process.env.FRAMEWORK.toLowerCase().split(',').map(s => s.trim())) : null;
const FILTER_BROWSER = process.env.BROWSER
  ? new Set(process.env.BROWSER.toLowerCase().split(',').map(s => s.trim())) : null;
const FILTER_VERSION = process.env.VERSION
  ? new Set(process.env.VERSION.split(',').map(s => s.trim())) : null;
const FILTER_HEADLESS = 'HEADLESS' in process.env
  ? process.env.HEADLESS === 'true' : null;

// Returns true when the given combination passes all active filters.
// Pass headless=null for batch runners that handle headless filtering internally.
function want(framework, label, major, headless) {
  if (FILTER_FRAMEWORK && !FILTER_FRAMEWORK.has(framework))                          return false;
  if (FILTER_BROWSER   && !FILTER_BROWSER.has(label))                                return false;
  if (FILTER_VERSION   && major != null && !FILTER_VERSION.has(String(major)))       return false;
  if (headless !== null && FILTER_HEADLESS !== null && headless !== FILTER_HEADLESS) return false;
  return true;
}

let _nextPort = 19000;
function allocatePort() { return _nextPort++; }

// Resilient wrapper around getInstalledBrowsers — falls back to a direct cache
// scan if the library crashes on old-format entries in the cache directory.
function listCacheEntries(cacheDir) {
  const results = [];
  const scan = (browser, dir, execRelPath) => {
    const d = path.join(cacheDir, dir);
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d)) {
      const m = entry.match(/^win64-(.+)$/);
      if (!m) continue;
      results.push({ browser, buildId: m[1], executablePath: path.join(d, entry, ...execRelPath), platform: 'win64' });
    }
  };
  scan(Browser.CHROME,       'chrome',       ['chrome-win64', 'chrome.exe']);
  scan(Browser.FIREFOX,      'firefox',      ['core', 'firefox.exe']);
  scan(Browser.CHROMEDRIVER, 'chromedriver', ['chromedriver-win64', 'chromedriver.exe']);
  return results;
}

async function safeGetInstalledBrowsers(options) {
  try { return await getInstalledBrowsers(options); } catch (_e) { return listCacheEntries(options.cacheDir); }
}

function sample(arr) {
  if (arr.length === 0) return [];
  if (arr.length <= 3) return [...arr];
  return [arr[0], arr[Math.floor((arr.length - 1) / 2)], arr[arr.length - 1]];
}

function formatElapsed(ms) {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── MON-log-based sync (reasons-debug.html) ──────────────────────────────────
// The page renders each /mon response as a <div class="entry reason"> in #log
// with <span class="route">mon</span> inside. Poll for 5 such entries without
// injecting anything — the automation platform's evaluate/execute is sufficient.

// Playwright / Puppeteer waitForFunction: resolves when 5 mon log entries appear.
const REASON_READY_JS = `(() => {
  var routes = document.querySelectorAll('#log .entry.reason .route');
  var count = 0;
  for (var i = 0; i < routes.length; i++) {
    if (routes[i].textContent.trim() === 'mon') count++;
  }
  return count >= 5;
})()`;

// Extract reason codes from #reasonSummary badge spans.
const EXTRACT_REASONS_JS = `(() => {
  try {
    var spans = document.querySelectorAll('#reasonSummary .summary-list span');
    if (spans.length > 0) {
      return Array.from(spans).map(function(s){ return (s.textContent || '').trim(); }).filter(function(s){ return s.length > 0; });
    }
    return [];
  } catch(e) { return null; }
})()`;

// Filters, excludes, and sorts positive values from reasonList.
function extractPositives(reasonList) {
  if (!Array.isArray(reasonList)) return [];
  return reasonList
    .filter(r => {
      if (r === null || r === undefined) return false;
      const s = String(r).trim();
      return s !== '' && s !== '0' && s !== 'null' && !s.startsWith('-') && !EXCLUDED_REASONS.has(s);
    })
    .map(r => String(r).trim())
    .sort((a, b) => {
      const an = Number(a), bn = Number(b);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.localeCompare(b);
    });
}

// Same as extractPositives but without the EXCLUDED_REASONS filter — stores raw positives
// so the results page can toggle exclusions interactively.
function extractAllReasons(reasonList) {
  if (!Array.isArray(reasonList)) return [];
  return reasonList
    .filter(r => {
      if (r === null || r === undefined) return false;
      const s = String(r).trim();
      return s !== '' && s !== '0' && s !== 'null' && !s.startsWith('-');
    })
    .map(r => String(r).trim())
    .sort((a, b) => {
      const an = Number(a), bn = Number(b);
      if (!isNaN(an) && !isNaN(bn)) return an - bn;
      return a.localeCompare(b);
    });
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Navigate with one automatic retry on network errors (ERR_FAILED / ERR_ABORTED).
async function gotoWithRetry(page, url, options) {
  try {
    await page.goto(url, options);
  } catch(e) {
    if (/ERR_FAILED|ERR_ABORTED|ERR_NETWORK|NS_BINDING_ABORTED/.test(e.message)) {
      await new Promise(r => setTimeout(r, 2000));
      await page.goto(url, options);
    } else {
      throw e;
    }
  }
}

// Polls every second until #log has 5 entries with route 'mon'.
const WAIT_FOR_REASON_JS = `
var cb = arguments[arguments.length - 1];
var deadline = Date.now() + 85000;
function monCount() {
  var routes = document.querySelectorAll('#log .entry.reason .route');
  var n = 0;
  for (var i = 0; i < routes.length; i++) {
    if (routes[i].textContent.trim() === 'mon') n++;
  }
  return n;
}
function check() {
  if (monCount() >= 5)        { cb('READY'); return true; }
  if (Date.now() >= deadline) { cb('');      return true; }
  return false;
}
if (check()) return;
var _t = setInterval(function() { if (check()) clearInterval(_t); }, 1000);
`;

async function pollReasonSelenium(driver) {
  try {
    await driver.manage().setTimeouts({ script: SYNC_TIMEOUT });
    const raw = await driver.executeAsyncScript(WAIT_FOR_REASON_JS);
    return String(raw || '') === 'READY';
  } catch(e) {}
  return false;
}

// Parse #reasonSummary span text written to file by Cypress / TestCafe (one reason per line).
function parseReasonSummaryText(text) {
  if (!text || text === 'null') return [];
  return text.split(/[\n\r]+/).map(s => s.trim()).filter(s => s.length > 0 && !/^detected\s+reasons/i.test(s));
}

// ── concurrency pool ──────────────────────────────────────────────────────────

const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 min max per task — prevents any hung browser from stalling the pool

async function withConcurrency(fns, limit) {
  let i = 0;
  async function worker() {
    while (i < fns.length) {
      const fn = fns[i++];
      await Promise.race([
        fn().catch(() => {}),
        new Promise(r => setTimeout(r, TASK_TIMEOUT_MS)),
      ]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
}

// ── results collection ────────────────────────────────────────────────────────

const results = [];

function record(framework, label, major, mode, positiveReasons, allReasons, error) {
  const tag    = `${framework}-${label}-${major}-${mode}`;
  const status = error
    ? `ERROR: ${error}`
    : positiveReasons.length > 0
      ? `DETECTED: ${positiveReasons.join(', ')}`
      : 'CLEAN';
  console.log(`${tag} ${status}`);
  results.push({ framework, label, major, mode, positiveReasons, allReasons, error });
}

// ── test runners ──────────────────────────────────────────────────────────────

async function runPlaywrightTest(label, knownMajor, engine, launchOptions, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let browser, positiveReasons = [], allReasons = [], error = null, major = knownMajor ?? '?';
  try {
    browser = await engine.launch({ ...launchOptions, headless });
    const page = await browser.newPage();
    if (label === 'firefox-pw') {
      // Firefox BiDi: setExtraHTTPHeaders doesn't apply to the initial navigation request.
      // Use page.route() to inject auth headers into ALL requests (nav + XHR + fetch).
      await page.route('**/*', async route => {
        await route.continue({ headers: { ...route.request().headers(), ...AUTH_HEADER } });
      });
    } else {
      await page.setExtraHTTPHeaders(AUTH_HEADER);
    }
    await gotoWithRetry(page, TEST_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const reasonReceived = await page.waitForFunction(REASON_READY_JS, { timeout: SYNC_TIMEOUT, polling: 500 }).then(() => true).catch(() => false);
    const rawList = await page.evaluate(EXTRACT_REASONS_JS).catch(() => null);
    positiveReasons = extractPositives(rawList);
    allReasons      = extractAllReasons(rawList);
    if (!reasonReceived && positiveReasons.length === 0) error = 'no reason data';
    major = knownMajor ?? browser.version().split('.')[0];
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  }
  record('playwright', label, major, mode, positiveReasons, allReasons, error);
}

async function runPuppeteerTest(major, executablePath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let browser, positiveReasons = [], allReasons = [], error = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
      timeout: 60000,
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders(AUTH_HEADER);
    await gotoWithRetry(page, TEST_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const reasonReceived = await page.waitForFunction(REASON_READY_JS, { timeout: SYNC_TIMEOUT, polling: 500 }).then(() => true).catch(() => false);
    const rawList = await page.evaluate(EXTRACT_REASONS_JS).catch(() => null);
    positiveReasons = extractPositives(rawList);
    allReasons      = extractAllReasons(rawList);
    if (!reasonReceived && positiveReasons.length === 0) error = 'no reason data';
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  }
  record('puppeteer', 'chrome', major, mode, positiveReasons, allReasons, error);
}

async function runPuppeteerFirefoxTest(major, ffPath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let browser, positiveReasons = [], allReasons = [], error = null;
  try {
    browser = await puppeteer.launch({
      executablePath: ffPath,
      browser: 'firefox',
      headless,
      timeout: 120000, // Firefox BiDi startup can be slow in containers
      extraPrefsFirefox: {
        'xpinstall.signatures.required': false,
        'xpinstall.whitelist.required': false,
      },
    });
    // Install header-injector extension as a best-effort supplement.
    if (fs.existsSync(FF_EXT_XPI)) await browser.installExtension(FF_EXT_XPI).catch(() => {});
    const page = await browser.newPage();
    // page.authenticate() handles Basic Auth for the initial navigation request.
    await page.authenticate({ username: 'admin', password: 'D$2sE%$R7aspBq' }).catch(() => {});
    // network.setExtraHeaders (BiDi) injects x-refael into ALL requests in this context (XHR/fetch/nav).
    await page.setExtraHTTPHeaders({ 'x-refael': '7e8afcbdd3' }).catch(() => {});
    await gotoWithRetry(page, TEST_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT * 2 });
    const reasonReceived = await page.waitForFunction(REASON_READY_JS, { timeout: SYNC_TIMEOUT, polling: 500 }).then(() => true).catch(() => false);
    const rawList = await page.evaluate(EXTRACT_REASONS_JS).catch(() => null);
    positiveReasons = extractPositives(rawList);
    allReasons      = extractAllReasons(rawList);
    if (!reasonReceived && positiveReasons.length === 0) error = 'no reason data';
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  }
  record('puppeteer', 'firefox', major, mode, positiveReasons, allReasons, error);
}

async function runPuppeteerEdgeTest(label, major, edgePath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let browser, positiveReasons = [], allReasons = [], error = null;
  try {
    browser = await puppeteer.launch({
      executablePath: edgePath,
      headless,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--disable-default-apps', '--no-default-browser-check'],
    });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders(AUTH_HEADER);
    await gotoWithRetry(page, TEST_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const reasonReceived = await page.waitForFunction(REASON_READY_JS, { timeout: SYNC_TIMEOUT, polling: 500 }).then(() => true).catch(() => false);
    const rawList = await page.evaluate(EXTRACT_REASONS_JS).catch(() => null);
    positiveReasons = extractPositives(rawList);
    allReasons      = extractAllReasons(rawList);
    if (!reasonReceived && positiveReasons.length === 0) error = 'no reason data';
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  }
  record('puppeteer', label, major, mode, positiveReasons, allReasons, error);
}

async function runSeleniumChromeTest(major, chromePath, driverPath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let driver, positiveReasons = [], allReasons = [], error = null;
  try {
    const svc  = new wdChrome.ServiceBuilder(driverPath).setPort(allocatePort());
    const opts = new wdChrome.Options();
    opts.setChromeBinaryPath(chromePath);
    opts.addArguments('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--disable-software-rasterizer', '--no-zygote');
    opts.excludeSwitches(['enable-automation']);
    opts.setUserPreferences({ 'useAutomationExtension': false });
    if (headless) opts.addArguments('--headless=new');

    driver = await new Builder()
      .forBrowser(WdBrowser.CHROME)
      .setChromeService(svc)
      .setChromeOptions(opts)
      .build();

    await driver.sendDevToolsCommand('Network.enable', {});
    await driver.sendDevToolsCommand('Network.setExtraHTTPHeaders', { headers: CDP_HEADER });
    await driver.sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: 'Object.defineProperty(navigator,"webdriver",{get:()=>undefined});',
    });
    await driver.get(TEST_URL_AUTHED);
    await driver.findElement(By.css('button')).then(btn => btn.click()).catch(() => {});
    const reasonReceived = await pollReasonSelenium(driver);
    if (!reasonReceived) {
      error = 'no reason data';
    } else {
      const rawList = await driver.executeScript(EXTRACT_REASONS_JS).catch(() => null);
      const list = Array.isArray(rawList) ? rawList : [];
      positiveReasons = extractPositives(list);
      allReasons      = extractAllReasons(list);
    }
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
  record('selenium', 'chrome', major, mode, positiveReasons, allReasons, error);
}

async function runSeleniumFirefoxTest(major, ffPath, geckodriverPath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let driver, positiveReasons = [], allReasons = [], error = null;
  try {
    const svc  = new wdFirefox.ServiceBuilder(geckodriverPath).setPort(allocatePort());
    const opts = new wdFirefox.Options();
    opts.setBinary(ffPath);
    opts.setPreference('marionette.enabled', true);
    opts.setPreference('toolkit.startup.max_resumed_crashes', -1);
    opts.setPreference('browser.sessionstore.resume_from_crash', false);
    opts.setPreference('dom.webdriver.enabled', false);
    opts.setPreference('xpinstall.signatures.required', false);
    if (headless) opts.addArguments('-headless');

    driver = await new Builder()
      .forBrowser(WdBrowser.FIREFOX)
      .setFirefoxService(svc)
      .setFirefoxOptions(opts)
      .build();

    // Install extension at runtime (more reliable than addExtensions in profile options).
    // Without x-refael header, /ct returns a different response that doesn't call onCheqResponse.
    if (fs.existsSync(FF_EXT_XPI)) await driver.installAddon(FF_EXT_XPI, true).catch(() => {});

    // Use plain URL — the header-injector extension injects both x-refael and Authorization.
    // URL-embedded credentials (TEST_URL_AUTHED) trigger a security warning in Firefox 87+.
    await driver.manage().setTimeouts({ pageLoad: NAV_TIMEOUT });
    await driver.get(TEST_URL);
    await driver.findElement(By.css('button')).then(btn => btn.click()).catch(() => {});
    const reasonReceived = await pollReasonSelenium(driver);
    if (!reasonReceived) {
      error = 'no reason data';
    } else {
      const rawList = await driver.executeScript(EXTRACT_REASONS_JS).catch(() => null);
      const list = Array.isArray(rawList) ? rawList : [];
      positiveReasons = extractPositives(list);
      allReasons      = extractAllReasons(list);
    }
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
  record('selenium', 'firefox', major, mode, positiveReasons, allReasons, error);
}

async function runSeleniumEdgeTest(label, version, edgePath, headless) {
  const mode  = headless ? 'headless' : 'headfull';
  const major = version.split('.')[0];
  let driver, positiveReasons = [], allReasons = [], error = null;
  try {
    const opts = new wdEdge.Options();
    opts.setEdgeChromiumBinaryPath(edgePath);
    opts.addArguments(
      '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-features=VizDisplayCompositor,Translate,AcceptCHFrame,MediaRouter,OptimizationHints',
      '--no-first-run', '--disable-gpu-sandbox', '--disable-software-rasterizer',
      '--disable-blink-features=AutomationControlled',
    );
    if (headless) opts.addArguments('--headless=new');

    driver = await new Builder()
      .forBrowser(WdBrowser.EDGE)
      .setEdgeOptions(opts)
      .build();

    await driver.sendDevToolsCommand('Network.enable', {});
    await driver.sendDevToolsCommand('Network.setExtraHTTPHeaders', { headers: CDP_HEADER });
    await driver.sendDevToolsCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: 'Object.defineProperty(navigator,"webdriver",{get:()=>undefined});',
    });
    await driver.get(TEST_URL_AUTHED);
    await driver.findElement(By.css('button')).then(btn => btn.click()).catch(() => {});
    const reasonReceived = await pollReasonSelenium(driver);
    if (!reasonReceived) {
      error = 'no reason data';
    } else {
      const rawList = await driver.executeScript(EXTRACT_REASONS_JS).catch(() => null);
      const list = Array.isArray(rawList) ? rawList : [];
      positiveReasons = extractPositives(list);
      allReasons      = extractAllReasons(list);
    }
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
  record('selenium', label, major, mode, positiveReasons, allReasons, error);
}

async function runWebdriverIOChromeTest(major, chromePath, driverPath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let wdioBrowser, positiveReasons = [], allReasons = [], error = null;
  const port = allocatePort();
  const driverProc = spawn(driverPath, [`--port=${port}`, '--silent'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  try {
    wdioBrowser = await wdioRemote({
      hostname: 'localhost',
      port,
      capabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          binary: chromePath,
          args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...(headless ? ['--headless=new'] : [])],
          excludeSwitches: ['enable-automation'],
          prefs: { useAutomationExtension: false },
        },
      },
      logLevel: 'error',
    });
    // Access CDP features via Puppeteer interop (WebdriverIO v8 recommended approach).
    // The WebDriver session remains active (navigator.webdriver etc. still set by ChromeDriver).
    const pBrowser = await wdioBrowser.getPuppeteer();
    const pages = await pBrowser.pages();
    const page = pages[0] || (await pBrowser.newPage());
    await page.setExtraHTTPHeaders(CDP_HEADER);
    await page.evaluateOnNewDocument('Object.defineProperty(navigator,"webdriver",{get:()=>undefined})');
    await page.goto(TEST_URL_AUTHED, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const reasonReceived = await page.waitForFunction(REASON_READY_JS, { timeout: SYNC_TIMEOUT, polling: 500 }).then(() => true).catch(() => false);
    const rawList = await page.evaluate(EXTRACT_REASONS_JS).catch(() => null);
    const list = Array.isArray(rawList) ? rawList : [];
    positiveReasons = extractPositives(list);
    allReasons      = extractAllReasons(list);
    if (!reasonReceived && positiveReasons.length === 0) error = 'no reason data';
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (wdioBrowser) await wdioBrowser.deleteSession().catch(() => {});
    driverProc.kill();
    await new Promise(r => setTimeout(r, 300));
  }
  record('webdriverio', 'chrome', major, mode, positiveReasons, allReasons, error);
}

async function runWebdriverIOFirefoxTest(major, ffPath, geckodriverPath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let wdioBrowser, positiveReasons = [], allReasons = [], error = null;
  const port = allocatePort();
  const driverProc = spawn(geckodriverPath, [`--port=${port}`], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  try {
    const ffOpts = {
      binary: ffPath,
      args: headless ? ['-headless'] : [],
      prefs: {
        'marionette.enabled': true,
        'toolkit.startup.max_resumed_crashes': -1,
        'browser.sessionstore.resume_from_crash': false,
        'dom.webdriver.enabled': false,
        'xpinstall.signatures.required': false,
      },
    };
    wdioBrowser = await wdioRemote({
      hostname: 'localhost',
      port,
      capabilities: { browserName: 'firefox', 'moz:firefoxOptions': ffOpts },
      logLevel: 'error',
    });
    // Install extension post-session — geckodriver 0.34+ no longer accepts extensions in capabilities.
    if (fs.existsSync(FF_EXT_XPI)) {
      const extB64 = Buffer.from(fs.readFileSync(FF_EXT_XPI)).toString('base64');
      await wdioBrowser.installAddOn(extB64, true).catch(() => {});
    }
    // Use plain URL — extension handles x-refael + Authorization headers.
    await wdioBrowser.url(TEST_URL);
    const reasonDeadline = Date.now() + SYNC_TIMEOUT;
    let reasonReceived = false;
    while (Date.now() < reasonDeadline) {
      const count = await wdioBrowser.execute(function() {
        var routes = document.querySelectorAll('#log .entry.reason .route');
        var n = 0;
        for (var i = 0; i < routes.length; i++) {
          if (routes[i].textContent.trim() === 'mon') n++;
        }
        return n;
      }).catch(() => 0);
      if (count >= 5) { reasonReceived = true; break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!reasonReceived) {
      error = 'no reason data';
    } else {
      const rawText = await wdioBrowser.execute(function() {
        try {
          var spans = document.querySelectorAll('#reasonSummary .summary-list span');
          return Array.from(spans).map(function(s){ return (s.textContent || '').trim(); }).join('\n');
        } catch(e) { return ''; }
      }).catch(() => '');
      const list = parseReasonSummaryText(rawText);
      positiveReasons = extractPositives(list);
      allReasons      = extractAllReasons(list);
    }
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    if (wdioBrowser) await wdioBrowser.deleteSession().catch(() => {});
    driverProc.kill();
    await new Promise(r => setTimeout(r, 300));
  }
  record('webdriverio', 'firefox', major, mode, positiveReasons, allReasons, error);
}

// WebdriverIO Firefox: geckodriver has concurrency issues when multiple Firefox instances start
// simultaneously (shared lock / profile conflicts). Run all versions sequentially in one task.
// geckodriver path is resolved per-version via geckoExeFor() so older Firefox uses v0.30.0.
async function runAllWebdriverIOFirefoxTests(firefoxes) {
  for (const { major, executablePath } of firefoxes) {
    const geckoExe = geckoExeFor(major);
    if (!fs.existsSync(geckoExe)) continue;
    for (const headless of [true, false]) {
      if (FILTER_HEADLESS !== null && headless !== FILTER_HEADLESS) continue;
      await runWebdriverIOFirefoxTest(major, executablePath, geckoExe, headless).catch(() => {});
    }
  }
}

// Taiko uses a single global browser instance — wrap all versions sequentially in one task.
async function runTaikoChromeTests(chromes) {
  for (const { major, executablePath } of chromes) {
    for (const headless of [true, false]) {
      if (FILTER_HEADLESS !== null && headless !== FILTER_HEADLESS) continue;
      await runTaikoTest(major, executablePath, headless).catch(() => {});
    }
  }
}

async function runTaikoTest(major, executablePath, headless) {
  const mode = headless ? 'headless' : 'headfull';
  let positiveReasons = [], allReasons = [], error = null;
  try {
    process.env.TAIKO_BROWSER_PATH = executablePath;
    await taiko.openBrowser({ headless, args: ['--no-sandbox', '--disable-gpu'] });
    try {
      const cdpClient = await taiko.client();
      const verInfo = await cdpClient.Browser.getVersion();
      const detectedMajor = (verInfo.product.split('/')[1] ?? '').split('.')[0];
      if (detectedMajor) major = detectedMajor;
      await cdpClient.Network.enable({});
      await cdpClient.Network.setExtraHTTPHeaders({ headers: CDP_HEADER });
      await cdpClient.Page.addScriptToEvaluateOnNewDocument({
        source: 'Object.defineProperty(navigator,"webdriver",{get:()=>undefined});',
      });
    } catch(e) {}
    await taiko.goto(TEST_URL_AUTHED, { timeout: NAV_TIMEOUT });
    const deadline = Date.now() + SYNC_TIMEOUT;
    let reasonReceived = false;
    while (Date.now() < deadline) {
      const count = await taiko.evaluate(() => {
        var routes = document.querySelectorAll('#log .entry.reason .route');
        var n = 0;
        for (var i = 0; i < routes.length; i++) {
          if (routes[i].textContent.trim() === 'mon') n++;
        }
        return n;
      }).catch(() => 0);
      if (count >= 5) { reasonReceived = true; break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!reasonReceived) {
      error = 'no reason data';
    } else {
      const rawList = await taiko.evaluate(() => {
        try {
          var spans = document.querySelectorAll('#reasonSummary .summary-list span');
          return Array.from(spans).map(function(s){ return (s.textContent || '').trim(); }).filter(function(s){ return s.length > 0; });
        } catch(e) { return null; }
      }).catch(() => null);
      const list = Array.isArray(rawList) ? rawList : [];
      positiveReasons = extractPositives(list);
      allReasons      = extractAllReasons(list);
    }
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    await taiko.closeBrowser().catch(() => {});
  }
  record('taiko', 'chromium', major, mode, positiveReasons, allReasons, error);
}

// ── Cypress ───────────────────────────────────────────────────────────────────
// cypress.run() is always headless-automation-mode; no separate headfull variant.
// All Cypress tests run sequentially in one task to avoid shared-state conflicts.

async function runAllCypressTests(chromes) {
  for (const { major, executablePath } of chromes) {
    await runCypressChromeTest(major, executablePath).catch(() => {});
  }
}

async function runCypressChromeTest(major, chromePath) {
  const outFile = path.join('C:\\Windows\\Temp', `cy-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  let positiveReasons = [], allReasons = [], error = null;
  try {
    const cypress = require('cypress');
    const result = await cypress.run({
      projectRoot: __dirname,
      browser: chromePath,
      spec: path.join(__dirname, 'cypress-detection.cy.js'),
      config: {
        video: false,
        screenshotOnRunFailure: false,
        pageLoadTimeout: NAV_TIMEOUT,
        defaultCommandTimeout: SYNC_TIMEOUT,
      },
      env: {
        TEST_URL: TEST_URL_AUTHED,
        OUT_FILE: outFile,
        XREFAEL:  CDP_HEADER['x-refael'],
      },
      quiet: true,
    });
    if (result.status === 'failed') {
      error = (result.message || 'cypress run failed').split('\n')[0].slice(0, 80);
    } else if (result.totalFailed > 0) {
      const msg = result.runs?.[0]?.tests?.[0]?.attempts?.[0]?.error?.message || 'test failed';
      error = msg.split('\n')[0].slice(0, 80);
    } else if (!fs.existsSync(outFile)) {
      error = 'sync not received';
    } else {
      const text = fs.readFileSync(outFile, 'utf8').trim();
      const list = parseReasonSummaryText(text);
      positiveReasons = extractPositives(list);
      allReasons      = extractAllReasons(list);
    }
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    try { fs.unlinkSync(outFile); } catch {}
  }
  record('cypress', 'chromium', major, 'headless', positiveReasons, allReasons, error);
}

// ── TestCafe ──────────────────────────────────────────────────────────────────
// TestCafe's hammerhead reverse-proxy approach gives a distinct detection fingerprint.
// All TestCafe tests run sequentially in one task to prevent process.env collisions.

async function runAllTestCafeTests(chromes) {
  for (const { major, executablePath } of chromes) {
    for (const headless of [true, false]) {
      if (FILTER_HEADLESS !== null && headless !== FILTER_HEADLESS) continue;
      await runTestCafeChromeTest(major, executablePath, headless).catch(() => {});
    }
  }
}

async function runTestCafeChromeTest(major, chromePath, headless) {
  const mode    = headless ? 'headless' : 'headfull';
  const outFile = path.join('C:\\Windows\\Temp', `tc-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  let testcafe, positiveReasons = [], allReasons = [], error = null;
  try {
    const createTestCafe = require('testcafe');
    process.env.TC_TEST_URL = TEST_URL_AUTHED;
    process.env.TC_OUT_FILE = outFile;
    process.env.TC_XREFAEL  = CDP_HEADER['x-refael'];
    process.env.TC_AUTH     = AUTH_HEADER['Authorization'];
    testcafe = await createTestCafe('localhost');
    const chromeArgs = `--no-sandbox --disable-gpu${headless ? ' --headless=new' : ''}`;
    const failedCount = await testcafe.createRunner()
      .src([path.join(__dirname, 'testcafe-detection.js')])
      .browsers([`path:${chromePath} ${chromeArgs}`])
      .run({
        selectorTimeout:    SYNC_TIMEOUT,
        assertionTimeout:   SYNC_TIMEOUT,
        pageLoadTimeout:    NAV_TIMEOUT,
        skipJsErrors:       true,
        disableScreenshots: true,
      });
    if (!fs.existsSync(outFile)) {
      error = failedCount > 0 ? 'test failed' : 'sync not received';
    } else {
      const text = fs.readFileSync(outFile, 'utf8').trim();
      const list = parseReasonSummaryText(text);
      positiveReasons = extractPositives(list);
      allReasons      = extractAllReasons(list);
    }
  } catch (err) {
    error = err.message.split('\n')[0];
  } finally {
    delete process.env.TC_TEST_URL; delete process.env.TC_OUT_FILE;
    delete process.env.TC_XREFAEL; delete process.env.TC_AUTH;
    if (testcafe) await testcafe.close().catch(() => {});
    try { fs.unlinkSync(outFile); } catch {}
  }
  record('testcafe', 'chrome', major, mode, positiveReasons, allReasons, error);
}

// ── HTML generation ───────────────────────────────────────────────────────────

function generateResultsHTML(elapsed, runLabel) {
  const completedAt = new Date().toISOString();
  saveRun(runLabel.toLowerCase(), elapsed, results);
  const html = generateHTML(results, elapsed, runLabel, completedAt);
  fs.writeFileSync(RESULTS_FILE, html, 'utf8');
  console.log(`\nResults page: ${RESULTS_FILE}`);
}

// ── build task list (ALL versions) ────────────────────────────────────────────

async function buildTaskList() {
  const allInstalled = await safeGetInstalledBrowsers({ cacheDir: CACHE_DIR });
  const tasks = [];

  const chromes = allInstalled
    .filter(b => b.browser === Browser.CHROME)
    .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));

  // ── Playwright ─────────────────────────────────────────────────────────────
  for (const headless of [true, false])
    if (want('playwright', 'chromium', null, headless))
      tasks.push(() => runPlaywrightTest('chromium', null, chromium, { args: ['--no-sandbox'] }, headless));

  for (const headless of [true, false])
    if (want('playwright', 'firefox-pw', null, headless))
      tasks.push(() => runPlaywrightTest('firefox-pw', null, firefox, {}, headless));

  for (const b of chromes) {
    const major = b.buildId.split('.')[0];
    const extraArgs = parseInt(major) === 149
      ? ['--no-sandbox', '--disable-gpu-sandbox', '--disable-software-rasterizer', '--no-zygote']
      : ['--no-sandbox'];
    for (const headless of [true, false])
      if (want('playwright', 'chrome', major, headless))
        tasks.push(() => runPlaywrightTest('chrome', major, chromium,
          { executablePath: b.executablePath, args: extraArgs }, headless));
  }

  for (const [label, channel] of [['edge', 'msedge'], ['edge-beta', 'msedge-beta'], ['edge-dev', 'msedge-dev']]) {
    for (const headless of [true, false])
      if (want('playwright', label, null, headless))
        tasks.push(() => runPlaywrightTest(label, null, chromium,
          { channel, args: ['--no-sandbox', '--no-first-run', '--disable-default-apps', '--no-default-browser-check'] }, headless));
  }

  // ── Puppeteer — sampled Chrome versions ────────────────────────────────────
  for (const b of sample(chromes)) {
    const major = b.buildId.split('.')[0];
    for (const headless of [true, false])
      if (want('puppeteer', 'chrome', major, headless))
        tasks.push(() => runPuppeteerTest(major, b.executablePath, headless));
  }

  // ── Puppeteer Firefox — all versions (via @puppeteer/browsers) ─────────────
  const puppeteerFirefoxes = allInstalled
    .filter(b => b.browser === Browser.FIREFOX && fs.existsSync(b.executablePath))
    .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));
  for (const b of puppeteerFirefoxes) {
    const major = b.buildId.replace(/^[^_]+_/, '').split('.')[0];
    for (const headless of [true, false])
      if (want('puppeteer', 'firefox', major, headless))
        tasks.push(() => runPuppeteerFirefoxTest(major, b.executablePath, headless));
  }

  // ── Puppeteer Edge — all 3 channels ───────────────────────────────────────
  if (fs.existsSync(EDGE_MANIFEST)) {
    const edgeManifest = JSON.parse(fs.readFileSync(EDGE_MANIFEST, 'utf8'));
    for (const { label, version, edgePath } of Object.values(edgeManifest)) {
      if (!fs.existsSync(edgePath)) continue;
      const major = version.split('.')[0];
      for (const headless of [true, false])
        if (want('puppeteer', label, major, headless))
          tasks.push(() => runPuppeteerEdgeTest(label, major, edgePath, headless));
    }
  }

  // ── Selenium Chrome — all versions with matching ChromeDriver ─────────────
  const chromeDriverMap = new Map(
    allInstalled.filter(b => b.browser === Browser.CHROMEDRIVER && fs.existsSync(b.executablePath))
      .map(b => [b.buildId, b.executablePath])
  );
  for (const b of chromes.filter(c => chromeDriverMap.has(c.buildId))) {
    const major = b.buildId.split('.')[0];
    for (const headless of [true, false])
      if (want('selenium', 'chrome', major, headless))
        tasks.push(() => runSeleniumChromeTest(major, b.executablePath, chromeDriverMap.get(b.buildId), headless));
  }

  // ── Selenium Edge ─────────────────────────────────────────────────────────
  if (fs.existsSync(EDGE_MANIFEST)) {
    const edgeManifest = JSON.parse(fs.readFileSync(EDGE_MANIFEST, 'utf8'));
    for (const { label, version, edgePath } of Object.values(edgeManifest)) {
      if (!fs.existsSync(edgePath)) continue;
      const major = version.split('.')[0];
      for (const headless of [true, false])
        if (want('selenium', label, major, headless))
          tasks.push(() => runSeleniumEdgeTest(label, version, edgePath, headless));
    }
  }

  // ── Selenium Firefox — all versions ───────────────────────────────────────
  if (fs.existsSync(FF_DIR)) {
    for (const major of fs.readdirSync(FF_DIR).sort((a, b) => Number(a) - Number(b))) {
      const exe = path.join(FF_DIR, major, 'firefox.exe');
      if (!fs.existsSync(exe)) continue;
      const geckoExe = geckoExeFor(major);
      if (!fs.existsSync(geckoExe)) continue;
      for (const headless of [true, false])
        if (want('selenium', 'firefox', major, headless))
          tasks.push(() => runSeleniumFirefoxTest(major, exe, geckoExe, headless));
    }
  }

  // ── WebdriverIO Chrome — all versions with matching ChromeDriver ──────────
  for (const b of chromes.filter(c => chromeDriverMap.has(c.buildId))) {
    const major = b.buildId.split('.')[0];
    for (const headless of [true, false])
      if (want('webdriverio', 'chrome', major, headless))
        tasks.push(() => runWebdriverIOChromeTest(major, b.executablePath, chromeDriverMap.get(b.buildId), headless));
  }

  // ── WebdriverIO Firefox — NSIS-installed Firefox (same pool as Selenium) ─────────
  // @puppeteer/browsers portable Firefox builds don't work reliably with geckodriver
  // in this container (same binaries also fail under Puppeteer). Use the NSIS-installed
  // versions from FF_DIR, which Selenium confirms can create geckodriver sessions.
  if (fs.existsSync(FF_DIR)) {
    const wdioFirefoxFiltered = fs.readdirSync(FF_DIR)
      .sort((a, b) => Number(a) - Number(b))
      .filter(major => {
        const exe = path.join(FF_DIR, major, 'firefox.exe');
        return fs.existsSync(exe) && want('webdriverio', 'firefox', major, null);
      })
      .map(major => ({ major, executablePath: path.join(FF_DIR, major, 'firefox.exe') }));
    if (wdioFirefoxFiltered.length > 0)
      tasks.push(() => runAllWebdriverIOFirefoxTests(wdioFirefoxFiltered));
  }

  // ── Taiko — sampled Chrome for Testing versions (sequential: global browser state)
  const taikoChromes = sample(FILTER_VERSION
    ? chromes.filter(b => FILTER_VERSION.has(b.buildId.split('.')[0]))
    : chromes).map(b => ({ major: b.buildId.split('.')[0], executablePath: b.executablePath }));
  if (want('taiko', 'chromium', null, null) && taikoChromes.length > 0)
    tasks.push(() => runTaikoChromeTests(taikoChromes));

  // ── Cypress — 3 sampled Chrome versions (sequential, headless automation mode) ─
  const cypressChromes = sample(FILTER_VERSION
    ? chromes.filter(b => FILTER_VERSION.has(b.buildId.split('.')[0]))
    : chromes).map(b => ({ major: b.buildId.split('.')[0], executablePath: b.executablePath }));
  if (want('cypress', 'chromium', null, true) && cypressChromes.length > 0)
    tasks.push(() => runAllCypressTests(cypressChromes));

  // ── TestCafe — 3 sampled Chrome versions (sequential, headless + headfull) ─────
  const testcafeChromes = sample(FILTER_VERSION
    ? chromes.filter(b => FILTER_VERSION.has(b.buildId.split('.')[0]))
    : chromes).map(b => ({ major: b.buildId.split('.')[0], executablePath: b.executablePath }));
  if (want('testcafe', 'chrome', null, null) && testcafeChromes.length > 0)
    tasks.push(() => runAllTestCafeTests(testcafeChromes));

  return tasks;
}

// ── run ───────────────────────────────────────────────────────────────────────

async function run() {
  const tasks = await buildTaskList();
  console.log(`[FULL] Running ${tasks.length} combinations (${CONCURRENCY} concurrent)...\n`);
  const startMs = Date.now();
  await withConcurrency(tasks, CONCURRENCY);
  const elapsed = formatElapsed(Date.now() - startMs);
  console.log(`\nTotal time: ${elapsed}`);
  generateResultsHTML(elapsed, 'Full');
}

run().catch(err => { console.error(err); process.exit(1); });
