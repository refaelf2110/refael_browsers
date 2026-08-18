'use strict';

process.on('unhandledRejection', reason => { console.error('[unhandledRejection swallowed]', (reason && reason.message) || reason); });
process.on('uncaughtException',  err    => { console.error('[uncaughtException swallowed]',  (err    && err.message)    || err);    });

const { chromium, firefox } = require('playwright');
const { getInstalledBrowsers, Browser } = require('@puppeteer/browsers');
const puppeteer = require('puppeteer-core');
const { Builder, Browser: WdBrowser } = require('selenium-webdriver');
const wdChrome  = require('selenium-webdriver/chrome');
const wdFirefox = require('selenium-webdriver/firefox');
const wdEdge    = require('selenium-webdriver/edge');
const { remote: wdioRemote } = require('webdriverio');
const taiko = require('taiko');
for (const fn of process.rawListeners('unhandledRejection')) {
  if (fn.name === 'exitOnUnhandledFailures') process.removeListener('unhandledRejection', fn);
}
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const http = require('http');
const { saveWindowElements, getWindowElementBrowsers } = require('./db');

const CACHE_DIR         = 'C:\\browsers';
const FF_DIR            = path.join(CACHE_DIR, 'firefox');
const EDGE_MANIFEST     = path.join(CACHE_DIR, 'edgedriver', 'manifest.json');
const EXTRACTOR_PORT    = 19999;
const EXTRACTOR_URL     = `http://localhost:${EXTRACTOR_PORT}/`;
const EXTRACTOR_TIMEOUT = 8 * 60 * 1000;
const NAV_TIMEOUT       = 30000;
const CONCURRENCY       = 4;
const TASK_TIMEOUT      = 15 * 60 * 1000;

let _nextPort = 20000;
function allocatePort() { return _nextPort++; }

function geckoExeFor(ffMajor) {
  return Number(ffMajor) < 91
    ? path.join(CACHE_DIR, 'geckodriver', 'v0.30.0', 'geckodriver.exe')
    : path.join(CACHE_DIR, 'geckodriver', 'latest', 'geckodriver.exe');
}

function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s/60)}m ${s%60}s` : `${s}s`;
}

// ── Concurrency pool ──────────────────────────────────────────────────────────

async function withConcurrency(fns, limit, taskTimeout = TASK_TIMEOUT) {
  let i = 0;
  async function worker() {
    while (i < fns.length) {
      const fn = fns[i++];
      await Promise.race([
        fn().catch(() => {}),
        new Promise(r => setTimeout(r, taskTimeout)),
      ]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
}

// ── Local HTTP server ─────────────────────────────────────────────────────────

function startExtractorServer() {
  const html   = fs.readFileSync(path.join(__dirname, 'window_elements_extractor.html'), 'utf8');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  server.listen(EXTRACTOR_PORT);
  console.log(`[extractor] HTTP server → ${EXTRACTOR_URL}`);
  return server;
}

// ── Wait for extraction to complete ──────────────────────────────────────────

async function extractFromPage(page, lbl) {
  await page.waitForFunction(
    () => { const el = document.getElementById('extractor-data'); return el && el.textContent.trim() === 'DONE'; },
    { timeout: EXTRACTOR_TIMEOUT, polling: 3000 }
  ).catch(() => {});
  const vars = await page.evaluate(() => Array.isArray(window.vars_result) ? window.vars_result : []).catch(() => []);
  if (vars.length > 0) saveWindowElements(lbl, vars);
  else console.log(`[extractor] ${lbl}: no data collected`);
}

const EXTRACTOR_WAIT_JS = `
var cb = arguments[arguments.length - 1];
var deadline = Date.now() + ${EXTRACTOR_TIMEOUT};
(function poll() {
  var el = document.getElementById('extractor-data');
  if (el && el.textContent.trim() === 'DONE') { cb('ok'); return; }
  if (Date.now() >= deadline) { cb('timeout'); return; }
  setTimeout(poll, 3000);
})();
`;

// ── Playwright ────────────────────────────────────────────────────────────────

async function runPlaywright(lbl, engine, launchOptions, headless) {
  let browser = null;
  try {
    browser = await engine.launch({ ...launchOptions, headless });
    const page = await browser.newPage();
    await page.goto(EXTRACTOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await extractFromPage(page, lbl);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  }
}

// ── Puppeteer Chrome ──────────────────────────────────────────────────────────

async function runPuppeteerChrome(lbl, executablePath, headless) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ executablePath, headless, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.goto(EXTRACTOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await extractFromPage(page, lbl);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  }
}

// ── Puppeteer Firefox ─────────────────────────────────────────────────────────

async function runPuppeteerFirefox(lbl, executablePath, headless) {
  let browser = null;
  try {
    browser = await puppeteer.launch({ executablePath, browser: 'firefox', headless, timeout: 60000 });
    const page = await browser.newPage();
    await page.goto(EXTRACTOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await extractFromPage(page, lbl);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (browser) await Promise.race([browser.close(), new Promise(r => setTimeout(r, 10000))]).catch(() => {});
  }
}

// ── Selenium Chrome ───────────────────────────────────────────────────────────

async function runSeleniumChrome(lbl, chromePath, driverPath, headless) {
  let driver = null;
  try {
    const svc  = new wdChrome.ServiceBuilder(driverPath).setPort(allocatePort());
    const opts = new wdChrome.Options();
    opts.setChromeBinaryPath(chromePath);
    opts.addArguments('--no-sandbox', '--disable-gpu');
    if (headless) opts.addArguments('--headless=new');
    driver = await new Builder().forBrowser(WdBrowser.CHROME).setChromeService(svc).setChromeOptions(opts).build();
    await driver.get(EXTRACTOR_URL);
    await driver.manage().setTimeouts({ script: EXTRACTOR_TIMEOUT + 30000 });
    await driver.executeAsyncScript(EXTRACTOR_WAIT_JS).catch(() => {});
    const vars = await driver.executeScript('return window.vars_result || []').catch(() => []);
    if (vars.length > 0) saveWindowElements(lbl, vars);
    else console.log(`[extractor] ${lbl}: no data`);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
}

// ── Selenium Firefox ──────────────────────────────────────────────────────────

async function runSeleniumFirefox(lbl, ffPath, geckodriverPath, headless) {
  let driver = null;
  try {
    const svc  = new wdFirefox.ServiceBuilder(geckodriverPath).setPort(allocatePort());
    const opts = new wdFirefox.Options();
    opts.setBinary(ffPath);
    opts.setPreference('marionette.enabled', true);
    opts.setPreference('toolkit.startup.max_resumed_crashes', -1);
    opts.setPreference('browser.sessionstore.resume_from_crash', false);
    if (headless) opts.addArguments('-headless');
    driver = await new Builder().forBrowser(WdBrowser.FIREFOX).setFirefoxService(svc).setFirefoxOptions(opts).build();
    await driver.get(EXTRACTOR_URL);
    await driver.manage().setTimeouts({ script: EXTRACTOR_TIMEOUT + 30000 });
    await driver.executeAsyncScript(EXTRACTOR_WAIT_JS).catch(() => {});
    const vars = await driver.executeScript('return window.vars_result || []').catch(() => []);
    if (vars.length > 0) saveWindowElements(lbl, vars);
    else console.log(`[extractor] ${lbl}: no data`);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
}

// ── Selenium Edge ─────────────────────────────────────────────────────────────

async function runSeleniumEdge(lbl, edgePath, headless) {
  let driver = null;
  try {
    const opts = new wdEdge.Options();
    opts.setEdgeChromiumBinaryPath(edgePath);
    opts.addArguments('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage');
    if (headless) opts.addArguments('--headless=new');
    driver = await new Builder().forBrowser(WdBrowser.EDGE).setEdgeOptions(opts).build();
    await driver.get(EXTRACTOR_URL);
    await driver.manage().setTimeouts({ script: EXTRACTOR_TIMEOUT + 30000 });
    await driver.executeAsyncScript(EXTRACTOR_WAIT_JS).catch(() => {});
    const vars = await driver.executeScript('return window.vars_result || []').catch(() => []);
    if (vars.length > 0) saveWindowElements(lbl, vars);
    else console.log(`[extractor] ${lbl}: no data`);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (driver) await driver.quit().catch(() => {});
  }
}

// ── WebdriverIO Chrome ────────────────────────────────────────────────────────

async function runWebdriverIOChrome(lbl, chromePath, driverPath, headless) {
  let wdioBrowser = null;
  const port = allocatePort();
  const driverProc = spawn(driverPath, [`--port=${port}`, '--silent'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  try {
    wdioBrowser = await wdioRemote({
      hostname: 'localhost', port,
      capabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          binary: chromePath,
          args: ['--no-sandbox', '--disable-gpu', ...(headless ? ['--headless=new'] : [])],
        },
      },
      logLevel: 'error',
    });
    const pBrowser = await wdioBrowser.getPuppeteer();
    const pages = await pBrowser.pages();
    const page = pages[0] || await pBrowser.newPage();
    await page.goto(EXTRACTOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await extractFromPage(page, lbl);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (wdioBrowser) await wdioBrowser.deleteSession().catch(() => {});
    driverProc.kill();
    await new Promise(r => setTimeout(r, 300));
  }
}

// ── WebdriverIO Firefox ───────────────────────────────────────────────────────

async function runWebdriverIOFirefox(lbl, ffPath, geckodriverPath, headless) {
  let wdioBrowser = null;
  const port = allocatePort();
  const driverProc = spawn(geckodriverPath, [`--port=${port}`], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  try {
    wdioBrowser = await wdioRemote({
      hostname: 'localhost', port,
      capabilities: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          binary: ffPath,
          args: headless ? ['-headless'] : [],
          prefs: {
            'marionette.enabled': true,
            'toolkit.startup.max_resumed_crashes': -1,
            'browser.sessionstore.resume_from_crash': false,
          },
        },
      },
      logLevel: 'error',
    });
    await wdioBrowser.url(EXTRACTOR_URL);
    // Poll for DONE via execute
    const deadline = Date.now() + EXTRACTOR_TIMEOUT;
    while (Date.now() < deadline) {
      const done = await wdioBrowser.execute(function() {
        var el = document.getElementById('extractor-data');
        return el && el.textContent.trim() === 'DONE';
      }).catch(() => false);
      if (done) break;
      await new Promise(r => setTimeout(r, 3000));
    }
    const vars = await wdioBrowser.execute(function() { return window.vars_result || []; }).catch(() => []);
    if (vars.length > 0) saveWindowElements(lbl, vars);
    else console.log(`[extractor] ${lbl}: no data`);
  } catch(err) {
    console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (wdioBrowser) await wdioBrowser.deleteSession().catch(() => {});
    driverProc.kill();
    await new Promise(r => setTimeout(r, 300));
  }
}

// ── Taiko (sequential — global browser state) ─────────────────────────────────

async function runAllTaiko(chromes, done) {
  for (const { major, executablePath } of chromes) {
    for (const headless of [true, false]) {
      const mode = headless ? 'headless' : 'headfull';
      const lbl  = `taiko-chrome-${major}-${mode}`;
      if (done.has(lbl)) { console.log(`[extractor] ${lbl}: already done, skipping`); continue; }
      console.log(`[extractor] starting ${lbl}`);
      try {
        process.env.TAIKO_BROWSER_PATH = executablePath;
        await taiko.openBrowser({ headless, args: ['--no-sandbox', '--disable-gpu'] });
        await taiko.goto(EXTRACTOR_URL, { timeout: NAV_TIMEOUT });
        const deadline = Date.now() + EXTRACTOR_TIMEOUT;
        while (Date.now() < deadline) {
          const isDone = await taiko.evaluate(() => {
            var el = document.getElementById('extractor-data');
            return el && el.textContent.trim() === 'DONE';
          }).catch(() => false);
          if (isDone) break;
          await new Promise(r => setTimeout(r, 3000));
        }
        const vars = await taiko.evaluate(() => Array.isArray(window.vars_result) ? window.vars_result : []).catch(() => []);
        if (vars.length > 0) saveWindowElements(lbl, vars);
        else console.log(`[extractor] ${lbl}: no data`);
      } catch(err) {
        console.error(`[extractor] ${lbl} ERROR: ${err.message.split('\n')[0]}`);
      } finally {
        await taiko.closeBrowser().catch(() => {});
      }
    }
  }
}

// ── Build full task list ──────────────────────────────────────────────────────

async function buildTasks(done) {
  const allInstalled = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
  const tasks = [];

  const chromes = allInstalled
    .filter(b => b.browser === Browser.CHROME)
    .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));
  const chromeDriverMap = new Map(
    allInstalled.filter(b => b.browser === Browser.CHROMEDRIVER && fs.existsSync(b.executablePath))
      .map(b => [b.buildId, b.executablePath])
  );
  const ppFirefoxes = allInstalled
    .filter(b => b.browser === Browser.FIREFOX && fs.existsSync(b.executablePath))
    .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));

  const edgeChannels = fs.existsSync(EDGE_MANIFEST)
    ? Object.values(JSON.parse(fs.readFileSync(EDGE_MANIFEST, 'utf8'))).filter(e => fs.existsSync(e.edgePath))
    : [];

  function add(lbl, fn) {
    if (done.has(lbl)) { console.log(`[extractor] ${lbl}: already done, skipping`); return; }
    tasks.push(async () => { console.log(`[extractor] starting ${lbl}`); await fn(); });
  }

  // ── Playwright bundled chromium ──
  for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
    add(`playwright-chromium-bundled-${mode}`, () => runPlaywright(`playwright-chromium-bundled-${mode}`, chromium, { args: ['--no-sandbox'] }, headless));
  }

  // ── Playwright bundled firefox ──
  for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
    add(`playwright-firefox-pw-bundled-${mode}`, () => runPlaywright(`playwright-firefox-pw-bundled-${mode}`, firefox, {}, headless));
  }

  // ── Playwright Chrome (all versions) ──
  for (const b of chromes) {
    const major = b.buildId.split('.')[0];
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `playwright-chrome-${major}-${mode}`;
      add(lbl, () => runPlaywright(lbl, chromium, { executablePath: b.executablePath, args: ['--no-sandbox'] }, headless));
    }
  }

  // ── Playwright Edge channels ──
  for (const { label, version, edgePath } of edgeChannels) {
    const major = version.split('.')[0];
    const channel = label === 'edge' ? 'msedge' : label === 'edge-beta' ? 'msedge-beta' : 'msedge-dev';
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `playwright-${label}-${major}-${mode}`;
      add(lbl, () => runPlaywright(lbl, chromium, { channel, args: ['--no-sandbox'] }, headless));
    }
  }

  // ── Puppeteer Chrome (all versions) ──
  for (const b of chromes) {
    const major = b.buildId.split('.')[0];
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `puppeteer-chrome-${major}-${mode}`;
      add(lbl, () => runPuppeteerChrome(lbl, b.executablePath, headless));
    }
  }

  // ── Puppeteer Firefox (all @puppeteer/browsers versions) ──
  for (const b of ppFirefoxes) {
    const major = b.buildId.replace(/^[^_]+_/, '').split('.')[0];
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `puppeteer-firefox-${major}-${mode}`;
      add(lbl, () => runPuppeteerFirefox(lbl, b.executablePath, headless));
    }
  }

  // ── Puppeteer Edge channels ──
  for (const { label, version, edgePath } of edgeChannels) {
    const major = version.split('.')[0];
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `puppeteer-${label}-${major}-${mode}`;
      add(lbl, () => runPuppeteerChrome(lbl, edgePath, headless));
    }
  }

  // ── Selenium Chrome (all versions with matching driver) ──
  for (const b of chromes.filter(c => chromeDriverMap.has(c.buildId))) {
    const major = b.buildId.split('.')[0];
    const driverPath = chromeDriverMap.get(b.buildId);
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `selenium-chrome-${major}-${mode}`;
      add(lbl, () => runSeleniumChrome(lbl, b.executablePath, driverPath, headless));
    }
  }

  // ── Selenium Firefox (all versions in FF_DIR) ──
  if (fs.existsSync(FF_DIR)) {
    const ffDirs = fs.readdirSync(FF_DIR)
      .filter(d => fs.existsSync(path.join(FF_DIR, d, 'firefox.exe')))
      .sort((a, b) => Number(a) - Number(b));
    for (const major of ffDirs) {
      const exe = path.join(FF_DIR, major, 'firefox.exe');
      const gecko = geckoExeFor(major);
      if (!fs.existsSync(gecko)) continue;
      for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
        const lbl = `selenium-firefox-${major}-${mode}`;
        add(lbl, () => runSeleniumFirefox(lbl, exe, gecko, headless));
      }
    }
  }

  // ── Selenium Edge channels ──
  for (const { label, version, edgePath } of edgeChannels) {
    const major = version.split('.')[0];
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `selenium-${label}-${major}-${mode}`;
      add(lbl, () => runSeleniumEdge(lbl, edgePath, headless));
    }
  }

  // ── WebdriverIO Chrome (all versions with matching driver) ──
  for (const b of chromes.filter(c => chromeDriverMap.has(c.buildId))) {
    const major = b.buildId.split('.')[0];
    const driverPath = chromeDriverMap.get(b.buildId);
    for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
      const lbl = `webdriverio-chrome-${major}-${mode}`;
      add(lbl, () => runWebdriverIOChrome(lbl, b.executablePath, driverPath, headless));
    }
  }

  // ── WebdriverIO Firefox (@puppeteer/browsers versions + latest geckodriver) ──
  const latestGecko = path.join(CACHE_DIR, 'geckodriver', 'latest', 'geckodriver.exe');
  if (fs.existsSync(latestGecko)) {
    for (const b of ppFirefoxes) {
      const major = b.buildId.replace(/^[^_]+_/, '').split('.')[0];
      for (const [headless, mode] of [[true,'headless'],[false,'headfull']]) {
        const lbl = `webdriverio-firefox-${major}-${mode}`;
        add(lbl, () => runWebdriverIOFirefox(lbl, b.executablePath, latestGecko, headless));
      }
    }
  }

  // ── Taiko Chrome (sequential — wrapped as one task) ──
  tasks.push(() => runAllTaiko(chromes.map(b => ({ major: b.buildId.split('.')[0], executablePath: b.executablePath })), done));

  return tasks;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runAll() {
  const done = new Set(getWindowElementBrowsers());
  console.log(`[extractor] Already extracted: ${done.size} browser(s)`);

  const tasks = await buildTasks(done);
  console.log(`[extractor] ${tasks.length} tasks to run (concurrency: ${CONCURRENCY})\n`);

  const server = startExtractorServer();
  const startMs = Date.now();
  try {
    await withConcurrency(tasks, CONCURRENCY, TASK_TIMEOUT);
  } finally {
    server.close();
  }
  console.log(`\n[extractor] All done in ${formatElapsed(Date.now() - startMs)}.`);
}

runAll().catch(err => { console.error(err); process.exit(1); });
