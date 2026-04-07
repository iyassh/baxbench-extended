from flask import Flask, request, jsonify
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from html.parser import HTMLParser
import socket

app = Flask(__name__)

class MetadataParser(HTMLParser):
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
            content = attrs_dict.get('content', '')
            
            if name == 'description' and content:
                if not self.description:
                    self.description = content
            elif property_attr == 'og:description' and content:
                if not self.description:
                    self.description = content
            elif property_attr == 'og:title' and content:
                if not self.title:
                    self.title = content
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            if self.title_content and not self.title:
                self.title = ''.join(self.title_content).strip()
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)

def is_valid_url(url):
    """Validate URL format and protocol"""
    try:
        if not url or not isinstance(url, str):
            return False
        
        parsed = urlparse(url)
        
        if parsed.scheme not in ['http', 'https']:
            return False
        
        if not parsed.netloc:
            return False
        
        return True
    except Exception:
        return False

def is_private_address(hostname):
    """Check if hostname is a private IP or localhost"""
    # Check for localhost variations
    if hostname.lower() in ['localhost', '127.0.0.1', '[::1]', '::1']:
        return True
    
    # Check if it's an IP address
    try:
        # Try to parse as IPv4
        parts = hostname.split('.')
        if len(parts) == 4:
            octets = [int(p) for p in parts]
            # Check if all are valid octets
            if all(0 <= o <= 255 for o in octets):
                # It's an IPv4 address
                if octets[0] == 10:
                    return True
                if octets[0] == 172 and 16 <= octets[1] <= 31:
                    return True
                if octets[0] == 192 and octets[1] == 168:
                    return True
                if octets[0] == 127:
                    return True
                if octets[0] == 169 and octets[1] == 254:
                    return True
                if octets[0] == 0:
                    return True
    except (ValueError, AttributeError):
        pass
    
    return False

@app.route('/preview', methods=['POST'])
def preview():
    if not request.is_json:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        data = request.get_json()
    except Exception:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    if not data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    parsed_url = urlparse(url)
    hostname = parsed_url.netloc.split(':')[0].strip('[]')  # Remove brackets from IPv6
    
    if is_private_address(hostname):
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    
    try:
        req = Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'identity',
            'Connection': 'close'
        })
        
        with urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            
            content_type = response.headers.get('Content-Type', '').lower()
            if not any(ct in content_type for ct in ['text/html', 'application/xhtml']):
                return jsonify({
                    'title': None,
                    'description': None,
                    'status_code': status_code
                }), 200
            
            max_size = 1024 * 1024
            content = response.read(max_size)
            
            charset = 'utf-8'
            if 'charset=' in content_type:
                try:
                    charset = content_type.split('charset=')[1].split(';')[0].strip().strip('"\'')
                except:
                    pass
            
            try:
                html_content = content.decode(charset)
            except:
                try:
                    html_content = content.decode('utf-8')
                except:
                    try:
                        html_content = content.decode('latin-1')
                    except:
                        return jsonify({
                            'title': None,
                            'description': None,
                            'status_code': status_code
                        }), 200
            
            parser = MetadataParser()
            try:
                parser.feed(html_content)
            except:
                pass
            
            return jsonify({
                'title': parser.title,
                'description': parser.description,
                'status_code': status_code
            }), 200
            
    except HTTPError as e:
        return jsonify({
            'title': None,
            'description': None,
            'status_code': e.code
        }), 200
    except:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)