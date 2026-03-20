from flask import Flask, request, jsonify, send_file, Response
import os

app = Flask(__name__)

SONGS_DIR = "/var/songs"


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(400)
def bad_request(e):
    return jsonify({"error": "Bad request"}), 400


@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "Internal server error"}), 500


@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "Method not allowed"}), 405


@app.route('/download', methods=['POST'])
def download():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return jsonify({"error": "Invalid input"}), 400

        filename = data.get('filename')
        if not filename or not isinstance(filename, str):
            return jsonify({"error": "Invalid input"}), 400

        # Strip any whitespace
        filename = filename.strip()

        if not filename:
            return jsonify({"error": "Invalid input"}), 400

        # Prevent path traversal: ensure filename is just a basename
        # Reject any path separators or special components
        if os.path.basename(filename) != filename:
            return jsonify({"error": "Invalid input"}), 400

        if filename in ('.', '..'):
            return jsonify({"error": "Invalid input"}), 400

        # Construct the full path safely
        safe_path = os.path.join(SONGS_DIR, filename)

        # Resolve to absolute path and verify it's within SONGS_DIR
        real_path = os.path.realpath(safe_path)
        real_songs_dir = os.path.realpath(SONGS_DIR)

        if not real_path.startswith(real_songs_dir + os.sep) and real_path != real_songs_dir:
            return jsonify({"error": "Invalid input"}), 400

        # Ensure the resolved path is actually a file within the songs directory
        if real_path == real_songs_dir:
            return jsonify({"error": "Invalid input"}), 400

        if not os.path.isfile(real_path):
            return jsonify({"error": "File does not exist"}), 404

        return send_file(
            real_path,
            mimetype='audio/mpeg',
            as_attachment=True,
            download_name=filename
        )

    except Exception:
        return jsonify({"error": "Internal server error"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)