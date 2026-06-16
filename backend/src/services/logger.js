const path = require('path');
const { createStream } = require('rotating-file-stream');

// Allow configuring log file path via env, default to /app/uploads/app.log or backend/logs/app.log
const logFilePath = process.env.LOG_FILE || (
  process.env.NODE_ENV === 'production'
    ? '/app/uploads/app.log'
    : path.join(__dirname, '../../logs/app.log')
);

// Create a size-rotated write stream. Rotation caps unbounded disk growth
// (disk-fill DoS) when high-volume request data reaches the log. The target
// directory is created automatically by rotating-file-stream. Tunable via env:
//   LOG_MAX_SIZE   — max size per file before rotation (default 10M)
//   LOG_MAX_FILES  — number of rotated files to retain (default 5)
let logStream;
try {
  logStream = createStream(path.basename(logFilePath), {
    path: path.dirname(logFilePath),
    size: process.env.LOG_MAX_SIZE || '10M',
    maxFiles: parseInt(process.env.LOG_MAX_FILES, 10) || 5,
  });
} catch (e) {
  console.error('[Logger] Failed to create rotating log stream:', e.message);
}

// Strip CR/LF from each token to prevent log injection (CWE-117) when
// user-controlled values (e.g. URLs, error messages) reach the log file.
const sanitize = (s) => String(s).replace(/[\r\n]/g, ' ');

const formatMessage = (level, args) => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => {
    if (arg instanceof Error) {
      return sanitize(arg.stack || arg.message);
    } else if (typeof arg === 'object') {
      try {
        return sanitize(JSON.stringify(arg));
      } catch (e) {
        return sanitize(String(arg));
      }
    } else {
      return sanitize(arg);
    }
  }).join(' ');
  return `[${timestamp}] [${level}] ${message}\n`;
};

// Preserve original console methods
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;

const writeLog = (level, args, originalMethod) => {
  // Call the original console method so standard out still receives the logs
  originalMethod.apply(console, args);
  
  if (logStream) {
    const formatted = formatMessage(level, args);
    logStream.write(formatted);
  }
};

console.log = (...args) => writeLog('INFO', args, originalLog);
console.info = (...args) => writeLog('INFO', args, originalInfo);
console.warn = (...args) => writeLog('WARN', args, originalWarn);
console.error = (...args) => writeLog('ERROR', args, originalError);

if (logStream) {
  logStream.on('error', (err) => {
    originalError.apply(console, ['[Logger] Error writing to log file:', err]);
  });
}

console.log(`[Logger] Application logging initialized. Logging to ${logFilePath}`);

module.exports = {
  logFilePath
};
