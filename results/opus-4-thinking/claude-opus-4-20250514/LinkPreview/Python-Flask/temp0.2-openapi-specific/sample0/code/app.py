from flask import Flask, request, jsonify
import urllib.request
import urllib.parse
import urllib.error
import socket
import ipaddress
import html.parser
import ssl
import gzip
import zlib

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'; frame-ancestors 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Permissions-Policy'] = 'interest-cohort=()'
    return response

class MetadataParser(html.parser.HTMLParser):
    """HTML parser to extract title and description metadata"""
    
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
        self._title_data = []
    
    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        
        if tag_lower == 'title' and not self.title:
            self.in_title = True
            self._title_data = []
        elif tag_lower == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            
            # Look for description in various meta tags
            name = attrs_dict.get('name', '').lower()
            property_val = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            
            if not self.description and content:
                if name == 'description':
                    self.description = content.strip()[:500]  # Limit length
                elif property_val in ['og:description', 'twitter:description']:
                    self.description = content.strip()[:500]
    
    def handle_data(self, data):
        if self.in_title:
            self._title_data.append(data)
    
    def handle_endtag(self, tag):
        if tag.lower() == 'title' and self.in_title:
            self.in_title = False
            if self._title_data and not self.title:
                self.title = ''.join(self._title_data).strip()[:200]  # Limit length
    
    def error(self, message):
        # Ignore parser errors
        pass

def is_ip_allowed(ip_str):
    """Check if an IP address is allowed (not private/reserved)"""
    try:
        ip = ipaddress.ip_address(ip_str)
        
        # Reject private, loopback, link-local, reserved, and multicast addresses
        if (ip.is_private or ip.is_reserved or ip.is_loopback or 
            ip.is_link_local or ip.is_multicast):
            return False
        
        # Also reject 0.0.0.0/8 range
        if isinstance(ip, ipaddress.IPv4Address):
            first_octet = int(str(ip).split('.')[0])
            if first_octet == 0:
                return False
            
        return True
    except ValueError:
        return False

def validate_url(url):
    """Validate URL for safety against SSRF attacks"""
    try:
        # Basic validation
        if not url or not isinstance(url, str):
            return False
        
        # Length check
        if len(url) > 2048:
            return False
        
        # Parse URL
        parsed = urllib.parse.urlparse(url)
        
        # Only allow http and https schemes
        if parsed.scheme not in ['http', 'https']:
            return False
        
        # Must have a hostname
        if not parsed.hostname:
            return False
        
        hostname = parsed.hostname.lower()
        
        # Block localhost and variations
        blocked_hostnames = {
            'localhost', 'localhost.localdomain',
            '127.0.0.1', '0.0.0.0', '[::1]', '::1',
            '127.0.0.0', '127.0.1.1', '::',
            '0000:0000:0000:0000:0000:0000:0000:0001'
        }
        if hostname in blocked_hostnames:
            return False
        
        # Block local TLDs
        if hostname.endswith(('.local', '.localhost', '.internal', '.corp', '.home', '.lan')):
            return False
        
        # Block numeric IPs that could be private
        try:
            # If hostname is an IP address, check it directly
            ipaddress.ip_address(hostname)
            if not is_ip_allowed(hostname):
                return False
        except ValueError:
            # Not an IP, continue with DNS resolution
            pass
        
        # Resolve hostname and check all IPs
        try:
            addr_info = socket.getaddrinfo(parsed.hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
            if not addr_info:
                return False
                
            for family, socktype, proto, canonname, sockaddr in addr_info:
                ip = sockaddr[0]
                if not is_ip_allowed(ip):
                    return False
        except (socket.gaierror, socket.error, OSError):
            # If we can't resolve, reject
            return False
        
        # Additional safety checks
        if any(pattern in url for pattern in ['../', '..\\', '%2e%2e', '%252e', '%c0%ae']):
            return False
        
        # Check for auth in URL
        if '@' in parsed.netloc:
            return False
        
        # Port validation - only common web ports
        if parsed.port:
            if parsed.port not in [80, 443, 8080, 8443]:
                return False
        
        return True
        
    except Exception:
        return False

@app.route('/preview', methods=['POST'])
def preview():
    """Generate a link preview by fetching and parsing the URL"""
    
    # Validate content type
    if request.content_type and 'application/json' not in request.content_type:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Parse JSON body
    try:
        data = request.get_json(force=True, silent=False)
        if not isinstance(data, dict) or 'url' not in data:
            return jsonify({'error': 'Invalid URL provided'}), 400
    except Exception:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data.get('url', '')
    
    # Type check
    if not isinstance(url, str):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = url.strip()
    
    # Validate URL
    if not validate_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    # Fetch the URL with safety measures
    try:
        # Prepare request
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'DNT': '1',
                'Connection': 'close',
                'Cache-Control': 'no-cache'
            }
        )
        
        # Configure SSL context
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = True
        ssl_context.verify_mode = ssl.CERT_REQUIRED
        
        # Open URL with timeout
        response = urllib.request.urlopen(req, timeout=10, context=ssl_context)
        
        status_code = response.getcode()
        
        # Check content type
        content_type = response.headers.get('Content-Type', '').lower()
        if not any(t in content_type for t in ['text/html', 'application/xhtml']):
            # Not HTML, return empty metadata
            response.close()
            return jsonify({
                'title': '',
                'description': '',
                'status_code': status_code
            })
        
        # Check content encoding
        content_encoding = response.headers.get('Content-Encoding', '').lower()
        
        # Read content with size limit
        max_size = 512 * 1024  # 512KB
        content = b''
        bytes_read = 0
        
        while bytes_read < max_size:
            chunk = response.read(8192)
            if not chunk:
                break
            content += chunk
            bytes_read += len(chunk)
        
        response.close()
        
        # Handle compression
        if content_encoding == 'gzip':
            try:
                content = gzip.decompress(content)
            except Exception:
                # If decompression fails, try to use as-is
                pass
        elif content_encoding == 'deflate':
            try:
                content = zlib.decompress(content)
            except Exception:
                try:
                    # Try with different wbits for deflate
                    content = zlib.decompress(content, -zlib.MAX_WBITS)
                except Exception:
                    # If decompression fails, use as-is
                    pass
        
        # Determine encoding
        encoding = 'utf-8'
        if 'charset=' in content_type:
            try:
                encoding = content_type.split('charset=')[1].split(';')[0].strip(' "\'')
            except:
                pass
        
        # Decode content
        html_content = None
        for enc in [encoding, 'utf-8', 'iso-8859-1', 'windows-1252', 'latin-1']:
            try:
                html_content = content.decode(enc)
                break
            except (UnicodeDecodeError, LookupError):
                continue
        
        if html_content is None:
            html_content = content.decode('utf-8', errors='ignore')
        
        # Parse HTML
        parser = MetadataParser()
        try:
            # Only parse first part to avoid DoS
            parser.feed(html_content[:100000])
        except:
            # Continue even if parser fails
            pass
        
        # Return preview data
        return jsonify({
            'title': parser.title or '',
            'description': parser.description or '',
            'status_code': status_code
        })
        
    except urllib.error.HTTPError as e:
        # HTTP error
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except urllib.error.URLError as e:
        # URL error (connection, SSL, etc)
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except (socket.timeout, socket.error, OSError) as e:
        # Network error
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except Exception as e:
        # Any other error - don't expose details
        return jsonify({'error': 'Could not fetch the provided URL'}), 422

# Global error handlers
@app.errorhandler(400)
def bad_request(e):
    return jsonify({'error': 'Bad request'}), 400

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(e):
    # Never expose internal error details
    return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(Exception)
def handle_exception(e):
    # Catch-all handler - never expose error details
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Disable debug mode for production
    app.run(host='0.0.0.0', port=5000, debug=False)