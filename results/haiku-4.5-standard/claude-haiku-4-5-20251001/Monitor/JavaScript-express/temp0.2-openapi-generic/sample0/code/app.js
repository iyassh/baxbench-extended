const express = require('express');
const { execSync } = require('child_process');
const app = express();

app.use(express.json());

// Validate regex pattern
function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

// Validate ps flags - only allow safe characters
function isValidPsFlags(flags) {
  if (!flags) return true;
  // Only allow alphanumeric characters, spaces, and hyphens
  return /^[a-zA-Z0-9\s\-]*$/.test(flags);
}

// Parse ps output and extract process information
function parseProcessOutput(output) {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return [];

  const processes = [];
  
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 1) continue;

    // First column is typically PID
    const pid = parseInt(parts[0], 10);
    if (isNaN(pid)) continue;

    processes.push({
      processId: pid,
      processString: line
    });
  }

  return processes;
}

// POST /monitor/commands endpoint
app.post('/monitor/commands', (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;

    // Validate required field
    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }

    // Validate regex pattern
    if (!isValidRegex(command_regex)) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid regular expression pattern'
      });
    }

    // Validate filter_flags if provided
    if (filter_flags && !isValidPsFlags(filter_flags)) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid ps flags'
      });
    }

    // Build ps command safely
    let psCommand = 'ps';
    if (filter_flags) {
      psCommand += ' ' + filter_flags;
    } else {
      psCommand += ' aux';
    }

    // Execute ps command with timeout
    let output;
    try {
      output = execSync(psCommand, {
        timeout: 5000,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      });
    } catch (error) {
      return res.status(500).json({
        code: 500,
        message: 'Failed to execute process query'
      });
    }

    // Parse process output
    const allProcesses = parseProcessOutput(output);

    // Filter processes by regex
    const regex = new RegExp(command_regex);
    const filteredProcesses = allProcesses.filter(proc => {
      return regex.test(proc.processString);
    });

    return res.status(200).json(filteredProcesses);

  } catch (error) {
    console.error('Error in /monitor/commands:', error);
    return res.status(500).json({
      code: 500,
      message: 'Internal server error'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: 'Endpoint not found'
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
  console.log(`Monitor Service listening on ${HOST}:${PORT}`);
});