'use strict';

const express = require('express');

const app = express();

// Security headers (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Limit request body size to prevent resource exhaustion (CWE-400)
app.use(express.json({ limit: '1kb' }));

// Safe math expression evaluator (CWE-94: no eval)
function safeEvaluate(expression) {
  // Only allow digits, whitespace, and basic arithmetic operators and parentheses
  if (typeof expression !== 'string') {
    return null;
  }

  // Limit expression length (CWE-400)
  if (expression.length > 200) {
    return null;
  }

  // Validate: only allow numbers, operators (+, -, *, /), parentheses, dots, and whitespace
  if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(expression)) {
    return null;
  }

  // Parse and evaluate safely using a recursive descent parser
  try {
    const result = parseExpression(expression.replace(/\s+/g, ''));
    if (result === null || !isFinite(result)) {
      return null;
    }
    return result;
  } catch (e) {
    return null;
  }
}

// Recursive descent parser for arithmetic expressions
function parseExpression(expr) {
  let pos = 0;

  function peek() {
    return expr[pos];
  }

  function consume() {
    return expr[pos++];
  }

  function parseNumber() {
    let numStr = '';
    if (peek() === '-') {
      numStr += consume();
    }
    while (pos < expr.length && /[\d\.]/.test(peek())) {
      numStr += consume();
    }
    if (numStr === '' || numStr === '-') {
      throw new Error('Invalid number');
    }
    const num = parseFloat(numStr);
    if (isNaN(num)) {
      throw new Error('Invalid number');
    }
    return num;
  }

  function parsePrimary() {
    if (peek() === '(') {
      consume(); // '('
      const val = parseAddSub();
      if (peek() !== ')') {
        throw new Error('Expected closing parenthesis');
      }
      consume(); // ')'
      return val;
    } else if (peek() === '-' || /\d/.test(peek()) || peek() === '.') {
      return parseNumber();
    } else {
      throw new Error('Unexpected character: ' + peek());
    }
  }

  function parseMulDiv() {
    let left = parsePrimary();
    while (pos < expr.length && (peek() === '*' || peek() === '/')) {
      const op = consume();
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

  function parseAddSub() {
    let left = parseMulDiv();
    while (pos < expr.length && (peek() === '+' || peek() === '-')) {
      const op = consume();
      const right = parseMulDiv();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }
    return left;
  }

  const result = parseAddSub();
  if (pos !== expr.length) {
    throw new Error('Unexpected characters at position ' + pos);
  }
  return result;
}

app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;

    if (expression === undefined || expression === null) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const result = safeEvaluate(expression);

    if (result === null) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    return res.status(200).json({ result: String(result) });
  } catch (err) {
    // CWE-209: Do not expose internal error details
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// Handle unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});