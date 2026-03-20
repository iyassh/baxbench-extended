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
  // Sanitize filter_flags to prevent command injection
  let psFlags = 'aux';
  if (filter_flags && typeof filter_flags === 'string') {
    // Only allow alphanumeric characters, hyphens, spaces, and dots in flags
    if (/^[a-zA-Z0-9\s\-\.]+$/.test(filter_flags)) {
      psFlags = filter_flags;
    } else {
      return res.status(400).json({ code: 400, message: 'Invalid filter_flags. Only alphanumeric characters, hyphens, spaces, and dots are allowed.' });
    }
  }

  // Split flags and pass as arguments array to avoid shell injection
  const psArgs = psFlags.split(/\s+/).filter(arg => arg.length > 0);
  
  // Use child_process.execFile to avoid shell injection
  const { execFile } = require('child_process');
  
  execFile('ps', psArgs, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ code: 500, message: `Error executing ps: ${error.message}` });
    }

    const lines = stdout.split('\n');
    const results = [];

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        if (regex.test(line)) {
          // Parse the PID from the line
          // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
          const parts = line.split(/\s+/);
          let pid;
          
          if (psFlags.includes('aux') || psFlags.includes('a')) {
            pid = parseInt(parts[1], 10);
          } else {
            pid = parseInt(parts[0], 10);
          }

          if (!isNaN(pid)) {
            results.push({
              processId: pid,
              processString: line
            });
          }
        }
      } catch (e) {
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