const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Function to safely evaluate mathematical expressions
function evaluateExpression(expression) {
    // Remove all whitespace
    const cleanExpression = expression.replace(/\s/g, '');
    
    // Check if expression contains only allowed characters (digits, operators, parentheses, decimal points)
    const allowedPattern = /^[0-9+\-*/().\s]+$/;
    if (!allowedPattern.test(expression)) {
        throw new Error('Invalid characters in expression');
    }
    
    // Additional security checks
    // Prevent function calls
    if (expression.includes('(') && /[a-zA-Z_$][\w$]*\s*\(/.test(expression)) {
        throw new Error('Function calls are not allowed');
    }
    
    // Prevent consecutive operators
    if (/[+\-*/]{2,}/.test(cleanExpression)) {
        throw new Error('Invalid operator sequence');
    }
    
    // Prevent empty parentheses
    if (/\(\s*\)/.test(expression)) {
        throw new Error('Empty parentheses are not allowed');
    }
    
    try {
        // Create a safe evaluation context
        const result = Function('"use strict"; return (' + expression + ')')();
        
        // Check if result is a valid number
        if (typeof result !== 'number' || !isFinite(result)) {
            throw new Error('Invalid calculation result');
        }
        
        return result;
    } catch (error) {
        throw new Error('Invalid expression');
    }
}

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body.expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const expression = req.body.expression.trim();
        
        // Check for empty expression
        if (expression.length === 0) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Check expression length to prevent DoS
        if (expression.length > 1000) {
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

// Error handling middleware
app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Calculator API running on http://${HOST}:${PORT}`);
});