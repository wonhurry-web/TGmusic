import { create } from 'zustand';
import type { ThemeMode } from '../types';

const STORAGE_KEY = 'syncwave:theme';

function loadTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (saved === 'light' || saved === 'dark' || saved === 'colorful') return saved;
  } catch {
    /* ignore */
  }
  return 'dark';
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute('data-theme', mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  mode: loadTheme(),
  setMode: (mode) => {
    applyTheme(mode);
    set({ mode });
  },
}));

// 初始化时应用一次
applyTheme(useThemeStore.getState().mode);
