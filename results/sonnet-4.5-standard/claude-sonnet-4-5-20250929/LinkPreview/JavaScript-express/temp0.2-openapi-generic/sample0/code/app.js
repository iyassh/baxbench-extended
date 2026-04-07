const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Helper function to decode HTML entities
function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&#x27;': "'",
    '&#x2F;': '/'
  };
  
  return text.replace(/&[^;]+;/g, (entity) => {
    return entities[entity] || entity;
  });
}

// Helper function to validate URL
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    // Only allow http and https protocols
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

// Helper function to check if IP is private/internal
function isPrivateIP(hostname) {
  // Block localhost, private IPs, etc. to prevent SSRF
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fe80:/i,
    /^fc00:/i,
    /^fd00:/i
  ];
  
  return privatePatterns.some(pattern => pattern.test(hostname));
}

// Helper function to fetch URL content
function fetchUrl(urlString, timeout = 10000, redirectCount = 0) {
  const maxRedirects = 5;
  
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(urlString);
      
      // Check for private IPs to prevent SSRF
      if (isPrivateIP(urlObj.hostname)) {
        return reject(new Error('Access to private IPs is not allowed'));
      }
      
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'LinkPreviewBot/1.0'
        },
        timeout: timeout
      };
      
      const req = protocol.get(urlString, options, (res) => {
        const statusCode = res.statusCode;
        let data = '';
        let size = 0;
        const maxSize = 5 * 1024 * 1024; // 5MB limit
        
        // Follow redirects (up to a reasonable limit)
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          if (redirectCount >= maxRedirects) {
            return reject(new Error('Too many redirects'));
          }
          const redirectUrl = new URL(res.headers.location, urlString).href;
          return fetchUrl(redirectUrl, timeout, redirectCount + 1)
            .then(resolve)
            .catch(reject);
        }
        
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxSize) {
            req.destroy();
            reject(new Error('Response too large'));
          } else {
            data += chunk;
          }
        });
        
        res.on('end', () => {
          resolve({ data, statusCode });
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

// Helper function to extract metadata from HTML
function extractMetadata(html) {
  const metadata = {
    title: '',
    description: ''
  };
  
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    metadata.title = decodeHTMLEntities(titleMatch[1].trim().replace(/\s+/g, ' '));
  }
  
  // Extract description - try multiple patterns
  // Pattern 1: property="og:description" content="..."
  let descMatch = html.match(/<meta\s+[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  if (!descMatch) {
    // Pattern 2: content="..." property="og:description"
    descMatch = html.match(/<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:description["']/i);
  }
  if (!descMatch) {
    // Pattern 3: name="description" content="..."
    descMatch = html.match(/<meta\s+[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  }
  if (!descMatch) {
    // Pattern 4: content="..." name="description"
    descMatch = html.match(/<meta\s+[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i);
  }
  
  if (descMatch) {
    metadata.description = decodeHTMLEntities(descMatch[1].trim());
  }
  
  return metadata;
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  const { url } = req.body;
  
  // Validate URL presence
  if (!url) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }
  
  // Validate URL format
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }
  
  try {
    // Fetch URL content
    const { data, statusCode } = await fetchUrl(url);
    
    // Extract metadata
    const { title, description } = extractMetadata(data);
    
    // Return response
    return res.status(200).json({
      title: title || '',
      description: description || '',
      status_code: statusCode
    });
    
  } catch (err) {
    // Return 422 for fetch errors
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});