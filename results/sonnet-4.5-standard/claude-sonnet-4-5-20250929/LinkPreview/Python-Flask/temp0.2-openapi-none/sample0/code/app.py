from flask import Flask, request, jsonify
import urllib.request
import urllib.error
from html.parser import HTMLParser
from urllib.parse import urlparse

app = Flask(__name__)

class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        
    def handle_starttag(self, tag, attrs):
        if tag == 'title' and self.title is None:
            self.in_title = True
        elif tag == 'meta':
            attrs_dict = dict(attrs)
            name = attrs_dict.get('name', '').lower()
            property_val = attrs_dict.get('property', '').lower()
            
            if self.description is None:
                if name == 'description':
                    self.description = attrs_dict.get('content', '')
                elif property_val == 'og:description':
                    self.description = attrs_dict.get('content', '')
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and self.title is None:
            self.title = data.strip()

def validate_url(url):
    """Validate if the URL is properly formed"""
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'}
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            content = response.read().decode('utf-8', errors='ignore')
            
            parser = MetadataParser()
            parser.feed(content)
            
            return {
                'title': parser.title or '',
                'description': parser.description or '',
                'status_code': status_code
            }
    except Exception as e:
        return None

@app.route('/preview', methods=['POST'])
def preview():
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data['url']
    
    if not validate_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    result = fetch_url_metadata(url)
    
    if result is None:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    
    return jsonify(result), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)