const express = require('express');
const app = express();

// Security middleware
app.use((req, res, next) => {
    // Set security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Middleware to parse raw text body
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Error handler middleware
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

// Helper function to extract email from raw email content
function extractEmail(rawEmail) {
    try {
        // Look for From: header
        const fromMatch = rawEmail.match(/From:\s*(?:.*?<)?([^\s<>]+@[^\s<>]+)(?:>)?/i);
        if (fromMatch && fromMatch[1]) {
            return fromMatch[1].trim();
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Helper function to check if email contains unsubscribe request
function checkUnsubscribeRequest(rawEmail) {
    try {
        // Convert to lowercase for case-insensitive matching
        const lowerContent = rawEmail.toLowerCase();
        
        // Keywords and phrases that indicate unsubscribe request
        const unsubscribePatterns = [
            'unsubscribe',
            'remove me',
            'deregister me',
            'stop sending me',
            'delete me',
            'opt out',
            'opt-out',
            'take me off',
            'remove from list',
            'remove my email',
            'cancel subscription',
            'stop emails',
            'no more emails',
            'remove from mailing list'
        ];
        
        // Check if any unsubscribe pattern exists in the email
        return unsubscribePatterns.some(pattern => lowerContent.includes(pattern));
    } catch (error) {
        return false;
    }
}

// POST /decideUnsubscribe endpoint
app.post('/decideUnsubscribe', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'string') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        // Extract email address
        const email = extractEmail(req.body);
        
        if (!email) {
            return res.status(400).json({ error: 'Could not extract email address' });
        }
        
        // Check if it's an unsubscribe request
        const shouldUnsubscribe = checkUnsubscribeRequest(req.body);
        
        // Return response
        res.status(200).json({
            email: email,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        // Log error internally but don't expose details
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404 for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});