import urllib.request
import urllib.parse
import urllib.error
import html.parser
import re
from flask import Flask, request, jsonify

app = Flask(__name__)

class MetadataParser(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self._in_title = False
        self._title_data = []

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        if tag_lower == 'title':
            self._in_title = True
            self._title_data = []
        elif tag_lower == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            if name == 'description' or prop == 'og:description':
                if self.description is None:
                    self.description = content
            if prop == 'og:title':
                if self.title is None:
                    self.title = content

    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self._in_title = False
            if self.title is None:
                self.title = ''.join(self._title_data).strip()

    def handle_data(self, data):
        if self._in_title:
            self._title_data.append(data)


def is_valid_url(url):
    try:
        parsed = urllib.parse.urlparse(url)
        return parsed.scheme in ('http', 'https') and bool(parsed.netloc)
    except Exception:
        return False


def fetch_metadata(url):
    headers = {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }
    req = urllib.request.Request(url, headers=headers)
    response = urllib.request.urlopen(req, timeout=10)
    status_code = response.getcode()
    content_type = response.headers.get('Content-Type', '')
    
    # Only parse HTML content
    if 'html' not in content_type.lower():
        return None, None, status_code
    
    # Read up to 500KB to avoid large downloads
    raw = response.read(512 * 1024)
    
    # Try to detect encoding
    charset = 'utf-8'
    ct_match = re.search(r'charset=([^\s;]+)', content_type, re.IGNORECASE)
    if ct_match:
        charset = ct_match.group(1).strip()
    
    try:
        html_content = raw.decode(charset, errors='replace')
    except (LookupError, UnicodeDecodeError):
        html_content = raw.decode('utf-8', errors='replace')
    
    parser = MetadataParser()
    try:
        parser.feed(html_content)
    except Exception:
        pass
    
    return parser.title, parser.description, status_code


@app.route('/preview', methods=['POST'])
def preview():
    data = request.get_json(silent=True)
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid or missing URL'}), 400
    
    url = data['url']
    
    if not isinstance(url, str) or not url.strip():
        return jsonify({'error': 'Invalid or missing URL'}), 400
    
    url = url.strip()
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Prevent SSRF by blocking private/local addresses
    try:
        parsed = urllib.parse.urlparse(url)
        hostname = parsed.hostname
        if hostname is None:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Block localhost and common private hostnames
        blocked_hosts = {'localhost', '127.0.0.1', '0.0.0.0', '::1'}
        if hostname.lower() in blocked_hosts:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Block private IP ranges using basic checks
        import ipaddress
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except ValueError:
            # Not an IP address, it's a hostname - allow it
            pass
            
    except Exception:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        title, description, status_code = fetch_metadata(url)
        return jsonify({
            'title': title or '',
            'description': description or '',
            'status_code': status_code
        }), 200
    except urllib.error.URLError as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except Exception as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)