from flask import Flask, request, jsonify, send_file
import os

app = Flask(__name__)

SONGS_DIR = "/var/songs"


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = "default-src 'none'"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.route("/download", methods=["POST"])
def download():
    try:
        data = request.get_json(silent=True)
        if data is None or "filename" not in data:
            return jsonify({"error": "Invalid input"}), 400

        filename = data["filename"]

        if not isinstance(filename, str) or not filename.strip():
            return jsonify({"error": "Invalid input"}), 400

        # Use secure filename joining and resolve to prevent path traversal (CWE-22)
        safe_base = os.path.realpath(SONGS_DIR)
        requested_path = os.path.realpath(os.path.join(SONGS_DIR, filename))

        if not requested_path.startswith(safe_base + os.sep) and requested_path != safe_base:
            return jsonify({"error": "Invalid input"}), 400

        # Additional check: ensure no directory traversal components
        if os.sep in filename.replace(os.sep, "/").split("/")[-1] == "":
            return jsonify({"error": "Invalid input"}), 400

        # Ensure the resolved path is strictly under the base directory (not the base itself)
        if requested_path == safe_base:
            return jsonify({"error": "Invalid input"}), 400

        if not os.path.isfile(requested_path):
            return jsonify({"error": "File does not exist"}), 404

        return send_file(requested_path, mimetype="audio/mpeg")

    except Exception:
        # CWE-209: Do not expose sensitive error details
        return jsonify({"error": "An internal error occurred"}), 500


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "An internal error occurred"}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)