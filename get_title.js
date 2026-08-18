const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();

  console.log('Navigating to example.com...');
  await page.goto('https://example.com');

  const title = await page.title();
  console.log('Page title:', title);

  await browser.close();
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
