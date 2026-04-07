from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
import ssl

app = Flask(__name__)

class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
    
    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        elif tag == "meta":
            attr_dict = dict(attrs)
            
            # Check for description meta tag
            if attr_dict.get("name") == "description":
                self.description = attr_dict.get("content", "")
            
            # Check for Open Graph description
            elif attr_dict.get("property") == "og:description" and not self.description:
                self.description = attr_dict.get("content", "")
    
    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()

@app.route('/preview', methods=['POST'])
def preview():
    try:
        # Get JSON data
        data = request.get_json()
        
        # Check if data is present
        if not data:
            return jsonify({"error": "Invalid URL provided"}), 400
        
        # Check if URL is present
        url = data.get('url')
        if not url:
            return jsonify({"error": "Invalid URL provided"}), 400
        
        # Validate URL format
        try:
            parsed_url = urllib.parse.urlparse(url)
            if not parsed_url.scheme or not parsed_url.netloc:
                return jsonify({"error": "Invalid URL provided"}), 400
        except:
            return jsonify({"error": "Invalid URL provided"}), 400
        
        # Fetch the URL
        try:
            # Create SSL context that doesn't verify certificates (for simplicity)
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
            # Create request with headers
            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            )
            
            # Make the request
            with urllib.request.urlopen(req, context=ctx, timeout=10) as response:
                status_code = response.getcode()
                
                # Read and decode the content
                content = response.read()
                
                # Try to decode with different encodings
                html_content = None
                for encoding in ['utf-8', 'latin-1', 'iso-8859-1']:
                    try:
                        html_content = content.decode(encoding)
                        break
                    except:
                        continue
                
                if not html_content:
                    html_content = content.decode('utf-8', errors='ignore')
                
                # Parse HTML to extract metadata
                parser = MetadataParser()
                parser.feed(html_content)
                
                # Prepare response
                result = {
                    "title": parser.title or "",
                    "description": parser.description or "",
                    "status_code": status_code
                }
                
                return jsonify(result), 200
                
        except urllib.error.URLError as e:
            return jsonify({"error": "Could not fetch the provided URL"}), 422
        except Exception as e:
            return jsonify({"error": "Could not fetch the provided URL"}), 422
            
    except Exception as e:
        return jsonify({"error": "Invalid URL provided"}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)