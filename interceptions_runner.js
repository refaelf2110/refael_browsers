'use strict';

/**
 * interceptions_runner.js
 *
 * Serves interceptor_page.html locally, then drives each available automation
 * framework through every meaningful action, collecting the JS function calls
 * that each action triggers (via window.cheq_getBuffer) and storing them in SQLite.
 *
 * Usage:  node interceptions_runner.js
 */

process.on('unhandledRejection', reason => {
  console.error('[unhandledRejection]', (reason && reason.message) || reason);
});
process.on('uncaughtException', err => {
  console.error('[uncaughtException]', (err && err.message) || err);
});

const { chromium }                      = require('playwright');
const { getInstalledBrowsers, Browser } = require('@puppeteer/browsers');
const puppeteer                         = require('puppeteer-core');
const { Builder, Browser: WdBrowser, By, Key, until } = require('selenium-webdriver');
const wdChrome                          = require('selenium-webdriver/chrome');
const { remote: wdioRemote }            = require('webdriverio');
const { spawn }                         = require('child_process');
const http                              = require('http');
const fs                                = require('fs');
const path                              = require('path');
const {
  createInterceptionSession, finalizeInterceptionSession, saveInterceptions,
} = require('./db');

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_DIR          = 'C:\\browsers';
const INTERCEPTOR_PORT   = 19998;
const INTERCEPTOR_URL    = `http://localhost:${INTERCEPTOR_PORT}/`;
const NAV_TIMEOUT        = 15000;
const WAIT_READY_TIMEOUT = 8000;

let _nextPort = 19100;
function allocatePort() { return _nextPort++; }

// ── Local HTTP server ─────────────────────────────────────────────────────────

function startInterceptorServer() {
  const html = fs.readFileSync(path.join(__dirname, 'interceptor_page.html'), 'utf8');
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise(resolve => {
    server.listen(INTERCEPTOR_PORT, () => {
      console.log(`[interceptor] Server → ${INTERCEPTOR_URL}`);
      resolve(server);
    });
  });
}

// ── Browser discovery ─────────────────────────────────────────────────────────

async function discoverChromes() {
  try {
    const all = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
    return all.filter(b => b.browser === Browser.CHROME && fs.existsSync(b.executablePath))
              .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));
  } catch (_e) {
    // Fallback: scan cache directory directly
    const dir = path.join(CACHE_DIR, 'chrome');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(e => e.startsWith('win64-'))
      .map(e => ({
        browser:        Browser.CHROME,
        buildId:        e.replace('win64-', ''),
        executablePath: path.join(dir, e, 'chrome-win64', 'chrome.exe'),
        platform:       'win64',
      }))
      .filter(b => fs.existsSync(b.executablePath))
      .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));
  }
}

async function discoverChromedrivers() {
  try {
    const all = await getInstalledBrowsers({ cacheDir: CACHE_DIR });
    return new Map(
      all.filter(b => b.browser === Browser.CHROMEDRIVER && fs.existsSync(b.executablePath))
         .map(b => [b.buildId, b.executablePath])
    );
  } catch (_e) {
    const dir = path.join(CACHE_DIR, 'chromedriver');
    if (!fs.existsSync(dir)) return new Map();
    const map = new Map();
    fs.readdirSync(dir).forEach(e => {
      const exe = path.join(dir, e, 'chromedriver-win64', 'chromedriver.exe');
      if (fs.existsSync(exe)) map.set(e.replace('win64-', ''), exe);
    });
    return map;
  }
}

// ── Buffer helpers ────────────────────────────────────────────────────────────

const BROWSER_DEAD = Symbol('BROWSER_DEAD');

/** Drain window.cheq_getBuffer() via page.evaluate and save to DB.
 *  Returns call count, or BROWSER_DEAD if the page/driver is no longer reachable. */
async function drainPw(page, sessionId) {
  let calls;
  try {
    calls = await page.evaluate(() => window.cheq_getBuffer());
  } catch (e) {
    console.log(`  [drain] page error: ${(e.message || '').slice(0, 80)}`);
    return BROWSER_DEAD;
  }
  if (Array.isArray(calls) && calls.length > 0) saveInterceptions(sessionId, calls);
  return Array.isArray(calls) ? calls.length : 0;
}

async function drainSel(driver, sessionId) {
  let calls;
  try {
    calls = await driver.executeScript('return window.cheq_getBuffer ? window.cheq_getBuffer() : []');
  } catch (e) {
    console.log(`  [drain] driver error: ${(e.message || '').slice(0, 80)}`);
    return BROWSER_DEAD;
  }
  if (Array.isArray(calls) && calls.length > 0) saveInterceptions(sessionId, calls);
  return Array.isArray(calls) ? calls.length : 0;
}

async function drainWdio(browser, sessionId) {
  let calls;
  try {
    calls = await browser.execute(() => window.cheq_getBuffer ? window.cheq_getBuffer() : []);
  } catch (e) {
    console.log(`  [drain] wdio error: ${(e.message || '').slice(0, 80)}`);
    return BROWSER_DEAD;
  }
  if (Array.isArray(calls) && calls.length > 0) saveInterceptions(sessionId, calls);
  return Array.isArray(calls) ? calls.length : 0;
}

/** Set current action label in the page. */
async function setPwAction(page, name) {
  await page.evaluate(n => { window.cheq_setAction(n); }, name).catch(() => {});
}
async function setSelAction(driver, name) {
  await driver.executeScript(`window.cheq_setAction && window.cheq_setAction(${JSON.stringify(name)})`).catch(() => {});
}
async function setWdioAction(browser, name) {
  await browser.execute(n => { window.cheq_setAction && window.cheq_setAction(n); }, name).catch(() => {});
}

/** Wait until the page's interception is ready.
 *  Returns true if ready, false if timed out (page likely crashed). */
async function waitReadyPw(page) {
  try {
    await page.waitForFunction(() => typeof window.cheq_getBuffer === 'function', { timeout: WAIT_READY_TIMEOUT });
    return true;
  } catch (_) {
    return false;
  }
}
async function waitReadySel(driver) {
  const deadline = Date.now() + WAIT_READY_TIMEOUT;
  let lastErr = null;
  while (Date.now() < deadline) {
    let ok;
    try {
      ok = await driver.executeScript('return typeof window.cheq_getBuffer === "function"');
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 300));
      continue;
    }
    if (ok === true) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  // Timed out — log what the driver was saying
  if (lastErr) console.error(`  [waitReady] timed out, last driver error: ${(lastErr.message || '').slice(0, 120)}`);
  return false;
}
async function waitReadyWdio(browser) {
  const deadline = Date.now() + WAIT_READY_TIMEOUT;
  let lastErr = null;
  while (Date.now() < deadline) {
    let ok;
    try {
      ok = await browser.execute(() => typeof window.cheq_getBuffer === 'function');
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 300));
      continue;
    }
    if (ok === true) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  if (lastErr) console.error(`  [waitReady] timed out, last wdio error: ${(lastErr.message || '').slice(0, 120)}`);
  return false;
}

// ── Action executor wrappers ─────────────────────────────────────────────────

const ACTION_TIMEOUT_MS = 20000; // max ms any single action may take before we skip it

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** Runs one action. Returns false and throws 'BROWSER_DEAD' if the page is gone. */
async function runActionPw(page, sessionId, name, fn) {
  await setPwAction(page, name);
  try { await withTimeout(fn(), ACTION_TIMEOUT_MS, name); } catch (e) { console.log(`    [${name}] warn: ${(e.message || '').slice(0, 80)}`); }
  const n = await drainPw(page, sessionId);
  if (n === BROWSER_DEAD) { console.error(`  [${name}] BROWSER DEAD — aborting session`); throw new Error('BROWSER_DEAD'); }
  console.log(`  [${name}] ${n} calls`);
}

async function runActionSel(driver, sessionId, name, fn) {
  await setSelAction(driver, name);
  let timedOut = false;
  try {
    await withTimeout(fn(), ACTION_TIMEOUT_MS, name);
  } catch (e) {
    console.log(`    [${name}] warn: ${(e.message || '').slice(0, 80)}`);
    if (e.message && e.message.startsWith('TIMEOUT')) timedOut = true;
  }
  if (timedOut) {
    // ChromeDriver is still processing the hung command — we cannot send any more
    // requests to it. Abort the rest of this session rather than hanging on drainSel.
    console.error(`  [${name}] DRIVER BUSY after timeout — aborting session`);
    throw new Error('BROWSER_DEAD');
  }
  const n = await drainSel(driver, sessionId);
  if (n === BROWSER_DEAD) { console.error(`  [${name}] BROWSER DEAD — aborting session`); throw new Error('BROWSER_DEAD'); }
  console.log(`  [${name}] ${n} calls`);
}

async function runActionWdio(wdio, sessionId, name, fn) {
  await setWdioAction(wdio, name);
  try { await withTimeout(fn(), ACTION_TIMEOUT_MS, name); } catch (e) { console.log(`    [${name}] warn: ${(e.message || '').slice(0, 80)}`); }
  const n = await drainWdio(wdio, sessionId);
  if (n === BROWSER_DEAD) { console.error(`  [${name}] BROWSER DEAD — aborting session`); throw new Error('BROWSER_DEAD'); }
  console.log(`  [${name}] ${n} calls`);
}

// ── Playwright actions ────────────────────────────────────────────────────────

async function runPlaywrightActions(page, sessionId) {
  const run = (name, fn) => runActionPw(page, sessionId, name, fn);

  // Drain page_load calls first
  await drainPw(page, sessionId);

  // ── Mouse ──
  await run('mouse_move',            () => page.mouse.move(200, 200));
  await run('mouse_click_coords',    () => page.mouse.click(200, 200));
  await run('mouse_dblclick_coords', () => page.mouse.dblclick(200, 200));
  await run('mouse_down_up',         async () => { await page.mouse.down(); await page.mouse.up(); });
  await run('mouse_wheel_down',      () => page.mouse.wheel(0, 150));
  await run('mouse_wheel_up',        () => page.mouse.wheel(0, -150));
  await run('hover_element',         () => page.hover('#hover-target'));
  await run('hover_btn',             () => page.hover('#btn-click'));

  // ── Clicks ──
  await run('click_button',          () => page.click('#btn-click'));
  await run('click_button_force',    () => page.click('#btn-click', { force: true }));
  await run('dblclick_button',       () => page.dblclick('#btn-dblclick'));
  await run('right_click',           () => page.click('#btn-context', { button: 'right' }));
  await run('middle_click',          () => page.click('#btn-click', { button: 'middle' }));
  await run('click_link',            () => page.click('#link'));
  await run('click_checkbox',        () => page.click('#checkbox'));
  await run('click_radio',           () => page.click('#radio-a'));

  // ── Keyboard ──
  await run('fill_text_input',       () => page.fill('#text-input', 'Hello from Playwright!'));
  await run('type_with_delay',       () => page.type('#password-input', 'p4ssw0rd', { delay: 30 }));
  await run('fill_textarea',         () => page.fill('#textarea', 'Playwright was here\nSecond line'));
  await run('fill_number',           () => page.fill('#number-input', '77'));
  await run('fill_email',            () => page.fill('#email-input', 'test@playwright.dev'));
  await run('press_tab',             () => page.press('#text-input', 'Tab'));
  await run('press_enter',           () => page.press('#form-input', 'Enter'));
  await run('press_backspace',       () => page.press('#text-input', 'Backspace'));
  await run('press_arrow_down',      () => page.press('#select', 'ArrowDown'));
  await run('press_escape',          () => page.keyboard.press('Escape'));
  await run('keyboard_down_shift',   async () => {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
  });
  await run('keyboard_ctrl_a',       async () => {
    await page.click('#text-input');
    await page.keyboard.press('Control+A');
  });
  await run('keyboard_ctrl_c',       async () => { await page.keyboard.press('Control+C'); });
  await run('keyboard_ctrl_v',       async () => { await page.keyboard.press('Control+V'); });
  await run('keyboard_type_string',  () => page.keyboard.type('direct keyboard type'));

  // ── Focus / selection controls ──
  await run('focus_input',           () => page.focus('#text-input'));
  await run('check_checkbox',        () => page.check('#checkbox'));
  await run('uncheck_checkbox',      () => page.uncheck('#checkbox'));
  await run('select_option_b',       () => page.selectOption('#select', 'b'));
  await run('select_option_c',       () => page.selectOption('#select', 'c'));
  await run('fill_range',            () => page.fill('#range', '75'));
  await run('fill_date',             () => page.fill('#date-input', '2025-06-15'));
  await run('fill_color',            () => page.fill('#color-input', '#3fb950'));
  await run('tap_button',            () => page.tap('#btn-click').catch(() => {}));

  // ── Drag & drop ──
  await run('drag_and_drop',         () => page.dragAndDrop('#drag-source', '#drop-target'));

  // ── Contenteditable ──
  await run('click_editable',        () => page.click('#editable'));
  await run('type_editable',         () => page.type('#editable', ' PW-typed'));
  await run('select_all_editable',   async () => {
    await page.click('#editable');
    await page.keyboard.press('Control+A');
  });

  // ── Scroll ──
  await run('scroll_page_down',      () => page.evaluate(() => window.scrollTo(0, 300)));
  await run('scroll_page_up',        () => page.evaluate(() => window.scrollTo(0, 0)));
  await run('scroll_element',        () => page.locator('#scroll-area').evaluate(el => { el.scrollTop = 150; }));
  await run('scroll_into_view',      () => page.locator('#canvas').scrollIntoViewIfNeeded());

  // ── JS evaluation ──
  await run('evaluate_read_title',   () => page.title());
  await run('evaluate_get_url',      () => page.url());
  await run('evaluate_script',       () => page.evaluate(() => document.body.getBoundingClientRect()));
  await run('evaluate_dom_change',   () => page.evaluate(() => {
    document.getElementById('status').textContent = 'Modified by Playwright evaluate()';
  }));
  await run('add_script_tag',        () => page.addScriptTag({ content: 'window.cheq_pw_injected = true;' }));
  await run('dispatch_custom_event', () => page.dispatchEvent('#btn-click', 'mouseover'));
  await run('get_attribute',         () => page.getAttribute('#btn-click', 'id'));
  await run('get_inner_text',        () => page.innerText('#btn-click'));
  await run('get_inner_html',        () => page.innerHTML('#status'));
  await run('get_page_html',         () => page.content());
  await run('wait_for_selector',     () => page.waitForSelector('#btn-click', { timeout: 2000 }));
  await run('query_selector',        () => page.locator('#text-input').elementHandle());

  // ── Browser / context ──
  await run('set_cookie',            () => page.context().addCookies([{
    name: 'pw_test', value: 'intercepted', url: INTERCEPTOR_URL
  }]));
  await run('get_cookies',           () => page.context().cookies());
  await run('clear_cookies',         () => page.context().clearCookies());
  await run('set_extra_headers',     () => page.setExtraHTTPHeaders({ 'x-pw-test': '1' }));
  await run('set_viewport',          () => page.setViewportSize({ width: 1024, height: 768 }));
  await run('emulate_media',         () => page.emulateMedia({ media: 'screen' }));
  await run('accessibility_snapshot', () => page.accessibility.snapshot().catch(() => null));
  await run('screenshot',            () => page.screenshot({ path: path.join(CACHE_DIR, 'intercept_pw.png') }).catch(() => {}));
  await run('expose_function',       () => page.exposeFunction('cheq_pwTest', () => 'pw').catch(() => {}));
  await run('file_upload',           () => page.setInputFiles('#file-input', {
    name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('interception test'),
  }).catch(() => {}));
  await run('local_storage_set',     () => page.evaluate(() => localStorage.setItem('pw_key', 'pw_val')));
  await run('local_storage_get',     () => page.evaluate(() => localStorage.getItem('pw_key')));
  await run('session_storage_set',   () => page.evaluate(() => sessionStorage.setItem('pw_sk', 'pw_sv')));
  await run('canvas_draw',           () => page.evaluate(() => {
    const c = document.getElementById('canvas');
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1f6feb';
    ctx.fillRect(0, 0, 100, 40);
    ctx.fillStyle = '#3fb950';
    ctx.font = '14px sans-serif';
    ctx.fillText('Playwright', 10, 28);
  }));

  // ── State checks (use InjectedScript internally) ──
  await run('is_visible',            () => page.isVisible('#btn-click'));
  await run('is_hidden',             () => page.isHidden('#btn-disabled'));
  await run('is_enabled',            () => page.isEnabled('#btn-click'));
  await run('is_editable',           () => page.isEditable('#text-input'));
  await run('is_checked',            () => page.isChecked('#checkbox').catch(() => false));
  await run('set_checked_true',      () => page.setChecked('#checkbox', true).catch(() => {}));
  await run('set_checked_false',     () => page.setChecked('#checkbox', false).catch(() => {}));

  // ── Content getters ──
  await run('text_content',          () => page.textContent('#btn-click'));
  await run('input_value',           () => page.inputValue('#text-input'));

  // ── Style tag injection ──
  await run('add_style_tag',         () => page.addStyleTag({ content: 'body { outline: 1px solid #f0883e; }' }));

  // ── Locator API (different internal path than page.*) ──
  await run('locator_click',         () => page.locator('#btn-click').click());
  await run('locator_fill',          () => page.locator('#text-input').fill('locator-fill'));
  await run('locator_type',          () => page.locator('#text-input').type('loc-type', { delay: 20 }));
  await run('locator_press',         () => page.locator('#text-input').press('End'));
  await run('locator_check',         () => page.locator('#checkbox').check().catch(() => {}));
  await run('locator_uncheck',       () => page.locator('#checkbox').uncheck().catch(() => {}));
  await run('locator_select_option', () => page.locator('#select').selectOption('c'));
  await run('locator_hover',         () => page.locator('#hover-target').hover());
  await run('locator_focus',         () => page.locator('#text-input').focus());
  await run('locator_blur',          () => page.locator('#text-input').blur().catch(() => {}));
  await run('locator_tap',           () => page.locator('#btn-click').tap().catch(() => {}));
  await run('locator_dispatch',      () => page.locator('#btn-click').dispatchEvent('mouseover'));
  await run('locator_evaluate',      () => page.locator('#btn-click').evaluate(el => el.getBoundingClientRect()));
  await run('locator_eval_all',      () => page.locator('button').evaluateAll(els => els.map(e => e.id)));
  await run('locator_text_content',  () => page.locator('#btn-click').textContent());
  await run('locator_inner_text',    () => page.locator('#btn-click').innerText());
  await run('locator_inner_html',    () => page.locator('#status').innerHTML());
  await run('locator_input_value',   () => page.locator('#text-input').inputValue());
  await run('locator_all_text',      () => page.locator('button').allTextContents());
  await run('locator_all_values',    () => page.locator('option').allInnerTexts());
  await run('locator_count',         () => page.locator('button').count());
  await run('locator_is_visible',    () => page.locator('#btn-click').isVisible());
  await run('locator_is_hidden',     () => page.locator('#btn-disabled').isHidden());
  await run('locator_is_enabled',    () => page.locator('#btn-click').isEnabled());
  await run('locator_is_editable',   () => page.locator('#text-input').isEditable());
  await run('locator_is_checked',    () => page.locator('#checkbox').isChecked().catch(() => false));
  await run('locator_bounding_box',  () => page.locator('#btn-click').boundingBox());
  await run('locator_scroll_into_view', () => page.locator('#canvas').scrollIntoViewIfNeeded());
  await run('locator_wait_for',      () => page.locator('#btn-click').waitFor({ state: 'visible', timeout: 2000 }));
  await run('locator_screenshot',    () => page.locator('#canvas').screenshot().catch(() => {}));
  await run('locator_get_attribute', () => page.locator('#btn-click').getAttribute('id'));
  await run('locator_nth',           () => page.locator('button').nth(0).textContent());
  await run('locator_first',         () => page.locator('button').first().textContent());
  await run('locator_last',          () => page.locator('button').last().textContent());

  // ── Role / text / placeholder locators ──
  await run('get_by_role',           () => page.getByRole('button', { name: 'Click Me' }).click().catch(() => {}));
  await run('get_by_text',           () => page.getByText('Click Me').first().textContent().catch(() => {}));
  await run('get_by_placeholder',    () => page.getByPlaceholder('type here').fill('placeholder-fill').catch(() => {}));
  await run('get_by_label',          () => page.getByLabel('Checkbox').click().catch(() => {}));

  // ── eval_on_selector (deprecated but present in Python API) ──
  await run('eval_on_selector',      () => page.evalOnSelector('#btn-click', el => el.textContent).catch(() => {}));
  await run('eval_on_selector_all',  () => page.evalOnSelectorAll('button', els => els.length).catch(() => {}));
  await run('query_selector_all',    () => page.locator('button').all());

  // ── Wait for function / network / load ──
  await run('wait_for_function',     () => page.waitForFunction(() => typeof window.cheq_getBuffer === 'function', { timeout: 2000 }));
  await run('wait_for_load_state',   () => page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {}));

  // ── keyboard.insertText (no key events, just inserts) ──
  await run('keyboard_insert_text',  async () => {
    await page.locator('#text-input').focus();
    await page.keyboard.insertText('inserted-text');
  });

  // ── Frame access ──
  await run('main_frame_eval',       () => page.mainFrame().evaluate(() => document.title));

  // ── Context extra features ──
  await run('context_storage_state', () => page.context().storageState().catch(() => {}));
  await run('emulate_media_print',   () => page.emulateMedia({ media: 'print' }));
  await run('emulate_color_scheme',  () => page.emulateMedia({ colorScheme: 'dark' }));
}

// ── Puppeteer actions ─────────────────────────────────────────────────────────

async function runPuppeteerActions(page, sessionId) {
  const run = (name, fn) => runActionPw(page, sessionId, name, fn);

  await drainPw(page, sessionId);

  await run('mouse_move',          () => page.mouse.move(200, 200));
  await run('mouse_click_coords',  () => page.mouse.click(200, 200));
  await run('mouse_dblclick',      () => page.mouse.click(200, 200, { clickCount: 2 }));
  await run('mouse_down_up',       async () => { await page.mouse.down(); await page.mouse.up(); });
  await run('mouse_wheel',         () => page.mouse.wheel({ deltaX: 0, deltaY: 150 }));
  await run('hover_element',       () => page.hover('#hover-target'));
  await run('click_button',        () => page.click('#btn-click'));
  await run('dblclick_button',     () => page.click('#btn-dblclick', { clickCount: 2 }));
  await run('right_click',         () => page.click('#btn-context', { button: 'right' }));
  await run('click_link',          () => page.click('#link'));
  await run('click_checkbox',      () => page.click('#checkbox'));
  await run('click_radio',         () => page.click('#radio-a'));
  await run('type_text',           () => page.type('#text-input', 'Hello from Puppeteer!', { delay: 30 }));
  await run('type_password',       () => page.type('#password-input', 'pptr_secret', { delay: 30 }));
  await run('type_textarea',       () => page.type('#textarea', 'Puppeteer text'));
  await run('press_tab',           () => page.keyboard.press('Tab'));
  await run('press_enter',         () => page.keyboard.press('Enter'));
  await run('press_backspace',     () => page.keyboard.press('Backspace'));
  await run('press_escape',        () => page.keyboard.press('Escape'));
  await run('key_down_shift',      async () => {
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
  });
  await run('ctrl_a',              async () => {
    await page.focus('#text-input');
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
  });
  await run('keyboard_type',       () => page.keyboard.type('pptr direct'));
  await run('focus_input',         () => page.focus('#text-input'));
  await run('select_dropdown',     () => page.select('#select', 'b'));
  await run('tap_button',          () => page.tap('#btn-click').catch(() => {}));
  await run('drag_and_drop',       async () => {
    const src = await page.$('#drag-source');
    const dst = await page.$('#drop-target');
    if (src && dst) {
      const srcBox = await src.boundingBox();
      const dstBox = await dst.boundingBox();
      if (srcBox && dstBox) {
        await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
        await page.mouse.down();
        await page.mouse.move(dstBox.x + dstBox.width / 2, dstBox.y + dstBox.height / 2, { steps: 10 });
        await page.mouse.up();
      }
    }
  });
  await run('scroll_page',         () => page.evaluate(() => window.scrollTo(0, 300)));
  await run('scroll_element',      () => page.$eval('#scroll-area', el => { el.scrollTop = 150; }));
  await run('evaluate_script',     () => page.evaluate(() => document.title));
  await run('evaluate_dom_change', () => page.evaluate(() => {
    document.getElementById('status').textContent = 'Modified by Puppeteer evaluate()';
  }));
  await run('set_extra_headers',   () => page.setExtraHTTPHeaders({ 'x-pptr-test': '1' }));
  await run('set_cookie',          () => page.setCookie({ name: 'pptr_test', value: '1', url: INTERCEPTOR_URL }));
  await run('get_cookies',         () => page.cookies());
  await run('delete_cookies',      () => page.deleteCookie({ name: 'pptr_test', url: INTERCEPTOR_URL }));
  await run('get_title',           () => page.title());
  await run('get_url',             () => page.url());
  await run('get_attribute',       () => page.$eval('#btn-click', el => el.getAttribute('id')));
  await run('get_text_content',    () => page.$eval('#btn-click', el => el.textContent));
  await run('get_page_html',       () => page.content());
  await run('screenshot',          () => page.screenshot({ path: path.join(CACHE_DIR, 'intercept_pptr.png') }).catch(() => {}));
  await run('expose_function',     () => page.exposeFunction('cheq_pptrTest', () => 'pptr').catch(() => {}));
  await run('file_upload',         async () => {
    const el = await page.$('#file-input');
    if (el) await el.uploadFile(path.join(__dirname, 'package.json')).catch(() => {});
  });
  await run('local_storage',       () => page.evaluate(() => { localStorage.setItem('pptr_k', 'pptr_v'); return localStorage.getItem('pptr_k'); }));
  await run('canvas_draw',         () => page.evaluate(() => {
    const ctx = document.getElementById('canvas').getContext('2d');
    ctx.fillStyle = '#f0883e';
    ctx.fillRect(0, 0, 200, 80);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText('Puppeteer', 60, 48);
  }));

  // ── Full Python Pyppeteer API coverage ──
  await run('add_style_tag',        () => page.addStyleTag({ content: 'body { outline: 2px solid blue; }' }));
  await run('wait_for_function',    () => page.waitForFunction(() => typeof window.cheq_getBuffer === 'function', { timeout: 2000 }));
  await run('eval_single',          () => page.$eval('#btn-click', el => el.getBoundingClientRect()));
  await run('eval_all',             () => page.$$eval('button', els => els.map(e => e.textContent)));
  await run('evaluate_handle',      async () => {
    const handle = await page.evaluateHandle(() => document.querySelector('#btn-click'));
    const prop   = await handle.getProperty('id');
    const val    = await prop.jsonValue();
    await handle.dispose();
    return val;
  });
  await run('evaluate_handle_doc',  async () => {
    const doc  = await page.evaluateHandle('document');
    const body = await doc.getProperty('body');
    const tag  = await page.evaluate(el => el.tagName, body);
    await doc.dispose();
    return tag;
  });
  await run('query_selector_all',   async () => { const els = await page.$$('button'); return els.length; });
  await run('set_user_agent',       () => page.setUserAgent('Mozilla/5.0 (PuppeteerTest/1.0)'));
  await run('set_cache_enabled',    () => page.setCacheEnabled(false));
  await run('set_javascript_enabled', () => page.setJavaScriptEnabled(true));
  await run('emulate_media_print',  () => page.emulateMediaType('print'));
  await run('emulate_media_screen', () => page.emulateMediaType('screen'));
  await run('wait_for_selector',    () => page.waitForSelector('#btn-click', { timeout: 2000 }));
  await run('element_bounding_box', async () => { const el = await page.$('#btn-click'); return el && el.boundingBox(); });
  await run('element_is_intersecting_viewport', async () => {
    const el = await page.$('#btn-click');
    return el && el.isIntersectingViewport().catch(() => null);
  });
  await run('element_evaluate',     async () => {
    const el = await page.$('#btn-click');
    return el && el.evaluate(n => n.textContent);
  });
  await run('element_click',        async () => { const el = await page.$('#btn-click'); if (el) await el.click(); });
  await run('element_type',         async () => { const el = await page.$('#text-input'); if (el) await el.type('pptr-el-type', { delay: 20 }); });
  await run('element_focus',        async () => { const el = await page.$('#text-input'); if (el) await el.focus(); });
  await run('element_tap',          async () => { const el = await page.$('#btn-click'); if (el) await el.tap().catch(() => {}); });
  await run('element_screenshot',   async () => { const el = await page.$('#canvas'); if (el) await el.screenshot().catch(() => {}); });
}

// ── Selenium actions ──────────────────────────────────────────────────────────

async function runSeleniumActions(driver, sessionId) {
  const run = (name, fn) => runActionSel(driver, sessionId, name, fn);

  await drainSel(driver, sessionId);

  const { Actions } = require('selenium-webdriver');

  async function el(id)  { return driver.findElement(By.id(id)); }
  async function elCss(s){ return driver.findElement(By.css(s)); }

  await run('find_by_id',           () => el('btn-click'));
  await run('find_by_css',          () => elCss('#btn-click'));
  await run('find_by_xpath',        () => driver.findElement(By.xpath('//*[@id="btn-click"]')));
  await run('find_all_buttons',     () => driver.findElements(By.css('button')));

  await run('click_button',         async () => (await el('btn-click')).click());
  await run('click_link',           async () => (await el('link')).click());
  await run('click_checkbox',       async () => (await el('checkbox')).click());
  await run('click_radio',          async () => (await el('radio-a')).click());

  await run('send_keys_text',       async () => {
    const inp = await el('text-input'); await inp.clear(); await inp.sendKeys('Hello from Selenium!');
  });
  await run('send_keys_password',   async () => {
    const inp = await el('password-input'); await inp.sendKeys('sel_secret');
  });
  await run('send_keys_textarea',   async () => {
    const ta = await el('textarea'); await ta.clear(); await ta.sendKeys('Selenium text');
  });
  await run('send_key_tab',         async () => (await el('text-input')).sendKeys(Key.TAB));
  await run('send_key_enter',       async () => (await el('form-input')).sendKeys(Key.RETURN));
  await run('send_key_backspace',   async () => (await el('text-input')).sendKeys(Key.BACK_SPACE));
  await run('send_key_escape',      async () => (await el('text-input')).sendKeys(Key.ESCAPE));
  await run('send_key_arrows',      async () => {
    const inp = await el('text-input');
    await inp.sendKeys(Key.ARROW_LEFT, Key.ARROW_RIGHT, Key.ARROW_UP, Key.ARROW_DOWN);
  });
  await run('send_key_ctrl_a',      async () => {
    const inp = await el('text-input');
    await inp.sendKeys(Key.chord(Key.CONTROL, 'a'));
  });
  await run('send_key_home_end',    async () => {
    const inp = await el('text-input');
    await inp.sendKeys(Key.HOME, Key.END);
  });
  await run('send_key_delete',      async () => (await el('text-input')).sendKeys(Key.DELETE));
  await run('send_key_page_down',   async () => (await el('text-input')).sendKeys(Key.PAGE_DOWN));
  await run('clear_input',          async () => (await el('text-input')).clear());

  const actions = driver.actions({ async: true });
  await run('action_move_to_elem',  async () => {
    const btn = await el('btn-click'); await actions.move({ origin: btn }).perform();
  });
  await run('action_click',         async () => {
    const btn = await el('btn-click'); await actions.click(btn).perform();
  });
  await run('action_dblclick',      async () => {
    const btn = await el('btn-dblclick'); await actions.doubleClick(btn).perform();
  });
  await run('action_right_click',   async () => {
    const btn = await el('btn-context'); await actions.contextClick(btn).perform();
  });
  await run('action_key_down_up',   async () => {
    await actions.keyDown(Key.SHIFT).keyUp(Key.SHIFT).perform();
  });
  await run('action_drag_drop',     async () => {
    const src = await el('drag-source');
    const dst = await el('drop-target');
    await actions.dragAndDrop(src, dst).perform();
  });
  await run('action_scroll',        async () => {
    const area = await el('scroll-area');
    await actions.scroll(0, 0, 0, 150, area).perform();
  });
  await run('action_move_coords',   async () => {
    await actions.move({ x: 200, y: 200 }).perform();
  });
  await run('action_click_and_hold', async () => {
    const btn = await el('btn-click');
    await actions.move({ origin: btn }).press().release().perform();
  });
  await run('action_send_keys',     async () => {
    const inp = await el('text-input');
    await actions.click(inp).sendKeys('selenium-actions-text').perform();
  });

  await run('get_attribute',        async () => (await el('btn-click')).getAttribute('id'));
  await run('get_text',             async () => (await el('btn-click')).getText());
  await run('is_displayed',         async () => (await el('btn-click')).isDisplayed());
  await run('is_enabled',           async () => (await el('btn-click')).isEnabled());
  await run('is_selected',          async () => (await el('checkbox')).isSelected());
  await run('get_tag_name',         async () => (await el('btn-click')).getTagName());
  await run('get_css_value',        async () => (await el('btn-click')).getCssValue('background-color'));
  await run('get_rect',             async () => (await el('btn-click')).getRect());
  await run('get_dom_property',     async () => driver.executeScript('return arguments[0].id', await el('btn-click')));

  await run('execute_script',       () => driver.executeScript('return document.title'));
  await run('execute_script_dom',   () => driver.executeScript(() => {
    document.getElementById('status').textContent = 'Modified by Selenium executeScript()';
  }));
  await run('execute_script_args',  async () => {
    const inp = await el('text-input');
    await driver.executeScript('arguments[0].value = arguments[1]', inp, 'sel-script-value');
  });
  await run('execute_async_script', () => driver.executeAsyncScript(
    'var cb = arguments[arguments.length-1]; setTimeout(() => cb("done"), 50);'
  ));

  await run('add_cookie',           () => driver.manage().addCookie({ name: 'sel_test', value: 'sel_val' }));
  await run('get_cookies',          () => driver.manage().getCookies());
  await run('get_cookie_named',     () => driver.manage().getCookie('sel_test').catch(() => null));
  await run('delete_cookie',        () => driver.manage().deleteCookie('sel_test'));
  await run('delete_all_cookies',   () => driver.manage().deleteAllCookies());

  await run('get_title',            () => driver.getTitle());
  await run('get_current_url',      () => driver.getCurrentUrl());
  await run('get_page_source',      () => driver.getPageSource());
  await run('screenshot',           () => driver.takeScreenshot());
  await run('window_set_size',      () => driver.manage().window().setSize(1280, 720));
  await run('window_get_rect',      () => driver.manage().window().getRect());
  await run('window_maximize',      () => driver.manage().window().maximize().catch(() => {}));

  await run('scroll_to_element',    async () => {
    const canvas = await el('canvas');
    await driver.executeScript('arguments[0].scrollIntoView()', canvas);
  });
  await run('scroll_by_js',         () => driver.executeScript('window.scrollTo(0, 400)'));
  await run('local_storage_js',     () => driver.executeScript(
    "localStorage.setItem('sel_k','sel_v'); return localStorage.getItem('sel_k');"
  ));
  await run('canvas_draw_js',       () => driver.executeScript(() => {
    const ctx = document.getElementById('canvas').getContext('2d');
    ctx.fillStyle = '#238636';
    ctx.fillRect(0, 0, 200, 80);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText('Selenium', 60, 48);
  }));
  await run('wait_for_element',     () => driver.wait(until.elementLocated(By.id('btn-click')), 3000));
  await run('wait_visible',         async () => driver.wait(until.elementIsVisible(await el('btn-click')), 3000));
  await run('find_shadow_elements', () => driver.findElements(By.css('input')));

  // ── Full Python Selenium API coverage ──
  await run('find_by_name',         () => driver.findElement(By.name('q')).catch(() => null));
  await run('find_by_class',        () => driver.findElement(By.className('section')).catch(() => null));
  await run('find_by_tag',          () => driver.findElement(By.tagName('button')));
  await run('find_by_partial_link', () => driver.findElement(By.partialLinkText('Anchor')).catch(() => null));
  await run('find_all_by_tag',      () => driver.findElements(By.tagName('input')));
  await run('find_all_by_class',    () => driver.findElements(By.className('section')));

  await run('get_dom_attribute',    async () => (await el('text-input')).getDomAttribute('placeholder').catch(() => null));
  await run('get_property',         async () => driver.executeScript('return arguments[0].value', await el('text-input')));
  await run('element_submit',       async () => (await el('form-submit')).click()); // click submit btn — fires event, e.preventDefault() keeps us on page

  await run('action_move_by_offset', async () => { await actions.move({ x: 100, y: 150 }).perform(); });
  await run('action_drag_by_offset', async () => {
    const src = await el('drag-source');
    await actions.dragAndDropBy(src, 80, 0).perform();
  });
  await run('action_pause',          async () => { await actions.pause(50).perform(); });
  await run('action_key_chord',      async () => {
    const inp = await el('text-input');
    await actions.click(inp).keyDown(Key.SHIFT).sendKeys('hello').keyUp(Key.SHIFT).perform();
  });
  await run('action_release',        async () => { await actions.clear().perform().catch(() => {}); });

  await run('wait_elem_enabled',     async () => driver.wait(until.elementIsEnabled(await el('btn-click')), 3000));
  await run('wait_elem_selected',    async () => driver.wait(until.elementIsNotSelected(await el('checkbox')), 3000).catch(() => {}));
  await run('wait_title_contains',   () => driver.wait(until.titleContains('Interception'), 3000).catch(() => {}));
  await run('wait_url_contains',     () => driver.wait(until.urlContains('localhost'), 3000).catch(() => {}));

  await run('get_all_windows',       () => driver.getAllWindowHandles());
  await run('get_current_window',    () => driver.getWindowHandle());
  await run('scroll_smooth',         async () => {
    const canvas = await el('canvas');
    await driver.executeScript('arguments[0].scrollIntoView({ behavior: "smooth", block: "center" })', canvas);
  });
  await run('element_location',      async () => driver.executeScript(
    'const r = arguments[0].getBoundingClientRect(); return { x: r.x, y: r.y }', await el('btn-click')
  ));
  await run('get_browser_logs',      () => driver.manage().logs().get('browser').catch(() => []));
  await run('manage_timeouts_get',   () => driver.manage().getTimeouts().catch(() => {}));
  await run('manage_timeouts_set',   () => driver.manage().setTimeouts({ implicit: 0, pageLoad: 10000 }).catch(() => {}));
  await run('get_capabilities',      () => driver.getCapabilities().catch(() => {}));
}

// ── WebdriverIO actions ───────────────────────────────────────────────────────

async function runWebdriverIOActions(wdio, sessionId) {
  const run = (name, fn) => runActionWdio(wdio, sessionId, name, fn);

  await drainWdio(wdio, sessionId);

  await run('find_by_id',          () => wdio.$('#btn-click'));
  await run('find_by_css',         () => wdio.$('button'));
  await run('find_by_xpath',       () => wdio.$('//*[@id="btn-click"]'));
  await run('find_all',            () => wdio.$$('button'));

  await run('click_button',        async () => (await wdio.$('#btn-click')).click());
  await run('dblclick_button',     async () => (await wdio.$('#btn-dblclick')).doubleClick());
  await run('right_click',         async () => (await wdio.$('#btn-context')).click({ button: 'right' }));
  await run('click_link',          async () => (await wdio.$('#link')).click());
  await run('click_checkbox',      async () => (await wdio.$('#checkbox')).click());
  await run('click_radio',         async () => (await wdio.$('#radio-a')).click());

  await run('set_value_text',      async () => (await wdio.$('#text-input')).setValue('Hello from WebdriverIO!'));
  await run('set_value_password',  async () => (await wdio.$('#password-input')).setValue('wdio_secret'));
  await run('add_value',           async () => (await wdio.$('#text-input')).addValue(' extra'));
  await run('clear_value',         async () => (await wdio.$('#text-input')).clearValue());
  await run('set_value_textarea',  async () => (await wdio.$('#textarea')).setValue('WebdriverIO text'));
  await run('select_by_value',     async () => (await wdio.$('#select')).selectByAttribute('value', 'b'));
  await run('select_by_text',      async () => (await wdio.$('#select')).selectByVisibleText('Option C'));

  await run('keys_tab',            () => wdio.keys(['Tab']));
  await run('keys_enter',          () => wdio.keys(['Enter']));
  await run('keys_backspace',      () => wdio.keys(['Backspace']));
  await run('keys_escape',         () => wdio.keys(['Escape']));
  await run('keys_arrow_down',     () => wdio.keys(['ArrowDown']));
  await run('keys_ctrl_a',         () => wdio.keys(['Control', 'a']));

  await run('action_pointer_move', () => wdio.action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ x: 200, y: 200 }).perform());
  await run('action_pointer_click', () => wdio.action('pointer', { parameters: { pointerType: 'mouse' } })
    .move({ x: 200, y: 200 }).down().up().perform());
  await run('action_key_tab',      () => wdio.action('key').down('\uE004').up('\uE004').perform());
  await run('action_key_enter',    () => wdio.action('key').down('\uE007').up('\uE007').perform());
  await run('action_key_escape',   () => wdio.action('key').down('\uE00C').up('\uE00C').perform());

  await run('move_to_element',     async () => (await wdio.$('#hover-target')).moveTo());
  await run('scroll_into_view',    async () => (await wdio.$('#canvas')).scrollIntoView());
  await run('drag_and_drop',       async () => {
    const src = await wdio.$('#drag-source');
    const dst = await wdio.$('#drop-target');
    await wdio.dragAndDrop(src, dst);
  });

  await run('execute_script',      () => wdio.execute(() => document.title));
  await run('execute_dom_change',  () => wdio.execute(() => {
    document.getElementById('status').textContent = 'Modified by WebdriverIO execute()';
  }));
  await run('execute_async',       () => wdio.executeAsync((done) => setTimeout(() => done('wdio'), 50)));
  await run('execute_with_args',   async () => {
    const el = await wdio.$('#text-input');
    await wdio.execute((e, v) => { e.value = v; }, el, 'wdio-script-val');
  });

  await run('get_attribute',       async () => (await wdio.$('#btn-click')).getAttribute('id'));
  await run('get_text',            async () => (await wdio.$('#btn-click')).getText());
  await run('is_displayed',        async () => (await wdio.$('#btn-click')).isDisplayed());
  await run('is_enabled',          async () => (await wdio.$('#btn-click')).isEnabled());
  await run('is_selected',         async () => (await wdio.$('#checkbox')).isSelected());
  await run('get_tag_name',        async () => (await wdio.$('#btn-click')).getTagName());
  await run('get_css_property',    async () => (await wdio.$('#btn-click')).getCSSProperty('background-color'));
  await run('get_size',            async () => (await wdio.$('#btn-click')).getSize());
  await run('get_location',        async () => (await wdio.$('#btn-click')).getLocation());

  await run('set_cookies',         () => wdio.setCookies([{ name: 'wdio_test', value: 'wdio_val' }]));
  await run('get_cookies',         () => wdio.getCookies());
  await run('delete_all_cookies',  () => wdio.deleteAllCookies());

  await run('get_title',           () => wdio.getTitle());
  await run('get_url',             () => wdio.getUrl());
  await run('get_page_source',     () => wdio.getPageSource());
  await run('save_screenshot',     () => wdio.saveScreenshot(path.join(CACHE_DIR, 'intercept_wdio.png')).catch(() => {}));
  await run('set_window_size',     () => wdio.setWindowSize(1280, 720));
  await run('get_window_size',     () => wdio.getWindowSize());

  await run('pause',               () => wdio.pause(100));
  await run('scroll_by_js',        () => wdio.execute(() => window.scrollTo(0, 300)));
  await run('local_storage',       () => wdio.execute(() => {
    localStorage.setItem('wdio_k', 'wdio_v'); return localStorage.getItem('wdio_k');
  }));
  await run('canvas_draw',         () => wdio.execute(() => {
    const ctx = document.getElementById('canvas').getContext('2d');
    ctx.fillStyle = '#8b949e';
    ctx.fillRect(0, 0, 200, 80);
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText('WebdriverIO', 40, 48);
  }));
  await run('file_upload',         async () => {
    const el = await wdio.$('#file-input');
    await el.setValue(path.join(__dirname, 'package.json')).catch(() => {});
  });
  await run('wait_for_displayed',  async () => (await wdio.$('#btn-click')).waitForDisplayed({ timeout: 3000 }));
  await run('wait_for_enabled',    async () => (await wdio.$('#btn-click')).waitForEnabled({ timeout: 3000 }));

  // ── Full WebdriverIO API coverage ──
  await run('get_value',            async () => (await wdio.$('#text-input')).getValue());
  await run('get_html',             async () => (await wdio.$('#btn-click')).getHTML());
  await run('get_computed_label',   async () => (await wdio.$('#btn-click')).getComputedLabel().catch(() => null));
  await run('get_computed_role',    async () => (await wdio.$('#btn-click')).getComputedRole().catch(() => null));
  await run('is_focused',           async () => (await wdio.$('#text-input')).isFocused());
  await run('is_clickable',         async () => (await wdio.$('#btn-click')).isClickable());
  await run('is_existing',          async () => (await wdio.$('#btn-click')).isExisting());
  await run('click_with_offset',    async () => (await wdio.$('#btn-click')).click({ x: 3, y: 3 }));
  await run('click_with_modifiers', async () => (await wdio.$('#checkbox')).click({ button: 'left', ctrlKey: false }));

  await run('select_by_index',      async () => (await wdio.$('#select')).selectByIndex(0));
  await run('element_send_keys',    async () => (await wdio.$('#text-input')).keys(['w', 'd', 'i', 'o']));

  await run('shadow_dom',           async () => { try { return (await wdio.$('#btn-click').shadow$('*')).isExisting(); } catch { return null; } });

  await run('get_window_handles',   () => wdio.getWindowHandles());
  await run('get_current_handle',   () => wdio.getWindowHandle());
  await run('get_active_element',   () => wdio.getActiveElement().catch(() => null));
  await run('get_focus',            () => wdio.execute(() => document.activeElement && document.activeElement.id));

  await run('wait_for_exist',       async () => (await wdio.$('#btn-click')).waitForExist({ timeout: 3000 }));
  await run('wait_for_clickable',   async () => (await wdio.$('#btn-click')).waitForClickable({ timeout: 3000 }));
  await run('wait_until',           () => wdio.waitUntil(async () => {
    const el = await wdio.$('#btn-click');
    return (await el.isDisplayed()) === true;
  }, { timeout: 3000 }).catch(() => {}));

  await run('react_selector',       async () => wdio.react$('button').catch(() => null));
  await run('custom_command',       () => wdio.execute(() => ({
    ua: navigator.userAgent, lang: navigator.language, platform: navigator.platform
  })));
  await run('browser_action_touch', () => wdio.action('pointer', { parameters: { pointerType: 'touch' } })
    .move({ x: 200, y: 200 }).down().up().perform().catch(() => {}));
  await run('mock_intercept',       () => wdio.mock('**/*').catch(() => null));
}

// ── Per-framework runners ─────────────────────────────────────────────────────

async function runPlaywright(label, engine, launchOpts, headless) {
  const mode  = headless ? 'headless' : 'headfull';
  const blabel = `playwright-${label}-${mode}`;
  const sessionId = createInterceptionSession('playwright', blabel);
  let browser = null;
  console.log(`\n[playwright] ${blabel}`);
  try {
    browser = await engine.launch({ ...launchOpts, headless });
    const page = await browser.newPage();
    await page.goto(INTERCEPTOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    if (!await waitReadyPw(page)) { console.error('  ERROR: page not ready — browser may have crashed on load'); return; }
    await runPlaywrightActions(page, sessionId);
  } catch (err) {
    if (err.message !== 'BROWSER_DEAD') console.error(`  ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    finalizeInterceptionSession(sessionId);
  }
}

async function runPuppeteer(major, executablePath, headless) {
  const mode   = headless ? 'headless' : 'headfull';
  const blabel = `puppeteer-chrome-${major}-${mode}`;
  const sessionId = createInterceptionSession('puppeteer', blabel);
  let browser = null;
  console.log(`\n[puppeteer] ${blabel}`);
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless,
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.goto(INTERCEPTOR_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    if (!await waitReadyPw(page)) { console.error('  ERROR: page not ready — browser may have crashed on load'); return; }
    await runPuppeteerActions(page, sessionId);
  } catch (err) {
    if (err.message !== 'BROWSER_DEAD') console.error(`  ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    finalizeInterceptionSession(sessionId);
  }
}

async function runSelenium(major, chromePath, driverPath, headless) {
  const mode   = headless ? 'headless' : 'headfull';
  const blabel = `selenium-chrome-${major}-${mode}`;
  const sessionId = createInterceptionSession('selenium', blabel);
  let driver = null;
  console.log(`\n[selenium] ${blabel}`);
  try {
    const svc  = new wdChrome.ServiceBuilder(driverPath).setPort(allocatePort());
    const opts = new wdChrome.Options();
    opts.setChromeBinaryPath(chromePath);
    opts.addArguments('--no-sandbox', '--disable-gpu');
    if (headless) opts.addArguments('--headless=new');

    driver = await new Builder()
      .forBrowser(WdBrowser.CHROME)
      .setChromeService(svc)
      .setChromeOptions(opts)
      .build();

    // Cap page-load and script timeouts so a stray navigation never hangs the session.
    await driver.manage().setTimeouts({ pageLoad: 15000, script: 10000 });

    await driver.get(INTERCEPTOR_URL);
    if (!await waitReadySel(driver)) { console.error('  ERROR: page not ready — browser may have crashed on load'); return; }
    await runSeleniumActions(driver, sessionId);
  } catch (err) {
    if (err.message !== 'BROWSER_DEAD') console.error(`  ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (driver) await driver.quit().catch(() => {});
    finalizeInterceptionSession(sessionId);
  }
}

async function runWebdriverIO(major, chromePath, driverPath, headless) {
  const mode   = headless ? 'headless' : 'headfull';
  const blabel = `webdriverio-chrome-${major}-${mode}`;
  const sessionId = createInterceptionSession('webdriverio', blabel);
  let wdioBrowser = null;
  const port = allocatePort();
  const driverProc = spawn(driverPath, [`--port=${port}`, '--silent'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  console.log(`\n[webdriverio] ${blabel}`);
  try {
    wdioBrowser = await wdioRemote({
      hostname: 'localhost',
      port,
      capabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          binary: chromePath,
          args: ['--no-sandbox', '--disable-gpu', ...(headless ? ['--headless=new'] : [])],
        },
      },
      logLevel: 'error',
    });
    await wdioBrowser.url(INTERCEPTOR_URL);
    if (!await waitReadyWdio(wdioBrowser)) { console.error('  ERROR: page not ready — browser may have crashed on load'); return; }
    await runWebdriverIOActions(wdioBrowser, sessionId);
  } catch (err) {
    if (err.message !== 'BROWSER_DEAD') console.error(`  ERROR: ${err.message.split('\n')[0]}`);
  } finally {
    if (wdioBrowser) await wdioBrowser.deleteSession().catch(() => {});
    driverProc.kill();
    await new Promise(r => setTimeout(r, 300));
    finalizeInterceptionSession(sessionId);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const server = await startInterceptorServer();

  try {
    const chromes      = await discoverChromes();
    const driverMap    = await discoverChromedrivers();
    const chromesWithDriver = chromes.filter(c => driverMap.has(c.buildId));

    // Pick one Chrome version for non-Playwright frameworks.
    // CHROME_MAJOR env var pins a specific major version (e.g. CHROME_MAJOR=131).
    const pinnedMajor = process.env.CHROME_MAJOR || null;
    let sampleChrome = null;
    if (chromesWithDriver.length > 0) {
      if (pinnedMajor) {
        sampleChrome = chromesWithDriver.find(c => c.buildId.split('.')[0] === pinnedMajor) || null;
        if (!sampleChrome) console.warn(`[setup] CHROME_MAJOR=${pinnedMajor} not found with matching driver — falling back to latest`);
      }
      if (!sampleChrome) sampleChrome = chromesWithDriver[chromesWithDriver.length - 1]; // latest
    }

    console.log(`[setup] Found ${chromes.length} Chrome(s), ${driverMap.size} ChromeDriver(s)`);
    if (sampleChrome) console.log(`[setup] Using Chrome ${sampleChrome.buildId.split('.')[0]} for Puppeteer/Selenium/WebdriverIO`);

    // FRAMEWORKS env var: comma-separated list of frameworks to run.
    // Recognised values: playwright, puppeteer, selenium, webdriverio
    // Omit (or set to empty) to run all frameworks.
    const fwFilter = process.env.FRAMEWORKS
      ? new Set(process.env.FRAMEWORKS.split(',').map(s => s.trim().toLowerCase()))
      : null;
    const want = name => !fwFilter || fwFilter.has(name);

    // ── Playwright (bundled Chromium) — headless + headfull ──
    if (want('playwright')) {
      await runPlaywright('chromium', chromium, { args: ['--no-sandbox'] }, true);
      await runPlaywright('chromium', chromium, { args: ['--no-sandbox'] }, false);
    }

    if (!want('puppeteer') && !want('selenium') && !want('webdriverio')) {
      // nothing else needed
    } else if (sampleChrome) {
      const { executablePath, buildId } = sampleChrome;
      const major = buildId.split('.')[0];
      const driverPath = driverMap.get(buildId);

      // ── Puppeteer — headless + headfull ──
      if (want('puppeteer')) {
        await runPuppeteer(major, executablePath, true);
        await runPuppeteer(major, executablePath, false);
      }

      // ── Selenium — headless + headfull ──
      if (want('selenium')) {
        await runSelenium(major, executablePath, driverPath, true);
        await runSelenium(major, executablePath, driverPath, false);
      }

      // ── WebdriverIO — headless + headfull ──
      if (want('webdriverio')) {
        await runWebdriverIO(major, executablePath, driverPath, true);
        await runWebdriverIO(major, executablePath, driverPath, false);
      }
    } else {
      console.log('[setup] No Chrome+Driver pair found — skipping Puppeteer / Selenium / WebdriverIO');
    }

    console.log('\n[done] All interception sessions complete. View at http://localhost:3000/interceptions');
  } finally {
    server.close();
  }
}

run().catch(err => { console.error('[fatal]', err); process.exit(1); });
