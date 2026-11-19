import {useSyncExternalStore} from 'react';

/**
 * 收藏夹：只在本机保存人物 id。用 useSyncExternalStore 让所有订阅组件
 * （大卡里的收藏按钮、排行榜的收藏页）共享同一份状态，改动即时同步。
 */
const KEY = 'nahfi-favorites';
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function emit() { for (const listener of listeners) listener(); }

export function isFavorite(id: string): boolean { return read().includes(id); }

export function toggleFavorite(id: string): void {
  const current = read();
  cache = current.includes(id) ? current.filter(x => x !== id) : [id, ...current];
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* 隐私模式忽略 */ }
  emit();
}

export function useFavorites(): string[] {
  return useSyncExternalStore(
    callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    read,
    () => EMPTY,
  );
}
