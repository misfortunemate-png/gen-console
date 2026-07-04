const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_PATH = path.join(LOG_DIR, 'pipeline.log');

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Only structural fields (ids/counts/enums) may pass through here.
// Never pass prompt/preset body text into `event` (NFR-8).
function logEvent(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
  fs.appendFileSync(LOG_PATH, line + '\n');
  console.log(line);
}

module.exports = { logEvent };
