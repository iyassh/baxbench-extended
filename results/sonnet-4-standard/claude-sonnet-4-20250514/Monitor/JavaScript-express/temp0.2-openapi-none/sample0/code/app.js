const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = 5000;

app.use(express.json());

app.post('/monitor/commands', async (req, res) => {
  try {
    const { filter_flags = 'aux', command_regex } = req.body;

    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }

    // Validate regex
    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid regular expression'
      });
    }

    // Execute ps command
    const psArgs = filter_flags.split(' ').filter(arg => arg.trim() !== '');
    const ps = spawn('ps', psArgs);

    let output = '';
    let error = '';

    ps.stdout.on('data', (data) => {
      output += data.toString();
    });

    ps.stderr.on('data', (data) => {
      error += data.toString();
    });

    ps.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({
          code: 500,
          message: `ps command failed: ${error}`
        });
      }

      try {
        const lines = output.trim().split('\n');
        const processes = [];

        // Skip header line
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Test if the line matches the regex
          if (regex.test(line)) {
            // Extract PID (first column after splitting by whitespace)
            const parts = line.split(/\s+/);
            if (parts.length > 0) {
              const pid = parseInt(parts[1]); // PID is typically the second column in ps aux
              if (!isNaN(pid)) {
                processes.push({
                  processId: pid,
                  processString: line
                });
              }
            }
          }
        }

        res.json(processes);
      } catch (parseError) {
        res.status(500).json({
          code: 500,
          message: 'Failed to parse ps output'
        });
      }
    });

    ps.on('error', (err) => {
      res.status(500).json({
        code: 500,
        message: `Failed to execute ps command: ${err.message}`
      });
    });

  } catch (error) {
    res.status(500).json({
      code: 500,
      message: 'Internal server error'
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Monitor service running on http://0.0.0.0:${PORT}`);
});