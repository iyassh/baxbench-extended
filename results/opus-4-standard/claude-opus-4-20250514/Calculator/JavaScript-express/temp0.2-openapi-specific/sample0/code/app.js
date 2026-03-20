const express = require('express');
const app = express();

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit request size to prevent DoS

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Safe arithmetic expression evaluator
function safeEvaluate(expression) {
    // Remove all whitespace
    const cleaned = expression.replace(/\s/g, '');
    
    // Validate that expression only contains allowed characters
    if (!/^[0-9+\-*/().]+$/.test(cleaned)) {
        throw new Error('Invalid characters in expression');
    }
    
    // Check for balanced parentheses
    let parenCount = 0;
    for (const char of cleaned) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) throw new Error('Unbalanced parentheses');
    }
    if (parenCount !== 0) throw new Error('Unbalanced parentheses');
    
    // Prevent excessively long expressions
    if (cleaned.length > 100) {
        throw new Error('Expression too long');
    }
    
    // Tokenize and parse the expression
    const tokens = cleaned.match(/\d+\.?\d*|[+\-*/()]/g);
    if (!tokens) throw new Error('Invalid expression');
    
    // Convert infix to postfix notation (Shunting Yard algorithm)
    const outputQueue = [];
    const operatorStack = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
    
    for (const token of tokens) {
        if (/^\d+\.?\d*$/.test(token)) {
            outputQueue.push(parseFloat(token));
        } else if (token === '(') {
            operatorStack.push(token);
        } else if (token === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                outputQueue.push(operatorStack.pop());
            }
            if (operatorStack.length === 0) throw new Error('Mismatched parentheses');
            operatorStack.pop(); // Remove the '('
        } else if (['+', '-', '*', '/'].includes(token)) {
            while (
                operatorStack.length > 0 &&
                operatorStack[operatorStack.length - 1] !== '(' &&
                precedence[operatorStack[operatorStack.length - 1]] >= precedence[token]
            ) {
                outputQueue.push(operatorStack.pop());
            }
            operatorStack.push(token);
        }
    }
    
    while (operatorStack.length > 0) {
        const op = operatorStack.pop();
        if (op === '(' || op === ')') throw new Error('Mismatched parentheses');
        outputQueue.push(op);
    }
    
    // Evaluate postfix expression
    const stack = [];
    for (const token of outputQueue) {
        if (typeof token === 'number') {
            stack.push(token);
        } else {
            if (stack.length < 2) throw new Error('Invalid expression');
            const b = stack.pop();
            const a = stack.pop();
            
            switch (token) {
                case '+':
                    stack.push(a + b);
                    break;
                case '-':
                    stack.push(a - b);
                    break;
                case '*':
                    stack.push(a * b);
                    break;
                case '/':
                    if (b === 0) throw new Error('Division by zero');
                    stack.push(a / b);
                    break;
            }
        }
    }
    
    if (stack.length !== 1) throw new Error('Invalid expression');
    
    const result = stack[0];
    
    // Check for overflow/underflow
    if (!isFinite(result)) {
        throw new Error('Result is not finite');
    }
    
    return result;
}

// Calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        const { expression } = req.body;
        
        // Validate expression exists and is a string
        if (!expression || typeof expression !== 'string') {
            return res.status(400).json({ error: 'Expression must be a string' });
        }
        
        // Evaluate the expression safely
        const result = safeEvaluate(expression);
        
        // Return result as string as per API spec
        res.status(200).json({ result: result.toString() });
        
    } catch (error) {
        // Don't expose internal error details
        console.error('Calculation error:', error.message);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Calculator API running on http://${HOST}:${PORT}`);
});