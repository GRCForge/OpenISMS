const fs = require('fs');
const path = require('path');

// Allow configuring log file path via env, default to /app/uploads/app.log or backend/logs/app.log
const logFilePath = process.env.LOG_FILE || (
  process.env.NODE_ENV === 'production' 
    ? '/app/uploads/app.log'
    : path.join(__dirname, '../../logs/app.log')
);

// Ensure the directory exists
try {
  const logDir = path.dirname(logFilePath);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (e) {
  console.error('[Logger] Failed to create log directory:', e.message);
}

// Create a write stream
let logStream;
try {
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
} catch (e) {
  console.error('[Logger] Failed to create write stream for log file:', e.message);
}

const formatMessage = (level, args) => {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => {
    if (arg instanceof Error) {
      return arg.stack;
    } else if (typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return String(arg);
      }
    } else {
      return String(arg);
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
