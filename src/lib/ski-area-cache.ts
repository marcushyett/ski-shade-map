/**
 * IndexedDB-based cache for ski area data with 24-hour TTL
 * Uses web workers to keep main thread responsive
 */

const DB_NAME = 'ski-shade-cache';
const DB_VERSION = 1;
const STORE_NAME = 'ski-areas';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedSkiAreaData {
  id: string;
  runs: unknown[];
  lifts: unknown[];
  info: unknown;
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open/create the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });

  return dbPromise;
}

/**
 * Get cached ski area data if it exists and is not expired
 */
export async function getCachedSkiArea(skiAreaId: string): Promise<CachedSkiAreaData | null> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(skiAreaId);

      request.onsuccess = () => {
        const data = request.result as CachedSkiAreaData | undefined;

        if (!data) {
          resolve(null);
          return;
        }

        // Check if cache has expired
        const age = Date.now() - data.cachedAt;
        if (age > CACHE_TTL_MS) {
          // Cache expired, delete it
          clearCachedSkiArea(skiAreaId).catch(console.error);
          resolve(null);
          return;
        }

        resolve(data);
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to get cached ski area:', error);
    return null;
  }
}

/**
 * Cache ski area data
 */
export async function cacheSkiArea(
  skiAreaId: string,
  runs: unknown[],
  lifts: unknown[],
  info: unknown
): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const data: CachedSkiAreaData = {
        id: skiAreaId,
        runs,
        lifts,
        info,
        cachedAt: Date.now(),
      };

      const request = store.put(data);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to cache ski area:', error);
  }
}

/**
 * Delete cached ski area data (exported as clearCachedSkiArea)
 */
export async function clearCachedSkiArea(skiAreaId: string): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(skiAreaId);

      request.onsuccess = () => {
        resolve();
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to delete from cache:', error);
  }
}

/**
 * Clear all expired cache entries (housekeeping)
 */
export async function clearExpiredCache(): Promise<void> {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          const data = cursor.value as CachedSkiAreaData;
          const age = Date.now() - data.cachedAt;

          if (age > CACHE_TTL_MS) {
            cursor.delete();
          }

          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (error) {
    console.error('Failed to clear expired cache:', error);
  }
}

/**
 * Get cache age in a human-readable format
 */
export function getCacheAge(cachedAt: number): string {
  const age = Date.now() - cachedAt;
  const hours = Math.floor(age / (60 * 60 * 1000));
  const minutes = Math.floor((age % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) {
    return `${hours}h ${minutes}m ago`;
  }
  return `${minutes}m ago`;
}
