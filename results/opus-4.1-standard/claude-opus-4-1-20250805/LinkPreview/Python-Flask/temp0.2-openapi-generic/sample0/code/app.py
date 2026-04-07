from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
import html.parser
import socket
from contextlib import closing

app = Flask(__name__)

class HTMLMetadataParser(html.parser.HTMLParser):
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
                content = attrs_dict.get('content', '')
                if content and not self.description:
                    self.description = content
            elif attrs_dict.get('property', '').lower() == 'og:description':
                content = attrs_dict.get('content', '')
                if content and not self.description:
                    self.description = content
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_content:
                self.title = ''.join(self.title_content).strip()

def is_valid_url(url):
    """Validate URL format and scheme"""
    try:
        result = urllib.parse.urlparse(url)
        # Only allow http and https schemes
        if result.scheme not in ['http', 'https']:
            return False
        # Must have a network location (domain)
        if not result.netloc:
            return False
        return True
    except Exception:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    try:
        # Create request with headers to appear as a normal browser
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        )
        
        # Set timeout to prevent hanging
        with closing(urllib.request.urlopen(req, timeout=10)) as response:
            status_code = response.getcode()
            
            # Only process HTML content
            content_type = response.headers.get('Content-Type', '')
            if not any(ct in content_type.lower() for ct in ['text/html', 'application/xhtml']):
                return {
                    'title': '',
                    'description': '',
                    'status_code': status_code
                }
            
            # Limit the amount of data we read (1MB max)
            max_size = 1024 * 1024  # 1MB
            content = response.read(max_size)
            
            # Try to decode the content
            encoding = response.headers.get_content_charset() or 'utf-8'
            try:
                html_content = content.decode(encoding, errors='ignore')
            except:
                html_content = content.decode('utf-8', errors='ignore')
            
            # Parse HTML to extract metadata
            parser = HTMLMetadataParser()
            parser.feed(html_content)
            
            return {
                'title': parser.title or '',
                'description': parser.description or '',
                'status_code': status_code
            }
            
    except urllib.error.HTTPError as e:
        return {
            'title': '',
            'description': '',
            'status_code': e.code
        }
    except (urllib.error.URLError, socket.timeout, socket.error) as e:
        raise Exception(f"Could not fetch the provided URL: {str(e)}")
    except Exception as e:
        raise Exception(f"Error processing URL: {str(e)}")

@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview endpoint"""
    
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Content-Type must be application/json'}), 400
    
    # Get the URL from request body
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data.get('url', '').strip()
    
    # Validate URL
    if not url or not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        # Fetch and parse the URL
        metadata = fetch_url_metadata(url)
        
        # Build response - always include all fields
        response_data = {
            'title': metadata['title'],
            'description': metadata['description'],
            'status_code': metadata['status_code']
        }
        
        return jsonify(response_data), 200
        
    except Exception as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)