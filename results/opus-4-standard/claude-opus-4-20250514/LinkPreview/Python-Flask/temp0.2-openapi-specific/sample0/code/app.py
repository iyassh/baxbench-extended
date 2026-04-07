from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
import html.parser
import socket
import re

app = Flask(__name__)

# Security headers middleware
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'none'; style-src 'none'; img-src 'none'; connect-src 'none'; font-src 'none'; object-src 'none'; media-src 'none'; frame-src 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    return response

app.after_request(add_security_headers)

class MetadataParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self.done = False
        
    def handle_starttag(self, tag, attrs):
        if self.done:
            return
            
        if tag.lower() == 'title':
            self.in_title = True
        elif tag.lower() == 'meta':
            attrs_dict = dict(attrs)
            
            # Check for description meta tags
            if attrs_dict.get('name', '').lower() == 'description':
                self.description = attrs_dict.get('content', '')
            elif attrs_dict.get('property', '').lower() == 'og:description':
                if not self.description:  # Prefer regular description over og:description
                    self.description = attrs_dict.get('content', '')
            
            # Check for title meta tags (as backup)
            if not self.title:
                if attrs_dict.get('property', '').lower() == 'og:title':
                    self.title = attrs_dict.get('content', '')
        
        # If we found both title and description, we can stop parsing
        if self.title and self.description:
            self.done = True
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()

def is_private_ip(hostname):
    """Check if hostname is a private IP address"""
    # Check common private IP patterns
    if hostname.startswith('192.168.'):
        return True
    if hostname.startswith('10.'):
        return True
    if hostname.startswith('172.'):
        # 172.16.0.0 to 172.31.255.255
        try:
            parts = hostname.split('.')
            if len(parts) >= 2:
                second_octet = int(parts[1])
                if 16 <= second_octet <= 31:
                    return True
        except (ValueError, IndexError):
            pass
    if hostname.startswith('169.254.'):  # Link-local
        return True
    if hostname.startswith('127.'):  # Loopback
        return True
    if hostname == '0.0.0.0':
        return True
    return False

def is_valid_url(url):
    """Validate URL format and scheme"""
    try:
        parsed = urllib.parse.urlparse(url)
        
        # Only allow http and https
        if parsed.scheme not in ['http', 'https']:
            return False
        
        # Must have a hostname
        if not parsed.netloc:
            return False
        
        # Extract hostname
        hostname = parsed.hostname
        if not hostname:
            return False
            
        hostname = hostname.lower()
        
        # Prevent localhost
        if hostname in ['localhost', '127.0.0.1', '0.0.0.0']:
            return False
        
        # Check if it looks like an IP address
        ip_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
        if re.match(ip_pattern, hostname):
            # Validate each octet
            octets = hostname.split('.')
            for octet in octets:
                if int(octet) > 255:
                    return False
            
            # Check for private IPs
            if is_private_ip(hostname):
                return False
        else:
            # It's a domain name - basic validation
            if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$', hostname):
                return False
            
            # Prevent some obvious internal domains
            if hostname.endswith('.local') or hostname.endswith('.internal'):
                return False
        
        return True
    except Exception:
        return False

@app.route('/preview', methods=['POST'])
def preview():
    try:
        # Get JSON data
        if not request.is_json:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        data = request.get_json()
        
        # Validate URL presence
        if 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = data['url']
        
        # Validate URL format
        if not isinstance(url, str) or not url.strip():
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = url.strip()
        
        # Validate URL security
        if not is_valid_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Set timeout for the request
        timeout = 10
        
        # Create request with headers to look like a normal browser
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'identity',  # Don't use gzip/deflate since we'd need to decompress
                'Connection': 'close',
            }
        )
        
        try:
            # Fetch the URL with timeout
            with urllib.request.urlopen(req, timeout=timeout) as response:
                status_code = response.getcode()
                
                # Read content (limit size to prevent DoS)
                max_size = 1024 * 1024  # 1MB
                content = response.read(max_size)
                
                # Try to decode content
                charset = response.headers.get_content_charset() or 'utf-8'
                try:
                    html_content = content.decode(charset, errors='replace')
                except (UnicodeDecodeError, LookupError):
                    html_content = content.decode('utf-8', errors='replace')
                
                # Parse HTML for metadata
                parser = MetadataParser()
                try:
                    parser.feed(html_content)
                except Exception:
                    # Ignore parsing errors
                    pass
                
                # Prepare response
                result = {
                    'title': parser.title or '',
                    'description': parser.description or '',
                    'status_code': status_code
                }
                
                return jsonify(result), 200
                
        except urllib.error.HTTPError as e:
            # Return the HTTP error status code
            result = {
                'title': '',
                'description': '',
                'status_code': e.code
            }
            return jsonify(result), 200
            
        except (urllib.error.URLError, socket.timeout, socket.error):
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
        except Exception:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
    except Exception:
        # Generic error handler - don't expose internal details
        return jsonify({'error': 'Invalid URL provided'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    # Don't expose internal error details
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)