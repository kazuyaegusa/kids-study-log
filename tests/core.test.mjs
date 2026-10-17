import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, yesterdayKey, daysInMonth, monthDays, summarizeMonth, isValidDateKey, pokemonTileOrder, pokemonTileDates, migrateBackup, validateBackup, entryExp, totalExp, levelInfo } from '../js/core.js';
import { tileGeometry } from '../js/ui/board.js';
import { streakInfo, badgeStatus, completedPokemon, weekKey, weekDays, periodLabel, summarizePeriod, replaceDayEntries } from '../js/core.js';

const recorded = dates => dates.map(date => ({ date }));
test('streak counts unique dates, ignores future entries and waits for today', () => {
  assert.equal(streakInfo([], '2026-10-17').current, 0);
  const entries = recorded(['2026-10-15', '2026-10-16', '2026-10-16', '2026-10-18']);
  const info = streakInfo(entries, '2026-10-17');
  assert.equal(info.current, 2);
  assert.equal(info.recordedToday, false);
  assert.equal(info.longest, 2);
  assert.equal(info.restarting, false);
  assert.throws(() => streakInfo([], '2026-02-30'));
});

test('a missing day breaks the run and two days since the last record resets current', () => {
  const entries = recorded(['2026-10-12', '2026-10-14', '2026-10-16']);
  const info = streakInfo(entries, '2026-10-16');
  assert.equal(info.current, 1);
  assert.equal(info.longest, 1);
  assert.equal(info.recordedToday, true);
  assert.equal(streakInfo(entries, '2026-10-17').current, 1);
  assert.equal(streakInfo(entries, '2026-10-18').restarting, true);
  assert.equal(streakInfo(entries, '2026-10-18').current, 0);
  assert.equal(streakInfo(recorded(['2020-01-01']), '2026-10-18').current, 0);
});

test('consecutive days cross week, month, year and leap-day boundaries', () => {
  for (const dates of [
    ['2026-10-11', '2026-10-12'],
    ['2026-10-31', '2026-11-01'],
    ['2026-12-31', '2027-01-01'],
    ['2024-02-28', '2024-02-29', '2024-03-01']
  ]) {
    const info = streakInfo(recorded(dates), dates.at(-1));
    assert.equal(info.current, dates.length);
    assert.equal(info.longest, dates.length);
  }
  assert.equal(streakInfo(recorded(['2024-02-28', '2024-03-01']), '2024-03-01').current, 1);
});

test('backfill and deletion recompute current, longest and badges', () => {
  const dates = ['2026-10-12', '2026-10-14', '2026-10-15'];
  const filled = recorded([...dates, '2026-10-13']);
  assert.equal(streakInfo(filled, '2026-10-16').current, 4);
  assert.equal(streakInfo(recorded(dates), '2026-10-16').current, 2);
  assert.equal(streakInfo(filled, '2026-10-18').longest, 4);
  assert.equal(badgeStatus(filled, []).find(badge => badge.id === 'streak3').earned, true);
  assert.equal(badgeStatus(recorded(dates), []).find(badge => badge.id === 'streak3').earned, false);
});

test('badges have ten defined goals and derive progress from records and completed Pokemon', () => {
  assert.equal(badgeStatus([], []).length, 10);
  assert.ok(badgeStatus([], []).every(badge => !badge.earned));
  const entries = monthDays('2026-10').map(date => ({ date, categoryId: 'reading', minutes: 10, selfStarted: true, question: 'なぜ？' }));
  const months = [{ id: '2026-10', artType: 'pokemon', pokemonId: 25 }];
  const badges = badgeStatus(entries, months);
  assert.equal(badges.filter(badge => badge.earned).length, 9);
  assert.equal(badges.find(badge => badge.id === 'records100').earned, false);
  assert.equal(completedPokemon(entries, months).length, 1);
  assert.equal(badgeStatus(entries.slice(1), months).find(badge => badge.id === 'pokemon').earned, false);
  assert.equal(badgeStatus(entries, [{ ...months[0], artType: 'image' }]).find(badge => badge.id === 'pokemon').earned, false);
  assert.equal(badgeStatus([...entries, ...entries, ...entries, ...entries], months).find(badge => badge.id === 'records100').earned, true);
  assert.equal(badgeStatus([{ date: '2026-10-17', categoryId: 'school', minutes: 60, question: '  ' }], []).find(badge => badge.id === 'questions').progress, 0);
});

test('opaque tile priority keeps a seeded permutation with stable remaining positions', () => {
  const priority = [8, 10, 12, 15, 17];
  const order = pokemonTileOrder('2026-10', 25, priority);
  assert.deepEqual(order.slice(0, 5).sort((a, b) => a - b), priority);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 31 }, (_, i) => i));
  assert.deepEqual(order, pokemonTileOrder('2026-10', 25, priority));
  const before = pokemonTileDates(recorded(['2026-10-17']), '2026-10', 25, priority);
  const after = pokemonTileDates(recorded(['2026-10-16', '2026-10-17']), '2026-10', 25, priority);
  assert.ok(after.has([...before.keys()][0]));
  assert.ok([...after.keys()].every(index => priority.includes(index)));
});

test('backup accepts new settings and rejects malformed goal, sound and avatar', () => {
  const data = fixture();
  data.settings.push({ key: 'adventure', value: { dailyGoal: 30, soundEnabled: true, avatarMonth: '2026-09' } });
  assert.doesNotThrow(() => validateBackup(data));
  for (const patch of [{ dailyGoal: 0 }, { dailyGoal: 181 }, { dailyGoal: 30.5 }, { dailyGoal: '30' }, { soundEnabled: 1 }, { avatarMonth: '2026-13' }, { avatarMonth: 25 }]) {
    const invalid = structuredClone(data);
    Object.assign(invalid.settings.at(-1).value, patch);
    assert.throws(() => validateBackup(invalid), /冒険/);
  }
  data.settings.at(-1).value = { dailyGoal: 5, soundEnabled: false, avatarMonth: null };
  assert.doesNotThrow(() => validateBackup(data));
});

test('each EXP bonus is independent, whitespace gives no question bonus', () => {
  for (const selfStarted of [false, true]) {
    for (const question of ['', '  ', 'なぜ？']) {
      for (const photo of [null, new Blob(['photo'])]) {
        const expected = 10 + (selfStarted ? 5 : 0) + (question.trim() ? 5 : 0) + (photo ? 2 : 0);
        assert.equal(entryExp({ selfStarted, question, photo }), expected);
      }
    }
  }
  assert.equal(totalExp([]), 0);
});

test('level boundaries, fractional points and invalid numbers', () => {
  for (let level = 2; level <= 100; level++) {
    const threshold = 50 * level * (level - 1) / 2;
    assert.deepEqual(levelInfo(threshold), { level, current: 0, next: 50 * level });
    assert.equal(levelInfo(threshold - 1).level, level - 1);
  }
  assert.deepEqual(levelInfo(-1), levelInfo(0));
  assert.deepEqual(levelInfo(49.9), levelInfo(49));
  for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => levelInfo(value), RangeError);
});

test('every month covers the entire artwork without filler or overlapping tiles', () => {
  for (const count of [28, 29, 30, 31]) {
    const occupied = new Set();
    for (let index = 0; index < count; index++) {
      const { row, column, span, rows } = tileGeometry(index, count);
      assert.equal(rows, Math.ceil(count / 7));
      for (let x = column; x < column + span; x++) {
        const key = `${row}:${x}`;
        assert.equal(occupied.has(key), false);
        occupied.add(key);
      }
    }
    assert.equal(occupied.size, Math.ceil(count / 7) * 7);
  }
});

test('backfilling yesterday opens one new position while preserving earlier positions', () => {
  const before = pokemonTileDates([{ date: '2026-10-17' }], '2026-10', 25);
  const after = pokemonTileDates([{ date: '2026-10-17' }, { date: '2026-10-16' }], '2026-10', 25);
  const added = [...after.keys()].filter(index => !before.has(index));
  assert.equal(added.length, 1);
  assert.equal(after.get(added[0]), '2026-10-17');
  assert.ok(after.has([...before.keys()][0]));
});

test('EXP adds entry bonuses and levels follow cumulative thresholds', () => {
  const entries = [
    { selfStarted: false, question: '', photo: null },
    { selfStarted: true, question: 'どうして？', photo: { size: 1 } }
  ];
  assert.equal(entryExp(entries[0]), 10);
  assert.equal(entryExp(entries[1]), 22);
  assert.equal(totalExp(entries), 32);
  assert.equal(totalExp(entries.slice(0, 1)), 10);
  assert.deepEqual(levelInfo(0), { level: 1, current: 0, next: 50 });
  assert.deepEqual(levelInfo(50), { level: 2, current: 0, next: 100 });
  assert.deepEqual(levelInfo(149), { level: 2, current: 99, next: 100 });
  assert.deepEqual(levelInfo(150), { level: 3, current: 0, next: 150 });
});

test('local date and yesterday cross month and year boundaries', () => {
  const date = new Date(2026, 0, 1, 14);
  assert.equal(localDateKey(date), '2026-01-01');
  assert.equal(yesterdayKey(date), '2025-12-31');
});

test('month cells use the exact number of days, including leap year', () => {
  assert.equal(daysInMonth('2024-02'), 29);
  assert.equal(daysInMonth('2025-02'), 28);
  assert.deepEqual([monthDays('2024-02')[0], monthDays('2024-02').at(-1)], ['2024-02-01', '2024-02-29']);
  assert.throws(() => daysInMonth('2024-13'));
  assert.equal(isValidDateKey('2024-02-29'), true);
  assert.equal(isValidDateKey('2025-02-29'), false);
});

test('monthly summary counts records and unique self started days', () => {
  const entries = [
    { date: '2026-10-01', minutes: 10, selfStarted: true },
    { date: '2026-10-01', minutes: 20, selfStarted: true },
    { date: '2026-10-02', minutes: 5, selfStarted: false },
    { date: '2026-09-30', minutes: 60, selfStarted: true }
  ];
  assert.deepEqual(summarizeMonth(entries, '2026-10'), { count: 3, minutes: 35, selfDays: 1, activeDays: 2 });
});

test('pokemon tile order is a stable permutation keyed by month and ID', () => {
  const order = pokemonTileOrder('2026-10', 25);
  assert.deepEqual(order, pokemonTileOrder('2026-10', 25));
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 31 }, (_, i) => i));
  assert.notDeepEqual(order, pokemonTileOrder('2026-10', 26));
  assert.notDeepEqual(order, pokemonTileOrder('2026-11', 25));
  assert.throws(() => pokemonTileOrder('2026-10', 1026));
  const opened = pokemonTileDates([{ date: '2026-10-02' }, { date: '2026-10-01' }, { date: '2026-10-01' }], '2026-10', 25);
  assert.deepEqual([...opened], [[order[0], '2026-10-01'], [order[1], '2026-10-02']]);
});

const fixture = () => ({
  formatVersion: 3,
  weeks: [],
  entries: [{ id: 'e1', date: '2026-10-17', categoryId: 'reading', minutes: 15, selfStarted: true, comment: 'たのしい', question: 'なぜ？', photo: null, createdAt: 123 }],
  months: [{ id: '2026-10', artType: 'image', artwork: 'data:image/jpeg;base64,AA==' }],
  categories: [{ id: 'reading', name: '読書', icon: '📚', visible: true }],
  settings: [{ key: 'pin', value: { method: 'simple', hash: 'abc12345' } }],
  replies: [{ id: 'e1', stamp: 'いいね', comment: 'よかったね', seen: false, updatedAt: 456 }]
});

test('backup validates referential data and images', () => {
  const data = fixture();
  assert.equal(validateBackup(data), data);
  data.entries[0].categoryId = 'missing';
  assert.throws(() => validateBackup(data), /記録/);
  data.entries[0].categoryId = 'reading';
  data.months[0].artwork = 'https://example.com/image.jpg';
  assert.throws(() => validateBackup(data), /月の絵/);
  data.months[0].artwork = 'data:image/jpeg;base64,a';
  assert.throws(() => validateBackup(data), /月の絵/);
});

test('backup accepts Pokemon PNG and keeps legacy artwork', () => {
  const data = fixture();
  data.months.push({ id: '2026-09', artType: 'drawing', artwork: 'data:image/jpeg;base64,AA==' });
  data.months[0] = { id: '2026-10', artType: 'pokemon', pokemonId: 25, pokemonName: 'ピカチュウ', artwork: 'data:image/png;base64,AA==' };
  assert.doesNotThrow(() => validateBackup(data));
  for (const patch of [{ pokemonId: 0 }, { pokemonId: 1026 }, { pokemonName: '' }, { artwork: 'data:image/jpeg;base64,AA==' }]) {
    const invalid = structuredClone(data); Object.assign(invalid.months[0], patch);
    assert.throws(() => validateBackup(invalid), /月の絵/);
  }
});

test('backup rejects duplicate IDs, invalid dates and orphan replies', () => {
  const data = fixture(); data.entries.push({ ...data.entries[0] });
  assert.throws(() => validateBackup(data), /記録/);
  data.entries.pop(); data.entries[0].date = '2026-02-30';
  assert.throws(() => validateBackup(data), /記録/);
  data.entries[0].date = '2026-10-17'; data.replies[0].id = 'orphan';
  assert.throws(() => validateBackup(data), /返信/);
});

test('version 1 backup migrates to version 3 and unknown version stops', () => {
  const old = fixture(); old.formatVersion = 1; delete old.replies; delete old.settings;
  const migrated = migrateBackup(old);
  assert.equal(migrated.formatVersion, 3);
  assert.deepEqual(migrated.replies, []);
  assert.deepEqual(migrated.settings, []);
  assert.equal(validateBackup(old).formatVersion, 3);
  assert.throws(() => migrateBackup({ formatVersion: 99 }), /対応していない/);
});

test('backup rejects PIN settings that could never be unlocked', () => {
  for (const value of [{}, { method: 'simple', hash: 'abc' }, { method: 'sha256', hash: 'abc12345' }, { method: 'md5', hash: 'abc12345' }]) {
    const data = fixture();
    data.settings[0].value = value;
    assert.throws(() => validateBackup(data), /PIN/);
  }
  const data = fixture();
  data.settings[0].value = { method: 'sha256', hash: 'a'.repeat(64) };
  assert.doesNotThrow(() => validateBackup(data));
});

test('saved dates keep the seeded opening order', () => {
  const order = pokemonTileOrder('2026-10', 25);
  assert.equal(order.length, 31);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 31 }, (_, i) => i));
  assert.deepEqual(pokemonTileOrder('2026-10', 25), order);
  const entries = [
    { date: '2026-10-17' },
    { date: '2026-10-16' }
  ];
  assert.deepEqual([...pokemonTileDates(entries, '2026-10', 25)], [
    [order[0], '2026-10-16'],
    [order[1], '2026-10-17']
  ]);
});


test('local Monday week keys cross Sunday, month and year boundaries', () => {
  for (const [date, expected] of [
    ['2026-10-11', '2026-10-05'], ['2026-10-12', '2026-10-12'],
    ['2026-11-01', '2026-10-26'], ['2026-11-02', '2026-11-02'],
    ['2027-01-01', '2026-12-28'], ['2027-01-03', '2026-12-28'],
    ['2027-01-04', '2027-01-04']
  ]) assert.equal(weekKey(date), expected);
  assert.equal(weekKey(new Date(2026, 9, 12, 0, 0, 1)), '2026-10-12');
  assert.equal(weekKey(new Date(2026, 9, 11, 23, 59, 59)), '2026-10-05');
  assert.deepEqual(weekDays('2026-12-28'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(periodLabel('2026-10-12'), '10月12日〜18日');
  assert.equal(periodLabel('2026-10-26'), '10月26日〜11月1日');
  assert.equal(periodLabel('2026-12-28'), '12月28日〜2027年1月3日');
  assert.throws(() => weekDays('2026-10-13'));
  assert.throws(() => weekKey('2026-02-30'));
});

test('weekly tiles use a seeded seven-position permutation and coverage priority', () => {
  const key = '2026-10-26';
  const order = pokemonTileOrder(key, 25, [2, 3, 4]);
  assert.deepEqual(order, pokemonTileOrder(key, 25, [2, 3, 4]));
  assert.deepEqual([...order].sort(), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(order.slice(0, 3).sort(), [2, 3, 4]);
  assert.notDeepEqual(order, pokemonTileOrder('2026-11-02', 25, [2, 3, 4]));
  const dates = weekDays(key);
  for (let count = 1; count <= 7; count++) {
    const entries = recorded([...dates.slice(0, count), dates[0], '2026-10-25', '2026-11-02']);
    const opened = pokemonTileDates(entries, key, 25, [2, 3, 4]);
    assert.deepEqual([...opened.keys()], order.slice(0, count));
    assert.deepEqual([...opened.values()], dates.slice(0, count));
    assert.equal(completedPokemon(entries, [{ id: key, artType: 'pokemon' }]).length, count === 7 ? 1 : 0);
  }
  assert.equal(summarizePeriod(recorded(dates), key).activeDays, 7);
});

test('seven tiles cover all of a three-row image without gaps or overlaps', () => {
  const occupied = new Set();
  for (let index = 0; index < 7; index++) {
    const { rows, columns, row, column, span } = tileGeometry(index, 7);
    assert.equal(rows, 3);
    assert.equal(columns, 6);
    for (let x = column; x < column + span; x++) {
      const key = `${row}:${x}`;
      assert.equal(occupied.has(key), false);
      occupied.add(key);
    }
  }
  assert.equal(occupied.size, 18);
});

test('daily replacement retains IDs, removes omitted rows and never adds a second daily record', () => {
  const base = fixture().entries[0];
  const old = [base, { ...base, id: 'school', categoryId: 'school' },
    { ...base, id: 'yesterday', date: '2026-10-16' }];
  const proposed = [{ ...base, id: 'new-reading', minutes: 30, createdAt: 999 },
    { ...base, id: 'research', categoryId: 'research' }];
  const result = replaceDayEntries(old, base.date, proposed);
  assert.equal(result.editing, true);
  assert.deepEqual(result.deletedIds, ['school']);
  assert.equal(result.entries[0].id, base.id);
  assert.equal(result.entries[0].createdAt, base.createdAt);
  assert.equal(result.entries[0].minutes, 30);
  assert.equal(result.entries[0].question, base.question);
  const next = [old[2], ...result.entries];
  const repeated = replaceDayEntries(next, base.date, proposed);
  assert.deepEqual(repeated.entries, result.entries);
  assert.deepEqual(repeated.deletedIds, []);
  assert.equal(totalExp(repeated.entries), totalExp(result.entries));
  assert.equal(streakInfo(next, base.date).current, 2);
  assert.throws(() => replaceDayEntries(old, base.date, []));
  assert.throws(() => replaceDayEntries(old, base.date, [proposed[0], proposed[0]]));
  assert.throws(() => replaceDayEntries(old, '2026-10-16', proposed));
  assert.equal(replaceDayEntries([], base.date, proposed).editing, false);
});

test('omitting a legacy duplicate removes only that entry', () => {
  const base = fixture().entries[0];
  const result = replaceDayEntries([{ ...base, id: 'later', createdAt: 999 }, base], base.date, [{ ...base, id: 'new' }]);
  assert.equal(result.entries[0].id, 'e1');
  assert.deepEqual(result.deletedIds, ['later']);
});

test('weekly backups round trip and v2 backups preserve monthly data', () => {
  const data = fixture();
  data.weeks = [{ id: '2026-10-12', artType: 'pokemon', pokemonId: 25, pokemonName: 'ピカチュウ', artwork: 'data:image/png;base64,AA==' }];
  data.settings.push({ key: 'adventure', value: { avatarMonth: '2026-10-12' } });
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(data))), data);
  for (const patch of [{ id: '2026-10-13' }, { id: '2026-02-30' }, { pokemonId: 0 }, { pokemonName: '' }, { artwork: null }, { artwork: 'data:image/jpeg;base64,AA==' }]) {
    const invalid = structuredClone(data);
    Object.assign(invalid.weeks[0], patch);
    assert.throws(() => validateBackup(invalid), /週の相棒/);
  }
  const duplicate = structuredClone(data);
  duplicate.weeks.push(duplicate.weeks[0]);
  assert.throws(() => validateBackup(duplicate), /週の相棒/);
  const old = fixture(); old.formatVersion = 2; delete old.weeks;
  const migrated = validateBackup(old);
  assert.equal(migrated.formatVersion, 3);
  assert.deepEqual(migrated.weeks, []);
  for (const key of ['entries', 'months', 'categories', 'replies', 'settings']) assert.deepEqual(migrated[key], old[key]);
});


test('legacy rows keep separate IDs, notes and photos even for the same category', () => {
  const first = fixture().entries[0];
  const second = { ...first, id: 'e2', comment: '別の一言', question: '別の疑問', photo: 'photo-2', createdAt: 456 };
  const third = { ...first, id: 'e3', categoryId: 'school', comment: '学校の一言', photo: 'photo-3' };
  const existing = [first, second, third];
  const unchanged = replaceDayEntries(existing, first.date, [second, third, first]);
  assert.deepEqual(unchanged.entries, [second, third, first]);
  assert.deepEqual(unchanged.deletedIds, []);
  const removed = replaceDayEntries(existing, first.date, [{ ...second, minutes: 30 }, third]);
  assert.deepEqual(removed.deletedIds, [first.id]);
  assert.equal(removed.entries[0].id, second.id);
  assert.equal(removed.entries[0].photo, second.photo);
});
