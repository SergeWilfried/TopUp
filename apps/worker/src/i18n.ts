import { en, fr } from '@topup/core';

const DICT: Record<string, unknown> = { en, fr };

/**
 * Resolves a dotted translation key against the bundled locale resources.
 * Shared by the public catalogue (per-request `?lang`) and the console, which
 * is English-only.
 */
export const translator = (lang: string) => {
  const table = DICT[lang in DICT ? lang : 'en'];
  return (key: string, vars?: Record<string, string | number>) => {
    const value = key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object' && part in acc) return (acc as Record<string, unknown>)[part];
      return undefined;
    }, table);
    if (typeof value !== 'string') return key;
    return vars
      ? value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars[name] ?? ''))
      : value;
  };
};
