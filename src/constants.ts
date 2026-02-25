export const COMMANDS = {
    LOGS: 'logs',
} as const;

export const SETTINGS = {
    LOGS_SOURCE_MODE: 'logs_source_mode',
    LOKI_BASE_URL: 'loki_base_url',
    LOKI_USERNAME: 'loki_username',
    LOKI_TOKEN: 'loki_token',
    REQUIRED_LABEL_SELECTOR: 'required_label_selector',
    ALLOWED_ROLES: 'allowed_roles',
    WORKSPACE_PERMISSION_CODE: 'workspace_permission_code',
    WORKSPACE_PERMISSION_MODE: 'workspace_permission_mode',
    ENABLE_REDACTION: 'enable_redaction',
    REDACTION_REPLACEMENT: 'redaction_replacement',
    DEFAULT_TIME_RANGE: 'default_time_range',
    MAX_TIME_WINDOW_HOURS: 'max_time_window_hours',
    MAX_LINES_PER_QUERY: 'max_lines_per_query',
    QUERY_TIMEOUT_MS: 'query_timeout_ms',
    RATE_LIMIT_QPM: 'rate_limit_qpm',
    AUDIT_RETENTION_DAYS: 'audit_retention_days',
    AUDIT_MAX_ENTRIES: 'audit_max_entries',
    EXTERNAL_COMPONENT_URL: 'external_component_url',
} as const;

export const EXTERNAL_COMPONENT = {
    NAME: 'logs-viewer',
    DESCRIPTION: 'Rocket.Chat Logs Viewer external component',
    ICON_URL: 'https://rocket.chat/favicon.ico',
    DEFAULT_URL: 'http://localhost:5173',
} as const;
