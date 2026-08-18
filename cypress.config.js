const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    specPattern: 'cypress-detection.cy.js',
    supportFile: false,
    video: false,
    screenshotOnRunFailure: false,
    pageLoadTimeout: 30000,
    defaultCommandTimeout: 90000,
    requestTimeout: 15000,
    responseTimeout: 30000,
    setupNodeEvents(on) {
      on('before:browser:launch', (_browser, launchOptions) => {
        launchOptions.args = launchOptions.args || [];
        launchOptions.args.push('--no-sandbox');
        launchOptions.args.push('--disable-gpu');
        launchOptions.args.push('--disable-software-rasterizer');
        launchOptions.args.push('--disable-dev-shm-usage');
        launchOptions.args.push('--disable-gpu-sandbox');
        launchOptions.args.push('--remote-allow-origins=*');
        launchOptions.args.push('--use-gl=swiftshader');
        launchOptions.args.push('--disable-features=VizDisplayCompositor');
        // Chrome 112+ deprecated --headless (old); Chrome 137+ removed it. Replace any old variant.
        const headlessIdx = launchOptions.args.findIndex(a => a === '--headless' || a === '--headless=old' || a === '--headless=chrome');
        if (headlessIdx !== -1) launchOptions.args[headlessIdx] = '--headless=new';
        // Log final args for Chrome 151+ diagnostics (goes to container stdout)
        console.log('[cypress-launch] args:', launchOptions.args.join(' '));
        return launchOptions;
      });
    },
  },
});
