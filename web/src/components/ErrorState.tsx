import * as React from 'react';

import { Alert } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  message: string;
  details?: string | null;
}

export function ErrorState({
  title = 'Error',
  message,
  details,
  className,
  ...props
}: ErrorStateProps) {
  return (
    <Alert
      variant="destructive"
      className={cn(className)}
      role="alert"
      {...props}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-0.5">{message}</p>
      {details ? (
        <p className="mt-1 break-all text-xs opacity-90">details: {details}</p>
      ) : null}
    </Alert>
  );
}
