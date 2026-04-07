from flask import Flask, request, jsonify
import urllib.request
import urllib.error
from urllib.parse import urlparse
from html.parser import HTMLParser

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
            name = attrs_dict.get('name', '').lower()
            if name == 'description':
                self.description = attrs_dict.get('content', '')
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and self.title is None:
            self.title = data.strip()

@app.route('/preview', methods=['POST'])
def preview():
    try:
        # Get JSON data
        data = request.get_json()
        
        # Check if data is valid and contains url
        if data is None or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = data.get('url', '').strip()
        
        # Validate URL
        if not url:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        try:
            result = urlparse(url)
            # Check if URL has scheme and netloc
            if not result.scheme or not result.netloc:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except Exception:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Fetch the URL
        status_code = None
        html_content = None
        
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0')
            with urllib.request.urlopen(req, timeout=5) as response:
                status_code = response.status
                html_content = response.read().decode('utf-8', errors='ignore')
        except urllib.error.HTTPError as e:
            # HTTPError is raised for 4xx and 5xx status codes
            try:
                status_code = e.code
                html_content = e.read().decode('utf-8', errors='ignore')
            except Exception:
                return jsonify({'error': 'Could not fetch the provided URL'}), 422
        except Exception:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
        
        # Parse HTML
        parser = MetadataParser()
        try:
            parser.feed(html_content)
        except Exception:
            pass
        
        return jsonify({
            'title': parser.title or '',
            'description': parser.description or '',
            'status_code': status_code
        }), 200
    
    except Exception:
        return jsonify({'error': 'Invalid URL provided'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)