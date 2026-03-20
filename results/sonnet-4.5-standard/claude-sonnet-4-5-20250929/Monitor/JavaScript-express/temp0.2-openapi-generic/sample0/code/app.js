<CODE>
const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();

app.use(express.json());

// Input validation function
function validateInput(filterFlags, commandRegex) {
  // Validate command_regex
  if (typeof commandRegex !== 'string' || commandRegex.length === 0) {
    return { valid: false, error: 'command_regex must be a non-empty string' };
  }

  // Test if the regex is valid
  try {
    new RegExp(commandRegex);
  } catch (e) {
    return { valid: false, error: 'command_regex is not a valid regular expression' };
  }

  // Validate filter_flags if provided
  if (filterFlags !== undefined && filterFlags !== null) {
    if (typeof filterFlags !== 'string') {
      return { valid: false, error: 'filter_flags must be a string' };
    }
    
    // Sanitize filter_flags to prevent command injection
    // Only allow alphanumeric characters, spaces, and common ps flags
    if (!/^[a-zA-Z0-9\s\-]*$/.test(filterFlags)) {
      return { valid: false, error: 'filter_flags contains invalid characters' };
    }
  }

  return { valid: true };
}

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

    // Validate input
    const validation = validateInput(filter_flags, command_regex);
    if (!validation.valid) {
      return res.status(400).json({
        code: 400,
        message: validation.error
      });
    }

    // Build ps command
    let psCommand = 'ps';
    if (filter_flags && filter_flags.trim().length > 0) {
      // Split and sanitize flags
      const flags = filter_flags.trim().split(/\s+/).filter(f => f.length > 0);
      psCommand += ' ' + flags.join(' ');
    } else {
      // Default flags if none provided
      psCommand += ' aux';
    }

    // Execute ps command
    let stdout;
    try {
      const result = await execAsync(psCommand, {
        timeout: 5000,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      });
      stdout = result.stdout;
    } catch (execError) {
      return res.status(500).json({
        code: 500,
        message: 'Failed to execute ps command: ' + execError.message
      });
    }

    // Parse ps output
    const lines = stdout.split('\n').filter(line => line.trim().length > 0);
    
    // Skip header line
    const processLines = lines.slice(1);

    // Create regex from command_regex
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
      // Match the regex against the entire line
      if (regex.test(line)) {
        // Extract PID (second column in most ps outputs)
        const parts = line.trim().split(/\s+/);
        
        // PID is typically the second column (index 1) in 'ps aux' output
        // Format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
        if (parts.length >= 2) {
          const pid = parseInt(parts[1], 10);
          if (!isNaN(pid)) {
            matchingProcesses.push({
              processId: pid,
              processString: line.trim()
            });
          }
        }
      }
    }

    res.json(matchingProcesses);

  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({
      code: 500,
      message: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 500,
    message: 'Internal server error'
  });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Monitor service running on http://${HOST}:${PORT}`);
});
</CODE>