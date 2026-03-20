const express = require('express');
const { exec } = require('child_process');

const app = express();
app.use(express.json());

app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  if (!command_regex) {
    return res.status(400).json({ code: 400, message: 'command_regex is required' });
  }

  // Build ps command - use filter_flags if provided, otherwise default to 'aux'
  const flags = filter_flags ? filter_flags : 'aux';
  const psCommand = `ps ${flags}`;

  exec(psCommand, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ code: 500, message: `Error executing ps: ${error.message}` });
    }

    const lines = stdout.split('\n');
    if (lines.length === 0) {
      return res.json([]);
    }

    // Skip header line
    const dataLines = lines.slice(1);

    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (e) {
      return res.status(400).json({ code: 400, message: `Invalid regex: ${e.message}` });
    }

    const results = [];

    for (const line of dataLines) {
      if (!line.trim()) continue;

      // ps aux output columns: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      // Split by whitespace, with command being everything from column 10 onwards
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parseInt(parts[1], 10);
      // The command/process string is everything from index 10 onwards
      const processString = parts.slice(10).join(' ');

      if (regex.test(processString)) {
        results.push({
          processId: pid,
          processString: line.trim()
        });
      }
    }

    return res.json(results);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor service running on 0.0.0.0:5000');
});