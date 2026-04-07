from flask import Flask, request, jsonify
from urllib.parse import urlparse
import socket
import ipaddress
import urllib.request
import urllib.error
from html.parser import HTMLParser

app = Flask(__name__)


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


class MetadataParser(HTMLParser):
    """HTML parser to extract title and description metadata"""
    
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        
    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        
        if tag == 'title':
            self.in_title = True
        elif tag == 'meta':
            name = attrs_dict.get('name', '').lower()
            property_attr = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            
            if (name == 'description' or property_attr == 'og:description') and not self.description:
                self.description = content
            elif property_attr == 'og:title' and not self.title:
                self.title = content
    
    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False


def is_private_ip(ip):
    """Check if an IP address is private, loopback, or otherwise restricted"""
    try:
        ip_obj = ipaddress.ip_address(ip)
        return (
            ip_obj.is_private or
            ip_obj.is_loopback or
            ip_obj.is_link_local or
            ip_obj.is_multicast or
            ip_obj.is_reserved
        )
    except ValueError:
        return True


def validate_url(url):
    """Validate URL to prevent SSRF attacks"""
    try:
        parsed = urlparse(url)
        
        # Only allow http and https schemes
        if parsed.scheme not in ['http', 'https']:
            return False
        
        # Must have a hostname
        if not parsed.hostname:
            return False
        
        hostname = parsed.hostname.lower()
        
        # Block localhost variations
        if hostname in ['localhost', '0.0.0.0'] or hostname.startswith('127.'):
            return False
        
        # Block IPv6 localhost
        if hostname in ['::1', '0:0:0:0:0:0:0:1']:
            return False
        
        # Block cloud metadata endpoints
        if hostname in ['169.254.169.254', 'metadata.google.internal', '169.254.169.123']:
            return False
        
        # Resolve hostname and check if it's a private IP
        try:
            addr_info = socket.getaddrinfo(hostname, None)
            for info in addr_info:
                ip = info[4][0].split('%')[0]  # Remove zone ID from IPv6
                if is_private_ip(ip):
                    return False
        except (socket.gaierror, OSError):
            return False
        
        return True
        
    except Exception:
        return False


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """HTTP redirect handler that validates redirect targets"""
    
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not validate_url(newurl):
            raise urllib.error.HTTPError(newurl, code, "Invalid redirect", headers, fp)
        return urllib.request.HTTPRedirectHandler.redirect_request(
            self, req, fp, code, msg, headers, newurl
        )


def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    try:
        opener = urllib.request.build_opener(SafeRedirectHandler)
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            }
        )
        
        with opener.open(req, timeout=10) as response:
            status_code = response.status
            content_type = response.headers.get('Content-Type', '')
            
            # Only process HTML content
            if 'text/html' not in content_type.lower():
                return {
                    'title': None,
                    'description': None,
                    'status_code': status_code
                }
            
            # Read response (limit to 1MB to prevent memory issues)
            content = response.read(1024 * 1024)
            encoding = response.headers.get_content_charset('utf-8')
            
            try:
                html = content.decode(encoding, errors='ignore')
            except (UnicodeDecodeError, LookupError):
                html = content.decode('utf-8', errors='ignore')
            
            # Parse metadata
            parser = MetadataParser()
            try:
                parser.feed(html)
            except Exception:
                # If parsing fails, continue with None values
                pass
            
            return {
                'title': parser.title,
                'description': parser.description,
                'status_code': status_code
            }
            
    except urllib.error.HTTPError as e:
        return {
            'title': None,
            'description': None,
            'status_code': e.code
        }
    except Exception:
        raise


@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview from a URL"""
    try:
        # Validate request format
        if not request.is_json:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        data = request.get_json()
        
        # Validate URL presence
        if not data or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = data['url']
        
        # Validate URL type and format
        if not isinstance(url, str) or not url.strip() or len(url) > 2048:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = url.strip()
        
        # Validate URL to prevent SSRF
        if not validate_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Fetch and return metadata
        try:
            metadata = fetch_url_metadata(url)
            return jsonify(metadata), 200
        except Exception:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
    except Exception:
        return jsonify({'error': 'Invalid URL provided'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)