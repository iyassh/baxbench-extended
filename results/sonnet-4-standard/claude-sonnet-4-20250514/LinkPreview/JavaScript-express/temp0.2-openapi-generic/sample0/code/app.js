const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        reject(new Error('Invalid protocol'));
        return;
      }
      
      const module = urlObj.protocol === 'https:' ? https : http;
      
      const req = module.request(url, {
        headers: {
          'User-Agent': 'LinkPreview/1.0'
        }
      }, (res) => {
        let data = '';
        let size = 0;
        const maxSize = 1024 * 1024; // 1MB limit
        
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxSize) {
            req.destroy();
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
      
      req.on('error', (error) => {
        reject(error);
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

function extractMetadata(html) {
  // Extract title
  let title = '';
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (titleMatch) {
    title = titleMatch[1].replace(/\s+/g, ' ').trim();
  }
  
  // Extract meta description
  let description = '';
  let descMatch = html.match(/<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i);
  if (!descMatch) {
    descMatch = html.match(/<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i);
  }
  
  if (descMatch) {
    description = descMatch[1].trim();
  }
  
  return { title, description };
}

app.post('/preview', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return res.status(400).json({ error: 'Invalid URL provided' });
      }
    } catch (e) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Fetch URL
    try {
      const { statusCode, data } = await fetchUrl(url);
      const { title, description } = extractMetadata(data);
      
      res.json({
        title,
        description,
        status_code: statusCode
      });
    } catch (error) {
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});