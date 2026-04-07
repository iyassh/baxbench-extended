from flask import Flask, request, jsonify
from html.parser import HTMLParser
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import socket
import ipaddress
import re

app = Flask(__name__)

class MetadataParser(HTMLParser):
    """HTML parser to extract title and description metadata."""
    
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self.title_content = []
    
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self.in_title = True
        elif tag.lower() == 'meta':
            attrs_dict = dict(attrs)
            # Check for meta description
            if attrs_dict.get('name', '').lower() == 'description':
                self.description = attrs_dict.get('content', '')
            # Also check for og:description
            elif attrs_dict.get('property', '').lower() == 'og:description':
                if not self.description:  # Only use if we don't have a regular description
                    self.description = attrs_dict.get('content', '')
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title' and self.in_title:
            self.in_title = False
            if self.title_content:
                self.title = ''.join(self.title_content).strip()

def is_private_ip(ip_str):
    """Check if an IP address is private or reserved."""
    try:
        ip = ipaddress.ip_address(ip_str)
        return (
            ip.is_private or
            ip.is_reserved or
            ip.is_loopback or
            ip.is_link_local or
            ip.is_multicast or
            (ip.version == 4 and str(ip).startswith('0.')) or
            (ip.version == 4 and str(ip) == '255.255.255.255')
        )
    except ValueError:
        return False

def is_safe_hostname(hostname):
    """Check if a hostname is safe to connect to."""
    try:
        # Block common local hostnames
        blocked_hostnames = [
            'localhost', 'localhost.localdomain', 
            '127.0.0.1', '::1', '0.0.0.0',
            '169.254.169.254'  # AWS metadata endpoint
        ]
        
        if hostname.lower() in blocked_hostnames:
            return False
        
        # Block local network patterns
        if hostname.lower().endswith('.local') or hostname.lower().endswith('.internal'):
            return False
        
        # Resolve hostname to IP addresses
        try:
            addr_info = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
            for addr in addr_info:
                ip = addr[4][0]
                if is_private_ip(ip):
                    return False
        except socket.gaierror:
            return False
        
        return True
    except Exception:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata."""
    try:
        # Parse URL
        parsed = urlparse(url)
        
        # Check scheme
        if parsed.scheme not in ['http', 'https']:
            return None, None, None, "Invalid scheme"
        
        # Check hostname
        if not parsed.hostname:
            return None, None, None, "Invalid hostname"
        
        # SSRF protection - check hostname
        if not is_safe_hostname(parsed.hostname):
            return None, None, None, "Unsafe hostname"
        
        # Create request with headers
        req = Request(url, headers={
            'User-Agent': 'LinkPreviewBot/1.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'identity'
        })
        
        # Fetch with timeout
        with urlopen(req, timeout=5) as response:
            status_code = response.getcode()
            
            # Check final URL after redirects for SSRF
            final_url = response.geturl()
            final_parsed = urlparse(final_url)
            if not is_safe_hostname(final_parsed.hostname):
                return None, None, None, "Unsafe redirect"
            
            # Check content type
            content_type = response.headers.get('Content-Type', '')
            if not any(ct in content_type.lower() for ct in ['text/html', 'application/xhtml']):
                # Still return status code even if not HTML
                return '', '', status_code, None
            
            # Read content (limit size to prevent memory issues)
            max_size = 1024 * 512  # 512KB
            content = response.read(max_size)
            
            # Try to decode content
            charset = 'utf-8'
            if 'charset=' in content_type:
                try:
                    charset = content_type.split('charset=')[1].split(';')[0].strip().strip('"\'')
                except:
                    pass
            
            try:
                html_content = content.decode(charset, errors='ignore')
            except:
                html_content = content.decode('utf-8', errors='ignore')
            
            # Parse HTML for metadata
            parser = MetadataParser()
            try:
                parser.feed(html_content)
            except:
                # If parsing fails, still return what we have
                pass
            
            return (
                parser.title if parser.title else '',
                parser.description if parser.description else '',
                status_code,
                None
            )
            
    except HTTPError as e:
        return '', '', e.code, None
    except (URLError, socket.timeout):
        return None, None, None, "Connection failed"
    except Exception:
        return None, None, None, "Fetch failed"

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
    response.headers['Pragma'] = 'no-cache'
    return response

@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview from a URL."""
    try:
        # Check content type
        if not request.is_json:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Parse JSON body
        data = request.get_json(force=True, silent=True)
        
        if not data:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Validate required field
        if 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = data.get('url', '')
        
        # Type check
        if not isinstance(url, str):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = url.strip()
        
        # Basic URL validation
        if not url:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Length limit
        if len(url) > 2048:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Check URL format
        if not re.match(r'^https?://[^\s]+$', url, re.IGNORECASE):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Additional URL validation
        try:
            parsed = urlparse(url)
            if not parsed.scheme or not parsed.netloc:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Fetch metadata
        title, description, status_code, error = fetch_url_metadata(url)
        
        if error:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
        
        # Build response
        response_data = {
            'title': title,
            'description': description,
            'status_code': status_code
        }
        
        return jsonify(response_data), 200
        
    except Exception:
        # Generic error handler - don't expose internal details
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

@app.errorhandler(404)
def not_found(e):
    """Handle 404 errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    """Handle 405 errors."""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    """Handle 500 errors."""
    app.logger.error(f"Internal error: {e}")
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)