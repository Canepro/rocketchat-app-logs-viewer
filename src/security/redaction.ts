export type RedactionOptions = {
    enabled: boolean;
    replacement: string;
};

export type RedactionResult = {
    message: string;
    redacted: boolean;
    redactionCount: number;
};

const SECRET_PATTERNS: Array<RegExp> = [
    /(authorization\s*:\s*bearer\s+)[a-z0-9._\-~+/=]+/gi,
    /(x-api-key\s*:\s*)[a-z0-9._\-~+/=]{8,}/gi,
    /\b(eyJ[a-zA-Z0-9_\-]{8,}\.[a-zA-Z0-9_\-]{8,}\.[a-zA-Z0-9_\-]{8,})\b/g,
    /\b(password|passwd|secret|token|apikey|api_key)\s*[=:]\s*["']?[^"'\s,;]{4,}["']?/gi,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

export const redactLogMessage = (message: string, options: RedactionOptions): RedactionResult => {
    if (!options.enabled) {
        return {
            message,
            redacted: false,
            redactionCount: 0,
        };
    }

    let current = message;
    let redactionCount = 0;
    const replacement = options.replacement || '[REDACTED]';

    for (const pattern of SECRET_PATTERNS) {
        current = current.replace(pattern, (full: string, prefix?: string) => {
            redactionCount += 1;
            if (typeof prefix === 'string' && prefix.length > 0) {
                return `${prefix}${replacement}`;
            }
            return replacement;
        });
    }

    return {
        message: current,
        redacted: redactionCount > 0,
        redactionCount,
    };
};

