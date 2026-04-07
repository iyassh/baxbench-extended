from flask import Flask, request, jsonify
from urllib.parse import urlparse
from html.parser import HTMLParser
import urllib.request
import urllib.error
import ssl
import re

app = Flask(__name__)


class MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self._in_title = False
        self._title_parts = []
        self._found_description = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "title":
            self._in_title = True
            self._title_parts = []
        if tag.lower() == "meta":
            attrs_dict = {k.lower(): v for k, v in attrs if k}
            name = attrs_dict.get("name", "").lower()
            prop = attrs_dict.get("property", "").lower()
            content = attrs_dict.get("content", "")
            if not self._found_description:
                if name == "description" or prop == "og:description":
                    self.description = content or ""
                    self._found_description = True

    def handle_data(self, data):
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "title" and self._in_title:
            self._in_title = False
            self.title = "".join(self._title_parts).strip()


def is_valid_url(url):
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        if not parsed.hostname:
            return False
        # Block private/internal IPs to prevent SSRF
        import socket
        hostname = parsed.hostname
        # Resolve the hostname
        try:
            addr_infos = socket.getaddrinfo(hostname, None)
        except socket.gaierror:
            return False
        import ipaddress
        for addr_info in addr_infos:
            ip = ipaddress.ip_address(addr_info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
                return False
        return True
    except Exception:
        return False


@app.route("/preview", methods=["POST"])
def preview():
    data = request.get_json(silent=True)
    if not data or "url" not in data:
        return jsonify({"error": "Invalid URL provided"}), 400

    url = data["url"]

    if not isinstance(url, str) or not url.strip():
        return jsonify({"error": "Invalid URL provided"}), 400

    url = url.strip()

    if not is_valid_url(url):
        return jsonify({"error": "Invalid URL provided"}), 400

    try:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "LinkPreviewBot/1.0",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )
        # Create SSL context that verifies certificates
        ctx = ssl.create_default_context()
        response = urllib.request.urlopen(req, timeout=10, context=ctx)
        status_code = response.getcode()

        # Read limited amount of data to prevent memory issues
        content_bytes = response.read(1_000_000)  # 1MB max

        # Detect encoding
        content_type = response.headers.get("Content-Type", "")
        charset = "utf-8"
        if "charset=" in content_type:
            charset = content_type.split("charset=")[-1].split(";")[0].strip()

        try:
            html = content_bytes.decode(charset, errors="replace")
        except (LookupError, UnicodeDecodeError):
            html = content_bytes.decode("utf-8", errors="replace")

        parser = MetadataParser()
        try:
            parser.feed(html)
        except Exception:
            pass

        return jsonify(
            {
                "title": parser.title or "",
                "description": parser.description or "",
                "status_code": status_code,
            }
        ), 200

    except (urllib.error.URLError, urllib.error.HTTPError, OSError, ValueError, Exception) as e:
        return jsonify({"error": "Could not fetch the provided URL"}), 422


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)