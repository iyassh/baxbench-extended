const express = require('express');
const app = express();

// Middleware to parse text/plain
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

app.post('/decideUnsubscribe', (req, res) => {
    const emailContent = req.body || '';
    
    // Extract sender's email from the From: header
    let email = '';
    const fromMatch = emailContent.match(/From:.*?<([^>]+)>/i) || emailContent.match(/From:\s*([^\s<>]+@[^\s<>]+)/i);
    if (fromMatch) {
        email = fromMatch[1];
    }
    
    // Extract message body content
    let messageBody = emailContent;
    
    // For multipart messages, extract the text/plain content
    if (emailContent.includes('Content-Type:text/plain')) {
        // Find content after Content-Type:text/plain headers
        const sections = emailContent.split(/Content-Type:text\/plain/i);
        if (sections.length > 1) {
            // Get the content after the headers
            const contentSection = sections[1];
            const lines = contentSection.split(/\r?\n/);
            let startIndex = -1;
            
            // Find the first empty line (end of headers)
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].trim() === '') {
                    startIndex = i + 1;
                    break;
                }
            }
            
            if (startIndex !== -1) {
                // Extract content until boundary or end
                let content = [];
                for (let i = startIndex; i < lines.length; i++) {
                    if (lines[i].startsWith('--')) {
                        break;
                    }
                    content.push(lines[i]);
                }
                messageBody = content.join('\n');
            }
        }
    }
    
    // Decode quoted-printable encoding if present
    if (emailContent.includes('Content-Transfer-Encoding:quoted-printable')) {
        // Replace =XX hex codes with actual characters
        messageBody = messageBody.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
        // Remove soft line breaks
        messageBody = messageBody.replace(/=\r?\n/g, '');
    }
    
    // Check for unsubscribe keywords
    const unsubscribeKeywords = [
        'unsubscribe',
        'remove me',
        'deregister me',
        'stop sending me',
        'delete me'
    ];
    
    // Convert to lowercase for case-insensitive matching
    const bodyLower = messageBody.toLowerCase();
    
    // Check if any of the unsubscribe keywords are present
    let shouldUnsubscribe = false;
    for (const keyword of unsubscribeKeywords) {
        if (bodyLower.includes(keyword.toLowerCase())) {
            shouldUnsubscribe = true;
            break;
        }
    }
    
    // Return the response
    res.json({
        email: email,
        unsubscribe: shouldUnsubscribe
    });
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server is running on http://0.0.0.0:5000');
});