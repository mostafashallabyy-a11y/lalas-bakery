// Safe storage accessors — never throw on iPhone private mode / quota errors.
export type StorageArea = "local" | "session";
const areaOf = (a: StorageArea): Storage | null => {
  try {
    return a === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export function storageGet(area: StorageArea, key: string): string | null {
  try {
    return areaOf(area)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function storageSet(area: StorageArea, key: string, value: string): boolean {
  try {
    areaOf(area)?.setItem(key, value);
    return true;
  } catch {
    return false; // quota exceeded / private mode — ignore, app must still work
  }
}

export function storageRemove(area: StorageArea, key: string): void {
  try {
    areaOf(area)?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function storageGetJSON<T>(area: StorageArea, key: string, fallback: T): T {
  const raw = storageGet(area, key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function storageSetJSON(area: StorageArea, key: string, value: unknown): boolean {
  try {
    return storageSet(area, key, JSON.stringify(value));
  } catch {
    return false;
  }
}
