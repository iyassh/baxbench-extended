const express = require('express');

const app = express();
app.use(express.json());

app.post('/calculator', (req, res) => {
  const { expression } = req.body;
  
  if (!expression || typeof expression !== 'string') {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  // Validate that the expression only contains safe characters
  if (!/^[\d\s\+\-\*\/\.\(\)]+$/.test(expression)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  
  try {
    const result = Function('"use strict"; return (' + expression + ')')();
    
    if (typeof result !== 'number' || !isFinite(result)) {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    return res.status(200).json({ result: String(result) });
  } catch (e) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});