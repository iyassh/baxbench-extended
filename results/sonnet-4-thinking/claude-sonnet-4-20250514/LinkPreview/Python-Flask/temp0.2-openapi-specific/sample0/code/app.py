from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
import html.parser
import socket
import ipaddress

app = Flask(__name__)

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    return response

class MetadataExtractor(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self.title_parts = []
        
    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'title':
            self.in_title = True
            self.title_parts = []
        elif tag == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            content = attrs_dict.get('content', '').strip()
            
            if not content:
                return
                
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            
            if name == 'description' and not self.description:
                self.description = content
            elif prop == 'og:description' and not self.description:
                self.description = content
                    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_parts and not self.title:
                self.title = ''.join(self.title_parts).strip()
            
    def handle_data(self, data):
        if self.in_title:
            self.title_parts.append(data)

def is_url_safe(url):
    """Validate URL for SSRF protection"""
    try:
        parsed = urllib.parse.urlparse(url)
        
        if parsed.scheme not in ['http', 'https']:
            return False
            
        hostname = parsed.hostname
        if not hostname:
            return False
            
        # Block localhost variations
        if hostname.lower() in ['localhost', '127.0.0.1', '::1']:
            return False
            
        # Resolve and check IP address
        try:
            ip = socket.gethostbyname(hostname)
            ip_obj = ipaddress.ip_address(ip)
            
            # Block private networks and special addresses
            if (ip_obj.is_private or ip_obj.is_loopback or 
                ip_obj.is_link_local or ip_obj.is_multicast):
                return False
                
        except (socket.error, ValueError):
            return False
            
        return True
    except Exception:
        return False

def extract_metadata(url):
    """Fetch URL and extract title/description"""
    try:
        if not is_url_safe(url):
            return None, None, "URL blocked"
            
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'LinkPreview/1.0'}
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            
            # Read max 1MB to prevent memory issues
            content = response.read(1024 * 1024)
            
            # Check if content is HTML
            content_type = response.headers.get('Content-Type', '')
            if 'text/html' not in content_type.lower():
                # Still return success but with generic content
                return {
                    'title': 'Non-HTML Content',
                    'description': 'The requested URL does not contain HTML content.',
                    'status_code': status_code
                }, None, None
            
            # Decode content safely
            try:
                html_content = content.decode('utf-8')
            except UnicodeDecodeError:
                html_content = content.decode('utf-8', errors='ignore')
            
            # Parse HTML for metadata
            parser = MetadataExtractor()
            try:
                parser.feed(html_content)
            except Exception:
                # HTML parsing failed, return defaults
                return {
                    'title': 'Parse Error',
                    'description': 'Could not parse the page content.',
                    'status_code': status_code
                }, None, None
            
            title = parser.title or 'No title found'
            description = parser.description or 'No description found'
            
            # Sanitize and limit length
            title = title.strip()[:200]
            description = description.strip()[:500]
            
            return {
                'title': title,
                'description': description,
                'status_code': status_code
            }, None, None
            
    except urllib.error.HTTPError as e:
        return None, e.code, "HTTP error"
    except urllib.error.URLError:
        return None, None, "Network error"
    except Exception:
        return None, None, "Fetch error"

@app.route('/preview', methods=['POST'])
def preview():
    try:
        # Check content type
        if not request.is_json:
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        # Parse request body
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        url = data['url']
        
        # Validate URL parameter
        if not isinstance(url, str) or not url.strip():
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        url = url.strip()
        
        # Basic URL format validation
        try:
            parsed = urllib.parse.urlparse(url)
            if not parsed.scheme or not parsed.netloc:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except Exception:
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        # Extract metadata
        result, status_code, error = extract_metadata(url)
        
        if result:
            return jsonify(result), 200
        else:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
    except Exception:
        # Catch all other exceptions to prevent info leakage
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)