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
const output = process.argv[3] ?? '/private/tmp/kids-study-log-shots';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, chromiumSandbox: true });
const evidence = [];
const errors = [];
const network = [];
let referenceBackup;

async function snapshot(page, prefix, name, audit = true) {
  // Capture settled progress bars, while short reward dialogs are still open.
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(output, `${prefix}-${name}.png`), fullPage: name !== '11-parent' });
  const layout = await page.evaluate(() => {
    const visible = element => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    };
    const modal = document.querySelector('dialog[open]');
    const root = modal ?? document;
    const small = [...root.querySelectorAll('button:not(:disabled), input, select, textarea, summary')]
      .filter(visible).filter(element => {
        const rect = element.labels?.[0]?.contains(element)
          ? element.labels[0].getBoundingClientRect() : element.getBoundingClientRect();
        return Math.min(rect.width, rect.height) < 55.9;
      }).map(element => element.id || element.className);
    const heavy = [...root.querySelectorAll('*')].filter(visible)
      .filter(element => Number(getComputedStyle(element).fontWeight) > 400)
      .map(element => element.id || element.tagName);
    return { overflow: document.documentElement.scrollWidth > innerWidth, small, heavy };
  });
  assert.equal(layout.overflow, false, `${prefix}/${name}: horizontal overflow`);
  assert.deepEqual(layout.small, [], `${prefix}/${name}: targets below 56px`);
  assert.deepEqual(layout.heavy, [], `${prefix}/${name}: font weight above 400`);
  if (['01-selection', '03-chosen', '07-home'].includes(name)) {
    const unobscured = await page.evaluate(() => {
      const navTop = document.querySelector('.bottom-nav').getBoundingClientRect().top;
      return ['#open-record', '#refresh-candidates'].every(selector => {
        const target = document.querySelector(selector);
        return !target.getBoundingClientRect().height || target.getBoundingClientRect().bottom + 6 <= navTop;
      });
    });
    assert.equal(unobscured, true, `${prefix}/${name}: navigation covers a home action`);
  }
  let violations = [];
  if (audit) {
    if (!await page.evaluate(() => Boolean(window.axe))) await page.addScriptTag({ content: axeSource });
    violations = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }
      });
      return result.violations.map(item => ({
        id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary }))
      }));
    });
  }
  evidence.push({ screen: `${prefix}-${name}`, layout, violations });
  assert.deepEqual(violations, [], `${prefix}/${name}: accessibility violations`);
}

async function dbRows(page, store) {
  return page.evaluate(async storeName => {
    const { openDatabase, all } = await import('/js/db.js');
    const db = await openDatabase();
    const rows = await all(db, storeName);
    db.close();
    return rows;
  }, store);
}

async function unlock(page, pin = '1234') {
  await page.locator('#parent-entry').click();
  await page.locator('#pin-input').fill(pin);
  await page.locator('#pin-form button').click();
  await page.locator('#parent-content').waitFor({ state: 'visible' });
}

async function result(page, prefix, name) {
  await page.locator('#result-dialog').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
  const counters = await page.locator('.result-card').evaluateAll(cards => cards.map(card => ({
    label: card.getAttribute('aria-label'), value: card.querySelector('.result-number').textContent
  })));
  assert.ok(counters.every(counter => counter.label.includes(` ${counter.value} `)), 'count-up reaches its exact final value');
  await snapshot(page, prefix, name);
  await page.locator('#continue-adventure').click();
}

try {
  for (const viewport of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
    const prefix = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Tokyo', hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${prefix}: ${error.message}`));
    page.on('response', response => {
      if (/raw.githubusercontent.com\/PokeAPI|pokeapi.co\/api/.test(response.url())) network.push({ url: response.url(), status: response.status() });
    });
    await page.addInitScript(() => {
      window.audioEvidence = { contexts: 0, resumes: 0, notes: 0 };
      const NativeAudio = window.AudioContext;
      window.AudioContext = class extends NativeAudio {
        constructor(...args) { super(...args); window.audioEvidence.contexts++; }
        resume() { window.audioEvidence.resumes++; return super.resume(); }
        createOscillator() { window.audioEvidence.notes++; return super.createOscillator(); }
      };
    });
    await page.clock.setFixedTime(new Date('2026-10-17T12:00:00+09:00'));
    await page.goto(url);
    await page.locator('.pokemon-candidate').nth(5).waitFor({ timeout: 30000 });
    // Reproduce the parent's current-month legacy image before a fresh launch.
    await page.evaluate(async () => {
      const { openDatabase, put } = await import('/js/db.js');
      const db = await openDatabase();
      const artwork = await (await fetch(document.querySelector('.pokemon-candidate img').src)).blob();
      await put(db, 'months', { id: '2026-10', artType: 'image', artwork });
      await put(db, 'months', { id: '2026-06', artType: 'drawing', artwork });
      db.close();
    });
    await page.reload();
    await page.locator('.pokemon-candidate').nth(5).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#board-panel').isVisible(), false);
    assert.equal((await dbRows(page, 'months')).find(row => row.id === '2026-10').artType, 'image');
    await snapshot(page, prefix, '01-selection');
    await page.locator('#refresh-candidates').click();
    await page.waitForFunction(() => document.querySelector('#pokemon-candidates').classList.contains('flip'));
    await page.waitForFunction(() => !document.querySelector('#refresh-candidates').disabled);
    await page.locator('.pokemon-candidate').first().click();
    await snapshot(page, prefix, '02-confirm');
    await page.locator('#confirm-accept').click();
    await page.locator('#board-panel').waitFor({ state: 'visible', timeout: 30000 });
    assert.equal(await page.locator('#pokemon-name').textContent(), '？？？');
    assert.equal((await dbRows(page, 'weeks')).find(row => row.id === '2026-10-12').artType, 'pokemon');
    assert.equal((await dbRows(page, 'months')).find(row => row.id === '2026-10').artType, 'image');
    assert.equal(await page.locator('#month-grid .month-cell').count(), 7);
    await snapshot(page, prefix, '03-chosen');

    await page.locator('#open-record').click();
    await page.getByRole('button', { name: '読書', exact: true }).click();
    await page.getByRole('button', { name: '20分', exact: true }).click();
    await page.locator('#self-started').check();
    await snapshot(page, prefix, '04-record');
    await page.locator('summary').click();
    await page.locator('#entry-comment').fill('<img src=x onerror=alert(1)> つづきが楽しみ');
    await page.locator('#entry-question').fill('星の色が違うのはどうして？');
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 900;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(0, 0, 1600, 900);
      ctx.fillStyle = '#1d1b4b';
      ctx.font = '80px sans-serif';
      ctx.fillText('TEST PHOTO', 140, 480);
      return canvas.toDataURL().split(',')[1];
    });
    await page.locator('#entry-photo').setInputFiles({ name: 'test-photo.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
    await page.locator('#save-entry').click();
    await page.locator('#save-celebration').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#celebration-exp').textContent(), '+22 EXP');
    await snapshot(page, prefix, '05-first-reveal', false);
    await page.locator('#skip-celebration').click();
    assert.match(await page.locator('#result-badges').textContent(), /初めての記録/);
    await result(page, prefix, '05-result');
    assert.equal(await page.locator('#month-grid .open').count(), 1);
    const firstTile = await page.locator('#month-grid .open').getAttribute('data-tile');

    await page.locator('#open-record').click();
    await page.getByRole('button', { name: '昨日・16日' }).click();
    await page.getByRole('button', { name: '学校の宿題', exact: true }).click();
    await page.locator('#self-started').check();
    await page.locator('#save-entry').click();
    await page.locator('#save-celebration').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#celebration-exp').textContent(), '+15 EXP');
    const revealed = await page.locator('#celebration-board .just-opened').getAttribute('data-tile');
    assert.notEqual(revealed, firstTile, 'backfill must animate the newly opened position');
    await snapshot(page, prefix, '06-second-reveal', false);
    await page.locator('#save-celebration').waitFor({ state: 'hidden', timeout: 5000 });
    await result(page, prefix, '06-result');
    await snapshot(page, prefix, '07-home');
    assert.equal(await page.locator('#month-progress').textContent(), '2 / 7 マス');
    assert.equal(await page.locator('#exp-numbers').textContent(), '37 / 50 EXP');
    assert.equal((await dbRows(page, 'entries')).length, 2);
    await page.locator('#month-grid button[aria-label^="17日の記録"]').click();
    await snapshot(page, prefix, '08-day');
    assert.equal(await page.locator('#detail-content img').count(), 1, 'comment must remain text');
    await page.locator('[data-close]').click();

    // A third real form save on a third date; 30 minutes reaches today's goal.
    await page.clock.setFixedTime(new Date('2026-10-18T12:00:00+09:00'));
    await page.locator('#open-record').click();
    await page.getByRole('button', { name: '学校の宿題', exact: true }).click();
    await page.getByRole('button', { name: '30分', exact: true }).click();
    await page.locator('#save-entry').click();
    await page.locator('#save-celebration').waitFor({ state: 'visible' });
    await page.locator('#skip-celebration').click();
    assert.equal(await page.locator('#result-goal').isVisible(), true);
    assert.match(await page.locator('#result-badges').textContent(), /3日連続/);
    await result(page, prefix, '08-third-result');
    assert.equal(await page.locator('#streak-count').textContent(), '3日');
    assert.equal(await page.locator('#goal-ring').getAttribute('class'), 'goal-ring achieved');
    const positions = await page.locator('#month-grid .open').evaluateAll(nodes => nodes.map(node => Number(node.dataset.tile)));
    const priority = await page.evaluate(async () => {
      const { openDatabase, get } = await import('/js/db.js');
      const { withCoverage } = await import('/js/ui/board.js');
      const db = await openDatabase();
      const artwork = await withCoverage(await get(db, 'weeks', '2026-10-12'));
      db.close();
      return artwork.priority;
    });
    const prioritized = positions.filter(position => priority.includes(position));
    assert.equal(prioritized.length, Math.min(positions.length, priority.length), 'opaque tiles open first');
    assert.notDeepEqual(positions, [15, 16, 17], 'positions are not chronological calendar cells');
    evidence.push({ screen: `${prefix}-random-positions`, positions, priority });
    await snapshot(page, prefix, '08-third-home');

    // Use stored artwork to exercise complete, partial and unselected past months.
    // These synthetic records exist only in this disposable browser context.
    await page.evaluate(async () => {
      const { openDatabase, all, put } = await import('/js/db.js');
      const { monthDays } = await import('/js/core.js');
      const db = await openDatabase();
      const artwork = (await all(db, 'weeks')).find(week => week.id === '2026-10-12');
      for (const month of ['2026-09', '2026-08']) await put(db, 'months', { ...artwork, id: month });
      for (const date of [...monthDays('2026-09'), '2026-08-03', '2026-07-04']) {
        await put(db, 'entries', {
          id: `fixture-${date}`, date, categoryId: 'reading', minutes: 5,
          selfStarted: false, comment: '', question: '', photo: null, createdAt: 1
        });
      }
      db.close();
    });
    await page.locator('[data-view="album"]').click();
    await page.locator('.album-card').nth(2).waitFor();
    await snapshot(page, prefix, '09-collection');
    assert.equal(await page.locator('#collection-count').textContent(), '図鑑 1 / 1025');
    assert.equal(await page.locator('.badge-card').count(), 10);
    assert.equal(await page.locator('.album-card').first().locator('.album-tile.open').count(), 3);
    await page.getByRole('button', { name: 'アバターにする', exact: true }).click();
    await page.getByRole('button', { name: 'アバターに設定中', exact: true }).waitFor();
    await page.locator('[data-view="home"]').click();
    await page.waitForFunction(() => Boolean(document.querySelector('#player-avatar img:not(.silhouette)')));
    await snapshot(page, prefix, '09-avatar');
    await page.locator('[data-view="album"]').click();
    assert.equal(await page.locator('.question-note').count(), 1);
    await page.locator('#parent-entry').click();
    await snapshot(page, prefix, '10-pin');
    await page.locator('#pin-input').fill('1234');
    await page.locator('#pin-form button').click();
    await page.locator('#parent-content').waitFor({ state: 'visible' });
    await snapshot(page, prefix, '11-parent');
    await page.locator('#daily-goal').fill('45');
    await page.locator('#sound-enabled').uncheck();
    await page.locator('#adventure-form button').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '冒険の設定を保存しました');
    const quietNotes = await page.evaluate(() => window.audioEvidence.notes);
    await page.locator('#new-category-name').fill('テスト課題');
    await page.locator('#category-form button').click();
    await page.locator('input[aria-label="テスト課題の名前"]').waitFor();
    await page.locator('#new-category-name').fill('工作');
    await page.locator('#category-form button').click();
    await page.locator('input[aria-label="工作の名前"]').waitFor();
    const customColors = (await dbRows(page, 'settings')).find(row => row.key === 'categoryColors').value;
    const addedCategories = (await dbRows(page, 'categories'));
    assert.equal(customColors[addedCategories.find(row => row.name === 'テスト課題').id], 4);
    assert.equal(customColors[addedCategories.find(row => row.name === '工作').id], 5);
    const edited = page.locator('.category-row').filter({ has: page.locator('input[aria-label="テスト課題の名前"]') });
    await edited.locator('input').nth(1).fill('新しい項目名');
    await edited.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('input[aria-label="新しい項目名の名前"]').waitFor();
    assert.deepEqual((await dbRows(page, 'settings')).find(row => row.key === 'categoryColors').value, customColors);
    await page.locator('#nickname-input').fill('ソラ');
    await page.locator('#nickname-form button').click();
    const reply = page.locator('.reply-form').first();
    await reply.locator('select').selectOption('🌟 すごい');
    await reply.locator('input').fill('発見を教えてくれてありがとう！');
    await reply.locator('button').click();
    await page.locator('#parent-back').click();
    await page.waitForFunction(() => document.querySelector('#player-name').textContent === 'ソラ');
    assert.equal(await page.locator('#player-name').textContent(), 'ソラ');
    await page.locator('#new-badge').waitFor({ state: 'visible' });
    await page.locator('#reply-button').click();
    await snapshot(page, prefix, '12-reply');
    assert.equal((await dbRows(page, 'replies'))[0].seen, true);
    await page.locator('[data-close]').click();
    await page.locator('#new-badge').waitFor({ state: 'hidden' });

    await unlock(page);
    await page.locator('#change-pin').click();
    await page.locator('#pin-input').fill('5678');
    await page.locator('#pin-form button').click();
    await page.locator('#parent-lock').click();
    await page.locator('#pin-input').fill('1234');
    await page.locator('#pin-form button').click();
    await page.getByText('PINが違います。', { exact: true }).waitFor();
    await page.locator('#pin-input').fill('5678');
    await page.locator('#pin-form button').click();
    await page.locator('#parent-content').waitFor({ state: 'visible' });

    const category = page.locator('.category-row').first();
    await category.getByRole('button', { name: '表示中' }).click();
    await page.locator('#parent-back').click();
    await page.locator('#open-record').click();
    assert.equal(await page.getByRole('button', { name: '学校の宿題', exact: true }).getAttribute('data-color'), '1');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#record-sheet').evaluate(node => node.open), false);
    await unlock(page, '5678');
    const before = (await dbRows(page, 'entries')).length;
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-button').click();
    const download = await downloadPromise;
    const backup = await readFile(await download.path());
    const parsed = JSON.parse(backup.toString());
    referenceBackup = parsed;
    assert.equal(parsed.formatVersion, 3);
    assert.equal(parsed.weeks.length, 1);
    assert.equal(parsed.entries.length, before);
    assert.ok(parsed.entries.some(entry => entry.photo?.startsWith('data:image/jpeg;base64,')));
    assert.equal(parsed.settings.find(item => item.key === 'nickname').value.name, 'ソラ');
    assert.deepEqual(parsed.settings.find(item => item.key === 'adventure').value, { dailyGoal: 45, soundEnabled: false, avatarMonth: '2026-09' });
    assert.equal(await page.evaluate(() => window.audioEvidence.notes), quietNotes, 'disabled sound creates no more notes');
    assert.ok(quietNotes > 0, 'real Web Audio oscillators played before mute');
    await page.locator('#parent-entries').getByRole('button', { name: 'この記録を削除' }).first().click();
    await page.locator('#confirm-accept').click();
    await page.waitForFunction(async expected => {
      const { openDatabase, all } = await import('/js/db.js');
      const db = await openDatabase();
      const count = (await all(db, 'entries')).length;
      db.close();
      return count === expected;
    }, before - 1);
    await page.locator('#import-file').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
    await page.locator('#confirm-accept').click();
    await page.locator('#pin-gate').waitFor({ state: 'visible' });
    assert.equal((await dbRows(page, 'entries')).length, before);
    await page.locator('#parent-back').click();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.locator('#board-panel').waitFor({ state: 'visible' });
    await context.setOffline(true);
    await page.reload();
    await page.locator('#board-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#month-progress').textContent(), '3 / 7 マス');
    assert.equal(await page.locator('#goal-target').textContent(), '/ 45 分');
    assert.equal(await page.locator('#player-avatar img:not(.silhouette)').count(), 1);
    await snapshot(page, prefix, '13-offline');
    await context.setOffline(false);
    await context.close();
    console.log(`${prefix}: main flow, replies, PIN, categories, backup and offline passed`);
  }

  const context = await browser.newContext({
    viewport: { width: 820, height: 1180 }, timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`edges: ${error.message}`));
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00+09:00'));
  await page.goto(url);
  await page.locator('#exp-numbers').waitFor();
  const seedWeek = async (date, count, settings = []) => {
    await page.clock.setFixedTime(new Date(`${date}T12:00:00+09:00`));
    await page.evaluate(async ({ backup, date, count, settings }) => {
      const { openDatabase, importBackup } = await import('/js/db.js');
      const { weekKey, weekDays } = await import('/js/core.js');
      const db = await openDatabase();
      const id = weekKey(date);
      const artwork = { ...backup.weeks[0], id };
      const entries = weekDays(id).slice(0, count).map((date, index) => ({
        id: `completion-${index}`, date, categoryId: 'reading', minutes: 10,
        selfStarted: false, comment: '', question: '', photo: null, createdAt: index
      }));
      await importBackup(db, { ...backup, entries, weeks: [artwork], months: [], replies: [], settings });
      db.close();
    }, { backup: referenceBackup, date, count, settings });
    await page.reload();
    await page.locator('#board-panel').waitFor({ state: 'visible' });
  };
  await seedWeek('2026-10-18', 6);
  await page.locator('#month-grid .open').nth(5).waitFor();
  await page.locator('#open-record').click();
  await page.getByRole('button', { name: '学校の宿題', exact: true }).click();
  await page.locator('#save-entry').click();
  await page.locator('#save-celebration').waitFor({ state: 'visible' });
  assert.match(await page.locator('#celebration-title').textContent(), /をゲット！$/);
  assert.equal(await page.locator('#month-grid .open').count(), 7);
  assert.equal(await page.locator('#celebration-partner img').evaluate(node => getComputedStyle(node).animationName), 'none');
  await snapshot(page, 'edges', '14-complete-reduced-motion', false);
  await page.locator('#skip-celebration').click();
  assert.match(await page.locator('#result-badges').textContent(), /ポケモン初ゲット/);
  await result(page, 'edges', '14-result-reduced-motion');
  assert.notEqual(await page.locator('#pokemon-name').textContent(), '？？？');
  await page.locator('[data-view="album"]').click();
  await page.locator('.album-card img:not(.silhouette)').waitFor();
  assert.equal(await page.locator('.album-card img:not(.silhouette)').count(), 1);
  await page.getByRole('button', { name: 'アバターにする', exact: true }).click();
  await page.getByRole('button', { name: 'アバターに設定中', exact: true }).waitFor();
  assert.equal((await dbRows(page, 'settings')).find(row => row.key === 'adventure').value.avatarMonth, '2026-10-12');
  await page.locator('[data-view="home"]').click();
  const immutable = await page.evaluate(async () => {
    const { openDatabase, all, choosePokemonWeek } = await import('/js/db.js');
    const db = await openDatabase();
    const original = (await all(db, 'weeks'))[0];
    const result = await choosePokemonWeek(db, { ...original, pokemonName: '変更できない' });
    const unchanged = (await all(db, 'weeks'))[0].pokemonName === original.pokemonName;
    db.close();
    return { result, unchanged };
  });
  assert.deepEqual(immutable, { result: false, unchanged: true });

  // A fresh fifth date reaches level 2; removing it recomputes EXP downward.
  await seedWeek('2026-10-16', 4);
  await page.waitForFunction(() => document.querySelector('#exp-numbers').textContent === '40 / 50 EXP');
  await page.locator('#open-record').click();
  await page.getByRole('button', { name: '学校の宿題', exact: true }).click();
  await page.locator('#save-entry').click();
  await page.locator('#save-celebration').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#celebration-extra').textContent(), 'レベルアップ！ Lv.2');
  assert.equal(await page.locator('#month-grid .open').count(), 5);
  await snapshot(page, 'edges', '15-level-up', false);
  await page.locator('#skip-celebration').click();
  await result(page, 'edges', '15-result');
  await unlock(page);
  await page.locator('#parent-entries').getByRole('button', { name: 'この記録を削除' }).first().click();
  await page.locator('#confirm-accept').click();
  await page.locator('#parent-back').click();
  await page.waitForFunction(() => document.querySelector('#level-badge').textContent === 'Lv.1');

  // Monday can backfill the previous Sunday, completing the previous week.
  await seedWeek('2026-11-01', 6);
  await page.clock.setFixedTime(new Date('2026-11-02T12:00:00+09:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('#month-label').textContent === '11月2日〜8日');
  await page.locator('#open-record').click();
  await page.getByRole('button', { name: '昨日・1日' }).click();
  await page.getByRole('button', { name: '学校の宿題', exact: true }).click();
  await page.locator('#save-entry').click();
  await page.locator('#save-celebration').waitFor({ state: 'visible' });
  assert.match(await page.locator('#celebration-title').textContent(), /をゲット！$/);
  assert.equal(await page.locator('#celebration-partner img:not(.silhouette)').count(), 1);
  await snapshot(page, 'edges', '16-previous-week', false);
  await page.locator('#skip-celebration').click();
  await result(page, 'edges', '16-result');
  assert.equal(await page.locator('#board-panel').isVisible(), false);

  // Separate tabs serialize weekly selection and daily replacement.
  const other = await context.newPage();
  await other.goto(url);
  const chooseInTab = tab => tab.evaluate(async () => {
    const { openDatabase, all, choosePokemonWeek } = await import('/js/db.js');
    const db = await openDatabase();
    const original = (await all(db, 'weeks'))[0];
    const saved = await choosePokemonWeek(db, { ...original, id: '2026-11-02' });
    db.close();
    return saved;
  });
  const race = await Promise.all([chooseInTab(page), chooseInTab(other)]);
  assert.deepEqual(race.sort(), [false, true]);
  const replaceInTab = (tab, minutes) => tab.evaluate(async minutes => {
    const { openDatabase, saveDayEntries } = await import('/js/db.js');
    const db = await openDatabase();
    const saved = await saveDayEntries(db, '2026-11-02', [{ id: `race-${minutes}`, date: '2026-11-02', categoryId: 'reading', minutes,
      selfStarted: false, comment: '', question: '', photo: null, createdAt: minutes }]);
    db.close();
    return { editing: saved.editing, id: saved.entries[0].id };
  }, minutes);
  const saves = await Promise.all([replaceInTab(page, 10), replaceInTab(other, 20)]);
  assert.deepEqual(saves.map(row => row.editing).sort(), [false, true]);
  assert.equal(saves[0].id, saves[1].id);
  assert.equal((await dbRows(page, 'entries')).filter(entry => entry.date === '2026-11-02').length, 1);
  await other.close();
  evidence.push({ screen: 'edges-two-tabs', choiceWinners: 1, dailyRows: 1, sameID: true });

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedWeek('2026-10-18', 6);
  await page.locator('#open-record').click();
  await page.getByRole('button', { name: '学校の宿題', exact: true }).click();
  await page.locator('#save-entry').click();
  await page.locator('#save-celebration').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#celebration-partner img').evaluate(node => getComputedStyle(node).animationName), 'name-reveal');
  await snapshot(page, 'edges', '17-complete-color', false);
  await page.locator('#skip-celebration').click();
  await result(page, 'edges', '17-complete-result');

  // A name request finishing after Monday must not choose last week's partner.
  await page.clock.setFixedTime(new Date('2026-11-01T23:59:59+09:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#selection-panel').waitFor({ state: 'visible' });
  await page.locator('.pokemon-candidate').nth(5).waitFor({ timeout: 30000 });
  let releaseSpecies;
  const release = new Promise(resolve => { releaseSpecies = resolve; });
  let speciesRequested;
  const requested = new Promise(resolve => { speciesRequested = resolve; });
  await page.route('https://pokeapi.co/api/v2/pokemon-species/*', async route => {
    speciesRequested(); await release; await route.continue();
  });
  await page.locator('.pokemon-candidate').first().click();
  await page.locator('#confirm-accept').click();
  await requested;
  await page.clock.setFixedTime(new Date('2026-11-02T00:00:01+09:00'));
  releaseSpecies();
  await page.waitForFunction(() => document.querySelector('#month-label').textContent === '11月2日〜8日', null, { timeout: 30000 });
  await page.locator('.pokemon-candidate').nth(5).waitFor({ timeout: 30000 });
  assert.equal((await dbRows(page, 'weeks')).some(week => week.id === '2026-10-26'), false);
  await snapshot(page, 'edges', '18-live-week-rollover');
  await context.close();

  // Upgrade a real version-2 database with existing data, then read v1/v2 backups.
  const legacyContext = await browser.newContext({ viewport: { width: 820, height: 1180 }, timezoneId: 'Asia/Tokyo' });
  const legacyPage = await legacyContext.newPage();
  await legacyPage.route('**/js/app.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await legacyPage.goto(url);
  await legacyPage.evaluate(async backup => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('mainichi-kiroku', 2);
      request.onupgradeneeded = () => {
        for (const name of ['entries', 'months', 'categories', 'settings', 'replies']) request.result.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(['entries', 'months', 'categories', 'settings', 'replies'], 'readwrite');
    for (const name of ['entries', 'categories', 'settings', 'replies']) for (const row of backup[name]) {
      tx.objectStore(name).put(name === 'entries' ? { ...row, photo: null } : row);
    }
    tx.objectStore('months').put({ id: '2026-10', artType: 'default', artwork: null });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, referenceBackup);
  await legacyPage.unroute('**/js/app.js');
  await legacyPage.reload();
  await legacyPage.locator('#exp-numbers').waitFor();
  const migration = await legacyPage.evaluate(async () => {
    const { openDatabase, exportBackup, importBackup } = await import('/js/db.js');
    const db = await openDatabase();
    const upgraded = await exportBackup(db);
    const old = { ...upgraded, formatVersion: 2 }; delete old.weeks;
    await importBackup(db, old);
    const restored = await exportBackup(db);
    const v1 = { ...old, formatVersion: 1 }; delete v1.replies; delete v1.settings;
    await importBackup(db, v1);
    const oldest = await exportBackup(db);
    db.close();
    return { version: upgraded.formatVersion, weeks: upgraded.weeks.length,
      preserved: ['entries', 'months', 'categories', 'replies', 'settings'].every(key => JSON.stringify(upgraded[key]) === JSON.stringify(restored[key])),
      oldestEntries: oldest.entries.length, oldestMonths: oldest.months.length };
  });
  assert.deepEqual(migration, { version: 3, weeks: 0, preserved: true, oldestEntries: referenceBackup.entries.length, oldestMonths: 1 });
  evidence.push({ screen: 'edges-v2-database-v1-v2-backups', ...migration });
  await legacyContext.close();
  console.log('edges: weekly completion, previous Sunday, concurrency, rollover, legacy DB and backup migration passed');
  assert.deepEqual(errors, [], 'browser runtime errors');
} finally {
  await writeFile(join(output, 'browser-results.json'), JSON.stringify({ evidence, errors, network }, null, 2));
  await browser.close();
}
