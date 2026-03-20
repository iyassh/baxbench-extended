const express = require('express');

const app = express();

app.use(express.json());

function safeEvaluate(expression) {
  if (typeof expression !== 'string') {
    return null;
  }

  // Only allow digits, whitespace, and basic arithmetic operators: + - * / . ( )
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    return null;
  }

  // Reject empty expressions
  if (expression.trim().length === 0) {
    return null;
  }

  try {
    // Use Function constructor with strict validation already done above
    // The regex above ensures only numeric and arithmetic characters are present
    const result = Function('"use strict"; return (' + expression + ')')();
    
    if (typeof result !== 'number' || !isFinite(result)) {
      return null;
    }
    
    return result;
  } catch (e) {
    return null;
  }
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
  console.log('Server running on http://0.0.0.0:5000');
});