const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const dns = require('dns').promises;

const app = express();
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'");
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// Helper function to check if IP is private/internal
function isPrivateIP(ip) {
    // IPv4 private ranges
    if (ip.includes('.')) {
        const parts = ip.split('.').map(Number);
        if (parts.length !== 4) return true;
        
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
    }
    
    // IPv6 private ranges
    if (ip.includes(':')) {
        const lower = ip.toLowerCase();
        if (lower === '::1') return true;
        if (lower.startsWith('fe80:')) return true;
        if (lower.startsWith('fc00:')) return true;
        if (lower.startsWith('fd00:')) return true;
        if (lower === '::') return true;
    }
    
    return false;
}

// Helper function to validate URL and check for SSRF
async function validateAndCheckUrl(urlString) {
    try {
        const url = new URL(urlString);
        
        // Only allow http and https protocols
        if (!['http:', 'https:'].includes(url.protocol)) {
            return { valid: false };
        }
        
        // Check for localhost and other restricted hostnames
        const restrictedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '[::]'];
        if (restrictedHosts.includes(url.hostname.toLowerCase())) {
            return { valid: false };
        }
        
        // Check if hostname is an IP address
        const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
        const ipv6Regex = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/;
        
        if (ipv4Regex.test(url.hostname) || ipv6Regex.test(url.hostname)) {
            if (isPrivateIP(url.hostname)) {
                return { valid: false };
            }
        } else {
            // Resolve hostname to check for private IPs
            try {
                const addresses = await dns.resolve4(url.hostname).catch(() => []);
                const addresses6 = await dns.resolve6(url.hostname).catch(() => []);
                const allAddresses = [...addresses, ...addresses6];
                
                for (const ip of allAddresses) {
                    if (isPrivateIP(ip)) {
                        return { valid: false };
                    }
                }
            } catch (err) {
                // DNS resolution failed - let fetch handle it
            }
        }
        
        return { valid: true, url };
    } catch (err) {
        return { valid: false };
    }
}

// Helper function to fetch URL with timeout
function fetchUrl(url, followRedirects = 0) {
    return new Promise((resolve, reject) => {
        if (followRedirects > 5) {
            reject(new Error('Too many redirects'));
            return;
        }
        
        const protocol = url.protocol === 'https:' ? https : http;
        
        const options = {
            method: 'GET',
            timeout: 5000,
            headers: {
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml'
            }
        };
        
        let responseData = '';
        let statusCode;
        
        const req = protocol.get(url.href, options, async (res) => {
            statusCode = res.statusCode;
            
            // Handle redirects
            if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
                try {
                    const redirectUrl = new URL(res.headers.location, url);
                    const validation = await validateAndCheckUrl(redirectUrl.href);
                    if (!validation.valid) {
                        reject(new Error('Invalid redirect'));
                    } else {
                        fetchUrl(validation.url, followRedirects + 1).then(resolve).catch(reject);
                    }
                } catch (err) {
                    reject(new Error('Invalid redirect'));
                }
                return;
            }
            
            // Limit response size to prevent memory issues
            const maxSize = 1024 * 1024; // 1MB
            let dataSize = 0;
            
            res.setEncoding('utf8');
            
            res.on('data', (chunk) => {
                dataSize += chunk.length;
                if (dataSize > maxSize) {
                    req.abort();
                    reject(new Error('Response too large'));
                    return;
                }
                responseData += chunk;
            });
            
            res.on('end', () => {
                resolve({ html: responseData, statusCode });
            });
        });
        
        req.on('timeout', () => {
            req.abort();
            reject(new Error('Request timeout'));
        });
        
        req.on('error', (err) => {
            reject(err);
        });
    });
}

// Helper function to extract metadata from HTML
function extractMetadata(html) {
    const metadata = {
        title: '',
        description: ''
    };
    
    try {
        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
            metadata.title = titleMatch[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#039;/g, "'")
                .trim()
                .substring(0, 500);
        }
        
        // Extract meta description
        const descRegex = /<meta\s+(?:[^>]*\s+)?(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']*)/gi;
        let descMatch;
        while ((descMatch = descRegex.exec(html)) !== null) {
            if (descMatch[1]) {
                metadata.description = descMatch[1]
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&quot;/g, '"')
                    .replace(/&#039;/g, "'")
                    .trim()
                    .substring(0, 1000);
                break;
            }
        }
        
        // Alternative meta description pattern
        if (!metadata.description) {
            const altDescRegex = /<meta\s+(?:[^>]*\s+)?content=["']([^"']*)[^>]*(?:name|property)=["'](?:description|og:description)["']/gi;
            while ((descMatch = altDescRegex.exec(html)) !== null) {
                if (descMatch[1]) {
                    metadata.description = descMatch[1]
                        .replace(/&amp;/g, '&')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&quot;/g, '"')
                        .replace(/&#039;/g, "'")
                        .trim()
                        .substring(0, 1000);
                    break;
                }
            }
        }
    } catch (err) {
        // Silently handle parsing errors
    }
    
    return metadata;
}

// Main preview endpoint
app.post('/preview', async (req, res) => {
    try {
        // Validate request body
        if (!req.body || typeof req.body.url !== 'string' || !req.body.url.trim()) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        const urlString = req.body.url.trim();
        
        // Validate URL and check for SSRF
        const validation = await validateAndCheckUrl(urlString);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid URL provided' });
        }
        
        // Fetch the URL
        let fetchResult;
        try {
            fetchResult = await fetchUrl(validation.url);
        } catch (err) {
            // Log error internally but don't expose details
            console.error('Fetch error:', err.message);
            return res.status(422).json({ error: 'Could not fetch the provided URL' });
        }
        
        // Extract metadata
        const metadata = extractMetadata(fetchResult.html);
        
        // Return preview
        res.status(200).json({
            title: metadata.title,
            description: metadata.description,
            status_code: fetchResult.statusCode
        });
        
    } catch (err) {
        // Log error internally but don't expose details
        console.error('Unexpected error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`Link preview service running on ${HOST}:${PORT}`);
});