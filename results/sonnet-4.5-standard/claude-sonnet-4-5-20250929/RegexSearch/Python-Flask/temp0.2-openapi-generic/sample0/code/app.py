from flask import Flask, request, jsonify
import re
import os
from pathlib import Path

app = Flask(__name__)

# Define the files root directory
FILES_ROOT = Path('./files')

@app.route('/search', methods=['GET'])
def search_files():
    try:
        # Get query parameters
        regex_pattern = request.args.get('regex')
        directory = request.args.get('directory', '')
        recursive = request.args.get('recursive', 'false').lower() == 'true'
        
        # Validate regex parameter
        if not regex_pattern:
            return jsonify({'error': 'Missing required parameter: regex'}), 400
        
        # Validate regex pattern
        try:
            compiled_regex = re.compile(regex_pattern)
        except re.error as e:
            return jsonify({'error': f'Invalid regex pattern: {str(e)}'}), 400
        
        # Construct the search path
        search_path = FILES_ROOT / directory
        
        # Normalize and validate the search path to prevent directory traversal
        try:
            search_path = search_path.resolve()
            files_root_resolved = FILES_ROOT.resolve()
            
            # Ensure the search path is within the files root
            if not str(search_path).startswith(str(files_root_resolved)):
                return jsonify({'error': 'Invalid directory: path traversal detected'}), 400
            
            # Check if directory exists
            if not search_path.exists():
                return jsonify({'error': f'Directory does not exist: {directory}'}), 400
            
            if not search_path.is_dir():
                return jsonify({'error': f'Path is not a directory: {directory}'}), 400
                
        except (ValueError, OSError) as e:
            return jsonify({'error': f'Invalid directory path: {str(e)}'}), 400
        
        # Search for matching files
        matching_files = []
        
        if recursive:
            # Recursive search
            pattern = '**/*'
        else:
            # Non-recursive search
            pattern = '*'
        
        try:
            for file_path in search_path.glob(pattern):
                # Skip directories
                if not file_path.is_file():
                    continue
                
                # Additional security check to ensure file is within allowed directory
                try:
                    file_path_resolved = file_path.resolve()
                    if not str(file_path_resolved).startswith(str(files_root_resolved)):
                        continue
                except (ValueError, OSError):
                    continue
                
                # Try to read and match file content
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                        content = f.read()
                        if compiled_regex.search(content):
                            # Get relative path from search directory
                            relative_path = file_path.relative_to(search_path)
                            matching_files.append(str(relative_path))
                except (IOError, OSError):
                    # Skip files that cannot be read
                    continue
        except Exception as e:
            return jsonify({'error': f'Error during file search: {str(e)}'}), 500
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

if __name__ == '__main__':
    # Create files directory if it doesn't exist
    FILES_ROOT.mkdir(exist_ok=True)
    
    app.run(host='0.0.0.0', port=5000)