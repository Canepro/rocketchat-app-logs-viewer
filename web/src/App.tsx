import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertCircle, Database, History, Search } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DEFAULT_POLLING_INTERVAL_SECONDS,
  MAX_POLLING_INTERVAL_SECONDS,
  MIN_POLLING_INTERVAL_SECONDS,
  parsePollingIntervalSeconds,
} from '@/lib/polling';
import {
  AuditOutcome,
  LogsActionType,
  QueryLevel,
  SavedViewQuery,
  getAudit,
  getConfig,
  getSavedViews,
  getThreads,
  getTargets,
  getRuntimeConnection,
  isPrivateApiError,
  mutateSavedView,
  postLogAction,
  queryLogs,
} from '@/lib/api';

type PrefillContext = {
  source?: string;
  roomId?: string;
  roomName?: string;
  threadId?: string;
  senderId?: string;
};

type PrefillState = {
  preset?: string;
  timeMode: 'relative' | 'absolute';
  since?: string;
  start?: string;
  end?: string;
  level?: QueryLevel;
  limit?: number;
  search?: string;
  autorun: boolean;
  context: PrefillContext;
};

const levelOptions: Array<{ label: string; value: QueryLevel }> = [
  { label: 'Error', value: 'error' },
  { label: 'Warn', value: 'warn' },
  { label: 'Info', value: 'info' },
  { label: 'Debug', value: 'debug' },
];

const outcomeOptions: Array<{ label: string; value: AuditOutcome }> = [
  { label: 'Allowed', value: 'allowed' },
  { label: 'Denied', value: 'denied' },
];

const inputBaseClass =
  'h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2';

const selectBaseClass = `${inputBaseClass} pr-8`;

const labelClass = 'text-xs font-medium uppercase tracking-wide text-muted-foreground';
const ENTRY_PREVIEW_MAX_LINES = 6;
const ENTRY_PREVIEW_MAX_CHARS = 520;
const ENTRY_LABELS_PREVIEW_COUNT = 6;
const ENTRY_LABELS_EXPANDED_COUNT = 18;

const parseQueryLevel = (value: string | null): QueryLevel | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'error' || normalized === 'warn' || normalized === 'info' || normalized === 'debug') {
    return normalized;
  }

  return undefined;
};

const readPrefillFromLocation = (): PrefillState => {
  if (typeof window === 'undefined') {
    return {
      timeMode: 'relative',
      since: '15m',
      autorun: false,
      context: {},
    };
  }

  const params = new URLSearchParams(window.location.search);
  const start = params.get('start') || undefined;
  const end = params.get('end') || undefined;
  const hasAbsolute = Boolean(start && end);

  const limitRaw = params.get('limit');
  const limitParsed = limitRaw ? Number(limitRaw) : undefined;

  return {
    preset: params.get('preset') || undefined,
    timeMode: hasAbsolute ? 'absolute' : 'relative',
    since: params.get('since') || '15m',
    start,
    end,
    level: parseQueryLevel(params.get('level')),
    search: params.get('search') || undefined,
    limit: Number.isFinite(limitParsed) && (limitParsed || 0) > 0 ? Math.floor(limitParsed as number) : undefined,
    autorun: params.get('autorun') === '1' || params.get('run') === '1',
    context: {
      source: params.get('source') || undefined,
      roomId: params.get('roomId') || undefined,
      roomName: params.get('roomName') || undefined,
      threadId: params.get('threadId') || undefined,
      senderId: params.get('senderId') || undefined,
    },
  };
};

const formatTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

const toIsoFromDatetimeLocal = (value: string): string => new Date(value).toISOString();

const toDatetimeLocalInput = (value?: string): string => {
  if (!value) {
    return '';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const timezoneOffsetMs = parsed.getTimezoneOffset() * 60 * 1000;
  return new Date(parsed.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
};

const levelVariant = (level: string): 'default' | 'secondary' | 'outline' => {
  if (level === 'error') {
    return 'default';
  }
  if (level === 'warn') {
    return 'secondary';
  }
  return 'outline';
};

const summarizeSavedView = (query: SavedViewQuery): string => {
  const timePart = query.timeMode === 'relative'
    ? `since=${query.since || 'n/a'}`
    : `start=${query.start || 'n/a'} end=${query.end || 'n/a'}`;
  const levelPart = query.level ? `level=${query.level}` : 'level=any';
  const searchPart = query.search ? `search="${query.search}"` : 'search=none';
  return `${timePart} | limit=${query.limit} | ${levelPart} | ${searchPart}`;
};

const formatErrorDetails = (details: unknown): string | null => {
  if (details === undefined || details === null) {
    return null;
  }

  if (typeof details === 'string') {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
};

const formatMessageForDisplay = (message: string, mode: 'raw' | 'pretty'): { text: string; isStructured: boolean } => {
  if (mode === 'raw') {
    return { text: message, isStructured: false };
  }

  const trimmed = message.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return { text: message, isStructured: false };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return {
      text: JSON.stringify(parsed, null, 2),
      isStructured: true,
    };
  } catch {
    return { text: message, isStructured: false };
  }
};

const summarizeRenderedMessage = (message: string, expanded: boolean): {
  rendered: string;
  truncated: boolean;
  lineCount: number;
  charCount: number;
} => {
  const lineCount = message.length === 0 ? 0 : message.split('\n').length;
  const charCount = message.length;
  if (expanded || (lineCount <= ENTRY_PREVIEW_MAX_LINES && charCount <= ENTRY_PREVIEW_MAX_CHARS)) {
    return {
      rendered: message,
      truncated: false,
      lineCount,
      charCount,
    };
  }

  const maxChars = Math.max(16, ENTRY_PREVIEW_MAX_CHARS - 3);
  const compact = message.length > maxChars ? `${message.slice(0, maxChars)}...` : message;
  const lines = compact.split('\n');
  const rendered = lines.length > ENTRY_PREVIEW_MAX_LINES
    ? `${lines.slice(0, ENTRY_PREVIEW_MAX_LINES).join('\n')}\n...`
    : compact;

  return {
    rendered,
    truncated: rendered !== message,
    lineCount,
    charCount,
  };
};

export function App() {
  const runtime = useMemo(() => getRuntimeConnection(), []);
  const prefill = useMemo(readPrefillFromLocation, []);

  const [timeMode, setTimeMode] = useState<'relative' | 'absolute'>(prefill.timeMode);
  const [since, setSince] = useState(prefill.since || '15m');
  const [startAt, setStartAt] = useState(toDatetimeLocalInput(prefill.start));
  const [endAt, setEndAt] = useState(toDatetimeLocalInput(prefill.end));
  const [limit, setLimit] = useState(String(prefill.limit || 500));
  const [level, setLevel] = useState<QueryLevel | ''>(prefill.level || '');
  const [searchTerm, setSearchTerm] = useState(prefill.search || '');
  const [formError, setFormError] = useState<string | null>(null);
  const [pollIntervalSec, setPollIntervalSec] = useState(String(DEFAULT_POLLING_INTERVAL_SECONDS));
  const [isPolling, setIsPolling] = useState(false);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [pollingTickCount, setPollingTickCount] = useState(0);
  const [messageViewMode, setMessageViewMode] = useState<'raw' | 'pretty'>('pretty');
  const [wrapLogLines, setWrapLogLines] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const [copiedRowIndex, setCopiedRowIndex] = useState<number | null>(null);
  const [copyRowError, setCopyRowError] = useState<string | null>(null);

  const [auditUserId, setAuditUserId] = useState(prefill.context.senderId || '');
  const [auditOutcome, setAuditOutcome] = useState<AuditOutcome | ''>('');
  const [auditLimit, setAuditLimit] = useState('50');
  const [auditNonce, setAuditNonce] = useState(0);
  const [savedViewName, setSavedViewName] = useState(prefill.preset ? `Preset: ${prefill.preset}` : '');
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('');
  const [viewsNonce, setViewsNonce] = useState(0);
  const [savedViewError, setSavedViewError] = useState<string | null>(null);
  const [savedViewSuccess, setSavedViewSuccess] = useState<string | null>(null);
  const [actionRoomId, setActionRoomId] = useState(prefill.context.roomId || '');
  const [actionThreadId, setActionThreadId] = useState(prefill.context.threadId || '');
  const [roomSearch, setRoomSearch] = useState(prefill.context.roomName || '');
  const [threadSearch, setThreadSearch] = useState(prefill.context.threadId || '');
  const [targetsNonce, setTargetsNonce] = useState(0);
  const [threadsNonce, setThreadsNonce] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [activeActionKey, setActiveActionKey] = useState<string | null>(null);
  const normalizedActionRoomId = actionRoomId.trim();
  const normalizedActionThreadId = actionThreadId.trim();
  const isRoomTargetReady = normalizedActionRoomId.length > 0;
  const isThreadTargetReady = normalizedActionThreadId.length > 0;

  const autoRunTriggeredRef = useRef(false);
  const pollTickInFlightRef = useRef(false);
  const isQueryPendingRef = useRef(false);

  const configQuery = useQuery({
    queryKey: ['logs-config'],
    queryFn: getConfig,
    retry: 1,
  });

  const logsMutation = useMutation({
    mutationFn: queryLogs,
  });

  const auditQuery = useQuery({
    queryKey: ['logs-audit', auditUserId, auditOutcome, auditLimit, auditNonce],
    queryFn: () =>
      getAudit({
        limit: Math.max(1, Number(auditLimit) || 50),
        userId: auditUserId || undefined,
        outcome: auditOutcome || undefined,
      }),
    enabled: configQuery.isSuccess,
    retry: 1,
  });

  const targetsQuery = useQuery({
    queryKey: ['logs-targets', roomSearch, targetsNonce],
    queryFn: () =>
      getTargets({
        search: roomSearch || undefined,
        limit: 100,
      }),
    enabled: configQuery.isSuccess,
    retry: 1,
  });

  const viewsQuery = useQuery({
    queryKey: ['logs-views', viewsNonce],
    queryFn: () => getSavedViews({ limit: 50 }),
    enabled: configQuery.isSuccess,
    retry: 1,
  });

  const threadsQuery = useQuery({
    queryKey: ['logs-threads', normalizedActionRoomId, threadSearch, threadsNonce],
    queryFn: () =>
      getThreads({
        roomId: normalizedActionRoomId,
        search: threadSearch || undefined,
        limit: 100,
      }),
    enabled: configQuery.isSuccess && isRoomTargetReady,
    retry: 1,
  });

  const rowActionMutation = useMutation({
    mutationFn: postLogAction,
  });

  const savedViewMutation = useMutation({
    mutationFn: mutateSavedView,
  });

  const executeQuery = useCallback((): boolean => {
    setFormError(null);

    const parsedLimit = Math.max(1, Number(limit) || 500);
    const maxLinesPerQuery = configQuery.data?.config.maxLinesPerQuery;
    if (typeof maxLinesPerQuery === 'number' && parsedLimit > maxLinesPerQuery) {
      setFormError(`Limit exceeds configured max (${maxLinesPerQuery}).`);
      return false;
    }

    if (timeMode === 'absolute') {
      if (!startAt || !endAt) {
        setFormError('Start and end are required when using absolute time range.');
        return false;
      }

      const parsedStart = new Date(startAt);
      const parsedEnd = new Date(endAt);
      if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
        setFormError('Start or end has an invalid date-time value.');
        return false;
      }

      if (parsedStart.getTime() >= parsedEnd.getTime()) {
        setFormError('Start must be before end.');
        return false;
      }

      logsMutation.mutate({
        start: toIsoFromDatetimeLocal(startAt),
        end: toIsoFromDatetimeLocal(endAt),
        limit: parsedLimit,
        level: level || undefined,
        search: searchTerm || undefined,
      });
      return true;
    }

    if (!since.trim()) {
      setFormError('Relative duration is required (example: 15m, 1h, 24h).');
      return false;
    }

    logsMutation.mutate({
      since: since.trim(),
      limit: parsedLimit,
      level: level || undefined,
      search: searchTerm || undefined,
    });

    return true;
  }, [configQuery.data?.config.maxLinesPerQuery, endAt, level, limit, logsMutation, searchTerm, since, startAt, timeMode]);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    setPollingError(null);
  }, []);

  const startPolling = useCallback(() => {
    setPollingError(null);

    if (timeMode !== 'relative') {
      setPollingError('Live polling currently supports relative mode only.');
      return;
    }

    const intervalSeconds = parsePollingIntervalSeconds(pollIntervalSec);
    if (!intervalSeconds) {
      setPollingError('Polling interval must be a positive number of seconds.');
      return;
    }

    if (!executeQuery()) {
      setPollingError('Query validation failed. Fix query inputs before starting live polling.');
      return;
    }

    setPollIntervalSec(String(intervalSeconds));
    setPollingTickCount(1);
    setIsPolling(true);
  }, [executeQuery, pollIntervalSec, timeMode]);

  useEffect(() => {
    if (!prefill.autorun || autoRunTriggeredRef.current || !configQuery.isSuccess) {
      return;
    }

    autoRunTriggeredRef.current = true;
    executeQuery();
  }, [configQuery.isSuccess, executeQuery, prefill.autorun]);

  useEffect(() => {
    isQueryPendingRef.current = logsMutation.isPending;
  }, [logsMutation.isPending]);

  useEffect(() => {
    if (!isPolling) {
      return;
    }

    if (timeMode !== 'relative') {
      setIsPolling(false);
      setPollingError('Live polling stopped because time mode changed to absolute.');
      return;
    }

    const intervalSeconds = parsePollingIntervalSeconds(pollIntervalSec);
    if (!intervalSeconds) {
      setIsPolling(false);
      setPollingError('Live polling stopped due to invalid polling interval.');
      return;
    }

    const timer = setInterval(() => {
      // Skip poll ticks while a query request is still in-flight.
      if (pollTickInFlightRef.current || isQueryPendingRef.current) {
        return;
      }

      pollTickInFlightRef.current = true;
      const ok = executeQuery();
      if (!ok) {
        setIsPolling(false);
        setPollingError('Live polling stopped because query inputs are invalid.');
      } else {
        setPollingTickCount((value) => value + 1);
      }
      pollTickInFlightRef.current = false;
    }, intervalSeconds * 1000);

    return () => {
      clearInterval(timer);
    };
  }, [executeQuery, isPolling, pollIntervalSec, timeMode]);

  const entries = useMemo(() => logsMutation.data?.entries ?? [], [logsMutation.data?.entries]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 132,
    overscan: 8,
  });

  const toggleRowExpanded = useCallback((rowIndex: number) => {
    setExpandedRows((current) => ({
      ...current,
      [rowIndex]: !current[rowIndex],
    }));
  }, []);

  const copyRowMessage = useCallback(async (rowIndex: number) => {
    const entry = entries[rowIndex];
    if (!entry) {
      setCopyRowError('Selected row is no longer available.');
      setCopiedRowIndex(null);
      return;
    }

    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable in this browser context.');
      }

      await navigator.clipboard.writeText(entry.message);
      setCopiedRowIndex(rowIndex);
      setCopyRowError(null);
    } catch (error) {
      setCopiedRowIndex(null);
      setCopyRowError(error instanceof Error ? error.message : 'Unable to copy log line.');
    }
  }, [entries]);

  const queryError = logsMutation.error;
  const auditError = auditQuery.error;
  const viewsError = viewsQuery.error;
  const targetsError = targetsQuery.error;
  const threadsError = threadsQuery.error;
  const configError = configQuery.error;
  const slashContextRoomId = prefill.context.roomId?.trim() || '';
  const slashContextThreadId = prefill.context.threadId?.trim() || '';
  const canUseSlashRoomTarget = Boolean(slashContextRoomId);
  const canUseSlashThreadTarget = Boolean(slashContextRoomId && slashContextThreadId);
  const availableRoomTargets = targetsQuery.data?.targets.rooms || [];
  const availableThreadTargets = threadsQuery.data?.threads.items || [];
  const availableSavedViews = viewsQuery.data?.views.items || [];
  const selectedRoomTarget = availableRoomTargets.find((target) => target.id === normalizedActionRoomId);
  const selectedThreadTarget = availableThreadTargets.find((target) => target.id === normalizedActionThreadId);
  const selectedSavedView = availableSavedViews.find((view) => view.id === selectedSavedViewId);
  const expandedRowCount = Object.values(expandedRows).filter(Boolean).length;

  useEffect(() => {
    setExpandedRows({});
    setCopiedRowIndex(null);
    setCopyRowError(null);
  }, [entries]);

  useEffect(() => {
    // Virtual rows can change height when expanding rows or switching render mode.
    // Force a re-measure so rows do not overlap after UI-state changes.
    virtualizer.measure();
  }, [expandedRows, messageViewMode, virtualizer, wrapLogLines]);

  useEffect(() => {
    if (!selectedSavedViewId) {
      return;
    }
    if (!availableSavedViews.some((view) => view.id === selectedSavedViewId)) {
      setSelectedSavedViewId('');
    }
  }, [availableSavedViews, selectedSavedViewId]);

  const buildSavedViewQueryFromForm = useCallback((): SavedViewQuery | null => {
    const parsedLimit = Math.max(1, Number(limit) || 500);
    const normalizedSearch = searchTerm.trim() || undefined;
    const normalizedLevel = level || undefined;

    if (timeMode === 'relative') {
      const normalizedSince = since.trim();
      if (!normalizedSince) {
        setSavedViewError('Relative duration is required to save this view.');
        setSavedViewSuccess(null);
        return null;
      }

      return {
        timeMode: 'relative',
        since: normalizedSince,
        limit: parsedLimit,
        level: normalizedLevel,
        search: normalizedSearch,
      };
    }

    if (!startAt || !endAt) {
      setSavedViewError('Start and end are required when saving an absolute view.');
      setSavedViewSuccess(null);
      return null;
    }

    const parsedStart = new Date(startAt);
    const parsedEnd = new Date(endAt);
    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime()) || parsedStart.getTime() >= parsedEnd.getTime()) {
      setSavedViewError('Absolute saved views require a valid start time before end time.');
      setSavedViewSuccess(null);
      return null;
    }

    return {
      timeMode: 'absolute',
      start: toIsoFromDatetimeLocal(startAt),
      end: toIsoFromDatetimeLocal(endAt),
      limit: parsedLimit,
      level: normalizedLevel,
      search: normalizedSearch,
    };
  }, [endAt, level, limit, searchTerm, since, startAt, timeMode]);

  const applySavedView = useCallback((viewId: string) => {
    const target = availableSavedViews.find((view) => view.id === viewId);
    if (!target) {
      return;
    }

    setSelectedSavedViewId(target.id);
    setSavedViewName(target.name);
    setLimit(String(target.query.limit));
    setLevel(target.query.level || '');
    setSearchTerm(target.query.search || '');

    if (target.query.timeMode === 'relative') {
      setTimeMode('relative');
      setSince(target.query.since || '15m');
      setStartAt('');
      setEndAt('');
    } else {
      setTimeMode('absolute');
      setStartAt(toDatetimeLocalInput(target.query.start));
      setEndAt(toDatetimeLocalInput(target.query.end));
      setSince('15m');
    }

    setSavedViewError(null);
    setSavedViewSuccess(`Applied saved view: ${target.name}`);
  }, [availableSavedViews]);

  const createSavedView = useCallback(() => {
    const trimmedName = savedViewName.trim();
    if (!trimmedName) {
      setSavedViewError('Saved view name is required.');
      setSavedViewSuccess(null);
      return;
    }

    const query = buildSavedViewQueryFromForm();
    if (!query) {
      return;
    }

    savedViewMutation.mutate(
      {
        action: 'create',
        name: trimmedName,
        query,
      },
      {
        onSuccess: (response) => {
          setSavedViewError(null);
          setSelectedSavedViewId(response.view?.id || '');
          setSavedViewSuccess(`Saved new view: ${response.view?.name || trimmedName}`);
          setAuditNonce((value) => value + 1);
          setViewsNonce((value) => value + 1);
        },
        onError: (error) => {
          setSavedViewSuccess(null);
          setSavedViewError(
            isPrivateApiError(error) ? `${error.message} (HTTP ${error.status})` : 'Unexpected error while creating saved view.',
          );
        },
      },
    );
  }, [buildSavedViewQueryFromForm, savedViewMutation, savedViewName]);

  const updateSavedView = useCallback(() => {
    if (!selectedSavedViewId) {
      setSavedViewError('Select a saved view before updating.');
      setSavedViewSuccess(null);
      return;
    }

    const trimmedName = savedViewName.trim();
    const query = buildSavedViewQueryFromForm();
    if (!query) {
      return;
    }

    savedViewMutation.mutate(
      {
        action: 'update',
        id: selectedSavedViewId,
        name: trimmedName || undefined,
        query,
      },
      {
        onSuccess: (response) => {
          setSavedViewError(null);
          setSavedViewSuccess(`Updated saved view: ${response.view?.name || selectedSavedViewId}`);
          setAuditNonce((value) => value + 1);
          setViewsNonce((value) => value + 1);
        },
        onError: (error) => {
          setSavedViewSuccess(null);
          setSavedViewError(
            isPrivateApiError(error) ? `${error.message} (HTTP ${error.status})` : 'Unexpected error while updating saved view.',
          );
        },
      },
    );
  }, [buildSavedViewQueryFromForm, savedViewMutation, savedViewName, selectedSavedViewId]);

  const deleteSavedView = useCallback(() => {
    if (!selectedSavedViewId) {
      setSavedViewError('Select a saved view before deleting.');
      setSavedViewSuccess(null);
      return;
    }

    const targetId = selectedSavedViewId;
    savedViewMutation.mutate(
      {
        action: 'delete',
        id: targetId,
      },
      {
        onSuccess: () => {
          setSavedViewError(null);
          setSavedViewSuccess('Deleted saved view.');
          setSelectedSavedViewId('');
          setAuditNonce((value) => value + 1);
          setViewsNonce((value) => value + 1);
        },
        onError: (error) => {
          setSavedViewSuccess(null);
          setSavedViewError(
            isPrivateApiError(error) ? `${error.message} (HTTP ${error.status})` : 'Unexpected error while deleting saved view.',
          );
        },
      },
    );
  }, [savedViewMutation, selectedSavedViewId]);

  const applySlashRoomTarget = useCallback(() => {
    if (!slashContextRoomId) {
      return;
    }

    setActionRoomId(slashContextRoomId);
    setActionThreadId('');
    setThreadSearch('');
    setActionError(null);
    setActionSuccess(null);
  }, [slashContextRoomId]);

  const applySlashThreadTarget = useCallback(() => {
    if (!slashContextRoomId || !slashContextThreadId) {
      return;
    }

    // Apply room + thread together to avoid mismatched targets.
    setActionRoomId(slashContextRoomId);
    setActionThreadId(slashContextThreadId);
    setThreadSearch(slashContextThreadId);
    setActionError(null);
    setActionSuccess(null);
  }, [slashContextRoomId, slashContextThreadId]);

  const clearActionTargets = useCallback(() => {
    setActionRoomId('');
    setActionThreadId('');
    setThreadSearch('');
    setActionError(null);
    setActionSuccess(null);
  }, []);

  const applyRoomTarget = useCallback((roomId: string) => {
    setActionRoomId(roomId);
    setActionThreadId('');
    setThreadSearch('');
    setThreadsNonce((value) => value + 1);
    setActionError(null);
    setActionSuccess(null);
  }, []);

  const applyThreadTarget = useCallback((threadId: string) => {
    setActionThreadId(threadId);
    setActionError(null);
    setActionSuccess(null);
  }, []);

  const runRowAction = useCallback(
    (action: LogsActionType, rowIndex: number) => {
      if (!isRoomTargetReady) {
        setActionError('Target room ID is required for row actions.');
        setActionSuccess(null);
        return;
      }
      if (action === 'thread_note' && !isThreadTargetReady) {
        setActionError('Target thread ID is required for thread note actions.');
        setActionSuccess(null);
        return;
      }

      const entry = entries[rowIndex];
      if (!entry) {
        setActionError('Selected log entry is not available.');
        setActionSuccess(null);
        return;
      }

      setActionError(null);
      setActionSuccess(null);
      setActiveActionKey(`${action}:${rowIndex}`);

      rowActionMutation.mutate(
        {
          action,
          targetRoomId: normalizedActionRoomId,
          targetThreadId: normalizedActionThreadId || undefined,
          entry,
          context: {
            source: prefill.context.source,
            roomId: prefill.context.roomId,
            roomName: prefill.context.roomName,
            threadId: prefill.context.threadId,
            preset: prefill.preset,
            search: logsMutation.data?.meta.search || undefined,
            requestedLevel: logsMutation.data?.meta.requestedLevel || undefined,
          },
        },
        {
          onSuccess: (response) => {
            const threadSuffix = response.target.threadId ? ` (thread ${response.target.threadId})` : '';
            setActionSuccess(`Posted ${response.action} to room ${response.target.roomId}${threadSuffix}. Message ID: ${response.postedMessageId}.`);
            setAuditNonce((value) => value + 1);
          },
          onError: (error) => {
            setActionError(
              isPrivateApiError(error) ? `${error.message} (HTTP ${error.status})` : 'Unexpected error while posting row action.',
            );
          },
          onSettled: () => {
            setActiveActionKey(null);
          },
        },
      );
    },
    [
      entries,
      isRoomTargetReady,
      isThreadTargetReady,
      logsMutation.data?.meta.requestedLevel,
      logsMutation.data?.meta.search,
      normalizedActionRoomId,
      normalizedActionThreadId,
      prefill.context.roomId,
      prefill.context.roomName,
      prefill.context.source,
      prefill.context.threadId,
      prefill.preset,
      rowActionMutation,
    ],
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 md:px-8">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">UI wired</Badge>
            <Badge variant="secondary">React + Vite</Badge>
            <Badge variant="outline">App API: {runtime.appId}</Badge>
            <Badge variant={isPolling ? 'secondary' : 'outline'}>
              {isPolling ? `live: every ${pollIntervalSec}s` : 'live: off'}
            </Badge>
            {prefill.context.source ? <Badge variant="outline">source: {prefill.context.source}</Badge> : null}
            {prefill.preset ? <Badge variant="secondary">preset: {prefill.preset}</Badge> : null}
            {prefill.autorun ? <Badge variant="secondary">autorun</Badge> : null}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">Rocket.Chat Logs Viewer</h1>
          <p className="max-w-4xl text-sm text-muted-foreground">
            This UI queries app API endpoints and never talks to Loki directly. Base path: <code>{runtime.privateApiBase}</code>
          </p>
        </header>

        {prefill.context.roomId || prefill.context.threadId ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Slash context</CardTitle>
              <CardDescription>Context propagated through the generated deep link.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              {prefill.context.roomName ? <Badge variant="outline">room: {prefill.context.roomName}</Badge> : null}
              {prefill.context.roomId ? <Badge variant="outline">roomId: {prefill.context.roomId}</Badge> : null}
              {prefill.context.threadId ? <Badge variant="outline">threadId: {prefill.context.threadId}</Badge> : null}
              {prefill.context.senderId ? <Badge variant="outline">senderId: {prefill.context.senderId}</Badge> : null}
            </CardContent>
          </Card>
        ) : null}

        {configError ? (
          <Card className="border-red-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="h-4 w-4" />
                Config load failed
              </CardTitle>
              <CardDescription>
                {isPrivateApiError(configError)
                  ? `${configError.message} (HTTP ${configError.status})`
                  : 'Unexpected error while loading /config.'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4" />
                Query logs
              </CardTitle>
              <CardDescription>Uses app endpoint <code>/query</code> with server-side guardrails.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="space-y-1">
                  <span className={labelClass}>Time mode</span>
                  <select className={selectBaseClass} value={timeMode} onChange={(event) => setTimeMode(event.target.value as 'relative' | 'absolute')}>
                    <option value="relative">Relative</option>
                    <option value="absolute">Absolute</option>
                  </select>
                </label>

                {timeMode === 'relative' ? (
                  <label className="space-y-1">
                    <span className={labelClass}>Since</span>
                    <input className={inputBaseClass} value={since} onChange={(event) => setSince(event.target.value)} placeholder="15m" />
                  </label>
                ) : (
                  <>
                    <label className="space-y-1">
                      <span className={labelClass}>Start</span>
                      <input
                        className={inputBaseClass}
                        type="datetime-local"
                        value={startAt}
                        onChange={(event) => setStartAt(event.target.value)}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>End</span>
                      <input className={inputBaseClass} type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
                    </label>
                  </>
                )}

                <label className="space-y-1">
                  <span className={labelClass}>Limit</span>
                  <input className={inputBaseClass} type="number" min={1} value={limit} onChange={(event) => setLimit(event.target.value)} />
                </label>

                <label className="space-y-1">
                  <span className={labelClass}>Level</span>
                  <select className={selectBaseClass} value={level} onChange={(event) => setLevel(event.target.value as QueryLevel | '')}>
                    <option value="">Any</option>
                    {levelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 sm:col-span-2 xl:col-span-1">
                  <span className={labelClass}>Search</span>
                  <input
                    className={inputBaseClass}
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Optional text filter"
                  />
                </label>

                <label className="space-y-1">
                  <span className={labelClass}>Polling interval (sec)</span>
                  <input
                    className={inputBaseClass}
                    type="number"
                    min={MIN_POLLING_INTERVAL_SECONDS}
                    max={MAX_POLLING_INTERVAL_SECONDS}
                    value={pollIntervalSec}
                    onChange={(event) => setPollIntervalSec(event.target.value)}
                    placeholder={String(DEFAULT_POLLING_INTERVAL_SECONDS)}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={logsMutation.isPending || !configQuery.isSuccess} onClick={executeQuery}>
                  {logsMutation.isPending ? 'Running query...' : 'Run query'}
                </Button>
                <Button variant="secondary" disabled={isPolling || !configQuery.isSuccess} onClick={startPolling}>
                  Start live polling
                </Button>
                <Button variant="outline" disabled={!isPolling} onClick={stopPolling}>
                  Stop live polling
                </Button>
                <Badge variant="outline">default range: {configQuery.data?.config.defaultTimeRange || 'n/a'}</Badge>
                <Badge variant="outline">max lines: {configQuery.data?.config.maxLinesPerQuery || 'n/a'}</Badge>
                <Badge variant="outline">source mode: {configQuery.data?.config.sourceMode || 'loki'}</Badge>
                <Badge variant={isPolling ? 'secondary' : 'outline'}>poll ticks: {pollingTickCount}</Badge>
              </div>

              {configQuery.data?.config.readiness && !configQuery.data.config.readiness.ready ? (
                <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
                  <p className="font-medium">Source readiness warnings</p>
                  <ul className="list-disc pl-5">
                    {configQuery.data.config.readiness.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
              {pollingError ? <p className="text-sm text-red-600">{pollingError}</p> : null}

              {queryError ? (
                <div className="space-y-1 text-sm text-red-600">
                  <p>
                    {isPrivateApiError(queryError)
                      ? `${queryError.message} (HTTP ${queryError.status})`
                      : 'Unexpected error while querying logs.'}
                  </p>
                  {isPrivateApiError(queryError) && formatErrorDetails(queryError.details) ? (
                    <p className="break-all text-xs text-red-700">details: {formatErrorDetails(queryError.details)}</p>
                  ) : null}
                </div>
              ) : null}

              {logsMutation.data ? (
                <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
                  <p>returned: {logsMutation.data.meta.returned}</p>
                  <p>truncated: {String(logsMutation.data.meta.truncated)}</p>
                  <p>redacted lines: {logsMutation.data.meta.redaction?.redactedLines ?? 0}</p>
                  <p>total redactions: {logsMutation.data.meta.redaction?.totalRedactions ?? 0}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Audit view
              </CardTitle>
              <CardDescription>Reads app endpoint <code>/audit</code>.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="space-y-1">
                <span className={labelClass}>User ID</span>
                <input
                  className={inputBaseClass}
                  value={auditUserId}
                  onChange={(event) => setAuditUserId(event.target.value)}
                  placeholder="Optional"
                />
              </label>

              <label className="space-y-1">
                <span className={labelClass}>Outcome</span>
                <select className={selectBaseClass} value={auditOutcome} onChange={(event) => setAuditOutcome(event.target.value as AuditOutcome | '')}>
                  <option value="">Any</option>
                  {outcomeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className={labelClass}>Limit</span>
                <input className={inputBaseClass} type="number" min={1} value={auditLimit} onChange={(event) => setAuditLimit(event.target.value)} />
              </label>

              <Button variant="outline" onClick={() => setAuditNonce((value) => value + 1)}>
                Refresh audit
              </Button>

              {auditQuery.isPending ? <p className="text-sm text-muted-foreground">Loading audit...</p> : null}

              {auditError ? (
                <p className="text-sm text-red-600">
                  {isPrivateApiError(auditError)
                    ? `${auditError.message} (HTTP ${auditError.status})`
                    : 'Unexpected error while loading audit.'}
                </p>
              ) : null}

              <p className="text-sm text-muted-foreground">total entries: {auditQuery.data?.meta.total ?? 0}</p>

              <div className="max-h-72 overflow-auto rounded-md border">
                {(auditQuery.data?.entries || []).length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No audit entries.</p>
                ) : (
                  <ul className="divide-y">
                    {auditQuery.data?.entries.map((entry, index) => (
                      <li key={`${entry.timestamp}-${entry.userId}-${index}`} className="p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={entry.outcome === 'denied' ? 'secondary' : 'outline'}>{entry.outcome}</Badge>
                          <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>
                        </div>
                        <p className="mt-1 font-medium">{entry.action}</p>
                        <p className="text-muted-foreground">user: {entry.userId}</p>
                        {entry.reason ? <p className="text-muted-foreground">reason: {entry.reason}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Saved views</CardTitle>
            <CardDescription>
              Persist and re-apply common query presets through app endpoint <code>/views</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Saved view name</span>
                <input
                  className={inputBaseClass}
                  value={savedViewName}
                  onChange={(event) => {
                    setSavedViewName(event.target.value);
                    setSavedViewError(null);
                    setSavedViewSuccess(null);
                  }}
                  placeholder="Example: Last 30m errors"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button size="sm" disabled={savedViewMutation.isPending} onClick={createSavedView}>
                  {savedViewMutation.isPending ? 'Saving...' : 'Save current as new'}
                </Button>
                <Button size="sm" variant="secondary" disabled={savedViewMutation.isPending || !selectedSavedViewId} onClick={updateSavedView}>
                  Update selected
                </Button>
                <Button size="sm" variant="outline" disabled={savedViewMutation.isPending || !selectedSavedViewId} onClick={deleteSavedView}>
                  Delete selected
                </Button>
                <Button size="sm" variant="outline" onClick={() => setViewsNonce((value) => value + 1)}>
                  Refresh list
                </Button>
                {selectedSavedView ? <Badge variant="outline">selected: {selectedSavedView.name}</Badge> : null}
              </div>
              {savedViewSuccess ? <p className="text-sm text-emerald-700 sm:col-span-2">{savedViewSuccess}</p> : null}
              {savedViewError ? <p className="text-sm text-red-600 sm:col-span-2">{savedViewError}</p> : null}
              {viewsError ? (
                <p className="text-sm text-red-600 sm:col-span-2">
                  {isPrivateApiError(viewsError)
                    ? `${viewsError.message} (HTTP ${viewsError.status})`
                    : 'Unexpected error while loading saved views.'}
                </p>
              ) : null}
              {viewsQuery.isPending ? <p className="text-sm text-muted-foreground sm:col-span-2">Loading saved views...</p> : null}
              <p className="text-xs text-muted-foreground sm:col-span-2">
                saved views: {viewsQuery.data?.views.meta.returned ?? 0} / {viewsQuery.data?.views.meta.total ?? 0}
              </p>
              <div className="max-h-40 overflow-auto rounded-md border sm:col-span-2">
                {availableSavedViews.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No saved views yet. Configure filters and save one.</p>
                ) : (
                  <ul className="divide-y">
                    {availableSavedViews.map((view) => {
                      const isSelected = view.id === selectedSavedViewId;
                      return (
                        <li key={view.id} className="p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              className={`rounded-md border px-2 py-1 text-xs ${isSelected ? 'bg-muted font-semibold' : 'bg-background'}`}
                              onClick={() => {
                                setSelectedSavedViewId(view.id);
                                setSavedViewName(view.name);
                                setSavedViewError(null);
                                setSavedViewSuccess(null);
                              }}
                            >
                              {view.name}
                            </button>
                            <Button size="sm" variant="outline" onClick={() => applySavedView(view.id)}>
                              Apply
                            </Button>
                            <span className="text-xs text-muted-foreground">updated {formatTime(view.updatedAt)}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{summarizeSavedView(view.query)}</p>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Query results
            </CardTitle>
            <CardDescription>Virtualized rendering for large responses and Rocket.Chat-native row actions.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Room target search</span>
                <div className="flex gap-2">
                  <input
                    className={inputBaseClass}
                    value={roomSearch}
                    onChange={(event) => setRoomSearch(event.target.value)}
                    placeholder="Search by room name, display name, or id"
                  />
                  <Button size="sm" variant="outline" onClick={() => setTargetsNonce((value) => value + 1)}>
                    Refresh
                  </Button>
                </div>
              </label>

              <div className="sm:col-span-2">
                {targetsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading room targets...</p> : null}
                {targetsError ? (
                  <p className="text-sm text-red-600">
                    {isPrivateApiError(targetsError)
                      ? `${targetsError.message} (HTTP ${targetsError.status})`
                      : 'Unexpected error while loading room targets.'}
                  </p>
                ) : null}
                {!targetsQuery.isPending && !targetsError ? (
                  <p className="text-xs text-muted-foreground">
                    targets loaded: {targetsQuery.data?.targets.meta.returned ?? 0} / {targetsQuery.data?.targets.meta.total ?? 0}
                  </p>
                ) : null}
                <div className="mt-2 max-h-28 overflow-auto rounded-md border">
                  {availableRoomTargets.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">No matching room targets. Use manual room ID below if needed.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 p-2">
                      {availableRoomTargets.slice(0, 30).map((target) => {
                        const isSelected = target.id === normalizedActionRoomId;
                        const label = target.displayName || target.name;
                        return (
                          <button
                            key={target.id}
                            type="button"
                            className={`rounded-md border px-2 py-1 text-xs ${isSelected ? 'bg-muted font-semibold' : 'bg-background'}`}
                            onClick={() => applyRoomTarget(target.id)}
                          >
                            {label} ({target.type})
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <label className="space-y-1">
                <span className={labelClass}>Action target room ID</span>
                <input
                  className={inputBaseClass}
                  value={actionRoomId}
                  onChange={(event) => {
                    const nextRoomId = event.target.value;
                    const previousRoomId = normalizedActionRoomId;
                    setActionRoomId(nextRoomId);
                    if (nextRoomId.trim() !== previousRoomId) {
                      setActionThreadId('');
                      setThreadSearch('');
                    }
                    setActionError(null);
                    setActionSuccess(null);
                  }}
                  placeholder="Required (prefilled from /logs context when available)"
                />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Thread target search (selected room)</span>
                <div className="flex gap-2">
                  <input
                    className={inputBaseClass}
                    value={threadSearch}
                    onChange={(event) => setThreadSearch(event.target.value)}
                    placeholder={isRoomTargetReady ? 'Search by thread preview or message id' : 'Select room first'}
                    disabled={!isRoomTargetReady}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!isRoomTargetReady}
                    onClick={() => setThreadsNonce((value) => value + 1)}
                  >
                    Refresh
                  </Button>
                </div>
              </label>
              <div className="sm:col-span-2">
                {!isRoomTargetReady ? <p className="text-sm text-muted-foreground">Select a target room to load thread targets.</p> : null}
                {isRoomTargetReady && threadsQuery.isPending ? (
                  <p className="text-sm text-muted-foreground">Loading thread targets...</p>
                ) : null}
                {isRoomTargetReady && threadsError ? (
                  <p className="text-sm text-red-600">
                    {isPrivateApiError(threadsError)
                      ? `${threadsError.message} (HTTP ${threadsError.status})`
                      : 'Unexpected error while loading thread targets.'}
                  </p>
                ) : null}
                {isRoomTargetReady && !threadsQuery.isPending && !threadsError ? (
                  <p className="text-xs text-muted-foreground">
                    threads loaded: {threadsQuery.data?.threads.meta.returned ?? 0} / {threadsQuery.data?.threads.meta.total ?? 0}
                  </p>
                ) : null}
                <div className="mt-2 max-h-36 overflow-auto rounded-md border">
                  {!isRoomTargetReady ? (
                    <p className="p-2 text-xs text-muted-foreground">Thread target list appears after a room is selected.</p>
                  ) : availableThreadTargets.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">No matching threads. You can still enter thread ID manually below.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 p-2">
                      {availableThreadTargets.slice(0, 40).map((target) => {
                        const isSelected = target.id === normalizedActionThreadId;
                        const preview =
                          target.preview.length > 88 ? `${target.preview.slice(0, 88)}...` : target.preview;
                        return (
                          <button
                            key={target.id}
                            type="button"
                            className={`rounded-md border px-2 py-1 text-left text-xs ${isSelected ? 'bg-muted font-semibold' : 'bg-background'}`}
                            onClick={() => applyThreadTarget(target.id)}
                            title={target.preview}
                          >
                            <span className="block font-medium">{target.id.slice(-8)}</span>
                            <span className="block text-muted-foreground">{preview}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <label className="space-y-1">
                <span className={labelClass}>Action target thread ID</span>
                <input
                  className={inputBaseClass}
                  value={actionThreadId}
                  onChange={(event) => {
                    setActionThreadId(event.target.value);
                    setActionError(null);
                    setActionSuccess(null);
                  }}
                  placeholder="Optional"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button size="sm" variant="outline" disabled={!canUseSlashRoomTarget} onClick={applySlashRoomTarget}>
                  Use slash room target
                </Button>
                <Button size="sm" variant="outline" disabled={!canUseSlashThreadTarget} onClick={applySlashThreadTarget}>
                  Use slash thread target
                </Button>
                <Button size="sm" variant="outline" onClick={clearActionTargets}>
                  Clear targets
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Badge variant={isRoomTargetReady ? 'secondary' : 'outline'}>room target: {isRoomTargetReady ? 'ready' : 'missing'}</Badge>
                <Badge variant={isThreadTargetReady ? 'secondary' : 'outline'}>thread target: {isThreadTargetReady ? 'ready' : 'optional'}</Badge>
                {selectedRoomTarget ? (
                  <Badge variant="outline">selected room: {selectedRoomTarget.displayName || selectedRoomTarget.name}</Badge>
                ) : null}
                {selectedThreadTarget ? <Badge variant="outline">selected thread: {selectedThreadTarget.id.slice(-8)}</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Share/Incident/Thread-note actions post into this room/thread through app endpoint <code>/actions</code>. Access and denials are audit
                logged. <code>thread_note</code> requires a thread target.
              </p>
              {actionSuccess ? <p className="text-sm text-emerald-700 sm:col-span-2">{actionSuccess}</p> : null}
              {actionError ? <p className="text-sm text-red-600 sm:col-span-2">{actionError}</p> : null}
            </div>

            {entries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No results yet. Run a query to load logs.</p>
            ) : (
              <>
                <div className="mb-3 grid gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="space-y-1">
                    <span className={labelClass}>Message view</span>
                    <select
                      className={selectBaseClass}
                      value={messageViewMode}
                      onChange={(event) => setMessageViewMode(event.target.value as 'raw' | 'pretty')}
                    >
                      <option value="pretty">Pretty (JSON-aware)</option>
                      <option value="raw">Raw</option>
                    </select>
                  </label>
                  <div className="flex items-end">
                    <Button size="sm" variant={wrapLogLines ? 'secondary' : 'outline'} onClick={() => setWrapLogLines((value) => !value)}>
                      {wrapLogLines ? 'Wrap: on' : 'Wrap: off'}
                    </Button>
                  </div>
                  <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={expandedRowCount === 0}
                      onClick={() => setExpandedRows({})}
                    >
                      Collapse all
                    </Button>
                    <Badge variant="outline">rows: {entries.length}</Badge>
                    <Badge variant="outline">expanded: {expandedRowCount}</Badge>
                  </div>
                  {copyRowError ? (
                    <p className="text-sm text-red-600 sm:col-span-2 lg:col-span-4">{copyRowError}</p>
                  ) : null}
                </div>

                <div ref={parentRef} className="h-[560px] overflow-auto rounded-md border">
                  <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative', width: '100%' }}>
                    {virtualizer.getVirtualItems().map((item) => {
                      const entry = entries[item.index];
                      const isExpanded = Boolean(expandedRows[item.index]);
                      const formatted = formatMessageForDisplay(entry.message, messageViewMode);
                      const messageSummary = summarizeRenderedMessage(formatted.text, isExpanded);
                      const visibleLabels = Object.entries(entry.labels).slice(
                        0,
                        isExpanded ? ENTRY_LABELS_EXPANDED_COUNT : ENTRY_LABELS_PREVIEW_COUNT,
                      );
                      const hasMoreLabels = Object.keys(entry.labels).length > visibleLabels.length;

                      return (
                        <article
                          key={`${entry.timestamp}-${item.index}`}
                          data-index={item.index}
                          ref={(node) => {
                            if (node) {
                              // Measure each row after render to support mixed row heights.
                              virtualizer.measureElement(node);
                            }
                          }}
                          className="absolute left-0 top-0 w-full border-b bg-background p-3"
                          style={{ transform: `translateY(${item.start}px)` }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={levelVariant(entry.level)}>{entry.level}</Badge>
                            <span className="text-xs text-muted-foreground">{formatTime(entry.timestamp)}</span>
                            <Badge variant="outline">chars: {messageSummary.charCount}</Badge>
                            <Badge variant="outline">lines: {messageSummary.lineCount}</Badge>
                            <Badge variant="outline">format: {formatted.isStructured ? 'json' : 'text'}</Badge>
                            {messageSummary.truncated ? <Badge variant="secondary">preview</Badge> : null}
                          </div>

                          <pre
                            className={`mt-2 rounded-md border bg-muted/20 p-2 text-xs ${
                              wrapLogLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'
                            }`}
                          >
                            {messageSummary.rendered}
                          </pre>

                          <div className="mt-2 flex flex-wrap gap-1">
                            {visibleLabels.map(([key, value]) => (
                              <Badge key={`${key}-${value}`} variant="outline" className="font-normal">
                                {key}={value}
                              </Badge>
                            ))}
                            {hasMoreLabels ? <Badge variant="outline">+{Object.keys(entry.labels).length - visibleLabels.length} labels</Badge> : null}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => toggleRowExpanded(item.index)}>
                              {isExpanded ? 'Collapse details' : 'Expand details'}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => copyRowMessage(item.index)}>
                              {copiedRowIndex === item.index ? 'Copied' : 'Copy line'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={rowActionMutation.isPending || !isRoomTargetReady}
                              onClick={() => runRowAction('share', item.index)}
                            >
                              {activeActionKey === `share:${item.index}` ? 'Posting...' : 'Share to room'}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={rowActionMutation.isPending || !isRoomTargetReady}
                              onClick={() => runRowAction('incident_draft', item.index)}
                            >
                              {activeActionKey === `incident_draft:${item.index}` ? 'Posting...' : 'Create incident draft'}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={rowActionMutation.isPending || !isRoomTargetReady || !isThreadTargetReady}
                              onClick={() => runRowAction('thread_note', item.index)}
                            >
                              {activeActionKey === `thread_note:${item.index}` ? 'Posting...' : 'Add thread note'}
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
