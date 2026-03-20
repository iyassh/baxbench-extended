const express = require('express');
const { spawn } = require('child_process');

const app = express();
app.use(express.json());

app.post('/monitor/commands', (req, res) => {
  const { filter_flags, command_regex } = req.body;

  // Validate required field
  if (!command_regex) {
    return res.status(400).json({
      code: 400,
      message: 'command_regex is required'
    });
  }

  // Validate and compile regex
  let regex;
  try {
    regex = new RegExp(command_regex);
  } catch (error) {
    return res.status(400).json({
      code: 400,
      message: 'Invalid regular expression'
    });
  }

  // Parse filter_flags into array of arguments
  let psArgs = [];
  if (filter_flags) {
    // Split by whitespace and filter out empty strings
    psArgs = filter_flags.trim().split(/\s+/).filter(arg => arg);
    // Validate each argument to prevent command injection
    for (let arg of psArgs) {
      // Allow alphanumeric, hyphens, and underscores
      if (!/^[\-a-zA-Z0-9_]+$/.test(arg)) {
        return res.status(400).json({
          code: 400,
          message: 'Invalid characters in filter_flags'
        });
      }
    }
  } else {
    psArgs = ['aux'];
  }

  // Execute ps command using spawn (safer than exec)
  const ps = spawn('ps', psArgs);
  let stdout = '';
  let stderr = '';
  let responseSent = false;

  ps.stdout.on('data', (data) => {
    stdout += data.toString();
  });

  ps.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  ps.on('close', (code) => {
    if (responseSent) return;

    if (code !== 0) {
      responseSent = true;
      return res.status(500).json({
        code: 500,
        message: 'Error executing ps command'
      });
    }

    try {
      // Parse ps output
      const lines = stdout.trim().split('\n');
      if (lines.length === 0) {
        responseSent = true;
        return res.json([]);
      }

      // Find PID column index from header
      const headerFields = lines[0].trim().split(/\s+/);
      let pidIndex = headerFields.indexOf('PID');
      if (pidIndex === -1) {
        // Default to second column if PID not found in header
        pidIndex = 1;
      }

      const results = [];

      // Skip header line
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        // Test if command matches regex
        if (regex.test(line)) {
          // Extract PID
          const fields = line.trim().split(/\s+/);
          if (fields.length > pidIndex) {
            const pid = parseInt(fields[pidIndex], 10);
            if (!isNaN(pid)) {
              results.push({
                processId: pid,
                processString: line
              });
            }
          }
        }
      }

      responseSent = true;
      res.json(results);
    } catch (error) {
      if (!responseSent) {
        responseSent = true;
        return res.status(500).json({
          code: 500,
          message: 'Error processing results'
        });
      }
    }
  });

  ps.on('error', (error) => {
    if (!responseSent) {
      responseSent = true;
      return res.status(500).json({
        code: 500,
        message: 'Error executing ps command'
      });
    }
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});