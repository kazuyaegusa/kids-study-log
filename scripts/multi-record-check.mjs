import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const toolRoot = process.env.PLAYWRIGHT_ROOT ?? join(homedir(), 'KEWORK/design_uiux/tools/check/node_modules');
const { chromium } = require(join(toolRoot, 'playwright-core'));
const axeSource = await readFile(join(toolRoot, 'axe-core/axe.min.js'), 'utf8');
const executablePath = process.env.CHROMIUM_PATH ?? join(homedir(),
  'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const url = process.argv[2] ?? 'http://127.0.0.1:8000/';
const output = process.argv[3] ?? '/private/tmp/kids-study-log-multi-shots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, chromiumSandbox: true });
const evidence = [];
const errors = [];
let status = 'running';
let failure = null;

async function snapshot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(output, `${name}.png`), fullPage: true });
  const layout = await page.evaluate(() => {
    const root = document.querySelector('dialog[open]') ?? document;
    const visible = el => el.getBoundingClientRect().height && el.getBoundingClientRect().width;
    const small = [...root.querySelectorAll('button:not(:disabled), input, textarea, summary')]
      .filter(visible).filter(el => {
        const rect = (el.labels?.[0]?.contains(el) ? el.labels[0] : el).getBoundingClientRect();
        return Math.min(rect.width, rect.height) < 55.9;
      }).map(el => el.id || el.className);
    const heavy = [...root.querySelectorAll('*')].filter(visible)
      .filter(el => Number(getComputedStyle(el).fontWeight) > 400).map(el => el.id || el.tagName);
    const sheet = document.querySelector('#record-sheet');
    return { small, heavy, overflow: document.documentElement.scrollWidth > innerWidth ||
      (sheet.open && sheet.scrollWidth > sheet.clientWidth) };
  });
  if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }
  })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })));
  evidence.push({ screen: name, layout, violations });
  assert.deepEqual(layout, { small: [], heavy: [], overflow: false }, name);
  assert.deepEqual(violations, [], name);
}

async function stored(page) {
  return page.evaluate(async () => {
    const { openDatabase, exportBackup } = await import('/js/db.js');
    const db = await openDatabase();
    const backup = await exportBackup(db);
    db.close();
    return backup;
  });
}

async function finishSave(page, prefix, exp, minutes, streak, shot = false) {
  await page.locator('#save-entry').click();
  await page.locator('#save-celebration').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#celebration-exp').textContent(), `+${exp} EXP`);
  await page.locator('#skip-celebration').click();
  await page.waitForFunction(expected => [...document.querySelectorAll('.result-number')]
    .map(el => el.textContent).join(',') === expected, `${exp},${minutes},${streak}`);
  if (shot) await snapshot(page, `${prefix}-result`);
  await page.locator('#continue-adventure').click();
  await page.waitForFunction(() => !document.querySelector('#record-form').inert);
}

try {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    const prefix = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Tokyo', hasTouch: true });
    // This task needs no external service: use a local PNG as existing artwork.
    await context.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${prefix}: ${error.message}`));
    await page.clock.setFixedTime(new Date('2026-10-17T12:00:00+09:00'));
    await page.goto(url);
    await page.waitForFunction(() => document.querySelectorAll('#category-options button').length === 4);
    await page.evaluate(async () => {
      const { openDatabase, put } = await import('/js/db.js');
      const db = await openDatabase();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#f6ce43';
      ctx.beginPath(); ctx.arc(120, 120, 100, 0, Math.PI * 2); ctx.fill();
      const artwork = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await put(db, 'weeks', { id: '2026-10-12', artType: 'pokemon', pokemonId: 25, pokemonName: 'テスト用の相棒', artwork });
      db.close();
    });
    await page.reload();
    await page.locator('#board-panel').waitFor({ state: 'visible' });
    await page.evaluate(() => {
      window.saveEvidence = { transactions: 0, celebrations: 0, results: 0 };
      const original = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
        if (mode === 'readwrite' && (stores === 'entries' || stores?.includes('entries'))) window.saveEvidence.transactions++;
        return original.call(this, stores, mode, ...rest);
      };
      for (const [id, key] of [['save-celebration', 'celebrations'], ['result-dialog', 'results']]) {
        const dialog = document.getElementById(id);
        new MutationObserver(changes => {
          if (dialog.open && changes.some(change => change.attributeName === 'open')) window.saveEvidence[key]++;
        }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
      }
    });
    const tile = id => page.locator(`#category-options [data-category-id="${id}"]`);
    const row = id => page.locator(`#record-rows [data-category-id="${id}"]`);
    const minutes = (id, value) => row(id).getByRole('button', { name: value === 60 ? '60分以上' : `${value}分`, exact: true });
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    assert.equal(await page.locator('#save-entry').isDisabled(), true);
    assert.equal(await page.locator('#record-empty').isVisible(), true);
    await snapshot(page, `${prefix}-empty`);
    await tile('juku').click();
    await tile('school').click();
    await minutes('juku', 30).click();
    await minutes('school', 20).click();
    await tile('reading').click();
    await tile('reading').click();
    await tile('research').click();
    await row('research').getByRole('button', { name: '調べ物・自由研究を外す' }).click();
    assert.equal(await row('juku').locator('[aria-pressed="true"]').textContent(), '30分');
    assert.equal(await row('school').locator('[aria-pressed="true"]').textContent(), '20分');
    await page.locator('#self-started').check();
    await page.getByRole('button', { name: '昨日・16日' }).click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    await page.getByRole('button', { name: '今日・17日' }).click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    assert.equal(await page.locator('#self-started').isChecked(), false);
    await tile('juku').click();
    await tile('school').click();
    await minutes('juku', 30).click();
    await minutes('school', 20).click();
    await page.locator('#self-started').check();
    await snapshot(page, `${prefix}-two-rows`);
    await page.locator('#record-sheet summary').click();
    await page.locator('#entry-comment').fill('<img src=x onerror=alert(1)> 記録');
    await page.locator('#entry-question').fill('なぜ？');
    const photo = (await stored(page)).weeks[0].artwork.split(',')[1];
    await page.locator('#entry-photo').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
    await finishSave(page, prefix, 32, 50, 1, true);
    const backup = await stored(page);
    assert.equal(backup.formatVersion, 3);
    assert.equal(backup.entries.length, 2);
    const first = backup.entries.find(entry => entry.categoryId === 'juku');
    const second = backup.entries.find(entry => entry.categoryId === 'school');
    assert.equal(first.minutes, 30);
    assert.equal(second.minutes, 20);
    assert.equal(first.selfStarted, true);
    assert.equal(first.question, 'なぜ？');
    assert.ok(first.photo.startsWith('data:image/jpeg;base64,'));
    assert.equal(second.selfStarted, false);
    assert.equal(second.comment, '');
    assert.equal(second.question, '');
    assert.equal(second.photo, null);
    assert.equal(await page.locator('#goal-minutes').textContent(), '50');
    assert.equal(await page.locator('#month-grid .open').count(), 1);
    const counts = await page.evaluate(() => window.saveEvidence);
    assert.deepEqual(counts, { transactions: 1, celebrations: 1, results: 1 });
    evidence.push({ screen: `${prefix}-saved`, entries: backup.entries.map(({ photo, ...entry }) => ({ ...entry, photo: Boolean(photo) })), counts });
    await snapshot(page, `${prefix}-home`);
    await page.locator('#month-grid .open').click();
    await page.locator('#detail-dialog').waitFor({ state: 'visible' });
    assert.match(await page.locator('#detail-content').textContent(), /<img src=x onerror=alert\(1\)>/);
    assert.equal(await page.locator('#detail-content img').count(), 1);
    await page.locator('#detail-dialog [data-close]').click();
    await page.evaluate(async ids => {
      const { openDatabase, put } = await import('/js/db.js');
      const db = await openDatabase();
      for (const id of ids) await put(db, 'replies', { id, stamp: '👍 いいね', comment: '返信を残す', seen: false, updatedAt: 123 });
      db.close();
    }, [first.id, second.id]);
    assert.equal((await page.locator('#open-record').textContent()).trim().includes('今日の記録を修正する'), true);
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    assert.equal(await page.locator('#record-title').textContent(), '記録の修正');
    assert.equal(await page.locator('#save-entry').textContent(), '記録を修正する');
    assert.equal(await page.locator('#record-rows fieldset').count(), 2);
    assert.equal(await page.locator('#self-started').isChecked(), true);
    assert.equal(await page.locator('#entry-comment').inputValue(), first.comment);
    assert.equal(await page.locator('#entry-question').inputValue(), first.question);
    assert.equal(await page.locator('#record-photo-preview').isVisible(), true);
    assert.equal(await row('juku').locator('[aria-pressed="true"]').textContent(), '30分');
    await minutes('school', 10).click();
    await snapshot(page, `${prefix}-edit`);
    await page.locator('#save-entry').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '記録を修正しました' && !document.querySelector('#record-form').inert);
    const revised = await stored(page);
    assert.equal(revised.entries.length, 2);
    assert.deepEqual(revised.entries.map(entry => entry.id).sort(), backup.entries.map(entry => entry.id).sort());
    assert.equal(revised.entries.find(entry => entry.id === second.id).minutes, 10);
    assert.ok(revised.entries.find(entry => entry.id === first.id).photo === first.photo, 'existing photo stays on the retained entry');
    assert.equal(revised.replies.length, 2);
    assert.equal(await page.locator('#goal-minutes').textContent(), '40');
    assert.equal(await page.locator('#exp-numbers').textContent(), '32 / 50 EXP');
    assert.equal(await page.locator('#month-grid .open').count(), 1);
    assert.equal(await page.locator('.just-opened').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.saveEvidence), { transactions: 2, celebrations: 1, results: 1 });
    await snapshot(page, `${prefix}-revised-home`);
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    await tile('school').click();
    await tile('reading').click();
    await page.locator('#save-entry').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    const removed = await stored(page);
    assert.equal(removed.entries.length, 2);
    assert.equal(removed.entries.some(entry => entry.id === second.id), false);
    assert.deepEqual(removed.replies.map(reply => reply.id), [first.id]);
    assert.equal(removed.replies[0].comment, '返信を残す');
    assert.deepEqual(await page.evaluate(() => window.saveEvidence), { transactions: 3, celebrations: 1, results: 1 });
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    await tile('juku').click();
    await tile('reading').click();
    assert.equal(await page.locator('#save-entry').isDisabled(), true);
    await page.getByRole('button', { name: '昨日・16日' }).click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    assert.equal(await page.locator('#record-rows fieldset').count(), 0);
    assert.equal(await page.locator('#self-started').isChecked(), false);
    assert.equal(await page.locator('#entry-comment').inputValue(), '');
    assert.equal(await page.locator('#record-photo-preview').isVisible(), false);
    await tile('juku').click();
    await tile('school').click();
    await minutes('juku', 10).click();
    await minutes('school', 60).click();
    await finishSave(page, prefix, 20, 50, 2);
    assert.equal(await page.locator('#month-grid .open').count(), 2);
    assert.equal(await page.locator('.week-day.recorded').count(), 2);
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    await page.getByRole('button', { name: '昨日・16日' }).click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    assert.equal(await page.locator('#record-title').textContent(), '記録の修正');
    assert.equal(await row('school').locator('[aria-pressed="true"]').textContent(), '60分以上');
    await page.locator('#close-record').click();
    await page.clock.setFixedTime(new Date('2026-10-18T12:00:00+09:00'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('#goal-minutes').textContent === '0');
    assert.equal(await page.locator('#streak-count').textContent(), '2日');
    await page.clock.setFixedTime(new Date('2026-10-19T12:00:00+09:00'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.querySelector('#streak-count').textContent === '0日');
    assert.equal(await page.locator('.week-day.recorded').count(), 0);
    const storage = await page.evaluate(async () => {
      const { openDatabase, all, saveDayEntries, exportBackup, importBackup } = await import('/js/db.js');
      const { totalExp, validateBackup } = await import('/js/core.js');
      const db = await openDatabase();
      const before = await all(db, 'entries');
      let failures = 0;
      for (const entries of [
        [{ ...before[0], id: 'should-rollback', date: '2026-10-19' }, { ...before[0], categoryId: 'research', date: '2026-10-19' }],
        [{ ...before[0], id: 'should-rollback-sync', date: '2026-10-19' }, { ...before[0], id: 'invalid', categoryId: 'research', date: '2026-10-19', photo: () => {} }]
      ]) {
        try { await saveDayEntries(db, '2026-10-19', entries); } catch { failures++; }
      }
      const replies = await all(db, 'replies');
      const replied = before.find(entry => entry.id === replies[0].id);
      try {
        await saveDayEntries(db, replied.date, [
          { ...replied, id: 'rollback-replacement', categoryId: 'research', photo: () => {} }
        ]);
      } catch { failures++; }
      const after = await all(db, 'entries');
      const repliesPreserved = JSON.stringify(replies) === JSON.stringify(await all(db, 'replies'));
      const exported = await exportBackup(db);
      validateBackup(exported);
      await importBackup(db, exported);
      const restored = await exportBackup(db);
      db.close();
      return { failures, repliesPreserved, before: before.length, after: after.length,
        unexpected: after.some(entry => entry.id.startsWith('should-rollback')),
        restored: JSON.stringify(exported.entries) === JSON.stringify(restored.entries), exp: totalExp(after) };
    });
    assert.deepEqual(storage, { failures: 3, repliesPreserved: true, before: 4, after: 4, unexpected: false, restored: true, exp: 52 });
    evidence.push({ screen: `${prefix}-storage`, ...storage });
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    await tile('juku').click();
    await tile('school').click();
    await page.evaluate(() => {
      window.originalAdd = IDBObjectStore.prototype.add;
      let count = 0;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === 'entries' && ++count === 2) throw new DOMException('Test failure', 'QuotaExceededError');
        return window.originalAdd.apply(this, args);
      };
    });
    await page.locator('#save-entry').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Test failure'));
    assert.equal((await stored(page)).entries.length, 4);
    assert.equal(await page.locator('#record-sheet').isVisible(), true);
    assert.equal(await page.locator('#save-entry').isEnabled(), true);
    assert.equal(await page.locator('#record-rows fieldset').count(), 2);
    await page.evaluate(() => { IDBObjectStore.prototype.add = window.originalAdd; });
    await row('juku').getByRole('button', { name: '塾の宿題を外す' }).click();
    await tile('school').click();
    assert.equal(await page.locator('#save-entry').isDisabled(), true);
    assert.equal(await page.locator('#record-empty').isVisible(), true);
    await page.locator('#close-record').click();
    // Old same-day submissions can carry separate notes/photos, even in the same category.
    const beforeLegacy = await stored(page);
    const legacyEntries = ['legacy-a', 'legacy-b', 'legacy-c'].map((id, index) => ({
      ...first, id, date: '2026-10-19', categoryId: index === 1 ? 'school' : 'juku',
      minutes: index === 2 ? 15 : 20, createdAt: index,
      comment: `一言${index}`, question: `疑問${index}`, photo: first.photo
    }));
    await page.evaluate(async ({ backup, entries }) => {
      const { openDatabase, importBackup } = await import('/js/db.js');
      const db = await openDatabase();
      await importBackup(db, { ...backup, entries, categories: backup.categories.map(category =>
        category.id === 'juku' ? { ...category, visible: false } : category),
        replies: entries.map(entry => ({ id: entry.id, stamp: '👍 いいね', comment: entry.id, seen: false, updatedAt: 1 })) });
      db.close();
    }, { backup: beforeLegacy, entries: legacyEntries });
    await page.reload();
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    assert.equal(await page.locator('#record-rows fieldset').count(), 3);
    assert.equal(await page.locator('#record-rows textarea').count(), 2);
    assert.equal(await page.locator('#record-rows img').count(), 2);
    assert.equal(await page.locator('#record-photo-preview').isVisible(), true);
    assert.equal(await page.locator('#entry-comment').inputValue(), '一言0');
    assert.equal(await page.locator('[data-entry-id="legacy-b"] textarea').inputValue(), '一言1');
    assert.equal(await page.locator('[data-entry-id="legacy-c"] [aria-pressed="true"]').textContent(), '15分');
    await snapshot(page, `${prefix}-legacy-fields`);
    await page.locator('#save-entry').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '記録を修正しました' && !document.querySelector('#record-form').inert);
    const keptLegacy = await stored(page);
    assert.ok(JSON.stringify(keptLegacy.entries) === JSON.stringify(legacyEntries), 'all legacy fields survive unchanged');
    assert.equal(keptLegacy.replies.length, 3);
    assert.equal(await page.locator('#save-celebration').isVisible(), false);
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    await page.locator('[data-entry-id="legacy-b"] textarea').fill('学校の修正');
    await page.locator('[data-entry-id="legacy-c"] .remove-record-row').click();
    await page.locator('#save-entry').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    const trimmedLegacy = await stored(page);
    assert.equal(trimmedLegacy.entries.length, 2);
    assert.equal(trimmedLegacy.entries.find(entry => entry.id === 'legacy-b').comment, '学校の修正');
    assert.deepEqual(trimmedLegacy.replies.map(reply => reply.id), ['legacy-a', 'legacy-b']);
    evidence.push({ screen: `${prefix}-legacy-preservation`, unchanged: true, retainedReplies: 2, removedReply: true });
    await page.evaluate(async ({ backup, entries }) => {
      const { openDatabase, importBackup } = await import('/js/db.js');
      const db = await openDatabase();
      const blank = { ...entries[1], selfStarted: false, comment: '', question: '', photo: null };
      await importBackup(db, { ...backup, entries: [entries[0], blank],
        replies: [entries[0], blank].map(entry => ({ id: entry.id, stamp: '👍 いいね', comment: entry.id, seen: false, updatedAt: 1 })) });
      db.close();
    }, { backup: beforeLegacy, entries: legacyEntries });
    await page.reload();
    await page.locator('#open-record').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    await page.locator('[data-entry-id="legacy-a"] .remove-record-row').click();
    assert.equal(await page.locator('#entry-comment').inputValue(), '');
    assert.equal(await page.locator('#record-photo-preview').isVisible(), false);
    await page.locator('#save-entry').click();
    await page.waitForFunction(() => !document.querySelector('#record-form').inert);
    const removedShared = await stored(page);
    assert.equal(removedShared.entries.length, 1);
    assert.equal(removedShared.entries[0].id, 'legacy-b');
    assert.equal(removedShared.entries[0].comment, '');
    assert.equal(removedShared.entries[0].photo, null);
    assert.deepEqual(removedShared.replies.map(reply => reply.id), ['legacy-b']);
    await page.evaluate(async backup => {
      const { openDatabase, importBackup } = await import('/js/db.js');
      const db = await openDatabase(); await importBackup(db, backup); db.close();
    }, beforeLegacy);
    // A reload must preserve the ordinary entries and the current shell cache.
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#goal-minutes').textContent === '0');
    assert.equal((await stored(page)).entries.length, 4);
    assert.ok(await page.evaluate(async () => (await caches.keys()).includes('mainichi-shell-v20')));
    await context.close();
    console.log(`${prefix}: daily replacement, replies, quiet edits, weekly tiles, rollback, backup and offline passed`);
  }
  assert.deepEqual(errors, []);
  status = 'passed';
} catch (error) {
  status = 'failed';
  failure = error.stack;
  throw error;
} finally {
  await writeFile(join(output, 'multi-record-results.json'), JSON.stringify({ status, failure, evidence, errors }, null, 2));
  await browser.close();
}
