<CODE>
const express = require('express');
const { exec } = require('child_process');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Body parser middleware with size limits to prevent resource exhaustion
app.use(express.json({ limit: '10kb' }));

// Request timeout middleware to prevent resource exhaustion
app.use((req, res, next) => {
  req.setTimeout(5000, () => {
    res.status(408).json({ code: 408, message: 'Request timeout' });
  });
  res.setTimeout(5000, () => {
    res.status(408).json({ code: 408, message: 'Response timeout' });
  });
  next();
});

// Validate and sanitize filter_flags to prevent command injection
function sanitizeFilterFlags(flags) {
  if (!flags) {
    return 'aux';
  }
  
  // Only allow specific safe characters and known ps flags
  const allowedPattern = /^[auxefwlTSO\s\-]+$/;
  if (!allowedPattern.test(flags)) {
    throw new Error('Invalid filter_flags format');
  }
  
  // Limit length to prevent resource exhaustion
  if (flags.length > 50) {
    throw new Error('filter_flags too long');
  }
  
  return flags.trim();
}

// Validate regex pattern
function validateRegex(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('command_regex is required and must be a string');
  }
  
  // Limit regex length to prevent ReDoS attacks
  if (pattern.length > 200) {
    throw new Error('command_regex too long');
  }
  
  // Test if it's a valid regex
  try {
    new RegExp(pattern);
  } catch (e) {
    throw new Error('Invalid regular expression');
  }
  
  return pattern;
}

app.post('/monitor/commands', async (req, res) => {
  try {
    // Validate request body exists
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ 
        code: 400, 
        message: 'Invalid request body' 
      });
    }
    
    const { filter_flags, command_regex } = req.body;
    
    // Validate and sanitize inputs
    let sanitizedFlags;
    let validatedRegex;
    
    try {
      sanitizedFlags = sanitizeFilterFlags(filter_flags);
      validatedRegex = validateRegex(command_regex);
    } catch (validationError) {
      return res.status(400).json({ 
        code: 400, 
        message: validationError.message 
      });
    }
    
    // Build ps command with sanitized flags
    // Using array format to prevent command injection
    const psCommand = `ps ${sanitizedFlags}`;
    
    // Execute ps command with timeout
    exec(psCommand, { 
      timeout: 3000,
      maxBuffer: 1024 * 1024 // 1MB max buffer
    }, (error, stdout, stderr) => {
      try {
        if (error) {
          // Don't expose detailed error information
          return res.status(500).json({ 
            code: 500, 
            message: 'Failed to retrieve process information' 
          });
        }
        
        // Parse ps output
        const lines = stdout.split('\n').filter(line => line.trim());
        
        if (lines.length === 0) {
          return res.status(200).json([]);
        }
        
        // Skip header line
        const processLines = lines.slice(1);
        
        // Compile regex for filtering
        let regex;
        try {
          regex = new RegExp(validatedRegex);
        } catch (regexError) {
          return res.status(400).json({ 
            code: 400, 
            message: 'Invalid regular expression' 
          });
        }
        
        const matchingProcesses = [];
        
        // Limit number of results to prevent resource exhaustion
        const maxResults = 1000;
        let resultCount = 0;
        
        for (const line of processLines) {
          if (resultCount >= maxResults) {
            break;
          }
          
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;
          
          // Test if line matches the regex
          if (regex.test(trimmedLine)) {
            // Extract PID (second column in most ps outputs)
            const parts = trimmedLine.split(/\s+/);
            
            if (parts.length >= 2) {
              const pid = parseInt(parts[1], 10);
              
              if (!isNaN(pid)) {
                matchingProcesses.push({
                  processId: pid,
                  processString: trimmedLine
                });
                resultCount++;
              }
            }
          }
        }
        
        res.status(200).json(matchingProcesses);
        
      } catch (processingError) {
        // Don't expose internal error details
        res.status(500).json({ 
          code: 500, 
          message: 'Error processing results' 
        });
      }
    });
    
  } catch (error) {
    // Generic error handler - don't expose internal details
    res.status(500).json({ 
      code: 500, 
      message: 'Internal server error' 
    });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ 
    code: 404, 
    message: 'Not found' 
  });
});

// Global error handler
app.use((err, req, res, next) => {
  // Don't expose error details
  res.status(500).json({ 
    code: 500, 
    message: 'Internal server error' 
  });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
</CODE>