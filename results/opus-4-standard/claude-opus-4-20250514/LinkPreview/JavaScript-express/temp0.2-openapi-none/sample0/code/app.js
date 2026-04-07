const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Helper function to fetch URL content
function fetchUrl(urlString) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(urlString);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 10000
      };

      const req = client.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            html: data
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
    } catch (error) {
      reject(error);
    }
  });
}

// Helper function to extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : '';
}

// Helper function to extract description from HTML
function extractDescription(html) {
  // Try to find meta description
  const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (metaDescMatch) return metaDescMatch[1].trim();
  
  // Try alternate format
  const metaDescMatch2 = html.match(/<meta\s+content=["']([^"']+)["']\s+name=["']description["']/i);
  if (metaDescMatch2) return metaDescMatch2[1].trim();
  
  // Try og:description
  const ogDescMatch = html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
  if (ogDescMatch) return ogDescMatch[1].trim();
  
  // Try alternate og:description format
  const ogDescMatch2 = html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:description["']/i);
  if (ogDescMatch2) return ogDescMatch2[1].trim();
  
  return '';
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;
    
    // Validate URL is provided
    if (!url) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Fetch the URL
    let response;
    try {
      response = await fetchUrl(url);
    } catch (error) {
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }
    
    // Extract metadata
    const title = extractTitle(response.html);
    const description = extractDescription(response.html);
    
    // Return the preview
    res.json({
      title: title,
      description: description,
      status_code: response.statusCode
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Link preview service running on http://0.0.0.0:5000');
});