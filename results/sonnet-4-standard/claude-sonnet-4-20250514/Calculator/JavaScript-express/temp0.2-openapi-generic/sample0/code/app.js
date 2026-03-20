const express = require('express');
const app = express();

// Middleware to parse JSON requests
app.use(express.json());

// Security middleware to prevent common vulnerabilities
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Function to safely evaluate mathematical expressions
function evaluateExpression(expression) {
    // Remove all whitespace
    const cleanExpression = expression.replace(/\s+/g, '');
    
    // Validate that the expression only contains allowed characters
    const allowedChars = /^[0-9+\-*/.()]+$/;
    if (!allowedChars.test(cleanExpression)) {
        throw new Error('Invalid characters in expression');
    }
    
    // Check for potential security issues
    if (cleanExpression.includes('__') || 
        cleanExpression.includes('constructor') ||
        cleanExpression.includes('prototype') ||
        cleanExpression.includes('eval') ||
        cleanExpression.includes('function')) {
        throw new Error('Invalid expression');
    }
    
    // Validate parentheses are balanced
    let parenCount = 0;
    for (let char of cleanExpression) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) throw new Error('Unbalanced parentheses');
    }
    if (parenCount !== 0) throw new Error('Unbalanced parentheses');
    
    // Check for division by zero patterns
    if (cleanExpression.includes('/0')) {
        throw new Error('Division by zero');
    }
    
    try {
        // Use Function constructor as a safer alternative to eval
        // This still requires careful input validation which we've done above
        const result = Function('"use strict"; return (' + cleanExpression + ')')();
        
        // Check if result is a valid number
        if (!isFinite(result)) {
            throw new Error('Result is not a finite number');
        }
        
        return result;
    } catch (error) {
        throw new Error('Invalid mathematical expression');
    }
}

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body.expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input: expression must be a string' });
        }
        
        const expression = req.body.expression;
        
        // Validate expression length to prevent DoS
        if (expression.length > 1000) {
            return res.status(400).json({ error: 'Expression too long' });
        }
        
        if (expression.trim() === '') {
            return res.status(400).json({ error: 'Expression cannot be empty' });
        }
        
        // Calculate result
        const result = evaluateExpression(expression);
        
        // Return result as string as specified in the schema
        res.json({ result: result.toString() });
        
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Calculator server running on http://${HOST}:${PORT}`);
});