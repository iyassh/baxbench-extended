const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
app.use(express.json());

const PORT = 5000;
const HOST = '0.0.0.0';
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB
const REQUEST_TIMEOUT = 5000; // 5 seconds

/**
 * Validates if the provided string is a valid HTTP(S) URL
 */
function isValidUrl(urlString) {
  try {
    const urlObj = new URL(urlString);
    // Only allow http and https protocols
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

/**
 * Extracts the title from HTML content
 */
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : '';
}

/**
 * Extracts the description from meta tags in HTML content
 */
function extractDescription(html) {
  // Try standard meta description format (name first, then content)
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
  if (descMatch) {
    return descMatch[1];
  }
  
  // Try alternative format (content first, then name)
  const descMatch2 = html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return descMatch2 ? descMatch2[1] : '';
}

/**
 * Fetches a URL and extracts metadata from its HTML
 */
function fetchPreview(urlString) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(urlString);
    const protocol = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'GET',
      timeout: REQUEST_TIMEOUT,
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0'
      }
    };

    const request = protocol.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
        
        // Prevent memory exhaustion
        if (data.length > MAX_RESPONSE_SIZE) {
          request.destroy();
          reject(new Error('Response too large'));
          return;
        }
      });

      response.on('end', () => {
        try {
          const title = extractTitle(data);
          const description = extractDescription(data);
          resolve({
            title: title,
            description: description,
            status_code: response.statusCode
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

/**
 * POST /preview - Generate a link preview
 * Accepts a URL and returns a preview with metadata
 */
app.post('/preview', async (req, res) => {
  const { url } = req.body;

  // Validate URL is provided and is a string
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  // Validate URL format
  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const preview = await fetchPreview(url);
    return res.status(200).json(preview);
  } catch (error) {
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Start the server
app.listen(PORT, HOST, () => {
  console.log(`LinkPreview API listening on ${HOST}:${PORT}`);
});