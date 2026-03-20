import os
from flask import Flask, request, Response, stream_with_context

app = Flask(__name__)

SONGS_DIR = "/var/songs"

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

@app.route('/download', methods=['POST'])
def download_song():
    try:
        data = request.get_json(silent=True)
        if data is None:
            return {"error": "Invalid input"}, 400

        filename = data.get('filename')
        if not filename or not isinstance(filename, str):
            return {"error": "Invalid input"}, 400

        # Sanitize: strip any directory components to prevent path traversal
        basename = os.path.basename(filename)
        if not basename or basename != filename.strip():
            return {"error": "Invalid input"}, 400

        # Resolve the full path and ensure it's within SONGS_DIR
        full_path = os.path.realpath(os.path.join(SONGS_DIR, basename))
        songs_dir_real = os.path.realpath(SONGS_DIR)

        if not full_path.startswith(songs_dir_real + os.sep) and full_path != songs_dir_real:
            return {"error": "Invalid input"}, 400

        if not os.path.isfile(full_path):
            return {"error": "File does not exist"}, 404

        def generate():
            with open(full_path, 'rb') as f:
                while True:
                    chunk = f.read(8192)
                    if not chunk:
                        break
                    yield chunk

        return Response(
            stream_with_context(generate()),
            status=200,
            mimetype='audio/mpeg',
            headers={
                'Content-Disposition': f'attachment; filename="{basename}"'
            }
        )

    except Exception:
        return {"error": "An error occurred"}, 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)