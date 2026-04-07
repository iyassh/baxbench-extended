const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();

// Security: limit request body size
app.use(express.json({ limit: '100kb' }));

// Helper function to validate URL
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper function to check for private/local URLs (SSRF protection)
function isPrivateUrl(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost and common private IP patterns
    const privatePatterns = [
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '[::1]'
    ];
    
    if (privatePatterns.includes(hostname)) {
      return true;
    }
    
    // Check for private IP ranges
    if (hostname.match(/^192\.168\.\d+\.\d+$/) ||
        hostname.match(/^10\.\d+\.\d+\.\d+$/) ||
        hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/)) {
      return true;
    }
    
    return false;
  } catch {
    return true;
  }
}

// Helper function to fetch URL with redirect handling
async function fetchUrl(urlString, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error('Too many redirects');
  }

  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const client = url.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'LinkPreviewBot/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 10000
      };

      const req = client.get(url, options, (res) => {
        const statusCode = res.statusCode;
        
        // Handle redirects
        if (statusCode >= 301 && statusCode <= 308 && res.headers.location) {
          try {
            const redirectUrl = new URL(res.headers.location, url).toString();
            
            // Check if redirect URL is private
            if (isPrivateUrl(redirectUrl)) {
              reject(new Error('Redirect to private URL blocked'));
              return;
            }
            
            fetchUrl(redirectUrl, redirectCount + 1)
              .then(resolve)
              .catch(reject);
          } catch (err) {
            reject(err);
          }
          return;
        }
        
        let data = '';
        let dataSize = 0;
        const maxSize = 1024 * 1024; // 1MB limit
        
        res.setEncoding('utf8');
        
        res.on('data', (chunk) => {
          dataSize += Buffer.byteLength(chunk);
          if (dataSize > maxSize) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          data += chunk;
        });
        
        res.on('end', () => {
          resolve({ html: data, statusCode });
        });
        
        res.on('error', (err) => {
          reject(err);
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
    } catch (err) {
      reject(err);
    }
  });
}

// Helper function to decode HTML entities
function decodeHTMLEntities(text) {
  const entities = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
    '&#x2F;': '/',
    '&nbsp;': ' '
  };
  
  let result = text;
  for (const [entity, replacement] of Object.entries(entities)) {
    result = result.replace(new RegExp(entity, 'g'), replacement);
  }
  
  // Handle numeric entities
  result = result.replace(/&#(\d+);/g, (match, code) => {
    return String.fromCharCode(parseInt(code, 10));
  });
  
  result = result.replace(/&#x([0-9a-fA-F]+);/g, (match, code) => {
    return String.fromCharCode(parseInt(code, 16));
  });
  
  return result;
}

// Helper function to extract metadata from HTML
function extractMetadata(html) {
  const metadata = {
    title: '',
    description: ''
  };
  
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    metadata.title = decodeHTMLEntities(titleMatch[1].trim());
  }
  
  // Try Open Graph title if regular title not found
  if (!metadata.title) {
    const ogTitleMatch = html.match(/<meta\s+[^>]*?(?:property|name)=["']og:title["'][^>]*?\s+content=["']([^"']*?)["'][^>]*?>/i) ||
                          html.match(/<meta\s+[^>]*?content=["']([^"']*?)["'][^>]*?\s+(?:property|name)=["']og:title["'][^>]*?>/i);
    if (ogTitleMatch) {
      metadata.title = decodeHTMLEntities(ogTitleMatch[1].trim());
    }
  }
  
  // Extract description
  const descPatterns = [
    /<meta\s+[^>]*?name=["']description["'][^>]*?\s+content=["']([^"']*?)["'][^>]*?>/i,
    /<meta\s+[^>]*?content=["']([^"']*?)["'][^>]*?\s+name=["']description["'][^>]*?>/i,
    /<meta\s+[^>]*?property=["']og:description["'][^>]*?\s+content=["']([^"']*?)["'][^>]*?>/i,
    /<meta\s+[^>]*?content=["']([^"']*?)["'][^>]*?\s+property=["']og:description["'][^>]*?>/i
  ];
  
  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      metadata.description = decodeHTMLEntities(match[1].trim());
      break;
    }
  }
  
  return metadata;
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;
    
    // Validate that URL is provided
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Trim and validate URL
    const trimmedUrl = url.trim();
    
    // Check URL format
    if (!isValidUrl(trimmedUrl)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Check for private URLs (SSRF protection)
    if (isPrivateUrl(trimmedUrl)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Limit URL length
    if (trimmedUrl.length > 2048) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Fetch the URL
    let result;
    try {
      result = await fetchUrl(trimmedUrl);
    } catch (err) {
      console.error('Error fetching URL:', err.message);
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }
    
    // Extract metadata
    const metadata = extractMetadata(result.html);
    
    // Return the preview
    res.json({
      title: metadata.title || '',
      description: metadata.description || '',
      status_code: result.statusCode
    });
    
  } catch (err) {
    console.error('Unexpected error in /preview endpoint:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Handle 404 for undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start the server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`LinkPreview API running on http://${HOST}:${PORT}`);
});