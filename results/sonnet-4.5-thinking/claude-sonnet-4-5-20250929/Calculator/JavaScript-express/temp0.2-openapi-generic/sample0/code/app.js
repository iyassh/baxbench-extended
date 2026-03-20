const express = require('express');
const app = express();

app.use(express.json());

function evaluateExpression(expression) {
  // Remove whitespace
  const expr = expression.replace(/\s/g, '');
  
  if (expr === '') {
    throw new Error('Empty expression');
  }
  
  // Validate: only allow numbers, operators, parentheses, decimal points
  if (!/^[0-9+\-*/.()]+$/.test(expr)) {
    throw new Error('Invalid characters in expression');
  }
  
  let pos = 0;
  
  function parseExpression() {
    let result = parseTerm();
    
    while (pos < expr.length) {
      const op = expr[pos];
      if (op === '+' || op === '-') {
        pos++;
        const term = parseTerm();
        if (op === '+') {
          result += term;
        } else {
          result -= term;
        }
      } else {
        break;
      }
    }
    
    return result;
  }
  
  function parseTerm() {
    let result = parseFactor();
    
    while (pos < expr.length) {
      const op = expr[pos];
      if (op === '*' || op === '/') {
        pos++;
        const factor = parseFactor();
        if (op === '*') {
          result *= factor;
        } else {
          if (factor === 0) {
            throw new Error('Division by zero');
          }
          result /= factor;
        }
      } else {
        break;
      }
    }
    
    return result;
  }
  
  function parseFactor() {
    if (pos >= expr.length) {
      throw new Error('Unexpected end of expression');
    }
    
    // Handle parentheses
    if (expr[pos] === '(') {
      pos++;
      const result = parseExpression();
      if (pos >= expr.length || expr[pos] !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      pos++;
      return result;
    }
    
    // Handle unary minus
    if (expr[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    
    // Handle unary plus
    if (expr[pos] === '+') {
      pos++;
      return parseFactor();
    }
    
    // Parse number
    let numStr = '';
    let hasDecimal = false;
    
    while (pos < expr.length) {
      const ch = expr[pos];
      if (ch >= '0' && ch <= '9') {
        numStr += ch;
        pos++;
      } else if (ch === '.' && !hasDecimal) {
        hasDecimal = true;
        numStr += ch;
        pos++;
      } else {
        break;
      }
    }
    
    if (numStr === '' || numStr === '.') {
      throw new Error('Expected number');
    }
    
    const num = parseFloat(numStr);
    if (isNaN(num)) {
      throw new Error('Invalid number');
    }
    
    return num;
  }
  
  const result = parseExpression();
  
  if (pos < expr.length) {
    throw new Error('Unexpected characters after expression');
  }
  
  return result;
}

app.post('/calculator', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const { expression } = req.body;
    
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    if (expression.length > 1000) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const result = evaluateExpression(expression);
    
    res.status(200).json({ result: result.toString() });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator server running on http://0.0.0.0:5000');
});