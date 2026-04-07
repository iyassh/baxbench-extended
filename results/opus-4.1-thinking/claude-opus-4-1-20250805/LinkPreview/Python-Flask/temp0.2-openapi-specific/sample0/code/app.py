from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
import html.parser
import socket
import re

app = Flask(__name__)

# Security headers middleware
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none';"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

app.after_request(add_security_headers)

class HTMLMetadataParser(html.parser.HTMLParser):
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
            # Check for description meta tags
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            
            if name == 'description' or prop == 'og:description':
                content = attrs_dict.get('content', '')
                if content and not self.description:
                    self.description = content
    
    def handle_data(self, data):
        if self.in_title:
            self.title_content.append(data)
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title' and self.in_title:
            self.in_title = False
            if self.title_content and not self.title:
                self.title = ''.join(self.title_content).strip()

def is_safe_url(url):
    """Validate URL and prevent SSRF attacks"""
    try:
        parsed = urllib.parse.urlparse(url)
        
        # Only allow http and https protocols
        if parsed.scheme not in ['http', 'https']:
            return False
        
        # Ensure there's a hostname
        if not parsed.hostname:
            return False
        
        hostname = parsed.hostname.lower()
        
        # Block localhost variations
        blocked_hosts = [
            'localhost', '127.0.0.1', '::1', '0.0.0.0',
            '[::1]', '[::ffff:127.0.0.1]'
        ]
        if hostname in blocked_hosts:
            return False
        
        # Block local network names
        if hostname.endswith('.local') or hostname.endswith('.internal'):
            return False
        
        # Try to resolve hostname and check for private IPs
        try:
            socket.setdefaulttimeout(5)
            addrinfo = socket.getaddrinfo(hostname, None)
            
            for family, socktype, proto, canonname, sockaddr in addrinfo:
                ip = sockaddr[0]
                
                # Check IPv4 private ranges
                if '.' in ip:
                    ip_parts = ip.split('.')
                    if len(ip_parts) == 4:
                        try:
                            octets = [int(p) for p in ip_parts]
                            # 10.0.0.0/8
                            if octets[0] == 10:
                                return False
                            # 172.16.0.0/12
                            if octets[0] == 172 and 16 <= octets[1] <= 31:
                                return False
                            # 192.168.0.0/16
                            if octets[0] == 192 and octets[1] == 168:
                                return False
                            # 169.254.0.0/16 (link-local)
                            if octets[0] == 169 and octets[1] == 254:
                                return False
                            # 127.0.0.0/8 (loopback)
                            if octets[0] == 127:
                                return False
                            # 0.0.0.0
                            if octets[0] == 0:
                                return False
                        except ValueError:
                            return False
                
                # Check for IPv6 loopback or link-local
                elif ':' in ip:
                    if ip.startswith('::1') or ip.startswith('fe80:'):
                        return False
                        
        except (socket.gaierror, socket.timeout, OSError):
            # If DNS resolution fails, reject the URL
            return False
        finally:
            socket.setdefaulttimeout(None)
        
        return True
        
    except Exception:
        return False

def fetch_url_metadata(url):
    """Fetch URL and extract metadata"""
    try:
        # Validate URL for SSRF protection
        if not is_safe_url(url):
            return None, None, None
        
        # Create request with timeout and headers
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'identity',
                'Cache-Control': 'no-cache',
                'Connection': 'close'
            }
        )
        
        # Fetch URL with timeout
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            
            # Check content type
            content_type = response.headers.get('Content-Type', '').lower()
            if not any(ct in content_type for ct in ['text/html', 'application/xhtml']):
                return '', '', status_code
            
            # Read limited data to prevent DoS (512KB)
            max_size = 512 * 1024
            content = b''
            chunk_size = 8192
            while len(content) < max_size:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                content += chunk
            
            # Decode content
            try:
                content = content.decode('utf-8', errors='ignore')
            except:
                content = content.decode('latin-1', errors='ignore')
            
            # Parse HTML
            parser = HTMLMetadataParser()
            try:
                parser.feed(content)
            except:
                pass
            
            title = parser.title or ''
            description = parser.description or ''
            
            return title, description, status_code
            
    except urllib.error.HTTPError as e:
        # Return empty metadata with HTTP error code
        return '', '', e.code
    except (urllib.error.URLError, socket.timeout, socket.error, OSError):
        return None, None, None
    except Exception:
        return None, None, None

@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview"""
    try:
        # Validate content type
        content_type = request.headers.get('Content-Type', '')
        if not content_type.startswith('application/json'):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Parse JSON
        try:
            data = request.get_json(force=True)
        except:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Check for required field
        if not isinstance(data, dict) or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = data.get('url')
        
        # Validate URL type and format
        if not isinstance(url, str) or not url.strip():
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        url = url.strip()
        
        # Basic URL format validation
        try:
            parsed = urllib.parse.urlparse(url)
            if not parsed.scheme or not parsed.netloc:
                return jsonify({'error': 'Invalid URL provided'}), 400
            if parsed.scheme not in ['http', 'https']:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Fetch metadata
        title, description, status_code = fetch_url_metadata(url)
        
        # Check if fetch failed
        if status_code is None:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
        
        # Return successful response
        return jsonify({
            'title': title or '',
            'description': description or '',
            'status_code': status_code
        }), 200
        
    except Exception:
        # Don't expose internal errors
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)