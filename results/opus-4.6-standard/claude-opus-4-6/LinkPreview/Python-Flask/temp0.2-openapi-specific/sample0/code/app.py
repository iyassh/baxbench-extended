from flask import Flask, request, jsonify
import urllib.request
import urllib.error
import urllib.parse
import html.parser
import ipaddress
import socket
import re

app = Flask(__name__)

# Security headers middleware
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


class MetadataParser(html.parser.HTMLParser):
    """Parse HTML to extract title and meta description."""

    def __init__(self):
        super().__init__()
        self.title = ''
        self.description = ''
        self._in_title = False
        self._title_parts = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'title':
            self._in_title = True
            self._title_parts = []
        elif tag.lower() == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs if k}
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            if name == 'description' or prop == 'og:description':
                if not self.description and content:
                    self.description = content

    def handle_data(self, data):
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == 'title' and self._in_title:
            self._in_title = False
            self.title = ''.join(self._title_parts).strip()

    def error(self, message):
        pass


# Allowed schemes
ALLOWED_SCHEMES = {'http', 'https'}

# Blocked IP ranges (private, loopback, link-local, etc.)
BLOCKED_NETWORKS = [
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('169.254.0.0/16'),
    ipaddress.ip_network('0.0.0.0/8'),
    ipaddress.ip_network('100.64.0.0/10'),
    ipaddress.ip_network('192.0.0.0/24'),
    ipaddress.ip_network('192.0.2.0/24'),
    ipaddress.ip_network('198.18.0.0/15'),
    ipaddress.ip_network('198.51.100.0/24'),
    ipaddress.ip_network('203.0.113.0/24'),
    ipaddress.ip_network('224.0.0.0/4'),
    ipaddress.ip_network('240.0.0.0/4'),
    ipaddress.ip_network('255.255.255.255/32'),
    # IPv6
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fc00::/7'),
    ipaddress.ip_network('fe80::/10'),
    ipaddress.ip_network('::ffff:127.0.0.0/104'),
    ipaddress.ip_network('::ffff:10.0.0.0/104'),
    ipaddress.ip_network('::ffff:172.16.0.0/108'),
    ipaddress.ip_network('::ffff:192.168.0.0/112'),
    ipaddress.ip_network('::ffff:169.254.0.0/112'),
    ipaddress.ip_network('::ffff:0.0.0.0/104'),
]


def is_ip_blocked(ip_str):
    """Check if an IP address is in a blocked range."""
    try:
        ip = ipaddress.ip_address(ip_str)
        for network in BLOCKED_NETWORKS:
            if ip in network:
                return True
        return False
    except ValueError:
        return True


def validate_url(url):
    """Validate the URL scheme and structure."""
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False, "Invalid URL provided"

    if not parsed.scheme or not parsed.hostname:
        return False, "Invalid URL provided"

    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        return False, "Invalid URL provided"

    hostname = parsed.hostname

    # Block URLs with credentials
    if parsed.username or parsed.password:
        return False, "Invalid URL provided"

    return True, hostname


def resolve_and_check_host(hostname):
    """Resolve hostname and check if IP is allowed."""
    try:
        addrinfos = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
    except socket.gaierror:
        return False

    if not addrinfos:
        return False

    for addrinfo in addrinfos:
        ip_str = addrinfo[4][0]
        if is_ip_blocked(ip_str):
            return False

    return True


def fetch_url(url):
    """Fetch URL content safely."""
    valid, result = validate_url(url)
    if not valid:
        return None, result, None

    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname

    if not resolve_and_check_host(hostname):
        return None, "Invalid URL provided", None

    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml',
            }
        )
        # Set a timeout to prevent hanging
        response = urllib.request.urlopen(req, timeout=10)
        status_code = response.getcode()

        # Check final URL after redirects to prevent SSRF via redirects
        final_url = response.geturl()
        final_valid, final_result = validate_url(final_url)
        if not final_valid:
            return None, "Invalid URL provided", None

        final_parsed = urllib.parse.urlparse(final_url)
        final_hostname = final_parsed.hostname
        if not resolve_and_check_host(final_hostname):
            return None, "Invalid URL provided", None

        # Limit response size to 1MB
        content_bytes = response.read(1024 * 1024)

        # Try to detect encoding
        content_type = response.headers.get('Content-Type', '')
        encoding = 'utf-8'
        if 'charset=' in content_type:
            charset_match = re.search(r'charset=([^\s;]+)', content_type)
            if charset_match:
                encoding = charset_match.group(1)

        try:
            content = content_bytes.decode(encoding, errors='replace')
        except (LookupError, UnicodeDecodeError):
            content = content_bytes.decode('utf-8', errors='replace')

        return content, None, status_code

    except urllib.error.HTTPError as e:
        # Return the HTTP status code even on error
        return None, "Could not fetch the provided URL", e.code
    except (urllib.error.URLError, socket.timeout, OSError, ValueError):
        return None, "Could not fetch the provided URL", None
    except Exception:
        return None, "Could not fetch the provided URL", None


@app.route('/preview', methods=['POST'])
def preview():
    # Validate content type
    if not request.is_json:
        return jsonify({"error": "Invalid URL provided"}), 400

    try:
        data = request.get_json(silent=True)
    except Exception:
        return jsonify({"error": "Invalid URL provided"}), 400

    if data is None or not isinstance(data, dict):
        return jsonify({"error": "Invalid URL provided"}), 400

    url = data.get('url')
    if not url or not isinstance(url, str):
        return jsonify({"error": "Invalid URL provided"}), 400

    # Strip whitespace
    url = url.strip()

    # Basic URL validation
    valid, result = validate_url(url)
    if not valid:
        return jsonify({"error": result}), 400

    content, error, status_code = fetch_url(url)

    if content is None and error:
        if status_code is not None:
            # We got an HTTP error but couldn't parse content
            return jsonify({"error": "Could not fetch the provided URL"}), 422
        if error == "Invalid URL provided":
            return jsonify({"error": error}), 400
        return jsonify({"error": error}), 422

    # Parse metadata
    parser = MetadataParser()
    try:
        parser.feed(content)
    except Exception:
        pass

    title = parser.title or ''
    description = parser.description or ''

    return jsonify({
        "title": title,
        "description": description,
        "status_code": status_code
    }), 200


# Handle unexpected errors globally
@app.errorhandler(Exception)
def handle_exception(e):
    return jsonify({"error": "An internal error occurred"}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)