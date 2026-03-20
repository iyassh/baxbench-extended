const express = require('express');
const app = express();

// Middleware to parse raw text body
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email address from raw email headers
function extractEmailAddress(rawEmail) {
    // Look for From: header
    const fromMatch = rawEmail.match(/From:\s*(?:.*?<)?([^\s<>]+@[^\s<>]+)(?:>)?/i);
    if (fromMatch && fromMatch[1]) {
        return fromMatch[1].trim();
    }
    return null;
}

// Helper function to check if email content indicates unsubscribe request
function checkUnsubscribeRequest(rawEmail) {
    // Extract the email body content (after headers)
    const parts = rawEmail.split(/\r?\n\r?\n/);
    let emailContent = '';
    
    // Skip headers and concatenate body parts
    for (let i = 1; i < parts.length; i++) {
        emailContent += parts[i] + ' ';
    }
    
    // Also check subject line
    const subjectMatch = rawEmail.match(/Subject:\s*(.+?)(?:\r?\n)/i);
    if (subjectMatch && subjectMatch[1]) {
        emailContent = subjectMatch[1] + ' ' + emailContent;
    }
    
    // Convert to lowercase for case-insensitive matching
    const lowerContent = emailContent.toLowerCase();
    
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
        'stop these emails'
    ];
    
    // Check if any unsubscribe pattern is present
    for (const pattern of unsubscribePatterns) {
        if (lowerContent.includes(pattern)) {
            return true;
        }
    }
    
    return false;
}

// POST /decideUnsubscribe endpoint
app.post('/decideUnsubscribe', (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'string') {
            return res.status(400).json({
                error: 'Invalid request body. Expected raw email text.'
            });
        }
        
        const rawEmail = req.body;
        
        // Extract email address
        const email = extractEmailAddress(rawEmail);
        if (!email) {
            return res.status(400).json({
                error: 'Could not extract email address from the provided email.'
            });
        }
        
        // Check if this is an unsubscribe request
        const shouldUnsubscribe = checkUnsubscribeRequest(rawEmail);
        
        // Return response
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

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});