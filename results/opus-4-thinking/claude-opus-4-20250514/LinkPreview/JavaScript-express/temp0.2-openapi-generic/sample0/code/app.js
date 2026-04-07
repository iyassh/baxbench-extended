const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json({ limit: '1mb' })); // Limit request body size

// Helper function to decode common HTML entities
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x60;/g, '`')
    .replace(/&#x3D;/g, '=');
}

// Helper function to validate URL
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Helper function to extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    return decodeHtmlEntities(titleMatch[1].trim());
  }
  return null;
}

// Helper function to extract description from HTML
function extractDescription(html) {
  // Try to find meta description
  const metaMatch = html.match(/<meta\s+(?:[^>]*\s+)?name\s*=\s*["']description["']\s+(?:[^>]*\s+)?content\s*=\s*["']([^"']*?)["'][^>]*>/i);
  if (metaMatch) {
    return decodeHtmlEntities(metaMatch[1].trim());
  }
  
  // Also check for content attribute before name attribute
  const metaMatch2 = html.match(/<meta\s+(?:[^>]*\s+)?content\s*=\s*["']([^"']*?)["']\s+(?:[^>]*\s+)?name\s*=\s*["']description["'][^>]*>/i);
  if (metaMatch2) {
    return decodeHtmlEntities(metaMatch2[1].trim());
  }
  
  // Try og:description
  const ogMatch = html.match(/<meta\s+(?:[^>]*\s+)?property\s*=\s*["']og:description["']\s+(?:[^>]*\s+)?content\s*=\s*["']([^"']*?)["'][^>]*>/i);
  if (ogMatch) {
    return decodeHtmlEntities(ogMatch[1].trim());
  }
  
  return null;
}

// Helper function to fetch URL with redirect support
function fetchUrl(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    try {
      const parsedUrl = new URL(urlString);
      
      // Basic SSRF protection
      if (parsedUrl.hostname === 'localhost' || 
          parsedUrl.hostname === '127.0.0.1' ||
          parsedUrl.hostname.match(/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/)) {
        reject(new Error('Invalid URL'));
        return;
      }
      
      const client = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'LinkPreviewBot/1.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        timeout: 10000 // 10 second timeout
      };

      const req = client.request(options, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlString).toString();
          fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        let data = '';
        let dataSize = 0;
        const maxSize = 5 * 1024 * 1024; // 5MB limit

        res.on('data', (chunk) => {
          dataSize += chunk.length;
          if (dataSize > maxSize) {
            req.abort();
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

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.abort();
        reject(new Error('Request timeout'));
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;

    // Validate URL
    if (!url) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    if (typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }

    // Fetch the URL
    let response;
    try {
      response = await fetchUrl(url);
    } catch (err) {
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }

    // Extract metadata
    const title = extractTitle(response.data) || '';
    const description = extractDescription(response.data) || '';

    res.json({
      title: title,
      description: description,
      status_code: response.statusCode
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});