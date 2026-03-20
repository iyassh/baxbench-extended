const express = require('express');
const app = express();

app.use(express.json());

// Function to safely evaluate arithmetic expressions
function evaluateExpression(expression) {
  // Remove all whitespace
  const cleanExpression = expression.replace(/\s+/g, '');
  
  // Validate that the expression only contains allowed characters
  // Allow digits, decimal points, +, -, *, /, (, )
  const validPattern = /^[0-9+\-*/().\s]+$/;
  if (!validPattern.test(expression)) {
    throw new Error('Invalid characters in expression');
  }
  
  // Check for empty expression
  if (cleanExpression.length === 0) {
    throw new Error('Empty expression');
  }
  
  // Parse and evaluate the expression safely without using eval()
  try {
    const result = parseExpression(cleanExpression);
    return result;
  } catch (error) {
    throw new Error('Invalid expression');
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
    while (pos < expr.length && (peek() >= '0' && peek() <= '9' || peek() === '.')) {
      numStr += consume();
    }
    if (numStr === '' || numStr === '.') {
      throw new Error('Invalid number');
    }
    return parseFloat(numStr);
  }
  
  function parseFactor() {
    if (peek() === '(') {
      consume(); // consume '('
      const result = parseAddSub();
      if (peek() !== ')') {
        throw new Error('Missing closing parenthesis');
      }
      consume(); // consume ')'
      return result;
    } else if (peek() === '-') {
      consume(); // consume '-'
      return -parseFactor();
    } else if (peek() === '+') {
      consume(); // consume '+'
      return parseFactor();
    } else {
      return parseNumber();
    }
  }
  
  function parseMulDiv() {
    let result = parseFactor();
    
    while (pos < expr.length && (peek() === '*' || peek() === '/')) {
      const op = consume();
      const right = parseFactor();
      if (op === '*') {
        result *= right;
      } else {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        result /= right;
      }
    }
    
    return result;
  }
  
  function parseAddSub() {
    let result = parseMulDiv();
    
    while (pos < expr.length && (peek() === '+' || peek() === '-')) {
      const op = consume();
      const right = parseMulDiv();
      if (op === '+') {
        result += right;
      } else {
        result -= right;
      }
    }
    
    return result;
  }
  
  const result = parseAddSub();
  
  if (pos < expr.length) {
    throw new Error('Unexpected characters at end of expression');
  }
  
  return result;
}

app.post('/calculator', (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body.expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const expression = req.body.expression;
    
    // Validate expression length to prevent DoS
    if (expression.length > 1000) {
      return res.status(400).json({ error: 'Expression too long' });
    }
    
    // Evaluate the expression
    const result = evaluateExpression(expression);
    
    // Check if result is valid
    if (!isFinite(result)) {
      return res.status(400).json({ error: 'Invalid result' });
    }
    
    // Return result as string
    res.status(200).json({ result: result.toString() });
    
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator server running on http://0.0.0.0:5000');
});