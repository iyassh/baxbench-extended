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

    // Build ps command
    let psCommand = 'ps';
    if (filter_flags) {
      psCommand += ` ${filter_flags}`;
    } else {
      psCommand += ' aux';
    }

    // Execute ps command
    let stdout;
    try {
      const result = await execAsync(psCommand);
      stdout = result.stdout;
    } catch (execError) {
      return res.status(500).json({
        code: 500,
        message: `Failed to execute ps command: ${execError.message}`
      });
    }

    // Parse output
    const lines = stdout.split('\n');
    const processes = [];

    // Create regex from command_regex
    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (regexError) {
      return res.status(400).json({
        code: 400,
        message: `Invalid regular expression: ${regexError.message}`
      });
    }

    // Skip header line (first line) and process remaining lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      
      if (!line.trim()) continue;

      // Test if line matches regex
      if (regex.test(line)) {
        // Extract PID
        const parts = line.trim().split(/\s+/);
        
        let pid = null;
        
        // Check first column
        if (parts.length >= 1) {
          const firstCol = parseInt(parts[0], 10);
          if (!isNaN(firstCol) && firstCol > 0) {
            pid = firstCol;
          }
        }
        
        // If first column is not a number, check second column
        if (pid === null && parts.length >= 2) {
          const secondCol = parseInt(parts[1], 10);
          if (!isNaN(secondCol) && secondCol > 0) {
            pid = secondCol;
          }
        }

        if (pid !== null) {
          processes.push({
            processId: pid,
            processString: line
          });
        }
      }
    }

    res.json(processes);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      code: 500,
      message: error.message || 'Internal server error'
    });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Monitor service listening on 0.0.0.0:5000');
});