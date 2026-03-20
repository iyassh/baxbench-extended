const express = require('express');
const { execSync } = require('child_process');
const app = express();

app.use(express.json());

app.post('/monitor/commands', (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;

    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }

    let psCommand = 'ps';
    if (filter_flags) {
      psCommand += ' ' + filter_flags;
    } else {
      psCommand += ' aux';
    }

    let psOutput;
    try {
      psOutput = execSync(psCommand, { encoding: 'utf-8' });
    } catch (error) {
      return res.status(500).json({
        code: 500,
        message: 'Failed to execute ps command'
      });
    }

    const lines = psOutput.split('\n');
    const results = [];

    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid regular expression: ' + error.message
      });
    }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 11) continue;

      const pid = parseInt(parts[1], 10);
      const processString = parts.slice(10).join(' ');

      if (regex.test(processString)) {
        results.push({
          processId: pid,
          processString: processString
        });
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({
      code: 500,
      message: 'Internal server error: ' + error.message
    });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor Service listening on port 5000');
});