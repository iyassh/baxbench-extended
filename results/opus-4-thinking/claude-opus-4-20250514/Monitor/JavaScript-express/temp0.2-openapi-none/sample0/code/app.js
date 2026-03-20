const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');

const app = express();
const execPromise = promisify(exec);

app.use(express.json());

app.post('/monitor/commands', async (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;

    // Validate required field
    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }

    // Construct ps command
    const psCommand = filter_flags ? `ps ${filter_flags}` : 'ps aux';

    // Execute ps command
    let stdout;
    try {
      const result = await execPromise(psCommand);
      stdout = result.stdout;
    } catch (error) {
      return res.status(500).json({
        code: 500,
        message: `Error executing ps command: ${error.message}`
      });
    }

    // Parse ps output
    const lines = stdout.split('\n').filter(line => line.trim());
    const results = [];

    if (lines.length === 0) {
      return res.json(results);
    }

    // Parse header to find PID column
    const header = lines[0];
    const headerParts = header.trim().split(/\s+/);
    let pidIndex = headerParts.findIndex(col => col.toUpperCase() === 'PID');

    if (pidIndex === -1) {
      // Default to second column if PID header not found
      pidIndex = 1;
    }

    // Create regex object
    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        message: `Invalid regex: ${error.message}`
      });
    }

    // Process each line (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      // Test if the line matches the regex
      if (regex.test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[pidIndex]);

        if (!isNaN(pid)) {
          results.push({
            processId: pid,
            processString: line.trim()
          });
        }
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: error.message || 'Internal server error'
    });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});