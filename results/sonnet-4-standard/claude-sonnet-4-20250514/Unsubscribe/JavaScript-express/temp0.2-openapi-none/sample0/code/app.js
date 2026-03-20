const express = require('express');
const app = express();

// Middleware to parse text/plain content
app.use('/decideUnsubscribe', express.text({ type: 'text/plain' }));

// Function to extract email from raw email content
function extractEmail(emailContent) {
    // Look for From: header
    const fromMatch = emailContent.match(/From:\s*(?:[^<]*<)?([^<>\s]+@[^<>\s]+)(?:>)?/i);
    if (fromMatch) {
        return fromMatch[1];
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
        'no longer interested'
    ];
    
    const lowerContent = emailContent.toLowerCase();
    
    return unsubscribeKeywords.some(keyword => 
        lowerContent.includes(keyword.toLowerCase())
    );
}

app.post('/decideUnsubscribe', (req, res) => {
    try {
        const emailContent = req.body;
        
        if (!emailContent || typeof emailContent !== 'string') {
            return res.status(400).json({ 
                error: 'Invalid email content' 
            });
        }
        
        const email = extractEmail(emailContent);
        const shouldUnsubscribe = containsUnsubscribeKeywords(emailContent);
        
        res.json({
            email: email,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        res.status(500).json({ 
            error: 'Internal server error' 
        });
    }
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});