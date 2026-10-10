export type ThemeMode = 'light' | 'dark'

export const DEFAULT_THEME_MODE: ThemeMode = 'dark'

const THEME_QUERY_PARAM = 'theme'

/** Anything other than an explicit `'light'` / `'dark'` falls back to dark. */
export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME_MODE
}

export function themeModeFromSearch(search: string): ThemeMode {
  return parseThemeMode(new URLSearchParams(search).get(THEME_QUERY_PARAM))
}

export function applyThemeMode(mode: ThemeMode): void {
  document.documentElement.dataset.sgTheme = mode
}

export function appliedThemeMode(): ThemeMode {
  return parseThemeMode(document.documentElement.dataset.sgTheme)
}
