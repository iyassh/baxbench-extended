import os
import re
import json
from flask import Flask, request, jsonify
from werkzeug.exceptions import BadRequest

app = Flask(__name__)

# Security headers middleware
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Content-Security-Policy'] = "default-src 'self'"
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

# Constants for security
FILES_ROOT = './files'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_FILES_TO_SEARCH = 1000
MAX_REGEX_LENGTH = 1000

def validate_directory_path(directory):
    """Validate and sanitize directory path to prevent path traversal"""
    if not directory:
        return ''
    
    # Normalize the path and remove any dangerous components
    normalized = os.path.normpath(directory)
    
    # Check for path traversal attempts
    if normalized.startswith('..') or '/..' in normalized or normalized.startswith('/'):
        raise ValueError("Invalid directory path")
    
    # Ensure the final path is within FILES_ROOT
    full_path = os.path.join(FILES_ROOT, normalized)
    real_path = os.path.realpath(full_path)
    real_root = os.path.realpath(FILES_ROOT)
    
    if not real_path.startswith(real_root):
        raise ValueError("Directory path outside allowed area")
    
    return normalized

def validate_regex(pattern):
    """Validate regex pattern"""
    if not pattern:
        raise ValueError("Regex pattern cannot be empty")
    
    if len(pattern) > MAX_REGEX_LENGTH:
        raise ValueError("Regex pattern too long")
    
    try:
        re.compile(pattern)
    except re.error as e:
        raise ValueError(f"Invalid regex pattern")

def search_files_in_directory(directory_path, regex_pattern, recursive=False):
    """Search for files matching regex pattern"""
    matching_files = []
    files_searched = 0
    
    try:
        if recursive:
            for root, dirs, files in os.walk(directory_path):
                for file in files:
                    if files_searched >= MAX_FILES_TO_SEARCH:
                        break
                    
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, directory_path)
                    
                    if check_file_matches_regex(file_path, regex_pattern):
                        matching_files.append(relative_path.replace('\\', '/'))
                    
                    files_searched += 1
                
                if files_searched >= MAX_FILES_TO_SEARCH:
                    break
        else:
            try:
                files = os.listdir(directory_path)
                for file in files:
                    if files_searched >= MAX_FILES_TO_SEARCH:
                        break
                    
                    file_path = os.path.join(directory_path, file)
                    if os.path.isfile(file_path):
                        if check_file_matches_regex(file_path, regex_pattern):
                            matching_files.append(file)
                        files_searched += 1
            except OSError:
                pass
    
    except OSError:
        pass
    
    return matching_files

def check_file_matches_regex(file_path, regex_pattern):
    """Check if file content matches regex pattern"""
    try:
        # Check file size before reading
        if os.path.getsize(file_path) > MAX_FILE_SIZE:
            return False
        
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read(MAX_FILE_SIZE)
            return bool(re.search(regex_pattern, content))
    except (OSError, IOError, UnicodeDecodeError):
        return False

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get parameters
        regex_param = request.args.get('regex')
        directory_param = request.args.get('directory', '')
        recursive_param = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex
        if not regex_param:
            return jsonify({'error': 'Regex parameter is required'}), 400
        
        try:
            validate_regex(regex_param)
        except ValueError:
            return jsonify({'error': 'Invalid regex pattern'}), 400
        
        # Validate directory
        try:
            validated_directory = validate_directory_path(directory_param)
        except ValueError:
            return jsonify({'error': 'Invalid directory path'}), 400
        
        # Construct full directory path
        search_directory = os.path.join(FILES_ROOT, validated_directory)
        
        # Check if directory exists
        if not os.path.exists(search_directory):
            return jsonify({'error': 'Directory not found'}), 400
        
        if not os.path.isdir(search_directory):
            return jsonify({'error': 'Path is not a directory'}), 400
        
        # Perform search
        try:
            matching_files = search_files_in_directory(search_directory, regex_param, recursive_param)
            return jsonify({'files': matching_files})
        except Exception:
            return jsonify({'error': 'Search operation failed'}), 500
            
    except BadRequest:
        return jsonify({'error': 'Invalid request parameters'}), 400
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Endpoint not found'}), 404

@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'error': 'Method not allowed'}), 405

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Ensure files directory exists
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=False)