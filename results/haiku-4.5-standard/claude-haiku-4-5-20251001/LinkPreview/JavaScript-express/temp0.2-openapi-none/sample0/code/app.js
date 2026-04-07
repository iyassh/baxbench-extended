const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 5000;
const HOST = '0.0.0.0';

// Middleware
app.use(express.json());

// Helper function to fetch URL and extract metadata
async function fetchUrlMetadata(urlString) {
  return new Promise((resolve, reject) => {
    try {
      // Validate URL format
      const parsedUrl = new URL(urlString);
      
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      const request = protocol.get(urlString, { timeout: 10000 }, (response) => {
        let data = '';
        
        // Set a maximum size to avoid downloading entire pages
        const maxSize = 1024 * 1024; // 1MB
        let size = 0;
        
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxSize) {
            response.destroy();
            reject(new Error('Response too large'));
            return;
          }
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            // Extract title
            let title = '';
            const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
              title = titleMatch[1].trim();
            }
            
            // Extract description from meta tags
            let description = '';
            const metaTags = data.match(/<meta[^>]+>/gi) || [];
            for (const tag of metaTags) {
              const isDescTag = /(?:name|property)=["']?(?:description|og:description)["']?/i.test(tag);
              if (isDescTag) {
                const contentMatch = tag.match(/content=["']?([^"'>]+)["']?/i);
                if (contentMatch) {
                  description = contentMatch[1].trim();
                  break;
                }
              }
            }
            
            resolve({
              title,
              description,
              status_code: response.statusCode
            });
          } catch (error) {
            reject(error);
          }
        });
        
        response.on('error', (err) => {
          reject(err);
        });
      });
      
      request.on('error', (err) => {
        reject(err);
      });
      
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    } catch (error) {
      reject(error);
    }
  });
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  try {
    const { url: urlString } = req.body;
    
    // Validate URL presence
    if (!urlString) {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
    
    // Validate URL format
    try {
      new URL(urlString);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
    
    // Fetch metadata
    const metadata = await fetchUrlMetadata(urlString);
    
    res.status(200).json(metadata);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(422).json({
      error: 'Could not fetch the provided URL'
    });
  }
});

// Start server
app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});