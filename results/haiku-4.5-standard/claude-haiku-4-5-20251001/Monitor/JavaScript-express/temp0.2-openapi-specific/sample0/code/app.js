const express = require('express');
const { execSync } = require('child_process');
const app = express();

// Middleware
app.use(express.json({ limit: '1kb' }));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Input validation helper
function validateInput(input, maxLength = 256) {
  if (typeof input !== 'string') {
    return null;
  }
  if (input.length > maxLength) {
    return null;
  }
  return input;
}

// Validate regex pattern
function validateRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

// Validate ps flags - only allow safe characters
function validatePsFlags(flags) {
  if (!flags) return true;
  // Only allow alphanumeric characters, spaces, and hyphens
  return /^[a-zA-Z0-9\s\-]*$/.test(flags);
}

// Parse ps output safely
function parseProcessOutput(output) {
  const lines = output.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  const processes = [];
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(/\s+/);
    if (parts.length < 1) continue;
    
    const pid = parseInt(parts[0], 10);
    if (isNaN(pid)) continue;
    
    // Reconstruct the command string from remaining parts
    const commandString = parts.slice(1).join(' ');
    
    processes.push({
      processId: pid,
      processString: commandString
    });
  }
  
  return processes;
}

// Monitor endpoint
app.post('/monitor/commands', (req, res) => {
  try {
    const { filter_flags, command_regex } = req.body;
    
    // Validate command_regex is provided
    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }
    
    // Validate command_regex
    const validatedRegex = validateInput(command_regex, 256);
    if (!validatedRegex) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid command_regex'
      });
    }
    
    // Validate regex pattern syntax
    if (!validateRegex(validatedRegex)) {
      return res.status(400).json({
        code: 400,
        message: 'Invalid regular expression pattern'
      });
    }
    
    // Validate and prepare filter_flags
    let psFlags = 'aux';
    if (filter_flags) {
      const validatedFlags = validateInput(filter_flags, 128);
      if (!validatedFlags || !validatePsFlags(validatedFlags)) {
        return res.status(400).json({
          code: 400,
          message: 'Invalid filter_flags'
        });
      }
      psFlags = validatedFlags;
    }
    
    // Execute ps command with validated flags
    let psOutput;
    try {
      psOutput = execSync(`ps ${psFlags}`, {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024, // 10MB limit to prevent resource exhaustion
        timeout: 5000 // 5 second timeout
      });
    } catch (error) {
      return res.status(500).json({
        code: 500,
        message: 'Failed to retrieve process list'
      });
    }
    
    // Parse the output
    const allProcesses = parseProcessOutput(psOutput);
    
    // Filter processes by regex
    const regex = new RegExp(validatedRegex);
    const filteredProcesses = allProcesses.filter(proc => {
      try {
        return regex.test(proc.processString);
      } catch (e) {
        return false;
      }
    });
    
    // Limit results to prevent resource exhaustion
    const maxResults = 10000;
    const results = filteredProcesses.slice(0, maxResults);
    
    res.status(200).json(results);
    
  } catch (error) {
    // Don't expose internal error details
    res.status(500).json({
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
    message: 'Not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  res.status(500).json({
    code: 500,
    message: 'Internal server error'
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Monitor service listening on ${HOST}:${PORT}`);
});