const express = require('express');

const app = express();

// Middleware to parse text/plain bodies
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Security middleware to set security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Helper function to extract email address from the From field
function extractEmailFromFrom(fromField) {
    // Handle formats like "Name <email@example.com>" or just "email@example.com"
    const emailMatch = fromField.match(/<(.+)>/) || fromField.match(/^(.+)$/);
    return emailMatch ? emailMatch[1].trim() : null;
}

// Helper function to extract text content from MIME email
function extractTextContent(rawEmail) {
    // Try to find text/plain content
    const textPlainMatch = rawEmail.match(/Content-Type:\s*text\/plain[\s\S]*?\n\n([\s\S]*?)(?=--\w+|$)/i);
    if (textPlainMatch) {
        // Decode quoted-printable encoding
        let content = textPlainMatch[1];
        // Basic quoted-printable decoding (handle =XX hex codes)
        content = content.replace(/=([0-9A-F]{2})/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
        content = content.replace(/=\r?\n/g, ''); // Remove soft line breaks
        return content.trim();
    }
    
    // If no MIME structure found, return the whole email body after headers
    const bodyMatch = rawEmail.match(/\n\n([\s\S]+)$/);
    return bodyMatch ? bodyMatch[1].trim() : '';
}

// Helper function to check if the email content contains unsubscribe keywords
function containsUnsubscribeKeywords(content) {
    const keywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me',
        'opt out',
        'opt-out',
        'cancel subscription',
        'stop emails',
        'stop email',
        'take me off',
        'remove from list',
        'remove from mailing',
        'cancel my subscription',
        'stop these emails',
        'do not email',
        'no longer wish to receive'
    ];
    
    const lowerContent = content.toLowerCase();
    return keywords.some(keyword => lowerContent.includes(keyword));
}

app.post('/decideUnsubscribe', (req, res) => {
    try {
        // Check if body is provided
        if (!req.body || typeof req.body !== 'string') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        const rawEmail = req.body;
        
        // Extract the From field
        const fromMatch = rawEmail.match(/^From:(.+)$/mi);
        if (!fromMatch) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const fromField = fromMatch[1].trim();
        const email = extractEmailFromFrom(fromField);
        
        if (!email) {
            return res.status(400).json({ error: 'Could not extract email address' });
        }
        
        // Validate email format (basic validation)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email address format' });
        }
        
        // Extract the text content from the email
        const textContent = extractTextContent(rawEmail);
        
        // Check if the email content contains unsubscribe keywords
        const unsubscribe = containsUnsubscribeKeywords(textContent);
        
        res.json({
            email: email,
            unsubscribe: unsubscribe
        });
        
    } catch (error) {
        // Don't expose internal error details (CWE-209)
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 404 handler for undefined routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    // Don't expose internal error details (CWE-209)
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
});