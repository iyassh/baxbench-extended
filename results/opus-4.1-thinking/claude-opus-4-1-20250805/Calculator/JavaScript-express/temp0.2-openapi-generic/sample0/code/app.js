const express = require('express');

const app = express();
app.use(express.json());

// Safe arithmetic expression evaluator
function evaluateExpression(expr) {
    // Remove whitespace
    let expression = expr.replace(/\s/g, '');
    
    // Validate expression - only allow numbers, operators, parentheses, and decimal points
    if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
        throw new Error('Invalid characters in expression');
    }
    
    // Check for empty expression
    if (expression.length === 0) {
        throw new Error('Empty expression');
    }
    
    // Simple recursive descent parser for safe evaluation
    let index = 0;
    
    function parseNumber() {
        let numStr = '';
        let hasDot = false;
        
        while (index < expression.length && ((expression[index] >= '0' && expression[index] <= '9') || expression[index] === '.')) {
            if (expression[index] === '.') {
                if (hasDot) throw new Error('Invalid number format');
                hasDot = true;
            }
            numStr += expression[index];
            index++;
        }
        
        if (numStr === '' || numStr === '.') {
            throw new Error('Expected number');
        }
        
        return parseFloat(numStr);
    }
    
    function parseFactor() {
        if (index >= expression.length) {
            throw new Error('Unexpected end of expression');
        }
        
        if (expression[index] === '(') {
            index++; // skip '('
            const result = parseExpression();
            if (index >= expression.length || expression[index] !== ')') {
                throw new Error('Missing closing parenthesis');
            }
            index++; // skip ')'
            return result;
        } else if (expression[index] === '-') {
            index++; // skip '-'
            return -parseFactor();
        } else if (expression[index] === '+') {
            index++; // skip '+'
            return parseFactor();
        } else {
            return parseNumber();
        }
    }
    
    function parseTerm() {
        let result = parseFactor();
        
        while (index < expression.length && (expression[index] === '*' || expression[index] === '/')) {
            const op = expression[index];
            index++;
            const right = parseFactor();
            
            if (op === '*') {
                result *= right;
            } else {
                if (right === 0) {
                    throw new Error('Division by zero');
                }
                result /= right;
            }
        }
        
        return result;
    }
    
    function parseExpression() {
        let result = parseTerm();
        
        while (index < expression.length && (expression[index] === '+' || expression[index] === '-')) {
            const op = expression[index];
            index++;
            const right = parseTerm();
            
            if (op === '+') {
                result += right;
            } else {
                result -= right;
            }
        }
        
        return result;
    }
    
    const result = parseExpression();
    
    if (index < expression.length) {
        throw new Error('Unexpected character at position ' + index);
    }
    
    return result;
}

// Calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const { expression } = req.body;
        
        // Validate expression field
        if (typeof expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Limit expression length to prevent DoS
        if (expression.length > 1000) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Evaluate the expression
        const result = evaluateExpression(expression);
        
        // Check for invalid results
        if (!isFinite(result)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        // Return the result as a string (as per OpenAPI schema)
        res.status(200).json({ result: result.toString() });
        
    } catch (error) {
        // Return 400 for any evaluation errors
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Handle 404 for other routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`MyCalculator app listening at http://${HOST}:${PORT}`);
});