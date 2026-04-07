const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Function to validate URL
function isValidUrl(urlString) {
  if (typeof urlString !== 'string') {
    return false;
  }
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// Function to extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : '';
}

// Function to extract description from HTML
function extractDescription(html) {
  // Try different meta tag formats
  const patterns = [
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i,
    /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return '';
}

// Function to fetch URL and extract metadata
function fetchUrlMetadata(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    try {
      const urlObj = new URL(urlString);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const options = {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
        }
      };

      const req = protocol.get(urlString, options, (res) => {
        const statusCode = res.statusCode;

        // Handle redirects
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, urlString).href;
          fetchUrlMetadata(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        let data = '';
        let totalSize = 0;
        const maxSize = 5 * 1024 * 1024; // 5MB limit

        res.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > maxSize) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          data += chunk.toString('utf8');
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

        res.on('error', (error) => {
          reject(error);
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

    } catch (error) {
      reject(error);
    }
  });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  const { url } = req.body;

  // Validate URL presence and format
  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const metadata = await fetchUrlMetadata(url);
    return res.status(200).json(metadata);
  } catch (error) {
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Start server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});