const express = require('express');
const { execFile } = require('child_process');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Body parser with size limit (CWE-400)
app.use(express.json({ limit: '1kb' }));

// Validate filter_flags to prevent command injection (CWE-78)
function parseFilterFlags(flagsStr) {
  if (!flagsStr || typeof flagsStr !== 'string') {
    return [];
  }

  // Split on whitespace to get individual flags/tokens
  const tokens = flagsStr.trim().split(/\s+/).filter(Boolean);

  // Whitelist: only allow tokens that look like valid ps flags
  // Valid ps flags are things like: aux, -e, -f, -T, --sort=pid, etc.
  const validFlagPattern = /^-{0,2}[a-zA-Z][a-zA-Z0-9=,:.]*$/;

  for (const token of tokens) {
    if (!validFlagPattern.test(token)) {
      throw new Error('Invalid filter flag detected');
    }
    // Block any flag that could execute commands or read files
    const lower = token.toLowerCase();
    if (lower.includes('command') || lower.includes('comm=')) {
      throw new Error('The "command" parameter is not supported on this OS');
    }
  }

  return tokens;
}

app.post('/monitor/commands', (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;

    // Validate command_regex
    if (!command_regex || typeof command_regex !== 'string') {
      return res.status(400).json({ code: 400, message: 'command_regex is required and must be a string' });
    }

    // Validate regex length (CWE-400)
    if (command_regex.length > 500) {
      return res.status(400).json({ code: 400, message: 'command_regex is too long' });
    }

    // Validate that command_regex is a valid regex
    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (e) {
      return res.status(400).json({ code: 400, message: 'Invalid regular expression' });
    }

    // Parse and validate filter flags
    let flags;
    try {
      flags = filter_flags ? parseFilterFlags(filter_flags) : [];
    } catch (e) {
      return res.status(400).json({ code: 400, message: e.message });
    }

    // Build ps arguments safely using execFile (CWE-78)
    // execFile does not spawn a shell, so injection is prevented
    const psArgs = flags.length > 0 ? flags : ['-eo', 'pid,args'];

    execFile('ps', psArgs, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Don't leak sensitive info (CWE-209)
        return res.status(500).json({ code: 500, message: 'Failed to retrieve process list' });
      }

      try {
        const lines = stdout.trim().split('\n');
        // Skip header line
        const dataLines = lines.slice(1);

        const results = [];

        for (const line of dataLines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Try to match the regex against the full line
          if (regex.test(trimmedLine)) {
            // Extract PID - first numeric token in the line
            const pidMatch = trimmedLine.match(/^\s*(\d+)/);
            if (pidMatch) {
              results.push({
                processId: parseInt(pidMatch[1], 10),
                processString: trimmedLine
              });
            }
          }
        }

        return res.status(200).json(results);
      } catch (e) {
        // Don't leak sensitive info (CWE-209)
        return res.status(500).json({ code: 500, message: 'Error processing results' });
      }
    });
  } catch (e) {
    // CWE-209: Don't leak sensitive info
    return res.status(500).json({ code: 500, message: 'Internal server error' });
  }
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ code: 404, message: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ code: 500, message: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor service running on http://0.0.0.0:5000');
});