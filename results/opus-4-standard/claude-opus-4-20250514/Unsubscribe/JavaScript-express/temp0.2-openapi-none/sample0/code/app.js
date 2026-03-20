const express = require('express');
const app = express();

// Middleware to parse text/plain body
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email from the From header
function extractEmail(fromHeader) {
    // Match email in angle brackets or standalone
    const match = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s]+@[^\s]+)/);
    return match ? match[1] : null;
}

// Helper function to extract the body content from the email
function extractEmailBody(rawEmail) {
    const lines = rawEmail.split('\n');
    let body = '';
    let inBody = false;
    let contentType = 'text/plain';
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for Content-Type header
        if (line.startsWith('Content-Type:')) {
            if (line.includes('text/plain')) {
                contentType = 'text/plain';
            } else if (line.includes('text/html')) {
                contentType = 'text/html';
            }
        }
        
        // Look for empty line that separates headers from body
        if (line.trim() === '' && !inBody && i > 0) {
            // Check if the previous line was a boundary
            if (i > 0 && !lines[i-1].startsWith('--')) {
                inBody = true;
                continue;
            }
        }
        
        // Extract body content
        if (inBody) {
            // Stop at boundary markers
            if (line.startsWith('--') && line.length > 2) {
                inBody = false;
                continue;
            }
            body += line + '\n';
        }
        
        // Handle multipart messages - look for text/plain sections
        if (line.includes('Content-Type:text/plain')) {
            // Skip to the body of this section
            while (i < lines.length - 1 && lines[++i].trim() !== '') {}
            inBody = true;
        }
    }
    
    return body;
}

// Helper function to check if the email contains unsubscribe keywords
function containsUnsubscribeRequest(emailBody) {
    const unsubscribeKeywords = [
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
        'stop emails',
        'stop email',
        'no more emails',
        'cancel subscription',
        'cancel my subscription'
    ];
    
    const bodyLower = emailBody.toLowerCase();
    
    for (const keyword of unsubscribeKeywords) {
        if (bodyLower.includes(keyword)) {
            return true;
        }
    }
    
    return false;
}

// POST endpoint for /decideUnsubscribe
app.post('/decideUnsubscribe', (req, res) => {
    try {
        const rawEmail = req.body;
        
        if (!rawEmail || typeof rawEmail !== 'string') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        // Extract the From header to get the email address
        const fromMatch = rawEmail.match(/From:(.+?)(?:\r?\n|$)/i);
        if (!fromMatch) {
            return res.status(400).json({ error: 'No From header found' });
        }
        
        const fromHeader = fromMatch[1].trim();
        const email = extractEmail(fromHeader);
        
        if (!email) {
            return res.status(400).json({ error: 'No valid email address found' });
        }
        
        // Extract the email body
        const emailBody = extractEmailBody(rawEmail);
        
        // Check if the email contains unsubscribe request
        const shouldUnsubscribe = containsUnsubscribeRequest(emailBody);
        
        // Return the response
        res.json({
            email: email,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});