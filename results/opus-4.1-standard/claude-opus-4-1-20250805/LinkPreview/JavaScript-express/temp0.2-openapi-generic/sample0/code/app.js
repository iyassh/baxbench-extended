const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Helper function to validate URL
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper function to block private/local IPs (SSRF protection)
function isPrivateIP(hostname) {
  const privateRanges = [
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^169\.254\./,
    /^::1$/,
    /^fe80:/i,
    /^localhost$/i,
    /^local$/i
  ];
  
  return privateRanges.some(range => range.test(hostname));
}

// Helper function to sanitize extracted text
function sanitize(text) {
  if (!text) return '';
  // Remove any HTML/script tags and trim
  return text.replace(/<[^>]*>/g, '').substring(0, 500).trim();
}

// Helper function to extract metadata from HTML
function extractMetadata(html) {
  const title = extractTitle(html);
  const description = extractDescription(html);
  
  return { 
    title: sanitize(title), 
    description: sanitize(description) 
  };
}

function extractTitle(html) {
  // Try to find <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1];
  }
  
  // Try to find og:title meta tag
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)/i);
  if (ogTitleMatch) {
    return ogTitleMatch[1];
  }
  
  return '';
}

function extractDescription(html) {
  // Try to find meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)/i);
  if (descMatch) {
    return descMatch[1];
  }
  
  // Try to find og:description
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)/i);
  if (ogDescMatch) {
    return ogDescMatch[1];
  }
  
  return '';
}

// Function to fetch URL and get metadata with redirect support
function fetchUrlMetadata(urlString, redirectCount = 0) {
  const maxRedirects = 5;
  
  return new Promise((resolve, reject) => {
    if (redirectCount > maxRedirects) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    try {
      const url = new URL(urlString);
      
      // SSRF protection
      if (isPrivateIP(url.hostname)) {
        reject(new Error('Access to private IPs is not allowed'));
        return;
      }
      
      const client = url.protocol === 'https:' ? https : http;
      
      const options = {
        timeout: 5000, // 5 second timeout
        headers: {
          'User-Agent': 'LinkPreviewBot/1.0',
          'Accept': 'text/html,application/xhtml+xml'
        }
      };
      
      const req = client.get(url, options, (res) => {
        const statusCode = res.statusCode;
        
        // Handle redirects
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          req.abort();
          const newUrl = new URL(res.headers.location, urlString);
          fetchUrlMetadata(newUrl.toString(), redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }
        
        let data = '';
        let dataSize = 0;
        const maxSize = 1024 * 1024; // 1MB limit
        
        res.on('data', (chunk) => {
          dataSize += chunk.length;
          if (dataSize > maxSize) {
            req.abort();
            reject(new Error('Response too large'));
            return;
          }
          data += chunk.toString('utf8');
        });
        
        res.on('end', () => {
          const metadata = extractMetadata(data);
          resolve({
            title: metadata.title || '',
            description: metadata.description || '',
            status_code: statusCode
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
      
    } catch (err) {
      reject(err);
    }
  });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;
    
    // Validate URL presence
    if (!url) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Validate URL format
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Additional validation: check for excessively long URLs
    if (url.length > 2048) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Fetch and extract metadata
    try {
      const metadata = await fetchUrlMetadata(url);
      res.json(metadata);
    } catch (fetchError) {
      res.status(422).json({ error: 'Could not fetch the provided URL' });
    }
    
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Link preview service running on ${HOST}:${PORT}`);
});