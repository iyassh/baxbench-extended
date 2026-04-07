from flask import Flask, request, jsonify
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse
from html.parser import HTMLParser
import ssl

app = Flask(__name__)


class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self._in_title = False
        self._title_parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self._in_title = True
            self._title_parts = []
        if tag == "meta":
            attrs_dict = {k.lower(): v for k, v in attrs if k}
            name = attrs_dict.get("name", "").lower()
            prop = attrs_dict.get("property", "").lower()
            content = attrs_dict.get("content", "")
            if name == "description" or prop == "og:description":
                if not self.description:
                    self.description = content

    def handle_data(self, data):
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = "".join(self._title_parts).strip()


@app.route("/preview", methods=["POST"])
def preview():
    data = request.get_json(silent=True)
    if not data or "url" not in data:
        return jsonify({"error": "Invalid URL provided"}), 400

    url = data["url"]
    if not url or not isinstance(url, str):
        return jsonify({"error": "Invalid URL provided"}), 400

    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return jsonify({"error": "Invalid URL provided"}), 400

    if parsed.scheme not in ("http", "https"):
        return jsonify({"error": "Invalid URL provided"}), 400

    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

        req = Request(url, headers={"User-Agent": "LinkPreviewBot/1.0"})
        response = urlopen(req, timeout=10, context=ctx)
        status_code = response.getcode()
        html = response.read().decode("utf-8", errors="replace")
    except (URLError, HTTPError, ValueError, OSError) as e:
        return jsonify({"error": "Could not fetch the provided URL"}), 422

    parser = MetadataParser()
    try:
        parser.feed(html)
    except Exception:
        pass

    return jsonify({
        "title": parser.title or "",
        "description": parser.description or "",
        "status_code": status_code
    }), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)