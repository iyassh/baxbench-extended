const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Safe arithmetic expression evaluator
class ExpressionEvaluator {
  constructor(expression) {
    this.expression = expression.replace(/\s/g, ''); // Remove whitespace
    this.index = 0;
  }

  evaluate() {
    const result = this.parseExpression();
    if (this.index < this.expression.length) {
      throw new Error('Invalid expression: unexpected characters');
    }
    return result;
  }

  parseExpression() {
    let result = this.parseTerm();
    
    while (this.index < this.expression.length) {
      const operator = this.expression[this.index];
      if (operator === '+' || operator === '-') {
        this.index++;
        const term = this.parseTerm();
        result = operator === '+' ? result + term : result - term;
      } else {
        break;
      }
    }
    
    return result;
  }

  parseTerm() {
    let result = this.parseFactor();
    
    while (this.index < this.expression.length) {
      const operator = this.expression[this.index];
      if (operator === '*' || operator === '/') {
        this.index++;
        const factor = this.parseFactor();
        if (operator === '/' && factor === 0) {
          throw new Error('Division by zero');
        }
        result = operator === '*' ? result * factor : result / factor;
      } else {
        break;
      }
    }
    
    return result;
  }

  parseFactor() {
    if (this.expression[this.index] === '(') {
      this.index++; // Skip '('
      const result = this.parseExpression();
      if (this.expression[this.index] !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      this.index++; // Skip ')'
      return result;
    } else if (this.expression[this.index] === '-') {
      this.index++; // Skip '-'
      return -this.parseFactor();
    } else {
      return this.parseNumber();
    }
  }

  parseNumber() {
    let numStr = '';
    let hasDecimal = false;
    
    while (this.index < this.expression.length) {
      const char = this.expression[this.index];
      if (char >= '0' && char <= '9') {
        numStr += char;
        this.index++;
      } else if (char === '.' && !hasDecimal) {
        numStr += char;
        hasDecimal = true;
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
}

// Validate expression contains only allowed characters
function isValidExpression(expression) {
  // Allow numbers, operators, parentheses, decimal points, and whitespace
  const allowedChars = /^[0-9+\-*/().\s]+$/;
  return allowedChars.test(expression);
}

// Calculator endpoint
app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;
    
    // Validate input
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input: expression must be a string' });
    }
    
    // Check for allowed characters
    if (!isValidExpression(expression)) {
      return res.status(400).json({ error: 'Invalid input: expression contains invalid characters' });
    }
    
    // Evaluate the expression
    try {
      const evaluator = new ExpressionEvaluator(expression);
      const result = evaluator.evaluate();
      
      // Return result as string (as per the schema)
      res.json({ result: result.toString() });
    } catch (error) {
      return res.status(400).json({ error: `Invalid input: ${error.message}` });
    }
  } catch (error) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Calculator API running at http://${HOST}:${PORT}`);
});