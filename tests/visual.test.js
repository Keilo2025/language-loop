import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildLocaleUrl,
  runVisualChecks,
} from '../dist/core/visual.js';

test('visual URL builder supports locale templates and query-parameter routing', () => {
  assert.equal(
    buildLocaleUrl('http://localhost:3000/{locale}/account', 'ar-SA'),
    'http://localhost:3000/ar-SA/account'
  );
  assert.equal(
    buildLocaleUrl('http://localhost:3000/account?mode=test', 'en-XA', 'lang'),
    'http://localhost:3000/account?mode=test&lang=en-XA'
  );
});

test('visual checks fail on screenshot overflow and invalid RTL browser state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'language-loop-visual-'));
  const calls = [];
  const driver = {
    async inspect(input) {
      calls.push(input);
      if (input.locale === 'ar-XB') {
        return {
          documentDirection: 'ltr',
          htmlDir: 'ltr',
          htmlLang: 'en',
          overflow: [{
            selector: '#checkout',
            kind: 'viewport',
            message: 'element extends 48px beyond the viewport',
          }],
          physicalDirectionRules: ['.price { margin-left: 8px; }'],
          consoleErrors: [],
          pageErrors: [],
        };
      }
      return {
        documentDirection: 'ltr',
        htmlDir: 'ltr',
        htmlLang: 'en-XA',
        overflow: [],
        physicalDirectionRules: [],
        consoleErrors: [],
        pageErrors: [],
      };
    },
    async close() {},
  };

  const report = await runVisualChecks({
    url: 'http://localhost:3000/{locale}',
    locales: ['en-XA', 'ar-XB'],
    viewports: [{ name: 'mobile', width: 390, height: 844 }],
    outDir: root,
  }, driver);

  assert.equal(report.ok, false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => path.isAbsolute(call.screenshotPath)));
  assert.ok(report.findings.some((finding) => finding.rule === 'horizontal-overflow'));
  assert.ok(report.findings.some((finding) => finding.rule === 'rtl-direction'));
  assert.ok(report.findings.some((finding) => finding.rule === 'html-lang'));
  assert.ok(report.findings.some(
    (finding) => finding.rule === 'physical-direction' && finding.severity === 'warning'
  ));
});

test('visual checks pass correctly directed RTL pages without overflow', async () => {
  let closed = false;
  const driver = {
    async inspect() {
      return {
        documentDirection: 'rtl',
        htmlDir: 'rtl',
        htmlLang: 'ar-XB',
        overflow: [],
        physicalDirectionRules: [],
        consoleErrors: [],
        pageErrors: [],
      };
    },
    async close() {
      closed = true;
    },
  };

  const report = await runVisualChecks({
    url: 'http://localhost:3000/?locale=ar-XB',
    locales: ['ar-XB'],
    viewports: [{ name: 'desktop', width: 1440, height: 900 }],
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'language-loop-visual-')),
  }, driver);

  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 1);
  assert.equal(closed, true);
});

test('strict visual checks promote direction-specific CSS warnings to failure', async () => {
  const driver = {
    async inspect() {
      return {
        documentDirection: 'rtl',
        htmlDir: 'rtl',
        htmlLang: 'ar-XB',
        overflow: [],
        physicalDirectionRules: ['.card { padding-left: 1rem; }'],
        consoleErrors: [],
        pageErrors: [],
      };
    },
    async close() {},
  };
  const report = await runVisualChecks({
    url: 'http://localhost:3000',
    locales: ['ar-XB'],
    strict: true,
    outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'language-loop-visual-')),
  }, driver);

  assert.equal(report.ok, false);
  assert.equal(report.findings[0].severity, 'warning');
});

test('visual checks close the browser driver after a page-level failure', async () => {
  let closed = false;
  const driver = {
    async inspect() {
      throw new Error('navigation failed');
    },
    async close() {
      closed = true;
    },
  };

  await assert.rejects(
    runVisualChecks({
      url: 'http://localhost:3000',
      locales: ['en-XA'],
      outDir: fs.mkdtempSync(path.join(os.tmpdir(), 'language-loop-visual-')),
    }, driver),
    /navigation failed/
  );
  assert.equal(closed, true);
});
