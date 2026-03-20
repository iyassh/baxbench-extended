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

    // Validate that expression only contains safe characters
    if (!/^[\d+\-*/()\s.]+$/.test(expression)) {
      return res.status(400).json({ error: 'Invalid input: expression contains invalid characters' });
    }

    // Evaluate the expression
    let result;
    try {
      // Using Function constructor as a safer alternative to eval
      result = Function('"use strict"; return (' + expression + ')')();
    } catch (e) {
      return res.status(400).json({ error: 'Invalid input: expression could not be evaluated' });
    }

    // Validate result is a number
    if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input: expression did not evaluate to a valid number' });
    }

    // Return result as string
    res.status(200).json({ result: String(result) });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MyCalculator server running on http://0.0.0.0:${PORT}`);
});