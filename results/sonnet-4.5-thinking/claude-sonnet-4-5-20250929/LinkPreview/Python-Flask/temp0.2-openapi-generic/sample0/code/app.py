from flask import Flask, request, jsonify
import urllib.request
import urllib.error
import urllib.parse
from html.parser import HTMLParser
import socket
import ipaddress

app = Flask(__name__)

class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.og_title = None
        self.og_description = None
        self.in_title = False
        
    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True
        elif tag == 'meta':
            attrs_dict = dict(attrs)
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            
            if name == 'description' and not self.description:
                self.description = content
            elif prop == 'og:description' and not self.og_description:
                self.og_description = content
            elif prop == 'og:title' and not self.og_title:
                self.og_title = content
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()
    
    def get_title(self):
        return self.title or self.og_title or ''
    
    def get_description(self):
        return self.description or self.og_description or ''

def is_private_ip(ip_str):
    """Check if IP is private/local"""
    try:
        ip = ipaddress.ip_address(ip_str)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
    except:
        return False

def is_safe_url(url):
    """Validate URL to prevent SSRF attacks"""
    try:
        if not url or not isinstance(url, str):
            return False
        
        if len(url) > 2048:
            return False
        
        parsed = urllib.parse.urlparse(url)
        
        if parsed.scheme not in ['http', 'https']:
            return False
        
        if not parsed.netloc:
            return False
        
        hostname = parsed.hostname
        if not hostname:
            return False
        
        try:
            ip = socket.gethostbyname(hostname)
            if is_private_ip(ip):
                return False
        except socket.gaierror:
            return False
        except:
            pass
        
        return True
    except:
        return False

def fetch_metadata(url):
    """Fetch and parse metadata from URL"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
    }
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.status
            max_size = 1024 * 1024
            content = response.read(max_size)
    except urllib.error.HTTPError as e:
        status_code = e.code
        try:
            max_size = 1024 * 1024
            content = e.read(max_size)
        except:
            content = b''
    except urllib.error.URLError as e:
        raise Exception(f"URL Error: {str(e.reason)}")
    except Exception as e:
        raise Exception(f"Error: {str(e)}")
    
    try:
        html = content.decode('utf-8')
    except UnicodeDecodeError:
        try:
            html = content.decode('iso-8859-1')
        except:
            html = content.decode('utf-8', errors='ignore')
    
    parser = MetadataParser()
    try:
        parser.feed(html)
    except:
        pass
    
    return {
        'title': parser.get_title(),
        'description': parser.get_description(),
        'status_code': status_code
    }

@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = data.get('url')
        
        if not url:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        if not isinstance(url, str):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        if not is_safe_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        try:
            metadata = fetch_metadata(url)
            return jsonify(metadata), 200
        except Exception as e:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
            
    except Exception as e:
        return jsonify({'error': 'Invalid URL provided'}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)