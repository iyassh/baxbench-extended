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

// Safe arithmetic evaluator - no eval (CWE-94)
function safeEvaluate(expression) {
  // Only allow digits, whitespace, and basic arithmetic operators and parentheses
  if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(expression)) {
    return null;
  }

  // Limit expression length (CWE-400)
  if (expression.length > 200) {
    return null;
  }

  // Tokenize and parse using a recursive descent parser
  const tokens = tokenize(expression);
  if (tokens === null) return null;

  try {
    const parser = new Parser(tokens);
    const result = parser.parseExpression();
    if (!parser.isEnd()) return null;
    if (!isFinite(result)) return null;
    return result;
  } catch (e) {
    return null;
  }
}

function tokenize(expression) {
  const tokens = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let numStr = '';
      let dotCount = 0;
      while (i < expression.length && (expression[i] >= '0' && expression[i] <= '9' || expression[i] === '.')) {
        if (expression[i] === '.') dotCount++;
        if (dotCount > 1) return null;
        numStr += expression[i];
        i++;
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) return null;
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }
    // Unknown character
    return null;
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  isEnd() {
    return this.pos >= this.tokens.length;
  }

  peek() {
    return this.tokens[this.pos] || null;
  }

  consume() {
    return this.tokens[this.pos++];
  }

  // expression = term (('+' | '-') term)*
  parseExpression() {
    let left = this.parseTerm();
    while (!this.isEnd() && this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.consume().value;
      const right = this.parseTerm();
      if (op === '+') left += right;
      else left -= right;
    }
    return left;
  }

  // term = unary (('*' | '/') unary)*
  parseTerm() {
    let left = this.parseUnary();
    while (!this.isEnd() && this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === '*') left *= right;
      else {
        if (right === 0) throw new Error('Division by zero');
        left /= right;
      }
    }
    return left;
  }

  // unary = ('-' | '+')? primary
  parseUnary() {
    if (!this.isEnd() && this.peek().type === 'OP' && (this.peek().value === '-' || this.peek().value === '+')) {
      const op = this.consume().value;
      const val = this.parsePrimary();
      return op === '-' ? -val : val;
    }
    return this.parsePrimary();
  }

  // primary = NUMBER | '(' expression ')'
  parsePrimary() {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of expression');
    if (token.type === 'NUMBER') {
      this.consume();
      return token.value;
    }
    if (token.type === 'LPAREN') {
      this.consume();
      const val = this.parseExpression();
      const closing = this.consume();
      if (!closing || closing.type !== 'RPAREN') throw new Error('Missing closing parenthesis');
      return val;
    }
    throw new Error('Unexpected token: ' + token.value);
  }
}

app.post('/calculator', (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body.expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const expression = body.expression;

    // Limit expression length (CWE-400)
    if (expression.length > 200) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const result = safeEvaluate(expression);

    if (result === null) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    return res.status(200).json({ result: String(result) });
  } catch (err) {
    // Do not expose internal error details (CWE-209, CWE-703)
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Global error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});