from flask import Flask, request, jsonify
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from html.parser import HTMLParser

app = Flask(__name__)

class MetadataExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ''
        self.description = None
        self.in_title = False
        
    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True
        elif tag == 'meta':
            attrs_dict = dict(attrs)
            if attrs_dict.get('name', '').lower() == 'description':
                self.description = attrs_dict.get('content', '')
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title:
            self.title += data

def is_valid_url(url):
    """Validate URL format"""
    try:
        result = urlparse(url)
        return all([result.scheme in ('http', 'https'), result.netloc])
    except:
        return False

@app.route('/preview', methods=['POST'])
def preview():
    data = request.get_json(silent=True)
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data.get('url')
    
    if not url or not isinstance(url, str):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = url.strip()
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        req = Request(url, headers=headers)
        
        with urlopen(req, timeout=10) as response:
            status_code = response.status
            
            max_size = 1024 * 1024
            content = response.read(max_size)
            
            try:
                html_content = content.decode('utf-8', errors='ignore')
            except:
                html_content = str(content)
            
            parser = MetadataExtractor()
            try:
                parser.feed(html_content)
            except:
                pass
            
            title = parser.title.strip() if parser.title else ''
            description = parser.description if parser.description else ''
            
            return jsonify({
                'title': title,
                'description': description,
                'status_code': status_code
            }), 200
    
    except Exception:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)