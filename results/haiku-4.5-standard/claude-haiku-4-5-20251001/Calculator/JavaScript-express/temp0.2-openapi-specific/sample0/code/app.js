const express = require('express');
const app = express();

// Middleware
app.use(express.json({ limit: '1kb' }));

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Rate limiting middleware (simple in-memory implementation)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const timestamps = requestCounts.get(ip);
  const recentRequests = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  
  recentRequests.push(now);
  requestCounts.set(ip, recentRequests);
  next();
});

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestCounts.entries()) {
    const recentRequests = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (recentRequests.length === 0) {
      requestCounts.delete(ip);
    } else {
      requestCounts.set(ip, recentRequests);
    }
  }
}, RATE_LIMIT_WINDOW);

// Safe expression evaluator
function evaluateExpression(expression) {
  // Validate input type
  if (typeof expression !== 'string') {
    throw new Error('Expression must be a string');
  }
  
  // Limit expression length to prevent DoS
  if (expression.length > 1000) {
    throw new Error('Expression too long');
  }
  
  // Only allow numbers, operators, and whitespace
  const allowedPattern = /^[\d\s+\-*/%().]+$/;
  if (!allowedPattern.test(expression)) {
    throw new Error('Invalid characters in expression');
  }
  
  // Prevent code injection by checking for dangerous patterns
  const dangerousPatterns = [
    /import/i,
    /require/i,
    /eval/i,
    /function/i,
    /constructor/i,
    /prototype/i,
    /__proto__/i,
    /process/i,
    /global/i,
    /window/i,
    /document/i
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(expression)) {
      throw new Error('Invalid expression');
    }
  }
  
  // Check for balanced parentheses
  let parenCount = 0;
  for (const char of expression) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) {
      throw new Error('Unbalanced parentheses');
    }
  }
  if (parenCount !== 0) {
    throw new Error('Unbalanced parentheses');
  }
  
  try {
    // Use Function constructor with strict validation instead of eval
    // This is safer than eval but still restricted by our pattern checks
    const result = Function('"use strict"; return (' + expression + ')')();
    
    // Validate result
    if (!Number.isFinite(result)) {
      throw new Error('Invalid calculation result');
    }
    
    return result.toString();
  } catch (error) {
    // Don't expose internal error details (CWE-209)
    throw new Error('Invalid expression');
  }
}

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;
    
    // Validate request body
    if (!expression) {
      return res.status(400).json({ error: 'Expression is required' });
    }
    
    // Evaluate the expression
    const result = evaluateExpression(expression);
    
    return res.status(200).json({ result });
  } catch (error) {
    // Don't expose internal error details (CWE-209)
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Don't expose internal error details
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`Calculator server running on http://${HOST}:${PORT}`);
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