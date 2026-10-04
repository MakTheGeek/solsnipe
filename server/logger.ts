/**
 * Production Structured Logger with Automatic Secret Redaction
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const CURRENT_LEVEL: LogLevel = (process.env.LOG_LEVEL?.toUpperCase() as LogLevel) || 
  (process.env.NODE_ENV === 'production' ? 'INFO' : 'DEBUG');

// Regular expressions to detect and redact sensitive patterns
const SENSITIVE_PATTERNS = [
  /([a-zA-Z0-9_-]{20,}:[a-zA-Z0-9_-]{30,})/g, // Generic tokens / bot tokens
  /(?:privateKey|secretKey|sessionString|password|apiHash|apiKey)["']?\s*[:=]\s*["']?([^"'\s,]+)/gi,
  /(?:Bearer\s+)([a-zA-Z0-9_.-]{16,})/gi,
  /(?:1[1-9A-HJ-NP-Za-km-z]{80,90})/g, // Solana 64-byte base58 private key strings
];

export function redactSensitive(input: string): string {
  if (!input) return '';
  let cleaned = input;
  for (const pattern of SENSITIVE_PATTERNS) {
    cleaned = cleaned.replace(pattern, (match, p1) => {
      if (p1) {
        return match.replace(p1, '[REDACTED]');
      }
      return '[REDACTED]';
    });
  }
  return cleaned;
}

function formatMessage(level: LogLevel, context: string, message: string, ...args: any[]): string {
  const timestamp = new Date().toISOString();
  let formattedArgs = '';
  if (args.length > 0) {
    try {
      formattedArgs = ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    } catch {
      formattedArgs = ' [Unserializable Args]';
    }
  }
  const raw = `[${timestamp}] [${level}] [${context}] ${message}${formattedArgs}`;
  return redactSensitive(raw);
}

export const logger = {
  debug(context: string, message: string, ...args: any[]): void {
    if (LOG_LEVEL_PRIORITY['DEBUG'] >= LOG_LEVEL_PRIORITY[CURRENT_LEVEL]) {
      console.log(formatMessage('DEBUG', context, message, ...args));
    }
  },

  info(context: string, message: string, ...args: any[]): void {
    if (LOG_LEVEL_PRIORITY['INFO'] >= LOG_LEVEL_PRIORITY[CURRENT_LEVEL]) {
      console.log(formatMessage('INFO', context, message, ...args));
    }
  },

  warn(context: string, message: string, ...args: any[]): void {
    if (LOG_LEVEL_PRIORITY['WARN'] >= LOG_LEVEL_PRIORITY[CURRENT_LEVEL]) {
      console.warn(formatMessage('WARN', context, message, ...args));
    }
  },

  error(context: string, message: string, ...args: any[]): void {
    if (LOG_LEVEL_PRIORITY['ERROR'] >= LOG_LEVEL_PRIORITY[CURRENT_LEVEL]) {
      console.error(formatMessage('ERROR', context, message, ...args));
    }
  },
};
