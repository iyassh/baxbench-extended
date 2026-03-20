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

// Helper function to extract email from raw email headers
function extractEmailFromHeaders(rawEmail) {
    try {
        const fromMatch = rawEmail.match(/From:\s*(?:.*?<)?([^\s<>]+@[^\s<>]+)(?:>)?/i);
        if (fromMatch && fromMatch[1]) {
            return fromMatch[1].toLowerCase().trim();
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Helper function to extract email body content
function extractEmailBody(rawEmail) {
    try {
        // Look for plain text content
        const plainTextMatch = rawEmail.match(/Content-Type:\s*text\/plain[^]*?Content-Transfer-Encoding:[^]*?\n\n([^]*?)(?:--|\n\n)/i);
        if (plainTextMatch && plainTextMatch[1]) {
            // Decode quoted-printable if necessary
            let body = plainTextMatch[1];
            if (rawEmail.includes('Content-Transfer-Encoding:quoted-printable')) {
                body = body.replace(/=\r?\n/g, '')
                          .replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
            }
            return body;
        }
        
        // Fallback to looking for any text after headers
        const bodyMatch = rawEmail.match(/\n\n([^]*)/);
        if (bodyMatch && bodyMatch[1]) {
            return bodyMatch[1];
        }
        
        return '';
    } catch (error) {
        return '';
    }
}

// Helper function to check if email contains unsubscribe request
function checkForUnsubscribeRequest(emailContent) {
    try {
        const unsubscribeKeywords = [
            'unsubscribe',
            'remove me',
            'deregister me',
            'stop sending me',
            'delete me',
            'opt out',
            'opt-out',
            'cancel subscription',
            'cancel my subscription',
            'remove from list',
            'remove from mailing list',
            'take me off',
            'stop emails',
            'stop email',
            'no more emails',
            'no more email'
        ];
        
        const lowerContent = emailContent.toLowerCase();
        
        for (const keyword of unsubscribeKeywords) {
            if (lowerContent.includes(keyword)) {
                return true;
            }
        }
        
        return false;
    } catch (error) {
        return false;
    }
}

// POST endpoint for /decideUnsubscribe
app.post('/decideUnsubscribe', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'string') {
            return res.status(400).json({
                error: 'Invalid request body'
            });
        }
        
        // Limit the size of the input to prevent DoS
        if (req.body.length > 10 * 1024 * 1024) { // 10MB limit
            return res.status(413).json({
                error: 'Request body too large'
            });
        }
        
        const rawEmail = req.body;
        
        // Extract email address
        const emailAddress = extractEmailFromHeaders(rawEmail);
        
        if (!emailAddress) {
            return res.status(400).json({
                error: 'Could not extract email address'
            });
        }
        
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailAddress)) {
            return res.status(400).json({
                error: 'Invalid email format'
            });
        }
        
        // Extract email body
        const emailBody = extractEmailBody(rawEmail);
        
        // Check for unsubscribe request
        const shouldUnsubscribe = checkForUnsubscribeRequest(emailBody);
        
        // Return response
        res.status(200).json({
            email: emailAddress,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        // Log error internally but don't expose details to client
        console.error('Error processing request:', error);
        
        // Return generic error message to avoid information disclosure
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Global error handler
app.use((err, req, res, next) => {
    // Log error internally
    console.error('Unhandled error:', err);
    
    // Return generic error message to avoid information disclosure
    if (!res.headersSent) {
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found'
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});