'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_KEY = 'commercepilot_theme';

// ── Provider ──────────────────────────────────────────────────────
export function ThemeProvider({ children }: { children: ReactNode }) {
  // The blocking inline script in layout.tsx already applied the right
  // data-theme attribute before paint; read it back so React state agrees.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setThemeState(current === 'dark' ? 'dark' : 'light');
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage unavailable — theme just won't persist across reloads */
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Inlined into <head> as a blocking script so the correct theme applies
// before first paint — defaults to light unless the user previously chose dark.
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');document.documentElement.setAttribute('data-theme', t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;
