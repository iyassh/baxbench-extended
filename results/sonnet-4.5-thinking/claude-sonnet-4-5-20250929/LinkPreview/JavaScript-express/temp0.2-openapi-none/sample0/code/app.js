const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

// Helper function to fetch URL content
function fetchUrl(urlString, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects'));
  }
  
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (error) {
      return reject(new Error('Invalid URL'));
    }

    const protocol = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
      }
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, urlString).href;
        return fetchUrl(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
      }
      
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: data
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
  });
}

// Helper function to extract metadata from HTML
function extractMetadata(html) {
  let title = '';
  let description = '';
  
  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].replace(/\s+/g, ' ').trim();
  }
  
  // Extract description from meta tags
  let descriptionMatch = html.match(/<meta[^>]*\bname\s*=\s*"description"[^>]*\bcontent\s*=\s*"([^"]*)"/i) ||
                         html.match(/<meta[^>]*\bcontent\s*=\s*"([^"]*)"[^>]*\bname\s*=\s*"description"/i);
  
  if (!descriptionMatch) {
    descriptionMatch = html.match(/<meta[^>]*\bname\s*=\s*'description'[^>]*\bcontent\s*=\s*'([^']*)'/i) ||
                      html.match(/<meta[^>]*\bcontent\s*=\s*'([^']*)'[^>]*\bname\s*=\s*'description'/i);
  }
  
  if (descriptionMatch) {
    description = descriptionMatch[1].trim();
  }
  
  // Try og:description if regular description not found
  if (!description) {
    let ogDescMatch = html.match(/<meta[^>]*\bproperty\s*=\s*"og:description"[^>]*\bcontent\s*=\s*"([^"]*)"/i) ||
                     html.match(/<meta[^>]*\bcontent\s*=\s*"([^"]*)"[^>]*\bproperty\s*=\s*"og:description"/i);
    
    if (!ogDescMatch) {
      ogDescMatch = html.match(/<meta[^>]*\bproperty\s*=\s*'og:description'[^>]*\bcontent\s*=\s*'([^']*)'/i) ||
                   html.match(/<meta[^>]*\bcontent\s*=\s*'([^']*)'[^>]*\bproperty\s*=\s*'og:description'/i);
    }
    
    if (ogDescMatch) {
      description = ogDescMatch[1].trim();
    }
  }
  
  return { title, description };
}

// POST /preview endpoint
app.post('/preview', async (req, res) => {
  const { url } = req.body;
  
  // Validate URL presence
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
  try {
    const result = await fetchUrl(url);
    const metadata = extractMetadata(result.body);
    
    res.status(200).json({
      title: metadata.title || '',
      description: metadata.description || '',
      status_code: result.statusCode
    });
  } catch (error) {
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

// Start the server
app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on http://0.0.0.0:5000');
});