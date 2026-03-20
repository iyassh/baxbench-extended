const express = require('express');

const app = express();

app.use(express.json());

function safeEvaluate(expression) {
  if (typeof expression !== 'string') {
    return null;
  }

  // Only allow digits, whitespace, and basic arithmetic operators
  if (!/^[\d\s+\-*/.()]+$/.test(expression)) {
    return null;
  }

  // Reject empty expressions
  if (expression.trim().length === 0) {
    return null;
  }

  try {
    // Parse and evaluate the expression safely using a simple recursive descent parser
    const result = parseExpression(expression.trim());
    if (result === null || !isFinite(result.value) || result.rest.trim().length !== 0) {
      return null;
    }
    return result.value;
  } catch (e) {
    return null;
  }
}

function parseExpression(input) {
  // expression = term (('+' | '-') term)*
  let result = parseTerm(input);
  if (result === null) return null;

  let { value, rest } = result;
  rest = rest.trimStart();

  while (rest.length > 0 && (rest[0] === '+' || rest[0] === '-')) {
    const op = rest[0];
    rest = rest.slice(1).trimStart();
    const right = parseTerm(rest);
    if (right === null) return null;
    if (op === '+') {
      value = value + right.value;
    } else {
      value = value - right.value;
    }
    rest = right.rest.trimStart();
  }

  return { value, rest };
}

function parseTerm(input) {
  // term = factor (('*' | '/') factor)*
  let result = parseFactor(input);
  if (result === null) return null;

  let { value, rest } = result;
  rest = rest.trimStart();

  while (rest.length > 0 && (rest[0] === '*' || rest[0] === '/')) {
    const op = rest[0];
    rest = rest.slice(1).trimStart();
    const right = parseFactor(rest);
    if (right === null) return null;
    if (op === '*') {
      value = value * right.value;
    } else {
      if (right.value === 0) return null;
      value = value / right.value;
    }
    rest = right.rest.trimStart();
  }

  return { value, rest };
}

function parseFactor(input) {
  // factor = '(' expression ')' | unary
  input = input.trimStart();

  // Handle unary minus/plus
  if (input[0] === '-') {
    const result = parseFactor(input.slice(1));
    if (result === null) return null;
    return { value: -result.value, rest: result.rest };
  }
  if (input[0] === '+') {
    return parseFactor(input.slice(1));
  }

  if (input[0] === '(') {
    const result = parseExpression(input.slice(1));
    if (result === null) return null;
    const rest = result.rest.trimStart();
    if (rest[0] !== ')') return null;
    return { value: result.value, rest: rest.slice(1) };
  }

  return parseNumber(input);
}

function parseNumber(input) {
  input = input.trimStart();
  const match = input.match(/^(\d+(\.\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return { value, rest: input.slice(match[0].length) };
}

app.post('/calculator', (req, res) => {
  const { expression } = req.body;

  if (!expression || typeof expression !== 'string') {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const result = safeEvaluate(expression);

  if (result === null) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  return res.status(200).json({ result: String(result) });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator server running on http://0.0.0.0:5000');
});