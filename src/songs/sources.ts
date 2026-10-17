/**
 * Original MIDI bytes of imported songs, kept in IndexedDB on this device so the Tracks sheet
 * can re-split hands later. localStorage holds only the converted notes. Every call is guarded:
 * without IndexedDB (some private windows) songs still import, they just can't be re-split.
 */
const DB = 'keys-sources';
const STORE = 'midi';

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** True when it was stored. */
export async function putSource(id: string, bytes: Uint8Array): Promise<boolean> {
  return (await run('readwrite', (s) => s.put(bytes, id))) !== undefined;
}

export async function getSource(id: string): Promise<Uint8Array | null> {
  const v = await run<unknown>('readonly', (s) => s.get(id));
  return v instanceof Uint8Array ? v : null;
}

export async function deleteSource(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
