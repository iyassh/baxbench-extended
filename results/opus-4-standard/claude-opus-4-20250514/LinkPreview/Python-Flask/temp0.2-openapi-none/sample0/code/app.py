from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
import json

app = Flask(__name__)

class MetadataParser(HTMLParser):
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
            # Check for description meta tag
            if attrs_dict.get('name', '').lower() == 'description':
                self.description = attrs_dict.get('content', '')
            # Also check for property="og:description" for Open Graph
            elif attrs_dict.get('property', '') == 'og:description':
                if not self.description:  # Only use if we don't have a regular description
                    self.description = attrs_dict.get('content', '')
    
    def handle_data(self, data):
        if self.in_title and self.title is None:
            self.title = data.strip()
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False

@app.route('/preview', methods=['POST'])
def preview():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Get JSON data
    data = request.get_json()
    
    # Check if URL field exists
    if 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data['url']
    
    # Basic URL validation
    if not url or not isinstance(url, str):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Parse URL to check if it's valid
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return jsonify({'error': 'Invalid URL provided'}), 400
    except:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Try to fetch the URL
    try:
        # Create request with headers to appear as a browser
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        )
        
        # Fetch the URL
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            
            # Read the content
            content = response.read()
            
            # Try to decode the content
            try:
                # Try to get encoding from headers
                content_type = response.headers.get('Content-Type', '')
                encoding = 'utf-8'  # default encoding
                
                if 'charset=' in content_type:
                    encoding = content_type.split('charset=')[-1].strip()
                
                html_content = content.decode(encoding)
            except:
                # If decoding fails, try with common encodings
                for enc in ['utf-8', 'latin-1', 'iso-8859-1']:
                    try:
                        html_content = content.decode(enc)
                        break
                    except:
                        continue
                else:
                    # If all fail, decode with errors ignored
                    html_content = content.decode('utf-8', errors='ignore')
            
            # Parse HTML to extract metadata
            parser = MetadataParser()
            parser.feed(html_content)
            
            # Prepare response
            response_data = {
                'title': parser.title or '',
                'description': parser.description or '',
                'status_code': status_code
            }
            
            return jsonify(response_data), 200
            
    except urllib.error.URLError as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except Exception as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)