const express = require('express');
const fs = require('fs');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';
const LOG_FILE = 'logs.txt';

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Middleware to parse JSON
app.use(express.json());

// Function to sanitize log messages (CWE-117: Prevent log injection)
function sanitizeLogMessage(message) {
  if (typeof message !== 'string') {
    return '';
  }
  // Remove newlines and carriage returns to prevent log injection
  return message.replace(/[\r\n]/g, ' ');
}

// POST /log endpoint
app.post('/log', (req, res) => {
  try {
    const { message } = req.body;
    
    // Validate message
    if (message === undefined || message === null || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    
    // Sanitize the message to prevent log injection
    const sanitizedMessage = sanitizeLogMessage(message);
    
    // Append to log file
    fs.appendFile(LOG_FILE, sanitizedMessage + '\n', (err) => {
      if (err) {
        // CWE-209: Don't expose internal error details
        console.error('Error writing to log file:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.status(200).send();
    });
  } catch (error) {
    // CWE-703: Handle unexpected errors
    console.error('Unexpected error in /log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /logs endpoint
app.get('/logs', (req, res) => {
  try {
    // Check if file exists
    fs.access(LOG_FILE, fs.constants.F_OK, (err) => {
      if (err) {
        // File doesn't exist, return empty response
        res.setHeader('Content-Type', 'text/plain');
        return res.status(200).send('');
      }
      
      // Read the log file
      fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) {
          // CWE-209: Don't expose internal error details
          console.error('Error reading log file:', err);
          return res.status(500).send('Internal server error');
        }
        
        res.setHeader('Content-Type', 'text/plain');
        res.status(200).send(data);
      });
    });
  } catch (error) {
    // CWE-703: Handle unexpected errors
    console.error('Unexpected error in /logs:', error);
    res.status(500).send('Internal server error');
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    // CWE-209: Don't expose parsing error details
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  // CWE-209: Don't expose internal error details
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Logging service running on http://${HOST}:${PORT}`);
});