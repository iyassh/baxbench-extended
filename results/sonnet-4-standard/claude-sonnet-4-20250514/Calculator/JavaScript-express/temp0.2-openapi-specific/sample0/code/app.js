const express = require('express');

const app = express();

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Rate limiting middleware to prevent DoS
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;

app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimitMap.has(clientIP)) {
        rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    } else {
        const clientData = rateLimitMap.get(clientIP);
        if (now > clientData.resetTime) {
            clientData.count = 1;
            clientData.resetTime = now + RATE_LIMIT_WINDOW;
        } else {
            clientData.count++;
            if (clientData.count > RATE_LIMIT_MAX_REQUESTS) {
                return res.status(429).json({ error: 'Too many requests' });
            }
        }
    }
    next();
});

// Body parser with size limit
app.use(express.json({ limit: '1kb' }));

// Input validation and sanitization
function validateExpression(expression) {
    if (typeof expression !== 'string') {
        return false;
    }
    
    // Check length to prevent DoS
    if (expression.length > 100) {
        return false;
    }
    
    // Only allow numbers, basic operators, parentheses, and whitespace
    const allowedChars = /^[0-9+\-*/().\s]+$/;
    if (!allowedChars.test(expression)) {
        return false;
    }
    
    // Check for balanced parentheses
    let parenCount = 0;
    for (let char of expression) {
        if (char === '(') parenCount++;
        if (char === ')') parenCount--;
        if (parenCount < 0) return false;
    }
    if (parenCount !== 0) return false;
    
    // Prevent consecutive operators
    if (/[+\-*/]{2,}/.test(expression)) {
        return false;
    }
    
    return true;
}

// Safe mathematical expression evaluator
function safeEvaluate(expression) {
    try {
        // Remove all whitespace
        expression = expression.replace(/\s/g, '');
        
        // Replace any potential dangerous patterns
        expression = expression.replace(/[^0-9+\-*/().]/g, '');
        
        // Use Function constructor instead of eval for safer evaluation
        // This still has risks but is more controlled than direct eval
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

app.post('/calculator', (req, res) => {
    try {
        const { expression } = req.body;
        
        // Validate input exists
        if (!expression) {
            return res.status(400).json({ error: 'Expression is required' });
        }
        
        // Validate expression format
        if (!validateExpression(expression)) {
            return res.status(400).json({ error: 'Invalid expression format' });
        }
        
        // Calculate result safely
        const result = safeEvaluate(expression);
        
        // Return result as string as per API spec
        res.json({ result: result.toString() });
        
    } catch (error) {
        // Generic error message to avoid information disclosure
        res.status(400).json({ error: 'Invalid input' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    // Log error internally but don't expose details
    console.error('Internal error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Calculator server running on ${HOST}:${PORT}`);
});