const express = require('express');
const { exec } = require('child_process');
const { promisify } = require('util');

const app = express();
const execPromise = promisify(exec);

// Middleware for parsing JSON with size limit (CWE-400)
app.use(express.json({ limit: '1mb' }));

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Validate and sanitize filter flags to prevent command injection (CWE-78)
function validateFilterFlags(flags) {
  if (!flags) return '';
  
  // Only allow alphanumeric characters, hyphens, and spaces
  if (!/^[a-zA-Z0-9\s-]+$/.test(flags)) {
    throw new Error('Invalid filter flags');
  }
  
  // Additional check for dangerous patterns
  const dangerous = ['$', '`', '|', '&', ';', '>', '<', '(', ')', '{', '}', '\n', '\r', '\\', '"', "'"];
  for (const char of dangerous) {
    if (flags.includes(char)) {
      throw new Error('Invalid filter flags');
    }
  }
  
  // Limit length to prevent abuse
  if (flags.length > 50) {
    throw new Error('Filter flags too long');
  }
  
  return flags.trim();
}

// Validate regex pattern to prevent ReDoS attacks (CWE-400)
function validateRegex(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Invalid regex pattern');
  }
  
  // Limit regex pattern length
  if (pattern.length > 500) {
    throw new Error('Regex pattern too long');
  }
  
  try {
    // Test if it's a valid regex
    const regex = new RegExp(pattern);
    
    // Simple ReDoS detection - test with a sample string
    const testStr = 'test'.repeat(10);
    const startTime = Date.now();
    regex.test(testStr);
    
    // If regex takes more than 50ms on simple string, it might be malicious
    if (Date.now() - startTime > 50) {
      throw new Error('Regex pattern too complex');
    }
    
    return pattern;
  } catch (e) {
    if (e.message === 'Regex pattern too complex') {
      throw e;
    }
    throw new Error('Invalid regex pattern');
  }
}

// Parse ps output
function parsePsOutput(output, commandRegex) {
  const lines = output.split('\n');
  const results = [];
  const maxResults = 1000; // Limit to prevent memory exhaustion
  
  if (lines.length === 0) return results;
  
  // Skip header line (usually first line contains column headers)
  let startLine = 0;
  if (lines[0] && (lines[0].includes('PID') || /^[A-Z\s%]+/.test(lines[0]))) {
    startLine = 1;
  }
  
  for (let i = startLine; i < lines.length && results.length < maxResults; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    try {
      // Split line into fields
      const fields = line.split(/\s+/);
      
      // Find PID - usually one of the first numeric fields
      let pid = null;
      let pidIndex = -1;
      
      for (let j = 0; j < Math.min(fields.length, 5); j++) {
        if (/^\d+$/.test(fields[j])) {
          pid = parseInt(fields[j], 10);
          pidIndex = j;
          break;
        }
      }
      
      if (!pid || pidIndex === -1) continue;
      
      // Extract command string
      // Commands typically appear after several fields
      // Different ps formats have commands at different positions:
      // ps aux: typically at position 10+
      // ps -ef: typically at position 7+
      // ps -l: varies
      
      let commandStr = '';
      
      // Look for the command part - it often starts with /, [, or a letter
      for (let k = Math.max(pidIndex + 1, 7); k < fields.length; k++) {
        if (fields[k] && (
          fields[k].includes('/') ||
          fields[k].startsWith('[') ||
          k >= 10 ||
          (k === fields.length - 1 && k > pidIndex + 2)
        )) {
          commandStr = fields.slice(k).join(' ');
          break;
        }
      }
      
      // Fallback: if no command found yet, take the last portion
      if (!commandStr && fields.length > pidIndex + 1) {
        const cmdStartIdx = Math.min(10, fields.length - 1);
        if (cmdStartIdx > pidIndex) {
          commandStr = fields.slice(cmdStartIdx).join(' ');
        }
      }
      
      if (commandStr) {
        // Test against regex
        if (commandRegex.test(commandStr)) {
          results.push({
            processId: pid,
            processString: commandStr
          });
        }
      }
    } catch (e) {
      // Skip malformed lines
      continue;
    }
  }
  
  return results;
}

// Main endpoint
app.post('/monitor/commands', async (req, res) => {
  try {
    // Validate request body
    const { filter_flags, command_regex } = req.body;
    
    // Check required field
    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'command_regex is required'
      });
    }
    
    // Validate and sanitize inputs
    let psFlags = 'aux'; // Default flags
    if (filter_flags !== undefined && filter_flags !== null && filter_flags !== '') {
      try {
        const validated = validateFilterFlags(filter_flags);
        if (validated) {
          psFlags = validated;
        }
      } catch (e) {
        return res.status(400).json({
          code: 400,
          message: 'Invalid filter flags'
        });
      }
    }
    
    // Validate regex pattern
    let regex;
    try {
      const validatedPattern = validateRegex(command_regex);
      regex = new RegExp(validatedPattern);
    } catch (e) {
      return res.status(400).json({
        code: 400,
        message: e.message
      });
    }
    
    // Build ps command
    const psCommand = `ps ${psFlags}`;
    
    // Execute ps command with resource limits (CWE-400)
    const options = {
      timeout: 5000, // 5 second timeout
      maxBuffer: 1024 * 1024 * 2, // 2MB max buffer
      windowsHide: true
    };
    
    let result;
    try {
      result = await execPromise(psCommand, options);
    } catch (execError) {
      // Handle timeout
      if (execError.code === 'ETIMEDOUT' || execError.killed) {
        return res.status(503).json({
          code: 503,
          message: 'Process monitoring timed out'
        });
      }
      
      // Handle other exec errors (CWE-703)
      console.error('Process execution error:', execError.code || 'unknown');
      return res.status(500).json({
        code: 500,
        message: 'Failed to retrieve process list'
      });
    }
    
    // Parse output and filter by regex
    const processes = parsePsOutput(result.stdout || '', regex);
    
    // Return results
    res.json(processes);
    
  } catch (error) {
    // CWE-703: Proper error handling
    // CWE-209: Don't expose sensitive error details
    console.error('Request processing error:', error.message);
    
    res.status(500).json({
      code: 500,
      message: 'Internal server error'
    });
  }
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: 'Not Found'
  });
});

// Global error handler middleware (CWE-703)
app.use((err, req, res, next) => {
  // Log error internally but don't expose details (CWE-209)
  console.error('Unhandled error:', err.message || 'Unknown error');
  
  // Send generic error response
  if (!res.headersSent) {
    res.status(500).json({
      code: 500,
      message: 'Internal server error'
    });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`Monitor service listening on ${HOST}:${PORT}`);
});

// Graceful shutdown handling (CWE-703)
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing server');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing server');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});