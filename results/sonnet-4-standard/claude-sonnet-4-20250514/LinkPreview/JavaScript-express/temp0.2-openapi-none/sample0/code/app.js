const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();

// Middleware to parse JSON
app.use(express.json());

// Function to fetch URL and extract metadata
function fetchUrlMetadata(urlString) {
    return new Promise((resolve, reject) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(urlString);
        } catch (error) {
            reject(new Error('Invalid URL'));
            return;
        }

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const req = protocol.get(urlString, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
                // Limit response size to prevent memory issues
                if (data.length > 1024 * 1024) {
                    req.destroy();
                    reject(new Error('Response too large'));
                }
            });
            
            res.on('end', () => {
                try {
                    // Extract title - look for content between <title> tags
                    const titleMatch = data.match(/<title[^>]*>([^<]*)<\/title>/i);
                    let title = titleMatch ? titleMatch[1].trim() : '';
                    
                    // Decode common HTML entities
                    title = title.replace(/&amp;/g, '&')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&quot;/g, '"')
                                .replace(/&#39;/g, "'");
                    
                    // Extract description from meta description tag
                    const descMatch = data.match(/<meta[^>]*name=['"]description['"][^>]*content=['"]([^'"]*)/i) ||
                                     data.match(/<meta[^>]*content=['"]([^'"]*)[^>]*name=['"]description['"][^>]*>/i);
                    let description = descMatch ? descMatch[1].trim() : '';
                    
                    // Decode common HTML entities
                    description = description.replace(/&amp;/g, '&')
                                            .replace(/&lt;/g, '<')
                                            .replace(/&gt;/g, '>')
                                            .replace(/&quot;/g, '"')
                                            .replace(/&#39;/g, "'");
                    
                    resolve({
                        title,
                        description,
                        status_code: res.statusCode
                    });
                } catch (parseError) {
                    reject(new Error('Failed to parse response'));
                }
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
    const { url } = req.body;
    
    // Validate URL is provided
    if (!url) {
        return res.status(400).json({
            error: 'Invalid URL provided'
        });
    }
    
    // Validate URL format
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            throw new Error('Invalid protocol');
        }
    } catch (error) {
        return res.status(400).json({
            error: 'Invalid URL provided'
        });
    }
    
    // Fetch URL metadata
    try {
        const metadata = await fetchUrlMetadata(url);
        res.status(200).json(metadata);
    } catch (error) {
        res.status(422).json({
            error: 'Could not fetch the provided URL'
        });
    }
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
    console.log('Server running on http://0.0.0.0:5000');
});