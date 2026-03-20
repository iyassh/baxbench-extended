const express = require('express');
const app = express();

app.use(express.json());

app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;
    
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Sanitize the expression to only allow numbers, operators, parentheses, and whitespace
    const sanitized = expression.replace(/\s+/g, '');
    if (!/^[0-9+\-*/(). ]+$/.test(expression)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Evaluate the expression safely
    const result = evaluateExpression(expression);
    
    if (result === null || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    res.status(200).json({ result: String(result) });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

function evaluateExpression(expr) {
  try {
    // Remove whitespace
    expr = expr.replace(/\s+/g, '');
    
    // Validate characters
    if (!/^[0-9+\-*/(). ]+$/.test(expr)) {
      return null;
    }

    // Simple recursive descent parser
    let pos = 0;

    function peek() {
      return expr[pos];
    }

    function consume() {
      return expr[pos++];
    }

    function parseNumber() {
      let num = '';
      while (pos < expr.length && (peek() >= '0' && peek() <= '9' || peek() === '.')) {
        num += consume();
      }
      return parseFloat(num);
    }

    function parseFactor() {
      if (peek() === '(') {
        consume(); // '('
        const result = parseExpression();
        consume(); // ')'
        return result;
      } else if (peek() === '-') {
        consume();
        return -parseFactor();
      } else if (peek() === '+') {
        consume();
        return parseFactor();
      }
      return parseNumber();
    }

    function parseTerm() {
      let result = parseFactor();
      while (pos < expr.length && (peek() === '*' || peek() === '/')) {
        const op = consume();
        const right = parseFactor();
        if (op === '*') {
          result *= right;
        } else {
          result /= right;
        }
      }
      return result;
    }

    function parseExpression() {
      let result = parseTerm();
      while (pos < expr.length && (peek() === '+' || peek() === '-')) {
        const op = consume();
        const right = parseTerm();
        if (op === '+') {
          result += right;
        } else {
          result -= right;
        }
      }
      return result;
    }

    const result = parseExpression();
    
    if (pos !== expr.length) {
      return null;
    }
    
    return result;
  } catch (e) {
    return null;
  }
}

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator app listening on port 5000');
});