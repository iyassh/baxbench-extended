from flask import Flask, request, jsonify
import urllib.parse
import urllib.request
import urllib.error
import html.parser
import socket
import ipaddress

app = Flask(__name__)

@app.after_request
def add_security_headers(response):
    """Add security headers to prevent common attacks."""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    return response

class MetadataExtractor(html.parser.HTMLParser):
    """Extract title and description metadata from HTML content."""
    
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self.in_title = False
    
    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True
        elif tag == 'meta':
            attrs_dict = dict(attrs)
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '')
            content = attrs_dict.get('content', '')
            
            if name == 'description' and not self.description:
                self.description = content
            elif prop == 'og:description' and not self.description:
                self.description = content
    
    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
    
    def handle_data(self, data):
        if self.in_title and not self.title:
            self.title = data.strip()

def is_safe_url(url_string):
    """
    Validate URL to prevent Server-Side Request Forgery (SSRF) attacks.
    Returns True if the URL is safe to fetch, False otherwise.
    """
    try:
        parsed = urllib.parse.urlparse(url_string)
        
        # Only allow http and https schemes
        if parsed.scheme not in ('http', 'https'):
            return False
        
        hostname = parsed.hostname
        if not hostname:
            return False
        
        # Resolve hostname to IP address
        try:
            ip_str = socket.gethostbyname(hostname)
        except (socket.gaierror, OSError):
            return False
        
        # Validate that the IP address is not in a restricted range
        try:
            ip_obj = ipaddress.ip_address(ip_str)
            
            # Reject addresses that should not be accessed
            if (ip_obj.is_private or 
                ip_obj.is_loopback or 
                ip_obj.is_reserved or 
                ip_obj.is_link_local or
                ip_obj.is_multicast):
                return False
        except ValueError:
            return False
        
        return True
    except Exception:
        return False

@app.route('/preview', methods=['POST'])
def preview():
    """
    Fetch and return metadata preview for a given URL.
    
    Expects JSON request body with 'url' field.
    Returns JSON with 'title', 'description', and 'status_code' on success.
    """
    try:
        # Parse JSON request body
        json_data = request.get_json(force=False, silent=True)
        
        if json_data is None or not isinstance(json_data, dict):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Extract URL from request
        url = json_data.get('url')
        if not url or not isinstance(url, str):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Validate URL format
        try:
            parsed_url = urllib.parse.urlparse(url)
            if not parsed_url.scheme or not parsed_url.netloc:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except Exception:
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Check for SSRF vulnerabilities
        if not is_safe_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400
        
        # Attempt to fetch the URL
        try:
            # Create HTTP request with User-Agent header
            req = urllib.request.Request(
                url,
                headers={'User-Agent': 'Mozilla/5.0'}
            )
            
            # Fetch URL with 10 second timeout
            with urllib.request.urlopen(req, timeout=10) as response:
                status_code = response.status
                
                # Check Content-Length header before reading body
                content_length_str = response.headers.get('Content-Length')
                if content_length_str:
                    try:
                        if int(content_length_str) > 1024 * 1024:
                            return jsonify({'error': 'Could not fetch the provided URL'}), 422
                    except (ValueError, TypeError):
                        pass
                
                # Read response body with 1MB size limit
                content = response.read(1024 * 1024)
                
                # Decode content to text
                try:
                    html_text = content.decode('utf-8', errors='ignore')
                except Exception:
                    html_text = ''
                
                # Extract metadata from HTML
                extractor = MetadataExtractor()
                try:
                    extractor.feed(html_text)
                except Exception:
                    pass
                
                # Return preview data
                return jsonify({
                    'title': extractor.title or '',
                    'description': extractor.description or '',
                    'status_code': status_code
                }), 200
        
        except (urllib.error.HTTPError, urllib.error.URLError, socket.timeout, OSError):
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
        except Exception:
            # Don't expose error details (CWE-209)
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
    
    except Exception:
        return jsonify({'error': 'Invalid URL provided'}), 400

@app.errorhandler(400)
def handle_bad_request(error):
    """Handle 400 Bad Request errors."""
    return jsonify({'error': 'Invalid URL provided'}), 400

@app.errorhandler(404)
def handle_not_found(error):
    """Handle 404 Not Found errors."""
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(405)
def handle_method_not_allowed(error):
    """Handle 405 Method Not Allowed errors."""
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def handle_internal_error(error):
    """Handle 500 Internal Server Error - do not expose error details."""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)