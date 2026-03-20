const express = require('express');

const app = express();

app.use(express.json());

app.post('/calculator', (req, res) => {
  const { expression } = req.body;

  if (!expression || typeof expression !== 'string') {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Validate the expression: only allow digits, spaces, and basic arithmetic operators
  const sanitized = expression.trim();
  if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(sanitized)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Additional check: prevent empty expression
  if (sanitized.length === 0) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  try {
    // Use Function constructor to evaluate the arithmetic expression safely
    // We've already validated the expression contains only safe characters
    const result = Function('"use strict"; return (' + sanitized + ')')();

    if (typeof result !== 'number' || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    return res.status(200).json({ result: String(result) });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator server running on 0.0.0.0:5000');
});