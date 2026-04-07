from flask import Flask, request, jsonify
import urllib.request
import urllib.error
from html.parser import HTMLParser
from urllib.parse import urlparse
import socket

app = Flask(__name__)

class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self.title_content = []
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self.in_title = True
            self.title_content = []
        elif tag.lower() == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            
            # Check for description in various formats
            if attrs_dict.get('name', '').lower() == 'description':
                self.description = attrs_dict.get('content', '')
            elif attrs_dict.get('property', '').lower() == 'og:description':
                if not self.description:
                    self.description = attrs_dict.get('content', '')
            elif attrs_dict.get('name', '').lower() == 'og:description':
                if not self.description:
                    self.description = attrs_dict.get('content', '')
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_content and not self.title:
                self.title = ''.join(self.title_content).strip()

def is_valid_url(url):
    """Check if URL is valid and has a scheme"""
    try:
        result = urlparse(url)
        return all([result.scheme in ['http', 'https'], result.netloc])
    except:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    try:
        # Set timeout for socket operations
        socket.setdefaulttimeout(10)
        
        # Create request with headers to appear as a browser
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
            }
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            content_type = response.headers.get('Content-Type', '')
            
            # Only parse HTML content
            if 'text/html' not in content_type.lower() and 'application/xhtml' not in content_type.lower():
                return {
                    'title': '',
                    'description': '',
                    'status_code': status_code
                }
            
            # Read content (limit to prevent memory issues)
            html_content = response.read(1024 * 1024)  # Read max 1MB
            
            # Try to determine encoding
            encoding = 'utf-8'
            if 'charset=' in content_type:
                charset_parts = content_type.split('charset=')
                if len(charset_parts) > 1:
                    encoding = charset_parts[-1].split(';')[0].strip().strip('"\'')
            
            try:
                html_content = html_content.decode(encoding, errors='ignore')
            except:
                try:
                    html_content = html_content.decode('utf-8', errors='ignore')
                except:
                    html_content = html_content.decode('latin-1', errors='ignore')
            
            # Parse the HTML
            parser = MetadataParser()
            try:
                parser.feed(html_content)
            except:
                # If parsing fails, still return what we have
                pass
            
            return {
                'title': parser.title or '',
                'description': parser.description or '',
                'status_code': status_code
            }
            
    except (urllib.error.URLError, urllib.error.HTTPError, socket.timeout, socket.error) as e:
        raise Exception(f"Could not fetch the provided URL")
    except Exception as e:
        raise Exception(f"Could not fetch the provided URL")

@app.route('/preview', methods=['POST'])
def preview():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    data = request.get_json()
    
    # Check if URL is provided
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data.get('url')
    
    # Validate URL
    if not url or not isinstance(url, str):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = url.strip()
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Fetch and parse the URL
    try:
        metadata = fetch_url_metadata(url)
        return jsonify(metadata), 200
    except Exception as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)