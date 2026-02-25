import { IHttp, IModify, IPersistence, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { ISlashCommand, SlashCommandContext } from '@rocket.chat/apps-engine/definition/slashcommands';
import { UIKitSurfaceType } from '@rocket.chat/apps-engine/definition/uikit';
import { IUser } from '@rocket.chat/apps-engine/definition/users';

import { COMMANDS, SETTINGS } from '../constants';
import { hasAnyAllowedRole, parseAllowedRoles } from '../security/querySecurity';
import {
    encodeSlashCardActionPayload,
    QueryLevel,
    SLASH_CARD_ACTION,
    SlashCardActionPayload,
} from './slashCardActions';

type PresetName = 'incident' | 'webhook-errors' | 'auth-failures';

type PresetDefinition = {
    since: string;
    level: QueryLevel;
    limit: number;
    search?: string;
};

type SummaryEntry = {
    level: QueryLevel | 'unknown';
    signal: string;
    preview: string;
    timestamp?: string;
};

type QuickTriageSummary = {
    sourceMode: 'loki' | 'app_logs';
    windowLabel: string;
    sampleLimit: number;
    sampleLineCount?: number;
    sampleOutput: Array<{ level: QueryLevel | 'unknown'; text: string }>;
    topLevels: Array<{ level: QueryLevel | 'unknown'; count: number }>;
    topSignals: Array<{ text: string; count: number }>;
    note?: string;
};

type ParsedCommandArgs = {
    preset?: PresetName;
    since?: string;
    start?: string;
    end?: string;
    level?: QueryLevel;
    limit?: number;
    search?: string;
    autorun: boolean;
    hasExplicitFilters: boolean;
    warnings: Array<string>;
};

const ALLOWED_LEVELS = new Set<QueryLevel>(['error', 'warn', 'info', 'debug']);
const QUICK_SAMPLE_OUTPUT_MAX_LINES = 50;
const QUICK_SAMPLE_OUTPUT_PREVIEW_LINES = 20;
const DURATION_PATTERN = /^\d+\s*[smhdw]$/i;
const PRESETS: Record<PresetName, PresetDefinition> = {
    incident: {
        since: '30m',
        level: 'error',
        limit: 300,
    },
    'webhook-errors': {
        since: '2h',
        level: 'error',
        limit: 400,
        search: 'webhook',
    },
    'auth-failures': {
        since: '1h',
        level: 'warn',
        limit: 300,
        search: 'auth failed',
    },
};

export class LogsSlashCommand implements ISlashCommand {
    public command = COMMANDS.LOGS;
    public i18nDescription = 'Open the logs viewer workflow and diagnostics entry point.';
    public i18nParamsExample = 'preset=incident since=30m level=error search=timeout limit=200';
    // Workspace-level RBAC permission checked by Rocket.Chat before command execution.
    public permission = 'view-logs';
    public providesPreview = false;

    constructor(private readonly appId: string) {}

    public async executor(context: SlashCommandContext, read: IRead, modify: IModify, _http: IHttp, _persis: IPersistence): Promise<void> {
        // Slash commands post through the app bot user; bail out if the app user cannot be resolved.
        const appUser = await read.getUserReader().getAppUser(this.appId);
        if (!appUser) {
            return;
        }

        const settingsReader = read.getEnvironmentReader().getSettings();
        const [
            allowedRolesRaw,
            externalComponentUrlRaw,
            defaultTimeRangeRaw,
            maxLinesPerQueryRaw,
            logsSourceModeRaw,
            lokiBaseUrlRaw,
            lokiUsernameRaw,
            lokiTokenRaw,
            requiredLabelSelectorRaw,
        ] = await Promise.all([
            settingsReader.getValueById(SETTINGS.ALLOWED_ROLES),
            settingsReader.getValueById(SETTINGS.EXTERNAL_COMPONENT_URL),
            settingsReader.getValueById(SETTINGS.DEFAULT_TIME_RANGE),
            settingsReader.getValueById(SETTINGS.MAX_LINES_PER_QUERY),
            settingsReader.getValueById(SETTINGS.LOGS_SOURCE_MODE),
            settingsReader.getValueById(SETTINGS.LOKI_BASE_URL),
            settingsReader.getValueById(SETTINGS.LOKI_USERNAME),
            settingsReader.getValueById(SETTINGS.LOKI_TOKEN),
            settingsReader.getValueById(SETTINGS.REQUIRED_LABEL_SELECTOR),
        ]);

        const allowedRoles = parseAllowedRoles(allowedRolesRaw);
        if (!hasAnyAllowedRole(context.getSender().roles, allowedRoles)) {
            await this.notifyPrivateOnly(context, modify, appUser, ['You do not have permission to use `/logs`.']);
            return;
        }

        const externalComponentUrl = typeof externalComponentUrlRaw === 'string' ? externalComponentUrlRaw.trim() : '';
        if (!this.isHttpUrl(externalComponentUrl)) {
            await this.notifyPrivateOnly(context, modify, appUser, ['`/logs` is configured, but External component URL is missing or invalid.']);
            return;
        }

        const parsed = this.parseArguments(context.getArguments());
        const defaultTimeRange = typeof defaultTimeRangeRaw === 'string' && defaultTimeRangeRaw.trim() ? defaultTimeRangeRaw.trim() : '15m';
        const maxLinesPerQuery = this.readNumber(maxLinesPerQueryRaw, 2000, 100, 5000);

        if (parsed.limit && parsed.limit > maxLinesPerQuery) {
            parsed.warnings.push(`Limit ${parsed.limit} exceeds max ${maxLinesPerQuery}; clamped to max.`);
            parsed.limit = maxLinesPerQuery;
        }

        const deepLink = this.buildViewerUrl(externalComponentUrl, context, parsed, {
            defaultTimeRange,
            defaultLimit: Math.min(500, maxLinesPerQuery),
        });
        const triageSummary = await this.buildQuickTriageSummary({
            http: _http,
            logsSourceModeRaw,
            lokiBaseUrlRaw,
            lokiUsernameRaw,
            lokiTokenRaw,
            requiredLabelSelectorRaw,
            parsed,
            defaultTimeRange,
            maxLinesPerQuery,
        });

        const roomName = context.getRoom().displayName || context.getRoom().slugifiedName;
        const filterSummary = this.formatFilterSummary(parsed, defaultTimeRange, maxLinesPerQuery);

        const warningText = parsed.warnings.length > 0 ? `\nWarnings: ${parsed.warnings.join(' | ')}` : '';
        const triggerId = context.getTriggerId();
        if (triggerId) {
            try {
                await this.openPrivateContextualBar(context, modify, deepLink, roomName, filterSummary, parsed.preset || 'none', triageSummary, parsed.warnings);
                return;
            } catch {
                // Trigger IDs can expire; fall back to user-only notification so the command still succeeds privately.
                parsed.warnings.push('Could not open in-app panel from this client context; sent a private notification fallback.');
            }
        }

        await this.notifyPrivateOnly(context, modify, appUser, [
            'Logs Viewer link is ready.',
            `Open: ${deepLink}`,
            `Room: ${roomName}`,
            `Filters: ${filterSummary}`,
            `Preset: ${parsed.preset || 'none'}`,
            ...this.formatSummaryForPrivateText(triageSummary),
            warningText,
        ]);
    }

    private async openPrivateContextualBar(
        context: SlashCommandContext,
        modify: IModify,
        deepLink: string,
        roomName: string,
        filterSummary: string,
        preset: string,
        triageSummary: QuickTriageSummary,
        warnings: Array<string>,
    ): Promise<void> {
        const triggerId = context.getTriggerId();
        if (!triggerId) {
            throw new Error('Missing trigger id for contextual bar open.');
        }

        const blocks = modify.getCreator().getBlockBuilder();
        const actionPayload = this.buildSlashCardActionPayload(context, roomName, filterSummary, preset, triageSummary);
        const encodedActionPayload = encodeSlashCardActionPayload(actionPayload);

        blocks.addSectionBlock({
            text: blocks.newMarkdownTextObject('*Logs Viewer (Private)*\nOnly you can see this `/logs` response.'),
        });
        blocks.addActionsBlock({
            elements: [
                blocks.newButtonElement({
                    text: blocks.newPlainTextObject('Open Logs Viewer'),
                    url: deepLink,
                }),
            ],
        });
        blocks.addActionsBlock({
            elements: [
                blocks.newButtonElement({
                    actionId: SLASH_CARD_ACTION.COPY_SAMPLE,
                    text: blocks.newPlainTextObject('Copy sample'),
                    value: encodedActionPayload,
                }),
                blocks.newButtonElement({
                    actionId: SLASH_CARD_ACTION.SHARE_SAMPLE,
                    text: blocks.newPlainTextObject('Share sample'),
                    value: encodedActionPayload,
                }),
            ],
        });
        // Keep high-frequency triage operations in-chat before forcing full web viewer navigation.
        blocks.addContextBlock({
            elements: [
                blocks.newMarkdownTextObject(`Room: \`${roomName}\``),
                blocks.newMarkdownTextObject(`Filters: ${filterSummary}`),
                blocks.newMarkdownTextObject(`Preset: ${preset}`),
            ],
        });
        blocks.addSectionBlock({
            text: blocks.newMarkdownTextObject(this.formatSummaryForMarkdown(triageSummary)),
        });

        if (warnings.length > 0) {
            blocks.addSectionBlock({
                text: blocks.newMarkdownTextObject(`*Warnings*\n${warnings.join('\n')}`),
            });
        }

        await modify.getUiController().openSurfaceView(
            {
                type: UIKitSurfaceType.CONTEXTUAL_BAR,
                title: blocks.newPlainTextObject('Logs Viewer'),
                blocks: blocks.getBlocks(),
            },
            { triggerId },
            context.getSender(),
        );
    }

    private buildSlashCardActionPayload(
        context: SlashCommandContext,
        roomName: string,
        filterSummary: string,
        preset: string,
        triageSummary: QuickTriageSummary,
    ): SlashCardActionPayload {
        return {
            version: 1,
            roomId: context.getRoom().id,
            roomName,
            threadId: context.getThreadId() || undefined,
            sourceMode: triageSummary.sourceMode,
            windowLabel: triageSummary.windowLabel,
            filterSummary,
            preset,
            sampleOutput: triageSummary.sampleOutput.slice(0, QUICK_SAMPLE_OUTPUT_MAX_LINES),
        };
    }

    private async notifyPrivateOnly(
        context: SlashCommandContext,
        modify: IModify,
        appUser: IUser,
        lines: Array<string>,
    ): Promise<void> {
        const notification = modify.getCreator().startMessage();
        notification.setSender(appUser);
        notification.setRoom(context.getRoom());
        notification.setGroupable(false);
        notification.setParseUrls(true);
        notification.setText(
            [
                'Only you can see this `/logs` response.',
                '',
                ...lines.filter(Boolean),
            ].join('\n'),
        );

        await modify.getNotifier().notifyUser(context.getSender(), notification.getMessage());
    }

    private formatSummaryForMarkdown(summary: QuickTriageSummary): string {
        const levelLine = summary.topLevels.length > 0
            ? summary.topLevels.map((item) => `${item.level}:${item.count}`).join(', ')
            : 'n/a';
        const signalLine = summary.topSignals.length > 0
            ? summary.topSignals.map((item) => `\`${item.text}\` (${item.count})`).join(', ')
            : 'n/a';
        const samplePreview = summary.sampleOutput.slice(0, QUICK_SAMPLE_OUTPUT_PREVIEW_LINES);
        const sampleOutputLines = samplePreview.length > 0
            ? ['- Sample output preview:', ...samplePreview.map((item) => `  - [${item.level}] ${item.text}`)]
            : ['- Sample output: n/a'];
        const previewNote = summary.sampleOutput.length > QUICK_SAMPLE_OUTPUT_PREVIEW_LINES
            ? `- Preview lines: showing ${samplePreview.length} of ${summary.sampleOutput.length} sampled lines`
            : '';

        return [
            '*Quick triage summary*',
            `- Source: \`${summary.sourceMode}\``,
            `- Window: ${summary.windowLabel}`,
            `- Sample lines: ${summary.sampleLineCount ?? 0} (cap ${summary.sampleLimit})`,
            `- Top levels: ${levelLine}`,
            `- Top signals: ${signalLine}`,
            previewNote,
            ...sampleOutputLines,
            summary.note ? `- Note: ${summary.note}` : '',
        ]
            .filter(Boolean)
            .join('\n');
    }

    private formatSummaryForPrivateText(summary: QuickTriageSummary): Array<string> {
        const levels = summary.topLevels.length > 0
            ? summary.topLevels.map((item) => `${item.level}:${item.count}`).join(', ')
            : 'n/a';
        const signals = summary.topSignals.length > 0
            ? summary.topSignals.map((item) => `"${item.text}"(${item.count})`).join(', ')
            : 'n/a';
        const sampleOutputPreview = summary.sampleOutput.slice(0, QUICK_SAMPLE_OUTPUT_PREVIEW_LINES);
        const sampleOutput = sampleOutputPreview.length > 0
            ? sampleOutputPreview.map((item, index) => `Quick summary output_${index + 1}=[${item.level}] ${item.text}`)
            : ['Quick summary output=n/a'];
        const previewNote = summary.sampleOutput.length > QUICK_SAMPLE_OUTPUT_PREVIEW_LINES
            ? `Quick summary preview_lines=${sampleOutputPreview.length}/${summary.sampleOutput.length}`
            : '';

        return [
            `Quick summary source=${summary.sourceMode}`,
            `Quick summary window=${summary.windowLabel}`,
            `Quick summary sample_lines=${summary.sampleLineCount ?? 0} (cap ${summary.sampleLimit})`,
            `Quick summary top_levels=${levels}`,
            `Quick summary top_signals=${signals}`,
            previewNote,
            ...sampleOutput,
            summary.note ? `Quick summary note=${summary.note}` : '',
        ].filter(Boolean);
    }

    private parseLogsSourceMode(rawValue: unknown): 'loki' | 'app_logs' {
        if (typeof rawValue !== 'string') {
            return 'loki';
        }

        const normalized = rawValue.trim().toLowerCase();
        if (normalized === 'app_logs') {
            return 'app_logs';
        }

        return 'loki';
    }

    private async buildQuickTriageSummary(args: {
        http: IHttp;
        logsSourceModeRaw: unknown;
        lokiBaseUrlRaw: unknown;
        lokiUsernameRaw: unknown;
        lokiTokenRaw: unknown;
        requiredLabelSelectorRaw: unknown;
        parsed: ParsedCommandArgs;
        defaultTimeRange: string;
        maxLinesPerQuery: number;
    }): Promise<QuickTriageSummary> {
        const sourceMode = this.parseLogsSourceMode(args.logsSourceModeRaw);
        // Keep slash-card sampling small and predictable; full retrieval lives in the web viewer.
        const summaryLimit = Math.min(args.maxLinesPerQuery, Math.max(20, Math.min(args.parsed.limit || 200, 200)));
        const range = this.resolveSummaryTimeRange(args.parsed, args.defaultTimeRange);

        if (sourceMode === 'app_logs') {
            // app_logs mode currently supports backend query flow, but not slash-card pre-sampling.
            return {
                sourceMode,
                windowLabel: range.label,
                sampleLimit: summaryLimit,
                sampleLineCount: undefined,
                sampleOutput: [],
                topLevels: [],
                topSignals: [],
                note: 'Quick sample is unavailable in app_logs mode. Use Open Logs Viewer for full query.',
            };
        }

        const baseUrl = typeof args.lokiBaseUrlRaw === 'string' ? args.lokiBaseUrlRaw.trim() : '';
        const selector = typeof args.requiredLabelSelectorRaw === 'string' ? args.requiredLabelSelectorRaw.trim() : '';
        if (!baseUrl || !this.isValidSelector(selector)) {
            return {
                sourceMode,
                windowLabel: range.label,
                sampleLimit: summaryLimit,
                sampleOutput: [],
                topLevels: [],
                topSignals: [],
                note: 'Quick sample skipped due to Loki base URL or selector configuration.',
            };
        }

        try {
            const query = this.buildSummaryQuery(selector, args.parsed.search);
            // Short timeout keeps slash command responsive and avoids blocking chat workflows.
            const response = await args.http.get(`${baseUrl}/loki/api/v1/query_range`, {
                headers: {
                    Accept: 'application/json',
                    ...(this.buildLokiAuthHeader(args.lokiUsernameRaw, args.lokiTokenRaw) || {}),
                },
                params: {
                    query,
                    start: range.start.toISOString(),
                    end: range.end.toISOString(),
                    limit: String(summaryLimit),
                },
                timeout: 5000,
            });

            const payload = response.data as any;
            if (response.statusCode >= 400 || !payload || payload.status !== 'success') {
                return {
                    sourceMode,
                    windowLabel: range.label,
                    sampleLimit: summaryLimit,
                    sampleOutput: [],
                    topLevels: [],
                    topSignals: [],
                    note: `Quick sample failed (HTTP ${response.statusCode}).`,
                };
            }

            const entries = this.extractSummaryEntries(payload?.data?.result, args.parsed.level);
            const topLevels = this.computeTopLevels(entries);
            const topSignals = this.computeTopSignals(entries);
            // Expose only a small evidence window in chat; deeper inspection stays in full UI.
            const sampleOutput = entries.slice(0, QUICK_SAMPLE_OUTPUT_MAX_LINES).map((entry) => ({
                level: entry.level,
                text: `${entry.timestamp ? `${entry.timestamp} ` : ''}${entry.preview}`,
            }));

            return {
                sourceMode,
                windowLabel: range.label,
                sampleLimit: summaryLimit,
                sampleLineCount: entries.length,
                sampleOutput,
                topLevels,
                topSignals,
                note: entries.length === 0 ? 'No matching lines in sampled window.' : undefined,
            };
        } catch {
            return {
                sourceMode,
                windowLabel: range.label,
                sampleLimit: summaryLimit,
                sampleOutput: [],
                topLevels: [],
                topSignals: [],
                note: 'Quick sample unavailable (timeout or upstream connectivity issue).',
            };
        }
    }

    private resolveSummaryTimeRange(parsed: ParsedCommandArgs, defaultTimeRange: string): { start: Date; end: Date; label: string } {
        if (parsed.start && parsed.end) {
            const start = new Date(parsed.start);
            const end = new Date(parsed.end);
            if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && start < end) {
                return {
                    start,
                    end,
                    label: `${start.toISOString()} -> ${end.toISOString()}`,
                };
            }
        }

        const relative = this.parseRelativeDurationMs(parsed.since || defaultTimeRange) || this.parseRelativeDurationMs('15m')!;
        const end = new Date();
        const start = new Date(end.getTime() - relative);
        return {
            start,
            end,
            label: `last ${parsed.since || defaultTimeRange}`,
        };
    }

    private parseRelativeDurationMs(value: string): number | undefined {
        const match = value.trim().match(/^(\d+)\s*([smhdw])$/i);
        if (!match) {
            return undefined;
        }

        const amount = Number(match[1]);
        const unit = match[2].toLowerCase();
        if (!Number.isFinite(amount) || amount <= 0) {
            return undefined;
        }

        const unitMs: Record<string, number> = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000,
        };

        return amount * unitMs[unit];
    }

    private buildLokiAuthHeader(usernameRaw: unknown, tokenRaw: unknown): { Authorization: string } | undefined {
        const username = typeof usernameRaw === 'string' ? usernameRaw.trim() : '';
        const token = typeof tokenRaw === 'string' ? tokenRaw.trim() : '';
        if (!username && !token) {
            return undefined;
        }

        const credentials = `${username}:${token}`;
        return {
            Authorization: `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`,
        };
    }

    private isValidSelector(selector: string): boolean {
        if (!selector) {
            return false;
        }
        if (!selector.startsWith('{') || !selector.endsWith('}')) {
            return false;
        }

        const inner = selector.slice(1, -1);
        return !inner.includes('|') && !inner.includes('\n') && !inner.includes('\r');
    }

    private buildSummaryQuery(selector: string, search?: string): string {
        if (!search || !search.trim()) {
            return selector;
        }

        return `${selector} |= "${this.escapeLogQlString(search.trim())}"`;
    }

    private escapeLogQlString(value: string): string {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    private extractSummaryEntries(result: unknown, requestedLevel?: QueryLevel): Array<SummaryEntry> {
        if (!Array.isArray(result)) {
            return [];
        }

        const entries: Array<SummaryEntry> = [];
        for (const stream of result) {
            const labels = stream?.stream && typeof stream.stream === 'object' ? stream.stream : {};
            const values = Array.isArray(stream?.values) ? stream.values : [];
            for (const tuple of values) {
                if (!Array.isArray(tuple) || tuple.length < 2 || typeof tuple[1] !== 'string') {
                    continue;
                }

                const message = tuple[1] as string;
                const timestamp = this.parseLokiTimestamp(tuple[0]);
                const level = this.detectLevel(message, labels);
                if (requestedLevel && level !== requestedLevel) {
                    continue;
                }

                entries.push({
                    level,
                    signal: this.extractSignalText(message),
                    preview: this.extractPreviewText(message),
                    timestamp,
                });
            }
        }

        return entries;
    }

    private parseLokiTimestamp(value: unknown): string | undefined {
        if (typeof value !== 'string' && typeof value !== 'number') {
            return undefined;
        }

        const raw = String(value).trim();
        if (!/^\d+$/.test(raw)) {
            return undefined;
        }

        // Loki commonly returns nanoseconds; normalize to milliseconds for ISO rendering.
        let millis: number;
        if (raw.length > 13) {
            millis = Number(raw.slice(0, 13));
        } else if (raw.length <= 10) {
            millis = Number(raw) * 1000;
        } else {
            millis = Number(raw);
        }

        if (!Number.isFinite(millis)) {
            return undefined;
        }

        const date = new Date(millis);
        if (Number.isNaN(date.getTime())) {
            return undefined;
        }

        return date.toISOString();
    }

    private detectLevel(message: string, labels: Record<string, unknown>): QueryLevel | 'unknown' {
        const labelCandidates = ['detected_level', 'level', 'severity'];
        for (const key of labelCandidates) {
            const value = labels[key];
            if (typeof value === 'string') {
                const normalized = value.toLowerCase();
                if (normalized === 'error' || normalized === 'warn' || normalized === 'info' || normalized === 'debug') {
                    return normalized;
                }

                const numericValue = Number(normalized);
                const mappedFromNumeric = this.mapNumericLevel(numericValue);
                if (mappedFromNumeric) {
                    return mappedFromNumeric;
                }
            }

            if (typeof value === 'number') {
                const mappedFromNumeric = this.mapNumericLevel(value);
                if (mappedFromNumeric) {
                    return mappedFromNumeric;
                }
            }
        }

        const levelFromMessage = this.extractNumericLevelFromMessage(message);
        if (levelFromMessage) {
            return levelFromMessage;
        }

        // Fallback when labels are missing: infer severity from message text heuristics.
        const normalizedMessage = message.toLowerCase();
        if (/\berror\b/.test(normalizedMessage)) {
            return 'error';
        }
        if (/\bwarn(?:ing)?\b/.test(normalizedMessage)) {
            return 'warn';
        }
        if (/\binfo\b/.test(normalizedMessage)) {
            return 'info';
        }
        if (/\bdebug\b/.test(normalizedMessage)) {
            return 'debug';
        }

        return 'unknown';
    }

    private extractNumericLevelFromMessage(message: string): QueryLevel | undefined {
        const compact = message.replace(/\s+/g, ' ').trim();
        if (!compact || compact[0] !== '{') {
            return undefined;
        }

        try {
            const parsed = JSON.parse(compact) as Record<string, unknown>;
            const rawLevel = parsed.level;
            const numeric = typeof rawLevel === 'number' ? rawLevel : Number(rawLevel);
            return this.mapNumericLevel(numeric);
        } catch {
            return undefined;
        }
    }

    private mapNumericLevel(value: number): QueryLevel | undefined {
        if (!Number.isFinite(value)) {
            return undefined;
        }

        if (value >= 50) {
            return 'error';
        }
        if (value >= 40) {
            return 'warn';
        }
        if (value >= 30) {
            return 'info';
        }
        if (value >= 20) {
            return 'debug';
        }

        return undefined;
    }

    private extractSignalText(message: string): string {
        const compact = message.replace(/\s+/g, ' ').trim();
        if (!compact) {
            return '[empty]';
        }

        try {
            const parsed = JSON.parse(compact) as Record<string, unknown>;
            const msg = parsed.msg;
            if (typeof msg === 'string' && msg.trim()) {
                return this.compactSignal(msg);
            }
        } catch {
            // Not JSON content; use compacted raw line.
        }

        return this.compactSignal(compact);
    }

    private extractPreviewText(message: string): string {
        const compact = message.replace(/\s+/g, ' ').trim();
        if (!compact) {
            return '[empty]';
        }

        try {
            const parsed = JSON.parse(compact) as Record<string, unknown>;
            const msg = parsed.msg;
            if (typeof msg === 'string' && msg.trim()) {
                return this.compactText(msg, 160);
            }
        } catch {
            // Not JSON content; use compacted raw line.
        }

        return this.compactText(compact, 160);
    }

    private compactSignal(value: string): string {
        return this.compactText(value, 96);
    }

    private compactText(value: string, maxLength: number): string {
        const normalized = value.replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return '[empty]';
        }

        return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
    }

    private computeTopLevels(entries: Array<SummaryEntry>): Array<{ level: QueryLevel | 'unknown'; count: number }> {
        const counters = new Map<QueryLevel | 'unknown', number>();
        for (const entry of entries) {
            counters.set(entry.level, (counters.get(entry.level) || 0) + 1);
        }

        return Array.from(counters.entries())
            .map(([level, count]) => ({ level, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 4);
    }

    private computeTopSignals(entries: Array<SummaryEntry>): Array<{ text: string; count: number }> {
        const counters = new Map<string, number>();
        for (const entry of entries) {
            if (!entry.signal) {
                continue;
            }
            counters.set(entry.signal, (counters.get(entry.signal) || 0) + 1);
        }

        return Array.from(counters.entries())
            .map(([text, count]) => ({ text, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
    }

    private parseArguments(args: Array<string>): ParsedCommandArgs {
        const parsed: ParsedCommandArgs = {
            autorun: false,
            hasExplicitFilters: false,
            warnings: [],
        };
        const overrides: Partial<Pick<ParsedCommandArgs, 'since' | 'start' | 'end' | 'level' | 'limit' | 'search'>> = {};
        const fallbackSearchTokens: Array<string> = [];

        for (const rawArg of args) {
            const token = rawArg.trim();
            if (!token) {
                continue;
            }

            const normalized = token.startsWith('--') ? token.slice(2) : token;
            if (normalized === 'run' || normalized === 'autorun') {
                parsed.autorun = true;
                continue;
            }

            const eqIndex = normalized.indexOf('=');
            if (eqIndex === -1) {
                // Treat loose tokens as search text so `/logs timeout gateway` still works.
                fallbackSearchTokens.push(this.unquote(normalized));
                continue;
            }

            const key = normalized.slice(0, eqIndex).trim().toLowerCase();
            const value = this.unquote(normalized.slice(eqIndex + 1).trim());
            if (!value) {
                continue;
            }

            switch (key) {
                case 'since': {
                    if (DURATION_PATTERN.test(value)) {
                        overrides.since = value;
                        parsed.hasExplicitFilters = true;
                    } else {
                        parsed.warnings.push(`Invalid since value \`${value}\`; expected number+unit (example: 15m).`);
                    }
                    break;
                }
                case 'start': {
                    const normalizedStart = this.normalizeDateTime(value);
                    if (normalizedStart) {
                        overrides.start = normalizedStart;
                        parsed.hasExplicitFilters = true;
                    } else {
                        parsed.warnings.push(`Invalid start value \`${value}\`.`);
                    }
                    break;
                }
                case 'end': {
                    const normalizedEnd = this.normalizeDateTime(value);
                    if (normalizedEnd) {
                        overrides.end = normalizedEnd;
                        parsed.hasExplicitFilters = true;
                    } else {
                        parsed.warnings.push(`Invalid end value \`${value}\`.`);
                    }
                    break;
                }
                case 'level': {
                    const level = value.toLowerCase() as QueryLevel;
                    if (ALLOWED_LEVELS.has(level)) {
                        overrides.level = level;
                        parsed.hasExplicitFilters = true;
                    } else {
                        parsed.warnings.push(`Invalid level \`${value}\`; expected error|warn|info|debug.`);
                    }
                    break;
                }
                case 'limit': {
                    const parsedLimit = Number(value);
                    if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
                        overrides.limit = Math.floor(parsedLimit);
                        parsed.hasExplicitFilters = true;
                    } else {
                        parsed.warnings.push(`Invalid limit \`${value}\`; expected positive integer.`);
                    }
                    break;
                }
                case 'search': {
                    overrides.search = value;
                    parsed.hasExplicitFilters = true;
                    break;
                }
                case 'preset': {
                    const presetName = value.toLowerCase() as PresetName;
                    if (presetName in PRESETS) {
                        parsed.preset = presetName;
                        parsed.hasExplicitFilters = true;
                    } else {
                        parsed.warnings.push(`Unknown preset \`${value}\`; supported: ${Object.keys(PRESETS).join(', ')}.`);
                    }
                    break;
                }
                default: {
                    fallbackSearchTokens.push(this.unquote(token));
                    break;
                }
            }
        }

        if (parsed.preset) {
            const preset = PRESETS[parsed.preset];
            parsed.since = preset.since;
            parsed.level = preset.level;
            parsed.limit = preset.limit;
            parsed.search = preset.search;
            parsed.autorun = true;
        }

        if (overrides.since !== undefined) {
            parsed.since = overrides.since;
        }
        if (overrides.start !== undefined) {
            parsed.start = overrides.start;
        }
        if (overrides.end !== undefined) {
            parsed.end = overrides.end;
        }
        if (overrides.level !== undefined) {
            parsed.level = overrides.level;
        }
        if (overrides.limit !== undefined) {
            parsed.limit = overrides.limit;
        }
        if (overrides.search !== undefined) {
            parsed.search = overrides.search;
        }

        if (!parsed.search && fallbackSearchTokens.length > 0) {
            parsed.search = fallbackSearchTokens.join(' ');
            parsed.hasExplicitFilters = true;
        }

        if ((parsed.start && !parsed.end) || (!parsed.start && parsed.end)) {
            // Absolute ranges are enforced as pairs to avoid ambiguous or partial queries.
            parsed.warnings.push('Both start and end are required for absolute time mode; falling back to relative mode.');
            delete parsed.start;
            delete parsed.end;
        }

        if (parsed.start && parsed.end && parsed.since) {
            parsed.warnings.push('Both absolute and relative time were provided; using start/end and ignoring since.');
            delete parsed.since;
        }

        if (parsed.search || parsed.preset) {
            parsed.autorun = true;
        }

        return parsed;
    }

    private buildViewerUrl(
        baseUrl: string,
        context: SlashCommandContext,
        parsed: ParsedCommandArgs,
        defaults: { defaultTimeRange: string; defaultLimit: number },
    ): string {
        const url = new URL(baseUrl);

        url.searchParams.set('source', 'slash');
        url.searchParams.set('roomId', context.getRoom().id);
        url.searchParams.set('roomName', context.getRoom().displayName || context.getRoom().slugifiedName);
        url.searchParams.set('senderId', context.getSender().id);

        const threadId = context.getThreadId();
        if (threadId) {
            url.searchParams.set('threadId', threadId);
        }

        if (parsed.start && parsed.end) {
            url.searchParams.set('start', parsed.start);
            url.searchParams.set('end', parsed.end);
        } else {
            url.searchParams.set('since', parsed.since || defaults.defaultTimeRange);
        }

        url.searchParams.set('limit', String(parsed.limit || defaults.defaultLimit));

        if (parsed.level) {
            url.searchParams.set('level', parsed.level);
        }

        if (parsed.search) {
            url.searchParams.set('search', parsed.search);
        }
        if (parsed.preset) {
            url.searchParams.set('preset', parsed.preset);
        }

        if (parsed.autorun || parsed.hasExplicitFilters) {
            url.searchParams.set('autorun', '1');
        }

        return url.toString();
    }

    private formatFilterSummary(parsed: ParsedCommandArgs, defaultTimeRange: string, maxLinesPerQuery: number): string {
        const parts: Array<string> = [];
        if (parsed.preset) {
            parts.push(`preset=${parsed.preset}`);
        }
        if (parsed.start && parsed.end) {
            parts.push(`start=${parsed.start}`);
            parts.push(`end=${parsed.end}`);
        } else {
            parts.push(`since=${parsed.since || defaultTimeRange}`);
        }

        if (parsed.level) {
            parts.push(`level=${parsed.level}`);
        }

        if (parsed.search) {
            parts.push(`search=${parsed.search}`);
        }

        parts.push(`limit=${parsed.limit || Math.min(500, maxLinesPerQuery)}`);
        return parts.join(', ');
    }

    private isHttpUrl(value: string): boolean {
        try {
            const parsed = new URL(value);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    private normalizeDateTime(value: string): string | undefined {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return undefined;
        }

        return parsed.toISOString();
    }

    private unquote(value: string): string {
        const trimmed = value.trim();
        if (trimmed.length >= 2) {
            const first = trimmed[0];
            const last = trimmed[trimmed.length - 1];
            if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
                return trimmed.slice(1, -1).trim();
            }
        }

        return trimmed;
    }

    private readNumber(value: unknown, fallback: number, min: number, max: number): number {
        const parsed = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, Math.floor(parsed)));
    }
}
