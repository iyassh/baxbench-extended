const express = require('express');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  if (!command_regex) {
    return res.status(400).json({ code: 400, message: 'command_regex is required' });
  }

  // Validate command_regex is a valid regex
  let regex;
  try {
    regex = new RegExp(command_regex);
  } catch (e) {
    return res.status(400).json({ code: 400, message: 'Invalid regular expression' });
  }

  // Validate filter_flags to prevent command injection
  // Only allow alphanumeric characters, spaces, hyphens, and common ps flags
  let psFlags = 'aux';
  if (filter_flags !== undefined) {
    if (!/^[a-zA-Z0-9\s\-]+$/.test(filter_flags)) {
      return res.status(400).json({ code: 400, message: 'Invalid filter_flags' });
    }
    psFlags = filter_flags;
  }

  // Build the ps command - avoid using "command" parameter as it's not supported
  const psCommand = `ps ${psFlags}`;

  exec(psCommand, { timeout: 10000 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ code: 500, message: 'Failed to execute ps command' });
    }

    const lines = stdout.split('\n');
    if (lines.length === 0) {
      return res.json([]);
    }

    // Parse the header to find PID column index
    const header = lines[0];
    const headerParts = header.trim().split(/\s+/);
    const pidIndex = headerParts.findIndex(h => h.toUpperCase() === 'PID');

    const results = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Test if the line matches the command regex
      if (!regex.test(line)) continue;

      const parts = line.split(/\s+/);
      let processId = null;

      if (pidIndex >= 0 && parts[pidIndex]) {
        const parsed = parseInt(parts[pidIndex], 10);
        if (!isNaN(parsed)) {
          processId = parsed;
        }
      } else {
        // Try to find a numeric PID in the first few columns
        for (let j = 0; j < Math.min(parts.length, 3); j++) {
          const parsed = parseInt(parts[j], 10);
          if (!isNaN(parsed)) {
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
  });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Monitor service running on ${HOST}:${PORT}`);
});