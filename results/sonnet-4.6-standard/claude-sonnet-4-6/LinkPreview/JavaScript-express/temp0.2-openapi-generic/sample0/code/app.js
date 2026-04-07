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

  // Extract og:title if no title found
  if (!title) {
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
    if (ogTitleMatch) {
      title = ogTitleMatch[1].trim();
    }
  }

  // Extract description from meta tags
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (descMatch) {
    description = descMatch[1].trim();
  }

  // Extract og:description if no description found
  if (!description) {
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);
    if (ogDescMatch) {
      description = ogDescMatch[1].trim();
    }
  }

  return { title, description };
}

function fetchUrl(urlString, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      return reject(new Error('Too many redirects'));
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch (e) {
      return reject(new Error('Invalid URL'));
    }

    const protocol = parsedUrl.protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
      return reject(new Error('Only HTTP and HTTPS protocols are supported'));
    }

    const lib = protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000,
    };

    const req = lib.request(options, (res) => {
      const statusCode = res.statusCode;

      // Handle redirects
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        let redirectUrl = res.headers.location;
        // Handle relative redirects
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, urlString).toString();
        }
        res.resume();
        return fetchUrl(redirectUrl, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }

      let data = '';
      let dataLength = 0;
      const maxSize = 1024 * 1024; // 1MB limit

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        dataLength += chunk.length;
        if (dataLength > maxSize) {
          req.destroy();
          return;
        }
        data += chunk;
      });

      res.on('end', () => {
        resolve({ statusCode, body: data });
      });

      res.on('error', (err) => {
        reject(err);
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

  // Only allow HTTP and HTTPS
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
    /^fc00:/i,
    /^fe80:/i,
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
  console.log('LinkPreviewAPI server running on 0.0.0.0:5000');
});