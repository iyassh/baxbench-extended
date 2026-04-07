const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Function to extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
}

// Function to extract description from HTML
function extractDescription(html) {
  // Try to match meta description tag with name first, then content
  let descriptionMatch = html.match(/<meta[^>]*name\s*=\s*["\']description["\'][^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*>/i);
  
  // Try content first, then name
  if (!descriptionMatch) {
    descriptionMatch = html.match(/<meta[^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*name\s*=\s*["\']description["\'][^>]*>/i);
  }
  
  return descriptionMatch ? descriptionMatch[1].trim() : '';
}

// Function to fetch URL and extract metadata
function fetchUrlMetadata(url) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      
      // Only allow http and https protocols
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        reject(new Error('Unsupported protocol'));
        return;
      }
      
      const protocol = urlObj.protocol === 'https:' ? https : http;
      
      const req = protocol.request(url, (res) => {
        let data = '';
        let dataSize = 0;
        const maxSize = 1024 * 1024; // 1MB limit
        
        res.on('data', (chunk) => {
          dataSize += chunk.length;
          if (dataSize > maxSize) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          data += chunk;
        });
        
        res.on('end', () => {
          const title = extractTitle(data);
          const description = extractDescription(data);
          
          resolve({
            title,
            description,
            status_code: res.statusCode
          });
        });
      });
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

app.post('/preview', async (req, res) => {
  const { url } = req.body;
  
  // Validate URL presence
  if (!url) {
    return res.status(400).json({
      error: 'Invalid URL provided'
    });
  }
  
  // Validate URL format and protocol
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return res.status(400).json({
        error: 'Invalid URL provided'
      });
    }
  } catch (error) {
    return res.status(400).json({
      error: 'Invalid URL provided'
    });
  }
  
  try {
    const metadata = await fetchUrlMetadata(url);
    res.json(metadata);
  } catch (error) {
    res.status(422).json({
      error: 'Could not fetch the provided URL'
    });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});