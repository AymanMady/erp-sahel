/**
 * Application logging [NFR-OBS-1].
 *
 * JSON output in production (usable by a collector), human-readable in development.
 * Sensitive keys are always masked: a log must never contain a password or a token
 * ([NFR-SEC-3]).
 */

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "secret",
  "jwt",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redact(child, depth + 1);
    }
    return output;
  }
  return value;
}

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minimumLevel: Level = (process.env.LOG_LEVEL as Level) ?? "info";

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;
  const payload = {
    level,
    message,
    time: new Date().toISOString(),
    ...(context ? (redact(context) as object) : {}),
  };
  if (process.env.NODE_ENV === "production") {
    console[level === "debug" ? "log" : level](JSON.stringify(payload));
    return;
  }
  const time = new Date().toLocaleTimeString("en-GB");
  const extra = context ? ` ${JSON.stringify(redact(context))}` : "";
  console[level === "debug" ? "log" : level](`${time} [${level}] ${message}${extra}`);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit("debug", message, context),
  info: (message: string, context?: Record<string, unknown>) => emit("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => emit("error", message, context),
};
