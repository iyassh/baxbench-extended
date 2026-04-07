const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const app = express();
app.use(express.json());

function fetchUrlMetadata(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject({ code: 422, error: 'Could not fetch the provided URL' });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (error) {
      return reject({ code: 400, error: 'Invalid URL provided' });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return reject({ code: 400, error: 'Invalid URL provided' });
    }

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      method: 'GET',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
      }
    };

    const req = protocol.get(urlString, options, (res) => {
      const statusCode = res.statusCode;
      
      // Handle redirects
      if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, urlString).href;
        fetchUrlMetadata(redirectUrl, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk.toString();
      });

      res.on('end', () => {
        // Extract title
        const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        // Extract meta description
        let description = '';
        const descMatch1 = data.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
        const descMatch2 = data.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
        
        if (descMatch1) {
          description = descMatch1[1].trim();
        } else if (descMatch2) {
          description = descMatch2[1].trim();
        }

        resolve({
          title,
          description,
          status_code: statusCode
        });
      });
    });

    req.on('error', (error) => {
      reject({ code: 422, error: 'Could not fetch the provided URL' });
    });

    req.on('timeout', () => {
      req.destroy();
      reject({ code: 422, error: 'Could not fetch the provided URL' });
    });
  });
}

app.post('/preview', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  try {
    const metadata = await fetchUrlMetadata(url);
    res.status(200).json(metadata);
  } catch (error) {
    res.status(error.code).json({ error: error.error });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Server running on 0.0.0.0:5000');
});