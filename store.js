// Activities live in this browser's IndexedDB, keyed per athlete. Nothing is stored server-side.

const DB = 'fogofwalk';
const STORE = 'activities';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const os = req.result.createObjectStore(STORE, { keyPath: 'key' });
      os.createIndex('athlete', 'athlete');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

export async function all(athlete) {
  try {
    const db = await open();
    const rows = await tx(db, 'readonly', (s) => s.index('athlete').getAll(athlete));
    return (rows || []).map(({ key, athlete: _a, ...a }) => a);
  } catch (e) {
    console.warn('IndexedDB unavailable', e);
    return memory.get(athlete) || [];
  }
}

export async function put(athlete, acts) {
  try {
    const db = await open();
    await tx(db, 'readwrite', (s) => { for (const a of acts) s.put({ ...a, key: `${athlete}:${a.id}`, athlete }); });
  } catch {
    const m = memory.get(athlete) || [];
    memory.set(athlete, m.concat(acts));
  }
}

export async function clear(athlete) {
  try {
    const db = await open();
    const keys = await tx(db, 'readonly', (s) => s.index('athlete').getAllKeys(athlete));
    await tx(db, 'readwrite', (s) => { for (const k of keys || []) s.delete(k); });
  } catch { memory.delete(athlete); }
}

const memory = new Map();
