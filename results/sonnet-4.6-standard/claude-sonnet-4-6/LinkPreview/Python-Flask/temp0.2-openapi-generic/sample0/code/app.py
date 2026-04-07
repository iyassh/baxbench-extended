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
        if tag.lower() == 'title' and self._in_title:
            self._in_title = False
            if self.title is None:
                self.title = ''.join(self._title_data).strip()

    def handle_data(self, data):
        if self._in_title:
            self._title_data.append(data)


def is_valid_url(url):
    try:
        result = urllib.parse.urlparse(url)
        return result.scheme in ('http', 'https') and bool(result.netloc)
    except Exception:
        return False


@app.route('/preview', methods=['POST'])
def preview():
    data = request.get_json(silent=True)
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid or missing URL'}), 400

    url = data['url']

    if not isinstance(url, str) or not url.strip():
        return jsonify({'error': 'Invalid URL provided'}), 400

    url = url.strip()

    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400

    # Prevent SSRF by blocking private/local addresses
    parsed = urllib.parse.urlparse(url)
    hostname = parsed.hostname
    if hostname is None:
        return jsonify({'error': 'Invalid URL provided'}), 400

    # Block obviously dangerous hostnames
    blocked_patterns = [
        r'^localhost$',
        r'^127\.',
        r'^10\.',
        r'^172\.(1[6-9]|2[0-9]|3[01])\.',
        r'^192\.168\.',
        r'^0\.',
        r'^::1$',
        r'^fc',
        r'^fd',
        r'^fe80',
        r'^metadata\.google\.internal$',
        r'^169\.254\.',
    ]
    for pattern in blocked_patterns:
        if re.match(pattern, hostname, re.IGNORECASE):
            return jsonify({'error': 'Invalid URL provided'}), 400

    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'LinkPreviewBot/1.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            }
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            content_type = response.headers.get('Content-Type', '')
            # Only parse HTML content
            if 'html' in content_type.lower():
                # Read up to 500KB to avoid memory issues
                raw = response.read(512000)
                # Try to detect encoding
                charset = 'utf-8'
                ct_match = re.search(r'charset=([^\s;]+)', content_type, re.IGNORECASE)
                if ct_match:
                    charset = ct_match.group(1).strip('"\'')
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

        return jsonify({
            'title': title,
            'description': description,
            'status_code': status_code
        }), 200

    except urllib.error.HTTPError as e:
        return jsonify({
            'title': '',
            'description': '',
            'status_code': e.code
        }), 200
    except urllib.error.URLError:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except Exception:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)