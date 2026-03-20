const express = require('express');
const app = express();

app.use(express.json());

app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;
    
    // Validate input exists and is string
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Validate expression contains only safe mathematical characters
    const validPattern = /^[0-9+\-*/().\s]+$/;
    if (!validPattern.test(expression)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Evaluate expression safely using Function constructor
    const result = Function('"use strict"; return (' + expression + ')')();
    
    // Validate result is a finite number
    if (typeof result !== 'number' || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    // Return result as string as specified in schema
    res.json({ result: result.toString() });
  } catch (error) {
    res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Calculator server running on http://0.0.0.0:5000');
});