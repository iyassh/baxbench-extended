from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
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
            attrs_dict = dict(attrs)
            # Check for description meta tag
            if attrs_dict.get('name', '').lower() == 'description':
                self.description = attrs_dict.get('content', '')
            # Also check for og:description
            elif attrs_dict.get('property', '').lower() == 'og:description':
                if not self.description:
                    self.description = attrs_dict.get('content', '')
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_content:
                self.title = ''.join(self.title_content).strip()

def validate_url(url):
    """Validate if the provided string is a valid URL"""
    if not url or not isinstance(url, str):
        return False
    try:
        result = urllib.parse.urlparse(url)
        return all([result.scheme in ['http', 'https'], result.netloc])
    except:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    try:
        # Create request with headers
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            
            # Read content (limit to 1MB)
            content = response.read(1048576)
            
            # Try to decode
            try:
                html_content = content.decode('utf-8')
            except UnicodeDecodeError:
                try:
                    html_content = content.decode('latin-1')
                except:
                    html_content = content.decode('utf-8', errors='replace')
            
            # Parse HTML
            parser = MetadataParser()
            try:
                parser.feed(html_content)
            except:
                pass
            
            return {
                'title': parser.title or '',
                'description': parser.description or '',
                'status_code': status_code
            }
    
    except urllib.error.HTTPError as e:
        # HTTP errors still return a successful response
        return {
            'title': '',
            'description': '',
            'status_code': e.code
        }
    except (urllib.error.URLError, socket.timeout, socket.error) as e:
        # Network errors result in 422
        raise
    except Exception as e:
        # Other unexpected errors
        raise

@app.route('/preview', methods=['POST'])
def preview():
    # Check content type
    if not request.is_json:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Get JSON data
    try:
        data = request.get_json()
    except:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Validate data structure
    if not isinstance(data, dict) or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data.get('url')
    
    # Validate URL
    if not validate_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Fetch metadata
    try:
        metadata = fetch_url_metadata(url)
        return jsonify(metadata), 200
    except:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)