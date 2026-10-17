/**
 * Tiny promise wrapper over one IndexedDB object store. Holds project data
 * and version history in the browser — no server, no account, free.
 */
const DB_NAME = "episteme";
const STORE = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = fn(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const idbGet = <T>(key: string) => run<T | undefined>("readonly", (store) => store.get(key) as IDBRequest<T | undefined>);
export const idbSet = (key: string, value: unknown) => run("readwrite", (store) => store.put(value, key)).then(() => undefined);
export const idbDel = (key: string) => run("readwrite", (store) => store.delete(key)).then(() => undefined);
