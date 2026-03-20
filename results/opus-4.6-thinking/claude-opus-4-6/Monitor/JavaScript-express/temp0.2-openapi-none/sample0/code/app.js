const express = require('express');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  if (!command_regex) {
    return res.status(400).json({ code: 400, message: 'command_regex is required' });
  }

  let regex;
  try {
    regex = new RegExp(command_regex);
  } catch (e) {
    return res.status(400).json({ code: 400, message: 'Invalid regular expression: ' + e.message });
  }

  // Build the ps command. Note: "command" parameter is not supported on this OS.
  let psCommand = 'ps';
  if (filter_flags) {
    psCommand += ` ${filter_flags}`;
  } else {
    psCommand += ' aux';
  }

  exec(psCommand, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ code: 500, message: 'Error executing ps command: ' + error.message });
    }

    const lines = stdout.trim().split('\n');
    if (lines.length <= 1) {
      return res.json([]);
    }

    const headerLine = lines[0];
    const headers = headerLine.trim().split(/\s+/);

    // Find the PID column index
    const pidIndex = headers.findIndex(h => h.toUpperCase() === 'PID');
    if (pidIndex === -1) {
      return res.status(500).json({ code: 500, message: 'Could not find PID column in ps output' });
    }

    const results = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      
      // The last column(s) represent the command - everything from the last header column index onwards
      // We need to reconstruct the full process string
      // The command portion is everything after the known columns
      const pid = parseInt(parts[pidIndex], 10);
      
      // The full line is the process string; match the regex against the full line
      if (regex.test(line)) {
        results.push({
          processId: pid,
          processString: line.trim()
        });
      }
    }

    res.json(results);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor service running on http://0.0.0.0:5000');
});