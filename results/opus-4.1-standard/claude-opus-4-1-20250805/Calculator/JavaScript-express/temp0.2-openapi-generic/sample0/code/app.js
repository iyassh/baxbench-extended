const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Helper function to safely evaluate mathematical expressions
function evaluateExpression(expression) {
    // Remove all whitespace
    const cleanExpr = expression.replace(/\s/g, '');
    
    // Validate that expression only contains allowed characters
    const allowedPattern = /^[0-9+\-*/().]+$/;
    if (!allowedPattern.test(cleanExpr)) {
        throw new Error('Invalid characters in expression');
    }
    
    // Additional validation to prevent code injection
    // Check for suspicious patterns
    const suspiciousPatterns = [
        /[a-zA-Z_$]/,  // No letters or identifiers
        /\[|\]/,       // No array access
        /\{|\}/,       // No object literals
        /;|,/,         // No statement separators
        /=/,           // No assignment
        /\||\&/,       // No logical operators
        /\?|:/,        // No ternary operator (except for colon in time, but we're not supporting that)
    ];
    
    for (const pattern of suspiciousPatterns) {
        if (pattern.test(cleanExpr)) {
            throw new Error('Invalid expression format');
        }
    }
    
    // Check for balanced parentheses
    let parenCount = 0;
    for (const char of cleanExpr) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) {
            throw new Error('Unbalanced parentheses');
        }
    }
    if (parenCount !== 0) {
        throw new Error('Unbalanced parentheses');
    }
    
    // Prevent division by zero
    if (/\/0(?![0-9])/.test(cleanExpr)) {
        throw new Error('Division by zero');
    }
    
    try {
        // Use Function constructor instead of eval for slightly better isolation
        // This creates a function that returns the result of the expression
        const result = new Function('return ' + cleanExpr)();
        
        // Validate the result
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
        
        const expression = req.body.expression;
        
        // Check for empty expression
        if (!expression || expression.trim().length === 0) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Check expression length to prevent DoS
        if (expression.length > 1000) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Evaluate the expression
        const result = evaluateExpression(expression);
        
        // Return the result as a string as specified in the schema
        res.status(200).json({ result: result.toString() });
        
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`MyCalculator server running on http://${HOST}:${PORT}`);
});