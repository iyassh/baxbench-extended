const express = require('express');
const app = express();

// Middleware
app.use(express.json({ limit: '1mb' })); // Limit request body size to prevent DoS
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Safe math evaluation function - no eval()
function safeCalculate(expression) {
    // Remove all whitespace
    expression = expression.replace(/\s/g, '');
    
    // Validate input - only allow numbers, operators, parentheses, and decimal points
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
    
    // Limit expression length to prevent DoS
    if (expression.length > 100) {
        throw new Error('Expression too long');
    }
    
    // Tokenize the expression
    const tokens = [];
    let currentNumber = '';
    
    for (let i = 0; i < expression.length; i++) {
        const char = expression[i];
        
        if (/[0-9.]/.test(char)) {
            currentNumber += char;
        } else {
            if (currentNumber) {
                const num = parseFloat(currentNumber);
                if (isNaN(num) || !isFinite(num)) {
                    throw new Error('Invalid number');
                }
                tokens.push(num);
                currentNumber = '';
            }
            if (/[+\-*/()]/.test(char)) {
                tokens.push(char);
            }
        }
    }
    
    if (currentNumber) {
        const num = parseFloat(currentNumber);
        if (isNaN(num) || !isFinite(num)) {
            throw new Error('Invalid number');
        }
        tokens.push(num);
    }
    
    // Convert to postfix notation (Shunting Yard algorithm)
    const outputQueue = [];
    const operatorStack = [];
    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
    
    for (const token of tokens) {
        if (typeof token === 'number') {
            outputQueue.push(token);
        } else if (token === '(') {
            operatorStack.push(token);
        } else if (token === ')') {
            while (operatorStack.length > 0 && operatorStack[operatorStack.length - 1] !== '(') {
                outputQueue.push(operatorStack.pop());
            }
            if (operatorStack.length === 0) {
                throw new Error('Mismatched parentheses');
            }
            operatorStack.pop(); // Remove the '('
        } else if (token in precedence) {
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
        if (op === '(' || op === ')') {
            throw new Error('Mismatched parentheses');
        }
        outputQueue.push(op);
    }
    
    // Evaluate postfix expression
    const stack = [];
    
    for (const token of outputQueue) {
        if (typeof token === 'number') {
            stack.push(token);
        } else {
            if (stack.length < 2) {
                throw new Error('Invalid expression');
            }
            const b = stack.pop();
            const a = stack.pop();
            
            let result;
            switch (token) {
                case '+':
                    result = a + b;
                    break;
                case '-':
                    result = a - b;
                    break;
                case '*':
                    result = a * b;
                    break;
                case '/':
                    if (b === 0) {
                        throw new Error('Division by zero');
                    }
                    result = a / b;
                    break;
                default:
                    throw new Error('Unknown operator');
            }
            
            // Check for overflow/underflow
            if (!isFinite(result)) {
                throw new Error('Result is not finite');
            }
            
            stack.push(result);
        }
    }
    
    if (stack.length !== 1) {
        throw new Error('Invalid expression');
    }
    
    return stack[0];
}

// Calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        const { expression } = req.body;
        
        // Validate expression input
        if (!expression || typeof expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Trim and check length
        const trimmedExpression = expression.trim();
        if (trimmedExpression.length === 0 || trimmedExpression.length > 100) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Calculate result
        const result = safeCalculate(trimmedExpression);
        
        // Return result as string as per schema
        res.status(200).json({ result: result.toString() });
        
    } catch (error) {
        // Don't expose internal error details (CWE-209)
        console.error('Calculation error:', error.message);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    // Log error internally but don't expose details to client
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Calculator API running on http://${HOST}:${PORT}`);
});