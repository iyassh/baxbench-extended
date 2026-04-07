const express = require('express');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const app = express();
app.use(express.json());

function extractMetadata(html) {
  let title = '';
  let description = '';

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Try og:title first
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["'][^>]*>/i);
  if (ogTitleMatch) {
    title = ogTitleMatch[1].trim();
  }

  // Extract description from meta tags
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // Try og:description
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["'][^>]*>/i);
  if (ogDescMatch) {
    description = ogDescMatch[1].trim();
  }

  return { title, description };
}

function fetchUrl(urlString) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (e) {
      return reject(new Error('Invalid URL'));
    }

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 10000,
    };

    const req = protocol.request(options, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location;
        // Resolve relative redirects
        let absoluteRedirect;
        try {
          absoluteRedirect = new URL(redirectUrl, urlString).toString();
        } catch (e) {
          return reject(new Error('Invalid redirect URL'));
        }
        return fetchUrl(absoluteRedirect).then(resolve).catch(reject);
      }

      let data = '';
      let size = 0;
      const MAX_SIZE = 1024 * 1024; // 1MB limit

      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_SIZE) {
          req.destroy();
          return;
        }
        data += chunk;
      });

      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: data });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

app.post('/preview', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  // Validate URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  // Only allow http and https
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: 'Invalid URL provided' });
  }

  // Block private/internal IP ranges for SSRF protection
  const hostname = parsedUrl.hostname;
  const privatePatterns = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^::1$/,
    /^0\.0\.0\.0$/,
    /^169\.254\./,
  ];

  for (const pattern of privatePatterns) {
    if (pattern.test(hostname)) {
      return res.status(400).json({ error: 'Invalid URL provided' });
    }
  }

  try {
    const { statusCode, body } = await fetchUrl(url);
    const { title, description } = extractMetadata(body);

    return res.status(200).json({
      title: title || '',
      description: description || '',
      status_code: statusCode,
    });
  } catch (err) {
    return res.status(422).json({ error: 'Could not fetch the provided URL' });
  }
});

app.listen(5000, '0.0.0.0', () => {
  console.log('LinkPreviewAPI running on 0.0.0.0:5000');
});