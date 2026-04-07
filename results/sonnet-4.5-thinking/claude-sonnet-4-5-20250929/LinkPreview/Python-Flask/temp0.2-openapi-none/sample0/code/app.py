from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser

app = Flask(__name__)

class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self.in_title = True
        elif tag.lower() == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            name = attrs_dict.get('name', '')
            property_attr = attrs_dict.get('property', '')
            content = attrs_dict.get('content', '')
            
            if name == 'description' and not self.description:
                self.description = content
            elif property_attr == 'og:description' and not self.description:
                self.description = content
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()

@app.route('/preview', methods=['POST'])
def preview():
    # Get JSON data
    data = request.get_json()
    
    # Validate that URL is provided
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data['url']
    
    # Validate URL format
    if not url or not isinstance(url, str):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Basic URL validation
    try:
        parsed = urllib.parse.urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return jsonify({'error': 'Invalid URL provided'}), 400
    except Exception:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        # Fetch the URL
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            content = response.read().decode('utf-8', errors='ignore')
        
        # Parse HTML for metadata
        parser = MetadataParser()
        try:
            parser.feed(content)
        except Exception:
            # If parsing fails, just return empty metadata
            pass
        
        return jsonify({
            'title': parser.title or '',
            'description': parser.description or '',
            'status_code': status_code
        }), 200
        
    except Exception:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)