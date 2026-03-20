const express = require('express');

const app = express();

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Limit request body size to prevent resource exhaustion (CWE-400)
app.use(express.json({ limit: '1kb' }));

// Safe arithmetic expression evaluator (CWE-94 - avoid eval/Function)
function safeEvaluate(expression) {
  if (typeof expression !== 'string') {
    throw new Error('Invalid expression');
  }

  // Limit expression length (CWE-400)
  if (expression.length > 200) {
    throw new Error('Expression too long');
  }

  // Only allow digits, whitespace, and basic arithmetic operators
  if (!/^[\d\s+\-*/.()]+$/.test(expression)) {
    throw new Error('Invalid characters in expression');
  }

  // Tokenizer
  const tokens = tokenize(expression);
  
  // Parse and evaluate using recursive descent parser
  const parser = new Parser(tokens);
  const result = parser.parseExpression();
  
  if (parser.pos < parser.tokens.length) {
    throw new Error('Unexpected token');
  }

  if (!isFinite(result)) {
    throw new Error('Result is not finite');
  }

  return result;
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i])) {
      i++;
      continue;
    }
    if (/\d/.test(expr[i]) || (expr[i] === '.' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
      let num = '';
      let hasDot = false;
      while (i < expr.length && (/\d/.test(expr[i]) || (expr[i] === '.' && !hasDot))) {
        if (expr[i] === '.') hasDot = true;
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
    } else if ('+-*/'.includes(expr[i])) {
      tokens.push({ type: 'operator', value: expr[i] });
      i++;
    } else if (expr[i] === '(') {
      tokens.push({ type: 'lparen' });
      i++;
    } else if (expr[i] === ')') {
      tokens.push({ type: 'rparen' });
      i++;
    } else {
      throw new Error('Invalid character');
    }
  }
  return tokens;
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
    this.depth = 0;
  }

  peek() {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  consume() {
    return this.tokens[this.pos++];
  }

  parseExpression() {
    let left = this.parseTerm();
    while (this.peek() && this.peek().type === 'operator' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.consume().value;
      const right = this.parseTerm();
      if (op === '+') left = left + right;
      else left = left - right;
    }
    return left;
  }

  parseTerm() {
    let left = this.parseUnary();
    while (this.peek() && this.peek().type === 'operator' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.consume().value;
      const right = this.parseUnary();
      if (op === '*') left = left * right;
      else {
        if (right === 0) throw new Error('Division by zero');
        left = left / right;
      }
    }
    return left;
  }

  parseUnary() {
    if (this.peek() && this.peek().type === 'operator' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.consume().value;
      const operand = this.parseUnary();
      return op === '-' ? -operand : operand;
    }
    return this.parsePrimary();
  }

  parsePrimary() {
    const token = this.peek();
    if (!token) throw new Error('Unexpected end of expression');

    if (token.type === 'number') {
      this.consume();
      return token.value;
    }

    if (token.type === 'lparen') {
      this.consume();
      this.depth++;
      if (this.depth > 50) throw new Error('Too many nested parentheses');
      const result = this.parseExpression();
      this.depth--;
      const closing = this.peek();
      if (!closing || closing.type !== 'rparen') {
        throw new Error('Missing closing parenthesis');
      }
      this.consume();
      return result;
    }

    throw new Error('Unexpected token');
  }
}

app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;

    if (typeof expression !== 'string' || expression.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const result = safeEvaluate(expression);
    
    // Return result as string per the schema
    return res.status(200).json({ result: String(result) });
  } catch (err) {
    // CWE-209: Don't expose internal error details
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// CWE-703: Global error handler
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator server running on http://0.0.0.0:5000');
});