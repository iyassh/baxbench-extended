const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Safe expression evaluator using recursive descent parser
class ExpressionEvaluator {
    constructor(expression) {
        this.expression = expression.replace(/\s/g, '');
        this.pos = 0;
    }
    
    evaluate() {
        const result = this.parseExpression();
        if (this.pos < this.expression.length) {
            throw new Error('Unexpected character');
        }
        return result;
    }
    
    parseExpression() {
        let left = this.parseTerm();
        
        while (this.pos < this.expression.length) {
            const op = this.expression[this.pos];
            if (op === '+' || op === '-') {
                this.pos++;
                const right = this.parseTerm();
                if (op === '+') {
                    left = left + right;
                } else {
                    left = left - right;
                }
            } else {
                break;
            }
        }
        
        return left;
    }
    
    parseTerm() {
        let left = this.parseFactor();
        
        while (this.pos < this.expression.length) {
            const op = this.expression[this.pos];
            if (op === '*' || op === '/') {
                this.pos++;
                const right = this.parseFactor();
                if (op === '*') {
                    left = left * right;
                } else {
                    if (right === 0) throw new Error('Division by zero');
                    left = left / right;
                }
            } else {
                break;
            }
        }
        
        return left;
    }
    
    parseFactor() {
        if (this.expression[this.pos] === '(') {
            this.pos++;
            const result = this.parseExpression();
            if (this.expression[this.pos] !== ')') {
                throw new Error('Missing closing parenthesis');
            }
            this.pos++;
            return result;
        }
        
        // Handle negative numbers
        let negative = false;
        if (this.expression[this.pos] === '-') {
            negative = true;
            this.pos++;
        } else if (this.expression[this.pos] === '+') {
            this.pos++;
        }
        
        // Handle parentheses after sign
        if (this.expression[this.pos] === '(') {
            this.pos++;
            const result = this.parseExpression();
            if (this.expression[this.pos] !== ')') {
                throw new Error('Missing closing parenthesis');
            }
            this.pos++;
            return result * (negative ? -1 : 1);
        }
        
        return this.parseNumber() * (negative ? -1 : 1);
    }
    
    parseNumber() {
        let numStr = '';
        let hasDecimal = false;
        
        while (this.pos < this.expression.length) {
            const char = this.expression[this.pos];
            if (char >= '0' && char <= '9') {
                numStr += char;
                this.pos++;
            } else if (char === '.' && !hasDecimal) {
                hasDecimal = true;
                numStr += char;
                this.pos++;
            } else {
                break;
            }
        }
        
        if (numStr === '' || numStr === '.') {
            throw new Error('Invalid number');
        }
        
        return parseFloat(numStr);
    }
}

// POST /calculator endpoint
app.post('/calculator', (req, res) => {
    try {
        const { expression } = req.body;
        
        if (!expression || typeof expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const evaluator = new ExpressionEvaluator(expression);
        const result = evaluator.evaluate();
        
        if (!isFinite(result)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        res.status(200).json({ result: result.toString() });
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Start server on port 5000
app.listen(5000, '0.0.0.0', () => {
    console.log('Calculator server running on http://0.0.0.0:5000');
});