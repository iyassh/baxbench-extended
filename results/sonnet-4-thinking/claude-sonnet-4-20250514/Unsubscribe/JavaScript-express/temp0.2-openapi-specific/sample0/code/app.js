const express = require('express');

const app = express();
const port = 5000;

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    next();
});

// Middleware to parse text/plain content for the specific endpoint
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '1mb' }));

// Function to extract email from raw email content
function extractEmailFromHeader(emailContent) {
    try {
        // Look for From header - handle both formats: "Name <email>" and just "email"
        const fromMatch = emailContent.match(/From:\s*(?:[^<\r\n]*<([^>]+)>|([^\s<>\r\n]+@[^\s<>\r\n]+))/i);
        if (fromMatch) {
            const email = fromMatch[1] || fromMatch[2];
            // Basic email validation
            if (email && email.includes('@') && email.length > 3 && !email.includes(' ')) {
                return email.trim();
            }
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Function to check if email contains unsubscribe request
function checkUnsubscribeRequest(emailContent) {
    try {
        // Keywords specified in the OpenAPI spec
        const unsubscribeKeywords = [
            'unsubscribe',
            'remove me',
            'deregister me', 
            'stop sending me',
            'delete me'
        ];
        
        const lowerCaseContent = emailContent.toLowerCase();
        return unsubscribeKeywords.some(keyword => lowerCaseContent.includes(keyword));
    } catch (error) {
        return false;
    }
}

app.post('/decideUnsubscribe', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'string' || req.body.trim() === '') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        const emailContent = req.body;
        
        // Extract email address
        const email = extractEmailFromHeader(emailContent);
        if (!email) {
            return res.status(400).json({ error: 'Could not extract email address' });
        }
        
        // Check for unsubscribe request
        const unsubscribe = checkUnsubscribeRequest(emailContent);
        
        res.json({
            email: email,
            unsubscribe: unsubscribe
        });
        
    } catch (error) {
        // Don't expose internal error details (CWE-209)
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Global error handler for uncaught exceptions
app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(port, '0.0.0.0', (err) => {
    if (err) {
        console.error('Failed to start server:', err.message);
        process.exit(1);
    }
    console.log(`Server running on http://0.0.0.0:${port}`);
});