import os
import re
import logging
from flask import Flask, request, jsonify

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Files root directory
FILES_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), 'files'))

# Limits to prevent resource exhaustion
MAX_REGEX_LENGTH = 500
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_FILES_TO_SEARCH = 10000


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'none'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Referrer-Policy'] = 'no-referrer'
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
    except re.error as e:
        return jsonify({'error': 'Invalid regex pattern'}), 400

    # Determine search directory
    if directory:
        search_dir = safe_join(FILES_ROOT, directory)
        if search_dir is None:
            return jsonify({'error': 'Invalid directory path'}), 400
    else:
        search_dir = FILES_ROOT

    # Check that the search directory exists and is accessible
    if not os.path.exists(search_dir):
        return jsonify({'error': 'Directory does not exist'}), 400

    if not os.path.isdir(search_dir):
        return jsonify({'error': 'Path is not a directory'}), 400

    # Search files
    matched_files = []
    files_searched = 0

    try:
        if recursive:
            for root, dirs, files in os.walk(search_dir):
                # Security: ensure we stay within search_dir
                abs_root = os.path.abspath(root)
                if not (abs_root.startswith(search_dir + os.sep) or abs_root == search_dir):
                    continue

                for filename in files:
                    if files_searched >= MAX_FILES_TO_SEARCH:
                        break

                    file_path = os.path.join(root, filename)
                    abs_file_path = os.path.abspath(file_path)

                    # Ensure file is within search directory
                    if not (abs_file_path.startswith(search_dir + os.sep) or abs_file_path == search_dir):
                        continue

                    files_searched += 1
                    matched = check_file_match(abs_file_path, compiled_regex)
                    if matched:
                        rel_path = os.path.relpath(abs_file_path, search_dir)
                        matched_files.append(rel_path)

                if files_searched >= MAX_FILES_TO_SEARCH:
                    break
        else:
            try:
                entries = os.listdir(search_dir)
            except PermissionError:
                return jsonify({'error': 'Permission denied to access directory'}), 400

            for filename in entries:
                if files_searched >= MAX_FILES_TO_SEARCH:
                    break

                file_path = os.path.join(search_dir, filename)
                abs_file_path = os.path.abspath(file_path)

                # Ensure file is within search directory
                if not (abs_file_path.startswith(search_dir + os.sep) or abs_file_path == search_dir):
                    continue

                if not os.path.isfile(abs_file_path):
                    continue

                files_searched += 1
                matched = check_file_match(abs_file_path, compiled_regex)
                if matched:
                    rel_path = os.path.relpath(abs_file_path, search_dir)
                    matched_files.append(rel_path)

    except Exception as e:
        logger.error('Error during file search: %s', str(e))
        return jsonify({'error': 'Internal server error'}), 500

    return jsonify({'files': matched_files}), 200


def check_file_match(file_path, compiled_regex):
    """Check if a file's content matches the given compiled regex."""
    try:
        file_size = os.path.getsize(file_path)
        if file_size > MAX_FILE_SIZE:
            return False

        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read(MAX_FILE_SIZE)
            if compiled_regex.search(content):
                return True
    except PermissionError:
        logger.warning('Permission denied reading file: %s', file_path)
    except OSError as e:
        logger.warning('OS error reading file %s: %s', file_path, str(e))
    except Exception as e:
        logger.warning('Unexpected error reading file %s: %s', file_path, str(e))
    return False


if __name__ == '__main__':
    # Ensure files root directory exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)