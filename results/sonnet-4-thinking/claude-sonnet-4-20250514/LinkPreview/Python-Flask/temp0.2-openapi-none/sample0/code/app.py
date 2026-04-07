from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser

app = Flask(__name__)

class MetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self.in_title = False
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == "title":
            self.in_title = True
        elif tag.lower() == "meta":
            attrs_dict = {k.lower(): v for k, v in attrs}
            if not self.description:
                if attrs_dict.get("name") == "description":
                    self.description = attrs_dict.get("content", "")
                elif attrs_dict.get("property") == "og:description":
                    self.description = attrs_dict.get("content", "")
    
    def handle_endtag(self, tag):
        if tag.lower() == "title":
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title:
            self.title += data

def is_valid_url(url):
    try:
        if not isinstance(url, str) or not url.strip():
            return False
        result = urllib.parse.urlparse(url)
        return bool(result.scheme and result.netloc and result.scheme in ['http', 'https'])
    except:
        return False

def fetch_url_metadata(url):
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            content = response.read().decode('utf-8', errors='ignore')
            
            parser = MetaParser()
            parser.feed(content)
            
            return {
                'title': parser.title.strip(),
                'description': parser.description.strip(),
                'status_code': status_code
            }
            
    except:
        return None

@app.route('/preview', methods=['POST'])
def preview():
    try:
        data = request.get_json()
    except:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data['url']
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    metadata = fetch_url_metadata(url)
    
    if metadata is None:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    
    return jsonify(metadata), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)