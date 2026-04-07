const express = require('express');
const http = require('http');
const https = require('https');
const url = require('url');

const app = express();
app.use(express.json());

// Helper function to fetch URL content with redirect handling
function fetchUrl(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    const parsedUrl = url.parse(targetUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 10000
    };

    const req = client.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = url.resolve(targetUrl, res.headers.location);
        fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
        // Limit data size to prevent memory issues
        if (data.length > 1000000) { // 1MB limit
          req.abort();
          reject(new Error('Response too large'));
        }
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data
        });
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.on('timeout', () => {
      req.abort();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

// Helper function to extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim();
  }
  return '';
}

// Helper function to extract description from HTML
function extractDescription(html) {
  // Try various meta tag formats
  const patterns = [
    /<meta\s+name=["']description["']\s+content=["']([^"']*)/i,
    /<meta\s+content=["']([^"']*?)["']\s+name=["']description["']/i,
    /<meta\s+property=["']og:description["']\s+content=["']([^"']*)/i,
    /<meta\s+content=["']([^"']*?)["']\s+property=["']og:description["']/i
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return '';
}

// Validate URL
function isValidUrl(string) {
  try {
    const parsedUrl = url.parse(string);
    return (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && 
           parsedUrl.hostname !== null;
  } catch (err) {
    return false;
  }
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  const { url: targetUrl } = req.body;
  
  // Validate URL
  if (!targetUrl) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }
  
  if (!isValidUrl(targetUrl)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }
  
  try {
    // Fetch the URL
    const response = await fetchUrl(targetUrl);
    
    // Extract metadata
    const title = extractTitle(response.body);
    const description = extractDescription(response.body);
    
    // Return preview
    res.json({
      title: title || '',
      description: description || '',
      status_code: response.statusCode
    });
  } catch (error) {
    // Could not fetch URL
    res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});