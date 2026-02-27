import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, Copy, Database, FileText, Filter, History, MessageSquarePlus, Search, Share2 } from 'lucide-react';

import { AppShell } from '@/components/layout/AppShell';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { SkeletonRows } from '@/components/SkeletonRows';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select } from '@/components/ui/select';
import {
  DEFAULT_POLLING_INTERVAL_SECONDS,
  MAX_POLLING_INTERVAL_SECONDS,
  MIN_POLLING_INTERVAL_SECONDS,
  parsePollingIntervalSeconds,
} from '@/lib/polling';
import { SIDEBAR_INLINE_BREAKPOINT, useMediaQuery } from '@/lib/useMediaQuery';
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

const ENTRY_PREVIEW_MAX_LINES = 6;
const ENTRY_PREVIEW_MAX_CHARS = 520;
const ENTRY_LABELS_PREVIEW_COUNT = 6;
const ENTRY_LABELS_EXPANDED_COUNT = 18;
const COPY_ROW_FEEDBACK_MS = 2500;

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

const levelRailClass = (level: string): string => {
  if (level === 'error') {
    return 'border-l-4 border-l-red-500';
  }
  if (level === 'warn') {
    return 'border-l-4 border-l-amber-500';
  }
  if (level === 'info') {
    return 'border-l-4 border-l-sky-500';
  }
  if (level === 'debug') {
    return 'border-l-4 border-l-slate-400';
  }
  return 'border-l-4 border-l-violet-400';
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

const truncateMiddle = (value: string, maxLength: number): string => {
  if (value.length <= maxLength || maxLength < 7) {
    return value;
  }

  const edge = Math.floor((maxLength - 3) / 2);
  return `${value.slice(0, edge)}...${value.slice(-edge)}`;
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

  const isDesktop = useMediaQuery(SIDEBAR_INLINE_BREAKPOINT);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarVisible = isDesktop || sidebarOpen;

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
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
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
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => {
        // Only clear the feedback badge for the same row this timer was created for.
        setCopiedRowIndex((current) => (current === rowIndex ? null : current));
        copyResetTimerRef.current = null;
      }, COPY_ROW_FEEDBACK_MS);
    } catch (error) {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = null;
      }
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
  const configErrorMessage = isPrivateApiError(configError)
    ? (
        configError.status === 401 && !runtime.hasRuntimeAuthHeaders
          ? 'Authentication required. Open from an active Rocket.Chat browser session on the same origin, or configure VITE_ROCKETCHAT_USER_ID and VITE_ROCKETCHAT_AUTH_TOKEN.'
          : `${configError.message} (HTTP ${configError.status})`
      )
    : 'Could not load app config.';
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
  const auditEntries = auditQuery.data?.entries || [];
  const isAuditListLoading = auditQuery.isPending && !auditError;
  const isViewsListLoading = viewsQuery.isPending && !viewsError;
  const isTargetsListLoading = targetsQuery.isPending && !targetsError;
  const isThreadsListLoading = isRoomTargetReady && threadsQuery.isPending && !threadsError;
  const expandedRowCount = Object.values(expandedRows).filter(Boolean).length;

  useEffect(() => {
    setExpandedRows({});
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    setCopiedRowIndex(null);
    setCopyRowError(null);
  }, [entries]);

  useEffect(() => () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
  }, []);

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
    <AppShell
      isDrawerMode={!isDesktop}
      sidebarOpen={sidebarVisible}
      onSidebarOpenChange={setSidebarOpen}
      header={
        <div className="grid gap-3 px-4 py-3 md:px-6 md:py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {!isDesktop ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open filters and controls"
                >
                  <Filter className="mr-1.5 h-4 w-4" aria-hidden />
                  Filters
                </Button>
              ) : null}
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Logs Viewer</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Query logs through app APIs with Rocket.Chat-native guardrails.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle />
              <Badge variant={isPolling ? 'secondary' : 'outline'}>
                {isPolling ? `Live ${pollIntervalSec}s` : 'Off'}
              </Badge>
              {prefill.preset ? <Badge variant="secondary">{prefill.preset}</Badge> : null}
              {prefill.autorun ? <Badge variant="outline">Autorun</Badge> : null}
              {prefill.context.source ? <Badge variant="outline">{prefill.context.source}</Badge> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Default range: {configQuery.data?.config.defaultTimeRange ?? '—'}</span>
            <span aria-hidden>|</span>
            <span>Max lines: {configQuery.data?.config.maxLinesPerQuery ?? '—'}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="max-w-full font-mono text-[11px]"
              title={runtime.appId}
            >
              App: {truncateMiddle(runtime.appId, 26)}
            </Badge>
            <Badge
              variant="outline"
              className="max-w-full font-mono text-[11px]"
              title={runtime.privateApiBase}
            >
              API: {truncateMiddle(runtime.privateApiBase, 64)}
            </Badge>
          </div>
        </div>
      }
      sidebar={
        <div className="flex flex-col gap-5 p-6 text-sm leading-[1.45]">
          {prefill.context.roomId || prefill.context.threadId ? (
          <Card className="border-primary/20 shadow-sm">
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-medium">From /logs</CardTitle>
              <CardDescription className="text-xs">Room and thread context for row actions.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 py-0 text-xs text-muted-foreground">
              {prefill.context.roomName ? <Badge variant="outline">{prefill.context.roomName}</Badge> : null}
              {prefill.context.roomId ? <Badge variant="outline">roomId: {prefill.context.roomId}</Badge> : null}
              {prefill.context.threadId ? <Badge variant="outline">threadId: {prefill.context.threadId}</Badge> : null}
              {prefill.context.senderId ? <Badge variant="outline">senderId: {prefill.context.senderId}</Badge> : null}
            </CardContent>
          </Card>
        ) : null}

          <section className="grid gap-3 lg:grid-cols-1">
          <Card className="border-border/80 shadow-sm" role="region" aria-labelledby="query-logs-heading">
            <CardHeader>
              <CardTitle id="query-logs-heading" className="flex items-center gap-2 text-base">
                <Search className="h-4 w-4" aria-hidden />
                Query logs
              </CardTitle>
              <CardDescription>Uses app endpoint <code>/query</code> with server-side guardrails.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Time</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="time-mode">Time mode</Label>
                  <Select id="time-mode" value={timeMode} onChange={(e) => setTimeMode(e.target.value as 'relative' | 'absolute')}>
                    <option value="relative">Relative</option>
                    <option value="absolute">Absolute</option>
                  </Select>
                </div>

                {timeMode === 'relative' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="since">Since</Label>
                    <Input id="since" value={since} onChange={(e) => setSince(e.target.value)} placeholder="15m" />
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="start">Start</Label>
                      <Input id="start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="end">End</Label>
                      <Input id="end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                    </div>
                  </>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="limit">Limit</Label>
                  <Input id="limit" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Filters</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="level">Level</Label>
                  <Select id="level" value={level} onChange={(e) => setLevel(e.target.value as QueryLevel | '')}>
                    <option value="">Any</option>
                    {levelOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="search">Search</Label>
                  <Input
                    id="search"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Optional text filter"
                  />
                </div>
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Options</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="poll-interval">Polling (sec)</Label>
                  <Input
                    id="poll-interval"
                    type="number"
                    min={MIN_POLLING_INTERVAL_SECONDS}
                    max={MAX_POLLING_INTERVAL_SECONDS}
                    value={pollIntervalSec}
                    onChange={(e) => setPollIntervalSec(e.target.value)}
                    placeholder={String(DEFAULT_POLLING_INTERVAL_SECONDS)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={logsMutation.isPending || !configQuery.isSuccess} onClick={executeQuery}>
                  {logsMutation.isPending ? 'Running…' : 'Run query'}
                </Button>
                <Button variant="secondary" disabled={isPolling || !configQuery.isSuccess} onClick={startPolling}>
                  Start live polling
                </Button>
                <Button variant="outline" disabled={!isPolling} onClick={stopPolling}>
                  Stop live polling
                </Button>
                <Badge variant="outline">{configQuery.data?.config.sourceMode ?? 'loki'}</Badge>
                {isPolling ? <Badge variant="secondary">Ticks: {pollingTickCount}</Badge> : null}
              </div>

              {configQuery.data?.config.readiness && !configQuery.data.config.readiness.ready ? (
                <Alert variant="warning">
                  <p className="font-medium">Source readiness</p>
                  <ul className="mt-1 list-disc pl-5 text-sm">
                    {configQuery.data.config.readiness.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}

              {formError ? <Alert variant="destructive">{formError}</Alert> : null}
              {pollingError ? <Alert variant="destructive">{pollingError}</Alert> : null}

              {queryError ? (
                <ErrorState
                  title="Query failed"
                  message={isPrivateApiError(queryError) ? `${queryError.message} (HTTP ${queryError.status})` : 'Query failed.'}
                  details={isPrivateApiError(queryError) ? formatErrorDetails(queryError.details) ?? undefined : undefined}
                />
              ) : null}

              {logsMutation.data ? (
                <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Returned:</span> <span className="font-semibold text-foreground">{logsMutation.data.meta.returned}</span></p>
                  <p><span className="text-muted-foreground">Truncated:</span> <span className="font-semibold text-foreground">{String(logsMutation.data.meta.truncated)}</span></p>
                  <p><span className="text-muted-foreground">Redacted lines:</span> <span className="font-semibold text-foreground">{logsMutation.data.meta.redaction?.redactedLines ?? 0}</span></p>
                  <p><span className="text-muted-foreground">Total redactions:</span> <span className="font-semibold text-foreground">{logsMutation.data.meta.redaction?.totalRedactions ?? 0}</span></p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                Audit view
              </CardTitle>
              <CardDescription>Reads app endpoint <code>/audit</code>.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="audit-user">User ID</Label>
                  <Input id="audit-user" value={auditUserId} onChange={(e) => setAuditUserId(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="audit-outcome">Outcome</Label>
                  <Select id="audit-outcome" value={auditOutcome} onChange={(e) => setAuditOutcome(e.target.value as AuditOutcome | '')}>
                    <option value="">Any</option>
                    {outcomeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="audit-limit">Limit</Label>
                  <Input id="audit-limit" type="number" min={1} value={auditLimit} onChange={(e) => setAuditLimit(e.target.value)} />
                </div>
              </div>

              <Button variant="outline" onClick={() => setAuditNonce((v) => v + 1)}>
                Refresh audit
              </Button>

              {auditQuery.isPending ? <LoadingState message="Loading audit…" /> : null}

              {auditError ? (
                <ErrorState
                  title="Audit load failed"
                  message={isPrivateApiError(auditError) ? `${auditError.message} (HTTP ${auditError.status})` : 'Could not load audit.'}
                />
              ) : null}

              <p className="text-xs text-muted-foreground">Entries: {auditQuery.data?.meta.total ?? 0}</p>

              <div className="max-h-72 overflow-auto rounded-md border">
                {isAuditListLoading ? (
                  <SkeletonRows rows={5} label="Loading audit entries" className="m-2 border-none bg-transparent p-0" />
                ) : auditEntries.length === 0 ? (
                  <EmptyState title="No audit entries" description="Run queries or actions to see audit trail." />
                ) : (
                  <ul className="divide-y">
                    {auditEntries.map((entry, index) => (
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

        <Card className="border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Saved views</CardTitle>
            <CardDescription>
              Persist and re-apply common query presets through app endpoint <code>/views</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="saved-view-name">Saved view name</Label>
                <Input
                  id="saved-view-name"
                  value={savedViewName}
                  onChange={(e) => {
                    setSavedViewName(e.target.value);
                    setSavedViewError(null);
                    setSavedViewSuccess(null);
                  }}
                  placeholder="e.g. Last 30m errors"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                <Button size="sm" disabled={savedViewMutation.isPending} onClick={createSavedView}>
                  {savedViewMutation.isPending ? 'Saving…' : 'Save as new'}
                </Button>
                <Button size="sm" variant="secondary" disabled={savedViewMutation.isPending || !selectedSavedViewId} onClick={updateSavedView}>
                  Update selected
                </Button>
                <Button size="sm" variant="outline" disabled={savedViewMutation.isPending || !selectedSavedViewId} onClick={deleteSavedView}>
                  Delete selected
                </Button>
                <Button size="sm" variant="outline" onClick={() => setViewsNonce((v) => v + 1)}>
                  Refresh
                </Button>
                {selectedSavedView ? <Badge variant="outline">{selectedSavedView.name}</Badge> : null}
              </div>
              {savedViewSuccess ? <Alert variant="success" className="sm:col-span-2">{savedViewSuccess}</Alert> : null}
              {savedViewError ? <Alert variant="destructive" className="sm:col-span-2">{savedViewError}</Alert> : null}
              {viewsError ? (
                <ErrorState
                  className="sm:col-span-2"
                  title="Saved views"
                  message={isPrivateApiError(viewsError) ? `${viewsError.message} (HTTP ${viewsError.status})` : 'Could not load saved views.'}
                />
              ) : null}
              {viewsQuery.isPending ? <LoadingState message="Loading saved views…" className="sm:col-span-2" /> : null}
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {viewsQuery.data?.views.meta.returned ?? 0} / {viewsQuery.data?.views.meta.total ?? 0} views
              </p>
              <div className="max-h-40 overflow-auto rounded-md border sm:col-span-2">
                {isViewsListLoading ? (
                  <SkeletonRows rows={4} label="Loading saved views" className="m-2 border-none bg-transparent p-0" />
                ) : availableSavedViews.length === 0 ? (
                  <EmptyState
                    icon={<FileText className="h-8 w-8" />}
                    title="No saved views"
                    description="Set filters and save current query as a view."
                  />
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

        <Card className="border-border/80 shadow-sm">
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Database className="h-4 w-4" />
              Targets
            </CardTitle>
            <CardDescription className="text-xs">Room and thread for row actions (share, incident, thread note).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-1">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="room-search">Room target</Label>
                <div className="flex gap-2">
                  <Input
                    id="room-search"
                    value={roomSearch}
                    onChange={(e) => setRoomSearch(e.target.value)}
                    placeholder="Search by room name or id"
                  />
                  <Button size="sm" variant="outline" onClick={() => setTargetsNonce((v) => v + 1)}>
                    Refresh
                  </Button>
                </div>
              </div>

              <div className="sm:col-span-2">
                {targetsQuery.isPending ? <LoadingState message="Loading rooms…" /> : null}
                {targetsError ? (
                  <ErrorState
                    message={isPrivateApiError(targetsError) ? `${targetsError.message} (HTTP ${targetsError.status})` : 'Could not load room targets.'}
                  />
                ) : null}
                {!targetsQuery.isPending && !targetsError ? (
                  <p className="text-xs text-muted-foreground">
                    {targetsQuery.data?.targets.meta.returned ?? 0} / {targetsQuery.data?.targets.meta.total ?? 0} rooms
                  </p>
                ) : null}
                <div className="mt-2 max-h-28 overflow-auto rounded-md border">
                  {isTargetsListLoading ? (
                    <SkeletonRows rows={3} label="Loading room targets" className="m-2 border-none bg-transparent p-0" />
                  ) : availableRoomTargets.length === 0 ? (
                    <EmptyState title="No rooms" description="Use manual room ID below or refine search." className="py-4" />
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

              <div className="space-y-1.5">
                <Label htmlFor="action-room-id">Room ID</Label>
                <Input
                  id="action-room-id"
                  value={actionRoomId}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (next.trim() !== normalizedActionRoomId) {
                      setActionThreadId('');
                      setThreadSearch('');
                    }
                    setActionRoomId(next);
                    setActionError(null);
                    setActionSuccess(null);
                  }}
                  placeholder="Required for row actions"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="thread-search">Thread (in selected room)</Label>
                <div className="flex gap-2">
                  <Input
                    id="thread-search"
                    value={threadSearch}
                    onChange={(e) => setThreadSearch(e.target.value)}
                    placeholder={isRoomTargetReady ? 'Search threads' : 'Select room first'}
                    disabled={!isRoomTargetReady}
                  />
                  <Button size="sm" variant="outline" disabled={!isRoomTargetReady} onClick={() => setThreadsNonce((v) => v + 1)}>
                    Refresh
                  </Button>
                </div>
              </div>
              <div className="sm:col-span-2">
                {!isRoomTargetReady ? <p className="text-xs text-muted-foreground">Select a room to load threads.</p> : null}
                {isRoomTargetReady && threadsQuery.isPending ? <LoadingState message="Loading threads…" /> : null}
                {isRoomTargetReady && threadsError ? (
                  <ErrorState
                    message={isPrivateApiError(threadsError) ? `${threadsError.message} (HTTP ${threadsError.status})` : 'Could not load threads.'}
                  />
                ) : null}
                {isRoomTargetReady && !threadsQuery.isPending && !threadsError ? (
                  <p className="text-xs text-muted-foreground">
                    {threadsQuery.data?.threads.meta.returned ?? 0} / {threadsQuery.data?.threads.meta.total ?? 0} threads
                  </p>
                ) : null}
                <div className="mt-2 max-h-36 overflow-auto rounded-md border">
                  {!isRoomTargetReady ? (
                    <EmptyState title="Select room" description="Choose a room to see threads." className="py-4" />
                  ) : isThreadsListLoading ? (
                    <SkeletonRows rows={4} label="Loading thread targets" className="m-2 border-none bg-transparent p-0" />
                  ) : availableThreadTargets.length === 0 ? (
                    <EmptyState title="No threads" description="Enter thread ID below or refine search." className="py-4" />
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
              <div className="space-y-1.5">
                <Label htmlFor="action-thread-id">Thread ID</Label>
                <Input
                  id="action-thread-id"
                  value={actionThreadId}
                  onChange={(e) => {
                    setActionThreadId(e.target.value);
                    setActionError(null);
                    setActionSuccess(null);
                  }}
                  placeholder="Optional"
                />
              </div>
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
              {actionSuccess ? <Alert variant="success" className="sm:col-span-2">{actionSuccess}</Alert> : null}
              {actionError ? <Alert variant="destructive" className="sm:col-span-2">{actionError}</Alert> : null}
            </div>
          </CardContent>
        </Card>
        </div>
      }
    >
      {configError ? (
        <ErrorState
          title="Config unavailable"
          message={configErrorMessage}
          details={isPrivateApiError(configError) ? formatErrorDetails(configError.details) ?? undefined : undefined}
        />
      ) : null}
      <div className="flex flex-col p-4 md:p-6 min-h-0">
        {entries.length === 0 ? (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title="No results"
            description="Set time range, level, and filters in the sidebar, then run a query."
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border/80 bg-muted/20 px-3 py-2">
                  <Label htmlFor="message-view" className="sr-only">Message view</Label>
                  <Select
                    id="message-view"
                    value={messageViewMode}
                    onChange={(e) => setMessageViewMode(e.target.value as 'raw' | 'pretty')}
                    className="w-auto min-w-[8rem]"
                  >
                    <option value="pretty">Pretty (JSON)</option>
                    <option value="raw">Raw</option>
                  </Select>
                  <Button size="sm" variant={wrapLogLines ? 'secondary' : 'outline'} onClick={() => setWrapLogLines((value) => !value)} aria-pressed={wrapLogLines}>
                    {wrapLogLines ? 'Wrap on' : 'Wrap off'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={expandedRowCount === 0}
                    onClick={() => setExpandedRows({})}
                    aria-label="Collapse all expanded rows"
                  >
                    Collapse all
                  </Button>
                  <span className="text-xs text-muted-foreground">rows {entries.length}</span>
                  <span className="text-xs text-muted-foreground">expanded {expandedRowCount}</span>
                  {copyRowError ? (
                    <Alert variant="destructive" className="w-full py-2">{copyRowError}</Alert>
                  ) : null}
                </div>

                <div ref={parentRef} className="log-scrollbar h-[640px] overflow-auto rounded-lg border border-border/80 bg-card/60 shadow-inner">
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

                      // Alternate row tone improves scan speed when operators compare adjacent log lines quickly.
                      const rowToneClass = item.index % 2 === 0 ? 'bg-background/95' : 'bg-muted/15';

                      return (
                        <article
                          key={`${entry.timestamp}-${item.index}`}
                          data-index={item.index}
                          data-level={entry.level}
                          ref={(node) => {
                            if (node) {
                              // Measure each row after render to support mixed row heights.
                              virtualizer.measureElement(node);
                            }
                          }}
                          className={`absolute left-0 top-0 w-full border-b border-border/80 p-4 ${rowToneClass} ${levelRailClass(entry.level)}`}
                          style={{ transform: `translateY(${item.start}px)` }}
                        >
                          <div
                            className="flex flex-wrap items-center gap-2"
                            title={`chars: ${messageSummary.charCount}, lines: ${messageSummary.lineCount}, format: ${formatted.isStructured ? 'json' : 'text'}${messageSummary.truncated ? ', preview' : ''}`}
                          >
                            <Badge variant={levelVariant(entry.level)} aria-label={`Level: ${entry.level}`}>{entry.level}</Badge>
                            <span className="text-xs text-muted-foreground">{formatTime(entry.timestamp)}</span>
                            <Badge variant="outline">chars: {messageSummary.charCount}</Badge>
                            <Badge variant="outline">lines: {messageSummary.lineCount}</Badge>
                            <Badge variant="outline">format: {formatted.isStructured ? 'json' : 'text'}</Badge>
                            {messageSummary.truncated ? <Badge variant="secondary">preview</Badge> : null}
                          </div>

                          {/* Keep message panel high-contrast and monospace for long-line diagnostics readability. */}
                          <pre
                            className={`font-mono-log log-surface mt-3 rounded-lg border border-border p-3 text-[12.5px] leading-5 shadow-inner ${
                              wrapLogLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre overflow-x-auto'
                            }`}
                          >
                            {messageSummary.rendered}
                          </pre>

                          <div className="mt-2 flex flex-wrap gap-1">
                            {visibleLabels.map(([key, value]) => (
                              <Badge
                                key={`${key}-${value}`}
                                variant="outline"
                                className="max-w-[280px] truncate border-border/70 font-normal"
                                title={`${key}=${value}`}
                              >
                                {key}={value}
                              </Badge>
                            ))}
                            {hasMoreLabels ? <Badge variant="outline">+{Object.keys(entry.labels).length - visibleLabels.length} labels</Badge> : null}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => toggleRowExpanded(item.index)}>
                              {isExpanded ? 'Collapse details' : 'Expand details'}
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline" aria-label="Row actions">
                                  Actions
                                  <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuItem
                                  onSelect={() => copyRowMessage(item.index)}
                                >
                                  <Copy className="mr-2 h-4 w-4" aria-hidden />
                                  {copiedRowIndex === item.index ? 'Copied' : 'Copy line'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={rowActionMutation.isPending || !isRoomTargetReady}
                                  onSelect={() => runRowAction('share', item.index)}
                                >
                                  <Share2 className="mr-2 h-4 w-4" aria-hidden />
                                  {activeActionKey === `share:${item.index}` ? 'Posting...' : 'Share to room'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={rowActionMutation.isPending || !isRoomTargetReady}
                                  onSelect={() => runRowAction('incident_draft', item.index)}
                                >
                                  <FileText className="mr-2 h-4 w-4" aria-hidden />
                                  {activeActionKey === `incident_draft:${item.index}` ? 'Posting...' : 'Create incident draft'}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={rowActionMutation.isPending || !isRoomTargetReady || !isThreadTargetReady}
                                  onSelect={() => runRowAction('thread_note', item.index)}
                                >
                                  <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
                                  {activeActionKey === `thread_note:${item.index}` ? 'Posting...' : 'Add thread note'}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
      </div>
    </AppShell>
  );
}
