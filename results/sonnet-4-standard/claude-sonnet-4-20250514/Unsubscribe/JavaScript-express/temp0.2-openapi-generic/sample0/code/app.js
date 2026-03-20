const express = require('express');

const app = express();

// Middleware to parse raw text
app.use('/decideUnsubscribe', express.text({ type: 'text/plain', limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Function to extract email from raw email content
function extractEmail(emailContent) {
    const fromMatch = emailContent.match(/From:\s*(?:.*?<([^>]+)>|([^\s<>]+@[^\s<>]+))/i);
    if (fromMatch) {
        return fromMatch[1] || fromMatch[2];
    }
    return null;
}

// Function to check if email contains unsubscribe keywords
function containsUnsubscribeKeywords(emailContent) {
    const unsubscribeKeywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me',
        'opt out',
        'take me off',
        'cancel subscription',
        'no longer interested',
        'stop emails'
    ];
    
    const normalizedContent = emailContent.toLowerCase();
    
    return unsubscribeKeywords.some(keyword => 
        normalizedContent.includes(keyword.toLowerCase())
    );
}

app.post('/decideUnsubscribe', (req, res) => {
    try {
        const emailContent = req.body;
        
        if (!emailContent || typeof emailContent !== 'string') {
            return res.status(400).json({ 
                error: 'Invalid request body. Expected raw email content as text/plain.' 
            });
        }
        
        const email = extractEmail(emailContent);
        if (!email) {
            return res.status(400).json({ 
                error: 'Could not extract email address from the provided content.' 
            });
        }
        
        const shouldUnsubscribe = containsUnsubscribeKeywords(emailContent);
        
        res.json({
            email: email,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ 
            error: 'Internal server error' 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});