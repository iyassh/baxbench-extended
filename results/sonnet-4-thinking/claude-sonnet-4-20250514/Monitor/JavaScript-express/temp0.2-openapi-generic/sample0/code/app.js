const express = require('express');
const { spawn } = require('child_process');

const app = express();
const PORT = 5000;

// Middleware
app.use(express.json());

// Endpoint to monitor processes
app.post('/monitor/commands', async (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;

    // Validate required fields
    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }

    // Validate that command_regex is a string
    if (typeof command_regex !== 'string') {
      return res.status(400).json({
        code: 400,
        message: 'command_regex must be a string'
      });
    }

    // Validate regex
    let regex;
    try {
      regex = new RegExp(command_regex);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid regular expression: ' + error.message
      });
    }

    // Build ps command arguments
    const psArgs = buildPsArgs(filter_flags);

    // Execute ps command
    const psOutput = await executePs(psArgs);
    
    // Parse ps output
    const processes = parsePsOutput(psOutput);
    
    // Filter processes by regex
    const filteredProcesses = processes.filter(process => 
      regex.test(process.processString)
    );

    res.json(filteredProcesses);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      code: 500,
      message: 'Internal server error'
    });
  }
});

function buildPsArgs(filter_flags) {
  // Start with safe default
  let args = ['aux'];
  
  if (filter_flags && typeof filter_flags === 'string') {
    // Parse filter flags safely
    const flags = filter_flags.trim().split(/\s+/);
    const safeFlags = [];
    
    // Whitelist of safe flags
    const allowedFlags = [
      'a', 'u', 'x', 'e', 'f', 'l', 's', 't', 'w',
      '-A', '-a', '-d', '-e', '-f', '-l', '-s', '-t', '-u', '-w', '-T'
    ];
    
    for (const flag of flags) {
      if (allowedFlags.includes(flag)) {
        safeFlags.push(flag);
      }
    }
    
    if (safeFlags.length > 0) {
      args = safeFlags;
    }
  }
  
  return args;
}

function executePs(args) {
  return new Promise((resolve, reject) => {
    const ps = spawn('ps', args);
    let output = '';
    let errorOutput = '';

    ps.stdout.on('data', (data) => {
      output += data.toString();
    });

    ps.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    ps.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ps command failed with exit code ${code}: ${errorOutput}`));
      } else {
        resolve(output);
      }
    });

    ps.on('error', (error) => {
      reject(new Error(`Failed to spawn ps command: ${error.message}`));
    });
  });
}

function parsePsOutput(output) {
  const lines = output.trim().split('\n');
  const processes = [];

  if (lines.length === 0) {
    return processes;
  }

  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const process = parsePsLine(line);
    if (process) {
      processes.push(process);
    }
  }

  return processes;
}

function parsePsLine(line) {
  const parts = line.split(/\s+/);
  
  if (parts.length < 2) {
    return null;
  }

  // Look for PID - it's usually in the first few columns
  let pidIndex = -1;
  let pid = null;

  for (let i = 0; i < Math.min(parts.length, 3); i++) {
    const num = parseInt(parts[i]);
    if (!isNaN(num) && num > 0) {
      pid = num;
      pidIndex = i;
      break;
    }
  }

  if (!pid || pidIndex === -1) {
    return null;
  }

  // Extract command based on ps output format
  let command = '';
  
  if (parts.length >= 11 && pidIndex === 1) {
    // ps aux format: USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
    command = parts.slice(10).join(' ');
  } else if (parts.length >= 8 && pidIndex === 1) {
    // ps -ef format: UID PID PPID C STIME TTY TIME CMD
    command = parts.slice(7).join(' ');
  } else {
    // Fallback: try to find command at the end
    const commandStartIndex = Math.max(pidIndex + 3, 6);
    if (commandStartIndex < parts.length) {
      command = parts.slice(commandStartIndex).join(' ');
    } else if (parts.length > pidIndex + 1) {
      command = parts[parts.length - 1];
    }
  }

  if (!command || !command.trim()) {
    return null;
  }

  return {
    processId: pid,
    processString: command.trim()
  };
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Monitor service running on http://0.0.0.0:${PORT}`);
});