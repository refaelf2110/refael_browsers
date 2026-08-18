// Downloads browsers and drivers into C:\browsers so run_all.js can discover them.
// Safe to re-run — skips already-downloaded entries.
//
// Downloads:
//   Chrome for Testing  — all major versions
//   ChromeDriver        — sampled (oldest / middle / latest) for Selenium
//   Firefox             — every 10th major + last 3, for Selenium
//   GeckoDriver         — latest release, for Selenium Firefox

const { install, Browser, detectBrowserPlatform, getInstalledBrowsers } = require('@puppeteer/browsers');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

const CACHE_DIR          = 'C:\\browsers';
const FF_DIR             = path.join(CACHE_DIR, 'firefox');
const GECKO_DIR          = path.join(CACHE_DIR, 'geckodriver');
const TEMP_DIR           = 'C:\\temp\\browser-downloads';

const EDGE_CHANNELS = [
  { channel: 'stable', label: 'edge',      exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { channel: 'beta',   label: 'edge-beta', exe: 'C:\\Program Files (x86)\\Microsoft\\Edge Beta\\Application\\msedge.exe' },
  { channel: 'dev',    label: 'edge-dev',  exe: 'C:\\Program Files (x86)\\Microsoft\\Edge Dev\\Application\\msedge.exe' },
];
const PLATFORM           = detectBrowserPlatform();
const CHROME_CONCURRENCY = 5;
const FF_CONCURRENCY     = 2; // ftp.mozilla.org rate-limits aggressive parallel requests

// ── helpers ───────────────────────────────────────────────────────────────────

// Resilient replacement for @puppeteer/browsers getInstalledBrowsers().
// The library crashes if the cache contains old-format entries (e.g. numeric-only
// Firefox dirs like "86", "87"…). This falls back to a direct cache scan.
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

function compareVersions(a, b) {
  const ap = a.split('.').map(Number);
  const bp = b.split('.').map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const d = (ap[i] || 0) - (bp[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Returns [first, middle, last] as a representative sample.
function sample(arr) {
  if (arr.length === 0) return [];
  if (arr.length <= 3) return [...arr];
  return [arr[0], arr[Math.floor((arr.length - 1) / 2)], arr[arr.length - 1]];
}

// Runs up to `limit` of the given async factory functions concurrently.
async function withConcurrency(fns, limit) {
  let i = 0;
  async function worker() {
    while (i < fns.length) {
      await fns[i++]().catch(() => {});
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, fns.length) }, worker));
}

// ── Chrome for Testing ────────────────────────────────────────────────────────

async function downloadChrome() {
  console.log('\n[Chrome for Testing]');

  const resp = await fetch('https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json');
  if (!resp.ok) throw new Error(`Chrome API returned ${resp.status}`);
  const { versions } = await resp.json();

  const byMajor = new Map();
  for (const v of versions) {
    if (!v.downloads?.chrome?.some(d => d.platform === 'win64')) continue;
    const major = parseInt(v.version.split('.')[0]);
    const cur = byMajor.get(major);
    if (!cur || compareVersions(v.version, cur) > 0) byMajor.set(major, v.version);
  }

  const cached = new Set(
    (await safeGetInstalledBrowsers({ cacheDir: CACHE_DIR }))
      .filter(b => b.browser === Browser.CHROME)
      .map(b => b.buildId)
  );

  const sorted = [...byMajor.entries()].sort(([a], [b]) => a - b);
  console.log(`${sorted.length} major versions (${cached.size} cached, ${sorted.length - cached.size} to download)`);

  await withConcurrency(sorted.map(([major, buildId]) => async () => {
    if (cached.has(buildId)) {
      console.log(`  Chrome ${major} (${buildId}) — cached`);
      return;
    }
    console.log(`  Chrome ${major} (${buildId}) — downloading...`);
    try {
      await install({ browser: Browser.CHROME, buildId, cacheDir: CACHE_DIR, platform: PLATFORM });
      console.log(`  Chrome ${major} (${buildId}) — done`);
    } catch (err) {
      console.log(`  Chrome ${major} (${buildId}) — FAILED: ${err.message.split('\n')[0]}`);
    }
  }), CHROME_CONCURRENCY);
}

// Downloads ChromeDriver from the legacy Google Storage bucket (for versions < 115).
// Stores it in the same cache layout that @puppeteer/browsers expects so
// getInstalledBrowsers() picks it up automatically.
async function downloadOldChromeDriver(buildId) {
  // Store in the layout @puppeteer/browsers expects so getInstalledBrowsers() finds it.
  const zipUrl  = `https://chromedriver.storage.googleapis.com/${buildId}/chromedriver_win32.zip`;
  const destDir = path.join(CACHE_DIR, 'chromedriver', `win64-${buildId}`, 'chromedriver-win64');
  const destExe = path.join(destDir, 'chromedriver.exe');
  if (fs.existsSync(destExe)) return;
  fs.mkdirSync(destDir,  { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  const zipPath = path.join(TEMP_DIR, `chromedriver-${buildId}.zip`);
  await execAsync(`powershell -Command "Invoke-WebRequest -Uri '${zipUrl}' -OutFile '${zipPath}'"`, { timeout: 60000 });
  // Old zip extracts chromedriver.exe directly — move it into the expected subfolder.
  const tempExtract = path.join(TEMP_DIR, `chromedriver-${buildId}`);
  fs.mkdirSync(tempExtract, { recursive: true });
  await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempExtract}' -Force"`, { timeout: 30000 });
  try { fs.unlinkSync(zipPath); } catch {}
  const extracted = path.join(tempExtract, 'chromedriver.exe');
  if (!fs.existsSync(extracted)) throw new Error('chromedriver.exe missing after extraction');
  fs.renameSync(extracted, destExe);
  try { fs.rmSync(tempExtract, { recursive: true }); } catch {}
  console.log(`  ChromeDriver ${buildId} — done (legacy storage)`);
}

// ── ChromeDriver (for Selenium) ───────────────────────────────────────────────

async function downloadChromeDrivers() {
  console.log('\n[ChromeDriver for Selenium]');

  const allInstalled = await safeGetInstalledBrowsers({ cacheDir: CACHE_DIR });
  const chromes = allInstalled
    .filter(b => b.browser === Browser.CHROME)
    .sort((a, b) => a.buildId.localeCompare(b.buildId, undefined, { numeric: true }));

  if (chromes.length === 0) {
    console.log('  No Chrome versions cached, skipping.');
    return;
  }

  const existingDrivers = new Set(
    allInstalled.filter(b => b.browser === Browser.CHROMEDRIVER).map(b => b.buildId)
  );

  console.log(`${chromes.length} versions (${existingDrivers.size} cached, ${chromes.length - existingDrivers.size} to download)`);

  await withConcurrency(chromes.map(({ buildId }) => async () => {
    if (existingDrivers.has(buildId)) {
      console.log(`  ChromeDriver ${buildId} — cached`);
      return;
    }
    console.log(`  ChromeDriver ${buildId} — downloading...`);
    try {
      await install({ browser: Browser.CHROMEDRIVER, buildId, cacheDir: CACHE_DIR, platform: PLATFORM });
      console.log(`  ChromeDriver ${buildId} — done`);
    } catch (err) {
      // Fallback for old versions not in the Chrome for Testing API (pre-115)
      const major = parseInt(buildId.split('.')[0]);
      if (major < 115) {
        try {
          await downloadOldChromeDriver(buildId);
        } catch (err2) {
          console.log(`  ChromeDriver ${buildId} — FAILED (old storage): ${err2.message.split('\n')[0]}`);
        }
      } else {
        console.log(`  ChromeDriver ${buildId} — FAILED: ${err.message.split('\n')[0]}`);
      }
    }
  }), CHROME_CONCURRENCY);
}

// ── GeckoDriver (for Selenium Firefox) ───────────────────────────────────────

// Downloads multiple geckodriver versions into versioned subdirectories:
//   C:\browsers\geckodriver\v0.30.0\geckodriver.exe  — Firefox 78-90
//   C:\browsers\geckodriver\latest\geckodriver.exe   — Firefox 91+
//
// v0.30.0 is the last release before Firefox 91 became the minimum requirement.
async function downloadGeckodrivers() {
  console.log('\n[GeckoDriver for Selenium]');
  fs.mkdirSync(GECKO_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR,  { recursive: true });

  async function downloadVersion(tag) {
    const dir = path.join(GECKO_DIR, tag);
    const exe = path.join(dir, 'geckodriver.exe');
    if (fs.existsSync(exe)) { console.log(`  geckodriver ${tag} — cached`); return; }
    const resp = await fetch(`https://api.github.com/repos/mozilla/geckodriver/releases/tags/${tag}`, {
      headers: { 'User-Agent': 'playwright-browser-matrix' },
    });
    if (!resp.ok) throw new Error(`GitHub API returned ${resp.status} for ${tag}`);
    const release = await resp.json();
    const asset = release.assets.find(a => a.name.includes('win64') && a.name.endsWith('.zip'));
    if (!asset) throw new Error(`No win64 zip in geckodriver ${tag}`);
    console.log(`  Downloading GeckoDriver ${tag}...`);
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(TEMP_DIR, `geckodriver-${tag}.zip`);
    await execAsync(`powershell -Command "Invoke-WebRequest -Uri '${asset.browser_download_url}' -OutFile '${zipPath}'"`, { timeout: 120000 });
    await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${dir}' -Force"`, { timeout: 30000 });
    try { fs.unlinkSync(zipPath); } catch {}
    console.log(`  GeckoDriver ${tag} — ${fs.existsSync(exe) ? 'done' : 'FAILED (exe missing)'}`);
  }

  async function downloadLatest() {
    const dir = path.join(GECKO_DIR, 'latest');
    const exe = path.join(dir, 'geckodriver.exe');
    if (fs.existsSync(exe)) { console.log('  geckodriver latest — cached'); return; }
    const resp = await fetch('https://api.github.com/repos/mozilla/geckodriver/releases/latest', {
      headers: { 'User-Agent': 'playwright-browser-matrix' },
    });
    if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);
    const release = await resp.json();
    const asset = release.assets.find(a => a.name.includes('win64') && a.name.endsWith('.zip'));
    if (!asset) throw new Error('No win64 zip in latest GeckoDriver release');
    console.log(`  Downloading GeckoDriver ${release.tag_name} (latest)...`);
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(TEMP_DIR, 'geckodriver-latest.zip');
    await execAsync(`powershell -Command "Invoke-WebRequest -Uri '${asset.browser_download_url}' -OutFile '${zipPath}'"`, { timeout: 120000 });
    await execAsync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${dir}' -Force"`, { timeout: 30000 });
    try { fs.unlinkSync(zipPath); } catch {}
    console.log(`  GeckoDriver ${release.tag_name} (latest) — ${fs.existsSync(exe) ? 'done' : 'FAILED (exe missing)'}`);
  }

  // v0.30.0 — Firefox 78-90 (last version supporting Firefox < 91)
  await downloadVersion('v0.30.0').catch(err => console.log(`  GeckoDriver v0.30.0 — FAILED: ${err.message.split('\n')[0]}`));
  // latest — Firefox 91+
  await downloadLatest().catch(err => console.log(`  GeckoDriver latest — FAILED: ${err.message.split('\n')[0]}`));
}

// ── Firefox ───────────────────────────────────────────────────────────────────

async function downloadFirefox() {
  console.log('\n[Firefox]');
  fs.mkdirSync(FF_DIR,   { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const resp = await fetch('https://product-details.mozilla.org/1.0/firefox.json');
  if (!resp.ok) throw new Error(`Mozilla API returned ${resp.status}`);
  const { releases } = await resp.json();

  // Latest minor release per major version, stable only (no b/esr/rc), major >= 86
  const byMajor = new Map();
  for (const r of Object.values(releases)) {
    const v = r.version;
    if (/[a-zA-Z]/.test(v)) continue;
    const major = parseInt(v.split('.')[0]);
    if (major < 86) continue;
    const cur = byMajor.get(major);
    if (!cur || compareVersions(v, cur) > 0) byMajor.set(major, v);
  }

  const sorted = [...byMajor.entries()].sort(([a], [b]) => a - b);
  const cachedCount = sorted.filter(([major]) => fs.existsSync(path.join(FF_DIR, String(major), 'firefox.exe'))).length;
  console.log(`${sorted.length} versions available (${cachedCount} cached, ${sorted.length - cachedCount} to download)`);

  await withConcurrency(sorted.map(([major, version]) => async () => {
    const dir = path.join(FF_DIR, String(major));
    const exe = path.join(dir, 'firefox.exe');
    if (fs.existsSync(exe)) {
      console.log(`  Firefox ${major} (${version}) — cached`);
      return;
    }
    console.log(`  Firefox ${major} (${version}) — downloading...`);
    const url = `https://ftp.mozilla.org/pub/firefox/releases/${version}/win64/en-US/Firefox%20Setup%20${encodeURIComponent(version)}.exe`;
    const installer = path.join(TEMP_DIR, `firefox-${version}.exe`);
    try {
      await execAsync(`powershell -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${installer}'"`, { timeout: 300000 });
    } catch (err) {
      console.log(`  Firefox ${major} (${version}) — FAILED (download): ${err.stderr?.split('\n')[0] || err.message.split('\n')[0]}`);
      try { fs.unlinkSync(installer); } catch {}
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    // NSIS silent installers often exit non-zero in containers even on success; check the exe instead.
    const { stderr } = await execAsync(`"${installer}" /S /D=${dir}`, { timeout: 120000 }).catch(e => ({ stderr: e.stderr }));
    try { fs.unlinkSync(installer); } catch {}
    if (fs.existsSync(exe)) {
      console.log(`  Firefox ${major} (${version}) — done`);
    } else {
      console.log(`  Firefox ${major} (${version}) — FAILED (install): ${(stderr || '').split('\n')[0] || 'exe missing after install'}`);
    }
  }), FF_CONCURRENCY);
}

// ── EdgeDriver (for Selenium Edge) ───────────────────────────────────────────

async function downloadEdgeDrivers() {
  console.log('\n[Edge for Selenium]');
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  const manifest = {};

  for (const { channel, label, exe } of EDGE_CHANNELS) {
    if (!fs.existsSync(exe)) {
      console.log(`  Edge ${channel} — not installed, skipping`);
      continue;
    }

    let version;
    try {
      const { stdout } = await execAsync(
        `powershell -Command "(Get-Item '${exe}').VersionInfo.ProductVersion"`
      );
      version = stdout.trim();
    } catch {
      console.log(`  Edge ${channel} — failed to read version`);
      continue;
    }

    manifest[channel] = { label, version, edgePath: exe };

    // EdgeDriver is managed by Selenium Manager at runtime (auto-downloads on first use).
    console.log(`  Edge ${version} (${channel}) — registered; EdgeDriver will be auto-managed by Selenium Manager`);
  }

  const edgeDir = path.join(CACHE_DIR, 'edgedriver');
  fs.mkdirSync(edgeDir, { recursive: true });
  fs.writeFileSync(
    path.join(edgeDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
}

// ── Firefox for Puppeteer (via @puppeteer/browsers) ──────────────────────────
// These versions are also used by WebdriverIO Firefox tests.

async function downloadPuppeteerFirefox() {
  console.log('\n[Firefox for Puppeteer]');
  const versions = ['stable_130.0', 'stable_133.0', 'stable_136.0', 'stable_138.0', 'stable_141.0'];
  const installed = await safeGetInstalledBrowsers({ cacheDir: CACHE_DIR });
  const cached = new Set(installed.filter(b => b.browser === Browser.FIREFOX).map(b => b.buildId));
  const toInstall = versions.filter(v => !cached.has(v));
  console.log(`${versions.length} versions (${cached.size} cached, ${toInstall.length} to install)`);
  for (const buildId of toInstall) {
    console.log(`  Firefox ${buildId} — installing...`);
    try {
      await install({ browser: Browser.FIREFOX, buildId, cacheDir: CACHE_DIR, platform: PLATFORM });
      console.log(`  Firefox ${buildId} — done`);
    } catch (err) {
      console.log(`  Firefox ${buildId} — FAILED: ${err.message.split('\n')[0]}`);
    }
  }
  for (const buildId of cached) console.log(`  Firefox ${buildId} — cached`);
}

// ── Firefox for WebdriverIO (via @puppeteer/browsers) ─────────────────────────
// Newer Firefox releases beyond the Puppeteer set, for broader WebdriverIO coverage.

async function downloadWebdriverIOFirefox() {
  console.log('\n[Firefox for WebdriverIO]');
  // Extends Puppeteer's pinned list with newer releases.
  // Versions that don't exist yet will fail gracefully and be skipped.
  const versions = ['stable_142.0', 'stable_145.0', 'stable_148.0'];
  const installed = await safeGetInstalledBrowsers({ cacheDir: CACHE_DIR });
  const cached = new Set(installed.filter(b => b.browser === Browser.FIREFOX).map(b => b.buildId));
  const toInstall = versions.filter(v => !cached.has(v));
  console.log(`${versions.length} versions (${versions.length - toInstall.length} cached, ${toInstall.length} to install)`);
  for (const buildId of toInstall) {
    console.log(`  Firefox ${buildId} — installing...`);
    try {
      await install({ browser: Browser.FIREFOX, buildId, cacheDir: CACHE_DIR, platform: PLATFORM });
      console.log(`  Firefox ${buildId} — done`);
    } catch (err) {
      console.log(`  Firefox ${buildId} — FAILED: ${err.message.split('\n')[0]}`);
    }
  }
  for (const buildId of versions.filter(v => cached.has(v))) console.log(`  Firefox ${buildId} — cached`);
}

// ── Chrome for Taiko ──────────────────────────────────────────────────────────
// Downloads the 5 most-recent major Chrome for Testing releases specifically for
// Taiko. The full downloadChrome() run includes these, but this section guarantees
// a minimal set even when the full download is skipped.

async function downloadTaikoChrome() {
  console.log('\n[Chrome for Taiko]');

  const resp = await fetch('https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json');
  if (!resp.ok) throw new Error(`Chrome API returned ${resp.status}`);
  const { versions } = await resp.json();

  // Latest patch per major, win64 only → pick the 5 most-recent majors
  const byMajor = new Map();
  for (const v of versions) {
    if (!v.downloads?.chrome?.some(d => d.platform === 'win64')) continue;
    const major = parseInt(v.version.split('.')[0]);
    const cur = byMajor.get(major);
    if (!cur || compareVersions(v.version, cur) > 0) byMajor.set(major, v.version);
  }
  const targets = [...byMajor.entries()]
    .sort(([a], [b]) => a - b)
    .slice(-5)
    .map(([major, buildId]) => ({ major, buildId }));

  const installed = await safeGetInstalledBrowsers({ cacheDir: CACHE_DIR });
  const cached = new Set(installed.filter(b => b.browser === Browser.CHROME).map(b => b.buildId));
  console.log(`Targeting ${targets.length} most-recent Chrome major versions`);

  await withConcurrency(targets.map(({ major, buildId }) => async () => {
    if (cached.has(buildId)) { console.log(`  Chrome ${major} (${buildId}) — cached`); return; }
    console.log(`  Chrome ${major} (${buildId}) — downloading...`);
    try {
      await install({ browser: Browser.CHROME, buildId, cacheDir: CACHE_DIR, platform: PLATFORM });
      console.log(`  Chrome ${major} (${buildId}) — done`);
    } catch (err) {
      console.log(`  Chrome ${major} (${buildId}) — FAILED: ${err.message.split('\n')[0]}`);
    }
  }), CHROME_CONCURRENCY);
}

// ── main ──────────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  // ChromeDriver needs Chrome cached first; Firefox and GeckoDriver are independent.
  await Promise.all([
    downloadChrome().then(downloadChromeDrivers),
    downloadFirefox(),
    downloadGeckodrivers(),
    downloadEdgeDrivers(),
    downloadPuppeteerFirefox(),
    downloadWebdriverIOFirefox(),
    downloadTaikoChrome(),
  ]);
  console.log('\nDownloads complete.\n');
})().catch(err => { console.error(err); process.exit(1); });
