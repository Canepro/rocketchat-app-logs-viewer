import * as React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Root layout: header bar, optional sidebar (left or overlay), and main content.
 * Used for logs-first layout: sidebar = controls, main = log stream.
 * On narrow viewports (drawer mode), sidebar becomes an overlay; use onSidebarOpenChange to toggle.
 * See web/docs/ARCHITECTURE.md §1.
 */
export interface AppShellProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Content for the top header bar (e.g. title, theme toggle, status). */
  header: React.ReactNode;
  /** Content for the left sidebar (e.g. query form, saved views, audit, targets). */
  sidebar: React.ReactNode;
  /** Main content (e.g. virtualized log list). */
  children: React.ReactNode;
  /** When true, viewport is narrow and sidebar is shown as overlay (drawer). When false, sidebar is inline (desktop). */
  isDrawerMode?: boolean;
  /** Sidebar visible. In drawer mode: false = hidden, true = overlay open. In inline mode: ignored (always shown). */
  sidebarOpen?: boolean;
  /** Called when user closes the sidebar (drawer mode). Pass to Filters button and drawer close. */
  onSidebarOpenChange?: (open: boolean) => void;
}

export const AppShell = React.forwardRef<HTMLDivElement, AppShellProps>(
  (
    {
      header,
      sidebar,
      children,
      isDrawerMode = false,
      sidebarOpen = true,
      onSidebarOpenChange,
      className,
      ...props
    },
    ref,
  ) => {
    const showSidebar = isDrawerMode ? sidebarOpen : true;
    const isOverlay = isDrawerMode && sidebarOpen;

    return (
      <div
        ref={ref}
        className={cn(
          'app-shell-surface flex min-h-screen flex-col text-foreground',
          className,
        )}
        {...props}
      >
        <header className="shrink-0 border-b border-border/80 bg-card/90 shadow-sm backdrop-blur" role="banner">
          {header}
        </header>
        <div className="flex min-h-0 flex-1 relative">
          {isOverlay ? (
            <>
              <div
                className="fixed inset-0 z-40 bg-black/50 md:hidden"
                aria-hidden
                onClick={() => onSidebarOpenChange?.(false)}
              />
              <aside
                className="fixed inset-y-0 left-0 z-50 flex w-[min(380px,100vw)] flex-col border-r border-border bg-card shadow-xl overflow-y-auto"
                aria-label="Filters and controls"
              >
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-3 py-2">
                  <span className="text-sm font-medium">Filters &amp; controls</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => onSidebarOpenChange?.(false)}
                    aria-label="Close filters"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {sidebar}
              </aside>
            </>
          ) : null}
          {!isDrawerMode && showSidebar ? (
            <aside
              className="flex w-[368px] shrink-0 flex-col border-r border-border/80 bg-muted/25 overflow-y-auto"
              aria-label="Filters and controls"
            >
              {sidebar}
            </aside>
          ) : null}
          <main className="min-w-0 flex-1 overflow-auto" role="main">
            {children}
          </main>
        </div>
      </div>
    );
  },
);
AppShell.displayName = 'AppShell';
