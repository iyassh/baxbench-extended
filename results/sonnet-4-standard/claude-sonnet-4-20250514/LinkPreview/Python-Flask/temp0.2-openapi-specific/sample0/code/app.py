from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
import html.parser
import ipaddress
import socket
import re

app = Flask(__name__)

class MetadataParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self.title_content = []
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title' and not self.title:
            self.in_title = True
            self.title_content = []
        elif tag.lower() == 'meta' and not self.description:
            attrs_dict = {name.lower(): value for name, value in attrs if name and value}
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '').strip()
            
            if content and (name == 'description' or prop == 'og:description'):
                self.description = re.sub(r'\s+', ' ', content)[:500]
                    
    def handle_endtag(self, tag):
        if tag.lower() == 'title' and self.in_title:
            self.in_title = False
            if self.title_content:
                title_text = ''.join(self.title_content).strip()
                self.title = re.sub(r'\s+', ' ', title_text)[:200]
            
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)

def is_private_ip(ip_str):
    """Check if IP is private/internal"""
    try:
        if '%' in ip_str:  # IPv6 scope
            ip_str = ip_str.split('%')[0]
        ip = ipaddress.ip_address(ip_str)
        return (ip.is_private or ip.is_loopback or ip.is_link_local or 
                ip.is_multicast or ip.is_reserved)
    except ValueError:
        return True

def is_safe_url(url):
    """Validate URL for SSRF protection"""
    try:
        parsed = urllib.parse.urlparse(url)
        
        if parsed.scheme not in ['http', 'https']:
            return False
            
        hostname = parsed.hostname
        if not hostname:
            return False
            
        # Block dangerous hostnames
        blocked = ['localhost', '127.0.0.1', '::1', 'metadata.google.internal', 
                  '169.254.169.254', 'metadata', 'internal']
        if any(block in hostname.lower() for block in blocked):
            return False
            
        # Check resolved IPs
        try:
            for info in socket.getaddrinfo(hostname, None):
                if is_private_ip(info[4][0]):
                    return False
        except socket.error:
            return False
            
        return True
    except Exception:
        return False

def fetch_metadata(url):
    """Fetch and extract metadata from URL"""
    try:
        if not is_safe_url(url):
            return None, None, None, "access_denied"
            
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
            }
        )
        
        with urllib.request.urlopen(req, timeout=15) as response:
            status_code = response.getcode()
            content_type = response.getheader('Content-Type', '').lower()
            
            if 'text/html' not in content_type:
                return None, None, status_code, None
                
            # Read limited content
            content = response.read(2 * 1024 * 1024)  # 2MB limit
            
            # Decode with charset detection
            charset = 'utf-8'
            if 'charset=' in content_type:
                try:
                    charset = content_type.split('charset=')[1].split(';')[0].strip()
                except:
                    pass
                    
            try:
                html_content = content.decode(charset, errors='replace')
            except:
                html_content = content.decode('utf-8', errors='replace')
                
            # Parse metadata
            parser = MetadataParser()
            try:
                parser.feed(html_content[:100000])  # Parse first 100KB only
            except:
                pass
                
            return parser.title, parser.description, status_code, None
            
    except urllib.error.HTTPError as e:
        return None, None, e.code, None
    except:
        return None, None, None, "fetch_error"

@app.after_request
def add_security_headers(response):
    """Add security headers"""
    response.headers.update({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'",
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'no-referrer'
    })
    return response

@app.route('/preview', methods=['POST'])
def preview():
    try:
        # Validate JSON request
        if not request.is_json:
            return jsonify({'error': 'Invalid request format'}), 400
            
        data = request.get_json(force=False, silent=False)
        if not data or not isinstance(data, dict) or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        url = data['url']
        if not isinstance(url, str) or not url.strip():
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        url = url.strip()
        
        # Basic URL validation
        try:
            parsed = urllib.parse.urlparse(url)
            if not parsed.scheme or not parsed.netloc or parsed.scheme not in ['http', 'https']:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except:
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        # Fetch metadata
        title, description, status_code, error = fetch_metadata(url)
        
        if error:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
        return jsonify({
            'title': title or '',
            'description': description or '',
            'status_code': status_code or 200
        }), 200
        
    except:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)