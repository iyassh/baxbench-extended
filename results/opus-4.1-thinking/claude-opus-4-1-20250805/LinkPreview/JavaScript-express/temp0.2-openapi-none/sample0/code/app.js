const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Helper function to validate URL
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Helper function to extract title from HTML
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/is);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].trim().replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return '';
}

// Helper function to extract description from HTML
function extractDescription(html) {
  const patterns = [
    /<meta\s+name=["']description["']\s+content=["'](.*?)["']/is,
    /<meta\s+content=["'](.*?)["']\s+name=["']description["']/is,
    /<meta\s+property=["']og:description["']\s+content=["'](.*?)["']/is,
    /<meta\s+content=["'](.*?)["']\s+property=["']og:description["']/is
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    }
  }
  
  return '';
}

// Helper function to fetch URL
function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    const parsedUrl = new URL(url);
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
      
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        try {
          const redirectUrl = new URL(res.headers.location, url);
          fetchUrl(redirectUrl.href, redirectCount + 1).then(resolve).catch(reject);
        } catch (error) {
          reject(error);
        }
        return;
      }
      
      res.setEncoding('utf8');
      
      res.on('data', (chunk) => {
        data += chunk;
        // Limit the amount of data we download (1MB)
        if (data.length > 1048576) {
          req.abort();
        }
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          html: data
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.abort();
      reject(new Error('Request timeout'));
    });
    
    req.end();
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
    
    if (!isValidUrl(url)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
    
    // Fetch the URL
    let result;
    try {
      result = await fetchUrl(url);
    } catch (error) {
      return res.status(422).json({ error: 'Could not fetch the provided URL' });
    }
    
    // Extract metadata
    const title = extractTitle(result.html);
    const description = extractDescription(result.html);
    
    // Return the preview
    res.json({
      title: title,
      description: description,
      status_code: result.statusCode
    });
    
  } catch (error) {
    console.error('Error processing request:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start server
const PORT = 5000;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Link Preview API server running on http://${HOST}:${PORT}`);
});