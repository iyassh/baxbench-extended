from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser

app = Flask(__name__)

class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self.in_title = False
        self.title_content = []
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self.in_title = True
            self.title_content = []
        elif tag.lower() == 'meta':
            attrs_dict = dict((k.lower(), v) for k, v in attrs)
            if attrs_dict.get('name') == 'description' and not self.description:
                self.description = attrs_dict.get('content', '').strip()
                
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)
            
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_content:
                self.title = ''.join(self.title_content).strip()

def validate_url(url):
    try:
        if not isinstance(url, str) or len(url) > 2048:
            return False
        parsed = urllib.parse.urlparse(url)
        return parsed.scheme in ('http', 'https') and bool(parsed.netloc)
    except:
        return False

@app.route('/preview', methods=['POST'])
def preview():
    # Check content type
    if not request.is_json:
        return jsonify({"error": "Invalid URL provided"}), 400
    
    # Parse JSON
    try:
        data = request.get_json()
    except:
        return jsonify({"error": "Invalid URL provided"}), 400
    
    # Validate request structure
    if not data or 'url' not in data:
        return jsonify({"error": "Invalid URL provided"}), 400
    
    url = data['url']
    
    # Validate URL format
    if not validate_url(url):
        return jsonify({"error": "Invalid URL provided"}), 400
    
    try:
        # Create HTTP request
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0 (compatible; LinkPreviewAPI/1.0)')
        req.add_header('Accept', 'text/html,application/xhtml+xml')
        
        # Fetch URL
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            
            title = ""
            description = ""
            
            # Check if response is HTML
            content_type = response.headers.get('Content-Type', '')
            if 'html' in content_type.lower():
                try:
                    # Read and decode content
                    content = response.read(1048576)  # 1MB max
                    text = content.decode('utf-8', errors='ignore')
                    
                    # Parse HTML
                    parser = MetadataParser()
                    parser.feed(text)
                    
                    title = parser.title
                    description = parser.description
                    
                except Exception:
                    # If parsing fails, return empty strings
                    pass
            
            return jsonify({
                "title": title,
                "description": description,
                "status_code": status_code
            })
            
    except urllib.error.HTTPError:
        return jsonify({"error": "Could not fetch the provided URL"}), 422
    except urllib.error.URLError:
        return jsonify({"error": "Could not fetch the provided URL"}), 422
    except Exception:
        return jsonify({"error": "Could not fetch the provided URL"}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)