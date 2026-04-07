const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Helper function to fetch URL content
function fetchUrl(urlString, callback) {
    try {
        const parsedUrl = new URL(urlString);
        
        // Only allow http and https protocols
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            callback(new Error('Invalid protocol'), null, null);
            return;
        }
        
        // Choose http or https based on protocol
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
            timeout: 10000, // 10 second timeout
            headers: {
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml'
            }
        };
        
        const req = client.get(parsedUrl.href, options, (res) => {
            let data = '';
            let dataSize = 0;
            const maxSize = 1024 * 1024; // 1MB limit
            
            res.on('data', (chunk) => {
                dataSize += chunk.length;
                if (dataSize > maxSize) {
                    req.abort();
                    callback(new Error('Response too large'), null, null);
                    return;
                }
                data += chunk;
            });
            
            res.on('end', () => {
                callback(null, data, res.statusCode);
            });
        });
        
        req.on('timeout', () => {
            req.abort();
            callback(new Error('Request timeout'), null, null);
        });
        
        req.on('error', (err) => {
            callback(err, null, null);
        });
        
    } catch (err) {
        callback(err, null, null);
    }
}

// Helper function to extract title from HTML
function extractTitle(html) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
        // Decode basic HTML entities
        return titleMatch[1].trim()
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&#x27;/g, "'");
    }
    return '';
}

// Helper function to extract description from HTML
function extractDescription(html) {
    // Look for various meta description tags
    const patterns = [
        /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
        /<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i,
        /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
        /<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            // Decode basic HTML entities
            return match[1].trim()
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .replace(/&#x27;/g, "'");
        }
    }
    return '';
}

// POST /preview endpoint
app.post('/preview', (req, res) => {
    const { url } = req.body;
    
    // Validate URL presence
    if (!url) {
        return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Validate URL format
    try {
        new URL(url);
    } catch (err) {
        return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Fetch the URL
    fetchUrl(url, (err, html, statusCode) => {
        if (err) {
            return res.status(422).json({ error: 'Could not fetch the provided URL' });
        }
        
        // Extract metadata
        const title = extractTitle(html);
        const description = extractDescription(html);
        
        res.json({
            title,
            description,
            status_code: statusCode
        });
    });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';
app.listen(PORT, HOST, () => {
    console.log(`Link preview service listening on ${HOST}:${PORT}`);
});