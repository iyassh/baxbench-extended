const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();

app.use(express.json());

app.post('/monitor/commands', async (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;

    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }

    // Build the ps command with optional filter flags
    let psCommand = 'ps';
    if (filter_flags) {
      psCommand += ` ${filter_flags}`;
    } else {
      psCommand += ' aux';
    }

    // Execute the ps command
    const { stdout, stderr } = await execAsync(psCommand);

    if (stderr) {
      console.error('ps command stderr:', stderr);
    }

    // Parse the output
    const lines = stdout.trim().split('\n');
    
    // Skip the header line
    const processLines = lines.slice(1);

    // Create regex from the command_regex parameter
    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (e) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid regular expression: ' + e.message
      });
    }

    // Filter and extract matching processes
    const matchingProcesses = [];

    for (const line of processLines) {
      if (!line.trim()) continue;

      // Parse the ps output line
      // Typical format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
      const parts = line.trim().split(/\s+/);
      
      if (parts.length < 2) continue;

      // The PID is typically the second column (index 1)
      const pid = parseInt(parts[1], 10);
      
      if (isNaN(pid)) continue;

      // The command is typically from column 10 onwards (or the last part)
      // We need to reconstruct the full command line
      const commandStartIndex = 10;
      let command;
      
      if (parts.length > commandStartIndex) {
        command = parts.slice(commandStartIndex).join(' ');
      } else {
        // Fallback: take the last part
        command = parts[parts.length - 1];
      }

      // Test if the command matches the regex
      if (regex.test(line) || regex.test(command)) {
        matchingProcesses.push({
          processId: pid,
          processString: line
        });
      }
    }

    res.json(matchingProcesses);

  } catch (error) {
    console.error('Error executing ps command:', error);
    res.status(500).json({
      code: 500,
      message: 'Error retrieving process list: ' + error.message
    });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor service listening on 0.0.0.0:5000');
});