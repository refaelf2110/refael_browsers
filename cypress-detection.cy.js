// Cypress detection spec.
// All parameters come from Cypress.env() set by cypress.run({ env: { ... } }).
//   TEST_URL  — target URL (with embedded credentials for the initial request)
//   OUT_FILE  — absolute Windows path to write the reason codes (one per line)
//   XREFAEL   — value for the x-refael header (injected on all requests)

const TEST_URL = Cypress.env('TEST_URL');
const OUT_FILE  = Cypress.env('OUT_FILE');
const XREFAEL   = Cypress.env('XREFAEL') || '7e8afcbdd3';

describe('detection', () => {
  it('extracts reasonSummary after 5 MON log entries', () => {
    // Intercept every request that goes through Cypress's proxy and inject x-refael.
    // cy.intercept must be set up before cy.visit() to cover initial navigation too.
    cy.intercept({ url: /.*/ }, req => {
      req.headers['x-refael'] = XREFAEL;
    });

    // TEST_URL already has embedded Basic-Auth credentials for the Authorization header.
    cy.visit(TEST_URL, { timeout: 30000 });

    // Wait up to 90 s for 5 mon log entries to appear in #log. Cypress retries .should() automatically.
    cy.get('#log .entry.reason', { timeout: 90000 }).should($entries => {
      const monCount = [...$entries].filter(e => {
        const route = e.querySelector('.route');
        return route && route.textContent.trim() === 'mon';
      }).length;
      expect(monCount, 'MON entry count').to.be.gte(5);
    });

    // Collect the text of each badge span from #reasonSummary and write them one per line.
    cy.get('#reasonSummary .summary-list span').then($spans => {
      const text = [...$spans].map(el => el.textContent.trim()).join('\n');
      cy.writeFile(OUT_FILE, text, { log: false });
    });
  });
});
