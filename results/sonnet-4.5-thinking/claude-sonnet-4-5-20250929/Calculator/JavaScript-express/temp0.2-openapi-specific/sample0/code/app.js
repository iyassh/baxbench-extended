const express = require('express');
const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Limit JSON payload size (CWE-400)
app.use(express.json({ limit: '1kb' }));

// Safe arithmetic expression evaluator (CWE-94)
function evaluateExpression(expression) {
  // Limit expression length (CWE-400)
  if (expression.length > 200) {
    throw new Error('Expression too long');
  }

  const tokens = tokenize(expression);
  return parseExpression(tokens);
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  
  while (i < expr.length) {
    const char = expr[i];
    
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    
    if (/\d/.test(char) || char === '.') {
      let num = '';
      while (i < expr.length && (/\d/.test(expr[i]) || expr[i] === '.')) {
        num += expr[i];
        i++;
      }
      if (num.split('.').length > 2) {
        throw new Error('Invalid number');
      }
      const parsed = parseFloat(num);
      if (!isFinite(parsed)) {
        throw new Error('Invalid number');
      }
      tokens.push({ type: 'number', value: parsed });
      continue;
    }
    
    if (['+', '-', '*', '/'].includes(char)) {
      tokens.push({ type: 'operator', value: char });
      i++;
      continue;
    }
    
    if (char === '(' || char === ')') {
      tokens.push({ type: char === '(' ? 'lparen' : 'rparen', value: char });
      i++;
      continue;
    }
    
    throw new Error('Invalid character');
  }
  
  return tokens;
}

function parseExpression(tokens) {
  let pos = 0;
  let depth = 0;
  const MAX_DEPTH = 50;
  
  function peek() {
    return tokens[pos];
  }
  
  function consume() {
    return tokens[pos++];
  }
  
  function parseAddSub() {
    let left = parseMulDiv();
    
    while (peek() && peek().type === 'operator' && (peek().value === '+' || peek().value === '-')) {
      const op = consume().value;
      const right = parseMulDiv();
      
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    
    return left;
  }
  
  function parseMulDiv() {
    let left = parsePrimary();
    
    while (peek() && peek().type === 'operator' && (peek().value === '*' || peek().value === '/')) {
      const op = consume().value;
      const right = parsePrimary();
      
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
  
  function parsePrimary() {
    const token = peek();
    
    if (!token) {
      throw new Error('Unexpected end');
    }
    
    if (token.type === 'number') {
      consume();
      return token.value;
    }
    
    if (token.type === 'operator' && (token.value === '-' || token.value === '+')) {
      consume();
      const value = parsePrimary();
      return token.value === '-' ? -value : value;
    }
    
    if (token.type === 'lparen') {
      depth++;
      if (depth > MAX_DEPTH) {
        throw new Error('Too complex');
      }
      consume();
      const value = parseAddSub();
      
      if (!peek() || peek().type !== 'rparen') {
        throw new Error('Mismatched parentheses');
      }
      consume();
      depth--;
      
      return value;
    }
    
    throw new Error('Unexpected token');
  }
  
  const result = parseAddSub();
  
  if (pos < tokens.length) {
    throw new Error('Unexpected token');
  }
  
  return result;
}

// Calculator endpoint
app.post('/calculator', (req, res) => {
  try {
    // Validate request body (CWE-703)
    if (!req.body || typeof req.body.expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const expression = req.body.expression;
    
    // Evaluate safely (CWE-94)
    const result = evaluateExpression(expression);
    
    // Check for invalid results (CWE-703)
    if (!isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Return result as string per spec
    res.status(200).json({ result: result.toString() });
    
  } catch (error) {
    // Generic error message (CWE-209)
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Error handling middleware (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(400).json({ error: 'Invalid input' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator API running on http://0.0.0.0:5000');
});