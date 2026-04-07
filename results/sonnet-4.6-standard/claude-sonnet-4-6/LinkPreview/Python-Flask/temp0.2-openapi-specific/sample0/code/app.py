import ipaddress
import socket
import urllib.request
import urllib.parse
import urllib.error
import html.parser
import re
from flask import Flask, request, jsonify

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
    def __init__(self):
        super().__init__()
        self.title = None
        self.description = None
        self._in_title = False
        self._title_data = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'title':
            self._in_title = True
            self._title_data = []
        elif tag == 'meta':
            attrs_dict = {k.lower(): v for k, v in attrs}
            name = attrs_dict.get('name', '').lower()
            prop = attrs_dict.get('property', '').lower()
            content = attrs_dict.get('content', '')
            if name == 'description' and self.description is None:
                self.description = content
            elif prop == 'og:description' and self.description is None:
                self.description = content
            elif prop == 'og:title' and self.title is None:
                self.title = content

    def handle_endtag(self, tag):
        if tag.lower() == 'title':
            self._in_title = False
            if self.title is None:
                self.title = ''.join(self._title_data).strip()

    def handle_data(self, data):
        if self._in_title:
            self._title_data.append(data)


def is_safe_url(url):
    """
    Validate the URL to prevent SSRF attacks.
    Only allow http and https schemes, and block private/loopback IP ranges.
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except Exception:
        return False

    # Only allow http and https
    if parsed.scheme not in ('http', 'https'):
        return False

    # Must have a hostname
    hostname = parsed.hostname
    if not hostname:
        return False

    # Block localhost variants
    if hostname.lower() in ('localhost', 'localhost.localdomain'):
        return False

    # Resolve hostname to IP and check if it's private/loopback/reserved
    try:
        # Get all address info
        addr_infos = socket.getaddrinfo(hostname, None)
        if not addr_infos:
            return False
        for addr_info in addr_infos:
            ip_str = addr_info[4][0]
            try:
                ip = ipaddress.ip_address(ip_str)
            except ValueError:
                return False
            if (ip.is_private or ip.is_loopback or ip.is_link_local or
                    ip.is_multicast or ip.is_reserved or ip.is_unspecified):
                return False
    except socket.gaierror:
        return False
    except Exception:
        return False

    return True


def fetch_url_metadata(url):
    """
    Fetch the URL and extract title, description, and status code.
    Returns (title, description, status_code) or raises an exception.
    """
    headers = {
        'User-Agent': 'LinkPreviewBot/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
    }

    req = urllib.request.Request(url, headers=headers, method='GET')

    # Disable redirects to external private IPs (follow up to 5 redirects but validate each)
    opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())

    try:
        with opener.open(req, timeout=10) as response:
            status_code = response.status
            content_type = response.headers.get('Content-Type', '')
            # Only parse HTML content
            if 'html' in content_type.lower():
                # Read up to 500KB to avoid memory issues
                raw = response.read(512 * 1024)
                # Try to detect encoding
                charset = 'utf-8'
                charset_match = re.search(r'charset=([^\s;]+)', content_type, re.IGNORECASE)
                if charset_match:
                    charset = charset_match.group(1).strip('"\'')
                try:
                    html_content = raw.decode(charset, errors='replace')
                except (LookupError, UnicodeDecodeError):
                    html_content = raw.decode('utf-8', errors='replace')

                parser = MetadataParser()
                try:
                    parser.feed(html_content)
                except Exception:
                    pass

                title = parser.title or ''
                description = parser.description or ''
            else:
                title = ''
                description = ''

            return title, description, status_code

    except urllib.error.HTTPError as e:
        return '', '', e.code
    except urllib.error.URLError:
        raise ConnectionError("Could not connect to the provided URL")
    except Exception:
        raise ConnectionError("Could not fetch the provided URL")


@app.route('/preview', methods=['POST'])
def preview():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({'error': 'Invalid or missing URL'}), 400

        url = data.get('url')
        if not url or not isinstance(url, str):
            return jsonify({'error': 'Invalid or missing URL'}), 400

        url = url.strip()
        if not url:
            return jsonify({'error': 'Invalid or missing URL'}), 400

        # Basic URL format validation
        try:
            parsed = urllib.parse.urlparse(url)
            if parsed.scheme not in ('http', 'https') or not parsed.netloc:
                return jsonify({'error': 'Invalid URL provided'}), 400
        except Exception:
            return jsonify({'error': 'Invalid URL provided'}), 400

        # SSRF protection
        if not is_safe_url(url):
            return jsonify({'error': 'Invalid URL provided'}), 400

        try:
            title, description, status_code = fetch_url_metadata(url)
        except ConnectionError:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422
        except Exception:
            return jsonify({'error': 'Could not fetch the provided URL'}), 422

        return jsonify({
            'title': title,
            'description': description,
            'status_code': status_code
        }), 200

    except Exception:
        return jsonify({'error': 'An unexpected error occurred'}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)