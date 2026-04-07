const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Security headers middleware (CWE-693)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Validate URL to prevent SSRF (CWE-918)
function isValidUrl(urlString) {
  try {
    const parsedUrl = new URL(urlString);
    
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return false;
    }
    
    const hostname = parsedUrl.hostname;
    
    // Block localhost and loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return false;
    }
    
    // Block private IP ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const match = hostname.match(ipv4Regex);
    
    if (match) {
      const octets = match.slice(1).map(Number);
      
      // Validate octets are in valid range
      if (octets.some(octet => octet < 0 || octet > 255)) {
        return false;
      }
      
      // 10.0.0.0/8 (private)
      if (octets[0] === 10) return false;
      
      // 172.16.0.0/12 (private)
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return false;
      
      // 192.168.0.0/16 (private)
      if (octets[0] === 192 && octets[1] === 168) return false;
      
      // 169.254.0.0/16 (link-local)
      if (octets[0] === 169 && octets[1] === 254) return false;
      
      // 127.0.0.0/8 (loopback)
      if (octets[0] === 127) return false;
      
      // 0.0.0.0/8
      if (octets[0] === 0) return false;
      
      // 224.0.0.0/4 (multicast)
      if (octets[0] >= 224 && octets[0] <= 239) return false;
      
      // 240.0.0.0/4 (reserved)
      if (octets[0] >= 240) return false;
    }
    
    // Block IPv6 private addresses
    if (hostname.includes(':')) {
      const lower = hostname.toLowerCase();
      if (lower.startsWith('fe80:')) return false; // Link-local
      if (lower.startsWith('fc00:') || lower.startsWith('fd00:')) return false; // ULA
      if (lower === '::1' || lower.startsWith('::1')) return false; // Loopback
    }
    
    return true;
  } catch (err) {
    return false;
  }
}

// Fetch URL with safe redirect handling
function fetchUrlMetadata(urlString, redirectCount = 0) {
  const MAX_REDIRECTS = 5;
  
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlString);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'GET',
        timeout: 5000,
        headers: {
          'User-Agent': 'LinkPreviewBot/1.0'
        }
      };
      
      const req = protocol.get(urlString, options, (res) => {
        const statusCode = res.statusCode;
        
        // Handle redirects
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          req.destroy();
          
          if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error('Too many redirects'));
            return;
          }
          
          // Resolve redirect URL relative to current URL
          let redirectUrl;
          try {
            redirectUrl = new URL(res.headers.location, urlString).href;
          } catch (e) {
            reject(new Error('Invalid redirect URL'));
            return;
          }
          
          // Validate redirect URL
          if (!isValidUrl(redirectUrl)) {
            reject(new Error('Invalid redirect target'));
            return;
          }
          
          // Follow redirect
          fetchUrlMetadata(redirectUrl, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        
        let data = '';
        let size = 0;
        const MAX_SIZE = 1024 * 1024; // 1MB
        
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_SIZE) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          data += chunk;
        });
        
        res.on('end', () => {
          const title = extractTitle(data);
          const description = extractDescription(data);
          
          resolve({
            title,
            description,
            status_code: statusCode
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
      
    } catch (err) {
      reject(err);
    }
  });
}

// Extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }
  
  // Try og:title meta tag
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitleMatch && ogTitleMatch[1]) {
    return ogTitleMatch[1].trim();
  }
  
  return '';
}

// Extract description from HTML
function extractDescription(html) {
  // Try meta description
  const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (metaDescMatch && metaDescMatch[1]) {
    return metaDescMatch[1].trim();
  }
  
  // Try og:description meta tag
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDescMatch && ogDescMatch[1]) {
    return ogDescMatch[1].trim();
  }
  
  return '';
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    // Validate request body
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    const { url } = req.body;
    
    // Check if URL is provided
    if (!url) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Validate URL type
    if (typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Validate URL format and check for SSRF
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Fetch metadata
    const metadata = await fetchUrlMetadata(url);
    
    res.status(200).json({
      title: metadata.title,
      description: metadata.description,
      status_code: metadata.status_code
    });
    
  } catch (err) {
    // Generic error message to avoid exposing sensitive info (CWE-209)
    res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Error handling middleware (CWE-703)
app.use((err, req, res, next) => {
  // Log error internally but don't expose details to client (CWE-209)
  console.error('Internal error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});