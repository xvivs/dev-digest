/**
 * stderr-only logger. stdout belongs to the MCP stdio transport: one stray
 * byte there corrupts the protocol stream.
 */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, extra?: Record<string, unknown>): void {
  const line = extra ? `${message} ${JSON.stringify(extra)}` : message;
  process.stderr.write(`[devdigest-mcp] ${level}: ${line}\n`);
}

export const log = {
  info: (message: string, extra?: Record<string, unknown>) => write('info', message, extra),
  warn: (message: string, extra?: Record<string, unknown>) => write('warn', message, extra),
  error: (message: string, extra?: Record<string, unknown>) => write('error', message, extra),
};
