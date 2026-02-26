import * as React from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  applyTheme,
  getEffectiveTheme,
  setStoredTheme,
  type Theme,
} from '@/lib/theme';

/**
 * Toggle between light and dark theme. Persists choice to localStorage and applies class "dark" to document.documentElement.
 * See web/docs/ARCHITECTURE.md §2 and src/lib/theme.ts.
 */
export function ThemeToggle({
  className,
  size = 'icon',
  variant = 'outline',
  ...props
}: React.ComponentProps<typeof Button>) {
  const [theme, setTheme] = React.useState<Theme>(() => getEffectiveTheme());

  const toggle = React.useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setStoredTheme(next);
    applyTheme(next);
    setTheme(next);
  }, [theme]);

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={toggle}
      className={className}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      {...props}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" aria-hidden />
      ) : (
        <Moon className="h-4 w-4" aria-hidden />
      )}
    </Button>
  );
}
