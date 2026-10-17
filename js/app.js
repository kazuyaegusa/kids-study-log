import {
  localDateKey, yesterdayKey, weekKey, weekDays, periodDays, periodLabel, summarizePeriod,
  pokemonTileDates, totalExp, levelInfo, validateBackup,
  MAX_BACKUP_BYTES, streakInfo, badgeStatus, completedPokemon, DEFAULT_ADVENTURE_SETTINGS
} from './core.js';
import {
  openDatabase, all, get, put, saveDayEntries, choosePokemonWeek, removeEntry,
  seedCategories, exportBackup, importBackup
} from './db.js';
import { shrinkImage, objectURL } from './images.js';

import { $, create, button } from './ui/dom.js';
import { fillMosaic, withCoverage } from './ui/board.js';
import { celebrate, initEffects } from './ui/effects.js';
import { renderCompanion, pokemonPortrait } from './ui/companion.js';
import { initSound, setSoundEnabled } from './ui/sound.js';
const categoryOrder = { juku: 0, school: 1, reading: 2, research: 3 };
const orderedCategories = rows => [...rows].sort((a, b) =>
  (categoryOrder[a.id] ?? 100) - (categoryOrder[b.id] ?? 100) ||
  a.name.localeCompare(b.name, 'ja')
);

async function prepareCategoryColors() {
  const categories = orderedCategories(await all(db, 'categories'));
  const saved = (await get(db, 'settings', 'categoryColors'))?.value ?? {};
  const colors = { ...saved };
  let changed = false;
  for (const category of categories) {
    if (Object.hasOwn(categoryOrder, category.id)) continue;
    if (Number.isInteger(colors[category.id]) && colors[category.id] >= 0 && colors[category.id] < 6) continue;
    colors[category.id] = (4 + Object.keys(colors).length) % 6;
    changed = true;
  }
  if (changed) await put(db, 'settings', { key: 'categoryColors', value: colors });
}

let db;
let view = 'home';
let selectedDate = localDateKey();
const selectedRows = new Map();
let savingEntry = false;
let loadingRecord = false;
let recordRequest = 0;
let savedPhoto = null;
let recordPhotoURL = '';
let sharedRowId = null;
let legacyPhotoURLs = [];
let parentOpen = false;
let changingPin = false;
let revealIndex = -1;
let imageURLs = [];
let candidateImageURLs = [];
let candidates = { month: '', items: [] };
let candidateRequest = 0;
let choosingPokemon = false;
let toastTimer;
let persistGranted = null;
let adventureSettings = { ...DEFAULT_ADVENTURE_SETTINGS };
let renderedHomeDate = '';
let homeRenderRequest = 0;
let dateRefreshTimer;

function refreshForDateChange() {
  clearTimeout(dateRefreshTimer);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  dateRefreshTimer = setTimeout(refreshForDateChange, Math.max(1000, tomorrow - now + 50));
  if (view !== 'home' || document.hidden || document.querySelector('dialog[open]') || savingEntry) return;
  if (renderedHomeDate !== localDateKey(now)) {
    renderHome().catch(error => notify(`画面を更新できませんでした: ${error.message}`));
  }
}

async function readAdventureSettings() {
  adventureSettings = { ...DEFAULT_ADVENTURE_SETTINGS, ...(await get(db, 'settings', 'adventure'))?.value };
  setSoundEnabled(adventureSettings.soundEnabled);
  return adventureSettings;
}

async function saveAdventureSettings(patch) {
  const settings = { ...await readAdventureSettings(), ...patch };
  await put(db, 'settings', { key: 'adventure', value: settings });
  adventureSettings = settings;
  setSoundEnabled(settings.soundEnabled);
}

function clearImageURLs() {
  imageURLs.forEach(URL.revokeObjectURL);
  imageURLs = [];
  candidateImageURLs.forEach(URL.revokeObjectURL);
  candidateImageURLs = [];
}

function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

function showView(name) {
  candidateRequest++;
  view = name;
  if (name !== 'parent') {
    parentOpen = false;
    changingPin = false;
  }
  document.querySelectorAll('.view').forEach(section => {
    section.hidden = section.id !== `${name}-view`;
  });
  $('.bottom-nav').hidden = name === 'parent';
  document.querySelectorAll('.nav-button').forEach(tab => {
    const active = tab.dataset.view === name;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  if (name === 'home') renderHome();
  if (name === 'album') renderAlbum();
  if (name === 'parent') renderParent();
  window.scrollTo(0, 0);
}

function customConfirm(title, message, acceptLabel = '続ける') {
  return new Promise(resolve => {
    const dialog = $('#confirm-dialog');
    const accept = $('#confirm-accept');
    const cancel = $('#confirm-cancel');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = message;
    accept.textContent = acceptLabel;
    let settled = false;
    const finish = answer => {
      if (settled) return;
      settled = true;
      accept.removeEventListener('click', yes);
      cancel.removeEventListener('click', no);
      dialog.removeEventListener('close', closed);
      if (dialog.open) dialog.close();
      resolve(answer);
    };
    const yes = () => finish(true);
    const no = () => finish(false);
    const closed = () => finish(false);
    accept.addEventListener('click', yes);
    cancel.addEventListener('click', no);
    dialog.addEventListener('close', closed);
    dialog.showModal();
  });
}

function openRecord() {
  selectedDate = localDateKey();
  $('#record-title').textContent = '今日の記録';
  $('#record-sheet').showModal();
  document.body.style.overflow = 'hidden';
  renderRecordChoices();
  $('#close-record').focus();
}

function closeRecord() {
  $('#record-sheet').close();
  document.body.style.overflow = '';
  $('#open-record').focus();
}

async function renderRecordChoices() {
  const request = ++recordRequest;
  const date = selectedDate;
  loadingRecord = true;
  $('#record-form').inert = true;
  updateSaveState();
  try {
    const [stored, categoryRows, colorSetting] = await Promise.all([
      all(db, 'entries'), all(db, 'categories'), get(db, 'settings', 'categoryColors')
    ]);
    if (request !== recordRequest) return;
    const existing = stored.filter(entry => entry.date === date)
      .sort((a, b) => Number(Boolean(b.selfStarted || b.comment || b.question || b.photo)) -
        Number(Boolean(a.selfStarted || a.comment || a.question || a.photo)) ||
        a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    $('#record-form').reset();
    selectedRows.clear();
    for (const entry of existing) selectedRows.set(entry.id, { ...entry });
    sharedRowId = selectedRows.keys().next().value ?? null;
    loadSharedFields();
    $('#record-title').textContent = existing.length ? '記録の修正' : `${date === localDateKey() ? '今日' : '昨日'}の記録`;
    $('#save-entry').textContent = existing.length ? '記録を修正する' : '記録を保存する　✦';
    const dateBox = $('#date-options');
    dateBox.replaceChildren();
    for (const [date, label] of [[localDateKey(), '今日'], [yesterdayKey(), '昨日']]) {
      const choice = button(`${label}・${Number(date.slice(-2))}日`,
        `choice-button${selectedDate === date ? ' selected' : ''}`, () => {
          selectedDate = date;
          $('#record-title').textContent = `${label}の記録`;
          renderRecordChoices();
        });
      choice.setAttribute('aria-pressed', String(selectedDate === date));
      dateBox.append(choice);
    }

    const colors = colorSetting?.value ?? {};
    const categories = orderedCategories(categoryRows).filter(row => row.visible || [...selectedRows.values()].some(entry => entry.categoryId === row.id));
    const categoryBox = $('#category-options');
    categoryBox.replaceChildren();
    categories.forEach(category => {
      const choice = button('',
        'choice-button category-choice', () => {
          captureSharedFields();
          const selected = [...selectedRows].filter(([, entry]) => entry.categoryId === category.id);
          if (selected.length) selected.forEach(([key]) => selectedRows.delete(key));
          else selectedRows.set(`new-${category.id}`, {
            categoryId: category.id, minutes: 20,
            ...(!selectedRows.size ? {
              selfStarted: $('#self-started').checked, comment: $('#entry-comment').value,
              question: $('#entry-question').value, photo: savedPhoto, photoFile: $('#entry-photo').files[0]
            } : {})
          });
          renderRecordRows(categories);
        });
      const color = Object.hasOwn(categoryOrder, category.id)
        ? categoryOrder[category.id] : colors[category.id] ?? 4;
      choice.dataset.color = String(color);
      choice.dataset.categoryId = category.id;
      const icon = create('span', '', category.icon);
      icon.setAttribute('aria-hidden', 'true');
      choice.setAttribute('aria-label', category.name);
      choice.append(icon, document.createTextNode(category.name));
      categoryBox.append(choice);
    });

    renderRecordRows(categories);
  } catch (error) {
    if (request === recordRequest) {
      selectedRows.clear();
      notify(`記録を読み込めませんでした: ${error.message}`);
    }
  } finally {
    if (request === recordRequest) {
      loadingRecord = false;
      $('#record-form').inert = savingEntry;
      updateSaveState();
    }
  }
}

function captureSharedFields() {
  const entry = selectedRows.get(sharedRowId);
  if (!entry) return;
  Object.assign(entry, {
    selfStarted: $('#self-started').checked, comment: $('#entry-comment').value,
    question: $('#entry-question').value, photo: savedPhoto,
    photoFile: $('#entry-photo').files[0] ?? entry.photoFile ?? null
  });
}

function loadSharedFields() {
  const entry = selectedRows.get(sharedRowId);
  $('#self-started').checked = Boolean(entry?.selfStarted);
  $('#entry-comment').value = entry?.comment ?? '';
  $('#entry-question').value = entry?.question ?? '';
  $('#entry-photo').value = '';
  savedPhoto = entry?.photo ?? null;
  if (recordPhotoURL) URL.revokeObjectURL(recordPhotoURL);
  recordPhotoURL = savedPhoto ? URL.createObjectURL(savedPhoto) : '';
  const preview = $('#record-photo-preview');
  preview.hidden = !savedPhoto || Boolean(entry?.photoFile);
  if (recordPhotoURL) preview.src = recordPhotoURL;
  else preview.removeAttribute('src');
  $('#photo-name').textContent = entry?.photoFile?.name ?? '';
  $('.more-fields').open = Boolean(savedPhoto || entry?.comment || entry?.question);
}

function legacyEntryFields(entry) {
  const box = create('div', 'optional-fields');
  const selfLabel = create('label', 'self-toggle');
  const self = create('input');
  self.type = 'checkbox';
  self.checked = Boolean(entry.selfStarted);
  self.addEventListener('change', () => { entry.selfStarted = self.checked; });
  selfLabel.append(self, document.createTextNode('自分からやった！'));
  box.append(selfLabel);
  for (const [key, title, limit] of [['comment', '一言', 500], ['question', '疑問', 300]]) {
    const label = create('label', '', title);
    const input = create(key === 'comment' ? 'textarea' : 'input');
    input.value = entry[key] ?? '';
    input.maxLength = limit;
    input.id = `legacy-${key}-${[...selectedRows.values()].indexOf(entry)}`;
    label.htmlFor = input.id;
    input.addEventListener('input', () => { entry[key] = input.value; });
    box.append(label, input);
  }
  const preview = create('img', 'entry-photo');
  preview.alt = '保存済みの学習写真';
  if (entry.photo) preview.src = objectURL(entry.photo, legacyPhotoURLs);
  preview.hidden = !entry.photo || Boolean(entry.photoFile);
  const upload = create('label', 'upload-label', '📷 写真を選ぶ');
  const file = create('input');
  file.type = 'file';
  file.accept = 'image/*';
  const name = create('span', '', entry.photoFile?.name ?? '');
  file.addEventListener('change', () => {
    entry.photoFile = file.files[0] ?? null;
    name.textContent = entry.photoFile?.name ?? '';
    preview.hidden = Boolean(entry.photoFile) || !entry.photo;
  });
  upload.append(file);
  box.append(upload, name, preview);
  return box;
}

function updateSaveState() {
  const empty = selectedRows.size === 0;
  $('#save-entry').disabled = savingEntry || loadingRecord || empty;
  $('#record-empty').hidden = !empty;
}

function renderRecordRows(categories) {
  captureSharedFields();
  if (!selectedRows.has(sharedRowId)) {
    sharedRowId = selectedRows.keys().next().value ?? null;
    loadSharedFields();
  }
  legacyPhotoURLs.forEach(URL.revokeObjectURL);
  legacyPhotoURLs = [];
  const tiles = [...$('#category-options').querySelectorAll('button')];
  tiles.forEach(tile => {
    const selected = [...selectedRows.values()].some(entry => entry.categoryId === tile.dataset.categoryId);
    tile.classList.toggle('selected', selected);
    tile.setAttribute('aria-pressed', String(selected));
  });
  const rows = $('#record-rows');
  rows.replaceChildren();
  for (const [rowId, entry] of selectedRows) {
    const { categoryId, minutes: selectedMinutes } = entry;
    const category = categories.find(row => row.id === categoryId);
    const row = create('fieldset', 'record-row');
    row.dataset.categoryId = categoryId;
    row.dataset.entryId = rowId;
    row.setAttribute('aria-label', category.name);
    const legend = create('legend');
    legend.append(create('span', '', `${category.icon} ${category.name}`));
    const remove = button('×', 'icon-button remove-record-row', () => {
      captureSharedFields();
      selectedRows.delete(rowId);
      renderRecordRows(categories);
      tiles.find(tile => tile.dataset.categoryId === categoryId)?.focus();
    });
    remove.setAttribute('aria-label', `${category.name}を外す`);
    const timeBox = create('div', 'choice-row');
    for (const minutes of [...new Set([10, 20, 30, 45, 60, selectedMinutes])].sort((a, b) => a - b)) {
      const label = minutes === 60 ? '60分以上' : `${minutes}分`;
      const choice = button(label,
        `choice-button${selectedMinutes === minutes ? ' selected' : ''}`, () => {
          entry.minutes = minutes;
          timeBox.querySelectorAll('button').forEach(chip => {
            const selected = chip === choice;
            chip.classList.toggle('selected', selected);
            chip.setAttribute('aria-pressed', String(selected));
          });
        });
      choice.setAttribute('aria-pressed', String(selectedMinutes === minutes));
      timeBox.append(choice);
    }
    legend.append(remove);
    row.append(legend, timeBox);
    if (rowId !== sharedRowId && (entry.selfStarted || entry.comment || entry.question || entry.photo || entry.photoFile)) {
      row.append(legacyEntryFields(entry));
    }
    rows.append(row);
  }
  updateSaveState();
}

async function allPartners() {
  const [months, weeks] = await Promise.all([all(db, 'months'), all(db, 'weeks')]);
  return [...months, ...weeks];
}

function renderPlayer(entries, nickname) {
  $('#player-name').textContent = nickname;
  const info = levelInfo(totalExp(entries));
  $('#level-badge').textContent = `Lv.${info.level}`;
  $('#exp-numbers').textContent = `${info.current} / ${info.next} EXP`;
  $('#exp-fill').style.width = `${100 * info.current / info.next}%`;
  $('#exp-bar').setAttribute('aria-valuemax', String(info.next));
  $('#exp-bar').setAttribute('aria-valuenow', String(info.current));
  const recorded = new Set(entries.map(entry => entry.date));
  const days = ['月', '火', '水', '木', '金', '土', '日'];
  const dots = $('#week-dots');
  dots.replaceChildren();
  weekDays(weekKey()).forEach((date, index) => {
    const day = create('div', `week-day${recorded.has(date) ? ' recorded' : ''}`);
    day.append(document.createTextNode(days[index]), create('span', '', '🔥'));
    day.setAttribute('aria-label', `${days[index]}曜日・${recorded.has(date) ? '記録あり' : '記録なし'}`);
    dots.append(day);
  });
}

async function renderHome() {
  const request = ++homeRenderRequest;
  const today = localDateKey();
  const month = weekKey(today);
  const [entries, storedArtwork, nickname, months, settings] = await Promise.all([
    all(db, 'entries'), get(db, 'weeks', month), get(db, 'settings', 'nickname'),
    allPartners(), readAdventureSettings()
  ]);
  const artwork = await withCoverage(storedArtwork);
  if (view !== 'home' || request !== homeRenderRequest) return;
  if (today !== localDateKey()) return renderHome();
  clearImageURLs();
  renderCompanion(entries, artwork, months, settings, imageURLs);
  $('#open-record-label').textContent = entries.some(entry => entry.date === today)
    ? '今日の記録を修正する' : '今日の記録をつける';
  renderPlayer(entries, typeof nickname?.value?.name === 'string' ? nickname.value.name : 'トレーナー');
  await updateBadge();
  if (view !== 'home' || request !== homeRenderRequest) return;
  renderedHomeDate = today;
  $('#month-label').textContent = periodLabel(month);
  const chosen = artwork?.artType === 'pokemon';
  $('#selection-panel').hidden = Boolean(chosen);
  $('#board-panel').hidden = !chosen;
  if (!chosen) {
    renderCandidates(month);
    return;
  }
  const imageURL = artwork.artwork ? objectURL(artwork.artwork, imageURLs) : '';
  const board = $('#month-art');
  board.classList.toggle('pokemon-board', artwork.artType === 'pokemon');
  board.classList.toggle('has-art', Boolean(imageURL));
  board.style.backgroundImage = imageURL && artwork.artType !== 'pokemon' ? `url("${imageURL}")` : '';
  board.style.setProperty('--pokemon-image', imageURL ? `url("${imageURL}")` : 'none');
  fillMosaic($('#month-grid'), month, entries, artwork, imageURL, { onDay: showDay, revealIndex });
  revealIndex = -1;
  const opened = summarizePeriod(entries, month).activeDays;
  const total = periodDays(month).length;
  $('#month-progress').textContent = `${opened} / ${total} マス`;
  $('#pokemon-name').textContent = artwork.artType === 'pokemon' && opened === total
    ? artwork.pokemonName : artwork.artType === 'pokemon' ? '？？？' : '今週の絵';
}

async function renderCandidates(month) {
  if (candidates.month !== month || candidates.items.length !== 6) {
    loadCandidates(month);
    return;
  }
  const box = $('#pokemon-candidates');
  candidateImageURLs.forEach(URL.revokeObjectURL);
  candidateImageURLs = [];
  box.replaceChildren();
  $('#candidate-message').textContent = '';
  $('#refresh-candidates').disabled = false;
  for (const [index, item] of candidates.items.entries()) {
    const choice = button('', 'pokemon-candidate', () => choosePokemon(month, item));
    choice.setAttribute('aria-label', `${index + 1}番目のポケモンの影を選ぶ`);
    const image = create('img');
    image.alt = `${index + 1}番目のポケモンの影`;
    image.src = objectURL(item.blob, candidateImageURLs);
    choice.append(image);
    box.append(choice);
  }
}

async function loadCandidates(month, force = false) {
  const existing = await get(db, 'weeks', month);
  if (month !== weekKey(localDateKey()) || existing?.artType === 'pokemon') return;
  if (!force && candidates.month === month && candidates.items.length === 6) {
    renderCandidates(month);
    return;
  }
  const request = ++candidateRequest;
  const box = $('#pokemon-candidates');
  if (force) {
    box.classList.remove('flip');
    void box.offsetWidth;
    box.classList.add('flip');
  } else {
    box.replaceChildren();
  }
  $('#candidate-message').textContent = '影を呼び出しています…';
  $('#refresh-candidates').disabled = true;
  box.querySelectorAll('button').forEach(choice => { choice.disabled = true; });
  try {
    const ids = new Set();
    while (ids.size < 6) ids.add(crypto.getRandomValues(new Uint32Array(1))[0] % 1025 + 1);
    const items = await Promise.all([...ids].map(async id => {
      const response = await fetch(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('画像を取得できませんでした');
      const blob = await response.blob();
      if (blob.type !== 'image/png' || !blob.size) throw new Error('画像の形式が正しくありません');
      return { id, blob };
    }));
    if (request !== candidateRequest || view !== 'home' || month !== weekKey(localDateKey())) return;
    candidates = { month, items };
    renderCandidates(month);
  } catch (error) {
    if (request === candidateRequest) $('#candidate-message').textContent =
      '候補を取得できませんでした。「影を引き直す」で再試行してください。';
  } finally {
    if (request === candidateRequest) {
      $('#refresh-candidates').disabled = false;
      box.querySelectorAll('button').forEach(choice => { choice.disabled = false; });
    }
  }
}

async function choosePokemon(month, item) {
  const existing = await get(db, 'weeks', month);
  if (choosingPokemon || month !== weekKey(localDateKey()) ||
      existing?.artType === 'pokemon') { await renderHome(); return; }
  choosingPokemon = true;
  try {
    if (!await customConfirm('今週の相棒を決める？', '決めた後は変更できません。', 'この影に決める')) return;
    const current = await get(db, 'weeks', month);
    if (month !== weekKey(localDateKey()) || current?.artType === 'pokemon') { await renderHome(); return; }
    $('#candidate-message').textContent = '名前を取得しています…';
    const response = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${item.id}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('名前を取得できませんでした');
    const species = await response.json();
    const name = species.names?.find(row => row.language?.name === 'ja')?.name ??
      species.names?.find(row => row.language?.name === 'ja-Hrkt')?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 80) {
      throw new Error('日本語名を確認できませんでした');
    }
    if (month !== weekKey(localDateKey())) {
      await renderHome();
      return notify('週が変わりました。今週の相棒を選んでください');
    }
    const saved = await choosePokemonWeek(db, {
      id: month, artType: 'pokemon', pokemonId: item.id,
      pokemonName: name.trim(), artwork: item.blob
    });
    if (!saved) { await renderHome(); return notify('今週の相棒はすでに決まっています'); }
    candidates = { month: '', items: [] };
    await renderHome();
    notify('今週の相棒が決まりました！');
  } catch (error) {
    const message = error instanceof TypeError ? '通信できませんでした' : error.message;
    $('#candidate-message').textContent = `${message}。もう一度選んでください。`;
    notify(message);
  } finally {
    choosingPokemon = false;
  }
}

async function saveEntry(event) {
  event.preventDefault();
  if (savingEntry || loadingRecord || selectedRows.size === 0) return;
  savingEntry = true;
  updateSaveState();
  $('#record-form').inert = true;
  const date = selectedDate;
  captureSharedFields();
  const rows = [...selectedRows.values()].map(entry => ({ ...entry }));
  try {
    const months = await allPartners();

    if (![localDateKey(), yesterdayKey()].includes(date)) {
      throw new Error('日付が変わりました。今日か昨日を選び直してください');
    }
    const entries = await Promise.all(rows.map(async row => ({
      id: row.id ?? crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date, categoryId: row.categoryId, minutes: row.minutes,
      selfStarted: Boolean(row.selfStarted), comment: row.comment?.trim() ?? '',
      question: row.question?.trim() ?? '',
      photo: row.photoFile ? await shrinkImage(row.photoFile) : row.photo ?? null,
      createdAt: row.createdAt ?? Date.now()
    })));
    if (![localDateKey(), yesterdayKey()].includes(date)) {
      throw new Error('日付が変わりました。今日か昨日を選び直してください');
    }
    const { previous, afterEntries, editing } = await saveDayEntries(db, date, entries);
    const newTile = !editing;
    const before = levelInfo(totalExp(previous));
    const after = levelInfo(totalExp(afterEntries));
    $('#record-form').reset();
    selectedRows.clear();
    renderRecordRows([]);
    $('.more-fields').open = false;
    $('#photo-name').textContent = '';
    closeRecord();
    if (editing) {
      revealIndex = -1;
      await renderHome();
      notify('記録を修正しました');
      return;
    }
    const entryMonth = weekKey(date);
    const artwork = await withCoverage(await get(db, 'weeks', entryMonth));
    const hasBoard = artwork?.artType === 'pokemon';
    if (hasBoard && newTile) {
      const oldTiles = pokemonTileDates(previous, entryMonth, artwork.pokemonId, artwork.priority);
      const newTiles = pokemonTileDates(afterEntries, entryMonth, artwork.pokemonId, artwork.priority);
      revealIndex = [...newTiles.keys()].find(index => !oldTiles.has(index)) ?? -1;
    }
    const effectIndex = revealIndex;
    await renderHome();
    revealIndex = -1;
    let board = hasBoard ? $('#month-art') : null;
    if (hasBoard && entryMonth !== weekKey(localDateKey())) {
      board = create('div', 'art-board');
      const imageURL = artwork.artwork ? objectURL(artwork.artwork, imageURLs) : '';
      board.classList.toggle('pokemon-board', artwork.artType === 'pokemon');
      board.style.setProperty('--pokemon-image', imageURL ? `url("${imageURL}")` : 'none');
      if (imageURL && artwork.artType !== 'pokemon') board.style.backgroundImage = `url("${imageURL}")`;
      const grid = create('div', 'month-grid');
      board.append(grid);
      fillMosaic(grid, entryMonth, afterEntries, artwork, imageURL, {
        thumbnail: true, revealIndex: effectIndex
      });
    }
    const complete = newTile && artwork?.artType === 'pokemon' &&
      summarizePeriod(afterEntries, entryMonth).activeDays === periodDays(entryMonth).length;
    const beforeBadges = new Set(badgeStatus(previous, months).filter(badge => badge.earned).map(badge => badge.id));
    const newBadges = badgeStatus(afterEntries, months).filter(badge => badge.earned && !beforeBadges.has(badge.id));
    const today = localDateKey();
    const todayMinutes = afterEntries.filter(row => row.date === today).reduce((sum, row) => sum + row.minutes, 0);
    const previousMinutes = previous.filter(row => row.date === today).reduce((sum, row) => sum + row.minutes, 0);
    await celebrate({
      gainedExp: totalExp(entries), before, after, newTile: Boolean(newTile && hasBoard),
      artwork, complete, board, newBadges, todayMinutes,
      streak: streakInfo(afterEntries, today).current,
      goalReached: previousMinutes < adventureSettings.dailyGoal && todayMinutes >= adventureSettings.dailyGoal
    });
  } catch (error) {
    notify(`保存できませんでした: ${error.message}`);
  } finally {
    savingEntry = false;
    $('#record-form').inert = false;
    updateSaveState();
    refreshForDateChange();
  }
}

function renderEntry(entry, categories, replies, parentMode) {
  const card = create('div', 'list-item');
  const category = categories.find(row => row.id === entry.categoryId);
  card.append(create('p', '', `${category?.icon ?? '📝'} ${category?.name ?? '項目なし'} ・ ${entry.minutes === 60 ? '60分以上' : `${entry.minutes}分`}${entry.selfStarted ? ' ・ ⚡ 自分から' : ''}`));
  if (entry.comment) card.append(create('p', '', entry.comment));
  if (entry.question) card.append(create('p', '', `❓ ${entry.question}`));
  if (entry.photo) {
    const image = create('img', 'entry-photo');
    image.alt = `${entry.date}の学習写真`;
    image.src = objectURL(entry.photo, imageURLs);
    card.append(image);
  }
  const reply = replies.find(row => row.id === entry.id);
  if (reply) {
    const box = create('div', 'reply-meta');
    if (reply.stamp) box.append(create('span', 'reply-stamp', reply.stamp));
    if (reply.comment) box.append(create('p', '', reply.comment));
    card.append(box);
  }
  if (!parentMode) return card;

  card.prepend(create('p', '', entry.date));
  const form = create('form', 'reply-form');
  const stamp = create('select');
  stamp.setAttribute('aria-label', '返信スタンプ');
  for (const value of ['', '👍 いいね', '🌟 すごい', '💡 なるほど', '👏 がんばったね']) {
    const option = create('option', '', value || 'スタンプを選ぶ');
    option.value = value;
    stamp.append(option);
  }
  stamp.value = reply?.stamp ?? '';
  const comment = create('input');
  comment.placeholder = '一言コメント';
  comment.maxLength = 500;
  comment.value = reply?.comment ?? '';
  comment.setAttribute('aria-label', '返信コメント');
  const save = create('button', 'secondary-button', '返信を保存');
  save.type = 'submit';
  form.append(stamp, comment, save);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!stamp.value && !comment.value.trim()) return notify('スタンプかコメントを入れてください');
    await put(db, 'replies', {
      id: entry.id, stamp: stamp.value, comment: comment.value.trim(),
      seen: false, updatedAt: Date.now()
    });
    notify('返信を保存しました');
    renderParent();
    updateBadge();
  });
  card.append(form);
  card.append(button('この記録を削除', 'secondary-button', async () => {
    if (!await customConfirm('記録を削除しますか？',
      `${entry.date}の記録1件と返信を削除します。`, '削除する')) return;
    await removeEntry(db, entry.id);
    notify('削除しました');
    renderParent();
    updateBadge();
  }));
  return card;
}

async function showDay(date) {
  if ($('#detail-dialog').open) $('#detail-dialog').close();
  const [entries, categories, replies] = await Promise.all([
    all(db, 'entries'), all(db, 'categories'), all(db, 'replies')
  ]);
  const dayEntries = entries.filter(row => row.date === date)
    .sort((a, b) => a.createdAt - b.createdAt);
  const content = $('#detail-content');
  content.replaceChildren(create('h2', '', `${Number(date.slice(5, 7))}月${Number(date.slice(-2))}日`));
  dayEntries.forEach(entry => content.append(renderEntry(entry, categories, replies, false)));
  content.querySelector('h2').id = 'detail-title';
  $('#detail-dialog').showModal();
  for (const entry of dayEntries) {
    const reply = replies.find(row => row.id === entry.id);
    if (reply && !reply.seen) await put(db, 'replies', { ...reply, seen: true });
  }
  updateBadge();
}

async function showReplies() {
  const [entries, replies, categories] = await Promise.all([
    all(db, 'entries'), all(db, 'replies'), all(db, 'categories')
  ]);
  const ordered = replies.sort((a, b) => b.updatedAt - a.updatedAt);
  const content = $('#detail-content');
  content.replaceChildren(create('h2', '', '保護者からの返信'));
  if (!ordered.length) content.append(create('p', '', '返信はまだありません。'));
  for (const reply of ordered) {
    const entry = entries.find(row => row.id === reply.id);
    if (!entry) continue;
    const box = create('div', 'list-item');
    box.append(create('p', '', `${entry.date} ・ ${categories.find(row => row.id === entry.categoryId)?.name ?? '記録'}`));
    if (reply.stamp) box.append(create('span', 'reply-stamp', reply.stamp));
    if (reply.comment) box.append(create('p', '', reply.comment));
    content.append(box);
    if (!reply.seen) await put(db, 'replies', { ...reply, seen: true });
  }
  content.querySelector('h2').id = 'detail-title';
  $('#detail-dialog').showModal();
  updateBadge();
}

async function updateBadge() {
  const replies = await all(db, 'replies');
  const count = replies.filter(reply => !reply.seen).length;
  $('#new-badge').hidden = count === 0;
  $('#new-badge').textContent = String(count);
  $('#reply-button').setAttribute('aria-label', count
    ? `保護者からの新しい返信${count}件を見る` : '保護者からの返信を見る');
}

async function renderAlbum() {
  const [entries, storedPartners] = await Promise.all([all(db, 'entries'), allPartners()]);
  const months = await Promise.all(storedPartners.map(withCoverage));
  if (view !== 'album') return;
  clearImageURLs();
  const current = weekKey(localDateKey());
  const keys = [...new Set([
    ...entries.map(entry => weekKey(entry.date)), ...months.map(row => row.id)
  ])].filter(key => key <= current).sort().reverse();
  const caught = completedPokemon(entries, months);
  $('#collection-count').textContent = `図鑑 ${new Set(caught.map(month => month.pokemonId)).size} / 1025`;
  const list = $('#album-list');
  list.replaceChildren();
  if (!keys.length) list.append(create('p', 'empty-note', '今週の相棒を選ぶと、ここに並ぶよ。'));
  for (const key of keys) {
    const artwork = months.find(row => row.id === key);
    const summary = summarizePeriod(entries, key);
    const card = create('article', 'album-card');
    const preview = create('div', 'album-preview');
    preview.setAttribute('aria-hidden', 'true');
    const imageURL = artwork?.artwork ? objectURL(artwork.artwork, imageURLs) : '';
    const completed = artwork?.artType === 'pokemon' &&
      summary.activeDays === periodDays(key).length;
    if (artwork?.artType === 'pokemon') {
      if (completed) {
        preview.classList.add('dex-preview');
        preview.append(pokemonPortrait(artwork, imageURL, true));
      } else {
        preview.classList.add('pokemon-board');
        preview.style.setProperty('--pokemon-image', `url("${imageURL}")`);
        fillMosaic(preview, key, entries, artwork, imageURL, { thumbnail: true });
      }
      card.append(create('span', 'dex-number', `No.${String(artwork.pokemonId).padStart(3, '0')}`));
    } else {
      if (imageURL) preview.style.backgroundImage = `url("${imageURL}")`;
      preview.classList.toggle('has-art', Boolean(imageURL));
      fillMosaic(preview, key, entries, artwork, imageURL, { thumbnail: true });
      card.append(create('span', 'dex-number', '冒険のアルバム'));
    }
    const name = completed ? artwork.pokemonName : artwork?.artType === 'pokemon' ? '？？？' : imageURL ? '月の絵' : '未選択';
    card.append(preview, create('h4', 'dex-name', name),
      create('p', '', `${key.length === 10 ? `${Number(key.slice(0, 4))}年` : ""}${periodLabel(key)} · ${summary.activeDays} / ${periodDays(key).length} マス`));
    const track = create('div', 'exp-track dex-progress');
    const fill = create('span');
    fill.style.width = `${100 * summary.activeDays / periodDays(key).length}%`;
    track.append(fill);
    card.append(track, button('記録を見る', 'secondary-button', () => showPastMonth(key, artwork, entries, imageURL)));
    if (completed) {
      const avatar = button(adventureSettings.avatarMonth === key ? 'アバターに設定中' : 'アバターにする', 'primary-button', async () => {
        await saveAdventureSettings({ avatarMonth: key });
        notify(`${artwork.pokemonName}をアバターにしました`);
        renderAlbum();
      });
      avatar.setAttribute('aria-pressed', String(adventureSettings.avatarMonth === key));
      card.append(avatar);
    }
    list.append(card);
  }
  const badges = $('#badge-list');
  badges.replaceChildren();
  for (const badge of badgeStatus(entries, months)) {
    const card = create('div', `badge-card${badge.earned ? ' earned' : ''}`);
    const icon = create('span', 'badge-icon', badge.icon);
    icon.setAttribute('aria-hidden', 'true');
    card.append(icon, create('h4', '', badge.name), create('p', '', badge.earned ? '獲得！' : `${badge.progress} / ${badge.target}`));
    card.setAttribute('aria-label', `${badge.name}。${badge.description}。${badge.earned ? '獲得済み' : '未獲得'}`);
    badges.append(card);
  }
  const questions = entries.filter(entry => entry.question)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const notes = $('#question-list');
  notes.replaceChildren();
  if (!questions.length) notes.append(create('p', 'empty-note', '疑問を記録すると、ここに並ぶよ。'));
  questions.forEach(entry => {
    const note = create('div', 'question-note');
    note.append(create('small', '', entry.date), create('p', '', entry.question));
    notes.append(note);
  });
}

async function showPastMonth(month, artwork, entries, imageURL) {
  artwork = await withCoverage(artwork);
  const content = $('#detail-content');
  const board = create('div', 'art-board');
  const grid = create('div', 'month-grid');
  board.classList.toggle('pokemon-board', artwork?.artType === 'pokemon');
  board.classList.toggle('has-art', Boolean(imageURL));
  board.style.backgroundImage = imageURL && artwork?.artType !== 'pokemon'
    ? `url("${imageURL}")` : '';
  board.style.setProperty('--pokemon-image', imageURL ? `url("${imageURL}")` : 'none');
  fillMosaic(grid, month, entries, artwork, imageURL, { onDay: showDay });
  board.append(grid);
  const summary = summarizePeriod(entries, month);
  const completed = artwork?.artType === 'pokemon' &&
    summary.activeDays === periodDays(month).length;
  content.replaceChildren(
    create('h2', '', `${month.length === 10 ? `${Number(month.slice(0, 4))}年` : ""}${periodLabel(month)}`),
    board,
    create('p', '', completed ? `完成！ ${artwork.pokemonName}` :
      `${summary.activeDays} / ${periodDays(month).length} マス`)
  );
  content.querySelector('h2').id = 'detail-title';
  $('#detail-dialog').showModal();
}

function simpleHash(pin) {
  let value = 2166136261;
  for (const character of `mainichi:${pin}`) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, '0');
}

async function hashPin(pin, method) {
  if (method === 'simple') return simpleHash(pin);
  if (!crypto.subtle) throw new Error('この場所では以前設定したPINを確認できません。HTTPSで開いてください');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`mainichi:${pin}`));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function currentPin() {
  return (await get(db, 'settings', 'pin'))?.value;
}

async function updatePinGate() {
  const pin = await currentPin();
  $('#pin-prompt').textContent = changingPin ? '新しい4桁のPINを設定してください。' :
    pin ? '4桁のPINを入力してください。' : 'はじめに4桁のPINを設定してください。';
  $('#pin-message').textContent = '';
}

async function submitPin(event) {
  event.preventDefault();
  const input = $('#pin-input');
  const value = input.value;
  input.value = '';
  if (!/^\d{4}$/.test(value)) {
    $('#pin-message').textContent = '数字4桁で入力してください。';
    return;
  }
  try {
    const stored = await currentPin();
    if (changingPin || !stored) {
      const method = crypto.subtle ? 'sha256' : 'simple';
      await put(db, 'settings', { key: 'pin', value: { method, hash: await hashPin(value, method) } });
      changingPin = false;
      parentOpen = true;
      notify('PINを保存しました');
    } else if (await hashPin(value, stored.method) === stored.hash) {
      parentOpen = true;
    } else {
      $('#pin-message').textContent = 'PINが違います。';
      return;
    }
    renderParent();
  } catch (error) {
    $('#pin-message').textContent = error.message;
  }
}

async function renderParent() {
  $('#pin-gate').hidden = parentOpen;
  $('#parent-content').hidden = !parentOpen;
  if (!parentOpen) return updatePinGate();
  const [entries, categories, replies, nickname, settings] = await Promise.all([
    all(db, 'entries'), all(db, 'categories'), all(db, 'replies'),
    get(db, 'settings', 'nickname'), readAdventureSettings()
  ]);
  if (view !== 'parent' || !parentOpen) return;
  clearImageURLs();
  $('#nickname-input').value = nickname?.value?.name || 'トレーナー';
  $('#daily-goal').value = settings.dailyGoal;
  $('#sound-enabled').checked = settings.soundEnabled;
  entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const list = $('#parent-entries');
  list.replaceChildren();
  if (!entries.length) list.append(create('p', '', '記録はまだありません。'));
  entries.forEach(entry => list.append(renderEntry(entry, categories, replies, true)));
  const categoryList = $('#parent-categories');
  categoryList.replaceChildren();
  for (const category of orderedCategories(categories)) {
    const row = create('div', 'category-row list-item');
    const icon = create('input');
    icon.value = category.icon;
    icon.maxLength = 16;
    icon.setAttribute('aria-label', `${category.name}のアイコン`);
    const name = create('input');
    name.value = category.name;
    name.maxLength = 80;
    name.setAttribute('aria-label', `${category.name}の名前`);
    const visible = button(category.visible ? '表示中' : '非表示', 'secondary-button', async () => {
      await put(db, 'categories', { ...category, visible: !category.visible });
      renderParent();
      renderRecordChoices();
    });
    const save = button('保存', 'secondary-button', async () => {
      if (!icon.value.trim() || !name.value.trim()) return notify('アイコンと名前を入れてください');
      await put(db, 'categories', { ...category, icon: icon.value.trim(), name: name.value.trim() });
      notify('項目を保存しました');
      renderParent();
      renderRecordChoices();
    });
    row.append(icon, name, visible, save);
    categoryList.append(row);
  }
  try {
    if (!navigator.storage?.estimate) throw new Error('estimate unavailable');
    const estimate = await navigator.storage.estimate();
    $('#storage-estimate').textContent =
      `このブラウザの使用量の目安: ${Math.round((estimate.usage ?? 0) / 1048576)} MB / ${Math.round((estimate.quota ?? 0) / 1048576)} MB${persistGranted === false ? '。こまめに書き出してください' : ''}`;
  } catch {
    $('#storage-estimate').textContent = '容量の目安は取得できません。';
  }
}

async function downloadBackup() {
  const backup = await exportBackup(db);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error('バックアップが読み込み上限を超えています');
  const url = URL.createObjectURL(blob);
  const link = create('a');
  link.href = url;
  link.download = `mainichi-kiroku-${localDateKey()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  notify('バックアップを書き出しました');
}

async function loadBackup(file) {
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error('ファイルが大きすぎます');
    const data = validateBackup(JSON.parse(await file.text()));
    if (!await customConfirm('バックアップを読み込みますか？',
      `現在のデータを置き換えます。記録${data.entries.length}件、週の相棒${data.weeks.length}件、月の絵${data.months.length}件です。`,
      '置き換える')) return;
    await importBackup(db, data);
    await prepareCategoryColors();
    await readAdventureSettings();
    parentOpen = false;
    candidates = { month: '', items: [] };
    candidateRequest++;
    clearImageURLs();
    await renderRecordChoices();
    await updateBadge();
    renderParent();
    notify('バックアップを読み込みました');
  } catch (error) {
    notify(`読み込めませんでした: ${error.message}`);
  } finally {
    $('#import-file').value = '';
  }
}

async function init() {
  try {
    db = await openDatabase();
    await seedCategories(db);
    await prepareCategoryColors();
    await readAdventureSettings();
    initSound();
    document.querySelectorAll('.nav-button').forEach(tab =>
      tab.addEventListener('click', () => showView(tab.dataset.view))
    );
    document.querySelectorAll('[data-close]').forEach(close =>
      close.addEventListener('click', () => close.closest('dialog').close())
    );
    $('#parent-entry').addEventListener('click', () => showView('parent'));
    $('#parent-back').addEventListener('click', () => showView('home'));
    $('#open-record').addEventListener('click', openRecord);
    $('#close-record').addEventListener('click', closeRecord);
    $('#record-form').addEventListener('submit', saveEntry);
    $('#entry-photo').addEventListener('change', event => {
      $('#photo-name').textContent = event.target.files[0]?.name ?? '';
      $('#record-photo-preview').hidden = Boolean(event.target.files[0]) || !savedPhoto;
      const entry = selectedRows.get(sharedRowId);
      if (entry) entry.photoFile = event.target.files[0] ?? null;
    });
    $('#refresh-candidates').addEventListener('click', () => loadCandidates(weekKey(localDateKey()), true));
    $('#reply-button').addEventListener('click', showReplies);
    initEffects();
    $('#adventure-form').addEventListener('submit', async event => {
      event.preventDefault();
      const dailyGoal = Number($('#daily-goal').value);
      if (!Number.isInteger(dailyGoal) || dailyGoal < 5 || dailyGoal > 180) return notify('目標は5〜180分で設定してください');
      await saveAdventureSettings({ dailyGoal, soundEnabled: $('#sound-enabled').checked });
      notify('冒険の設定を保存しました');
    });
    $('#reset-avatar').addEventListener('click', async () => {
      await saveAdventureSettings({ avatarMonth: null });
      notify('今週の相棒をアバターにしました');
    });
    $('#pin-form').addEventListener('submit', submitPin);
    $('#parent-lock').addEventListener('click', () => { parentOpen = false; renderParent(); });
    $('#change-pin').addEventListener('click', () => { changingPin = true; parentOpen = false; renderParent(); });
    $('#nickname-form').addEventListener('submit', async event => {
      event.preventDefault();
      const name = $('#nickname-input').value.trim();
      if (!name) return notify('名前を入力してください');
      await put(db, 'settings', { key: 'nickname', value: { name } });
      notify('プレイヤー名を保存しました');
    });
    $('#category-form').addEventListener('submit', async event => {
      event.preventDefault();
      const icon = $('#new-category-icon').value.trim();
      const name = $('#new-category-name').value.trim();
      if (!icon || !name) return;
      await put(db, 'categories', {
        id: crypto.randomUUID?.() ?? `category-${Date.now()}`, icon, name, visible: true
      });
      await prepareCategoryColors();
      $('#new-category-name').value = '';
      renderParent();
      renderRecordChoices();
    });
    $('#export-button').addEventListener('click', () =>
      downloadBackup().catch(error => notify(error.message))
    );
    $('#import-file').addEventListener('change', event => loadBackup(event.target.files[0]));
    $('#record-sheet').addEventListener('close', () => {
      document.body.style.overflow = '';
      $('#open-record').focus();
    });
    window.addEventListener('focus', refreshForDateChange);
    document.addEventListener('visibilitychange', refreshForDateChange);
    document.addEventListener('close', refreshForDateChange, true);
    await renderRecordChoices();
    await updateBadge();
    await renderHome();
    refreshForDateChange();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    if (navigator.storage?.persist) navigator.storage.persist()
      .then(granted => { persistGranted = granted; })
      .catch(() => { persistGranted = false; });
  } catch (error) {
    notify(`アプリを開けませんでした: ${error.message}`);
  }
}

init();
