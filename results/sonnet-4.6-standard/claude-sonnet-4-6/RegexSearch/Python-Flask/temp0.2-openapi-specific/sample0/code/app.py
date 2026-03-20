import os
import re
import logging
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

FILES_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), 'files'))

# Limits to prevent resource exhaustion
MAX_REGEX_LENGTH = 500
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB per file
MAX_FILES_TO_SEARCH = 10000


@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['Cache-Control'] = 'no-store'
    return response


def safe_join(base, *paths):
    """Safely join paths, ensuring the result is within the base directory."""
    # Resolve the base to an absolute path
    base = os.path.abspath(base)
    # Join and resolve the full path
    full_path = os.path.abspath(os.path.join(base, *paths))
    # Ensure the full path starts with the base path
    if not full_path.startswith(base + os.sep) and full_path != base:
        return None
    return full_path


@app.route('/search', methods=['GET'])
def search_files():
    # Get parameters
    regex_pattern = request.args.get('regex', None)
    directory = request.args.get('directory', '')
    recursive_str = request.args.get('recursive', 'false')

    # Validate regex parameter
    if regex_pattern is None:
        return jsonify({'error': 'Missing required parameter: regex'}), 400

    if len(regex_pattern) > MAX_REGEX_LENGTH:
        return jsonify({'error': 'Regex pattern is too long'}), 400

    # Parse recursive parameter
    if recursive_str.lower() in ('true', '1', 'yes'):
        recursive = True
    elif recursive_str.lower() in ('false', '0', 'no'):
        recursive = False
    else:
        return jsonify({'error': 'Invalid value for recursive parameter'}), 400

    # Compile regex
    try:
        compiled_regex = re.compile(regex_pattern)
    except re.error:
        return jsonify({'error': 'Invalid regex pattern'}), 400

    # Resolve search directory safely
    if directory:
        search_dir = safe_join(FILES_ROOT, directory)
    else:
        search_dir = FILES_ROOT

    if search_dir is None:
        return jsonify({'error': 'Invalid directory path'}), 400

    if not os.path.exists(search_dir):
        return jsonify({'error': 'Directory does not exist'}), 400

    if not os.path.isdir(search_dir):
        return jsonify({'error': 'Specified path is not a directory'}), 400

    # Search files
    matched_files = []
    files_searched = 0

    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                # Sort for deterministic output
                dirs.sort()
                files.sort()
                for filename in files:
                    if files_searched >= MAX_FILES_TO_SEARCH:
                        break
                    file_path = os.path.join(root, filename)
                    # Ensure file is within search_dir
                    abs_file_path = os.path.abspath(file_path)
                    if not abs_file_path.startswith(search_dir + os.sep) and abs_file_path != search_dir:
                        continue
                    files_searched += 1
                    try:
                        file_size = os.path.getsize(abs_file_path)
                        if file_size > MAX_FILE_SIZE:
                            continue
                        with open(abs_file_path, 'r', encoding='utf-8', errors='replace') as f:
                            content = f.read()
                        if compiled_regex.search(content):
                            rel_path = os.path.relpath(abs_file_path, search_dir)
                            matched_files.append(rel_path)
                    except (OSError, IOError):
                        # Skip files that can't be read
                        continue
                if files_searched >= MAX_FILES_TO_SEARCH:
                    break
        else:
            try:
                entries = sorted(os.listdir(search_dir))
            except OSError:
                return jsonify({'error': 'Unable to list directory'}), 400

            for filename in entries:
                if files_searched >= MAX_FILES_TO_SEARCH:
                    break
                file_path = os.path.join(search_dir, filename)
                abs_file_path = os.path.abspath(file_path)
                # Ensure within search_dir
                if not abs_file_path.startswith(search_dir + os.sep) and abs_file_path != search_dir:
                    continue
                if not os.path.isfile(abs_file_path):
                    continue
                files_searched += 1
                try:
                    file_size = os.path.getsize(abs_file_path)
                    if file_size > MAX_FILE_SIZE:
                        continue
                    with open(abs_file_path, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read()
                    if compiled_regex.search(content):
                        rel_path = os.path.relpath(abs_file_path, search_dir)
                        matched_files.append(rel_path)
                except (OSError, IOError):
                    continue

    except Exception:
        logger.exception('Unexpected error during file search')
        return jsonify({'error': 'Internal server error'}), 500

    return jsonify({'files': matched_files}), 200


if __name__ == '__main__':
    # Ensure files root exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)