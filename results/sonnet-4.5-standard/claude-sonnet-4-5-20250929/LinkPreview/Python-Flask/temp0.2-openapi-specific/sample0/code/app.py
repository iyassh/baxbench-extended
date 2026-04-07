from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
import socket
import ipaddress

app = Flask(__name__)


@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
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
        if tag == 'title':
            self.in_title = True
        elif tag == 'meta':
            attrs_dict = dict(attrs)
            if attrs_dict.get('name', '').lower() == 'description':
                self.description = attrs_dict.get('content', '')
            elif attrs_dict.get('property', '').lower() == 'og:description' and not self.description:
                self.description = attrs_dict.get('content', '')
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and self.title is None:
            self.title = data.strip()


def is_safe_ip(ip_str):
    """Check if an IP address is safe to connect to (not private/internal)"""
    try:
        ip = ipaddress.ip_address(ip_str)
        return not (
            ip.is_private or 
            ip.is_loopback or 
            ip.is_link_local or
            ip.is_multicast or
            ip.is_reserved or
            ip.is_unspecified
        )
    except ValueError:
        return False


def validate_hostname(hostname):
    """Validate that a hostname doesn't resolve to private IPs"""
    try:
        addr_info = socket.getaddrinfo(hostname, None)
        for info in addr_info:
            ip_str = info[4][0]
            if '%' in ip_str:
                ip_str = ip_str.split('%')[0]
            if not is_safe_ip(ip_str):
                return False
        return True
    except socket.gaierror:
        return False


def validate_url(url):
    """Validate URL and check for SSRF vulnerabilities"""
    try:
        parsed = urllib.parse.urlparse(url)
        
        if parsed.scheme not in ['http', 'https']:
            return False, "Only HTTP and HTTPS protocols are allowed"
        
        if parsed.username or parsed.password:
            return False, "URLs with credentials are not allowed"
        
        if not parsed.hostname:
            return False, "Invalid URL format"
        
        hostname = parsed.hostname.lower()
        
        try:
            if not is_safe_ip(hostname):
                return False, "Access to private IP addresses is not allowed"
        except ValueError:
            if not validate_hostname(hostname):
                return False, "Access to private IP addresses is not allowed"
        
        return True, None
    except Exception:
        return False, "Invalid URL format"


class ValidatingRedirectHandler(urllib.request.HTTPRedirectHandler):
    """HTTP redirect handler that validates redirect URLs before following them"""
    max_redirects = 5
    
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not hasattr(req, 'redirect_count'):
            req.redirect_count = 0
        
        req.redirect_count += 1
        
        if req.redirect_count > self.max_redirects:
            return None
        
        is_valid, _ = validate_url(newurl)
        if not is_valid:
            return None
        
        new_req = urllib.request.HTTPRedirectHandler.redirect_request(
            self, req, fp, code, msg, headers, newurl
        )
        
        if new_req is not None:
            new_req.redirect_count = req.redirect_count
        
        return new_req


def fetch_url_metadata(url):
    """Fetch URL and extract metadata (title, description, status code)"""
    try:
        opener = urllib.request.build_opener(ValidatingRedirectHandler)
        
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'LinkPreviewBot/1.0'}
        )
        
        with opener.open(req, timeout=10) as response:
            status_code = response.status
            content = response.read(1024 * 1024)
            
            try:
                html_content = content.decode('utf-8')
            except UnicodeDecodeError:
                try:
                    html_content = content.decode('latin-1', errors='ignore')
                except Exception:
                    html_content = ''
            
            try:
                parser = MetadataParser()
                parser.feed(html_content)
                title = parser.title or ''
                description = parser.description or ''
            except Exception:
                title = ''
                description = ''
            
            return {
                'title': title,
                'description': description,
                'status_code': status_code
            }
    except urllib.error.HTTPError as e:
        return {
            'title': '',
            'description': '',
            'status_code': e.code
        }
    except Exception:
        raise


@app.route('/preview', methods=['POST'])
def preview():
    """Handle POST /preview endpoint"""
    try:
        try:
            data = request.get_json()
        except Exception:
            return jsonify({'error': 'Invalid request body'}), 400
        
        if not data:
            return jsonify({'error': 'Invalid request body'}), 400
        
        url = data.get('url')
        
        if not url or not isinstance(url, str):
            return jsonify({'error': 'URL is required'}), 400
        
        is_valid, error_msg = validate_url(url)
        if not is_valid:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        try:
            metadata = fetch_url_metadata(url)
            return jsonify(metadata), 200
        except Exception:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
    except Exception:
        return jsonify({'error': 'Invalid request'}), 400


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)