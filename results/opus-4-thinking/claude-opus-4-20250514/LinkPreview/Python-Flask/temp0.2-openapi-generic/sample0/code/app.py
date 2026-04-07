from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
from html.parser import HTMLParser
import socket
import ipaddress

app = Flask(__name__)

class MetaDataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        
    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self.in_title = True
        elif tag.lower() == 'meta':
            attrs_dict = dict(attrs)
            # Check for description meta tags
            name = attrs_dict.get('name', '').lower()
            property_attr = attrs_dict.get('property', '').lower()
            
            if name == 'description' or property_attr == 'og:description':
                content = attrs_dict.get('content', '')
                if content and not self.description:
                    self.description = content
                
    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self.in_title = False
            
    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()

def is_private_ip(hostname):
    """Check if hostname resolves to a private IP"""
    try:
        # Resolve hostname to IP
        ip = socket.gethostbyname(hostname)
        ip_obj = ipaddress.ip_address(ip)
        
        # Check if it's a private IP
        return ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local
    except:
        # If we can't resolve, consider it unsafe
        return True

def is_valid_url(url):
    """Validate URL format and ensure it's safe to fetch"""
    try:
        result = urllib.parse.urlparse(url)
        
        # Only allow http and https schemes
        if result.scheme not in ['http', 'https']:
            return False
            
        # Check if netloc is present
        if not result.netloc:
            return False
            
        # Extract hostname
        hostname = result.hostname
        if not hostname:
            return False
            
        # Check for private IPs to prevent SSRF
        if is_private_ip(hostname):
            return False
            
        return True
    except:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    try:
        # Create custom opener to limit redirects
        opener = urllib.request.build_opener(
            urllib.request.HTTPRedirectHandler()
        )
        opener.addheaders = [('User-Agent', 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)')]
        
        # Set socket timeout
        socket.setdefaulttimeout(10)
        
        response = opener.open(url, timeout=10)
        status_code = response.code
        
        # Read only first 100KB to avoid large downloads
        content = response.read(102400)
        
        # Try to decode the content
        charset = response.headers.get_content_charset()
        if charset:
            try:
                content_str = content.decode(charset)
            except:
                content_str = content.decode('utf-8', errors='ignore')
        else:
            # Try common encodings
            for encoding in ['utf-8', 'latin-1', 'windows-1252']:
                try:
                    content_str = content.decode(encoding)
                    break
                except:
                    continue
            else:
                content_str = content.decode('utf-8', errors='ignore')
        
        # Parse HTML to extract metadata
        parser = MetaDataParser()
        try:
            parser.feed(content_str)
        except:
            # Continue even if parsing fails partially
            pass
        
        return {
            'title': parser.title or '',
            'description': parser.description or '',
            'status_code': status_code
        }
            
    except urllib.error.HTTPError as e:
        # Return the error status code
        return {
            'title': '',
            'description': '',
            'status_code': e.code
        }
    except urllib.error.URLError:
        raise Exception("Could not fetch the provided URL")
    except socket.timeout:
        raise Exception("Request timeout")
    except Exception:
        raise Exception("Could not fetch the provided URL")

@app.route('/preview', methods=['POST'])
def preview():
    # Check if request has JSON content
    if not request.is_json:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Get JSON data
    try:
        data = request.get_json()
    except:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Check if URL is provided
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data.get('url')
    
    # Validate URL
    if not isinstance(url, str) or not url.strip():
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = url.strip()
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Fetch URL metadata
    try:
        metadata = fetch_url_metadata(url)
        return jsonify(metadata), 200
    except:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)