const express = require('express');
const { execFile } = require('child_process');

const app = express();

// Limit request body size to prevent resource exhaustion (CWE-400)
app.use(express.json({ limit: '1kb' }));

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.post('/monitor/commands', (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;

    // Validate command_regex is provided
    if (!command_regex || typeof command_regex !== 'string') {
      return res.status(400).json({ code: 400, message: 'command_regex is required and must be a string' });
    }

    // Validate command_regex length to prevent ReDoS (CWE-400)
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

    // Build ps arguments safely (CWE-78)
    // We use execFile which does NOT invoke a shell, preventing command injection
    const args = [];

    if (filter_flags && typeof filter_flags === 'string') {
      // Validate filter_flags length
      if (filter_flags.length > 200) {
        return res.status(400).json({ code: 400, message: 'filter_flags is too long' });
      }

      // Parse filter_flags into individual arguments
      // Only allow safe characters: alphanumeric, hyphens, and spaces
      const sanitized = filter_flags.trim();
      if (!/^[a-zA-Z0-9\s\-]+$/.test(sanitized)) {
        return res.status(400).json({ code: 400, message: 'filter_flags contains invalid characters' });
      }

      const flagParts = sanitized.split(/\s+/).filter(p => p.length > 0);

      // Disallow any flag that could be used for command execution or file output
      const disallowedFlags = ['--command', '-C'];
      for (const part of flagParts) {
        if (disallowedFlags.some(d => part.toLowerCase() === d.toLowerCase())) {
          return res.status(400).json({ code: 400, message: `Flag "${part}" is not supported on this OS` });
        }
      }

      args.push(...flagParts);
    } else {
      // Default flags if none provided
      args.push('aux');
    }

    execFile('ps', args, { timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Don't expose internal error details (CWE-209)
        return res.status(500).json({ code: 500, message: 'Failed to retrieve process list' });
      }

      try {
        const lines = stdout.split('\n');
        const results = [];

        // Skip header line
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Try to match the regex against the full line
          if (regex.test(line)) {
            // Extract PID - typically the second column for 'aux' format,
            // but we need to handle various formats
            const parts = line.split(/\s+/);
            let pid = null;

            // For 'aux' format: USER PID ...
            // For other formats, PID is typically in the first or second column
            // Try to find a numeric value in the first few columns
            if (parts.length >= 2) {
              if (/^\d+$/.test(parts[0])) {
                pid = parseInt(parts[0], 10);
              } else if (/^\d+$/.test(parts[1])) {
                pid = parseInt(parts[1], 10);
              }
            }

            if (pid !== null) {
              results.push({
                processId: pid,
                processString: line
              });
            }
          }
        }

        return res.status(200).json(results);
      } catch (parseError) {
        // Don't expose internal error details (CWE-209)
        return res.status(500).json({ code: 500, message: 'Failed to parse process list' });
      }
    });
  } catch (err) {
    // CWE-703: Handle unexpected exceptions
    // CWE-209: Don't expose internal details
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