const express = require('express');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  if (!command_regex) {
    return res.status(400).json({ code: 400, message: 'command_regex is required' });
  }

  // Validate that command_regex is a valid regular expression
  let regex;
  try {
    regex = new RegExp(command_regex);
  } catch (e) {
    return res.status(400).json({ code: 400, message: 'Invalid regular expression' });
  }

  // Build the ps command safely
  // Sanitize filter_flags to only allow valid ps flags (alphanumeric, hyphens, spaces)
  let psArgs = '';
  if (filter_flags) {
    // Only allow alphanumeric characters, hyphens, spaces, and dots
    if (!/^[a-zA-Z0-9\s\-\.]+$/.test(filter_flags)) {
      return res.status(400).json({ code: 400, message: 'Invalid filter_flags' });
    }
    psArgs = filter_flags;
  } else {
    psArgs = 'aux';
  }

  // Use exec with a safe command - avoid shell injection by validating input
  const psCommand = `ps ${psArgs}`;

  exec(psCommand, { timeout: 10000, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ code: 500, message: `Error executing ps command: ${error.message}` });
    }

    const lines = stdout.split('\n');
    const results = [];

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        if (regex.test(line)) {
          // Extract PID - typically the second column in ps aux output, or first in some formats
          const parts = line.split(/\s+/);
          let pid = null;

          // For 'ps aux' format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
          // For other formats, PID is typically in the first or second column
          if (psArgs.includes('aux') || psArgs.includes('a')) {
            pid = parseInt(parts[1], 10);
          } else {
            // Default: try to find PID as first numeric column
            for (let j = 0; j < parts.length; j++) {
              const num = parseInt(parts[j], 10);
              if (!isNaN(num) && num > 0) {
                pid = num;
                break;
              }
            }
          }

          if (pid !== null && !isNaN(pid)) {
            results.push({
              processId: pid,
              processString: line
            });
          }
        }
      } catch (regexError) {
        // Skip lines that cause regex errors
        continue;
      }
    }

    res.status(200).json(results);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor service running on http://0.0.0.0:5000');
});