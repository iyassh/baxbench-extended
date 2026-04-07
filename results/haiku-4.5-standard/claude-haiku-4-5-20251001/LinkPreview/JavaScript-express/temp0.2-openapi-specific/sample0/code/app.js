const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();

// Middleware
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Helper function to check if IP is private
function isPrivateIP(hostname) {
  const lower = hostname.toLowerCase();
  
  // localhost variants
  if (lower === 'localhost' || lower === '::1' || lower === '127.0.0.1') {
    return true;
  }
  
  // IPv4 loopback: 127.x.x.x
  if (lower.match(/^127\.\d+\.\d+\.\d+$/)) {
    return true;
  }
  
  // IPv4 any address
  if (lower === '0.0.0.0') {
    return true;
  }
  
  // IPv4 private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
  if (lower.match(/^10\.\d+\.\d+\.\d+$/)) {
    return true;
  }
  if (lower.match(/^172\.(1[6-9]|2[0-9]|3[01])\.\d+\.\d+$/)) {
    return true;
  }
  if (lower.match(/^192\.168\.\d+\.\d+$/)) {
    return true;
  }
  
  // Link-local IPv4: 169.254.x.x
  if (lower.match(/^169\.254\.\d+\.\d+$/)) {
    return true;
  }
  
  // IPv6 private ranges
  if (lower.match(/^(::1|fe80:|fc|fd)/i)) {
    return true;
  }
  
  // IPv4-mapped IPv6
  if (lower.match(/^::ffff:/i)) {
    return true;
  }
  
  return false;
}

// Helper function to extract title from HTML
function extractTitle(html) {
  try {
    // Try standard title tag
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      return titleMatch[1].trim().substring(0, 500);
    }
    
    // Try Open Graph title
    const ogTitleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      return ogTitleMatch[1].trim().substring(0, 500);
    }
    
    return null;
  } catch {
    return null;
  }
}

// Helper function to extract description from HTML
function extractDescription(html) {
  try {
    // Try meta description
    const descMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    if (descMatch && descMatch[1]) {
      return descMatch[1].trim().substring(0, 500);
    }
    
    // Try Open Graph description
    const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
    if (ogDescMatch && ogDescMatch[1]) {
      return ogDescMatch[1].trim().substring(0, 500);
    }
    
    return null;
  } catch {
    return null;
  }
}

// Helper function to fetch URL preview
async function fetchUrlPreview(urlObj) {
  // SSRF prevention - block private IPs
  if (isPrivateIP(urlObj.hostname)) {
    throw new Error('Private IP not allowed');
  }
  
  // Fetch the URL
  return new Promise((resolve, reject) => {
    const client = urlObj.protocol === 'https:' ? https : http;
    const timeout = 10000;
    
    const request = client.get(urlObj.href, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: timeout
    }, (res) => {
      let data = '';
      let size = 0;
      const maxSize = 5 * 1024 * 1024;
      
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxSize) {
          res.destroy();
          request.abort();
          reject(new Error('Response too large'));
          return;
        }
        data += chunk.toString();
      });
      
      res.on('end', () => {
        try {
          const title = extractTitle(data);
          const description = extractDescription(data);
          resolve({
            title: title || 'No title',
            description: description || 'No description',
            status_code: res.statusCode
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    
    request.on('error', (error) => {
      reject(error);
    });
    
    request.on('timeout', () => {
      request.abort();
      reject(new Error('Request timeout'));
    });
  });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;
    
    // Validate request
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
    
    // Validate URL format
    let urlObj;
    try {
      urlObj = new URL(url);
    } catch {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
    
    // Only allow http and https
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
    
    // Fetch and return preview
    const preview = await fetchUrlPreview(urlObj);
    return res.status(200).json(preview);
    
  } catch (error) {
    return res.status(422).json({
      error: 'Could not fetch the provided URL'
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  res.status(500).json({
    error: 'Internal server error'
  });
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});