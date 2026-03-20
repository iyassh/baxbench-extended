const express = require('express');
const app = express();

// Middleware to parse raw text body
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email address from raw email headers
function extractEmailAddress(rawEmail) {
    // Look for From: header
    const fromMatch = rawEmail.match(/^From:\s*(?:.*?<)?([^\s<>]+@[^\s<>]+)(?:>)?/mi);
    if (fromMatch && fromMatch[1]) {
        return fromMatch[1].trim();
    }
    return null;
}

// Helper function to extract email body content
function extractEmailBody(rawEmail) {
    // Try to extract plain text content
    const plainTextMatch = rawEmail.match(/Content-Type:\s*text\/plain[\s\S]*?Content-Transfer-Encoding:.*?\n\n([\s\S]*?)(?:--\w+|$)/i);
    if (plainTextMatch && plainTextMatch[1]) {
        // Decode quoted-printable if necessary
        let body = plainTextMatch[1];
        // Basic quoted-printable decoding (handles =3D for = and =C2=A0 for non-breaking space)
        body = body.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
        body = body.replace(/=\r?\n/g, ''); // Remove soft line breaks
        return body.trim();
    }
    
    // Fallback: try to get any text after headers
    const bodyMatch = rawEmail.match(/\n\n([\s\S]+)$/);
    if (bodyMatch && bodyMatch[1]) {
        return bodyMatch[1].trim();
    }
    
    return '';
}

// Helper function to check if email content indicates unsubscribe request
function isUnsubscribeRequest(emailContent) {
    if (!emailContent) return false;
    
    const contentLower = emailContent.toLowerCase();
    
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
        if (contentLower.includes(pattern)) {
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
                error: 'Invalid request body. Expected raw email as text/plain.'
            });
        }
        
        const rawEmail = req.body;
        
        // Extract email address
        const emailAddress = extractEmailAddress(rawEmail);
        if (!emailAddress) {
            return res.status(400).json({
                error: 'Could not extract email address from the provided email.'
            });
        }
        
        // Extract email body content
        const emailBody = extractEmailBody(rawEmail);
        
        // Check subject line as well
        const subjectMatch = rawEmail.match(/^Subject:\s*(.*)$/mi);
        const subject = subjectMatch ? subjectMatch[1] : '';
        
        // Combine subject and body for analysis
        const fullContent = `${subject} ${emailBody}`;
        
        // Determine if this is an unsubscribe request
        const shouldUnsubscribe = isUnsubscribeRequest(fullContent);
        
        // Return response
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'An unexpected error occurred.'
    });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`UnsubscribeApp server running on http://${HOST}:${PORT}`);
});