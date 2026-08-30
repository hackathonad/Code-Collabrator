type SafeLogValue = string | number | boolean | null | undefined;
type SafeLogFields = Record<string, SafeLogValue>;

const sensitiveField = /(?:api[_-]?key|api[_-]?secret|service[_-]?role|secret|password|token|authorization|cookie|private[_-]?key)/i;
const redact = (value: string) => value
  .replace(/(api[_-]?key|secret|password|token|authorization|cookie)\s*([:=])\s*([^\s,;]+)/gi, "$1$2[REDACTED]")
  .replace(/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/gi, "[PRIVATE KEY REDACTED]")
  .slice(0, 300);

export const logSafeEvent = (scope: string, event: string, fields: SafeLogFields = {}) => {
  const safeFields = Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined) return [];
    if (sensitiveField.test(key)) return [[key, "[REDACTED]"]];
    return [[key, typeof value === "string" ? redact(value) : value]];
  }));
  console.info(JSON.stringify({ timestamp: new Date().toISOString(), scope, event, ...safeFields }));
};
