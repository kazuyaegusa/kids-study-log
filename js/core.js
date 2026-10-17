export const FORMAT_VERSION = 2;
export const DEFAULT_CATEGORIES = [
  { id: 'juku', name: '塾の宿題', icon: '✏️', visible: true },
  { id: 'school', name: '学校の宿題', icon: '🏫', visible: true },
  { id: 'reading', name: '読書', icon: '📚', visible: true },
  { id: 'research', name: '調べ物・自由研究', icon: '🔎', visible: true }
];

export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function yesterdayKey(date = new Date()) {
  const previous = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
  return localDateKey(previous);
}

export function monthKey(dateKey) { return dateKey.slice(0, 7); }

export function daysInMonth(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月の形式が正しくありません');
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number, 0).getDate();
}

export function monthDays(month) {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function pokemonTileOrder(month, pokemonId, priority = []) {
  if (!Number.isInteger(pokemonId) || pokemonId < 1 || pokemonId > 1025) throw new Error('ポケモンIDが正しくありません');
  const order = Array.from({ length: daysInMonth(month) }, (_, index) => index);
  let seed = 2166136261;
  for (const character of `${month}:${pokemonId}`) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  for (let index = order.length - 1; index > 0; index--) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const other = (seed >>> 0) % (index + 1);
    [order[index], order[other]] = [order[other], order[index]];
  }
  const preferred = new Set(priority);
  return [...order.filter(index => preferred.has(index)), ...order.filter(index => !preferred.has(index))];
}

export function pokemonTileDates(entries, month, pokemonId, priority = []) {
  const dates = [...new Set(entries.map(entry => entry.date).filter(date => isValidDateKey(date) && date.startsWith(`${month}-`)))].sort();
  const order = pokemonTileOrder(month, pokemonId, priority);
  return new Map(dates.map((date, index) => [order[index], date]));
}

export function summarizeMonth(entries, month) {
  const matching = entries.filter(entry => entry.date.startsWith(`${month}-`));
  return {
    count: matching.length,
    minutes: matching.reduce((sum, entry) => sum + entry.minutes, 0),
    selfDays: new Set(matching.filter(entry => entry.selfStarted).map(entry => entry.date)).size,
    activeDays: new Set(matching.map(entry => entry.date)).size
  };
}

export function entryExp(entry) {
  return 10 + (entry.selfStarted ? 5 : 0) + (entry.question?.trim() ? 5 : 0) + (entry.photo ? 2 : 0);
}

export function totalExp(entries) {
  return entries.reduce((sum, entry) => sum + entryExp(entry), 0);
}

export function levelInfo(exp) {
  if (!Number.isFinite(exp)) throw new RangeError('EXPは有限の数で指定してください');
  const points = Math.max(0, Math.floor(exp));
  let level = 1;
  while (50 * level * (level + 1) / 2 <= points) level++;
  const floor = 50 * level * (level - 1) / 2;
  const ceiling = 50 * level * (level + 1) / 2;
  return { level, current: points - floor, next: ceiling - floor };
}

export function isValidDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

const DAY_MS = 86400000;
const dayNumber = key => Date.parse(`${key}T00:00:00Z`) / DAY_MS;
export function streakInfo(entries, today) {
  if (!isValidDateKey(today)) throw new Error('今日の日付が正しくありません');
  const todayNumber = dayNumber(today);
  const dates = [...new Set(entries.map(entry => entry.date)
    .filter(date => isValidDateKey(date) && date <= today))].sort();
  let run = 0;
  let longest = 0;
  let previousDay = null;
  for (const date of dates) {
    const day = dayNumber(date);
    run = previousDay !== null && day === previousDay + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previousDay = day;
  }
  const current = previousDay !== null && previousDay >= todayNumber - 1 ? run : 0;
  return { current, longest, recordedToday: previousDay === todayNumber,
    restarting: dates.length > 0 && current === 0 };
}

export function completedPokemon(entries, months) {
  return months.filter(month => month.artType === 'pokemon' &&
    summarizeMonth(entries, month.id).activeDays === daysInMonth(month.id));
}

export function badgeStatus(entries, months) {
  const latest = entries.map(entry => entry.date).filter(isValidDateKey).sort().at(-1);
  const streak = latest ? streakInfo(entries, latest).longest : 0;
  const questions = entries.filter(entry => entry.question?.trim()).length;
  const reading = entries.filter(entry => entry.categoryId === 'reading').reduce((sum, entry) => sum + entry.minutes, 0);
  const self = entries.filter(entry => entry.selfStarted).length;
  const caught = completedPokemon(entries, months).length;
  return [
    ['first', '✏️', '初めての記録', '1件の記録', entries.length, 1],
    ['streak3', '🔥', '3日連続', '3日連続で記録', streak, 3],
    ['streak7', '🌈', '7日連続', '7日連続で記録', streak, 7],
    ['streak30', '☀️', '30日連続', '30日連続で記録', streak, 30],
    ['questions', '💡', '疑問10個', '疑問を10件記録', questions, 10],
    ['reading', '📚', '読書300分', '読書の合計300分', reading, 300],
    ['self', '⚡', '自分から10回', '自分からを10件記録', self, 10],
    ['pokemon', '✨', 'ポケモン初ゲット', '相棒のマスを全開放', caught, 1],
    ['records10', '🌱', '冒険10回', '10件の記録', entries.length, 10],
    ['records100', '🏆', '冒険100回', '100件の記録', entries.length, 100]
  ].map(([id, icon, name, description, progress, target]) =>
    ({ id, icon, name, description, progress: Math.min(progress, target), target, earned: progress >= target }));
}

export const DEFAULT_ADVENTURE_SETTINGS = { dailyGoal: 30, soundEnabled: true, avatarMonth: null };

const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const shortText = (value, max) => typeof value === 'string' && value.length <= max;
const photo = value => value == null || (typeof value === 'string' && value.length <= 15_000_000 && /^data:image\/(jpeg|png|webp);base64,(?:[a-z\d+/]{4})*(?:[a-z\d+/]{2}==|[a-z\d+/]{3}=)?$/i.test(value) && !value.endsWith(','));

export function migrateBackup(input) {
  if (!plain(input)) throw new Error('バックアップの形式が正しくありません');
  if (input.formatVersion === FORMAT_VERSION) return input;
  if (input.formatVersion === 1 && Array.isArray(input.entries)) {
    return { ...input, formatVersion: FORMAT_VERSION, replies: input.replies ?? [], settings: input.settings ?? [] };
  }
  throw new Error('対応していないバックアップです');
}

const PIN_HASH_LENGTH = { sha256: 64, simple: 8 };
export const MAX_BACKUP_BYTES = 500_000_000;

export function validateBackup(raw) {
  const data = migrateBackup(raw);
  if (!['entries', 'months', 'categories', 'settings', 'replies'].every(key => Array.isArray(data[key]))) throw new Error('バックアップの項目が足りません');
  if (data.entries.length > 100_000 || data.months.length > 1200 || data.categories.length > 200 || data.replies.length > 100_000 || data.settings.length > 100) throw new Error('バックアップが大きすぎます');
  const unique = (rows, key) => new Set(rows.map(row => row[key])).size === rows.length;
  if (!data.categories.every(c => plain(c) && shortText(c.id, 80) && c.id && shortText(c.name, 80) && c.name && shortText(c.icon, 16) && typeof c.visible === 'boolean') || !unique(data.categories, 'id')) throw new Error('項目のデータが正しくありません');
  const categoryIds = new Set(data.categories.map(c => c.id));
  if (!data.entries.every(e => plain(e) && shortText(e.id, 100) && e.id && isValidDateKey(e.date) && categoryIds.has(e.categoryId) && Number.isInteger(e.minutes) && [5, 10, 15, 20, 30, 45, 60].includes(e.minutes) && typeof e.selfStarted === 'boolean' && shortText(e.comment, 500) && shortText(e.question, 300) && photo(e.photo) && Number.isFinite(e.createdAt)) || !unique(data.entries, 'id')) throw new Error('記録のデータが正しくありません');
  if (!data.months.every(m => plain(m) && /^\d{4}-(0[1-9]|1[0-2])$/.test(m.id) && ['default', 'image', 'drawing', 'pokemon'].includes(m.artType) && photo(m.artwork) && (m.artType !== 'pokemon' || (Number.isInteger(m.pokemonId) && m.pokemonId >= 1 && m.pokemonId <= 1025 && shortText(m.pokemonName, 80) && m.pokemonName.trim() && typeof m.artwork === 'string' && /^data:image\/png;base64,/i.test(m.artwork)))) || !unique(data.months, 'id')) throw new Error('月の絵のデータが正しくありません');
  const entryIds = new Set(data.entries.map(e => e.id));
  if (!data.replies.every(r => plain(r) && entryIds.has(r.id) && shortText(r.stamp, 30) && shortText(r.comment, 500) && typeof r.seen === 'boolean' && Number.isFinite(r.updatedAt)) || !unique(data.replies, 'id')) throw new Error('返信のデータが正しくありません');
  if (!data.settings.every(s => plain(s) && shortText(s.key, 80) && s.key && plain(s.value)) || !unique(data.settings, 'key')) throw new Error('設定のデータが正しくありません');
  const pin = data.settings.find(s => s.key === 'pin')?.value;
  if (pin && !(PIN_HASH_LENGTH[pin.method] && typeof pin.hash === 'string' && pin.hash.length === PIN_HASH_LENGTH[pin.method] && /^[a-f\d]+$/i.test(pin.hash))) throw new Error('PIN設定が正しくありません');
  const adventure = data.settings.find(s => s.key === 'adventure')?.value;
  if (adventure && (
    (Object.hasOwn(adventure, 'dailyGoal') && (!Number.isInteger(adventure.dailyGoal) || adventure.dailyGoal < 5 || adventure.dailyGoal > 180)) ||
    (Object.hasOwn(adventure, 'soundEnabled') && typeof adventure.soundEnabled !== 'boolean') ||
    (Object.hasOwn(adventure, 'avatarMonth') && adventure.avatarMonth !== null &&
      (typeof adventure.avatarMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(adventure.avatarMonth)))
  )) throw new Error('冒険の設定が正しくありません');
  return data;
}
