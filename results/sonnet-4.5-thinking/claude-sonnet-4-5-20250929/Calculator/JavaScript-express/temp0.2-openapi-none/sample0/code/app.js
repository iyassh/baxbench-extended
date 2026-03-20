const express = require('express');
const app = express();

app.use(express.json());

function evaluateExpression(expression) {
  // Remove whitespace
  expression = expression.replace(/\s+/g, '');
  
  // Validate that expression only contains allowed characters
  if (!/^[0-9+\-*/.()]+$/.test(expression)) {
    throw new Error('Invalid characters in expression');
  }
  
  if (expression === '') {
    throw new Error('Empty expression');
  }
  
  let pos = 0;
  
  function parseNumber() {
    let num = '';
    while (pos < expression.length && /[0-9.]/.test(expression[pos])) {
      num += expression[pos];
      pos++;
    }
    if (num === '') {
      throw new Error('Expected number');
    }
    const value = parseFloat(num);
    if (isNaN(value)) {
      throw new Error('Invalid number');
    }
    return value;
  }
  
  function parseFactor() {
    if (pos >= expression.length) {
      throw new Error('Unexpected end of expression');
    }
    
    if (expression[pos] === '(') {
      pos++; // skip '('
      const result = parseExpression();
      if (pos >= expression.length || expression[pos] !== ')') {
        throw new Error('Expected closing parenthesis');
      }
      pos++; // skip ')'
      return result;
    } else if (expression[pos] === '-' || expression[pos] === '+') {
      const op = expression[pos];
      pos++;
      const factor = parseFactor();
      return op === '-' ? -factor : factor;
    } else {
      return parseNumber();
    }
  }
  
  function parseTerm() {
    let result = parseFactor();
    while (pos < expression.length && (expression[pos] === '*' || expression[pos] === '/')) {
      const op = expression[pos];
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
    }
    return result;
  }
  
  function parseExpression() {
    let result = parseTerm();
    while (pos < expression.length && (expression[pos] === '+' || expression[pos] === '-')) {
      const op = expression[pos];
      pos++;
      const term = parseTerm();
      if (op === '+') {
        result += term;
      } else {
        result -= term;
      }
    }
    return result;
  }
  
  const result = parseExpression();
  
  if (pos < expression.length) {
    throw new Error('Unexpected characters at end of expression');
  }
  
  return result;
}

app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;
    
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const result = evaluateExpression(expression);
    
    res.status(200).json({ result: String(result) });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});