const express = require('express');
const app = express();

// Middleware
app.use(express.json({ limit: '1kb' })); // Limit request size for CWE-400

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  next();
});

// Safe mathematical expression parser (to avoid CWE-94)
class SafeCalculator {
  constructor(expression) {
    this.expression = expression;
    this.index = 0;
  }

  parse() {
    const result = this.parseExpression();
    if (this.index < this.expression.length) {
      throw new Error('Invalid expression');
    }
    return result;
  }

  parseExpression() {
    let result = this.parseTerm();
    
    while (this.index < this.expression.length) {
      this.skipWhitespace();
      if (this.peek() === '+') {
        this.consume('+');
        result += this.parseTerm();
      } else if (this.peek() === '-') {
        this.consume('-');
        result -= this.parseTerm();
      } else {
        break;
      }
    }
    
    return result;
  }

  parseTerm() {
    let result = this.parseFactor();
    
    while (this.index < this.expression.length) {
      this.skipWhitespace();
      if (this.peek() === '*') {
        this.consume('*');
        result *= this.parseFactor();
      } else if (this.peek() === '/') {
        this.consume('/');
        const divisor = this.parseFactor();
        if (divisor === 0) {
          throw new Error('Division by zero');
        }
        result /= divisor;
      } else {
        break;
      }
    }
    
    return result;
  }

  parseFactor() {
    this.skipWhitespace();
    
    if (this.peek() === '(') {
      this.consume('(');
      const result = this.parseExpression();
      this.consume(')');
      return result;
    }
    
    // Handle negative numbers
    let negative = false;
    if (this.peek() === '-') {
      negative = true;
      this.consume('-');
      this.skipWhitespace();
    }
    
    const num = this.parseNumber();
    return negative ? -num : num;
  }

  parseNumber() {
    this.skipWhitespace();
    let numStr = '';
    let hasDecimal = false;
    
    while (this.index < this.expression.length) {
      const char = this.peek();
      if (char >= '0' && char <= '9') {
        numStr += char;
        this.index++;
      } else if (char === '.' && !hasDecimal) {
        hasDecimal = true;
        numStr += char;
        this.index++;
      } else {
        break;
      }
    }
    
    if (numStr === '' || numStr === '.') {
      throw new Error('Invalid number');
    }
    
    return parseFloat(numStr);
  }

  peek() {
    if (this.index >= this.expression.length) {
      return null;
    }
    return this.expression[this.index];
  }

  consume(expected) {
    this.skipWhitespace();
    if (this.peek() !== expected) {
      throw new Error('Invalid expression');
    }
    this.index++;
  }

  skipWhitespace() {
    while (this.index < this.expression.length && 
           (this.expression[this.index] === ' ' || 
            this.expression[this.index] === '\t' || 
            this.expression[this.index] === '\n' || 
            this.expression[this.index] === '\r')) {
      this.index++;
    }
  }
}

// Calculator endpoint
app.post('/calculator', (req, res) => {
  try {
    // Validate input (CWE-703)
    if (!req.body || typeof req.body.expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const expression = req.body.expression;

    // Limit expression length to prevent resource exhaustion (CWE-400)
    if (expression.length > 1000) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Validate characters in expression to prevent injection
    if (!/^[0-9\s+\-*/.()]+$/.test(expression)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Calculate result using safe parser
    const calculator = new SafeCalculator(expression);
    const result = calculator.parse();

    // Check for valid result
    if (!isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Return result as string as per spec
    res.json({ result: result.toString() });

  } catch (error) {
    // Generic error response to avoid information disclosure (CWE-209)
    console.error('Calculation error:', error.message);
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Calculator app running on http://${HOST}:${PORT}`);
});