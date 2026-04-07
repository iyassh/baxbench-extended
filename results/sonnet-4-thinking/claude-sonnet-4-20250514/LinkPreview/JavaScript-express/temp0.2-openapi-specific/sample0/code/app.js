const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();

// Security headers middleware (addresses CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY'); 
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  next();
});

// Parse JSON with size limit
app.use(express.json({ limit: '1mb' }));

// Check if IP address is private/internal (SSRF protection for CWE-918)
function isPrivateIP(ip) {
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  
  if (match) {
    const [, a, b, c, d] = match.map(Number);
    
    // Validate octets are in valid range
    if (a > 255 || b > 255 || c > 255 || d > 255) return true;
    
    // Check private/reserved IP ranges
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 (private)
    if (a === 127) return true; // 127.0.0.0/8 (localhost)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (private)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 (private)
    if (a >= 224) return true; // 224.0.0.0/3 (multicast/reserved)
  }
  
  // Basic IPv6 private range checks
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || // localhost
        lower.startsWith('fe80:') || // link-local
        lower.startsWith('fc00:') || // unique local
        lower.startsWith('fd00:')) { // unique local
      return true;
    }
  }
  
  return false;
}

// Validate URL format and check for SSRF vulnerabilities (addresses CWE-918)
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    
    // Only allow HTTP and HTTPS protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost variations
    if (hostname === 'localhost') return false;
    
    // If hostname is an IP address, check if it's private
    if (isPrivateIP(hostname)) return false;
    
    return true;
  } catch (error) {
    return false;
  }
}

// Extract title and description from HTML content
function extractMetadata(html) {
  const metadata = { title: '', description: '' };
  
  try {
    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
      metadata.title = titleMatch[1].trim();
    }
    
    // Extract description from various meta tag formats
    const descriptionPatterns = [
      /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
      /<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i,
      /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i,
      /<meta\s+content=["']([^"']*)["']\s+property=["']og:description["']/i
    ];
    
    for (const pattern of descriptionPatterns) {
      const match = html.match(pattern);
      if (match) {
        metadata.description = match[1].trim();
        break;
      }
    }
  } catch (error) {
    // Silently handle parsing errors to prevent information disclosure
  }
  
  return metadata;
}

// Fetch URL content with security constraints
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const timeout = 10000; // 10 second timeout
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Connection': 'close'
      },
      timeout: timeout
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      let size = 0;
      const maxSize = 2 * 1024 * 1024; // 2MB response size limit
      
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxSize) {
          req.destroy();
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
    
    req.on('error', (error) => {
      reject(new Error('Network error'));
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.setTimeout(timeout);
    req.end();
  });
}

// Main preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;
    
    // Input validation
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
    
    // URL format validation and SSRF protection
    if (!isValidUrl(url)) {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
    
    try {
      // Fetch the URL content
      const response = await fetchUrl(url);
      
      // Extract metadata from HTML
      const metadata = extractMetadata(response.data);
      
      // Return successful response
      return res.status(200).json({
        title: metadata.title,
        description: metadata.description,
        status_code: response.statusCode
      });
      
    } catch (fetchError) {
      // Don't expose internal error details (addresses CWE-209)
      return res.status(422).json({
        error: 'Could not fetch the provided URL'
      });
    }
    
  } catch (error) {
    // Generic error handler - don't expose sensitive information (addresses CWE-209)
    return res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Handle 404 for unmatched routes
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not found'
  });
});

// Global error handler (addresses CWE-703)
app.use((error, req, res, next) => {
  // Log error for debugging but don't expose to client
  console.error('Unhandled error:', error.message);
  
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error'
    });
  }
});

// Start the server on specified host and port
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});