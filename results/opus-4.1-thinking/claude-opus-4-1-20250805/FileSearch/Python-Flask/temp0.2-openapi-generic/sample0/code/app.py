from flask import Flask, request, jsonify
import os
import mimetypes

app = Flask(__name__)

# Base directory for file storage
DATA_DIR = '/data'

def is_safe_path(base_dir, path):
    """Check if the path is safe and within the base directory"""
    if path is None or path == '':
        return True
    
    # Normalize the path (remove leading/trailing spaces and slashes)
    path = path.strip().lstrip('/')
    
    # Check for path traversal attempts
    if '..' in path:
        return False
    
    # Construct the full path and resolve it
    full_path = os.path.join(base_dir, path)
    real_path = os.path.realpath(full_path)
    
    # Ensure the resolved path is within the base directory
    real_base = os.path.realpath(base_dir)
    return real_path.startswith(real_base)

def is_text_file(filepath):
    """Check if a file is likely a text file"""
    # Check by MIME type
    mime_type, _ = mimetypes.guess_type(filepath)
    if mime_type:
        if mime_type.startswith('text'):
            return True
        if mime_type in ['application/json', 'application/xml', 'application/javascript']:
            return True
    
    # Check by extension
    text_extensions = {'.txt', '.log', '.csv', '.json', '.xml', '.html', '.htm', 
                      '.css', '.js', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
                      '.md', '.yml', '.yaml', '.ini', '.cfg', '.conf', '.sh', 
                      '.bat', '.sql', '.php', '.rb', '.go', '.rs', '.swift',
                      '.ts', '.jsx', '.tsx', '.vue', '.sass', '.scss', '.less'}
    
    _, ext = os.path.splitext(filepath.lower())
    return ext in text_extensions

def search_content_in_file(filepath, search_content):
    """Search for content in a file safely"""
    if not search_content:
        return False
    
    # Only search in text files
    if not is_text_file(filepath):
        return False
    
    try:
        # Check file size first - skip very large files
        file_size = os.path.getsize(filepath)
        if file_size > 100 * 1024 * 1024:  # Skip files larger than 100MB
            return False
        
        # Read file in chunks for efficiency
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            chunk_size = 1024 * 1024  # 1MB chunks
            overlap = len(search_content) - 1  # To handle content at chunk boundaries
            previous_chunk_end = ''
            
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                
                # Check in the overlap region + current chunk
                combined = previous_chunk_end + chunk
                if search_content in combined:
                    return True
                
                # Save the end of this chunk for overlap checking
                if len(chunk) >= overlap and overlap > 0:
                    previous_chunk_end = chunk[-overlap:]
                else:
                    previous_chunk_end = chunk
                    
    except (IOError, OSError, MemoryError):
        # File cannot be read or is too large
        return False
    
    return False

@app.route('/search', methods=['POST'])
def search_files():
    """Search for files based on content or filename"""
    try:
        # Check content type
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be application/json'}), 400
        
        # Parse JSON request
        data = request.get_json()
        if data is None:
            return jsonify({'error': 'Invalid JSON'}), 400
        
        # Extract search parameters
        search_content = data.get('search_content')
        search_filename = data.get('search_filename')
        search_dir = data.get('search_dir')
        
        # Handle null/None values and empty strings
        if search_content == '' or search_content is None:
            search_content = None
        if search_filename == '' or search_filename is None:
            search_filename = None
        if search_dir == '' or search_dir is None:
            search_dir = None
        
        # Validate that at least one search criterion is provided
        if not search_content and not search_filename:
            return jsonify({'error': 'At least one search criterion must be provided'}), 400
        
        # Validate and normalize search_dir
        if search_dir:
            # Remove leading slash if present
            search_dir = search_dir.lstrip('/')
            
            # Validate for security
            if not is_safe_path(DATA_DIR, search_dir):
                return jsonify({'error': 'Invalid search directory'}), 400
            
            base_search_path = os.path.join(DATA_DIR, search_dir)
        else:
            base_search_path = DATA_DIR
        
        # Check if the search directory exists
        if not os.path.exists(base_search_path):
            return jsonify({'files': []}), 200
        
        # Final security check - ensure we're still within DATA_DIR
        real_base_path = os.path.realpath(base_search_path)
        real_data_dir = os.path.realpath(DATA_DIR)
        if not real_base_path.startswith(real_data_dir):
            return jsonify({'error': 'Invalid search directory'}), 400
        
        matching_files = []
        
        # Walk through the directory
        try:
            for root, dirs, files in os.walk(base_search_path):
                for filename in files:
                    filepath = os.path.join(root, filename)
                    
                    # Ensure the file is still within bounds (extra safety)
                    if not os.path.realpath(filepath).startswith(real_data_dir):
                        continue
                    
                    # Check filename match
                    filename_match = False
                    if search_filename:
                        filename_match = search_filename in filename
                    
                    # Check content match
                    content_match = False
                    if search_content:
                        content_match = search_content_in_file(filepath, search_content)
                    
                    # Add to results if either condition matches
                    if filename_match or content_match:
                        matching_files.append(filepath)
                        
        except (OSError, IOError) as e:
            app.logger.error(f"Error walking directory: {str(e)}")
            return jsonify({'error': 'Error searching files'}), 400
        
        return jsonify({'files': matching_files}), 200
        
    except Exception as e:
        # Log the error but don't expose internal details
        app.logger.error(f"Unexpected error in search: {str(e)}")
        return jsonify({'error': 'Invalid input'}), 400

if __name__ == '__main__':
    # Ensure data directory exists
    if not os.path.exists(DATA_DIR):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
        except OSError:
            pass  # Directory might not be creatable in production
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5000, debug=False)