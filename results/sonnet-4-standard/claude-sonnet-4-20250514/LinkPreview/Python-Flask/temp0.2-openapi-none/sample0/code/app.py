from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser

app = Flask(__name__)

class MetaDataParser(HTMLParser):
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
            name = attrs_dict.get('name', '').lower()
            property_attr = attrs_dict.get('property', '').lower()
            
            if (name == 'description' or property_attr == 'og:description') and not self.description:
                content = attrs_dict.get('content', '').strip()
                if content:
                    self.description = content
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_content and not self.title:
                title_text = ''.join(self.title_content).strip()
                if title_text:
                    self.title = title_text

def is_valid_url(url):
    try:
        if not isinstance(url, str):
            return False
        result = urllib.parse.urlparse(url)
        return all([result.scheme in ('http', 'https'), result.netloc])
    except:
        return False

def fetch_metadata(url):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
    })
    
    with urllib.request.urlopen(req, timeout=10) as response:
        status_code = response.getcode()
        content = response.read().decode('utf-8', errors='ignore')
        
        parser = MetaDataParser()
        try:
            parser.feed(content)
        except:
            pass
        
        return {
            'title': parser.title or '',
            'description': parser.description or '',
            'status_code': status_code
        }

@app.route('/preview', methods=['POST'])
def preview():
    if not request.is_json:
        return jsonify({'error': 'Invalid URL provided'}), 400
        
    data = request.get_json()
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
        
    url = data['url']
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        metadata = fetch_metadata(url)
        return jsonify(metadata), 200
    except Exception:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)