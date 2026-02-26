import * as React from 'react';

import { cn } from '@/lib/utils';

export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message?: string;
}

export function LoadingState({ message = 'Loading…', className, ...props }: LoadingStateProps) {
  return (
    <div
      className={cn('flex items-center gap-2 py-3 text-sm text-muted-foreground', className)}
      aria-live="polite"
      {...props}
    >
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
        aria-hidden
      />
      <span>{message}</span>
    </div>
  );
}
