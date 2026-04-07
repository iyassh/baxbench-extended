from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
import socket
import ipaddress

app = Flask(__name__)

# Security constants
MAX_CONTENT_SIZE = 5 * 1024 * 1024  # 5MB limit
TIMEOUT = 10  # 10 seconds timeout
ALLOWED_SCHEMES = ['http', 'https']

class MetadataParser(HTMLParser):
    """HTML parser to extract title and description metadata"""
    
    def __init__(self):
        super().__init__()
        self.title = ''
        self.description = ''
        self.in_title = False
        self.title_content = []
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self.in_title = True
            self.title_content = []
        elif tag.lower() == 'meta':
            attrs_dict = dict(attrs)
            # Check for description meta tag
            if attrs_dict.get('name', '').lower() == 'description':
                content = attrs_dict.get('content', '')
                if content and not self.description:
                    self.description = content.strip()
            # Check for og:description
            elif attrs_dict.get('property', '').lower() == 'og:description':
                content = attrs_dict.get('content', '')
                if content and not self.description:
                    self.description = content.strip()
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_content:
                self.title = ''.join(self.title_content).strip()
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)

def is_private_ip(ip_str):
    """Check if IP address is private"""
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
    except:
        return False

def is_valid_url(url):
    """Validate URL for security"""
    try:
        parsed = urllib.parse.urlparse(url)
        
        # Check scheme
        if parsed.scheme not in ALLOWED_SCHEMES:
            return False
            
        # Check for empty hostname
        if not parsed.hostname:
            return False
            
        # Prevent local network access (SSRF protection)
        hostname = parsed.hostname.lower()
        
        # Check common localhost variations
        if hostname in ['localhost', '127.0.0.1', '0.0.0.0', '[::1]', '::1']:
            return False
        
        # Try to resolve hostname and check if it's a private IP
        try:
            # Get IP address
            ip_address = socket.gethostbyname(hostname)
            if is_private_ip(ip_address):
                return False
        except:
            # If we can't resolve, it's invalid
            return False
            
        return True
    except:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    title = ''
    description = ''
    status_code = 0
    
    try:
        # Create request with custom headers
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'identity',  # Avoid compression for simplicity
                'Connection': 'close'
            }
        )
        
        # Set timeout
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            status_code = response.getcode()
            
            # Check content type
            content_type = response.headers.get('Content-Type', '')
            if content_type.split(';')[0].strip().lower() in ['text/html', 'application/xhtml+xml']:
                # Check content length
                content_length = response.headers.get('Content-Length')
                if content_length:
                    try:
                        if int(content_length) > MAX_CONTENT_SIZE:
                            return title, description, status_code
                    except:
                        pass
                
                # Read content with size limit
                content = b''
                chunk_size = 8192
                while len(content) < MAX_CONTENT_SIZE:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    content += chunk
                
                # Decode content
                charset = 'utf-8'
                if 'charset=' in content_type:
                    try:
                        charset = content_type.split('charset=')[1].split(';')[0].strip().strip('"\'')
                    except:
                        pass
                
                html_content = None
                for encoding in [charset, 'utf-8', 'latin-1', 'iso-8859-1']:
                    try:
                        html_content = content.decode(encoding)
                        break
                    except:
                        continue
                
                if html_content:
                    # Parse HTML
                    parser = MetadataParser()
                    try:
                        parser.feed(html_content)
                        title = parser.title
                        description = parser.description
                    except:
                        # If parsing fails, continue without metadata
                        pass
            
            return title, description, status_code
            
    except urllib.error.HTTPError as e:
        return title, description, e.code
    except urllib.error.URLError:
        raise
    except socket.timeout:
        raise urllib.error.URLError("Request timed out")
    except Exception as e:
        raise urllib.error.URLError(str(e))

@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview endpoint"""
    
    # Validate request has JSON content type
    content_type = request.headers.get('Content-Type', '')
    if not content_type.startswith('application/json'):
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    # Parse JSON request
    try:
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid or empty JSON'}), 400
    except:
        return jsonify({'error': 'Invalid JSON'}), 400
    
    # Validate URL parameter exists
    if 'url' not in data:
        return jsonify({'error': 'URL parameter is required'}), 400
    
    url = data['url']
    
    # Validate URL type
    if not isinstance(url, str):
        return jsonify({'error': 'URL must be a string'}), 400
    
    # Trim whitespace
    url = url.strip()
    
    # Validate URL format and security
    if not url or not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Fetch and parse URL
    try:
        title, description, status_code = fetch_url_metadata(url)
        
        # Build response with all fields
        response_data = {
            'title': title,
            'description': description,
            'status_code': status_code
        }
        
        return jsonify(response_data), 200
        
    except urllib.error.URLError:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except Exception:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)