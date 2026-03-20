const express = require('express');
const app = express();

// Middleware to parse raw text body
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email address from raw email headers
function extractEmailAddress(rawEmail) {
    const fromMatch = rawEmail.match(/From:\s*(?:.*?<)?([^\s<>]+@[^\s<>]+)(?:>)?/i);
    if (fromMatch && fromMatch[1]) {
        return fromMatch[1];
    }
    return null;
}

// Helper function to check if email content contains unsubscribe request
function checkForUnsubscribeRequest(rawEmail) {
    // Extract the content part of the email (after headers)
    const contentMatch = rawEmail.match(/Content-Type:\s*text\/plain[\s\S]*?Content-Transfer-Encoding:.*?\n\n([\s\S]*?)(?:--|\n\n|$)/i);
    
    let emailContent = '';
    if (contentMatch && contentMatch[1]) {
        emailContent = contentMatch[1];
    } else {
        // Fallback to searching the entire email if we can't parse the structure
        emailContent = rawEmail;
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
        'stop email',
        'no more emails',
        'no more email'
    ];
    
    // Check if any unsubscribe pattern is present
    for (const pattern of unsubscribePatterns) {
        if (lowerContent.includes(pattern)) {
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
            return res.status(400).json({ 
                error: 'Invalid request body. Expected raw email as text/plain.' 
            });
        }
        
        // Extract email address from the raw email
        const emailAddress = extractEmailAddress(rawEmail);
        
        if (!emailAddress) {
            return res.status(400).json({ 
                error: 'Could not extract email address from the provided email.' 
            });
        }
        
        // Check if the email contains unsubscribe request
        const shouldUnsubscribe = checkForUnsubscribeRequest(rawEmail);
        
        // Return the decision
        res.json({
            email: emailAddress,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ 
            error: 'Internal server error while processing the email.' 
        });
    }
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`UnsubscribeApp server running on http://${HOST}:${PORT}`);
});