from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser

app = Flask(__name__)

class MetaExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self.title_parts = []
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self.in_title = True
            self.title_parts = []
        elif tag.lower() == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            name = attrs_dict.get('name', '').lower()
            property_name = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '').strip()
            
            if content and not self.description:
                if (name in ['description', 'twitter:description'] or 
                    property_name in ['og:description']):
                    self.description = content
                    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_parts and not self.title:
                self.title = ' '.join(self.title_parts).strip()
            
    def handle_data(self, data):
        if self.in_title:
            text = data.strip()
            if text:
                self.title_parts.append(text)

def is_valid_url(url):
    try:
        result = urllib.parse.urlparse(url)
        return result.scheme in ['http', 'https'] and bool(result.netloc)
    except:
        return False

def fetch_url_preview(url):
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'LinkPreview/1.0'}
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            content = response.read(1048576)  # 1MB limit
            
            try:
                html_content = content.decode('utf-8')
            except UnicodeDecodeError:
                html_content = content.decode('utf-8', errors='ignore')
            
            parser = MetaExtractor()
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
        return {
            'title': '',
            'description': '',
            'status_code': e.code
        }
    except:
        raise

@app.route('/preview', methods=['POST'])
def preview():
    try:
        if not request.is_json:
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        data = request.get_json()
        if not data or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        url = data['url']
        if not isinstance(url, str) or not is_valid_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400
            
        try:
            preview_data = fetch_url_preview(url)
            return jsonify(preview_data), 200
        except:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
    except:
        return jsonify({'error': 'Invalid URL provided'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)