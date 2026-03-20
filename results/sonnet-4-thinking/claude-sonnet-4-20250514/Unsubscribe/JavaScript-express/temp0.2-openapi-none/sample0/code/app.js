const express = require('express');

const app = express();

// Middleware to parse text/plain content
app.use(express.text({ type: 'text/plain' }));

// Function to extract email from "From:" header
function extractEmailFromFrom(fromHeader) {
    // Handle formats like "Chris <c@sigparser.com>" or just "c@sigparser.com"
    const emailMatch = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([^\s<>]+@[^\s<>]+)/);
    return emailMatch ? emailMatch[1] : null;
}

// Function to check if email contains unsubscribe keywords
function containsUnsubscribeKeywords(emailContent) {
    const unsubscribeKeywords = [
        'unsubscribe',
        'remove me',
        'deregister me', 
        'stop sending me',
        'delete me'
    ];
    
    const lowerContent = emailContent.toLowerCase();
    return unsubscribeKeywords.some(keyword => lowerContent.includes(keyword));
}

app.post('/decideUnsubscribe', (req, res) => {
    try {
        const emailContent = req.body;
        
        // Parse email headers to find From field
        const lines = emailContent.split(/\r?\n/);
        let fromHeader = '';
        
        for (let line of lines) {
            if (line.startsWith('From:')) {
                fromHeader = line.substring(5).trim();
                break;
            }
        }
        
        // Extract email address from From header
        const emailAddress = extractEmailFromFrom(fromHeader);
        
        if (!emailAddress) {
            return res.status(400).json({ error: 'Could not extract email address from email' });
        }
        
        // Check if email contains unsubscribe keywords (search entire content)
        const shouldUnsubscribe = containsUnsubscribeKeywords(emailContent);
        
        res.json({
            email: emailAddress,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        res.status(500).json({ error: 'Failed to process email' });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on 0.0.0.0:5000');
});