from flask import Flask, request, jsonify
import urllib.request
import urllib.error
import urllib.parse
import html.parser
import re

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
        result = urllib.parse.urlparse(url)
        return result.scheme in ('http', 'https') and bool(result.netloc)
    except Exception:
        return False


@app.route('/preview', methods=['POST'])
def preview():
    data = request.get_json(silent=True)
    
    if not data or 'url' not in data:
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    url = data['url']
    
    if not url or not isinstance(url, str):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    if not is_valid_url(url):
        return jsonify({'error': 'Invalid URL provided'}), 400
    
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)'
            }
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            status_code = response.getcode()
            content_type = response.headers.get('Content-Type', '')
            
            if 'html' in content_type.lower():
                charset = 'utf-8'
                charset_match = re.search(r'charset=([^\s;]+)', content_type, re.IGNORECASE)
                if charset_match:
                    charset = charset_match.group(1).strip()
                
                raw = response.read(500000)
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
    
    except urllib.error.URLError as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422
    except Exception as e:
        return jsonify({'error': 'Could not fetch the provided URL'}), 422


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)