'use strict';

/**
 * download_linux_browsers.js
 *
 * Downloads Linux browser binaries into linux-browser-cache/ using
 * @puppeteer/browsers with platform=linux64. Safe to run on Windows.
 *
 * Usage:
 *   node download_linux_browsers.js
 *
 * Downloads:
 *   - Chrome (latest MAX_CHROME_VERSIONS stable versions) + matching ChromeDriver
 *   - Firefox (latest MAX_FIREFOX_VERSIONS versions via @puppeteer/browsers)
 *   - geckodriver (latest release for linux64 from GitHub)
 *
 * Output directory: linux-browser-cache/
 *   chrome/linux64-{version}/chrome-linux64/chrome
 *   chromedriver/linux64-{version}/chromedriver-linux64/chromedriver
 *   firefox/linux-{buildId}/firefox/firefox
 *   geckodriver/latest/geckodriver
 */

const { install, Browser, BrowserPlatform } = require('@puppeteer/browsers');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const { pipeline } = require('stream/promises');
const { createGunzip } = require('zlib');
const { Extract } = require('tar');  // tar is a dep of npm, usually available

const CACHE_DIR            = path.join(__dirname, 'linux-browser-cache');
const MAX_CHROME_VERSIONS  = 5;
const MAX_FIREFOX_VERSIONS = 3;

// ── helpers ──────────────────────────────────────────────────────────────────

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'refael-browser-downloader/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(httpsGet(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpsGetJson(url) {
  return httpsGet(url).then(buf => JSON.parse(buf.toString()));
}

// ── Chrome + ChromeDriver ─────────────────────────────────────────────────────

async function downloadChromes() {
  console.log('\n── Chrome + ChromeDriver (linux64) ──────────────────────────────');
  console.log('Fetching Chrome for Testing version list...');
  const data = await httpsGetJson(
    'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json'
  );

  // Filter to versions that have both chrome and chromedriver linux64 downloads
  const usable = data.versions.filter(v =>
    v.downloads.chrome?.some(d => d.platform === 'linux64') &&
    v.downloads.chromedriver?.some(d => d.platform === 'linux64')
  );

  // Take last MAX_CHROME_VERSIONS (newest are at the end)
  const selected = usable.slice(-MAX_CHROME_VERSIONS);
  console.log(`Downloading ${selected.length} Chrome versions: ${selected.map(v => v.version).join(', ')}`);

  for (const { version } of selected) {
    console.log(`  Installing chrome@${version} linux64...`);
    await install({
      browser:   Browser.CHROME,
      buildId:   version,
      cacheDir:  CACHE_DIR,
      platform:  BrowserPlatform.LINUX,
    });
    console.log(`  Installing chromedriver@${version} linux64...`);
    await install({
      browser:   Browser.CHROMEDRIVER,
      buildId:   version,
      cacheDir:  CACHE_DIR,
      platform:  BrowserPlatform.LINUX,
    });
  }
}

// ── Firefox ───────────────────────────────────────────────────────────────────

async function downloadFirefox() {
  console.log('\n── Firefox (linux) ──────────────────────────────────────────────');
  // Use @puppeteer/browsers to resolve and download stable Firefox builds.
  // It uses the firefox-for-puppeteer distribution which is linux-compatible.
  const { resolveBuildId, BrowserTag } = require('@puppeteer/browsers');

  // Get the latest stable buildId
  const latestId = await resolveBuildId(Browser.FIREFOX, BrowserPlatform.LINUX, BrowserTag.LATEST);
  console.log(`Latest Firefox buildId: ${latestId}`);

  // Download latest only (Firefox has large binaries; expand MAX_FIREFOX_VERSIONS as needed)
  const toDownload = [latestId];
  for (const buildId of toDownload) {
    console.log(`  Installing firefox@${buildId} linux...`);
    await install({
      browser:   Browser.FIREFOX,
      buildId,
      cacheDir:  CACHE_DIR,
      platform:  BrowserPlatform.LINUX,
    });
  }
}

// ── geckodriver ───────────────────────────────────────────────────────────────

async function downloadGeckodriver() {
  console.log('\n── geckodriver (linux64) ────────────────────────────────────────');
  const release = await httpsGetJson(
    'https://api.github.com/repos/mozilla/geckodriver/releases/latest'
  );
  const version = release.tag_name; // e.g. v0.35.0
  const asset   = release.assets.find(a => a.name.includes('linux64') && a.name.endsWith('.tar.gz'));
  if (!asset) throw new Error('Could not find geckodriver linux64 .tar.gz asset');

  console.log(`  Downloading geckodriver ${version} linux64...`);
  const destDir = path.join(CACHE_DIR, 'geckodriver', 'latest');
  fs.mkdirSync(destDir, { recursive: true });

  const destFile = path.join(destDir, 'geckodriver');
  if (fs.existsSync(destFile)) {
    console.log('  Already downloaded, skipping.');
    return;
  }

  const buf = await httpsGet(asset.browser_download_url);
  // Write tar.gz to a temp file then extract
  const tmpTar = destFile + '.tar.gz';
  fs.writeFileSync(tmpTar, buf);

  await new Promise((resolve, reject) => {
    fs.createReadStream(tmpTar)
      .pipe(createGunzip())
      .pipe(Extract({ cwd: destDir }))
      .on('finish', resolve)
      .on('error', reject);
  });

  fs.unlinkSync(tmpTar);
  // Make executable
  fs.chmodSync(destFile, 0o755);
  console.log(`  geckodriver extracted to ${destDir}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Downloading Linux browsers to ${CACHE_DIR}`);

  await downloadChromes();
  await downloadFirefox();
  await downloadGeckodriver();

  console.log('\nDone. Run node upload_linux_browser_cache.js to push to S3.');
})().catch(err => { console.error(err); process.exit(1); });
