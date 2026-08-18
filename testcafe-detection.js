// TestCafe detection test.
// Parameters passed via process.env (set by the runner before createTestCafe):
//   TC_TEST_URL  — target URL with embedded credentials
//   TC_OUT_FILE  — absolute path to write the reason codes (one per line)
//   TC_XREFAEL   — x-refael header value
//   TC_AUTH      — Authorization header value (e.g. "Basic base64...")

const fs = require('fs');

const TEST_URL = process.env.TC_TEST_URL;
const OUT_FILE  = process.env.TC_OUT_FILE;
const XREFAEL   = process.env.TC_XREFAEL || '7e8afcbdd3';
const AUTH      = process.env.TC_AUTH     || '';

// Destructure from the testcafe package.
// Inside a file compiled by TestCafe's loader, `fixture` and `test` are globals;
// RequestHook / ClientFunction come from the package itself.
const { RequestHook, ClientFunction } = require('testcafe');

// Inject x-refael (and Authorization if supplied) into every request that goes
// through TestCafe's hammerhead reverse proxy.
class HeaderInjector extends RequestHook {
  constructor() {
    super(/.*/, { includeHeaders: true });
  }
  async onRequest(event) {
    event.requestOptions.headers['x-refael'] = XREFAEL;
    if (AUTH) event.requestOptions.headers['authorization'] = AUTH;
  }
  async onResponse() {}
}

const injector = new HeaderInjector();

// Count mon entries in #log without injecting anything.
const getMonCount = ClientFunction(() => {
  var routes = document.querySelectorAll('#log .entry.reason .route');
  var n = 0;
  for (var i = 0; i < routes.length; i++) {
    if (routes[i].textContent.trim() === 'mon') n++;
  }
  return n;
});

// Collect badge span texts from #reasonSummary once 5 mon entries have appeared.
const getReasonTexts = ClientFunction(() => {
  try {
    var spans = document.querySelectorAll('#reasonSummary .summary-list span');
    return Array.from(spans).map(function(s){ return (s.textContent || '').trim(); }).join('\n');
  } catch(e) { return ''; }
});

fixture('detection')
  .page(TEST_URL)
  .requestHooks(injector);

test('extract reason summary after 5 MON log entries', async t => {
  // Poll every second until 5 mon log entries appear (deadline: 85 s).
  const deadline = Date.now() + 85000;
  while (Date.now() < deadline) {
    const count = await getMonCount();
    if (count >= 5) break;
    await t.wait(1000);
  }
  const text = await getReasonTexts();
  if (OUT_FILE) fs.writeFileSync(OUT_FILE, text);
});
