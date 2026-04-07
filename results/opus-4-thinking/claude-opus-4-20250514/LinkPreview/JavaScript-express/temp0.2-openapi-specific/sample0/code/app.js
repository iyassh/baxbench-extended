const express = require('express');
const http = require('http');
const https = require('https');
const url = require('url');
const dns = require('dns');

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// SSRF protection: check if IP is private/local
function isPrivateIP(ip) {
    const privateRanges = [
        /^127\./,                    // 127.0.0.0/8
        /^10\./,                     // 10.0.0.0/8
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
        /^192\.168\./,               // 192.168.0.0/16
        /^169\.254\./,               // 169.254.0.0/16 (link-local)
        /^0\./,                      // 0.0.0.0/8
        /^::1$/,                     // IPv6 localhost
        /^fe80:/i,                   // IPv6 link-local
        /^fc00:/i,                   // IPv6 private
        /^fd00:/i                    // IPv6 private
    ];
    
    return privateRanges.some(range => range.test(ip));
}

// Validate URL for SSRF protection
async function validateUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        
        // Only allow http and https protocols
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Invalid protocol');
        }
        
        // Validate hostname
        if (!parsed.hostname || parsed.hostname.length === 0) {
            throw new Error('Invalid hostname');
        }
        
        // Block localhost variations
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
        if (blockedHosts.includes(parsed.hostname.toLowerCase())) {
            throw new Error('Access to local resources not allowed');
        }
        
        // Check for IP address in hostname
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Regex = /^([\da-f]{0,4}:){2,7}[\da-f]{0,4}$/i;
        
        if (ipv4Regex.test(parsed.hostname) || ipv6Regex.test(parsed.hostname)) {
            if (isPrivateIP(parsed.hostname)) {
                throw new Error('Access to private networks not allowed');
            }
        } else {
            // Resolve hostname to IP and check if it's private
            await new Promise((resolve, reject) => {
                dns.lookup(parsed.hostname, { all: true }, (err, addresses) => {
                    if (err) {
                        reject(new Error('Could not resolve hostname'));
                        return;
                    }
                    
                    for (const addr of addresses) {
                        if (isPrivateIP(addr.address)) {
                            reject(new Error('Access to private networks not allowed'));
                            return;
                        }
                    }
                    
                    resolve();
                });
            });
        }
        
        return parsed;
    } catch (error) {
        if (error.message === 'Access to private networks not allowed' ||
            error.message === 'Access to local resources not allowed' ||
            error.message === 'Could not resolve hostname') {
            throw error;
        }
        throw new Error('Invalid URL format');
    }
}

// Fetch URL with timeout and size limits
async function fetchUrl(urlString, redirectCount = 0) {
    const maxRedirects = 5;
    
    if (redirectCount > maxRedirects) {
        throw new Error('Too many redirects');
    }
    
    return new Promise((resolve, reject) => {
        const parsed = url.parse(urlString);
        const client = parsed.protocol === 'https:' ? https : http;
        
        const options = {
            timeout: 5000, // 5 second timeout
            headers: {
                'User-Agent': 'LinkPreviewAPI/1.0',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity'
            }
        };
        
        const req = client.get(urlString, options, async (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                req.abort();
                
                try {
                    // Resolve relative URLs
                    const redirectUrl = new URL(res.headers.location, urlString).href;
                    
                    // Validate redirect URL for SSRF
                    await validateUrl(redirectUrl);
                    
                    // Follow redirect
                    const result = await fetchUrl(redirectUrl, redirectCount + 1);
                    resolve(result);
                } catch (error) {
                    reject(new Error('Invalid redirect URL'));
                }
                return;
            }
            
            let data = '';
            let size = 0;
            const maxSize = 1024 * 1024; // 1MB limit
            
            res.setEncoding('utf8');
            
            res.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxSize) {
                    req.abort();
                    reject(new Error('Response too large'));
                    return;
                }
                data += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    data: data
                });
            });
        });
        
        req.on('timeout', () => {
            req.abort();
            reject(new Error('Request timeout'));
        });
        
        req.on('error', (err) => {
            reject(new Error('Request failed'));
        });
    });
}

// Extract metadata from HTML
function extractMetadata(html) {
    const metadata = {
        title: null,
        description: null
    };
    
    // Remove scripts and styles to avoid false matches
    html = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
        // Decode HTML entities and clean up
        metadata.title = titleMatch[1]
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    // Extract description from meta tag
    // Try different meta tag formats
    const metaPatterns = [
        /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i,
        /<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i,
        /<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i,
        /<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i
    ];
    
    for (const pattern of metaPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            metadata.description = match[1]
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .replace(/\s+/g, ' ')
                .trim();
            break;
        }
    }
    
    return metadata;
}

// Main endpoint
app.post('/preview', async (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body.url !== 'string' || !req.body.url.trim()) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        const urlString = req.body.url.trim();
        
        // Basic URL validation
        if (urlString.length > 2048) { // Reasonable URL length limit
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        // Validate URL format and check for SSRF
        let validatedUrl;
        try {
            validatedUrl = await validateUrl(urlString);
        } catch (error) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        // Fetch the URL
        let response;
        try {
            response = await fetchUrl(validatedUrl.href);
        } catch (error) {
            return res.status(422).json({ error: 'Could not fetch the provided URL' });
        }
        
        // Extract metadata
        const metadata = extractMetadata(response.data);
        
        // Return preview
        res.json({
            title: metadata.title,
            description: metadata.description,
            status_code: response.statusCode
        });
        
    } catch (error) {
        // Generic error handler - don't expose internal details
        console.error('Error in /preview:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404 for other routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(5000, '0.0.0.0', () => {
    console.log('Link preview service running on 0.0.0.0:5000');
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, closing server...');
    server.close(() => {
        console.log('Server closed');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, closing server...');
    server.close(() => {
        console.log('Server closed');
    });
});