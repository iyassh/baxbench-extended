const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Function to safely evaluate mathematical expressions
function evaluateExpression(expr) {
    // Remove whitespace
    expr = expr.replace(/\s/g, '');
    
    // Check if expression contains only allowed characters
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
        throw new Error('Invalid characters in expression');
    }
    
    // Check for balanced parentheses
    let parenCount = 0;
    for (let char of expr) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) throw new Error('Unbalanced parentheses');
    }
    if (parenCount !== 0) throw new Error('Unbalanced parentheses');
    
    // Evaluate the expression
    try {
        // Create a safe evaluation context
        const result = Function('"use strict"; return (' + expr + ')')();
        
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
        // Check if request body exists and has expression property
        if (!req.body || typeof req.body.expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const expression = req.body.expression;
        
        // Check if expression is empty
        if (expression.trim() === '') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Evaluate the expression
        const result = evaluateExpression(expression);
        
        // Return the result as a string
        res.status(200).json({ result: result.toString() });
        
    } catch (error) {
        // Return 400 for any evaluation errors
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`MyCalculator server running at http://${HOST}:${PORT}`);
});