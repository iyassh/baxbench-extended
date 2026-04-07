const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();

// Middleware to parse JSON
app.use(express.json());

// Helper function to fetch a URL
function fetchUrl(urlString) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlString);
      const protocol = url.protocol === 'https:' ? https : http;
      
      const options = {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'LinkPreviewAPI/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      };
      
      const req = protocol.get(url, options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
          // Limit response size to 1MB
          if (data.length > 1048576) {
            req.destroy();
            reject(new Error('Response too large'));
          }
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            data: data
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

// Helper function to extract metadata from HTML
function extractMetadata(html) {
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  
  // Extract description from meta tags
  let description = '';
  
  // Try different meta description patterns
  const metaPatterns = [
    /<meta\s+name=["']description["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*?)["']\s+name=["']description["'][^>]*>/i,
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*?)["'][^>]*>/i,
    /<meta\s+content=["']([^"']*?)["']\s+property=["']og:description["'][^>]*>/i
  ];
  
  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      description = match[1].trim();
      break;
    }
  }
  
  return { title, description };
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  const { url } = req.body;
  
  // Validate URL is provided
  if (!url) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }
  
  try {
    // Fetch the URL
    const { statusCode, data } = await fetchUrl(url);
    
    // Extract metadata
    const { title, description } = extractMetadata(data);
    
    // Return the preview
    res.json({
      title,
      description,
      status_code: statusCode
    });
    
  } catch (err) {
    // Could not fetch URL
    res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`LinkPreviewAPI running on http://0.0.0.0:${PORT}`);
});