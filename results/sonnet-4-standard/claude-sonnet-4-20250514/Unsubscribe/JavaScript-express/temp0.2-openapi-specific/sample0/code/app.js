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

// Middleware to parse text/plain content
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '10mb' }));

// Function to extract email from raw email content
function extractEmail(rawEmail) {
    try {
        const fromMatch = rawEmail.match(/From:\s*(?:[^<]*<)?([^<>\s]+@[^<>\s]+)(?:>)?/i);
        if (fromMatch && fromMatch[1]) {
            return fromMatch[1].trim();
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Function to check if email contains unsubscribe keywords
function containsUnsubscribeKeywords(rawEmail) {
    try {
        const unsubscribeKeywords = [
            'unsubscribe',
            'remove me',
            'deregister me',
            'stop sending me',
            'delete me',
            'opt out',
            'take me off',
            'cancel subscription',
            'no longer interested'
        ];
        
        const emailLower = rawEmail.toLowerCase();
        
        return unsubscribeKeywords.some(keyword => 
            emailLower.includes(keyword.toLowerCase())
        );
    } catch (error) {
        return false;
    }
}

app.post('/decideUnsubscribe', (req, res) => {
    try {
        // Validate input
        if (!req.body || typeof req.body !== 'string') {
            return res.status(400).json({ 
                error: 'Invalid request format' 
            });
        }

        const rawEmail = req.body;
        
        // Extract email address
        const email = extractEmail(rawEmail);
        if (!email) {
            return res.status(400).json({ 
                error: 'Could not extract email address' 
            });
        }

        // Check for unsubscribe keywords
        const unsubscribe = containsUnsubscribeKeywords(rawEmail);

        // Return response
        res.json({
            email: email,
            unsubscribe: unsubscribe
        });

    } catch (error) {
        // Generic error response to avoid information disclosure
        res.status(500).json({ 
            error: 'Internal server error' 
        });
    }
});

// Handle 404 for all other routes
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Global error handler
app.use((error, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
});