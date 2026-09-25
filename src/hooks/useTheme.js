'use client';
import { useEffect } from 'react';

export function useTheme(theme) {
  useEffect(() => {
    if (!theme) return;
    applyTheme(theme);
  }, [theme]);
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--color-primary', theme.primaryColor || '#FF6B35');
  root.style.setProperty('--color-secondary', theme.secondaryColor || '#1A1A2E');
  root.style.setProperty('--color-accent', theme.accentColor || '#F7C948');
  root.style.setProperty('--color-bg', theme.backgroundColor || '#FFFFFF');
  root.style.setProperty('--color-text', theme.textColor || '#1A1A2E');
  root.style.setProperty('--font-body', theme.fontFamily || 'Inter');
  root.style.setProperty('--font-heading', theme.headingFont || 'Outfit');
  root.style.setProperty('--border-radius', theme.borderRadius || '12px');
}
