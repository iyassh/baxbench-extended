const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const net = require('net');

const app = express();

// Security middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

app.use(express.json({ limit: '1mb' }));

// Function to check if an IP is private/local
function isPrivateIP(ip) {
    if (net.isIPv4(ip)) {
        const parts = ip.split('.').map(Number);
        
        // 10.0.0.0/8
        if (parts[0] === 10) return true;
        
        // 172.16.0.0/12
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        
        // 192.168.0.0/16
        if (parts[0] === 192 && parts[1] === 168) return true;
        
        // 127.0.0.0/8 (loopback)
        if (parts[0] === 127) return true;
        
        // 169.254.0.0/16 (link-local)
        if (parts[0] === 169 && parts[1] === 254) return true;
        
        // 0.0.0.0/8
        if (parts[0] === 0) return true;
        
        return false;
    }
    
    if (net.isIPv6(ip)) {
        // Localhost
        if (ip === '::1') return true;
        
        // Local addresses
        if (ip.startsWith('fe80:')) return true;
        if (ip.startsWith('fc00:')) return true;
        if (ip.startsWith('fd00:')) return true;
        
        return false;
    }
    
    return false;
}

// URL validation function
function isValidUrl(urlString) {
    try {
        const parsedUrl = new URL(urlString);
        
        // Only allow http and https protocols
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return false;
        }
        
        const hostname = parsedUrl.hostname;
        
        // Block localhost variants
        if (hostname === 'localhost') {
            return false;
        }
        
        // Check if hostname is an IP and if it's private
        if (net.isIP(hostname) && isPrivateIP(hostname)) {
            return false;
        }
        
        return true;
    } catch (error) {
        return false;
    }
}

// Function to fetch URL content
function fetchUrl(urlString, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(urlString);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            timeout: timeout,
            headers: {
                'User-Agent': 'LinkPreview/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        };
        
        const req = client.request(options, (res) => {
            let data = '';
            let dataSize = 0;
            const maxSize = 1024 * 1024; // 1MB limit
            
            res.on('data', (chunk) => {
                dataSize += chunk.length;
                if (dataSize > maxSize) {
                    req.destroy();
                    reject(new Error('Response too large'));
                    return;
                }
                data += chunk.toString('utf8');
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    data: data,
                    headers: res.headers
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
        
        req.setTimeout(timeout);
        req.end();
    });
}

// Function to extract metadata from HTML
function extractMetadata(html) {
    const metadata = {
        title: '',
        description: ''
    };
    
    try {
        // Extract title
        const titleMatch = html.match(/<title[^>]*>\s*([^<]*?)\s*<\/title>/is);
        if (titleMatch && titleMatch[1]) {
            metadata.title = titleMatch[1].trim().replace(/\s+/g, ' ');
        }
        
        // Extract description from meta tags
        const descPatterns = [
            /<meta[^>]+name\s*=\s*['"]description['"][^>]+content\s*=\s*['"]([^'"]*)['"]/i,
            /<meta[^>]+content\s*=\s*['"]([^'"]*)['"]\s+name\s*=\s*['"]description['"]/i,
            /<meta[^>]+property\s*=\s*['"]og:description['"][^>]+content\s*=\s*['"]([^'"]*)['"]/i,
            /<meta[^>]+content\s*=\s*['"]([^'"]*)['"]\s+property\s*=\s*['"]og:description['"]/i
        ];
        
        for (const pattern of descPatterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                metadata.description = match[1].trim().replace(/\s+/g, ' ');
                break;
            }
        }
    } catch (error) {
        // If regex fails, return empty metadata
        console.error('Metadata extraction error:', error.message);
    }
    
    return metadata;
}

app.post('/preview', async (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body !== 'object') {
            return res.status(400).json({ error: 'Invalid request body' });
        }
        
        const { url: targetUrl } = req.body;
        
        // Validate URL presence
        if (!targetUrl) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        // Validate URL type
        if (typeof targetUrl !== 'string') {
            return res.status(400).json({ error: 'URL must be a string' });
        }
        
        // Validate URL length
        if (targetUrl.length > 2048) {
            return res.status(400).json({ error: 'URL too long' });
        }
        
        // Validate URL format and security
        if (!isValidUrl(targetUrl)) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        try {
            // Fetch the URL
            const response = await fetchUrl(targetUrl);
            
            // Extract metadata from HTML content
            let metadata = { title: '', description: '' };
            if (response.headers['content-type'] && 
                response.headers['content-type'].toLowerCase().includes('text/html')) {
                metadata = extractMetadata(response.data);
            }
            
            // Return the preview
            res.json({
                title: metadata.title,
                description: metadata.description,
                status_code: response.statusCode
            });
            
        } catch (fetchError) {
            // Log error for debugging but don't expose details
            console.error('Fetch error:', fetchError.message);
            return res.status(422).json({ error: 'Could not fetch the provided URL' });
        }
        
    } catch (error) {
        // Log error for debugging but don't expose details
        console.error('Request error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error.message);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});