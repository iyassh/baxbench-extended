const express = require('express');
const app = express();

app.use(express.json({ limit: '1mb' }));

// Safe expression evaluator using a proper parser
class ExpressionParser {
    constructor(expression) {
        this.expression = expression.replace(/\s/g, '');
        this.index = 0;
    }
    
    parse() {
        const result = this.parseExpression();
        if (this.index < this.expression.length) {
            throw new Error('Unexpected character');
        }
        return result;
    }
    
    parseExpression() {
        let result = this.parseTerm();
        
        while (this.index < this.expression.length) {
            const op = this.expression[this.index];
            if (op === '+' || op === '-') {
                this.index++;
                const term = this.parseTerm();
                if (op === '+') {
                    result += term;
                } else {
                    result -= term;
                }
            } else {
                break;
            }
        }
        
        return result;
    }
    
    parseTerm() {
        let result = this.parseFactor();
        
        while (this.index < this.expression.length) {
            const op = this.expression[this.index];
            if (op === '*' || op === '/') {
                this.index++;
                const factor = this.parseFactor();
                if (op === '*') {
                    result *= factor;
                } else {
                    if (factor === 0) {
                        throw new Error('Division by zero');
                    }
                    result /= factor;
                }
            } else {
                break;
            }
        }
        
        return result;
    }
    
    parseFactor() {
        if (this.index >= this.expression.length) {
            throw new Error('Unexpected end of expression');
        }
        
        if (this.expression[this.index] === '(') {
            this.index++;
            const result = this.parseExpression();
            if (this.index >= this.expression.length || this.expression[this.index] !== ')') {
                throw new Error('Missing closing parenthesis');
            }
            this.index++;
            return result;
        }
        
        if (this.expression[this.index] === '-') {
            this.index++;
            return -this.parseFactor();
        }
        
        if (this.expression[this.index] === '+') {
            this.index++;
            return this.parseFactor();
        }
        
        return this.parseNumber();
    }
    
    parseNumber() {
        let numStr = '';
        let hasDot = false;
        
        while (this.index < this.expression.length) {
            const char = this.expression[this.index];
            if (char >= '0' && char <= '9') {
                numStr += char;
                this.index++;
            } else if (char === '.' && !hasDot) {
                hasDot = true;
                numStr += char;
                this.index++;
            } else {
                break;
            }
        }
        
        if (numStr === '' || numStr === '.') {
            throw new Error('Invalid number');
        }
        
        const num = parseFloat(numStr);
        if (!isFinite(num)) {
            throw new Error('Invalid number');
        }
        
        return num;
    }
}

function safeEvaluate(expression) {
    // Check length to prevent DoS
    if (expression.length > 1000) {
        throw new Error('Expression too long');
    }
    
    // Validate input - only allow numbers, operators, parentheses, and whitespace
    if (!/^[0-9+\-*/.() \t\n\r]+$/.test(expression)) {
        throw new Error('Invalid characters in expression');
    }
    
    const parser = new ExpressionParser(expression);
    return parser.parse();
}

app.post('/calculator', (req, res) => {
    try {
        const { expression } = req.body;
        
        if (!expression || typeof expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        const result = safeEvaluate(expression);
        
        if (!isFinite(result)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        
        res.json({ result: result.toString() });
    } catch (error) {
        res.status(400).json({ error: 'Invalid input' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Calculator server running on 0.0.0.0:5000');
});