from flask import Flask, request, jsonify
import urllib.request
import urllib.error
import urllib.parse
from html.parser import HTMLParser
import re

app = Flask(__name__)

class MetaTagParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self.title_data = []
        
    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)
        
        if tag == 'title' and not self.title:
            self.in_title = True
            self.title_data = []
        elif tag == 'meta':
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            
            if name == 'description' and not self.description:
                self.description = content
            elif prop == 'og:description' and not self.description:
                self.description = content
            elif prop == 'og:title' and not self.title:
                self.title = content
    
    def handle_endtag(self, tag):
        if tag == 'title' and self.in_title:
            self.in_title = False
            if not self.title and self.title_data:
                self.title = ''.join(self.title_data).strip()
    
    def handle_data(self, data):
        if self.in_title:
            self.title_data.append(data)

def validate_url(url):
    """Validate URL format and scheme"""
    if not url or not isinstance(url, str):
        return False
    
    if len(url) > 2048:
        return False
    
    try:
        parsed = urllib.parse.urlparse(url)
    except:
        return False
    
    if parsed.scheme not in ['http', 'https']:
        return False
    
    if not parsed.netloc:
        return False
    
    return True

def is_safe_hostname(hostname):
    """Check if hostname is safe (not private/internal)"""
    if not hostname:
        return False
    
    blocked_patterns = [
        r'^localhost$',
        r'^127\.',
        r'^0\.0\.0\.0$',
        r'^10\.',
        r'^172\.(1[6-9]|2[0-9]|3[0-1])\.',
        r'^192\.168\.',
        r'^169\.254\.',
        r'^22[4-9]\.',
        r'^23[0-9]\.',
        r'^::1$',
        r'^::$',
        r'^fc00:',
        r'^fe80:',
    ]
    
    for pattern in blocked_patterns:
        if re.match(pattern, hostname, re.IGNORECASE):
            return False
    
    return True

def is_safe_url(url):
    """Check if URL is safe to fetch (prevent SSRF)"""
    try:
        parsed = urllib.parse.urlparse(url)
        return is_safe_hostname(parsed.hostname)
    except:
        return False

class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Custom redirect handler that validates redirect URLs"""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_safe_url(newurl):
            raise urllib.error.URLError("Redirect to unsafe URL blocked")
        return urllib.request.HTTPRedirectHandler.redirect_request(
            self, req, fp, code, msg, headers, newurl
        )

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
    }
    
    req = urllib.request.Request(url, headers=headers)
    opener = urllib.request.build_opener(SafeRedirectHandler)
    
    try:
        with opener.open(req, timeout=10) as response:
            status_code = response.status
            
            content_type = response.headers.get('Content-Type', '')
            if 'text/html' not in content_type.lower():
                return {
                    'title': '',
                    'description': '',
                    'status_code': status_code
                }
            
            content = response.read(1024 * 1024)
            
            try:
                html_content = content.decode('utf-8')
            except UnicodeDecodeError:
                try:
                    html_content = content.decode('latin-1')
                except:
                    html_content = content.decode('utf-8', errors='ignore')
            
            parser = MetaTagParser()
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
        
    except (urllib.error.URLError, Exception):
        raise Exception("Could not fetch the provided URL")

@app.route('/preview', methods=['POST'])
def preview():
    if not request.is_json:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        data = request.get_json()
    except:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data['url']
    
    if not validate_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    if not is_safe_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        metadata = fetch_url_metadata(url)
        return jsonify(metadata), 200
    except Exception:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)