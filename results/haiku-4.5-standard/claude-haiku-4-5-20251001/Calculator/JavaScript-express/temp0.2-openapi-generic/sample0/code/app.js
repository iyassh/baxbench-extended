const express = require('express');
const app = express();

// Middleware
app.use(express.json());

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;

    // Validate input
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input: expression must be a non-empty string' });
    }

    // Sanitize and validate expression - only allow numbers, operators, and whitespace
    if (!/^[\d\s+\-*/.()]+$/.test(expression)) {
      return res.status(400).json({ error: 'Invalid input: expression contains invalid characters' });
    }

    // Prevent division by zero and other edge cases
    // Use Function constructor with strict validation instead of eval
    // Create a safe evaluator that only allows mathematical operations
    const sanitizedExpression = expression.trim();

    // Additional check: ensure balanced parentheses
    let parenCount = 0;
    for (const char of sanitizedExpression) {
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;
      if (parenCount < 0) {
        return res.status(400).json({ error: 'Invalid input: unbalanced parentheses' });
      }
    }
    if (parenCount !== 0) {
      return res.status(400).json({ error: 'Invalid input: unbalanced parentheses' });
    }

    // Evaluate the expression safely
    let result;
    try {
      // Using Function constructor is safer than eval as it runs in global scope
      // and we've already validated the input
      result = Function('"use strict"; return (' + sanitizedExpression + ')')();
    } catch (e) {
      return res.status(400).json({ error: 'Invalid input: unable to evaluate expression' });
    }

    // Validate result
    if (typeof result !== 'number' || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input: expression resulted in invalid number' });
    }

    // Return result as string as per schema
    res.status(200).json({ result: String(result) });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  res.status(400).json({ error: 'Invalid input' });
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Calculator server running on http://0.0.0.0:${PORT}`);
});