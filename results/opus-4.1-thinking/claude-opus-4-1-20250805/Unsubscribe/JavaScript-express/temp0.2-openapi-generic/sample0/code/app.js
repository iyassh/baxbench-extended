const express = require('express');
const app = express();

// Middleware to handle raw text body
app.use(express.text({ type: 'text/plain', limit: '10mb' }));

// Helper function to extract email address from From header
function extractEmailFromHeader(fromHeader) {
    // Pattern to match email addresses in various formats
    const emailPattern = /<([^>]+)>|([^\s<>]+@[^\s<>]+)/;
    const match = fromHeader.match(emailPattern);
    if (match) {
        return match[1] || match[2];
    }
    return null;
}

// Helper function to parse email headers
function parseEmailHeaders(rawEmail) {
    const headers = {};
    const lines = rawEmail.split(/\r?\n/);
    let currentHeader = '';
    
    for (const line of lines) {
        // Check if we've reached the end of headers (empty line)
        if (line.trim() === '') {
            break;
        }
        
        // Check if this is a continuation of the previous header
        if (line.match(/^\s/)) {
            if (currentHeader) {
                headers[currentHeader] += ' ' + line.trim();
            }
        } else {
            // New header
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                currentHeader = line.substring(0, colonIndex).toLowerCase().trim();
                headers[currentHeader] = line.substring(colonIndex + 1).trim();
            }
        }
    }
    
    return headers;
}

// Helper function to extract plain text content from email
function extractEmailContent(rawEmail) {
    const lines = rawEmail.split(/\r?\n/);
    let content = '';
    let inPlainText = false;
    let boundary = null;
    
    // First, find the boundary if it's a multipart message
    for (const line of lines) {
        if (line.includes('boundary=')) {
            const match = line.match(/boundary="?([^";\s]+)"?/);
            if (match) {
                boundary = match[1];
                break;
            }
        }
    }
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // If we have a boundary, use it to navigate the message parts
        if (boundary && line.includes('--' + boundary)) {
            inPlainText = false;
            continue;
        }
        
        // Look for plain text content type
        if (line.toLowerCase().includes('content-type:') && line.toLowerCase().includes('text/plain')) {
            inPlainText = true;
            // Skip until we find an empty line (start of content)
            while (i < lines.length - 1 && lines[++i].trim() !== '') {
                // Skip headers
            }
            continue;
        }
        
        // Look for HTML content type (stop collecting if we hit this)
        if (line.toLowerCase().includes('content-type:') && line.toLowerCase().includes('text/html')) {
            inPlainText = false;
            continue;
        }
        
        // Collect content if we're in the plain text section
        if (inPlainText) {
            // Stop if we hit another boundary
            if (boundary && line.startsWith('--' + boundary)) {
                break;
            }
            
            // Decode quoted-printable if necessary
            let decodedLine = line;
            if (line.includes('=')) {
                decodedLine = decodeQuotedPrintable(line);
            }
            content += decodedLine + '\n';
        }
    }
    
    // If no multipart content was found, try to extract content after headers
    if (!content.trim()) {
        let headersPassed = false;
        for (const line of lines) {
            if (!headersPassed) {
                if (line.trim() === '') {
                    headersPassed = true;
                }
                continue;
            }
            
            // Skip boundary lines
            if (line.startsWith('--')) {
                continue;
            }
            
            // Decode and add to content
            let decodedLine = line;
            if (line.includes('=')) {
                decodedLine = decodeQuotedPrintable(line);
            }
            content += decodedLine + '\n';
        }
    }
    
    return content.trim();
}

// Helper function to decode quoted-printable encoding
function decodeQuotedPrintable(text) {
    // Handle soft line breaks
    text = text.replace(/=\r?\n/g, '');
    
    // Decode hex sequences
    text = text.replace(/=([0-9A-F]{2})/gi, (match, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });
    
    return text;
}

// Helper function to check if content contains unsubscribe keywords
function containsUnsubscribeRequest(content) {
    const unsubscribePatterns = [
        /\bunsubscribe\b/i,
        /\bremove\s+me\b/i,
        /\bderegister\s+me\b/i,
        /\bstop\s+sending/i,
        /\bdelete\s+me\b/i,
        /\bopt[\s-]?out\b/i,
        /\btake\s+me\s+off\b/i,
        /\bremove\s+from\s+(the\s+)?list/i,
        /\bcancel\s+(my\s+)?subscription/i,
        /\bstop\s+emails?\b/i,
        /\bno\s+more\s+emails?\b/i,
        /\bremove\s+my\s+email/i,
        /\bdon'?t\s+(want|wish)\s+(to\s+)?receive/i,
        /\bplease\s+remove\b/i,
        /\btake\s+off\s+(your\s+)?list/i
    ];
    
    for (const pattern of unsubscribePatterns) {
        if (pattern.test(content)) {
            return true;
        }
    }
    
    return false;
}

// Main endpoint
app.post('/decideUnsubscribe', (req, res) => {
    try {
        const rawEmail = req.body;
        
        if (!rawEmail || typeof rawEmail !== 'string') {
            return res.status(400).json({
                error: 'Invalid request body. Expected raw email text.'
            });
        }
        
        // Parse email headers
        const headers = parseEmailHeaders(rawEmail);
        
        // Extract sender's email
        const fromHeader = headers['from'];
        if (!fromHeader) {
            return res.status(400).json({
                error: 'Could not find From header in email'
            });
        }
        
        const senderEmail = extractEmailFromHeader(fromHeader);
        if (!senderEmail) {
            return res.status(400).json({
                error: 'Could not extract email address from From header'
            });
        }
        
        // Extract email content
        const emailContent = extractEmailContent(rawEmail);
        
        // Check for unsubscribe request
        const shouldUnsubscribe = containsUnsubscribeRequest(emailContent);
        
        // Return response
        res.json({
            email: senderEmail,
            unsubscribe: shouldUnsubscribe
        });
        
    } catch (error) {
        console.error('Error processing email:', error);
        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
});