import { DEFAULT_CATEGORIES, FORMAT_VERSION, validateBackup, replaceDayEntries } from './core.js';

const DB_NAME = 'mainichi-kiroku';
const DB_VERSION = 3;
const STORES = ['entries', 'months', 'weeks', 'categories', 'settings', 'replies'];

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

const requestResult = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const transactionDone = tx => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('保存できませんでした')); });

export async function all(db, store) { return requestResult(db.transaction(store).objectStore(store).getAll()); }
export async function get(db, store, key) { return requestResult(db.transaction(store).objectStore(store).get(key)); }
export async function put(db, store, value) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).put(value); await transactionDone(tx); }
export function saveDayEntries(db, date, entries) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'replies'], 'readwrite');
    const store = tx.objectStore('entries');
    let result;
    let failure;
    const request = store.getAll();
    request.onsuccess = () => {
      try {
        const previous = request.result;
        const replacement = replaceDayEntries(previous, date, entries);
        const retained = new Set(previous.filter(entry => entry.date === date).map(entry => entry.id));
        for (const id of replacement.deletedIds) {
          store.delete(id);
          tx.objectStore('replies').delete(id);
        }
        for (const entry of replacement.entries) {
          if (retained.has(entry.id)) store.put(entry);
          else store.add(entry);
        }
        result = { ...replacement, previous,
          afterEntries: [...previous.filter(entry => entry.date !== date), ...replacement.entries] };
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure ?? tx.error ?? new Error('保存できませんでした'));
  });
}
export async function removeEntry(db, id) { const tx = db.transaction(['entries', 'replies'], 'readwrite'); tx.objectStore('entries').delete(id); tx.objectStore('replies').delete(id); await transactionDone(tx); }
export async function remove(db, store, key) { const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(key); await transactionDone(tx); }

export function choosePokemonWeek(db, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('weeks', 'readwrite');
    const store = tx.objectStore('weeks');
    let saved = false;
    const request = store.get(value.id);
    request.onsuccess = () => {
      if (request.result?.artType === 'pokemon') return;
      store.put(value);
      saved = true;
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('週の相棒を保存できませんでした'));
  });
}

export async function seedCategories(db) {
  const existing = await all(db, 'categories');
  if (existing.length) {
    const previousNames = { juku: '塾のしゅくだい', school: '学校のしゅくだい', research: '調べもの・自由研究' };
    const updates = existing.filter(category => category.name === previousNames[category.id]);
    if (!updates.length) return;
    const tx = db.transaction('categories', 'readwrite');
    for (const category of updates) {
      const current = DEFAULT_CATEGORIES.find(defaultCategory => defaultCategory.id === category.id);
      tx.objectStore('categories').put({ ...category, name: current.name });
    }
    await transactionDone(tx);
    return;
  }
  const tx = db.transaction('categories', 'readwrite');
  DEFAULT_CATEGORIES.forEach(category => tx.objectStore('categories').put(category));
  await transactionDone(tx);
}

const blobToDataURL = blob => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
});
const dataURLToBlob = dataURL => {
  const [meta, base64] = dataURL.split(',');
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: meta.slice(5, -7) });
};

export async function exportBackup(db) {
  const result = { formatVersion: FORMAT_VERSION, exportedAt: new Date().toISOString() };
  const tx = db.transaction(STORES);
  const rows = await Promise.all(STORES.map(name => requestResult(tx.objectStore(name).getAll())));
  STORES.forEach((name, index) => { result[name] = rows[index]; });
  result.entries = await Promise.all(result.entries.map(async entry => ({ ...entry, photo: entry.photo ? await blobToDataURL(entry.photo) : null })));
  for (const name of ['months', 'weeks']) {
    result[name] = await Promise.all(result[name].map(async art => ({ ...art, artwork: art.artwork ? await blobToDataURL(art.artwork) : null })));
  }
  return result;
}

export async function importBackup(db, raw) {
  const data = validateBackup(raw);
  const entries = data.entries.map(entry => ({ ...entry, photo: entry.photo ? dataURLToBlob(entry.photo) : null }));
  const months = data.months.map(month => ({ ...month, artwork: month.artwork ? dataURLToBlob(month.artwork) : null }));
  const weeks = data.weeks.map(week => ({ ...week, artwork: dataURLToBlob(week.artwork) }));
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) tx.objectStore(name).clear();
  for (const name of STORES) for (const row of name === 'entries' ? entries : name === 'months' ? months : name === 'weeks' ? weeks : data[name]) tx.objectStore(name).put(row);
  await transactionDone(tx);
}
