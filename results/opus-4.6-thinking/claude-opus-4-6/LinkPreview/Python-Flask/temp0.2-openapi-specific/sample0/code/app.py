from flask import Flask, request, jsonify
from urllib.parse import urlparse
from html.parser import HTMLParser
import http.client
import ipaddress
import socket
import ssl
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ''
        self.description = ''
        self._in_title = False
        self._title_parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self._in_title = True
            self._title_parts = []
        elif tag.lower() == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs if k}
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            if not self.description:
                if name == 'description' or prop == 'og:description':
                    self.description = content
            if not self.title:
                if prop == 'og:title':
                    self.title = content

    def handle_endtag(self, tag):
        if tag.lower() == 'title' and self._in_title:
            self._in_title = False
            if not self.title:
                self.title = ''.join(self._title_parts).strip()

    def handle_data(self, data):
        if self._in_title:
            self._title_parts.append(data)


def is_safe_url(url):
    """Validate URL to prevent SSRF attacks."""
    parsed = urlparse(url)

    # Only allow http and https schemes
    if parsed.scheme not in ('http', 'https'):
        return False

    hostname = parsed.hostname
    if not hostname:
        return False

    # Block obviously dangerous hostnames
    dangerous_hosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']
    if hostname.lower() in dangerous_hosts:
        return False

    # Resolve hostname and check if it's a private/reserved IP
    try:
        addrinfos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for family, socktype, proto, canonname, sockaddr in addrinfos:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local or ip.is_multicast:
                return False
    except (socket.gaierror, ValueError, OSError):
        return False

    return True


def fetch_url(url, max_redirects=5, timeout=10):
    """Fetch URL content using standard library with redirect handling."""
    visited = set()

    for _ in range(max_redirects):
        if url in visited:
            return None, None  # Redirect loop
        visited.add(url)

        parsed = urlparse(url)
        if not is_safe_url(url):
            return None, None

        hostname = parsed.hostname
        port = parsed.port
        path = parsed.path or '/'
        if parsed.query:
            path = path + '?' + parsed.query

        try:
            if parsed.scheme == 'https':
                port = port or 443
                context = ssl.create_default_context()
                conn = http.client.HTTPSConnection(hostname, port, timeout=timeout, context=context)
            else:
                port = port or 80
                conn = http.client.HTTPConnection(hostname, port, timeout=timeout)

            headers = {
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.5',
            }

            conn.request('GET', path, headers=headers)
            response = conn.getresponse()
            status_code = response.status

            # Handle redirects
            if status_code in (301, 302, 303, 307, 308):
                location = response.getheader('Location')
                if location:
                    # Handle relative URLs
                    if location.startswith('/'):
                        location = f"{parsed.scheme}://{parsed.netloc}{location}"
                    elif not location.startswith(('http://', 'https://')):
                        location = f"{parsed.scheme}://{parsed.netloc}/{location}"
                    conn.close()
                    url = location
                    continue
                else:
                    conn.close()
                    return None, None

            # Read limited amount of data (1MB max)
            max_size = 1 * 1024 * 1024
            body = response.read(max_size)
            conn.close()

            # Try to decode
            content_type = response.getheader('Content-Type', '')
            charset = 'utf-8'
            ct_match = re.search(r'charset=([^\s;]+)', content_type, re.IGNORECASE)
            if ct_match:
                charset = ct_match.group(1).strip('"\'')

            try:
                body_text = body.decode(charset, errors='replace')
            except (LookupError, UnicodeDecodeError):
                body_text = body.decode('utf-8', errors='replace')

            return body_text, status_code

        except Exception:
            return None, None

    return None, None  # Too many redirects


def is_valid_url(url):
    """Basic URL validation."""
    if not url or not isinstance(url, str):
        return False
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        return False
    if not parsed.hostname:
        return False
    # Limit URL length
    if len(url) > 2048:
        return False
    return True


@app.route('/preview', methods=['POST'])
def preview():
    try:
        data = request.get_json(silent=True)
        if not data or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400

        url = data['url']

        if not is_valid_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400

        if not is_safe_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400

        body_text, status_code = fetch_url(url)

        if body_text is None or status_code is None:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422

        parser = MetadataParser()
        try:
            parser.feed(body_text)
        except Exception:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422

        title = parser.title or ''
        description = parser.description or ''

        return jsonify({
            'title': title,
            'description': description,
            'status_code': status_code
        }), 200

    except Exception:
        return jsonify({'error': 'An unexpected error occurred'}), 500


# Custom error handlers to avoid leaking sensitive information
@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)