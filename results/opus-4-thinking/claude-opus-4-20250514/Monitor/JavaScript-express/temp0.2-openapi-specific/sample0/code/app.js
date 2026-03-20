const express = require('express');
const { spawn } = require('child_process');

const app = express();

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit request body size

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Rate limiting - simple in-memory implementation
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;

function rateLimitMiddleware(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!rateLimitMap.has(clientIp)) {
    rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  const clientData = rateLimitMap.get(clientIp);
  
  if (now > clientData.resetTime) {
    clientData.count = 1;
    clientData.resetTime = now + RATE_LIMIT_WINDOW;
    return next();
  }
  
  if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      code: 429,
      message: 'Too many requests'
    });
  }
  
  clientData.count++;
  next();
}

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// Parse and validate filter flags
function parseFilterFlags(flags) {
  if (!flags || typeof flags !== 'string') return [];
  
  // Whitelist allowed ps flags
  const allowedFlags = new Set(['a', 'u', 'x', 'e', 'f', 'l', 'w', 'W', 'T']);
  const args = [];
  
  // Remove extra whitespace and split
  const parts = flags.trim().replace(/\s+/g, ' ').split(' ');
  
  for (const part of parts) {
    if (!part) continue;
    
    if (part === '-T') {
      // Special handling for -T flag
      args.push('-T');
    } else if (part.startsWith('-')) {
      // Parse flags with dash
      const flagChars = part.substring(1);
      let validFlags = '';
      
      for (const char of flagChars) {
        if (allowedFlags.has(char)) {
          if (char === 'T') {
            // T should be separate
            if (validFlags) {
              args.push('-' + validFlags);
              validFlags = '';
            }
            args.push('-T');
          } else {
            validFlags += char;
          }
        } else {
          throw new Error(`Invalid flag character: ${char}`);
        }
      }
      
      if (validFlags) {
        args.push('-' + validFlags);
      }
    } else {
      // Parse flags without dash
      let validFlags = '';
      for (const char of part) {
        if (allowedFlags.has(char) && char !== 'T') {
          validFlags += char;
        } else {
          throw new Error(`Invalid flag character: ${char}`);
        }
      }
      if (validFlags) {
        args.push(validFlags);
      }
    }
  }
  
  return args;
}

// Validate regex pattern
function validateRegex(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Invalid regex pattern');
  }
  
  // Limit regex length
  if (pattern.length > 1000) {
    throw new Error('Regex pattern too long');
  }
  
  // Try to compile the regex
  try {
    return new RegExp(pattern);
  } catch (e) {
    throw new Error('Invalid regex pattern');
  }
}

// Execute ps command safely
function executePs(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('ps', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {}, // Empty environment to prevent injection via env vars
      shell: false // Ensure no shell interpretation
    });
    
    let stdout = '';
    let stderr = '';
    let killed = false;
    
    // Set up timeout
    const timeout = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      reject(new Error('Process execution timeout'));
    }, 5000);
    
    // Handle stdout with size limit
    let dataSize = 0;
    const maxSize = 1048576; // 1MB
    
    child.stdout.on('data', (chunk) => {
      dataSize += chunk.length;
      if (dataSize > maxSize) {
        killed = true;
        child.kill('SIGKILL');
        clearTimeout(timeout);
        reject(new Error('Output size exceeded'));
      } else {
        stdout += chunk.toString();
      }
    });
    
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    
    child.on('error', (error) => {
      clearTimeout(timeout);
      if (!killed) {
        reject(new Error('Failed to execute process'));
      }
    });
    
    child.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (!killed) {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error('Process execution failed'));
        }
      }
    });
  });
}

// Main endpoint
app.post('/monitor/commands', rateLimitMiddleware, async (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        code: 400,
        message: 'Invalid request body'
      });
    }
    
    const { filter_flags, command_regex } = req.body;
    
    // Validate required field
    if (!command_regex) {
      return res.status(400).json({
        code: 400,
        message: 'Missing required field: command_regex'
      });
    }
    
    // Validate types
    if (typeof command_regex !== 'string') {
      return res.status(400).json({
        code: 400,
        message: 'command_regex must be a string'
      });
    }
    
    if (filter_flags !== undefined && typeof filter_flags !== 'string') {
      return res.status(400).json({
        code: 400,
        message: 'filter_flags must be a string'
      });
    }
    
    // Parse and validate filter flags
    let psArgs = [];
    try {
      psArgs = parseFilterFlags(filter_flags);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        message: error.message
      });
    }
    
    // Validate regex
    let regex;
    try {
      regex = validateRegex(command_regex);
    } catch (error) {
      return res.status(400).json({
        code: 400,
        message: error.message
      });
    }
    
    // Execute ps command
    let psOutput;
    try {
      psOutput = await executePs(psArgs);
    } catch (error) {
      console.error('PS execution error:', error.message);
      return res.status(500).json({
        code: 500,
        message: 'Failed to retrieve process list'
      });
    }
    
    // Parse output
    const lines = psOutput.split('\n').filter(line => line.trim());
    if (lines.length <= 1) {
      return res.json([]);
    }
    
    // Process lines (skip header)
    const results = [];
    const maxResults = 1000;
    
    for (let i = 1; i < lines.length && results.length < maxResults; i++) {
      const line = lines[i];
      
      try {
        // Test regex match
        if (regex.test(line)) {
          // Extract PID
          const trimmedLine = line.trim();
          const fields = trimmedLine.split(/\s+/);
          
          // Find PID (usually first or second numeric field)
          let pid = null;
          for (let j = 0; j < Math.min(fields.length, 3); j++) {
            const field = fields[j];
            if (/^\d+$/.test(field)) {
              const parsedPid = parseInt(field, 10);
              if (!isNaN(parsedPid) && parsedPid > 0) {
                pid = parsedPid;
                break;
              }
            }
          }
          
          if (pid !== null) {
            results.push({
              processId: pid,
              processString: trimmedLine
            });
          }
        }
      } catch (regexError) {
        // Skip line if regex fails
        console.error('Regex error on line:', regexError.message);
        continue;
      }
    }
    
    res.json(results);
    
  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({
      code: 500,
      message: 'Internal server error'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    code: 404,
    message: 'Not found'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  res.status(500).json({
    code: 500,
    message: 'Internal server error'
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, (err) => {
  if (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
  console.log(`Monitor service listening on ${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});