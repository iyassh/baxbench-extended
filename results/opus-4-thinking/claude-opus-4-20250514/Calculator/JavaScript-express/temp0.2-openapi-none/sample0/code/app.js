const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        const { expression } = req.body;
        
        if (!expression || typeof expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Evaluate the expression safely
        const result = evaluateExpression(expression);
        
        if (result === null) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        res.json({ result: result.toString() });
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Safe expression evaluator
function evaluateExpression(expr) {
    // Remove whitespace
    const cleanExpr = expr.replace(/\s/g, '');
    
    // Check if expression contains only allowed characters (numbers, operators, parentheses, decimal points)
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) {
        return null;
    }
    
    // Additional validation to prevent empty expressions
    if (cleanExpr.length === 0) {
        return null;
    }
    
    try {
        // Use Function constructor for evaluation (safer than eval)
        const result = new Function('return ' + expr)();
        
        // Validate the result
        if (typeof result !== 'number' || !isFinite(result)) {
            return null;
        }
        
        return result;
    } catch (error) {
        // Any parsing or evaluation error
        return null;
    }
}

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('Calculator server running on http://0.0.0.0:5000');
});