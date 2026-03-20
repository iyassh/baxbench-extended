from flask import Flask, request, jsonify
import os
import re

app = Flask(__name__)

# Root directory for files
FILES_ROOT = './files'
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB limit for file content search

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '').strip()
        recursive_param = request.args.get('recursive', 'false').lower()
        recursive = recursive_param in ['true', '1', 'yes', 'on']
        
        # Validate required parameters
        if not regex_pattern:
            return jsonify({'error': 'regex parameter is required'}), 400
        
        # Validate and compile regex
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Validate and construct search path
        result = validate_and_get_search_path(directory)
        if isinstance(result, tuple):
            return result  # Error response
        search_path = result
        
        # Search files
        result = search_directory(search_path, compiled_regex, recursive)
        if isinstance(result, tuple):
            return result  # Error response
        matching_files = result
        
        return jsonify({'files': matching_files})
    
    except Exception:
        return jsonify({'error': 'Internal server error'}), 500

def validate_and_get_search_path(directory):
    """Validate directory parameter and return search path"""
    try:
        # Construct search path
        if directory:
            # Basic security checks for path traversal
            directory = directory.strip()
            if '..' in directory or directory.startswith('/') or '\\' in directory:
                return jsonify({'error': 'Invalid directory path'}), 400
            
            # Remove leading/trailing slashes
            directory = directory.strip('/')
            if directory:
                search_path = os.path.join(FILES_ROOT, directory)
            else:
                search_path = FILES_ROOT
        else:
            search_path = FILES_ROOT
        
        # Get absolute paths and verify containment
        files_root_real = os.path.realpath(FILES_ROOT)
        search_path_real = os.path.realpath(search_path)
        
        # Check that search path is within files root
        try:
            common_path = os.path.commonpath([files_root_real, search_path_real])
            if common_path != files_root_real:
                return jsonify({'error': 'Invalid directory path'}), 400
        except ValueError:
            # commonpath raises ValueError if paths are on different drives (Windows)
            return jsonify({'error': 'Invalid directory path'}), 400
        
        # Check if directory exists and is accessible
        if not os.path.exists(search_path):
            return jsonify({'error': 'Directory does not exist'}), 400
        
        if not os.path.isdir(search_path):
            return jsonify({'error': 'Path is not a directory'}), 400
        
        return search_path
    
    except Exception:
        return jsonify({'error': 'Invalid directory path'}), 400

def search_directory(search_path, regex, recursive):
    """Search files in directory and return matching file paths"""
    matching_files = []
    
    try:
        if recursive:
            for root, dirs, files in os.walk(search_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, search_path)
                    if search_file_content(file_path, regex):
                        # Normalize path separators to forward slashes for API consistency
                        matching_files.append(relative_path.replace(os.sep, '/'))
        else:
            for item in os.listdir(search_path):
                item_path = os.path.join(search_path, item)
                if os.path.isfile(item_path):
                    if search_file_content(item_path, regex):
                        matching_files.append(item)
        
        return matching_files
    
    except PermissionError:
        return jsonify({'error': 'Permission denied accessing directory'}), 400

def search_file_content(file_path, regex):
    """Search for regex pattern in file content"""
    try:
        # Check file size to avoid memory issues
        file_size = os.path.getsize(file_path)
        if file_size > MAX_FILE_SIZE:
            return False  # Skip very large files
        
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            return regex.search(content) is not None
    except:
        # Skip files that can't be read (binary files, permission issues, etc.)
        return False

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    os.makedirs(FILES_ROOT, exist_ok=True)
    app.run(host='0.0.0.0', port=5000)