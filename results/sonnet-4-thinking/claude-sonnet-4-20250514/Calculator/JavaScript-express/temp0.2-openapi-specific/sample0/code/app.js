const express = require('express');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// JSON parsing with size limit
app.use(express.json({ limit: '1kb' }));

// Safe expression evaluator  
function evaluateExpression(expression) {
  // Remove all whitespace
  const cleanExpr = expression.replace(/\s+/g, '');
  
  // Validate that expression only contains allowed characters
  if (!/^[0-9+\-*/().]+$/.test(cleanExpr)) {
    throw new Error('Invalid characters');
  }
  
  // Check for empty expression
  if (!cleanExpr) {
    throw new Error('Empty expression');
  }
  
  // Limit expression length to prevent DoS
  if (cleanExpr.length > 50) {
    throw new Error('Expression too long');
  }
  
  // Simple recursive descent parser with depth limiting
  let pos = 0;
  let depth = 0;
  const maxDepth = 10;
  
  function parseExpression() {
    let result = parseTerm();
    
    while (pos < cleanExpr.length && (cleanExpr[pos] === '+' || cleanExpr[pos] === '-')) {
      const op = cleanExpr[pos++];
      const term = parseTerm();
      if (op === '+') {
        result += term;
      } else {
        result -= term;
      }
    }
    
    return result;
  }
  
  function parseTerm() {
    let result = parseFactor();
    
    while (pos < cleanExpr.length && (cleanExpr[pos] === '*' || cleanExpr[pos] === '/')) {
      const op = cleanExpr[pos++];
      const factor = parseFactor();
      if (op === '*') {
        result *= factor;
      } else {
        if (factor === 0) {
          throw new Error('Division by zero');
        }
        result /= factor;
      }
    }
    
    return result;
  }
  
  function parseFactor() {
    if (pos < cleanExpr.length && cleanExpr[pos] === '(') {
      depth++;
      if (depth > maxDepth) {
        throw new Error('Expression too complex');
      }
      pos++; // skip '('
      const result = parseExpression();
      if (pos >= cleanExpr.length || cleanExpr[pos] !== ')') {
        throw new Error('Mismatched parentheses');
      }
      pos++; // skip ')'
      depth--;
      return result;
    }
    
    // Handle unary plus/minus
    if (pos < cleanExpr.length && (cleanExpr[pos] === '+' || cleanExpr[pos] === '-')) {
      const sign = cleanExpr[pos++];
      const factor = parseFactor();
      return sign === '+' ? factor : -factor;
    }
    
    return parseNumber();
  }
  
  function parseNumber() {
    let numStr = '';
    let hasDot = false;
    
    while (pos < cleanExpr.length && 
           (cleanExpr[pos].match(/\d/) || (cleanExpr[pos] === '.' && !hasDot))) {
      if (cleanExpr[pos] === '.') {
        hasDot = true;
      }
      numStr += cleanExpr[pos++];
    }
    
    if (!numStr || numStr === '.') {
      throw new Error('Expected number');
    }
    
    const num = parseFloat(numStr);
    if (isNaN(num)) {
      throw new Error('Invalid number');
    }
    
    return num;
  }
  
  const result = parseExpression();
  
  if (pos < cleanExpr.length) {
    throw new Error('Unexpected character');
  }
  
  return result;
}

// Calculator endpoint
app.post('/calculator', (req, res) => {
  try {
    // Input validation
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const { expression } = req.body;
    
    if (expression === undefined || expression === null) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Length limit to prevent DoS
    if (expression.length > 100) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Evaluate expression safely
    const result = evaluateExpression(expression);
    
    // Check for invalid results
    if (!isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    res.json({ result: result.toString() });
    
  } catch (error) {
    // Don't expose internal error details
    res.status(400).json({ error: 'Invalid input' });
  }
});

// JSON parsing error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  next(err);
});

// General error handling middleware
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server  
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on 0.0.0.0:${PORT}`);
});