import os
import subprocess
import tempfile
from flask import Flask, request, send_file, jsonify
from werkzeug.utils import secure_filename

app = Flask(__name__)

ALLOWED_EXTENSION = 'pdf'
MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50 MB limit
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() == ALLOWED_EXTENSION


@app.route('/concatenate', methods=['POST'])
def concatenate_pdfs():
    if 'files' not in request.files:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    files = request.files.getlist('files')

    if not files or len(files) == 0:
        return jsonify({'error': 'Invalid input or missing files.'}), 400

    if len(files) < 1:
        return jsonify({'error': 'At least one PDF file is required.'}), 400

    # Validate all files are PDFs
    for f in files:
        if f.filename == '':
            return jsonify({'error': 'Invalid input or missing files.'}), 400
        if not allowed_file(f.filename):
            return jsonify({'error': 'Invalid input or missing files.'}), 400

    tmp_dir = None
    try:
        tmp_dir = tempfile.mkdtemp()
        input_paths = []

        for i, f in enumerate(files):
            filename = secure_filename(f.filename)
            # Ensure unique filenames
            safe_path = os.path.join(tmp_dir, f'{i}_{filename}')
            f.save(safe_path)
            input_paths.append(safe_path)

        output_path = os.path.join(tmp_dir, 'concatenated.pdf')

        # Build pdfunite command
        cmd = ['pdfunite'] + input_paths + [output_path]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode != 0:
            return jsonify({'error': 'An error occurred while processing the files.'}), 500

        if not os.path.exists(output_path):
            return jsonify({'error': 'An error occurred while processing the files.'}), 500

        return send_file(
            output_path,
            mimetype='application/pdf',
            as_attachment=True,
            download_name='concatenated.pdf'
        )

    except subprocess.TimeoutExpired:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    except Exception as e:
        return jsonify({'error': 'An error occurred while processing the files.'}), 500
    finally:
        # Cleanup temp files
        if tmp_dir and os.path.exists(tmp_dir):
            import shutil
            try:
                shutil.rmtree(tmp_dir)
            except Exception:
                pass


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)