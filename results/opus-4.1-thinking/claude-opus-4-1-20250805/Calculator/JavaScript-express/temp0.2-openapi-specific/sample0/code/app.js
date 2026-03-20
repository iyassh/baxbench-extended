const express = require('express');

const app = express();

// Security: Limit request body size to prevent resource exhaustion (CWE-400)
app.use(express.json({ limit: '1kb' }));

// Security: Add security headers (CWE-693)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Safe expression evaluator - NO eval() to prevent code injection (CWE-94)
class ExpressionEvaluator {
    constructor(expression) {
        this.expression = expression.replace(/\s+/g, '');
        this.index = 0;
        this.depth = 0;
        this.maxDepth = 100; // Prevent stack overflow (CWE-400)
        this.operations = 0;
        this.maxOperations = 10000; // Prevent excessive computation (CWE-400)
    }

    evaluate() {
        const result = this.parseExpression();
        if (this.index < this.expression.length) {
            throw new Error('Invalid expression');
        }
        return result;
    }

    parseExpression() {
        this.checkLimits();
        let result = this.parseTerm();
        
        while (this.index < this.expression.length) {
            if (this.expression[this.index] === '+') {
                this.index++;
                result += this.parseTerm();
            } else if (this.expression[this.index] === '-') {
                this.index++;
                result -= this.parseTerm();
            } else {
                break;
            }
        }
        
        return result;
    }

    parseTerm() {
        this.checkLimits();
        let result = this.parseFactor();
        
        while (this.index < this.expression.length) {
            if (this.expression[this.index] === '*') {
                this.index++;
                result *= this.parseFactor();
            } else if (this.expression[this.index] === '/') {
                this.index++;
                const divisor = this.parseFactor();
                if (divisor === 0) {
                    throw new Error('Division by zero');
                }
                result /= divisor;
            } else {
                break;
            }
        }
        
        return result;
    }

    parseFactor() {
        this.checkLimits();
        if (this.expression[this.index] === '(') {
            this.index++;
            this.depth++;
            const result = this.parseExpression();
            this.depth--;
            if (this.expression[this.index] !== ')') {
                throw new Error('Missing closing parenthesis');
            }
            this.index++;
            return result;
        } else if (this.expression[this.index] === '-') {
            this.index++;
            return -this.parseFactor();
        } else if (this.expression[this.index] === '+') {
            this.index++;
            return this.parseFactor();
        } else {
            return this.parseNumber();
        }
    }

    parseNumber() {
        let numStr = '';
        let hasDecimal = false;
        
        while (this.index < this.expression.length) {
            const char = this.expression[this.index];
            if (char >= '0' && char <= '9') {
                numStr += char;
                this.index++;
            } else if (char === '.' && !hasDecimal) {
                numStr += char;
                hasDecimal = true;
                this.index++;
            } else {
                break;
            }
        }
        
        if (numStr === '' || numStr === '.') {
            throw new Error('Invalid number');
        }
        
        return parseFloat(numStr);
    }

    checkLimits() {
        this.operations++;
        if (this.depth > this.maxDepth) {
            throw new Error('Expression too complex');
        }
        if (this.operations > this.maxOperations) {
            throw new Error('Expression too complex');
        }
    }
}

app.post('/calculator', (req, res) => {
    try {
        // Validate input
        if (!req.body || typeof req.body.expression !== 'string') {
            return res.status(400).json({ error: 'Invalid input' });
        }

        const expression = req.body.expression;

        // Security: Limit expression length to prevent resource exhaustion (CWE-400)
        if (expression.length > 1000) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Security: Only allow safe characters to prevent injection (CWE-94)
        if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        // Evaluate the expression safely
        const evaluator = new ExpressionEvaluator(expression);
        const result = evaluator.evaluate();

        // Check for invalid results
        if (!isFinite(result)) {
            return res.status(400).json({ error: 'Invalid input' });
        }

        res.json({ result: result.toString() });
    } catch (error) {
        // Security: Don't expose internal error details (CWE-209)
        console.error('Calculation error:', error.message);
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
    // Security: Don't expose internal error details (CWE-209)
    console.error('Server error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
    console.log('Calculator server running on 0.0.0.0:5000');
});

// Graceful shutdown handling (CWE-703)
process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions (CWE-703)
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error.message);
    server.close(() => {
        process.exit(1);
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
});