'use strict';

const express = require('express');
const { execFile } = require('child_process');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Body size limit (CWE-400)
app.use(express.json({ limit: '10kb' }));

// POST /monitor/commands
app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  // Validate required field
  if (command_regex === undefined || command_regex === null) {
    return res.status(400).json({ code: 400, message: 'command_regex is required' });
  }

  if (typeof command_regex !== 'string') {
    return res.status(400).json({ code: 400, message: 'command_regex must be a string' });
  }

  // Validate regex length (CWE-400 - ReDoS prevention)
  if (command_regex.length > 200) {
    return res.status(400).json({ code: 400, message: 'command_regex is too long' });
  }

  // Validate the regex is valid
  let regex;
  try {
    regex = new RegExp(command_regex);
  } catch (e) {
    return res.status(400).json({ code: 400, message: 'Invalid regular expression' });
  }

  // Build safe ps arguments (CWE-78)
  // Only allow specific safe flags for ps, no shell injection possible since we use execFile
  let psArgs = [];

  if (filter_flags !== undefined && filter_flags !== null) {
    if (typeof filter_flags !== 'string') {
      return res.status(400).json({ code: 400, message: 'filter_flags must be a string' });
    }
    if (filter_flags.length > 100) {
      return res.status(400).json({ code: 400, message: 'filter_flags is too long' });
    }

    // Whitelist allowed ps flags/options to prevent command injection
    // Split by whitespace and validate each token
    const tokens = filter_flags.trim().split(/\s+/);
    const allowedFlagPattern = /^-?[a-zA-Z]+$/;

    for (const token of tokens) {
      if (token === '') continue;
      if (!allowedFlagPattern.test(token)) {
        return res.status(400).json({ code: 400, message: 'Invalid filter_flags: only alphanumeric flags are allowed' });
      }
      psArgs.push(token);
    }
  } else {
    // Default: use 'aux' flags
    psArgs = ['aux'];
  }

  // Use execFile to avoid shell injection (CWE-78)
  // Set a timeout to prevent resource exhaustion (CWE-400)
  const options = {
    timeout: 5000,
    maxBuffer: 1024 * 1024 * 5 // 5MB max output
  };

  execFile('ps', psArgs, options, (error, stdout, stderr) => {
    if (error) {
      // Do not expose internal error details (CWE-209)
      return res.status(500).json({ code: 500, message: 'Failed to retrieve process list' });
    }

    try {
      const lines = stdout.split('\n');
      if (lines.length === 0) {
        return res.json([]);
      }

      // Parse the header to find column positions
      const headerLine = lines[0];
      const headerTokens = headerLine.trim().split(/\s+/);

      // Find PID column index
      const pidIndex = headerTokens.findIndex(h => h.toUpperCase() === 'PID');

      const results = [];

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        // Test the line against the regex
        if (!regex.test(line)) continue;

        // Parse the line to extract PID
        const tokens = line.trim().split(/\s+/);

        let processId = null;
        if (pidIndex >= 0 && tokens[pidIndex] !== undefined) {
          const parsed = parseInt(tokens[pidIndex], 10);
          if (!isNaN(parsed)) {
            processId = parsed;
          }
        } else {
          // Try to find a numeric token that could be PID
          // Fallback: first numeric token
          for (const token of tokens) {
            const parsed = parseInt(token, 10);
            if (!isNaN(parsed) && String(parsed) === token) {
              processId = parsed;
              break;
            }
          }
        }

        results.push({
          processId: processId,
          processString: line
        });
      }

      return res.json(results);
    } catch (parseError) {
      // Do not expose internal error details (CWE-209)
      return res.status(500).json({ code: 500, message: 'Failed to parse process list' });
    }
  });
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ code: 404, message: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ code: 500, message: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Monitor service running on ${HOST}:${PORT}`);
});