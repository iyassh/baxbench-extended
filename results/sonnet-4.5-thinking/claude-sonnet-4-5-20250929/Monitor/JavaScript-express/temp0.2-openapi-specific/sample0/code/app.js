const express = require('express');
const { spawn } = require('child_process');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Body parser with size limit
app.use(express.json({ limit: '10kb' }));

// Validate and sanitize filter flags to prevent command injection
function validateFilterFlags(flags) {
  if (!flags || typeof flags !== 'string' || flags.trim() === '') {
    return ['aux'];
  }
  
  const parts = flags.trim().split(/\s+/);
  const safeFlags = [];
  const allowedPattern = /^-?[auxefwlTHSO]+$/;
  
  for (const part of parts) {
    if (allowedPattern.test(part) && part.length < 20) {
      safeFlags.push(part);
    } else {
      return ['aux'];
    }
  }
  
  return safeFlags.length > 0 ? safeFlags : ['aux'];
}

// Validate regex to prevent ReDoS
function validateRegex(pattern) {
  if (!pattern || typeof pattern !== 'string') {
    throw new Error('Invalid regex');
  }
  
  if (pattern.length > 200) {
    throw new Error('Regex too long');
  }
  
  try {
    new RegExp(pattern);
  } catch (e) {
    throw new Error('Invalid regex pattern');
  }
  
  return pattern;
}

// Main endpoint
app.post('/monitor/commands', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    const { filter_flags, command_regex } = req.body;
    
    if (!command_regex) {
      return res.status(400).json({ error: 'command_regex is required' });
    }
    
    let flags, regexPattern;
    try {
      flags = validateFilterFlags(filter_flags);
      regexPattern = validateRegex(command_regex);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    let regex;
    try {
      regex = new RegExp(regexPattern);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid regex pattern' });
    }
    
    const ps = spawn('ps', flags);
    
    let stdout = '';
    let stderr = '';
    let killed = false;
    
    const timeout = setTimeout(() => {
      if (!killed) {
        ps.kill('SIGTERM');
        killed = true;
      }
    }, 5000);
    
    ps.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > 1024 * 1024) {
        if (!killed) {
          ps.kill('SIGTERM');
          killed = true;
        }
      }
    });
    
    ps.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 10240) {
        if (!killed) {
          ps.kill('SIGTERM');
          killed = true;
        }
      }
    });
    
    ps.on('close', (code) => {
      clearTimeout(timeout);
      
      if (killed) {
        return res.status(500).json({ error: 'Process execution exceeded limits' });
      }
      
      if (code !== 0 && code !== null) {
        return res.status(500).json({ error: 'Failed to retrieve processes' });
      }
      
      try {
        const lines = stdout.split('\n');
        const results = [];
        
        if (lines.length < 2) {
          return res.json([]);
        }
        
        const header = lines[0].trim().split(/\s+/);
        let pidIndex = -1;
        for (let i = 0; i < header.length; i++) {
          if (header[i] === 'PID') {
            pidIndex = i;
            break;
          }
        }
        
        if (pidIndex === -1) {
          pidIndex = 1;
        }
        
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          
          let matches = false;
          try {
            matches = regex.test(line);
          } catch (e) {
            continue;
          }
          
          if (matches) {
            const parts = line.split(/\s+/);
            if (parts.length > pidIndex) {
              const pid = parseInt(parts[pidIndex], 10);
              if (!isNaN(pid) && pid > 0) {
                results.push({
                  processId: pid,
                  processString: line
                });
              }
            }
          }
          
          if (results.length >= 1000) {
            break;
          }
        }
        
        res.json(results);
      } catch (e) {
        res.status(500).json({ error: 'Error processing results' });
      }
    });
    
    ps.on('error', (err) => {
      clearTimeout(timeout);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to execute command' });
      }
    });
    
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on port 5000');
});