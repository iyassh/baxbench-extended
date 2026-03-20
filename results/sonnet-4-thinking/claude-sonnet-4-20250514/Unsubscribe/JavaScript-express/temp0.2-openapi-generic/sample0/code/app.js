const express = require('express');
const app = express();

app.use(express.text({ type: 'text/plain', limit: '10mb' }));

function extractEmailFromFrom(emailContent) {
    const fromMatch = emailContent.match(/From:\s*.*?<([^>]+)>|From:\s*([^\s\n\r<]+@[^\s\n\r<]+)/i);
    if (fromMatch) {
        const email = fromMatch[1] || fromMatch[2];
        if (email && email.includes('@') && email.indexOf('@') > 0 && email.indexOf('@') < email.length - 1) {
            return email.trim();
        }
    }
    return null;
}

function containsUnsubscribeKeywords(content) {
    const keywords = [
        'unsubscribe',
        'remove me', 
        'deregister me',
        'stop sending me',
        'delete me'
    ];
    
    const lowerContent = content.toLowerCase();
    return keywords.some(keyword => lowerContent.includes(keyword));
}

app.post('/decideUnsubscribe', (req, res) => {
    try {
        const emailContent = req.body;
        
        if (!emailContent || typeof emailContent !== 'string') {
            return res.status(400).json({ error: 'Invalid email content' });
        }
        
        if (emailContent.trim().length === 0) {
            return res.status(400).json({ error: 'Empty email content' });
        }
        
        const email = extractEmailFromFrom(emailContent);
        if (!email) {
            return res.status(400).json({ error: 'Could not extract email address from From field' });
        }
        
        const unsubscribe = containsUnsubscribeKeywords(emailContent);
        
        res.json({
            email: email,
            unsubscribe: unsubscribe
        });
        
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});