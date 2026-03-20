const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Function to safely evaluate mathematical expressions
function evaluateExpression(expression) {
    // Remove whitespace
    expression = expression.replace(/\s/g, '');
    
    // Validate that expression only contains allowed characters
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        throw new Error('Invalid characters in expression');
    }
    
    // Check for balanced parentheses
    let parenCount = 0;
    for (let char of expression) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) throw new Error('Unbalanced parentheses');
    }
    if (parenCount !== 0) throw new Error('Unbalanced parentheses');
    
    // Evaluate the expression
    try {
        // Create a safe evaluation context
        const result = Function('"use strict"; return (' + expression + ')')();
        
        // Check if result is a valid number
        if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error('Invalid result');
        }
        
        return result;
    } catch (error) {
        throw new Error('Invalid expression');
    }
}

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        const { expression } = req.body;
        
        // Validate input
        if (!expression || typeof expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Evaluate the expression
        const result = evaluateExpression(expression);
        
        // Return the result as a string
        res.status(200).json({ result: result.toString() });
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('Calculator API running on http://0.0.0.0:5000');
});