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

// Body parser with size limit to prevent resource exhaustion
app.use(express.json({ limit: '1kb' }));

// Request timeout to prevent resource exhaustion
app.use((req, res, next) => {
  req.setTimeout(5000, () => {
    res.status(408).json({ error: 'Request timeout' });
  });
  res.setTimeout(5000, () => {
    res.status(408).json({ error: 'Response timeout' });
  });
  next();
});

// Safe expression evaluator that doesn't use eval()
function calculateExpression(expression) {
  // Validate input
  if (typeof expression !== 'string') {
    throw new Error('Invalid input type');
  }
  
  // Limit expression length to prevent resource exhaustion
  if (expression.length > 100) {
    throw new Error('Expression too long');
  }
  
  // Remove all whitespace
  const cleanExpression = expression.replace(/\s+/g, '');
  
  // Validate that expression only contains allowed characters
  const allowedPattern = /^[0-9+\-*/(). ]+$/;
  if (!allowedPattern.test(expression)) {
    throw new Error('Invalid characters in expression');
  }
  
  // Check for balanced parentheses
  let parenCount = 0;
  for (let char of cleanExpression) {
    if (char === '(') parenCount++;
    if (char === ')') parenCount--;
    if (parenCount < 0) throw new Error('Unbalanced parentheses');
  }
  if (parenCount !== 0) throw new Error('Unbalanced parentheses');
  
  // Limit number of operations to prevent resource exhaustion
  const operatorCount = (cleanExpression.match(/[+\-*/]/g) || []).length;
  if (operatorCount > 50) {
    throw new Error('Too many operations');
  }
  
  // Parse and evaluate using a safe parser
  return evaluateSafely(cleanExpression);
}

function evaluateSafely(expr) {
  // Tokenize
  const tokens = tokenize(expr);
  
  // Parse and evaluate
  let index = 0;
  
  function parseExpression() {
    let left = parseTerm();
    
    while (index < tokens.length && (tokens[index] === '+' || tokens[index] === '-')) {
      const op = tokens[index++];
      const right = parseTerm();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    
    return left;
  }
  
  function parseTerm() {
    let left = parseFactor();
    
    while (index < tokens.length && (tokens[index] === '*' || tokens[index] === '/')) {
      const op = tokens[index++];
      const right = parseFactor();
      if (op === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        left = left / right;
      }
    }
    
    return left;
  }
  
  function parseFactor() {
    if (tokens[index] === '(') {
      index++; // skip '('
      const result = parseExpression();
      if (tokens[index] !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      index++; // skip ')'
      return result;
    }
    
    if (tokens[index] === '-') {
      index++;
      return -parseFactor();
    }
    
    if (tokens[index] === '+') {
      index++;
      return parseFactor();
    }
    
    const token = tokens[index++];
    const num = parseFloat(token);
    if (isNaN(num)) {
      throw new Error('Invalid number');
    }
    
    // Check for overflow
    if (!isFinite(num)) {
      throw new Error('Number overflow');
    }
    
    return num;
  }
  
  const result = parseExpression();
  
  if (index !== tokens.length) {
    throw new Error('Unexpected tokens at end of expression');
  }
  
  // Check result for overflow
  if (!isFinite(result)) {
    throw new Error('Result overflow');
  }
  
  return result;
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  
  while (i < expr.length) {
    const char = expr[i];
    
    if (char >= '0' && char <= '9' || char === '.') {
      let num = '';
      while (i < expr.length && (expr[i] >= '0' && expr[i] <= '9' || expr[i] === '.')) {
        num += expr[i++];
      }
      tokens.push(num);
    } else if (char === '+' || char === '-' || char === '*' || char === '/' || char === '(' || char === ')') {
      tokens.push(char);
      i++;
    } else {
      throw new Error('Invalid character');
    }
  }
  
  return tokens;
}

app.post('/calculator', (req, res) => {
  try {
    // Validate request body exists
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    
    const { expression } = req.body;
    
    // Validate expression exists
    if (expression === undefined || expression === null) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Calculate result
    const result = calculateExpression(expression);
    
    // Return result as string
    res.status(200).json({ result: String(result) });
    
  } catch (error) {
    // Generic error message to avoid information disclosure
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Handle invalid JSON
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  next();
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  // Log error internally but don't expose details
  console.error('Internal error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator server running on http://0.0.0.0:5000');
});