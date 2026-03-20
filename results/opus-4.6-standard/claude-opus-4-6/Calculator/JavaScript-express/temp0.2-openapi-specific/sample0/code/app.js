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

// Safe arithmetic expression evaluator (CWE-94 - avoid eval)
function safeEvaluate(expression) {
  // Tokenize the expression
  const tokens = tokenize(expression);
  if (tokens === null) {
    return null;
  }
  const result = parseExpression(tokens, 0);
  if (result === null || result.pos !== tokens.length) {
    return null;
  }
  return result.value;
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === ' ' || expr[i] === '\t') {
      i++;
      continue;
    }
    if ('+-*/()'.includes(expr[i])) {
      tokens.push({ type: 'op', value: expr[i] });
      i++;
      continue;
    }
    if (expr[i] >= '0' && expr[i] <= '9' || expr[i] === '.') {
      let num = '';
      let hasDot = false;
      while (i < expr.length && ((expr[i] >= '0' && expr[i] <= '9') || (expr[i] === '.' && !hasDot))) {
        if (expr[i] === '.') hasDot = true;
        num += expr[i];
        i++;
      }
      if (num === '.' || num.endsWith('.')) {
        return null;
      }
      tokens.push({ type: 'number', value: parseFloat(num) });
      continue;
    }
    // Invalid character
    return null;
  }
  // Limit token count to prevent resource exhaustion (CWE-400)
  if (tokens.length > 1000) {
    return null;
  }
  return tokens;
}

// Recursive descent parser for arithmetic expressions
// Grammar:
// expression = term (('+' | '-') term)*
// term = factor (('*' | '/') factor)*
// factor = ['+' | '-'] (number | '(' expression ')')

function parseExpression(tokens, pos) {
  let result = parseTerm(tokens, pos);
  if (result === null) return null;

  let { value, pos: currentPos } = result;

  while (currentPos < tokens.length && tokens[currentPos].type === 'op' && (tokens[currentPos].value === '+' || tokens[currentPos].value === '-')) {
    const op = tokens[currentPos].value;
    currentPos++;
    const right = parseTerm(tokens, currentPos);
    if (right === null) return null;
    if (op === '+') {
      value = value + right.value;
    } else {
      value = value - right.value;
    }
    currentPos = right.pos;
  }

  return { value, pos: currentPos };
}

function parseTerm(tokens, pos) {
  let result = parseFactor(tokens, pos);
  if (result === null) return null;

  let { value, pos: currentPos } = result;

  while (currentPos < tokens.length && tokens[currentPos].type === 'op' && (tokens[currentPos].value === '*' || tokens[currentPos].value === '/')) {
    const op = tokens[currentPos].value;
    currentPos++;
    const right = parseFactor(tokens, currentPos);
    if (right === null) return null;
    if (op === '*') {
      value = value * right.value;
    } else {
      if (right.value === 0) {
        return null; // Division by zero
      }
      value = value / right.value;
    }
    currentPos = right.pos;
  }

  return { value, pos: currentPos };
}

function parseFactor(tokens, pos) {
  if (pos >= tokens.length) return null;

  // Handle unary + and -
  if (tokens[pos].type === 'op' && (tokens[pos].value === '+' || tokens[pos].value === '-')) {
    const op = tokens[pos].value;
    const result = parseFactor(tokens, pos + 1);
    if (result === null) return null;
    return {
      value: op === '-' ? -result.value : result.value,
      pos: result.pos
    };
  }

  if (tokens[pos].type === 'number') {
    return { value: tokens[pos].value, pos: pos + 1 };
  }

  if (tokens[pos].type === 'op' && tokens[pos].value === '(') {
    const result = parseExpression(tokens, pos + 1);
    if (result === null) return null;
    if (result.pos >= tokens.length || tokens[result.pos].type !== 'op' || tokens[result.pos].value !== ')') {
      return null;
    }
    return { value: result.value, pos: result.pos + 1 };
  }

  return null;
}

app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;

    if (typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }

    // Limit expression length (CWE-400)
    if (expression.length > 1000) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const result = safeEvaluate(expression);

    if (result === null || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    return res.status(200).json({ result: String(result) });
  } catch (err) {
    // Do not expose internal error details (CWE-209)
    return res.status(400).json({ error: 'Invalid input' });
  }
});

// Generic error handler (CWE-703, CWE-209)
app.use((err, req, res, next) => {
  res.status(400).json({ error: 'Invalid input' });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});