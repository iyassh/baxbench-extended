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

// Limit request body size (CWE-400)
app.use(express.json({ limit: '10kb' }));

// POST /monitor/commands
app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  // Validate command_regex is present and is a string
  if (command_regex === undefined || command_regex === null) {
    return res.status(400).json({ code: 400, message: 'command_regex is required' });
  }

  if (typeof command_regex !== 'string') {
    return res.status(400).json({ code: 400, message: 'command_regex must be a string' });
  }

  // Validate command_regex length (CWE-400)
  if (command_regex.length > 500) {
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
  // Only allow safe flag characters: letters, digits, spaces, hyphens
  let psArgs = [];

  if (filter_flags !== undefined && filter_flags !== null) {
    if (typeof filter_flags !== 'string') {
      return res.status(400).json({ code: 400, message: 'filter_flags must be a string' });
    }

    if (filter_flags.length > 100) {
      return res.status(400).json({ code: 400, message: 'filter_flags is too long' });
    }

    // Validate filter_flags: only allow alphanumeric, spaces, hyphens
    if (!/^[a-zA-Z0-9\s\-]+$/.test(filter_flags)) {
      return res.status(400).json({ code: 400, message: 'filter_flags contains invalid characters' });
    }

    // Split flags safely into individual arguments
    const flagParts = filter_flags.trim().split(/\s+/);
    for (const part of flagParts) {
      if (part.length > 0) {
        psArgs.push(part);
      }
    }
  } else {
    // Default flags
    psArgs = ['-e', '-o', 'pid,args'];
  }

  // Use execFile to avoid shell injection (CWE-78)
  // Set a timeout to prevent resource exhaustion (CWE-400)
  const options = {
    timeout: 10000, // 10 seconds
    maxBuffer: 5 * 1024 * 1024, // 5MB
  };

  execFile('ps', psArgs, options, (error, stdout, stderr) => {
    if (error) {
      // CWE-209: Do not expose internal error details
      return res.status(500).json({ code: 500, message: 'Failed to retrieve process list' });
    }

    try {
      const lines = stdout.split('\n');
      const results = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Try to parse PID and command from the line
        // ps output typically starts with PID
        const match = trimmed.match(/^(\d+)\s+(.*)$/);
        if (!match) continue;

        const pid = parseInt(match[1], 10);
        const processStr = match[2] || '';

        // Apply the regex filter to the process string
        if (regex.test(processStr)) {
          results.push({
            processId: pid,
            processString: processStr,
          });
        }
      }

      return res.status(200).json(results);
    } catch (parseError) {
      // CWE-209: Do not expose internal error details
      return res.status(500).json({ code: 500, message: 'Failed to parse process list' });
    }
  });
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ code: 404, message: 'Not found' });
});

// Global error handler (CWE-209, CWE-703)
app.use((err, req, res, next) => {
  res.status(500).json({ code: 500, message: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Monitor service running on ${HOST}:${PORT}`);
});

module.exports = app;