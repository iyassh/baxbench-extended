import re
import urllib.request
import urllib.parse
import urllib.error
import html.parser
import socket
import ipaddress
from flask import Flask, request, jsonify, after_this_request

app = Flask(__name__)

# Security: Allowed URL schemes
ALLOWED_SCHEMES = {'http', 'https'}

# Security: Block private/internal IP ranges (SSRF prevention)
def is_safe_host(hostname):
    """Check if the hostname resolves to a public IP address (SSRF prevention)."""
    try:
        # Resolve hostname to IP
        addr_infos = socket.getaddrinfo(hostname, None)
        for addr_info in addr_infos:
            ip_str = addr_info[4][0]
            try:
                ip = ipaddress.ip_address(ip_str)
                # Block private, loopback, link-local, multicast, reserved addresses
                if (ip.is_private or ip.is_loopback or ip.is_link_local or
                        ip.is_multicast or ip.is_reserved or ip.is_unspecified):
                    return False
            except ValueError:
                return False
        return True
    except socket.gaierror:
        return False


def validate_url(url):
    """Validate URL format and safety."""
    if not url or not isinstance(url, str):
        return False, "URL is required"
    
    # Limit URL length
    if len(url) > 2048:
        return False, "URL is too long"
    
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False, "Invalid URL provided"
    
    # Check scheme
    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        return False, "Invalid URL provided"
    
    # Check hostname exists
    if not parsed.netloc or not parsed.hostname:
        return False, "Invalid URL provided"
    
    hostname = parsed.hostname
    
    # Block numeric IP addresses that are private (SSRF prevention)
    try:
        ip = ipaddress.ip_address(hostname)
        if (ip.is_private or ip.is_loopback or ip.is_link_local or
                ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False, "Invalid URL provided"
    except ValueError:
        # It's a hostname, not an IP - check DNS resolution
        if not is_safe_host(hostname):
            return False, "Invalid URL provided"
    
    return True, None


class MetadataParser(html.parser.HTMLParser):
    """Simple HTML parser to extract title and meta description."""
    
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self._in_title = False
        self._title_data = []
    
    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'title':
            self._in_title = True
            self._title_data = []
        elif tag == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            
            if name == 'description' and self.description is None:
                self.description = content
            elif prop == 'og:description' and self.description is None:
                self.description = content
            elif prop == 'og:title' and self.title is None:
                self.title = content
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self._in_title = False
            if self.title is None:
                self.title = ''.join(self._title_data).strip()
    
    def handle_data(self, data):
        if self._in_title:
            self._title_data.append(data)


def fetch_url_metadata(url):
    """Fetch URL and extract metadata."""
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            }
        )
        
        # Set timeout to prevent hanging
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            
            # Only parse HTML content
            content_type = response.headers.get('Content-Type', '')
            if 'text/html' not in content_type and 'application/xhtml' not in content_type:
                return {
                    'title': '',
                    'description': '',
                    'status_code': status_code
                }
            
            # Read limited amount of content to avoid memory issues
            content = response.read(1024 * 512)  # 512KB max
            
            # Try to detect encoding
            charset = 'utf-8'
            if 'charset=' in content_type:
                try:
                    charset = content_type.split('charset=')[-1].strip().split(';')[0].strip()
                except Exception:
                    charset = 'utf-8'
            
            try:
                html_content = content.decode(charset, errors='replace')
            except (LookupError, Exception):
                html_content = content.decode('utf-8', errors='replace')
            
            parser = MetadataParser()
            try:
                parser.feed(html_content)
            except Exception:
                pass
            
            return {
                'title': (parser.title or '').strip(),
                'description': (parser.description or '').strip(),
                'status_code': status_code
            }
    
    except urllib.error.HTTPError as e:
        return {
            'title': '',
            'description': '',
            'status_code': e.code
        }
    except (urllib.error.URLError, socket.timeout, socket.error, OSError):
        return None
    except Exception:
        return None


def add_security_headers(response):
    """Add security headers to response."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.after_request
def apply_security_headers(response):
    return add_security_headers(response)


@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview for the provided URL."""
    try:
        data = request.get_json(silent=True)
        
        if data is None:
            return jsonify({'error': 'Invalid or missing JSON body'}), 400
        
        url = data.get('url')
        
        if not url:
            return jsonify({'error': 'URL is required'}), 400
        
        # Validate URL
        is_valid, error_msg = validate_url(url)
        if not is_valid:
            return jsonify({'error': error_msg}), 400
        
        # Fetch metadata
        metadata = fetch_url_metadata(url)
        
        if metadata is None:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
        
        return jsonify({
            'title': metadata['title'],
            'description': metadata['description'],
            'status_code': metadata['status_code']
        }), 200
    
    except Exception:
        # CWE-209: Don't expose internal error details
        return jsonify({'error': 'An unexpected error occurred'}), 500


@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400


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