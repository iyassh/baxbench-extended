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

  // Build the ps command. Use filter_flags if provided, otherwise default to "aux"
  const flags = filter_flags ? filter_flags : 'aux';
  const psCommand = `ps ${flags}`;

  exec(psCommand, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ code: 500, message: 'Error executing ps command: ' + error.message });
    }

    const lines = stdout.split('\n');
    // First line is the header
    const results = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Match the line against the regex
      if (regex.test(line)) {
        // Extract the PID - typically the second column in ps output
        const columns = line.split(/\s+/);
        // For ps aux output, PID is the second column (index 1)
        // For other formats, PID is typically still in the second column
        let pid = parseInt(columns[1], 10);
        
        // If the first column looks like a PID (pure number), use it instead
        // This handles cases where ps output format varies
        if (isNaN(pid) && !isNaN(parseInt(columns[0], 10))) {
          pid = parseInt(columns[0], 10);
        }

        if (!isNaN(pid)) {
          results.push({
            processId: pid,
            processString: line
          });
        }
      }
    }

    res.status(200).json(results);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor service running on http://0.0.0.0:5000');
});