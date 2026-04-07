const express = require('express');
const https = require('https');
const http = require('http');
const url = require('url');
const dns = require('dns');
const zlib = require('zlib');
const net = require('net');
const { promisify } = require('util');

const app = express();
app.use(express.json());

const dnsLookup = promisify(dns.lookup);

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

// Helper function to decode HTML entities
function decodeHTMLEntities(text) {
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' '
    };
    
    return text.replace(/&[#a-zA-Z0-9]+;/g, (match) => {
        return entities[match] || match;
    });
}

// Helper function to validate URL
function isValidUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        // Only allow HTTP and HTTPS protocols
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

// Helper function to check if IP is private/local
function isPrivateIP(ip) {
    // Check IPv6
    if (net.isIPv6(ip)) {
        // IPv6 loopback
        if (ip === '::1') return true;
        // IPv6 link-local
        if (ip.startsWith('fe80:')) return true;
        // IPv6 unique local
        if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
        return false;
    }
    
    // IPv4
    const parts = ip.split('.');
    if (parts.length !== 4) return false;
    
    const first = parseInt(parts[0]);
    const second = parseInt(parts[1]);
    
    // Check for private IP ranges
    if (first === 10) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 127) return true; // localhost
    if (first === 0) return true;
    if (first >= 224) return true; // multicast and reserved
    
    return false;
}

// Helper function to extract title from HTML
function extractTitle(html) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) {
        return decodeHTMLEntities(titleMatch[1].trim());
    }
    return '';
}

// Helper function to extract description from HTML
function extractDescription(html) {
    // Try to find meta description - handle both single and double quotes
    let match = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*?)["'][^>]*>/i) ||
                html.match(/<meta\s+[^>]*content=["']([^"']*?)["'][^>]*name=["']description["'][^>]*>/i);
    
    if (match) {
        return decodeHTMLEntities(match[1].trim());
    }
    
    // Try og:description
    match = html.match(/<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']*?)["'][^>]*>/i) ||
            html.match(/<meta\s+[^>]*content=["']([^"']*?)["'][^>]*property=["']og:description["'][^>]*>/i);
    
    if (match) {
        return decodeHTMLEntities(match[1].trim());
    }
    
    return '';
}

// Fetch URL with timeout and redirect handling
async function fetchUrl(urlString, redirectCount = 0) {
    if (redirectCount > 5) {
        throw new Error('Too many redirects');
    }
    
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlString);
        const protocol = parsed.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'GET',
            timeout: 10000, // 10 second timeout
            headers: {
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'close'
            }
        };
        
        const req = protocol.request(options, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, urlString).href;
                
                // Validate redirect URL
                if (!isValidUrl(redirectUrl)) {
                    reject(new Error('Invalid redirect URL'));
                    return;
                }
                
                // Check redirect URL for SSRF
                const redirectParsed = new URL(redirectUrl);
                dnsLookup(redirectParsed.hostname)
                    .then(({ address }) => {
                        if (isPrivateIP(address)) {
                            reject(new Error('Redirect to private IP'));
                            return;
                        }
                        // Recursively fetch the redirect
                        fetchUrl(redirectUrl, redirectCount + 1)
                            .then(resolve)
                            .catch(reject);
                    })
                    .catch(() => {
                        reject(new Error('DNS resolution failed for redirect'));
                    });
                
                req.destroy();
                return;
            }
            
            const chunks = [];
            let totalSize = 0;
            const maxSize = 5 * 1024 * 1024; // 5MB limit
            
            res.on('data', (chunk) => {
                totalSize += chunk.length;
                if (totalSize > maxSize) {
                    req.destroy();
                    reject(new Error('Response too large'));
                    return;
                }
                chunks.push(chunk);
            });
            
            res.on('end', () => {
                let buffer = Buffer.concat(chunks);
                let data = buffer;
                
                // Handle compression
                const encoding = res.headers['content-encoding'];
                if (encoding === 'gzip') {
                    try {
                        data = zlib.gunzipSync(buffer);
                    } catch (err) {
                        reject(new Error('Failed to decompress response'));
                        return;
                    }
                } else if (encoding === 'deflate') {
                    try {
                        data = zlib.inflateSync(buffer);
                    } catch (err) {
                        reject(new Error('Failed to decompress response'));
                        return;
                    }
                }
                
                resolve({
                    statusCode: res.statusCode,
                    data: data.toString('utf8')
                });
            });
        });
        
        req.on('error', (err) => {
            reject(err);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        req.end();
    });
}

app.post('/preview', async (req, res) => {
    try {
        const { url: inputUrl } = req.body;
        
        // Validate URL presence
        if (!inputUrl) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        // Validate URL format
        if (!isValidUrl(inputUrl)) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        const parsed = new URL(inputUrl);
        
        // SSRF protection: resolve hostname and check if it's a private IP
        try {
            const { address } = await dnsLookup(parsed.hostname);
            if (isPrivateIP(address)) {
                return res.status(422).json({ error: 'Could not fetch the provided URL' });
            }
        } catch (dnsError) {
            // DNS resolution failed
            return res.status(422).json({ error: 'Could not fetch the provided URL' });
        }
        
        // Fetch the URL
        let response;
        try {
            response = await fetchUrl(inputUrl);
        } catch (fetchError) {
            return res.status(422).json({ error: 'Could not fetch the provided URL' });
        }
        
        // Extract metadata
        const title = extractTitle(response.data);
        const description = extractDescription(response.data);
        
        return res.status(200).json({
            title: title || '',
            description: description || '',
            status_code: response.statusCode
        });
        
    } catch (error) {
        // Generic error handler - don't expose internal errors
        console.error('Error in /preview endpoint:', error);
        return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});