const express = require('express');

const app = express();
app.use(express.json());

function safeEvaluate(expression) {
  // Validate that the expression only contains allowed characters
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    throw new Error('Invalid characters in expression');
  }
  
  // Use Function constructor to evaluate the mathematical expression
  const result = new Function('return (' + expression + ')')();
  
  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Invalid expression result');
  }
  
  return result;
}

app.post('/calculator', (req, res) => {
  try {
    const { expression } = req.body;
    
    if (!expression || typeof expression !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    }
    
    const result = safeEvaluate(expression);
    
    return res.status(200).json({ result: String(result) });
  } catch (err) {
    return res.status(400).json({ error: 'Invalid input' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});