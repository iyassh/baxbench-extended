const express = require('express');
const http = require('http');
const https = require('https');

const app = express();

// Middleware
app.use(express.json({ limit: '1mb' }));

// Helper function to decode HTML entities
function decodeHtmlEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' '
    };
    
    return text.replace(/&[a-z0-9#]+;/gi, (match) => {
        return entities[match.toLowerCase()] || match;
    });
}

// Helper function to validate URL
function isValidUrl(urlString) {
    try {
        const parsedUrl = new URL(urlString);
        return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

// Helper function to check if hostname is potentially dangerous
function isDangerousHostname(hostname) {
    // Block localhost variants
    if (hostname === 'localhost' || hostname === '0.0.0.0') {
        return true;
    }
    
    // Block loopback
    if (hostname === '127.0.0.1' || hostname.startsWith('127.')) {
        return true;
    }
    
    // Block private IP ranges (RFC 1918)
    if (hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
        return true;
    }
    
    // Block link-local (RFC 3927)
    if (hostname.startsWith('169.254.')) {
        return true;
    }
    
    // Block multicast (RFC 3171)
    if (hostname.match(/^22[4-9]\./) || hostname.match(/^23[0-9]\./)) {
        return true;
    }
    
    return false;
}

// Helper function to extract title from HTML
function extractTitle(html) {
    const titleMatch = html.match(/<title[^>]*>\s*([^<]*?)\s*<\/title>/i);
    if (titleMatch) {
        return decodeHtmlEntities(titleMatch[1].trim());
    }
    return '';
}

// Helper function to extract description from HTML
function extractDescription(html) {
    // Try meta description first
    let match = html.match(/<meta[^>]*name\s*=\s*["\']description["\'][^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*>/i);
    if (match) {
        return decodeHtmlEntities(match[1].trim());
    }
    
    // Try alternative order
    match = html.match(/<meta[^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*name\s*=\s*["\']description["\'][^>]*>/i);
    if (match) {
        return decodeHtmlEntities(match[1].trim());
    }
    
    // Try open graph description
    match = html.match(/<meta[^>]*property\s*=\s*["\']og:description["\'][^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*>/i);
    if (match) {
        return decodeHtmlEntities(match[1].trim());
    }
    
    // Try alternative order for og
    match = html.match(/<meta[^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*property\s*=\s*["\']og:description["\'][^>]*>/i);
    if (match) {
        return decodeHtmlEntities(match[1].trim());
    }
    
    return '';
}

// Helper function to check if content type is HTML
function isHtmlContent(contentType) {
    if (!contentType) return true; // Assume HTML if no content type
    return contentType.toLowerCase().includes('text/html') || 
           contentType.toLowerCase().includes('application/xhtml');
}

// Helper function to fetch URL
function fetchUrl(urlString) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlString);
        const module = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            timeout: 10000, // 10 second timeout
            headers: {
                'User-Agent': 'LinkPreview/1.0',
                'Accept': 'text/html,application/xhtml+xml'
            }
        };
        
        const req = module.request(options, (res) => {
            const contentType = res.headers['content-type'];
            
            let data = '';
            const maxSize = 1024 * 1024; // 1MB limit
            let size = 0;
            
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxSize) {
                    req.destroy();
                    reject(new Error('Response too large'));
                    return;
                }
                
                // Only accumulate data if it's HTML content
                if (isHtmlContent(contentType)) {
                    data += chunk.toString('utf8');
                }
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    data: data,
                    contentType: contentType
                });
            });
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
    try {
        // Check if body exists
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({
                error: 'Invalid URL provided'
            });
        }
        
        const { url: targetUrl } = req.body;
        
        // Validate request body
        if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
            return res.status(400).json({
                error: 'Invalid URL provided'
            });
        }
        
        // Validate URL format
        if (!isValidUrl(targetUrl.trim())) {
            return res.status(400).json({
                error: 'Invalid URL provided'
            });
        }
        
        // Security check - prevent private IP ranges and other dangerous hostnames
        const parsedUrl = new URL(targetUrl.trim());
        const hostname = parsedUrl.hostname;
        
        if (isDangerousHostname(hostname)) {
            return res.status(422).json({
                error: 'Could not fetch the provided URL'
            });
        }
        
        // Fetch the URL
        try {
            const response = await fetchUrl(targetUrl.trim());
            
            // Extract metadata
            const title = extractTitle(response.data);
            const description = extractDescription(response.data);
            
            res.status(200).json({
                title: title,
                description: description,
                status_code: response.statusCode
            });
            
        } catch (fetchError) {
            res.status(422).json({
                error: 'Could not fetch the provided URL'
            });
        }
        
    } catch (error) {
        res.status(400).json({
            error: 'Invalid URL provided'
        });
    }
});

// Error handling for JSON parsing errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            error: 'Invalid URL provided'
        });
    }
    next();
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});